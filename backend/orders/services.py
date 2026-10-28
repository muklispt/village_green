"""Order business rules. Views stay thin and call these functions.

INVENTORY POLICY
- Stock is deducted when the order is created (checkout). Only cash on delivery
  exists in this step, and a COD order is a firm commitment, so its stock is not
  held "for later": it is sold.
- Stock is released exactly once: when an order is cancelled (by the customer or by
  staff). `Order.stock_deducted` is the flag; it is checked and cleared under the
  order row lock, so a repeat cancel or a retry can never restore stock twice.
- Stock is never changed again after shipping. Delivered and shipped orders cannot
  be cancelled.

LOCK ORDER (prevents deadlocks): cart -> variants (by id) -> products (by id), and
for an existing order: the order row first. Payments are only changed while the
order row is locked.
"""

from decimal import Decimal,ROUND_HALF_UP

from django.conf import settings
from django.db import IntegrityError,transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework.exceptions import ValidationError

from cart.models import Cart,CartItem
from product.models import Product,ProductVariant

from .models import (Order,OrderItem,OrderStatus,OrderStatusHistory,Payment,
                     PaymentMethod,PaymentStatus)

MONEY = Decimal('0.01')
ORDER_NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

ALLOWED_TRANSITIONS = {
    OrderStatus.PENDING:{OrderStatus.CONFIRMED,OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED:{OrderStatus.PROCESSING,OrderStatus.CANCELLED},
    OrderStatus.PROCESSING:{OrderStatus.SHIPPED,OrderStatus.CANCELLED},
    OrderStatus.SHIPPED:{OrderStatus.DELIVERED},
    OrderStatus.DELIVERED: set(),
    OrderStatus.CANCELLED: set(),
}
CUSTOMER_CANCELLABLE = {OrderStatus.PENDING,OrderStatus.CONFIRMED}


def error(field,message):
    return ValidationError({field:[message]})

# ---------------------------------------------------------------- money
def calculate_totals(subtotal):
    """Totals from the configured rules. Discount is 0 until coupons exist."""
    discount = Decimal('0.00')
    fee = settings.ORDER_SHIPPING_FEE
    threshold = settings.ORDER_FREE_SHIPPING_THRESHOLD
    shipping = Decimal('0.00') if (threshold > 0 and subtotal >= threshold) else fee
    taxable = subtotal - discount
    tax = (taxable * settings.ORDER_TAX_RATE_PERCENT / Decimal('100')).quantize(
        MONEY,rounding=ROUND_HALF_UP
    )
    total = subtotal - discount + shipping + tax
    return {
        'subtotal':subtotal.quantize(MONEY),
        'discount_amount':discount,
        'shipping_fee':shipping.quantize(MONEY),
        'tax_amount':tax,
        'total_amount':total.quantize(MONEY),
    }

# ---------------------------------------------------------------- stock

def _lock_stock_rows(variant_ids,product_ids):
    variants = {
        v.pk:v for v in
        ProductVariant.objects.select_for_update().filter(pk__in=variant_ids).order_by('pk')
    }
    products = {
        p.pk:p for p in 
        Product.objects.select_for_update().filter(pk__in=product_ids).order_by('pk')
    }
    return variants,products


def _adjust_stock(entries,direction):
    """entries: (variant_id or None, product_id, quantity). direction -1 deducts, +1 restores.
    A database CHECK (stock >= 0) is the last guard against negative inventory."""
    synced = set()
    for variant_id,product_id,quantity in entries:
        if variant_id:
            ProductVariant.objects.filter(pk=variant_id).update(
                stock_quantity=F('stock_quantity') + direction * quantity
            )
            synced.add(product_id)
        else:
            Product.objects.filter(pk=product_id).update(
                stock_quantity=F('stock_quantity') + direction * quantity
            )
    # A product with variants shows the sum of its active variants' stock.
    for product_id in sorted(synced):
        Product.objects.get(pk=product_id).sync_stock_from_variants()


# ---------------------------------------------------------------- checkout

def _validate_and_price_lines(cart_items):
    """Re-read everything under row locks. Returns priced lines or raises one
    error listing every problem."""
    variant_ids = sorted({i.variant_id for i in cart_items if i.variant_id})
    product_ids = sorted({i.product_id for i in cart_items})
    variants,products = _lock_stock_rows(variant_ids,product_ids)
    with_active_variants = set(
        ProductVariant.objects.filter(product_id__in=product_ids,is_active=True)
        .values_list('product_id',flat=True)
    )

    problems, lines = [],[]
    for item in cart_items:
        product = products.get(item.product_id)
        variant = variants.get(item.variant_id) if item.variant_id else None
        label = product.name if product else 'An item'
        stock = 0
        problem = None

        if product is None or not product.is_active:
            problem = 'is no longer available.'
        elif item.variant_id:
            label =f'{product.name} ({variant.quantity.normalize():f} {variant.unit})' if variant else product.name
            if variant is None or not variant.is_active or variant.product_id !=product.pk:
                problem = 'is no longer available in this size.'
            else:
                stock = variant.stock_quantity
        elif product.pk in with_active_variants:
            problem = 'needs a size selected.'
        else:
            stock = product.stock_quantity

        if problem is None:
            if stock <=0:
                problem = 'is out of stock.'
            elif item.quantity > stock:
                problem =f'only {stock} left.'

        if problem:
            problems.append(f'{label}: {problem}')
            continue

        unit_price = variant.price if variant else product.price
        lines.append({
            'product':product,
            'variant':variant,
            'quantity':item.quantity,
            'unit_price':unit_price,
            'line_total':(unit_price * item.quantity).quantize(MONEY),
        })

    if problems:
        raise ValidationError({'items':problems})
    return lines


def _create_order(user,data,idempotency_key):
    """Returns (order, created)."""
    cart = Cart.objects.select_for_update().filter(user=user).first()

    # A parallel request with the same key may have finished while we waited for the
    # cart lock. Look again now, so a retry gets the first order and not "cart is empty".
    if idempotency_key:
        existing = (Order.objects.filter(customer=user,idempotency_key=idempotency_key)
                    .select_related('payment').first())
        if existing:
            return existing, False

    cart_items = list(CartItem.objects.filter(cart=cart) if cart else [])
    if not cart_items:
        raise error('cart','Your cart is empty.')

    lines = _validate_and_price_lines(cart_items)
    totals = calculate_totals(sum((line['line_total'] for line in lines),Decimal('0.00')))

    order = Order.objects.create(
        order_number = 'GV' + get_random_string(8,ORDER_NUMBER_CHARS),
        customer = user,
        status = OrderStatus.PENDING,
        payment_method=data['payment_method'],
        currency=settings.ORDER_CURRENCY,
        recipient_name=data['recipient_name'],
        recipient_phone = data['recipient_phone'],
        shipping_address=data['shipping_address'],
        shipping_city=data['shipping_city'],
        shipping_pincode=data['shipping_pincode'],
        idempotency_key=idempotency_key,
        **totals,
    )

    OrderItem.objects.bulk_create([
        OrderItem(
            order=order,
            product=line['product'],
            variant=line['variant'],
            product_name =line['product'].name,
            variant_sku=line['variant'].sku if line['variant'] else '',
            variant_label = (
                f'{line['variant'].quantity.normalize():f} {line['variant'].unit}'
                if line['variant'] else ''
            ),
            unit_price=line['unit_price'],
            quantity=line['quantity'],
            line_total=line['line_total'],
        )
        for line in lines
    ])

    _adjust_stock(
        [(l['variant'].pk if l['variant'] else None, l['product'].pk,l['quantity']) for l in lines],
        direction=-1,
    )
    order.stock_deducted = True
    order.save(update_fields=['stock_deducted'])

    Payment.objects.create(
        order=order,
        method=data['payment_method'],
        amount=order.total_amount,
        currency=order.currency,
        status=PaymentStatus.PENDING,
    )
    OrderStatusHistory.objects.create(order=order,from_status='',to_status=OrderStatus.PENDING)

    # Last  step inside the same transaction: if anything above failed, the cart is untouched.
    CartItem.objects.filter(cart=cart).delete()
    Cart.objects.filter(pk=cart.pk).update(updated_at=timezone.now())
    return order,True


def checkout(user,data,idempotency_key=None):
    """Create an order from the user's cart. Returns (order,created).
    With an idempotency another one. The database enforces it.
    """
    def existing_order():
        if not idempotency_key:
            return None
        return (Order.objects.filter(customer=user,idempotency_key=idempotency_key)
                .select_related('payment').first())


    found = existing_order()
    if found:
        return found, False

    if data['payment_method'] != PaymentMethod.COD:
        # Online payment needs a payment provider, which is a later step. An online
        # order could never be paid, and its stock would be held for nothing.
        raise error('payment_method','Online payment is not available yet. Choose cash on delivery.')

    for attempt in range(3):
        try:
            with transaction.atomic():
                return _create_order(user,data,idempotency_key)
        except IntegrityError:
            # Either a parallel request with the same key won, or an order number collided.
            found = existing_order()
            if found:
                return found , False
            if attempt == 2:
                raise 
    
# ---------------------------------------------------------------- status changes

def _lock_order(order_id):
    return Order.objects.select_for_update().get(pk=order_id)


def _record(order,from_status,to_status,actor,note=''):
    OrderStatusHistory.objects.create(
        order=order,from_status=from_status,to_status=to_status,
        changed_by=actor,note=note[:200],
    )


def _release_stock(order):
    """Give stock back once. Lines whose product or variant was deteted are skipped."""
    if not order.stock_deducted:
        return 
    items = list(order.items.all())
    variant_ids=sorted({i.variant_id for i in items if i.variant_id})
    product_ids = sorted({i.product_id for i in items if i.product_id})
    _lock_stock_rows(variant_ids,product_ids)

    entries = []
    for item in items:
        if item.product_id is None:
            continue
        if item.variant_sku and item.variant_id is None:
             continue # it was variant line and the variant is gone
        entries.append((item.variant_id,item.product_id,item.quantity))
    if entries:
        _adjust_stock(entries,direction=+1)
    order.stock_deducted = False

def _cancel_locked(order,actor,note,*,require_unpaid=False):
    payment = order.payment
    if require_unpaid and payment.status== PaymentStatus.PAID:
        return order

    previous = order.status
    _release_stock(order)
    order.status = OrderStatus.CANCELLED
    order.save(update_fields=['status','stock_deducted','updated_at'])

    if payment.status == PaymentStatus.PAID:
        payment.status = PaymentStatus.REFUND_PENDING #staff refunds it manually
    elif payment.status in (PaymentStatus.PENDING,PaymentStatus.FAILED):
        payment.status = PaymentStatus.CANCELLED
    payment.save(update_fields=['status','updated_at'])
    _record(order,previous,OrderStatus.CANCELLED,actor,note)
    return order


def customer_can_cancel(order):
    return (
        order.status in CUSTOMER_CANCELLABLE
        and order.payment.status != PaymentStatus.PAID
    )


@transaction.atomic
def cancel_order_for_customer(order_id,customer):
    order = _lock_order(order_id)
    if order.customer_id != customer.pk:
        raise Order.DoesNotExist
    order = Order.objects.select_related('payment').get(pk=order.pk)
    if order.status not in CUSTOMER_CANCELLABLE:
        raise error('status',f'An order with status {order.status} cannot be cancelled.')
    if order.payment.status == PaymentStatus.PAID:
        raise error('detail','A paid order cannot be cancelled here. Please contact support.')
    return _cancel_locked(order,customer,'Cancelled by customer')


@transaction.atomic
def update_status(order_id,new_status,actor,note=''):
    """Staff status change, following ALLOWED_TRANSITIONS."""
    _lock_order(order_id)
    order = Order.objects.select_related('payment').get(pk=order_id)
    payment = order.payment

    if new_status not in ALLOWED_TRANSITIONS.get(order.status,set()):
        raise error('status',f"Cannot change an order from {order.status} to {new_status}.")

    if new_status == OrderStatus.CANCELLED:
        return _cancel_locked(order,actor, note or 'Cancelled by staff')

    # Online orders move on only after the payment is varified.
    if order.payment_method == PaymentMethod.ONLINE and payment.status != PaymentStatus.PAID:
        raise error('status','Online payment has not been verified for this order.')

    previous = order.status
    order.status = new_status
    order.save(update_fields=['status','updated_at'])

    if new_status == OrderStatus.DELIVERED and order.payment_method == PaymentMethod.COD:
        payment.status = PaymentStatus.PAID #Cash collected on delivery
        payment.paid_at=timezone.now()
        payment.save(update_fields=['status','paid_at','updated_at'])

    _record(order,previous,new_status,actor,note)
    return order


    

    



