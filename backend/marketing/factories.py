"""Test helpers for the marketing app (not a test module)."""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from orders.factories import make_user  # noqa: F401  (re-exported for tests)
from orders.models import Order, OrderStatus, PaymentMethod


def now():
    return timezone.now()


def make_order(customer, subtotal='500.00', status=OrderStatus.PENDING, **extra):
    """Create an Order row directly. Checkout is not involved."""
    subtotal = Decimal(subtotal)
    values = dict(
        order_number='GV' + uuid.uuid4().hex[:8].upper(),
        customer=customer,
        status=status,
        payment_method=PaymentMethod.COD,
        subtotal=subtotal,
        discount_amount=Decimal('0.00'),
        shipping_fee=Decimal('0.00'),
        tax_amount=Decimal('0.00'),
        total_amount=subtotal,
        recipient_name='Asha Nair',
        recipient_phone='+919876543210',
        shipping_address='12 Garden Road',
        shipping_city='Kozhikode',
        shipping_pincode='673001',
    )
    values.update(extra)
    return Order.objects.create(**values)


def window(days_before=1, days_after=30):
    """(start, end) around now."""
    current = now()
    return current - timedelta(days=days_before), current + timedelta(days=days_after)


def make_offer(name='Offer', **extra):
    """Active percentage store-wide offer by default. Use extra to change any field."""
    from .models import ApplicableType, DiscountType, Offer

    start, end = window()
    values = dict(
        name=name,
        discount_type=DiscountType.PERCENTAGE,
        discount_value=Decimal('10.00'),
        applicable_type=ApplicableType.ALL_PRODUCTS,
        start_date=start,
        end_date=end,
    )
    values.update(extra)
    return Offer.objects.create(**values)


def make_coupon(code='SAVE10', **extra):
    """Active percentage 10% coupon by default. Use extra to change any field."""
    from .models import Coupon, DiscountType

    start, end = window()
    values = dict(
        code=code,
        discount_type=DiscountType.PERCENTAGE,
        discount_value=Decimal('10.00'),
        start_date=start,
        end_date=end,
    )
    values.update(extra)
    return Coupon.objects.create(**values)