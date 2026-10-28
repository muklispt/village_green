from django.db import models

# Create your models here.
import uuid

from django.conf import settings
from django.db.models import Q


class OrderStatus(models.TextChoices):
    PENDING = 'pending','Pending'
    CONFIRMED = 'confirmed','Confirmed'
    PROCESSING = 'processing','Processing'
    SHIPPED = 'shipped','Shipped'
    DELIVERED = 'delivered','Delivered'
    CANCELLED = 'cancelled','Cancelled'



class PaymentMethod(models.TextChoices):
    COD = 'cod','Cash on delivery'
    ONLINE = 'online','Online payment'


class PaymentStatus(models.TextChoices):
    PENDING = 'pending','Pending'
    PAID = 'paid','Paid'
    FAILED = 'failed','Failed'
    CANCELLED = 'cancelled','Cancelled'
    REFUND_PENDING = 'refund_pending','Refund_pending'
    REFUNDED = 'refunded','Refunded'


class Order(models.Model):
    """A placed order. Money fields are snapshots: later price changes never touch them."""

    id = models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    order_number = models.CharField(max_length=20,unique=True,editable=False)
    # PROTECT: a customer with orders cannot be deleted by accident.
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,related_name='orders'

    )

    status = models.CharField(
        max_length=20,choices=OrderStatus.choices, default=OrderStatus.PENDING
    )
    payment_method = models.CharField(max_length=10,choices=PaymentMethod.choices)
    currency = models.CharField(max_length=3,default='INR')

    subtotal = models.DecimalField(max_digits=12,decimal_places=2)
    discount_amount = models.DecimalField(max_digits=12,decimal_places=2,default=0)
    shipping_fee = models.DecimalField(max_digits=12,decimal_places=2,default=0)
    tax_amount = models.DecimalField(max_digits=12,decimal_places=2,default=0)
    total_amount = models.DecimalField(max_digits=12,decimal_places=2)

    recipient_name = models.CharField(max_length=120)
    recipient_phone = models.CharField(max_length=17)
    shipping_address = models.TextField()
    shipping_city = models.CharField(max_length=100)
    shipping_pincode = models.CharField(max_length=10)


    # True while this order's stock is deducted. Makes restock exactly-once.
    stock_deducted = models.BooleanField(default=False)
    # Client-chosen retry key. Repeating a checkout with it returns the first order.
    idempotency_key = models.CharField(max_length=64,null=True,blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'orders'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['customer','-created_at']),
            models.Index(fields=['status','created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['customer','idempotency_key'],
                condition=Q(idempotency_key__isnull=False),
                name='unique_order_idempotency_key_per_customer',
            ),
            models.CheckConstraint(
                condition=Q(subtotal__gte=0) & Q(discount_amount__gte=0)
                & Q(shipping_fee__gte=0) & Q(tax_amount__gte=0) & Q(total_amount__gte=0),
                name='order_amounts_not_negative',
            ),
        ]

    def __str__(self):
        return self.order_number

class OrderItem(models.Model):
    id = models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    order = models.ForeignKey(
        Order,on_delete=models.CASCADE,related_name='items'
    )
    # SET_NULL: deleting a product keeps the order line (with its snapshot).
    product = models.ForeignKey(
        'product.Product',on_delete=models.SET_NULL,null=True,blank=True,
        related_name='order_items',
    )
    variant = models.ForeignKey(
        'product.ProductVariant',on_delete=models.SET_NULL,null=True,blank=True,
        related_name='order_items',
    )
    product_name = models.CharField(max_length=225)
    variant_sku = models.CharField(max_length=100,blank=True)
    variant_label = models.CharField(max_length=60,blank=True)
    unit_price = models.DecimalField(max_digits=12,decimal_places=2)
    quantity = models.PositiveIntegerField()
    line_total = models.DecimalField(max_digits=12,decimal_places=2)

    class Meta:
        db_table = 'order_item'
        ordering = ['product_name','variant_label']
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gte=1), name='order_item_quantity_at_least_one'
            ),
            models.CheckConstraint(
                condition=Q(unit_price__gte=0) & Q(line_total__gte=0),
                name='order_item_amounts_not_negative',
            ),
        ]

    def __str__(self):
        return f'{self.quantity} x {self.product_name}'



class Payment(models.Model):
    """One payment per order. Retrying an online payment reuses this row.
    Never store card numbers, CVV or other credentials here."""

    id = models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    order = models.OneToOneField(Order, on_delete=models.CASCADE,related_name='payment')
    method = models.CharField(max_length=10,choices=PaymentMethod.choices)
    provider = models.CharField(max_length=30,blank=True)
    amount = models.DecimalField(max_digits=12,decimal_places=2)
    currency = models.CharField(max_length=3,default='INR')
    status = models.CharField(
        max_length=20,choices=PaymentStatus.choices,default=PaymentStatus.PENDING    
    )
    provider_order_id = models.CharField(max_length=100,blank=True)
    provider_payment_id = models.CharField(max_length=100,blank=True)
    failure_reason = models.CharField(max_length=20,blank=True)
    paid_at = models.DateTimeField(null=True,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table='order_payment'
        constraints = [
            # A provider referance can belog to one payment only.
            models.UniqueConstraint(
                fields=['provider','provider_order_id'],
                condition=~Q(provider_order_id=''),
                name='unique_provider_order_reference',
            ),
            models.UniqueConstraint(
                fields=['provider','provider_payment_id'],
                condition=~Q(provider_payment_id=''),
                name='unique_provider_payment_reference',
            ),
            models.CheckConstraint(condition=Q(amount__gte=0),name='payment_amount_not_negative'),
        ]
    def __str__(self):
        return f'{self.method} {self.status} for {self.order_id}'

class OrderStatusHistory(models.Model):
    """Audit trail of status changes."""

    id = models.BigAutoField(primary_key=True)
    order = models.ForeignKey(Order,on_delete=models.CASCADE,related_name='history')
    from_status = models.CharField(max_length=20,blank=True)
    to_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,blank=True,
        related_name='+',
     ) # null = the system (payment confirmation, expiry)
    note = models.CharField(max_length=200,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'order_status_history'
        ordering = ['created_at','id']
