from decimal import Decimal
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import override_settings

from cart.models import Cart, CartItem
from product.models import Product

from .factories import OrderBase, put_in_cart
from .models import Order, OrderItem, OrderStatus, Payment, PaymentStatus


class CheckoutSuccessTests(OrderBase):

    def test_cod_checkout_creates_order_payment_history_and_clears_cart(self):
        put_in_cart(self.user, self.rice, 2)
        put_in_cart(self.user, self.turmeric, 1, self.v250)

        response = self.checkout()

        self.assertEqual(response.status_code, 201)
        order = Order.objects.get(pk=response.data['order']['id'])
        self.assertEqual(order.customer, self.user)
        self.assertEqual(order.status, OrderStatus.PENDING)
        self.assertEqual(order.payment_method, 'cod')
        self.assertEqual(order.subtotal, Decimal('165.00'))      # 2 x 60 + 45
        self.assertEqual(order.total_amount, Decimal('165.00'))
        self.assertTrue(order.order_number.startswith('GV'))
        self.assertEqual(order.recipient_name, 'Asha Nair')
        self.assertTrue(order.stock_deducted)

        self.assertEqual(order.items.count(), 2)
        self.assertEqual(order.payment.method, 'cod')
        self.assertEqual(order.payment.status, PaymentStatus.PENDING)    # due on delivery, not paid
        self.assertEqual(order.payment.amount, Decimal('165.00'))
        self.assertEqual(order.history.count(), 1)

        self.assertFalse(response.data['idempotent_replay'])
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 0)

    def test_stock_is_deducted_for_products_and_variants(self):
        put_in_cart(self.user, self.rice, 3)
        put_in_cart(self.user, self.turmeric, 2, self.v250)
        self.checkout()

        self.assertEqual(self.stock(self.rice), 7)
        self.assertEqual(self.stock(self.v250), 3)
        self.assertEqual(self.stock(self.v500), 2)
        # a product with variants shows the sum of its active variants
        self.assertEqual(self.stock(self.turmeric), 5)

    def test_order_items_are_snapshots(self):
        put_in_cart(self.user, self.turmeric, 1, self.v250)
        response = self.checkout()
        order = Order.objects.get(pk=response.data['order']['id'])

        item = order.items.get()
        self.assertEqual(item.product_name, 'Turmeric')
        self.assertEqual(item.variant_sku, 'TUR-250G')
        self.assertEqual(item.variant_label, '250 g')
        self.assertEqual(item.unit_price, Decimal('45.00'))

        # later price and name changes never touch the placed order
        self.v250.price = Decimal('99.00')
        self.v250.save()
        Product.objects.filter(pk=self.turmeric.pk).update(name='Renamed')
        item.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(item.unit_price, Decimal('45.00'))
        self.assertEqual(item.product_name, 'Turmeric')
        self.assertEqual(order.total_amount, Decimal('45.00'))

    def test_deleting_a_product_keeps_the_order_line(self):
        put_in_cart(self.user, self.rice, 1)
        order = Order.objects.get(pk=self.checkout().data['order']['id'])

        self.rice.delete()

        item = order.items.get()
        self.assertIsNone(item.product)
        self.assertEqual(item.product_name, 'Rice')
        self.assertEqual(item.line_total, Decimal('60.00'))

    @override_settings(
        ORDER_SHIPPING_FEE=Decimal('40.00'),
        ORDER_FREE_SHIPPING_THRESHOLD=Decimal('500.00'),
        ORDER_TAX_RATE_PERCENT=Decimal('5'),
    )
    def test_shipping_and_tax_come_from_server_rules(self):
        put_in_cart(self.user, self.rice, 2)
        put_in_cart(self.user, self.turmeric, 1, self.v250)
        order = Order.objects.get(pk=self.checkout().data['order']['id'])

        self.assertEqual(order.subtotal, Decimal('165.00'))
        self.assertEqual(order.shipping_fee, Decimal('40.00'))
        self.assertEqual(order.tax_amount, Decimal('8.25'))
        self.assertEqual(order.discount_amount, Decimal('0.00'))
        self.assertEqual(order.total_amount, Decimal('213.25'))

    @override_settings(ORDER_SHIPPING_FEE=Decimal('40.00'), ORDER_FREE_SHIPPING_THRESHOLD=Decimal('100.00'))
    def test_free_shipping_over_the_threshold(self):
        put_in_cart(self.user, self.rice, 2)    # 120
        order = Order.objects.get(pk=self.checkout().data['order']['id'])
        self.assertEqual(order.shipping_fee, Decimal('0.00'))
        self.assertEqual(order.total_amount, Decimal('120.00'))

    def test_client_cannot_set_prices_totals_status_or_owner(self):
        put_in_cart(self.user, self.rice, 1)
        response = self.checkout(
            price='0.01', total_amount='0.01', subtotal='0.01', discount_amount='999',
            shipping_fee='0', tax_amount='0', status='delivered', payment_status='paid',
            customer=str(self.other.id), user=str(self.other.id), stock_deducted=False,
            items=[{'product': str(self.rice.id), 'unit_price': '0.01', 'quantity': 99}],
        )

        self.assertEqual(response.status_code, 201)
        order = Order.objects.get(pk=response.data['order']['id'])
        self.assertEqual(order.customer, self.user)
        self.assertEqual(order.status, OrderStatus.PENDING)
        self.assertEqual(order.total_amount, Decimal('60.00'))
        self.assertEqual(order.discount_amount, Decimal('0.00'))
        self.assertEqual(order.payment.status, PaymentStatus.PENDING)
        self.assertEqual(order.items.get().quantity, 1)

    def test_online_payment_is_refused_until_a_provider_exists(self):
        put_in_cart(self.user, self.rice, 1)
        response = self.checkout(payment_method='online')

        self.assertEqual(response.status_code, 400)
        self.assertIn('payment_method', response.data)
        self.assertIn('not available yet', str(response.data))
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(self.stock(self.rice), 10)                 # nothing reserved for an unpayable order
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 1)


class CheckoutRejectionTests(OrderBase):

    def assert_nothing_happened(self, cart_lines=1):
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), cart_lines)

    def test_unauthenticated_is_rejected(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.checkout().status_code, 401)

    def test_empty_cart_is_rejected(self):
        response = self.checkout()
        self.assertEqual(response.status_code, 400)
        self.assertIn('cart', response.data)

        Cart.objects.create(user=self.user)
        self.assertEqual(self.checkout().status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_invalid_payment_method(self):
        put_in_cart(self.user, self.rice)
        for method in ('cheque', '', 'COD ', None):
            response = self.checkout(payment_method=method)
            self.assertEqual(response.status_code, 400, method)
            self.assertIn('payment_method', response.data)
        self.assert_nothing_happened()

    def test_missing_or_invalid_delivery_information(self):
        put_in_cart(self.user, self.rice)
        cases = {
            'recipient_name': ['', ' '],
            'recipient_phone': ['abc', '12345', '+1234567890123456789'],
            'shipping_address': ['', 'abc'],
            'shipping_city': ['', ' '],
            'shipping_pincode': ['12345', 'abcdef', '1234567'],
        }
        for field, values in cases.items():
            for value in values:
                response = self.checkout(**{field: value})
                self.assertEqual(response.status_code, 400, (field, value))
                self.assertIn(field, response.data)

        empty = self.client.post(self.checkout_url, {'payment_method': 'cod'}, format='json')
        self.assertEqual(empty.status_code, 400)
        for field in ('recipient_name', 'recipient_phone', 'shipping_address', 'shipping_city', 'shipping_pincode'):
            self.assertIn(field, empty.data)
        self.assert_nothing_happened()

    def test_inactive_product_is_rejected_and_nothing_changes(self):
        put_in_cart(self.user, self.rice, 2)
        self.rice.is_active = False
        self.rice.save()

        response = self.checkout()

        self.assertEqual(response.status_code, 400)
        self.assertIn('no longer available', str(response.data['items']))
        self.assert_nothing_happened()
        self.assertEqual(self.stock(self.rice), 10)

    def test_inactive_variant_is_rejected(self):
        put_in_cart(self.user, self.turmeric, 1, self.v250)
        self.v250.is_active = False
        self.v250.save()

        response = self.checkout()

        self.assertEqual(response.status_code, 400)
        self.assertIn('no longer available', str(response.data['items']))
        self.assert_nothing_happened()

    def test_variant_of_a_different_product_is_rejected(self):
        # a corrupted cart line: rice with a turmeric variant
        put_in_cart(self.user, self.rice, 1, self.v250)

        response = self.checkout()

        self.assertEqual(response.status_code, 400)
        self.assert_nothing_happened()
        self.assertEqual(self.stock(self.v250), 5)

    def test_product_that_gained_variants_needs_a_size(self):
        put_in_cart(self.user, self.turmeric, 1)     # no variant chosen
        response = self.checkout()
        self.assertEqual(response.status_code, 400)
        self.assertIn('size', str(response.data['items']))

    def test_insufficient_stock_is_rejected_and_no_stock_is_taken(self):
        put_in_cart(self.user, self.rice, 3)
        put_in_cart(self.user, self.turmeric, 2, self.v500)
        Product.objects.filter(pk=self.rice.pk).update(stock_quantity=2)     # fewer than 3

        response = self.checkout()

        self.assertEqual(response.status_code, 400)
        self.assertIn('only 2 left', str(response.data['items']))
        self.assert_nothing_happened(cart_lines=2)
        self.assertEqual(self.stock(self.v500), 2)      # the valid line was not touched either

    def test_out_of_stock_is_rejected(self):
        put_in_cart(self.user, self.rice, 1)
        Product.objects.filter(pk=self.rice.pk).update(stock_quantity=0)
        response = self.checkout()
        self.assertEqual(response.status_code, 400)
        self.assertIn('out of stock', str(response.data['items']))

    def test_all_problems_are_reported_together(self):
        put_in_cart(self.user, self.rice, 1)
        put_in_cart(self.user, self.turmeric, 1, self.v250)
        self.rice.is_active = False
        self.rice.save()
        self.v250.is_active = False
        self.v250.save()

        response = self.checkout()
        self.assertEqual(len(response.data['items']), 2)


class CheckoutIntegrityTests(OrderBase):

    def test_failure_after_stock_change_rolls_everything_back(self):
        put_in_cart(self.user, self.rice, 2)
        put_in_cart(self.user, self.turmeric, 1, self.v250)

        with patch('orders.services.OrderStatusHistory.objects.create', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                self.checkout()

        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(OrderItem.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(self.stock(self.rice), 10)
        self.assertEqual(self.stock(self.v250), 5)
        self.assertEqual(self.stock(self.turmeric), 7)
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 2)

    def test_failure_while_clearing_the_cart_rolls_the_order_back(self):
        put_in_cart(self.user, self.rice, 2)

        with patch('orders.services.CartItem.objects.filter', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                self.checkout()

        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(self.stock(self.rice), 10)

    def test_second_checkout_without_a_key_finds_an_empty_cart(self):
        put_in_cart(self.user, self.rice, 2)
        first = self.checkout()
        second = self.checkout()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(self.stock(self.rice), 8)

    def test_idempotency_key_returns_the_first_order(self):
        put_in_cart(self.user, self.rice, 2)
        first = self.checkout(headers={'HTTP_IDEMPOTENCY_KEY': 'abc-123'})
        # the customer fills the cart again, then the browser retries the same request
        put_in_cart(self.user, self.rice, 1)
        retry = self.checkout(headers={'HTTP_IDEMPOTENCY_KEY': 'abc-123'})

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.data['idempotent_replay'])
        self.assertEqual(retry.data['order']['id'], first.data['order']['id'])
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(self.stock(self.rice), 8)                      # deducted once
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 1)   # new cart untouched

    def test_idempotency_key_in_the_body_works_too(self):
        put_in_cart(self.user, self.rice, 1)
        first = self.checkout(idempotency_key='body-key')
        retry = self.checkout(idempotency_key='body-key')
        self.assertEqual(retry.data['order']['id'], first.data['order']['id'])
        self.assertEqual(Order.objects.count(), 1)

    def test_same_key_from_another_customer_is_independent(self):
        put_in_cart(self.user, self.rice, 1)
        self.checkout(headers={'HTTP_IDEMPOTENCY_KEY': 'shared'})

        self.client.force_authenticate(self.other)
        put_in_cart(self.other, self.rice, 1)
        response = self.checkout(headers={'HTTP_IDEMPOTENCY_KEY': 'shared'})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Order.objects.count(), 2)

    def test_too_long_idempotency_key_is_rejected(self):
        put_in_cart(self.user, self.rice, 1)
        response = self.checkout(headers={'HTTP_IDEMPOTENCY_KEY': 'x' * 65})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_database_blocks_a_duplicate_idempotency_key(self):
        order = self.place_order(headers={'HTTP_IDEMPOTENCY_KEY': 'k1'})
        with self.assertRaises(IntegrityError), transaction.atomic():
            Order.objects.create(
                customer=self.user, order_number='GVDUPLICAT', payment_method='cod',
                subtotal=1, total_amount=1, recipient_name='x', recipient_phone='123456789',
                shipping_address='x', shipping_city='x', shipping_pincode='123456',
                idempotency_key='k1',
            )
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(order.idempotency_key, 'k1')

    def test_database_blocks_negative_amounts_and_zero_quantity(self):
        order = self.place_order()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Order.objects.filter(pk=order.pk).update(total_amount=Decimal('-1'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrderItem.objects.filter(order=order).update(quantity=0)

    def test_order_numbers_are_unique_and_well_formed(self):
        numbers = set()
        for _ in range(3):
            put_in_cart(self.user, self.rice, 1)
            response = self.checkout()
            numbers.add(response.data['order']['order_number'])
        self.assertEqual(len(numbers), 3)
        for number in numbers:
            self.assertRegex(number, r'^GV[A-Z2-9]{8}$')


class CheckoutThrottleTests(OrderBase):
    disable_throttles = False

    def test_checkout_is_rate_limited(self):
        codes = [self.checkout(payment_method='bad').status_code for _ in range(11)]
        self.assertEqual(codes[:10], [400] * 10)
        self.assertEqual(codes[10], 429)


# ssl certificat
# https://certbot.eff.org/

# https://github.com/youpi-pg/YouPI-PG
