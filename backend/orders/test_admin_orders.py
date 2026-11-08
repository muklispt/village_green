from decimal import Decimal
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from adminpanel.tokens import AdminRefreshToken
from product.models import Product, ProductCategory, ProductVariant
from orders.models import (Order, OrderItem, OrderStatus, OrderStatusHistory,
                           Payment, PaymentMethod, PaymentStatus)

User = get_user_model()


class AdminOrderManagementTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email='admin@greenvillage.com',
            password='Password123!',
            full_name='Admin Lead',
            role='admin',
            is_staff=True,
            is_active=True,
        )
        admin_refresh = AdminRefreshToken.for_user(self.admin)
        self.admin_token = str(admin_refresh.access_token)

        self.customer = User.objects.create_user(
            email='patron@example.com',
            password='Password123!',
            full_name='Patron Sharma',
            role='customer',
            is_staff=False,
            is_active=True,
        )
        cust_refresh = RefreshToken.for_user(self.customer)
        self.customer_token = str(cust_refresh.access_token)

        self.category = ProductCategory.objects.create(name='Farm Fresh Organic', slug='farm-fresh-organic')
        self.product = Product.objects.create(
            product_category=self.category,
            name='Organic Heirloom Tomatoes',
            slug='organic-heirloom-tomatoes',
            price=Decimal('120.00'),
            stock_quantity=50,
            unit='kg',
            is_active=True,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku='TOM-500G',
            quantity=Decimal('0.500'),
            unit='kg',
            price=Decimal('65.00'),
            mrp=Decimal('80.00'),
            stock_quantity=30,
            is_active=True,
        )

        # Create sample orders
        self.order_cod = self._create_order(
            order_number='GVTESTCOD01',
            method=PaymentMethod.COD,
            payment_status=PaymentStatus.PENDING,
            order_status=OrderStatus.PENDING,
        )

        self.order_online = self._create_order(
            order_number='GVTESTONL02',
            method=PaymentMethod.ONLINE,
            payment_status=PaymentStatus.PENDING,
            order_status=OrderStatus.PENDING,
        )

    def _create_order(self, order_number, method, payment_status, order_status, created_at=None):
        order = Order.objects.create(
            order_number=order_number,
            customer=self.customer,
            status=order_status,
            payment_method=method,
            currency='INR',
            subtotal=Decimal('130.00'),
            discount_amount=Decimal('0.00'),
            shipping_fee=Decimal('40.00'),
            tax_amount=Decimal('8.50'),
            total_amount=Decimal('178.50'),
            recipient_name='Patron Sharma',
            recipient_phone='+919876543210',
            shipping_address='Flat 4B, Green Acres',
            shipping_city='Bengaluru',
            shipping_pincode='560001',
            stock_deducted=True,
        )
        if created_at:
            Order.objects.filter(pk=order.pk).update(created_at=created_at)
            order.refresh_from_db()

        OrderItem.objects.create(
            order=order,
            product=self.product,
            variant=self.variant,
            product_name=self.product.name,
            variant_sku=self.variant.sku,
            variant_label='500 g',
            unit_price=self.variant.price,
            quantity=2,
            line_total=Decimal('130.00'),
        )

        Payment.objects.create(
            order=order,
            method=method,
            provider='razorpay' if method == PaymentMethod.ONLINE else '',
            amount=order.total_amount,
            currency='INR',
            status=payment_status,
            provider_order_id='order_mock_test' if method == PaymentMethod.ONLINE else '',
        )

        OrderStatusHistory.objects.create(
            order=order,
            from_status='',
            to_status=order_status,
            note='Initial placement',
        )
        return order

    def auth_admin(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.admin_token}')

    def auth_customer(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.customer_token}')

    # 1. Authorization tests
    def test_unauthorized_and_customer_rejected_from_admin_orders(self):
        # Anonymous
        self.client.credentials()
        res = self.client.get('/api/v1/admin/orders/')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        # Customer token
        self.auth_customer()
        res = self.client.get('/api/v1/admin/orders/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        res = self.client.post(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'confirmed'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        res = self.client.post(f'/api/v1/admin/orders/{self.order_cod.id}/cancel/', {'reason': 'test'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 2. Listing and alias tests
    def test_admin_order_list_and_alias_consistency(self):
        self.auth_admin()

        # Test both primary alias and legacy endpoint
        for url in ['/api/v1/admin/orders/', '/api/v1/orders/admin/']:
            res = self.client.get(url)
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertIn('count', res.data)
            self.assertIn('results', res.data)
            self.assertGreaterEqual(res.data['count'], 2)
            first_order = res.data['results'][0]
            self.assertIn('order_number', first_order)
            self.assertIn('customer_name', first_order)
            self.assertIn('customer_email', first_order)
            self.assertIn('payment_status', first_order)
            self.assertIn('total_amount', first_order)

    # 3. Search tests
    def test_admin_order_search(self):
        self.auth_admin()

        # Search by order number
        res = self.client.get('/api/v1/admin/orders/?search=GVTESTCOD01')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['order_number'], 'GVTESTCOD01')

        # Search by email
        res = self.client.get('/api/v1/admin/orders/?search=patron@example.com')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(res.data['count'], 2)

        # Search by recipient
        res = self.client.get('/api/v1/admin/orders/?search=Patron')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(res.data['count'], 2)

    # 4. Filter tests
    def test_admin_order_filters(self):
        self.auth_admin()

        # Filter by payment method
        res = self.client.get('/api/v1/admin/orders/?payment_method=cod')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(all(o['payment_method'] == 'cod' for o in res.data['results']))

        res = self.client.get('/api/v1/admin/orders/?payment_method=online')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(all(o['payment_method'] == 'online' for o in res.data['results']))

        # Filter by order status
        res = self.client.get('/api/v1/admin/orders/?status=pending')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(all(o['status'] == 'pending' for o in res.data['results']))

        # Filter by date range
        today_str = timezone.now().date().isoformat()
        res = self.client.get(f'/api/v1/admin/orders/?date_from={today_str}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(res.data['count'], 2)

    # 5. Detail view tests
    def test_admin_order_detail_view(self):
        self.auth_admin()
        res = self.client.get(f'/api/v1/admin/orders/{self.order_online.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['order_number'], 'GVTESTONL02')
        self.assertEqual(res.data['customer']['email'], 'patron@example.com')
        self.assertEqual(len(res.data['items']), 1)
        self.assertIn('payment', res.data)
        self.assertEqual(res.data['payment']['provider'], 'razorpay')
        self.assertEqual(res.data['payment']['provider_order_id'], 'order_mock_test')
        self.assertIn('history', res.data)

    # 6. Status transitions tests
    def test_valid_and_invalid_status_transitions(self):
        self.auth_admin()

        # Invalid transition: pending -> shipped (cannot skip confirmed/processing)
        res = self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {
            'status': 'shipped',
            'note': 'Skipping directly to shipped',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('status', res.data)

        # Valid transition: pending -> confirmed
        res = self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {
            'status': 'confirmed',
            'note': 'Order verified with packaging depot',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'confirmed')

        # Check history recorded
        self.order_cod.refresh_from_db()
        history = self.order_cod.history.last()
        self.assertEqual(history.from_status, 'pending')
        self.assertEqual(history.to_status, 'confirmed')
        self.assertEqual(history.changed_by, self.admin)
        self.assertEqual(history.note, 'Order verified with packaging depot')

    # 7. Online payment restriction on status change
    def test_online_unpaid_order_cannot_advance_status(self):
        self.auth_admin()

        # Online order has payment.status == 'pending'
        res = self.client.patch(f'/api/v1/admin/orders/{self.order_online.id}/status/', {
            'status': 'confirmed',
            'note': 'Attempting confirmation without payment',
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('status', res.data)
        self.assertIn('not been verified', str(res.data['status']))

        # Mark payment paid
        self.order_online.payment.status = PaymentStatus.PAID
        self.order_online.payment.save()

        # Now status advancement succeeds
        res = self.client.patch(f'/api/v1/admin/orders/{self.order_online.id}/status/', {
            'status': 'confirmed',
            'note': 'Payment verified, confirmed',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'confirmed')

    # 8. COD delivery auto-payment collection
    def test_cod_delivered_automatically_collects_payment(self):
        self.auth_admin()

        # Move step by step: pending -> confirmed -> processing -> shipped -> delivered
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'confirmed'})
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'processing'})
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'shipped'})
        res = self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {
            'status': 'delivered',
            'note': 'Delivered by courier agent',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.order_cod.refresh_from_db()
        self.assertEqual(self.order_cod.status, OrderStatus.DELIVERED)
        self.assertEqual(self.order_cod.payment.status, PaymentStatus.PAID)
        self.assertIsNotNone(self.order_cod.payment.paid_at)

    # 9. Admin cancellation and stock restoration
    def test_admin_order_cancellation_and_inventory_restoration(self):
        self.auth_admin()

        # Record initial stock
        initial_variant_stock = self.variant.stock_quantity
        self.assertTrue(self.order_cod.stock_deducted)

        res = self.client.post(f'/api/v1/admin/orders/{self.order_cod.id}/cancel/', {
            'reason': 'Customer requested cancellation via phone call',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], OrderStatus.CANCELLED)

        # Inventory is restored exactly once
        self.order_cod.refresh_from_db()
        self.assertFalse(self.order_cod.stock_deducted)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_quantity, initial_variant_stock + 2)

        # Payment status moved to cancelled
        self.assertEqual(self.order_cod.payment.status, PaymentStatus.CANCELLED)

        # History recorded
        history = self.order_cod.history.last()
        self.assertEqual(history.to_status, OrderStatus.CANCELLED)
        self.assertEqual(history.changed_by, self.admin)
        self.assertEqual(history.note, 'Customer requested cancellation via phone call')

        # 10. Repeated cancellation is rejected and does not restore stock twice
        res_repeat = self.client.post(f'/api/v1/admin/orders/{self.order_cod.id}/cancel/', {
            'reason': 'Accidental duplicate cancel',
        })
        self.assertEqual(res_repeat.status_code, status.HTTP_400_BAD_REQUEST)
        self.variant.refresh_from_db()
        # Stock did not increment again
        self.assertEqual(self.variant.stock_quantity, initial_variant_stock + 2)

    # 11. Paid order cancellation flags refund_pending
    def test_admin_cancellation_of_paid_order_marks_refund_pending(self):
        self.auth_admin()

        # Mark online order as paid
        self.order_online.payment.status = PaymentStatus.PAID
        self.order_online.payment.save()

        res = self.client.post(f'/api/v1/admin/orders/{self.order_online.id}/cancel/', {
            'reason': 'Item out of farm production',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.order_online.refresh_from_db()
        self.assertEqual(self.order_online.status, OrderStatus.CANCELLED)
        self.assertEqual(self.order_online.payment.status, PaymentStatus.REFUND_PENDING)

    # 12. Cannot cancel shipped or delivered orders
    def test_shipped_and_delivered_orders_cannot_be_cancelled(self):
        self.auth_admin()

        # Progress to shipped
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'confirmed'})
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'processing'})
        self.client.patch(f'/api/v1/admin/orders/{self.order_cod.id}/status/', {'status': 'shipped'})

        res = self.client.post(f'/api/v1/admin/orders/{self.order_cod.id}/cancel/', {'reason': 'Late cancel'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Cannot cancel', str(res.data))

