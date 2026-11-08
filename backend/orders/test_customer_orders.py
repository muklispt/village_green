from decimal import Decimal
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from product.models import Product, ProductCategory, ProductVariant
from orders.models import (Order, OrderItem, OrderStatus, OrderStatusHistory,
                           Payment, PaymentMethod, PaymentStatus)

User = get_user_model()


class CustomerOrderAPITests(APITestCase):
    def setUp(self):
        # Customer 1
        self.customer1 = User.objects.create_user(
            email='alice@example.com',
            password='Password123!',
            full_name='Alice Green',
            role='customer',
            is_staff=False,
            is_active=True,
        )
        refresh1 = RefreshToken.for_user(self.customer1)
        self.token1 = str(refresh1.access_token)

        # Customer 2
        self.customer2 = User.objects.create_user(
            email='bob@example.com',
            password='Password123!',
            full_name='Bob Brown',
            role='customer',
            is_staff=False,
            is_active=True,
        )
        refresh2 = RefreshToken.for_user(self.customer2)
        self.token2 = str(refresh2.access_token)

        # Staff Admin
        self.staff_user = User.objects.create_user(
            email='staff@greenvillage.com',
            password='Password123!',
            full_name='Support Agent',
            role='admin',
            is_staff=True,
            is_active=True,
        )

        # Catalog setup
        self.category = ProductCategory.objects.create(name='Organic Produce', slug='organic-produce')
        small_gif = (
            b'\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x00\x00\x00\x21\xf9\x04'
            b'\x01\x00\x00\x00\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02'
            b'\x02\x44\x01\x00\x3b'
        )
        self.img_file = SimpleUploadedFile('tomato.gif', small_gif, content_type='image/gif')

        self.product = Product.objects.create(
            product_category=self.category,
            name='Fresh Organic Tomatoes',
            slug='fresh-organic-tomatoes',
            price=Decimal('100.00'),
            stock_quantity=50,
            unit='kg',
            product_img=self.img_file,
            is_active=True,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku='TOM-1KG',
            quantity=Decimal('1.000'),
            unit='kg',
            price=Decimal('100.00'),
            mrp=Decimal('120.00'),
            stock_quantity=50,
            is_active=True,
        )

    def _create_order(self, customer, order_number, total_amount='100.00', status=OrderStatus.PENDING, method=PaymentMethod.ONLINE):
        order = Order.objects.create(
            order_number=order_number,
            customer=customer,
            status=status,
            payment_method=method,
            currency='INR',
            subtotal=Decimal(total_amount),
            discount_amount=Decimal('0.00'),
            shipping_fee=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            total_amount=Decimal(total_amount),
            recipient_name=customer.full_name,
            recipient_phone='9876543210',
            shipping_address='123 Green Way',
            shipping_city='Eco City',
            shipping_pincode='560001',
            stock_deducted=True,
        )
        Payment.objects.create(
            order=order,
            method=method,
            provider='razorpay' if method == PaymentMethod.ONLINE else '',
            amount=Decimal(total_amount),
            currency='INR',
            status=PaymentStatus.PAID if method == PaymentMethod.ONLINE else PaymentStatus.PENDING,
            provider_order_id=f'order_rzp_{order_number}' if method == PaymentMethod.ONLINE else '',
            provider_payment_id=f'pay_rzp_{order_number}' if method == PaymentMethod.ONLINE else '',
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            variant=self.variant,
            product_name=self.product.name,
            variant_sku=self.variant.sku,
            variant_label='1.0 kg',
            unit_price=Decimal(total_amount),
            quantity=1,
            line_total=Decimal(total_amount),
        )
        OrderStatusHistory.objects.create(
            order=order,
            from_status='',
            to_status=OrderStatus.PENDING,
            note='Initial order placement',
            created_at=timezone.now(),
        )
        return order

    def test_authenticated_customer_can_list_orders(self):
        """Authenticated customer can list their orders with required summary fields."""
        order1 = self._create_order(self.customer1, 'GV-ALICE-1')
        order2 = self._create_order(self.customer1, 'GV-ALICE-2')

        res = self.client.get(
            '/api/v1/orders/my-orders/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data.get('results', res.data)
        self.assertEqual(len(results), 2)

        first = results[0]
        self.assertIn('id', first)
        self.assertIn('order_number', first)
        self.assertIn('status', first)
        self.assertIn('payment_method', first)
        self.assertIn('payment_status', first)
        self.assertIn('total_amount', first)
        self.assertIn('currency', first)
        self.assertIn('item_count', first)
        self.assertIn('product_image', first)
        self.assertIn('created_at', first)
        # Verify product image is returned
        self.assertTrue(len(first['product_image']) > 0)

    def test_orders_sorted_newest_first(self):
        """Customer orders must be returned with newest orders first."""
        order1 = self._create_order(self.customer1, 'GV-ALICE-EARLY')
        order2 = self._create_order(self.customer1, 'GV-ALICE-LATER')

        res = self.client.get(
            '/api/v1/orders/my-orders/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data.get('results', res.data)
        self.assertEqual(results[0]['order_number'], 'GV-ALICE-LATER')
        self.assertEqual(results[1]['order_number'], 'GV-ALICE-EARLY')

    def test_customer_only_sees_own_orders(self):
        """Alice must never see Bob's orders in the listing."""
        self._create_order(self.customer1, 'GV-ALICE-1')
        self._create_order(self.customer2, 'GV-BOB-1')

        res = self.client.get(
            '/api/v1/orders/my-orders/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data.get('results', res.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['order_number'], 'GV-ALICE-1')

    def test_customer_can_retrieve_own_order_details(self):
        """Alice can retrieve her own order details with snapshot fields and payment info."""
        order = self._create_order(self.customer1, 'GV-ALICE-DETAIL')

        res = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data
        self.assertEqual(data['order_number'], 'GV-ALICE-DETAIL')
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['product_name'], 'Fresh Organic Tomatoes')
        self.assertEqual(data['items'][0]['variant_sku'], 'TOM-1KG')
        self.assertEqual(data['items'][0]['quantity'], 1)
        self.assertEqual(data['payment']['status'], 'paid')
        self.assertEqual(data['shipping_city'], 'Eco City')

    def test_customer_cannot_retrieve_another_customers_order(self):
        """Alice requesting Bob's order returns HTTP 404 Not Found."""
        bob_order = self._create_order(self.customer2, 'GV-BOB-PRIVATE')

        res = self.client.get(
            f'/api/v1/orders/my-orders/{bob_order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_requests_are_rejected(self):
        """Unauthenticated requests to order endpoints must return HTTP 401."""
        res_list = self.client.get('/api/v1/orders/my-orders/')
        self.assertEqual(res_list.status_code, status.HTTP_401_UNAUTHORIZED)

        res_detail = self.client.get('/api/v1/orders/my-orders/11111111-1111-1111-1111-111111111111/')
        self.assertEqual(res_detail.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_both_legacy_and_my_orders_endpoints_work(self):
        """Both /api/v1/orders/ and /api/v1/orders/my-orders/ routes return consistent data."""
        order = self._create_order(self.customer1, 'GV-COMPAT')

        res_legacy = self.client.get(
            '/api/v1/orders/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        res_my_orders = self.client.get(
            '/api/v1/orders/my-orders/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res_legacy.status_code, status.HTTP_200_OK)
        self.assertEqual(res_my_orders.status_code, status.HTTP_200_OK)
        self.assertEqual(res_legacy.data, res_my_orders.data)

        res_legacy_detail = self.client.get(
            f'/api/v1/orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        res_my_detail = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res_legacy_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_my_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_legacy_detail.data, res_my_detail.data)

    def test_deleted_product_does_not_break_historical_order_details(self):
        """Historical order details remain complete even if the Product is deleted."""
        order = self._create_order(self.customer1, 'GV-DELETED-PROD')
        order_item = order.items.first()

        # Simulate product deletion (product becomes null on OrderItem via on_delete=SET_NULL)
        order_item.product = None
        order_item.variant = None
        order_item.save(update_fields=['product', 'variant'])

        res = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data
        item_data = data['items'][0]
        # Snapshot fields must be 100% intact
        self.assertEqual(item_data['product_name'], 'Fresh Organic Tomatoes')
        self.assertEqual(item_data['variant_sku'], 'TOM-1KG')
        self.assertEqual(item_data['variant_label'], '1.0 kg')
        self.assertEqual(item_data['quantity'], 1)
        self.assertEqual(Decimal(str(item_data['unit_price'])), Decimal('100.00'))
        self.assertEqual(Decimal(str(item_data['line_total'])), Decimal('100.00'))
        # Product image returns empty string safely without error
        self.assertEqual(item_data['product_image'], '')

    def test_order_history_returns_chronological_events(self):
        """OrderSerializer history returns actual chronological audit events."""
        order = self._create_order(self.customer1, 'GV-HISTORY')
        OrderStatusHistory.objects.create(
            order=order,
            from_status=OrderStatus.PENDING,
            to_status=OrderStatus.CONFIRMED,
            note='Order verified by merchant',
            created_at=timezone.now(),
        )

        res = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        history = res.data.get('history', [])
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['to_status'], 'pending')
        self.assertEqual(history[1]['from_status'], 'pending')
        self.assertEqual(history[1]['to_status'], 'confirmed')
        self.assertIn('created_at', history[0])

    def test_internal_staff_notes_and_emails_are_not_leaked(self):
        """Staff private notes and email addresses are sanitized from customer history."""
        order = self._create_order(self.customer1, 'GV-LEAK-TEST')
        OrderStatusHistory.objects.create(
            order=order,
            from_status=OrderStatus.PENDING,
            to_status=OrderStatus.PROCESSING,
            changed_by=self.staff_user,
            note='[INTERNAL]: staff supervisor approved without call',
            created_at=timezone.now(),
        )
        OrderStatusHistory.objects.create(
            order=order,
            from_status=OrderStatus.PROCESSING,
            to_status=OrderStatus.SHIPPED,
            changed_by=self.staff_user,
            note='Dispatched via Express Courier. Dispatcher: staff@greenvillage.com',
            created_at=timezone.now(),
        )

        res = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        history = res.data.get('history', [])
        self.assertEqual(len(history), 3)

        # 1. Staff internal note was masked/blanked
        self.assertEqual(history[1]['note'], '')

        # 2. Staff email was stripped
        self.assertNotIn('staff@greenvillage.com', history[2]['note'])
        self.assertIn('Dispatched via Express Courier.', history[2]['note'])

        # 3. Staff user ID / email is NEVER returned in the history dictionary
        for h in history:
            self.assertNotIn('by', h)
            self.assertNotIn('changed_by', h)

    def test_payment_secrets_are_never_exposed_to_customer(self):
        """Customer order details do not expose gateway secret credentials or webhook keys."""
        order = self._create_order(self.customer1, 'GV-SECRETS')

        res = self.client.get(
            f'/api/v1/orders/my-orders/{order.id}/',
            HTTP_AUTHORIZATION=f'Bearer {self.token1}',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        payment = res.data['payment']
        self.assertNotIn('key_secret', payment)
        self.assertNotIn('webhook_secret', payment)
        self.assertNotIn('provider_order_id', payment)
        self.assertNotIn('provider_payment_id', payment)
        self.assertEqual(payment['status'], 'paid')
        self.assertEqual(payment['amount'], '100.00')
