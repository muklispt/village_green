"""Discount calculation engine (Phase 3). Calculation only.

Nothing here writes to the database. It does not reserve or redeem coupons, and it
does not change any counter. Reservation stays in marketing.services.

TRUST MODEL
The client may send only product ids, variant ids and quantities. Prices, stock,
offers, coupon rules and usage counts are always read from the database here.
Extra keys in a line (price, discount, total, ...) are ignored.

ORDER OF OPERATIONS
1. Parse and validate the requested lines (positive whole quantities, no duplicates).
2. Load products and variants and check they can be bought (same rules as the cart).
3. Line total = selling price (never MRP) x quantity.
4. Automatic offers. Each line takes its single best offer (largest raw discount, ties
   to the lowest offer id). Percentage offers take a share of the line; fixed offers
   take discount_value PER UNIT x quantity. Each offer's total over the whole order is
   capped by its maximum_discount, shared across its lines (see allocate_capped).
5. Subtotal after automatic offers.
6. Coupon: at most one, applied to that subtotal (capped by its own maximum and by
   the eligible subtotal). Coupon rules are unchanged from Phase 2/3.
7. discounted_subtotal = subtotal - offer_discount - coupon_discount. This is the
   merchandise subtotal used for the free-shipping threshold (free_shipping_subtotal).
   Shipping is never discounted. Tax is calculated by the existing policy in orders.

ELIGIBILITY BASE
Offer minimums and coupon minimums are checked against the original subtotal (all
lines at selling price, before any discount). This matches the Phase 2 reservation check.

ROUNDING
Decimal everywhere. Every money amount is quantized to 0.01 once, where it is produced:
ROUND_HALF_UP for line and offer amounts (same as the existing tax rounding). Aggregate
cap allocation uses ROUND_DOWN plus largest-remainder cents, so allocations sum exactly
to the cap.
"""
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Optional

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from cart.models import Cart, CartItem
from cart.services import max_item_quantity, max_lines
from orders.models import Order, OrderStatus
from product.models import Product, ProductVariant

from .models import (ApplicableType, Coupon, CouponUsage, CouponUsageStatus, DiscountType,
                     Offer)
from .validators import normalize_coupon_code

MONEY = Decimal('0.01')
HUNDRED = Decimal('100')
ZERO = Decimal('0.00')


class OfferConfigurationError(Exception):
    """A stored offer cannot be priced safely. This is a configuration problem, not a
    customer error, so it is not a ValidationError."""


def money(value):
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ result types

@dataclass
class PricedLine:
    product_id: uuid.UUID
    variant_id: Optional[uuid.UUID]
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    offer_id: Optional[uuid.UUID] = None
    offer_discount: Decimal = ZERO

    @property
    def discounted_total(self):
        return self.line_total - self.offer_discount


@dataclass
class AppliedOffer:
    offer_id: uuid.UUID
    offer_name: str
    discount_amount: Decimal


@dataclass
class DiscountBreakdown:
    subtotal: Decimal
    offer_discount: Decimal
    coupon_discount: Decimal
    discount_amount: Decimal
    discounted_subtotal: Decimal
    coupon_code: Optional[str]
    applied_offers: list = field(default_factory=list)
    lines: list = field(default_factory=list)

    @property
    def free_shipping_subtotal(self):
        """Merchandise subtotal to compare with ORDER_FREE_SHIPPING_THRESHOLD.

        Decision B: this is the discounted merchandise subtotal, after automatic offers
        and the coupon. It is the same value as discounted_subtotal, not a second
        calculation. Shipping itself is never discounted.
        """
        return self.discounted_subtotal

    @property
    def taxable_subtotal(self):
        """Base for tax. Same value as discounted_subtotal; tax policy stays in orders."""
        return self.discounted_subtotal

    def to_dict(self):
        """JSON-ready form. Money is a decimal string. No customer or usage data."""
        return {
            'subtotal': str(self.subtotal),
            'offer_discount': str(self.offer_discount),
            'coupon_discount': str(self.coupon_discount),
            'discount_amount': str(self.discount_amount),
            'discounted_subtotal': str(self.discounted_subtotal),
            'free_shipping_subtotal': str(self.free_shipping_subtotal),
            'taxable_subtotal': str(self.taxable_subtotal),
            'coupon_code': self.coupon_code,
            'applied_offers': [
                {
                    'offer_id': str(item.offer_id),
                    'offer_name': item.offer_name,
                    'discount_amount': str(item.discount_amount),
                }
                for item in self.applied_offers
            ],
            'lines': [
                {
                    'product_id': str(line.product_id),
                    'variant_id': str(line.variant_id) if line.variant_id else None,
                    'product_name': line.product_name,
                    'quantity': line.quantity,
                    'unit_price': str(line.unit_price),
                    'line_total': str(line.line_total),
                    'offer_id': str(line.offer_id) if line.offer_id else None,
                    'offer_discount': str(line.offer_discount),
                    'discounted_total': str(line.discounted_total),
                }
                for line in self.lines
            ],
        }


# ------------------------------------------------------------------ input

def parse_requested_lines(raw_items):
    """Validate client-supplied lines. Only product_id, variant_id and quantity are read."""
    if not isinstance(raw_items, (list, tuple)) or not raw_items:
        raise ValidationError({'items': ['Your cart is empty.']})
    if len(raw_items) > max_lines():
        raise ValidationError({'items': [f'At most {max_lines()} different items per order.']})

    max_qty = max_item_quantity()
    seen = set()
    parsed = []
    for entry in raw_items:
        if not isinstance(entry, dict):
            raise ValidationError({'items': ['Each item must be an object.']})
        try:
            product_id = uuid.UUID(str(entry.get('product_id')))
            raw_variant = entry.get('variant_id')
            variant_id = None if raw_variant in (None, '') else uuid.UUID(str(raw_variant))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError({'items': ['Invalid product or size id.']})

        quantity = entry.get('quantity')
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= max_qty:
            raise ValidationError({'items': [f'Quantity must be a whole number from 1 to {max_qty}.']})

        key = (product_id, variant_id)
        if key in seen:
            raise ValidationError({'items': ['The same item appears more than once.']})
        seen.add(key)
        parsed.append((product_id, variant_id, quantity))

    return sorted(parsed, key=lambda row: (str(row[0]), str(row[1] or '')))


# ------------------------------------------------------------------ pricing

def load_priced_lines(requested):
    """Load products and variants and price each line from the database.

    Purchasability follows the same rules as the cart (cart.services.line_issue).
    Every problem is reported at once.
    """
    product_ids = {row[0] for row in requested}
    variant_ids = {row[1] for row in requested if row[1] is not None}

    products = {p.pk: p for p in Product.objects.filter(pk__in=product_ids)}
    variants = {v.pk: v for v in ProductVariant.objects.filter(pk__in=variant_ids)}
    products_with_sizes = set(
        ProductVariant.objects.filter(product_id__in=product_ids, is_active=True)
        .values_list('product_id', flat=True)
    )

    problems, lines = [], []
    for product_id, variant_id, quantity in requested:
        product = products.get(product_id)
        variant = variants.get(variant_id) if variant_id else None
        label = product.name if product else 'An item'
        stock = 0
        problem = None

        if product is None or not product.is_active:
            problem = 'is no longer available.'
        elif variant_id is not None:
            if variant is None or not variant.is_active or variant.product_id != product.pk:
                problem = 'is no longer available in this size.'
            else:
                label = f'{product.name} ({variant.quantity.normalize():f} {variant.unit})'
                stock = variant.stock_quantity
        elif product.pk in products_with_sizes:
            problem = 'needs a size selected.'
        else:
            stock = product.stock_quantity

        if problem is None:
            if stock <= 0:
                problem = 'is out of stock.'
            elif quantity > stock:
                problem = f'only {stock} left.'

        if problem:
            problems.append(f'{label}: {problem}')
            continue

        unit_price = money(variant.price if variant else product.price)
        lines.append(PricedLine(
            product_id=product.pk,
            variant_id=variant.pk if variant else None,
            product_name=product.name,
            quantity=quantity,
            unit_price=unit_price,
            line_total=money(unit_price * quantity),
        ))

    if problems:
        raise ValidationError({'items': problems})
    return lines, {p.pk: p.product_category_id for p in products.values()}


# ------------------------------------------------------------------ automatic offers

def _offer_applies_to(offer, line, category_id, offer_product_ids, offer_category_ids):
    if offer.applicable_type == ApplicableType.ALL_PRODUCTS:
        return True
    if offer.applicable_type == ApplicableType.SPECIFIC_PRODUCTS:
        return line.product_id in offer_product_ids
    if offer.applicable_type == ApplicableType.CATEGORIES:
        return category_id in offer_category_ids
    return False


def _line_raw_discount(offer, line):
    """What `offer` would take off this line on its own, before any order-wide cap.

    Percentage: share of the line total.
    Fixed: discount_value PER UNIT, multiplied by the line quantity (all units are eligible).
    Either way it is never more than the line total, and it is always from the selling price.
    """
    if offer.discount_type == DiscountType.PERCENTAGE:
        raw = money(line.line_total * offer.discount_value / HUNDRED)
    else:
        raw = money(offer.discount_value * line.quantity)
    return min(raw, line.line_total)


def allocate_capped(raw_amounts, cap):
    """Share one aggregate cap across several raw line discounts. Pure function.

    Input: raw amounts already at cent precision, in a fixed order, each > 0.
    Output: one allocation per input, same order, with these guarantees:
      - if the total is within the cap, the raw amounts are returned unchanged;
      - otherwise the allocations sum to exactly the cap (no money created or lost);
      - every allocation is at most its raw amount (line never gets more than it asked for).

    Method (largest remainder): each line gets floor(cap * raw / total) to the cent.
    The leftover cents go one at a time to the lines with the largest fractional
    remainder, ties going to the earlier line. Since cap < total, each floor is below
    its raw amount, so adding one cent cannot exceed it.
    """
    total = sum(raw_amounts, ZERO)
    if cap is None or total <= cap:
        return list(raw_amounts)
    cap = money(cap)
    if cap <= 0:
        return [ZERO for _ in raw_amounts]

    exact = [cap * raw / total for raw in raw_amounts]
    floors = [share.quantize(MONEY, rounding=ROUND_DOWN) for share in exact]
    leftover_cents = int((cap - sum(floors, ZERO)) / MONEY)
    by_remainder = sorted(range(len(exact)), key=lambda i: (-(exact[i] - floors[i]), i))

    result = list(floors)
    for index in by_remainder[:leftover_cents]:
        result[index] += MONEY

    # Internal guard. These cannot fail for valid input, but money must never drift.
    if sum(result, ZERO) != cap or any(a > r for a, r in zip(result, raw_amounts)):
        raise OfferConfigurationError('Aggregate offer allocation failed its own checks.')
    return result


def _apply_automatic_offers(lines, category_by_product, subtotal, now):
    """Pick the best offer for each line, then apply each offer's aggregate cap.

    Steps:
    1. Eligible offers: active, in their window, minimum met on the gross subtotal.
    2. Per line: compute every matching offer's raw discount (uncapped). The largest
       raw discount wins; ties go to the lowest offer id. Each line gets one offer.
       Selection uses raw amounts on purpose: the cap depends on which lines an offer
       wins, so using capped amounts here would be circular.
    3. Per offer: its lines' raw discounts are summed and, if the sum exceeds the
       offer's maximum_discount, shared out by allocate_capped(). The cap is shared
       across the whole order, not applied to each line.

    Mutates `lines` (offer_id, offer_discount). Returns the applied offers, one entry
    per offer, sorted by id. Each entry's amount equals the sum of its line allocations.
    """
    offers = list(
        Offer.objects.filter(is_active=True, start_date__lte=now, end_date__gte=now)
        .prefetch_related('offer_products', 'offer_categories')
    )
    offers.sort(key=lambda offer: str(offer.id))
    eligible = [offer for offer in offers if subtotal >= offer.minimum_order_amount]
    names = {offer.id: offer.name for offer in eligible}

    scope = {
        offer.id: (
            {link.product_id for link in offer.offer_products.all()},
            {link.category_id for link in offer.offer_categories.all()},
        )
        for offer in eligible
    }

    # Step 2: choose one offer per line, by raw per-line discount.
    chosen = defaultdict(list)          # offer id -> [(line, raw)], in line order
    for line in lines:                  # lines are already in deterministic order
        category_id = category_by_product[line.product_id]
        candidates = []
        for offer in eligible:
            product_ids, category_ids = scope[offer.id]
            if not _offer_applies_to(offer, line, category_id, product_ids, category_ids):
                continue
            raw = _line_raw_discount(offer, line)
            if raw > 0:
                candidates.append((raw, offer))
        if candidates:
            raw, offer = min(candidates, key=lambda c: (-c[0], str(c[1].id)))
            chosen[offer.id].append((line, raw))

    # Step 3: apply each offer's aggregate cap across its own lines.
    applied = []
    for offer in eligible:
        rows = chosen.get(offer.id)
        if not rows:
            continue
        raws = [raw for _, raw in rows]
        allocations = allocate_capped(raws, offer.maximum_discount)
        for (line, _), amount in zip(rows, allocations):
            if amount > line.line_total:
                raise OfferConfigurationError('An offer discount exceeded its line total.')
            line.offer_id = offer.id
            line.offer_discount = amount
        applied.append(AppliedOffer(
            offer_id=offer.id,
            offer_name=names[offer.id],
            discount_amount=money(sum(allocations, ZERO)),
        ))
    return applied


# ------------------------------------------------------------------ coupon

def _reject(message):
    return ValidationError({'coupon_code': [message]})


def _apply_coupon(coupon_code, customer, order, subtotal, eligible_subtotal, now):
    """Validate a coupon and return (coupon, discount). Writes nothing."""
    code = normalize_coupon_code(coupon_code)
    coupon = Coupon.objects.filter(code=code).first()
    if coupon is None:
        raise _reject('This coupon code is not valid.')

    if not coupon.is_active:
        raise _reject('This coupon is no longer active.')
    if now < coupon.start_date:
        raise _reject('This coupon is not valid yet.')
    if now > coupon.end_date:
        raise _reject('This coupon has expired.')

    if subtotal < coupon.minimum_order_amount:
        raise _reject(f'Order must be at least ₹{coupon.minimum_order_amount} to use this coupon.')

    own = CouponUsage.objects.filter(order=order).first() if order is not None else None
    own_same_coupon_reserved = False
    if own is not None:
        if own.coupon_id != coupon.pk:
            raise _reject('This order already has a different coupon.')
        if own.status == CouponUsageStatus.RELEASED:
            raise _reject('The coupon for this order was already released.')
        own_same_coupon_reserved = True

    if coupon.usage_limit is not None:
        # used_count includes this order's own reservation, so leave it out.
        used = coupon.used_count - (1 if own_same_coupon_reserved else 0)
        if used >= coupon.usage_limit:
            raise _reject('This coupon has reached its usage limit.')

    if coupon.usage_limit_per_customer is not None:
        reserved = CouponUsage.objects.filter(
            coupon=coupon, customer=customer, status=CouponUsageStatus.RESERVED,
        )
        if order is not None:
            reserved = reserved.exclude(order=order)
        if reserved.count() >= coupon.usage_limit_per_customer:
            raise _reject('You have already used this coupon the maximum number of times.')

    if coupon.first_order_only:
        earlier = Order.objects.filter(customer=customer).exclude(status=OrderStatus.CANCELLED)
        if order is not None:
            earlier = earlier.exclude(pk=order.pk)
        if earlier.exists():
            raise _reject('This coupon is only valid on your first order.')

    if eligible_subtotal <= 0:
        raise _reject('No eligible amount is left for this coupon after automatic offers.')

    if coupon.discount_type == DiscountType.PERCENTAGE:
        discount = money(eligible_subtotal * coupon.discount_value / HUNDRED)
        if coupon.maximum_discount is not None:
            discount = min(discount, coupon.maximum_discount)
    else:
        discount = money(coupon.discount_value)
    discount = min(discount, eligible_subtotal)

    if discount <= 0:
        raise _reject('This coupon does not reduce your order.')
    return coupon, discount


# ------------------------------------------------------------------ entry points

def calculate_discounts(*, customer, items, coupon_code=None, order=None, now=None):
    """Price `items` for `customer` and apply automatic offers and at most one coupon.

    items: iterable of dicts with product_id, variant_id (optional) and quantity.
    order: optional existing Order. Its own reservation is not counted against limits
           and it is not counted as a previous order for first-order coupons.

    Performs no writes. Raises ValidationError for customer errors and
    OfferConfigurationError for stored offers that cannot be priced.
    """
    if order is not None and order.customer_id != customer.pk:
        raise ValidationError({'order': ['This order does not belong to you.']})

    now = now or timezone.now()
    requested = parse_requested_lines(list(items))
    lines, category_by_product = load_priced_lines(requested)

    subtotal = money(sum((line.line_total for line in lines), ZERO))
    applied_offers = _apply_automatic_offers(lines, category_by_product, subtotal, now)
    offer_discount = money(sum((line.offer_discount for line in lines), ZERO))
    eligible_subtotal = subtotal - offer_discount

    coupon = None
    coupon_discount = ZERO
    if normalize_coupon_code(coupon_code):
        coupon, coupon_discount = _apply_coupon(
            coupon_code, customer, order, subtotal, eligible_subtotal, now,
        )

    discount_amount = offer_discount + coupon_discount
    discounted = subtotal - discount_amount
    if discounted < 0 or coupon_discount > eligible_subtotal:   # cannot happen; guard anyway
        raise OfferConfigurationError('Discount calculation produced an invalid total.')

    return DiscountBreakdown(
        subtotal=subtotal,
        offer_discount=offer_discount,
        coupon_discount=coupon_discount,
        discount_amount=discount_amount,
        discounted_subtotal=discounted,
        coupon_code=coupon.code if coupon else None,
        applied_offers=applied_offers,
        lines=lines,
    )


def calculate_cart_discounts(user, coupon_code=None, order=None, now=None):
    """Price the user's saved cart. Only product and variant ids and quantities are read."""
    cart = Cart.objects.filter(user=user).first()
    items = []
    if cart is not None:
        items = list(
            CartItem.objects.filter(cart=cart)
            .values('product_id', 'variant_id', 'quantity')
        )
    return calculate_discounts(
        customer=user, items=items, coupon_code=coupon_code, order=order, now=now,
    )