import uuid
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from product.models import Product

from .factories import OrderBase, put_in_cart
from .models import Order, OrderStatus, PaymentStatus


class OrderAccessTests(OrderBase):

    def setUp(self):
        super().setUp()
        self.order = self.place_order()
        self.list_url = '/api/v1/orders/'
        self.detail_url = f'/api/v1/orders/{self.order.id}/'

    def test_unauthenticated_requests_are_rejected(self):
        self.client.force_authenticate(None)
        for url in (self.list_url, self.detail_url):
            self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.post(f'{self.detail_url}cancel/').status_code, 401)

    def test_customer_lists_only_their_own_orders(self):
        self.client.force_authenticate(self.other)
        put_in_cart(self.other, self.rice, 1)
        self.checkout()

        mine = self.client.get(self.list_url)
        self.assertEqual(mine.data['count'], 1)

        self.client.force_authenticate(self.user)
        theirs = self.client.get(self.list_url)
        self.assertEqual(theirs.data['count'], 1)
        row = theirs.data['results'][0]
        self.assertEqual(row['id'], str(self.order.id))
        self.assertEqual(row['payment_status'], 'pending')
        self.assertEqual(row['item_count'], 1)
        self.assertEqual(row['total_amount'], '120.00')

    def test_list_is_paginated_newest_first(self):
        Product.objects.filter(pk=self.rice.pk).update(stock_quantity=100)
        for _ in range(11):
            put_in_cart(self.user, self.rice, 1)
            self.checkout()

        first = self.client.get(self.list_url)
        self.assertEqual(first.data['count'], 12)
        self.assertEqual(len(first.data['results']), 10)
        second = self.client.get(self.list_url, {'page': 2})
        self.assertEqual(len(second.data['results']), 2)
        small = self.client.get(self.list_url, {'page_size': 3})
        self.assertEqual(len(small.data['results']), 3)

    def test_customer_retrieves_own_order_with_items_and_payment(self):
        response = self.client.get(self.detail_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['order_number'], self.order.order_number)
        self.assertEqual(response.data['items'][0]['product_name'], 'Rice')
        self.assertEqual(response.data['payment']['status'], 'pending')
        self.assertTrue(response.data['can_cancel'])
        self.assertNotIn('provider_order_id', response.data['payment'])
        self.assertNotIn('idempotency_key', response.data)

    def test_other_customers_order_is_not_reachable_by_uuid(self):
        self.client.force_authenticate(self.other)

        self.assertEqual(self.client.get(self.detail_url).status_code, 404)
        self.assertEqual(self.client.post(f'{self.detail_url}cancel/').status_code, 404)
        self.assertEqual(self.client.post(f'{self.detail_url}payment/initiate/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/orders/{uuid.uuid4()}/').status_code, 404)
        self.assertEqual(self.client.get('/api/v1/orders/').data['count'], 0)

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.PENDING)

    def test_customer_cannot_edit_an_order(self):
        for method in (self.client.put, self.client.patch, self.client.delete):
            response = method(self.detail_url, {'status': 'delivered', 'total_amount': '1'}, format='json')
            self.assertEqual(response.status_code, 405)
        self.order.refresh_from_db()
        self.assertEqual(self.order.total_amount, Decimal('120.00'))

    def test_customer_cannot_use_staff_endpoints(self):
        for method, url in (
            (self.client.get, '/api/v1/orders/admin/'),
            (self.client.get, f'/api/v1/orders/admin/{self.order.id}/'),
            (self.client.post, f'/api/v1/orders/admin/{self.order.id}/status/'),
        ):
            self.assertEqual(method(url, {'status': 'delivered'}, format='json').status_code, 403)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.PENDING)
        self.assertEqual(self.order.payment.status, PaymentStatus.PENDING)

    def test_query_count_does_not_grow_with_orders_or_items(self):
        def count(url):
            with CaptureQueriesContext(connection) as queries:
                self.client.get(url)
            return len(queries)

        list_before, detail_before = count(self.list_url), count(self.detail_url)
        for _ in range(4):
            put_in_cart(self.user, self.rice, 1)
            put_in_cart(self.user, self.turmeric, 1, self.v250)
            self.checkout()
            self.v250.refresh_from_db()

        self.assertEqual(count(self.list_url), list_before)
        self.assertEqual(count(self.detail_url), detail_before)


class CancelTests(OrderBase):

    def cancel(self, order, user=None):
        if user:
            self.client.force_authenticate(user)
        return self.client.post(f'/api/v1/orders/{order.id}/cancel/')

    def test_customer_cancels_cod_order_and_stock_comes_back(self):
        put_in_cart(self.user, self.rice, 3)
        put_in_cart(self.user, self.turmeric, 2, self.v250)
        order = Order.objects.get(pk=self.checkout().data['order']['id'])
        self.assertEqual(self.stock(self.rice), 7)

        response = self.cancel(order)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'cancelled')
        self.assertEqual(response.data['payment']['status'], 'cancelled')
        self.assertFalse(response.data['can_cancel'])
        self.assertEqual(self.stock(self.rice), 10)
        self.assertEqual(self.stock(self.v250), 5)
        self.assertEqual(self.stock(self.turmeric), 7)      # product sum restored too
        order.refresh_from_db()
        self.assertFalse(order.stock_deducted)
        self.assertEqual(order.history.count(), 2)

    def test_stock_is_never_restored_twice(self):
        order = self.place_order()
        self.assertEqual(self.stock(self.rice), 8)

        self.assertEqual(self.cancel(order).status_code, 200)
        again = self.cancel(order)

        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.stock(self.rice), 10)         # not 12

    def test_flag_blocks_a_second_restock_even_if_status_is_forced_back(self):
        order = self.place_order()
        self.cancel(order)
        Order.objects.filter(pk=order.pk).update(status=OrderStatus.PENDING)   # simulate corrupted state

        self.cancel(order)

        self.assertEqual(self.stock(self.rice), 10)

    def test_customer_cannot_cancel_after_processing_starts(self):
        from .services import update_status
        order = self.place_order()
        for status in ('confirmed', 'processing'):
            update_status(order.id, status, self.admin)

        response = self.cancel(order)

        self.assertEqual(response.status_code, 400)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PROCESSING)
        self.assertEqual(self.stock(self.rice), 8)

    def test_customer_can_cancel_a_confirmed_cod_order(self):
        from .services import update_status
        order = self.place_order()
        update_status(order.id, 'confirmed', self.admin)
        self.assertEqual(self.cancel(order).status_code, 200)

    def test_delivered_and_shipped_orders_cannot_be_cancelled(self):
        from .services import update_status
        order = self.place_order()
        for status in ('confirmed', 'processing', 'shipped'):
            update_status(order.id, status, self.admin)
        self.assertEqual(self.cancel(order).status_code, 400)
        update_status(order.id, 'delivered', self.admin)
        self.assertEqual(self.cancel(order).status_code, 400)
        self.assertEqual(self.stock(self.rice), 8)

    def test_cancel_skips_lines_whose_product_was_deleted(self):
        put_in_cart(self.user, self.rice, 2)
        put_in_cart(self.user, self.turmeric, 1, self.v250)
        order = Order.objects.get(pk=self.checkout().data['order']['id'])
        self.rice.delete()
        self.v250.delete()

        self.assertEqual(self.cancel(order).status_code, 200)
        self.assertEqual(self.stock(self.v500), 2)

    def test_customer_cannot_cancel_once_payment_is_recorded_as_paid(self):
        # Online payment arrives in a later step; the rule is already enforced.
        order = self.place_order()
        order.payment.status = PaymentStatus.PAID
        order.payment.save()

        response = self.cancel(order)

        self.assertEqual(response.status_code, 400)
        self.assertIn('support', str(response.data))
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PENDING)
        self.assertEqual(self.stock(self.rice), 8)


class AdminOrderTests(OrderBase):

    def setUp(self):
        super().setUp()
        self.order = self.place_order()
        self.url = f'/api/v1/orders/admin/{self.order.id}/status/'
        self.client.force_authenticate(self.admin)

    def set_status(self, status, note='', order=None):
        url = f'/api/v1/orders/admin/{(order or self.order).id}/status/'
        return self.client.post(url, {'status': status, 'note': note}, format='json')

    def test_staff_without_admin_scope_is_rejected(self):
        client = APIClient()
        client.force_authenticate(self.admin, token={'scope': 'storefront'})
        self.assertEqual(client.get('/api/v1/orders/admin/').status_code, 403)
        client.force_authenticate(self.admin)   # plain APIClient: no token at all
        self.assertEqual(client.get('/api/v1/orders/admin/').status_code, 403)

    def test_cod_order_moves_through_the_whole_flow(self):
        for status in ('confirmed', 'processing', 'shipped', 'delivered'):
            response = self.set_status(status, note=f'to {status}')
            self.assertEqual(response.status_code, 200, status)
            self.assertEqual(response.data['status'], status)

        self.order.refresh_from_db()
        self.assertEqual(self.order.payment.status, PaymentStatus.PAID)     # cash collected
        self.assertIsNotNone(self.order.payment.paid_at)
        self.assertEqual(self.order.history.count(), 5)
        self.assertEqual(self.stock(self.rice), 8)                           # no stock change

    def test_invalid_transitions_are_rejected(self):
        for target in ('shipped', 'delivered', 'processing', 'pending'):
            response = self.set_status(target)
            self.assertEqual(response.status_code, 400, target)
            self.assertIn('status', response.data)

        for status in ('confirmed', 'processing', 'shipped', 'delivered'):
            self.set_status(status)
        for target in ('cancelled', 'pending', 'shipped'):
            self.assertEqual(self.set_status(target).status_code, 400, target)

    def test_unknown_status_is_rejected(self):
        self.assertEqual(self.set_status('teleported').status_code, 400)

    def test_staff_cancel_from_processing_restocks_once(self):
        self.set_status('confirmed')
        self.set_status('processing')

        response = self.set_status('cancelled', note='out of delivery area')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stock(self.rice), 10)
        self.assertEqual(self.set_status('cancelled').status_code, 400)
        self.assertEqual(self.stock(self.rice), 10)
        self.assertEqual(response.data['history'][-1]['note'], 'out of delivery area')
        self.assertEqual(response.data['history'][-1]['by'], 'boss@example.com')

    def make_online(self, order):
        """An online order, as a later payment step will create them."""
        Order.objects.filter(pk=order.pk).update(payment_method='online')
        order.payment.method = 'online'
        order.payment.save()

    def test_online_order_cannot_move_on_before_payment_is_verified(self):
        online = self.place_order(quantity=1)
        self.make_online(online)

        response = self.set_status('confirmed', order=online)

        self.assertEqual(response.status_code, 400)
        self.assertIn('not been verified', str(response.data))
        online.refresh_from_db()
        self.assertEqual(online.status, OrderStatus.PENDING)

    def test_staff_cancel_of_a_paid_order_flags_a_refund(self):
        paid = self.place_order(quantity=1)
        self.make_online(paid)
        paid.payment.status = PaymentStatus.PAID
        paid.payment.save()
        self.set_status('confirmed', order=paid)

        response = self.set_status('cancelled', order=paid)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['payment']['status'], 'refund_pending')
        # 10 - 2 (order from setUp) - 1 (this order)  1 (this order cancelled)
        self.assertEqual(self.stock(self.rice), 8)

    def test_staff_list_filters_and_search(self):
        online = self.place_order(quantity=1)
        self.make_online(online)
        self.place_order(user=self.other, quantity=1)

        everything = self.client.get('/api/v1/orders/admin/')
        self.assertEqual(everything.data['count'], 3)

        cod = self.client.get('/api/v1/orders/admin/', {'payment_method': 'cod'})
        self.assertEqual(cod.data['count'], 2)
        online_only = self.client.get('/api/v1/orders/admin/', {'payment_method': 'online'})
        self.assertEqual(online_only.data['count'], 1)
        by_status = self.client.get('/api/v1/orders/admin/', {'status': 'cancelled'})
        self.assertEqual(by_status.data['count'], 0)
        by_email = self.client.get('/api/v1/orders/admin/', {'search': 'other@example'})
        self.assertEqual(by_email.data['count'], 1)
        by_number = self.client.get('/api/v1/orders/admin/', {'search': online.order_number})
        self.assertEqual(by_number.data['count'], 1)

    def test_staff_detail_shows_customer_stock_flag_and_history(self):
        response = self.client.get(f'/api/v1/orders/admin/{self.order.id}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['customer']['email'], 'buyer@example.com')
        self.assertTrue(response.data['stock_deducted'])
        self.assertEqual(response.data['history'][0]['by'], 'system')