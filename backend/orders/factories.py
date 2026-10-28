"""Shared helpers for the orders tests (not a test module)."""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient,APITestCase

from cart.models import Cart,CartItem
from product.models import Product,ProductCategory,ProductVariant


User = get_user_model()
PASSWORD = 'StrongPass@123'


class ScopedClient(APIClient):
    """force_authenticate() for staff users also sets the admin-panel token scope,
    like a real login through /api/v1/admin-auth/login/ does."""

    def force_authenticate(self, user=None, token=None):
        if user is not None and user.is_staff and token is None:
            token = {'scope':'admin'}
        return super().force_authenticate(user, token)


def make_user(email,**extra):
    return User.objects.create_user(email=email,password=PASSWORD,full_name='Test User',**extra)


def make_product(category,name,price='60.00',stock=10,**extra):
    return Product.objects.create(
        product_category=category,name=name,price= Decimal(price),
        stock_quantity=stock,unit='kg',**extra,
    )


def make_variant(product,sku,quantity='250',unit='g',price='45.00',mrp='50.00',stock=5,**extra):
    return ProductVariant.objects.create(
        product=product,sku=sku,quantity=Decimal(quantity),unit=unit,
        price=Decimal(price),mrp=Decimal(mrp),stock_quantity=stock,**extra,
    )


def put_in_cart(user,product,quantity=1,variant=None):
    cart,_ = Cart.objects.get_or_create(user=user)
    return CartItem.objects.create(cart=cart,product=product,variant=variant,quantity=quantity)


def checkout_payload(**overrides):
    data={
        'payment_method':'cod',
        'recipient_name':'Asha Nair',
        'recipient_phone':'+919876543210',
        'shipping_address':'12 Garden Road, Mavoor',
        'shipping_city':'Kozhikode',
        'shipping_pincode':'673001',
    }
    data.update(overrides)
    return data


class OrderBase(APITestCase):
    client_class = ScopedClient
    disable_throttles = True     # a test about throttling sets this to False

    def start_patch(self, *args, **kwargs):
        patcher = patch(*args, **kwargs)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked

    def setUp(self):
        self.user = make_user('buyer@example.com')
        self.other = make_user('other@example.com')
        self.admin = make_user('boss@example.com', role='admin', is_staff=True)
        self.category = ProductCategory.objects.create(name='Spices')

        self.rice = make_product(self.category, 'Rice', price='60.00', stock=10)
        self.turmeric = make_product(self.category, 'Turmeric', price='50.00', stock=0)
        self.v250 = make_variant(self.turmeric, 'TUR-250G', '250', 'g', '45.00', '50.00', stock=5)
        self.v500 = make_variant(self.turmeric, 'TUR-500G', '500', 'g', '85.00', '100.00', stock=2)

        if self.disable_throttles:
            self.start_patch('rest_framework.throttling.ScopedRateThrottle.allow_request', return_value=True)
        else:
            from django.core.cache import cache
            cache.clear()

        self.checkout_url = '/api/v1/orders/checkout/'
        self.client.force_authenticate(self.user)

    # ---- helpers
    def checkout(self, **overrides):
        extra = overrides.pop('headers', {})
        return self.client.post(self.checkout_url, checkout_payload(**overrides), format='json', **extra)

    def place_order(self, method='cod', user=None, product=None, quantity=2, **overrides):
        """Put `quantity` x product (default rice) in the cart of `user` (default the
        buyer), check out as that user, then restore whoever was logged in."""
        from .models import Order
        user = user or self.user
        handler = self.client.handler
        previous = (handler._force_user, handler._force_token)
        self.client.force_authenticate(user)
        try:
            put_in_cart(user, product or self.rice, quantity)
            response = self.checkout(payment_method=method, **overrides)
            assert response.status_code == 201, response.data
        finally:
            handler._force_user, handler._force_token = previous
        return Order.objects.get(pk=response.data['order']['id'])

    def stock(self, obj):
        return type(obj).objects.get(pk=obj.pk).stock_quantity
        