from . import razorpay_client
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
import json
import logging
import uuid

from django.conf import settings
from django.db import IntegrityError,transaction
from django.db.models import F, Q
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework.exceptions import ValidationError

from cart.models import Cart,CartItem
from product.models import Product,ProductVariant

from .models import (Order,OrderItem,OrderStatus,OrderStatusHistory,Payment,
                     PaymentMethod,PaymentStatus,WebhookDelivery)


logger = logging.getLogger(__name__)

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
        provider='razorpay' if data['payment_method'] == PaymentMethod.ONLINE else '',
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

    if data['payment_method'] == PaymentMethod.ONLINE:
        if not razorpay_client.is_configured():
            raise error('payment_method','Online payment is not available yet (payment provider not configured). Choose cash on delivery.')
    elif data['payment_method'] != PaymentMethod.COD:
        # Online payment needs a payment provider, which is a later step. An online
        # order could never be paid, and its stock would be held for nothing.
        raise error('payment_method','Invalid payment method.')

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
def cancel_order_for_admin(order_id, actor, reason=''):
    """Cancel an order as staff/admin with reason and audit logging.

    Rules:
    - Enforces ALLOWED_TRANSITIONS (cannot cancel shipped or delivered orders).
    - Prevents duplicate cancellation.
    - Releases inventory exactly once (checked by order.stock_deducted).
    - If already paid, marks payment as REFUND_PENDING for manual refund workflow.
    - Records OrderStatusHistory with actor and note.
    """
    _lock_order(order_id)
    order = Order.objects.select_related('payment').get(pk=order_id)

    if order.status == OrderStatus.CANCELLED:
        raise error('status', 'This order has already been cancelled.')

    if OrderStatus.CANCELLED not in ALLOWED_TRANSITIONS.get(order.status, set()):
        raise error('status', f"Cannot cancel an order with status {order.status}.")

    note = (reason or 'Cancelled by staff').strip()
    return _cancel_locked(order, actor, note)


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

# ---------------------------------------------------------------- Razorpay Gateway Integration

def create_razorpay_order(order_id, user):
    """Create or retrieve a Razorpay order session for an authenticated customer's order.
    
    Architecture:
    1. Read and validate order state.
    2. Reuse existing pending Razorpay order without API calls if already present.
    3. Make external Razorpay API call OUTSIDE of any database transactions or locks.
    4. Open short transaction.atomic(), acquire select_for_update() row lock.
    5. Revalidate state and persist provider_order_id safely under concurrency.
    """
    order = Order.objects.select_related('payment').filter(id=order_id).first()
    if not order or order.customer_id != user.pk:
        raise Order.DoesNotExist

    payment = order.payment

    if order.payment_method != PaymentMethod.ONLINE:
        raise error('payment_method', 'This order is not configured for online payment.')

    if payment.status == PaymentStatus.PAID:
        raise error('payment', 'This order has already been paid.')

    if order.status == OrderStatus.CANCELLED:
        raise error('order', 'Cancelled orders cannot be paid.')

    # Authoritative amount in paise using Decimal-based conversion
    amount_paise = int(Decimal(str(order.total_amount)) * 100)
    if amount_paise <= 0:
        raise error('amount', 'Invalid order total amount.')

    # Safe retry: reuse existing Razorpay order if already created and still pending
    if payment.provider == 'razorpay' and payment.provider_order_id:
        return {
            "key_id": settings.RAZORPAY_KEY_ID,
            "razorpay_order_id": payment.provider_order_id,
            "order_id": str(order.id),
            "order_number": order.order_number,
            "amount": amount_paise,
            "currency": order.currency,
            "name": "Green Village",
            "description": f"Order #{order.order_number}",
            "prefill": {
                "name": order.recipient_name or getattr(user, 'first_name', ''),
                "email": getattr(user, 'email', ''),
                "contact": order.recipient_phone or '',
            },
        }

    # Step 2: Make external network API call OUTSIDE database transactions/locks
    rzp_order = razorpay_client.create_order(
        amount_paise=amount_paise,
        currency=order.currency or 'INR',
        receipt=order.order_number,
        notes={'order_id': str(order.id), 'order_number': order.order_number},
    )

    # Step 3 & 4: Open short atomic transaction and lock row
    with transaction.atomic():
        locked_order = _lock_order(order_id)
        if locked_order.customer_id != user.pk:
            raise Order.DoesNotExist
        locked_payment = Payment.objects.select_for_update().get(order=locked_order)

        # Step 5: Revalidate under lock
        if locked_order.payment_method != PaymentMethod.ONLINE:
            raise error('payment_method', 'This order is not configured for online payment.')
        if locked_payment.status == PaymentStatus.PAID:
            raise error('payment', 'This order has already been paid.')
        if locked_order.status == OrderStatus.CANCELLED:
            raise error('order', 'Cancelled orders cannot be paid.')

        # If a parallel request already persisted a session, preserve it
        if locked_payment.provider == 'razorpay' and locked_payment.provider_order_id:
            active_order_id = locked_payment.provider_order_id
        else:
            locked_payment.provider = 'razorpay'
            locked_payment.provider_order_id = rzp_order['id']
            locked_payment.save(update_fields=['provider', 'provider_order_id', 'updated_at'])
            active_order_id = locked_payment.provider_order_id

    return {
        "key_id": settings.RAZORPAY_KEY_ID,
        "razorpay_order_id": active_order_id,
        "order_id": str(order.id),
        "order_number": order.order_number,
        "amount": amount_paise,
        "currency": order.currency,
        "name": "Green Village",
        "description": f"Order #{order.order_number}",
        "prefill": {
            "name": order.recipient_name or getattr(user, 'first_name', ''),
            "email": getattr(user, 'email', ''),
            "contact": order.recipient_phone or '',
        },
    }


def verify_razorpay_payment(order_id, user, data):
    """Verify checkout payment credentials and cryptographic signature, then confirm order.
    
    Architecture:
    1. Read and validate order state.
    2. Enforce non-empty provider_order_id and exact match.
    3. Verify cryptographic HMAC signature.
    4. Fetch authoritative payment status from Razorpay OUTSIDE database locks.
    5. Require status == 'captured' (strictly reject 'authorized' or other statuses).
    6. Exact Decimal amount and currency validation.
    7. Open short transaction.atomic(), select_for_update(), revalidate, and persist.
    """
    order = Order.objects.select_related('payment').filter(id=order_id).first()
    if not order or order.customer_id != user.pk:
        raise Order.DoesNotExist

    payment = order.payment

    # Idempotent: already confirmed payments return success immediately
    if payment.status == PaymentStatus.PAID:
        return {"status": "already_paid", "order_id": str(order.id)}

    if order.payment_method != PaymentMethod.ONLINE:
        raise error('payment_method', 'This order is not configured for online payment.')

    if order.status == OrderStatus.CANCELLED:
        raise error('order', 'Cancelled orders cannot be verified.')

    razorpay_order_id = str(data.get('razorpay_order_id') or '').strip()
    razorpay_payment_id = str(data.get('razorpay_payment_id') or '').strip()
    razorpay_signature = str(data.get('razorpay_signature') or '').strip()

    if not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        raise error('data', 'Missing required Razorpay payment verification parameters.')

    # Reject verification if payment session was never initiated or IDs mismatch
    if not payment.provider_order_id:
        raise error('order_id', 'Payment session has not been initiated for this order.')
    if payment.provider_order_id != razorpay_order_id:
        raise error('order_id', 'Razorpay order ID mismatch.')

    # Verify cryptographic signature
    if not razorpay_client.verify_payment_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
        raise error('signature', 'Invalid payment signature.')

    # Outbound API call: fetch authoritative payment details OUTSIDE DB locks
    rzp_payment = razorpay_client.fetch_payment(razorpay_payment_id)

    # Validate payment identity and order association
    if rzp_payment.get('order_id') != razorpay_order_id:
        raise error('payment', 'Payment does not belong to the expected Razorpay order.')

    # Require strictly captured payments
    if rzp_payment.get('status') != 'captured':
        raise error('payment', f"Payment is not captured (current status: {rzp_payment.get('status')}).")

    # Exact Decimal conversion to paise
    expected_paise = int(Decimal(str(order.total_amount)) * 100)
    try:
        actual_paise = int(rzp_payment.get('amount', 0))
    except (ValueError, TypeError):
        raise error('amount', 'Invalid amount received from payment gateway.')

    if actual_paise != expected_paise:
        raise error('amount', f"Payment amount mismatch: expected {expected_paise}, got {actual_paise}.")

    if str(rzp_payment.get('currency', '')).strip().upper() != order.currency.strip().upper():
        raise error('currency', f"Payment currency mismatch: expected {order.currency}, got {rzp_payment.get('currency')}.")

    # Short atomic transaction to acquire lock and persist verified payment
    with transaction.atomic():
        locked_order = _lock_order(order_id)
        if locked_order.customer_id != user.pk:
            raise Order.DoesNotExist
        locked_payment = Payment.objects.select_for_update().get(order=locked_order)

        if locked_payment.status == PaymentStatus.PAID:
            return {"status": "already_paid", "order_id": str(locked_order.id)}

        if locked_order.status == OrderStatus.CANCELLED:
            # Late payment verified after cancellation
            locked_payment.provider = 'razorpay'
            locked_payment.status = PaymentStatus.REFUND_PENDING
            locked_payment.provider_payment_id = razorpay_payment_id
            locked_payment.save(update_fields=['provider', 'status', 'provider_payment_id', 'updated_at'])
            _record(
                locked_order,
                OrderStatus.CANCELLED,
                OrderStatus.CANCELLED,
                actor=user,
                note=f"Late Razorpay payment verified after cancellation. Flagged for refund. payment_id={razorpay_payment_id}".strip(),
            )
            return {"status": "cancelled_refund_pending", "order_id": str(locked_order.id)}

        if not locked_payment.provider_order_id or locked_payment.provider_order_id != razorpay_order_id:
            raise error('order_id', 'Razorpay order ID mismatch.')

        if locked_payment.provider_payment_id and locked_payment.provider_payment_id != razorpay_payment_id:
            raise error('payment_id', 'Payment ID mismatch with existing payment session.')

        locked_payment.provider = 'razorpay'
        locked_payment.provider_order_id = razorpay_order_id
        locked_payment.provider_payment_id = razorpay_payment_id
        locked_payment.status = PaymentStatus.PAID
        locked_payment.paid_at = timezone.now()
        locked_payment.save(update_fields=['provider', 'provider_order_id', 'provider_payment_id', 'status', 'paid_at', 'updated_at'])

        if locked_order.status == OrderStatus.PENDING:
            locked_order.status = OrderStatus.CONFIRMED
            locked_order.save(update_fields=['status', 'updated_at'])
            _record(locked_order, OrderStatus.PENDING, OrderStatus.CONFIRMED, actor=user, note=f"Razorpay payment verified: {razorpay_payment_id}")

    return {"status": "success", "order_id": str(order.id)}


@transaction.atomic
def process_razorpay_webhook(raw_body: bytes, headers: dict) -> tuple[bool, str]:
    """Process incoming Razorpay server-to-server webhook with signature validation, safe JSON parsing, and deduplication."""
    sig = (
        headers.get('HTTP_X_RAZORPAY_SIGNATURE')
        or headers.get('X_RAZORPAY_SIGNATURE')
        or headers.get('X-Razorpay-Signature')
        or ''
    )

    if not razorpay_client.verify_webhook_signature(raw_body, sig):
        logger.warning("Razorpay webhook signature verification failed.")
        return False, "Invalid signature"

    try:
        payload = json.loads(raw_body.decode('utf-8'))
    except Exception as exc:
        logger.error("Razorpay webhook JSON parse error: %s", exc)
        return False, "Malformed JSON payload"

    if not isinstance(payload, dict):
        return False, "Invalid payload structure: root must be a JSON object"

    event = str(payload.get('event') or '').strip().lower()
    if not event:
        return False, "Missing event in webhook payload"

    ALLOWED_EVENTS = ('payment.captured', 'order.paid', 'payment.failed')
    if event not in ALLOWED_EVENTS:
        return True, f"Ignored unsupported event '{event}'"

    # Safely navigate nested payload structures without throwing AttributeError
    payload_container = payload.get('payload')
    if not isinstance(payload_container, dict):
        return False, "Invalid or missing payload container in webhook"

    payment_obj = payload_container.get('payment')
    payment_entity = payment_obj.get('entity') if isinstance(payment_obj, dict) and isinstance(payment_obj.get('entity'), dict) else {}

    order_obj = payload_container.get('order')
    order_entity = order_obj.get('entity') if isinstance(order_obj, dict) and isinstance(order_obj.get('entity'), dict) else {}

    delivery_id = str(
        headers.get('HTTP_X_RAZORPAY_EVENT_ID')
        or headers.get('X_RAZORPAY_EVENT_ID')
        or headers.get('X-Razorpay-Event-Id')
        or payload.get('id')
        or ''
    ).strip()

    if delivery_id and WebhookDelivery.objects.filter(delivery_id=delivery_id).exists():
        logger.info("Ignoring duplicate webhook delivery %s", delivery_id)
        return True, f"Delivery {delivery_id} already processed"

    rzp_order_id = str(payment_entity.get('order_id') or order_entity.get('id') or '').strip()
    payment_id = str(payment_entity.get('id') or '').strip()

    if not rzp_order_id and not payment_id:
        return False, "Missing order_id and payment_id in webhook payload"

    payment = None
    if rzp_order_id:
        payment = Payment.objects.select_for_update().filter(provider_order_id=rzp_order_id).first()
    if not payment and payment_id:
        payment = Payment.objects.select_for_update().filter(provider_payment_id=payment_id).first()

    if not payment:
        order_ref = payment_entity.get('notes', {}).get('order_number') if isinstance(payment_entity.get('notes'), dict) else None
        if not order_ref:
            order_ref = order_entity.get('receipt')
        if order_ref:
            order_cand = Order.objects.filter(order_number=order_ref).first()
            if order_cand:
                payment = Payment.objects.select_for_update().get(order=order_cand)

    if not payment:
        logger.warning("Razorpay webhook: Payment not found for rzp_order_id=%s, payment_id=%s", rzp_order_id, payment_id)
        return False, f"Order not found for Razorpay order {rzp_order_id}"

    order = Order.objects.select_for_update().get(pk=payment.order_id)

    # 1. Non-online order guard: never mark COD orders paid
    if order.payment_method != PaymentMethod.ONLINE:
        logger.warning("Rejecting Razorpay webhook for non-online order %s (method=%s)", order.order_number, order.payment_method)
        return False, f"Cannot process payment webhook for non-online order (method={order.payment_method})"

    # 2. Enforce exact session association: reject order ID mismatch
    if payment.provider_order_id and rzp_order_id and payment.provider_order_id != rzp_order_id:
        logger.warning("Rejecting Razorpay webhook for order %s: provider_order_id mismatch (stored=%s, webhook=%s)", order.order_number, payment.provider_order_id, rzp_order_id)
        return False, "Razorpay order ID mismatch"

    # Record delivery record for idempotency
    if delivery_id:
        WebhookDelivery.objects.get_or_create(
            delivery_id=delivery_id,
            defaults={
                'provider': 'razorpay',
                'event': event,
                'order': order,
            }
        )

    # 3. Handle successful payment
    if event in ('payment.captured', 'order.paid'):
        if payment.status == PaymentStatus.PAID:
            logger.info("Razorpay webhook: order %s already marked PAID", order.order_number)
            return True, "Payment already marked as PAID"

        # Exact Decimal amount validation in paise
        amount_raw = payment_entity.get('amount') if payment_entity.get('amount') is not None else order_entity.get('amount_paid') if order_entity.get('amount_paid') is not None else order_entity.get('amount')
        if amount_raw is None:
            return False, "Missing amount in webhook payload"
        try:
            amount_paise = int(amount_raw)
        except (ValueError, TypeError):
            return False, "Malformed amount in webhook payload"

        expected_paise = int(Decimal(str(order.total_amount)) * 100)
        if amount_paise != expected_paise:
            logger.warning("Razorpay webhook amount mismatch for order %s: expected %s, got %s", order.order_number, expected_paise, amount_paise)
            return False, f"Amount mismatch: expected {expected_paise}, got {amount_paise}"

        # Currency validation against stored Payment record
        currency = payment_entity.get('currency') or order_entity.get('currency')
        if not currency:
            return False, "Missing currency in webhook payload"
        if str(currency).strip().upper() != payment.currency.strip().upper():
            logger.warning("Razorpay webhook currency mismatch for order %s: expected %s, got %s", order.order_number, payment.currency, currency)
            return False, f"Currency mismatch: expected {payment.currency}, got {currency}"

        # Late payment received after order cancellation (idempotent refund-pending)
        if order.status == OrderStatus.CANCELLED:
            if payment.status == PaymentStatus.REFUND_PENDING:
                logger.info("Razorpay webhook: order %s already marked refund pending", order.order_number)
                return True, "Payment already marked as refund pending"

            payment.provider = 'razorpay'
            payment.status = PaymentStatus.REFUND_PENDING
            if payment_id:
                payment.provider_payment_id = payment_id
            payment.save(update_fields=['provider', 'status', 'provider_payment_id', 'updated_at'])
            _record(
                order,
                OrderStatus.CANCELLED,
                OrderStatus.CANCELLED,
                actor=None,
                note=f"Late Razorpay payment ({event}) received after cancellation. Flagged for refund. payment_id={payment_id}".strip(),
            )
            return True, "Late payment recorded as refund pending"

        # Confirm payment and order
        payment.provider = 'razorpay'
        payment.status = PaymentStatus.PAID
        payment.paid_at = timezone.now()
        if payment_id:
            payment.provider_payment_id = payment_id
        if rzp_order_id and not payment.provider_order_id:
            payment.provider_order_id = rzp_order_id
        payment.save(update_fields=['provider', 'status', 'paid_at', 'provider_payment_id', 'provider_order_id', 'updated_at'])

        if order.status == OrderStatus.PENDING:
            order.status = OrderStatus.CONFIRMED
            order.save(update_fields=['status', 'updated_at'])
            _record(
                order,
                OrderStatus.PENDING,
                OrderStatus.CONFIRMED,
                actor=None,
                note=f"Razorpay webhook payment confirmed ({event}) payment_id={payment_id}".strip(),
            )

        return True, f"Payment confirmed for order {order.order_number}"

    # 4. Handle payment failure (protect terminal and refund states)
    elif event == 'payment.failed':
        PROTECTED_STATES = (PaymentStatus.PAID, PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED)
        if payment.status in PROTECTED_STATES:
            logger.info("Ignoring payment.failed for order %s because payment is in protected status %s", order.order_number, payment.status)
            return True, f"Ignored failed event for payment in {payment.status} status"

        reason = str(payment_entity.get('error_code') or payment_entity.get('error_description') or 'payment_failed')[:20]
        payment.failure_reason = reason
        payment.status = PaymentStatus.FAILED
        payment.save(update_fields=['status', 'failure_reason', 'updated_at'])
        _record(order, order.status, order.status, actor=None, note=f"Razorpay payment failed: {reason}".strip())
        return True, f"Recorded payment failure for order {order.order_number}"

    return True, f"Processed event {event}"
