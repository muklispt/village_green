import re
from rest_framework import serializers


from .models import Order,OrderItem,OrderStatus,Payment,PaymentMethod
from .import services

PHONE_RE = re.compile(r'^\+?\d{9,15}$')
PINCODE_RE = re.compile(r'^\d{6}$')


class CheckoutSerializer(serializers.Serializer):
    """The only things a customer may send. Prices, total, discounts, tex,
    shipping, user and payment status are never read from the request."""

    payment_method = serializers.ChoiceField(choices=PaymentMethod.choices)
    recipient_name = serializers.CharField(max_length=120)
    recipient_phone = serializers.CharField(max_length=17)
    shipping_address = serializers.CharField(min_length=5,max_length=500)
    shipping_city = serializers.CharField(max_length=100)
    shipping_pincode = serializers.CharField(max_length=10)
    idempotency_key = serializers.CharField(
        max_length=64,required=False,allow_blank=True,default=''
    )

    def validate_recipient_phone(self, value):
        value = value.replace(' ','')
        if not PHONE_RE.match(value):
            raise serializers.ValidationError(
                'Enter a valid phone number, 9 to 15 digits, optionaly starting with +.'
            )
        return value

    def validate_shipping_pincode(self,value):
        if not PINCODE_RE.match(value):
            raise serializers.ValidationError('Enter a valid 6 digit pincode.')
        return value


class AdminStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OrderStatus.choices)
    note = serializers.CharField(max_length=200,required=False,allow_blank=True,default='')


class OrderItemSerializer(serializers.ModelSerializer):
    product_image = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = (
            'id','product','variant','product_name','variant_sku',
            'variant_label','unit_price','quantity','line_total','product_image',
        )
        read_only_fields = fields

    def get_product_image(self, item):
        if item.product and item.product.product_img:
            try:
                return item.product.product_img.url
            except Exception:
                return ''
        return ''


class PaymentSerializer(serializers.ModelSerializer):
    """Customer view of a payment. Provider references are not exposed"""

    class Meta:
        model = Payment
        fields = ('method','provider','amount','currency','status','paid_at','failure_reason')
        read_only_fields = fields


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    payment = PaymentSerializer(read_only=True)
    can_cancel = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            'id', 'order_number', 'status', 'payment_method', 'currency',
            'subtotal', 'discount_amount', 'shipping_fee', 'tax_amount', 'total_amount',
            'recipient_name', 'recipient_phone', 'shipping_address', 'shipping_city',
            'shipping_pincode', 'items', 'payment', 'can_cancel', 'history', 'created_at', 'updated_at',
        )
        read_only_fields = fields

    def get_can_cancel(self, order):
        return services.customer_can_cancel(order)

    def _get_customer_safe_note(self, note):
        if not note:
            return ''
        lower = note.lower()
        if any(k in lower for k in ['internal', 'staff-only', 'private', 'admin-only', 'confidential']):
            return ''
        cleaned = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '', note).strip()
        return cleaned

    def get_history(self, order):
        return [
            {
                'from_status': row.from_status,
                'to_status': row.to_status,
                'note': self._get_customer_safe_note(row.note),
                'created_at': row.created_at,
            }
            for row in order.history.all().order_by('created_at', 'id')
        ]


class OrderListSerializer(serializers.ModelSerializer):
    payment_status = serializers.CharField(source='payment.status', read_only=True)
    item_count = serializers.IntegerField(read_only=True)
    product_image = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            'id', 'order_number', 'status', 'payment_method', 'payment_status',
            'total_amount', 'currency', 'item_count', 'product_image', 'created_at',
        )
        read_only_fields = fields

    def get_product_image(self, order):
        for item in order.items.all():
            if item.product and item.product.product_img:
                try:
                    return item.product.product_img.url
                except Exception:
                    continue
        return ''


class AdminOrderListSerializer(serializers.ModelSerializer):
    payment_status = serializers.CharField(source='payment.status', read_only=True)
    payment_provider = serializers.CharField(source='payment.provider', read_only=True)
    item_count = serializers.IntegerField(read_only=True)
    customer_name = serializers.CharField(source='customer.full_name', read_only=True)
    customer_email = serializers.CharField(source='customer.email', read_only=True)

    class Meta:
        model = Order
        fields = (
            'id', 'order_number', 'status', 'payment_method', 'payment_status',
            'payment_provider', 'total_amount', 'currency', 'item_count',
            'recipient_name', 'recipient_phone', 'customer_name', 'customer_email',
            'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminPaymentSerializer(serializers.ModelSerializer):
    """Admin view of a payment with non-sensitive provider references."""

    class Meta:
        model = Payment
        fields = (
            'method', 'provider', 'amount', 'currency', 'status',
            'provider_order_id', 'provider_payment_id', 'paid_at',
            'failure_reason', 'created_at', 'updated_at',
        )
        read_only_fields = fields


class AdminOrderSerializer(OrderSerializer):
    customer = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()
    payment = AdminPaymentSerializer(read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = tuple(dict.fromkeys(OrderSerializer.Meta.fields + ('customer', 'stock_deducted', 'history')))
        read_only_fields = fields

    def get_customer(self,order):
        user = order.customer
        return {'id':str(user.id),'email':user.email,'full_name':user.full_name}

    def get_history(self,order):
        return [
            {
                'from_status':row.from_status,
                'to_status':row.to_status,
                'note':row.note,
                'by':row.changed_by.email if row.changed_by else 'system',
                'at':row.created_at,
            }
            for row in order.history.all()
        ]
