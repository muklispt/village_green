"""Test helpers for the marketing app (not a test module)."""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from orders.factories import make_user
from orders.models import Order,OrderStatus, PaymentMethod


def now():
    return timezone.now()


def make_order(customer,subtotal='500.00',status=OrderStatus.PENDING,**extra):
     """Create an Order row directly. Checkout is not involved."""
     subtotal = Decimal(subtotal)
     values = dict(
          order_number='GV'+ uuid.uuid4().hex[:8].upper(),
          customer = customer,
          status=status,
          payment_method = PaymentMethod.COD,
          subtotal = subtotal,
          discount_amount = Decimal('0.00'),
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


def window(days_before=1,days_after=30):
     """(start,end) around now."""
     current = now()
     return current - timedelta(days=days_before), current + timedelta(days=days_after)