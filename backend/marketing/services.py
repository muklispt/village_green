"""Coupon reservations. Phase 2: model-level operations only, not yet called by checkout.

LOCK ORDER (prevents deadlocks): cart -> coupon -> coupon usage -> order.
Callers that already hold the order row (cancellation, expiry) take the coupon lock
after it. Nothing here locks a coupon and then waits on an order row.

Rules enforced under the coupon row lock:
- A coupon is reserved at most once per order. A repeat call for the same order
  returns the existing reservation and does not count it again.
- A released reservation is never reused. Placing a new order gives a new order row.
- used_count (global) and the per-customer count are checked and updated while the
  coupon row is locked, so parallel requests cannot exceed a limit.
- Releasing is idempotent: only the first call changes state and decrements used_count.
- Released rows are kept for audit and are never deleted.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from orders.models import Order, OrderStatus

from .models import Coupon, CouponUsage, CouponUsageStatus

MONEY = Decimal('0.01')


def _reject(message):
    return ValidationError({'coupon_code': [message]})


def _check_redemption(coupon, order, discount_amount, now):
    """All rule checks for a new reservation. Runs while the coupon row is locked."""
    if not coupon.is_within_window(now):
        if not coupon.is_active:
            raise _reject('This coupon is no longer active.')
        if now < coupon.start_date:
            raise _reject('This coupon is not valid yet.')
        raise _reject('This coupon has expired.')

    subtotal = Decimal(order.subtotal)
    if subtotal < coupon.minimum_order_amount:
        raise _reject(f'Order must be at least ₹{coupon.minimum_order_amount} to use this coupon.')

    if discount_amount <= 0:
        raise ValidationError({'discount_amount': ['Discount must be greater than zero.']})
    if discount_amount > subtotal:
        raise ValidationError({'discount_amount': ['Discount cannot exceed the order subtotal.']})
    if coupon.maximum_discount is not None and discount_amount > coupon.maximum_discount:
        raise ValidationError({'discount_amount': ['Discount is above the coupon maximum.']})

    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise _reject('This coupon has reached its usage limit.')

    if coupon.usage_limit_per_customer is not None:
        used_by_customer = CouponUsage.objects.filter(
            coupon=coupon, customer=order.customer, status=CouponUsageStatus.RESERVED,
        ).count()
        if used_by_customer >= coupon.usage_limit_per_customer:
            raise _reject('You have already used this coupon the maximum number of times.')

    if coupon.first_order_only:
        earlier = (Order.objects
                   .filter(customer=order.customer)
                   .exclude(pk=order.pk)
                   .exclude(status=OrderStatus.CANCELLED)
                   .exists())
        if earlier:
            raise _reject('This coupon is only valid on your first order.')


@transaction.atomic
def reserve_coupon_usage(order, coupon, discount_amount):
    """Reserve `coupon` for `order`. Returns the CouponUsage row.

    Idempotent for the same order and coupon. Raises ValidationError if a rule fails.
    `discount_amount` must come from the server-side discount engine. It is never
    taken from the client.
    """
    discount_amount = Decimal(discount_amount).quantize(MONEY)
    now = timezone.now()

    locked = Coupon.objects.select_for_update().get(pk=coupon.pk)
    existing = CouponUsage.objects.select_for_update().filter(order=order).first()

    if existing is not None:
        if existing.coupon_id == locked.pk and existing.status == CouponUsageStatus.RESERVED:
            return existing           # retry: reuse the reservation, count nothing new
        if existing.coupon_id == locked.pk:
            raise _reject('The coupon reservation for this order was already released.')
        raise _reject('This order already has a different coupon reservation.')

    _check_redemption(locked, order, discount_amount, now)

    usage = CouponUsage.objects.create(
        coupon=locked,
        customer=order.customer,
        order=order,
        discount_amount=discount_amount,
        status=CouponUsageStatus.RESERVED,
    )
    Coupon.objects.filter(pk=locked.pk).update(used_count=F('used_count') + 1)
    return usage


@transaction.atomic
def release_coupon_usage(order, reason):
    """Release the reservation for `order`, if it is still reserved.

    Returns True if this call released it, and False if there was nothing to release
    or it was already released. Only the first call decrements used_count.
    """
    reason = (reason or 'released')[:30]
    peek = CouponUsage.objects.filter(order=order).values_list('coupon_id', flat=True).first()
    if peek is None:
        return False

    Coupon.objects.select_for_update().get(pk=peek)              # coupon first, then usage
    usage = CouponUsage.objects.select_for_update().get(order=order)
    if usage.status != CouponUsageStatus.RESERVED:
        return False

    usage.status = CouponUsageStatus.RELEASED
    usage.release_reason = reason
    usage.released_at = timezone.now()
    usage.save(update_fields=['status', 'release_reason', 'released_at', 'updated_at'])
    # The database CHECK (used_count >= 0) stops a double decrement from going negative.
    Coupon.objects.filter(pk=peek).update(used_count=F('used_count') - 1)
    return True