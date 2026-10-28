import threading
import time
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase
from rest_framework.exceptions import ValidationError

from product.models import Product, ProductCategory

from . import services
from .factories import checkout_payload, make_product, make_user, make_variant, put_in_cart
from .models import Order, OrderStatus

DATA = {k: v for k, v in checkout_payload().items()}


@skipUnless(connection.vendor == 'postgresql', 'row locking needs PostgreSQL')
class OrderConcurrencyTests(TransactionTestCase):
    """Real parallel requests against PostgreSQL. A pause is injected while the
    locks are held, so without row locks these tests fail."""

    def setUp(self):
        category = ProductCategory.objects.create(name='Race')
        self.rice = make_product(category, 'Race Rice', stock=1)
        self.turmeric = make_product(category, 'Race Turmeric', stock=0)
        self.variant = make_variant(self.turmeric, 'RACE-250', stock=1)
        self.alice = make_user('alice@example.com')
        self.bob = make_user('bob@example.com')

    def run_parallel(self, jobs):
        """jobs: list of callables. Returns their outcomes: 'ok', 'rejected' or 'error: ...'."""
        barrier = threading.Barrier(len(jobs))
        results = [None] * len(jobs)

        def worker(index, job):
            try:
                barrier.wait()
                job()
                results[index] = 'ok'
            except ValidationError:
                results[index] = 'rejected'
            except Exception as exc:        # any other error is a real bug
                results[index] = f'error: {exc!r}'
            finally:
                connection.close()

        original = services.calculate_totals

        def slow_totals(subtotal):
            time.sleep(0.4)             # runs while stock rows are locked
            return original(subtotal)

        threads = [threading.Thread(target=worker, args=(i, job)) for i, job in enumerate(jobs)]
        with patch.object(services, 'calculate_totals', slow_totals):
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        return results

    def checkout(self, user, key=None):
        return lambda: services.checkout(user, DATA, key)

    def test_two_customers_cannot_both_buy_the_last_unit(self):
        put_in_cart(self.alice, self.rice, 1)
        put_in_cart(self.bob, self.rice, 1)

        results = self.run_parallel([self.checkout(self.alice), self.checkout(self.bob)])

        self.assertEqual(sorted(results), ['ok', 'rejected'])
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(Product.objects.get(pk=self.rice.pk).stock_quantity, 0)

    def test_last_variant_unit_is_not_oversold(self):
        put_in_cart(self.alice, self.turmeric, 1, self.variant)
        put_in_cart(self.bob, self.turmeric, 1, self.variant)

        results = self.run_parallel([self.checkout(self.alice), self.checkout(self.bob)])

        self.assertEqual(sorted(results), ['ok', 'rejected'])
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_quantity, 0)
        self.assertEqual(Product.objects.get(pk=self.turmeric.pk).stock_quantity, 0)

    def test_same_customer_double_click_makes_one_order(self):
        put_in_cart(self.alice, self.rice, 1)

        results = self.run_parallel([self.checkout(self.alice), self.checkout(self.alice)])

        self.assertEqual(sorted(results), ['ok', 'rejected'])      # the second finds an empty cart
        self.assertEqual(Order.objects.filter(customer=self.alice).count(), 1)
        self.assertEqual(Product.objects.get(pk=self.rice.pk).stock_quantity, 0)

    def test_parallel_requests_with_the_same_idempotency_key_make_one_order(self):
        put_in_cart(self.alice, self.rice, 1)

        results = self.run_parallel([
            self.checkout(self.alice, 'same-key'), self.checkout(self.alice, 'same-key'),
        ])

        self.assertEqual(results, ['ok', 'ok'])        # both get the same order back
        self.assertEqual(Order.objects.filter(customer=self.alice).count(), 1)
        self.assertEqual(Product.objects.get(pk=self.rice.pk).stock_quantity, 0)

    def test_parallel_cancellations_restore_stock_once(self):
        put_in_cart(self.alice, self.rice, 1)
        order, _ = services.checkout(self.alice, DATA)
        self.assertEqual(Product.objects.get(pk=self.rice.pk).stock_quantity, 0)

        def cancel():
            services.cancel_order_for_customer(order.id, self.alice)

        results = self.run_parallel([cancel, cancel])

        self.assertEqual(sorted(results), ['ok', 'rejected'])
        self.assertEqual(Product.objects.get(pk=self.rice.pk).stock_quantity, 1)    # not 2
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)

    def test_cancel_racing_with_a_new_checkout_never_oversells(self):
        put_in_cart(self.alice, self.rice, 1)
        order, _ = services.checkout(self.alice, DATA)
        put_in_cart(self.bob, self.rice, 1)

        def cancel():
            services.cancel_order_for_customer(order.id, self.alice)

        results = self.run_parallel([cancel, self.checkout(self.bob)])

        stock = Product.objects.get(pk=self.rice.pk).stock_quantity
        self.assertGreaterEqual(stock, 0)
        active = Order.objects.exclude(status=OrderStatus.CANCELLED).count()
        self.assertEqual(stock + active, 1)            # one unit exists, never two sold
        self.assertNotIn('error', ' '.join(r for r in results))

    def test_parallel_orders_for_two_variants_keep_the_product_total_in_sync(self):
        # A product shows the sum of its variants' stock. Two customers buy different
        # sizes at the same moment: without the product row lock one update is lost.
        second = make_variant(self.turmeric, 'RACE-500', '500', 'g', stock=1)
        self.variant.stock_quantity = 5
        self.variant.save()
        second.stock_quantity = 5
        second.save()
        put_in_cart(self.alice, self.turmeric, 1, self.variant)
        put_in_cart(self.bob, self.turmeric, 1, second)

        results = self.run_parallel([self.checkout(self.alice), self.checkout(self.bob)])

        self.assertEqual(results, ['ok', 'ok'])
        self.variant.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((self.variant.stock_quantity, second.stock_quantity), (4, 4))
        self.assertEqual(Product.objects.get(pk=self.turmeric.pk).stock_quantity, 8)