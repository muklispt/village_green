"""Cart business rules. Views stay thin and call these functions.

Prices and stock always come from the database, never from the request.
"""

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework.exceptions import NotFound , ValidationError

from product.models import Product, ProductImage , ProductVariant

from .models import Cart,CartItem

MONEY = Decimal('0.01')

ISSUE_MESSAGES = {
    'no_longer_available':'This item is no longer available.',
    'out_of_stock':'This item is out of stock.',
    'insufficient_stock':'Not enough stock for the quantity in your cart.',
    'variant_required':'Please choose a size for this item.',
}

def max_item_quantity():
    return getattr(settings,'CART_MAX_ITEM_QUANTITY',99)

def max_lines():
    return getattr(settings,'CART_MAX_LINES',50)

# --------------- reading ----------------

def fetch_cart(user):
    """Cart with everything the response needs in a constant number of queries."""
    return (
        Cart.objects.filter(user=user)
        .prefetch_related(
            Prefetch(
                'items',
                queryset=CartItem.objects.select_related('product','variant').order_by('added_at'),
            ),
            Prefetch(
                'items__product__images',
                queryset=ProductImage.objects.filter(is_primary=True),
                to_attr='primary_images',
            ),
            Prefetch(
                'items__product__variants',
                queryset=ProductVariant.objects.filter(is_active=True),
                to_attr='active_variants',
            ),
        ).first()

    )

def unit_price(item):
    return item.variant.price if item.variant_id else item.product.price

def available_stock(item):
    return item.variant.stock_quantity if item.variant_id else item.product.stock_quantity

def line_issue(item):
    """Why this line cannot be bought right now, or None when it can."""
    product, variant = item.product,item.variant
    if not product.is_active or (variant is not None and not variant.is_active):
        return 'no_longer_available'
    if variant is None and getattr(product,'active_variants',None):
        return 'variant_required'
    stock = available_stock(item)
    if stock <=0:
        return 'out_of_stock'
    if item.quantity > stock:
        return 'insufficient_stock'
    return None

def line_total(item):
    return (unit_price(item)* item.quantity).quantize(MONEY)

# ---------- writing ----------

def _touch(cart):
    Cart.objects.filter(pk=cart.pk).update(updated_at=timezone.now())



def _locked_cart(user):
    """Get or create the user's cart and lock it, so one user's concurrent
   changes run one after another."""
    cart,_ = Cart.objects.get_or_create(user=user)
    return Cart.objects.select_for_update().get(pk=cart.pk)


def _resolve(product_id,variant_id):
    """Return (product,variant) if purchasable, otherwise raise a field error.

    A missing and an inactive product give the same answer so the cart does not
    reveal hidden catalog items.
    """
    product = Product.objects.filter(pk=product_id,is_active=True).first()
    if product is None:
        raise ValidationError({'product':['Product not found.']})

    if variant_id is not None:
        variant = ProductVariant.objects.filter(
            pk=variant_id,product=product, is_active=True
        ).first()
        if variant is None:
            raise ValidationError({'variant':['This size is not available for the product.']})
        return product, variant

    if product.variants.filter(is_active=True).exists():
        raise ValidationError({'variant':['Please choose a size for this item.']})

    return product, None


def _check_quantity(new_quantity,stock,already_in_cart):
    if new_quantity > max_item_quantity():
        raise ValidationError(
            {'quantity':[f'You can order at most {max_item_quantity()} of one item.']}

        )
    if stock <=0:
        raise ValidationError({"quantity":['This item is out of stock.']})
    if new_quantity > stock:
        if already_in_cart:
            message = f'Only {stock} available. You already have {already_in_cart} in your cart.'
        else:
            message = f'Only {stock} available.'
        raise ValidationError({'quantity':[message]})


@transaction.atomic
def add_item(user,product_id,variant_id,quantity):
    """Add to the cart, or raise the quantity of the same line.

    Returns True when a new line was created, False when an existing line grew.
    """
    cart = _locked_cart(user)
    product , variant = _resolve(product_id,variant_id)
    stock = variant.stock_quantity if variant else product.stock_quantity

    item = CartItem.objects.filter(cart=cart,product=product,variant=variant).first()
    current = item.quantity if item else 0
    _check_quantity(current+quantity,stock,current)

    if item:
        CartItem.objects.filter(pk=item.pk).update(quantity=current+quantity)
        created = False
    else :
         if CartItem.objects.filter(cart=cart).count() >= max_lines():
             raise ValidationError(
                 {'cart':[f'Your cart can hold at most {max_lines()} diffrent itmes.']}
             )
         CartItem.objects.create(cart=cart,product=product,variant=variant,quantity=quantity)
         created = True

    _touch(cart)
    return created



@transaction.atomic
def set_quantity(user,item_id,quantity):
    cart = _locked_cart(user)
    item = (
        CartItem.objects.select_related('product','variant')
        .filter(cart=cart,pk=item_id)
        .first()
    )
    if item is None:
        raise NotFound('Cart item not found.')

    if not item.product.is_active or (item.variant is not None and not item.variant.is_active):
        raise ValidationError(
            {'detail':'This item is no longer available. Remove it from your cart.'}
        )

    stock = item.variant.stock_quantity if item.variant else item.product.stock_quantity
    _check_quantity(quantity,stock,0)

    CartItem.objects.filter(pk=item.pk).update(quantity=quantity)
    _touch(cart)


@transaction.atomic
def remove_item(user,item_id):
    deleted, _ = CartItem.objects.filter(cart__user=user,pk=item_id).delete()
    if not deleted:
        raise NotFound('Cart item not found.')
    Cart.objects.filter(user=user).update(updated_at=timezone.now())


@transaction.atomic
def clear_cart(user):
    CartItem.objects.filter(cart__user=user).delete()
    Cart.objects.filter(user=user).update(updated_at=timezone.now())


    