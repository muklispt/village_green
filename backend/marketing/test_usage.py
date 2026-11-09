import threading
import time
from datetime import timedelta
from decimal import Decimal
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from orders.models import OrderStatus

from . import services
from .factories import make_order, make_user, window
from .models import Coupon, CouponUsage, CouponUsageStatus, DiscountType
from .services import release_coupon_usage, reserve_coupon_usage


def make_coupon(code='SAVE10', **extra):
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


def used_count(coupon):
    return Coupon.objects.get(pk=coupon.pk).used_count


class ReservationTests(TestCase):

    def setUp(self):
        self.customer = make_user('shopper@example.com')
        self.order = make_order(self.customer, subtotal='500.00')
        self.coupon = make_coupon()

    def test_reserving_records_usage_and_counts_it_once(self):
        usage = reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        self.assertEqual(usage.status, CouponUsageStatus.RESERVED)
        self.assertEqual(usage.discount_amount, Decimal('50.00'))
        self.assertEqual(usage.customer, self.customer)
        self.assertEqual(used_count(self.coupon), 1)

    def test_retry_for_same_order_reuses_the_reservation(self):
        first = reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        again = reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(CouponUsage.objects.filter(order=self.order).count(), 1)
        self.assertEqual(used_count(self.coupon), 1)

    def test_release_frees_the_slot_and_keeps_the_audit_row(self):
        reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        self.assertTrue(release_coupon_usage(self.order, 'Cancelled by customer'))
        usage = CouponUsage.objects.get(order=self.order)
        self.assertEqual(usage.status, CouponUsageStatus.RELEASED)
        self.assertIsNotNone(usage.released_at)
        self.assertEqual(usage.release_reason, 'Cancelled by customer')
        self.assertEqual(usage.discount_amount, Decimal('50.00'))
        self.assertEqual(used_count(self.coupon), 0)

    def test_release_happens_exactly_once(self):
        reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        self.assertTrue(release_coupon_usage(self.order, 'expired'))
        self.assertFalse(release_coupon_usage(self.order, 'expired'))
        self.assertFalse(release_coupon_usage(self.order, 'cancelled'))
        self.assertEqual(used_count(self.coupon), 0)
        self.assertEqual(CouponUsage.objects.filter(order=self.order).count(), 1)

    def test_release_without_reservation_does_nothing(self):
        self.assertFalse(release_coupon_usage(self.order, 'cancelled'))
        self.assertEqual(used_count(self.coupon), 0)

    def test_released_reservation_is_never_reused_for_the_same_order(self):
        reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        release_coupon_usage(self.order, 'cancelled')
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        self.assertEqual(used_count(self.coupon), 0)

    def test_order_with_a_different_coupon_is_rejected(self):
        reserve_coupon_usage(self.order, self.coupon, Decimal('50.00'))
        other = make_coupon(code='OTHER5')
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(self.order, other, Decimal('5.00'))
        self.assertEqual(used_count(other), 0)

    def test_inactive_or_out_of_window_coupons_are_rejected(self):
        cases = {
            'inactive': dict(is_active=False),
            'expired': dict(start_date=timezone.now() - timedelta(days=5),
                            end_date=timezone.now() - timedelta(minutes=1)),
            'not yet valid': dict(start_date=timezone.now() + timedelta(days=1),
                                  end_date=timezone.now() + timedelta(days=5)),
        }
        for label, extra in cases.items():
            with self.subTest(label):
                coupon = make_coupon(code=f'NO{label[:3].upper()}', **extra)
                with self.assertRaises(ValidationError):
                    reserve_coupon_usage(self.order, coupon, Decimal('10.00'))
                self.assertFalse(CouponUsage.objects.filter(coupon=coupon).exists())
                self.assertEqual(used_count(coupon), 0)

    def test_minimum_order_amount_is_enforced(self):
        coupon = make_coupon(code='BIG', minimum_order_amount=Decimal('1000.00'))
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(self.order, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 0)

    def test_invalid_discount_amounts_are_rejected(self):
        for amount in ('0', '-1.00', '500.01'):
            with self.subTest(amount=amount):
                with self.assertRaises(ValidationError):
                    reserve_coupon_usage(self.order, self.coupon, Decimal(amount))
        self.assertEqual(used_count(self.coupon), 0)

    def test_maximum_discount_cap_is_enforced(self):
        coupon = make_coupon(code='CAP50', maximum_discount=Decimal('50.00'))
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(self.order, coupon, Decimal('50.01'))
        reserve_coupon_usage(self.order, coupon, Decimal('50.00'))
        self.assertEqual(used_count(coupon), 1)

    def test_global_usage_limit(self):
        coupon = make_coupon(code='ONEONLY', usage_limit=1)
        first_order = make_order(make_user('g1@example.com'), subtotal='300.00')
        second_order = make_order(make_user('g2@example.com'), subtotal='300.00')

        reserve_coupon_usage(first_order, coupon, Decimal('10.00'))
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(second_order, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 1)

        release_coupon_usage(first_order, 'cancelled')
        reserve_coupon_usage(second_order, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 1)

    def test_per_customer_limit(self):
        coupon = make_coupon(code='ONCEEACH', usage_limit_per_customer=1)
        same_customer_again = make_order(self.customer, subtotal='400.00')
        someone_else = make_order(make_user('other@example.com'), subtotal='400.00')

        reserve_coupon_usage(self.order, coupon, Decimal('10.00'))
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(same_customer_again, coupon, Decimal('10.00'))
        reserve_coupon_usage(someone_else, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 2)

    def test_released_reservation_does_not_count_for_per_customer_limit(self):
        coupon = make_coupon(code='REUSE', usage_limit_per_customer=1)
        reserve_coupon_usage(self.order, coupon, Decimal('10.00'))
        release_coupon_usage(self.order, 'cancelled')
        second = make_order(self.customer, subtotal='400.00')
        reserve_coupon_usage(second, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 1)

    def test_first_order_only_rejects_customers_with_earlier_orders(self):
        coupon = make_coupon(code='FIRSTONLY', first_order_only=True)
        veteran = make_user('veteran@example.com')
        make_order(veteran, subtotal='200.00', status=OrderStatus.DELIVERED)
        current = make_order(veteran, subtotal='300.00')
        with self.assertRaises(ValidationError):
            reserve_coupon_usage(current, coupon, Decimal('10.00'))

    def test_first_order_only_ignores_cancelled_earlier_orders(self):
        coupon = make_coupon(code='FIRSTTOO', first_order_only=True)
        newcomer = make_user('newcomer@example.com')
        make_order(newcomer, subtotal='200.00', status=OrderStatus.CANCELLED)
        current = make_order(newcomer, subtotal='300.00')
        reserve_coupon_usage(current, coupon, Decimal('10.00'))
        self.assertEqual(used_count(coupon), 1)

    def test_usage_count_matches_reserved_rows(self):
        coupon = make_coupon(code='TALLY')
        orders = [make_order(make_user(f'tally{i}@example.com'), subtotal='300.00') for i in range(4)]
        for order in orders:
            reserve_coupon_usage(order, coupon, Decimal('10.00'))
        release_coupon_usage(orders[0], 'cancelled')
        release_coupon_usage(orders[2], 'expired')
        reserved = CouponUsage.objects.filter(coupon=coupon, status=CouponUsageStatus.RESERVED).count()
        self.assertEqual(reserved, 2)
        self.assertEqual(used_count(coupon), reserved)


@skipUnless(connection.vendor == 'postgresql', 'row locking needs PostgreSQL')
class CouponConcurrencyTests(TransactionTestCase):
    """Real parallel requests. A pause is injected while the coupon row is locked,
    so the test fails if the lock is missing."""

    def run_parallel(self, jobs):
        barrier = threading.Barrier(len(jobs))
        results = [None] * len(jobs)

        def worker(index, job):
            try:
                barrier.wait()
                results[index] = job()
            except ValidationError:
                results[index] = 'rejected'
            except Exception as exc:          # a real bug, not an expected rejection
                results[index] = f'error: {exc!r}'
            finally:
                connection.close()

        original = services._check_redemption

        def slow_check(*args, **kwargs):
            time.sleep(0.3)                   # runs while the coupon row is locked
            return original(*args, **kwargs)

        threads = [threading.Thread(target=worker, args=(i, job)) for i, job in enumerate(jobs)]
        with patch.object(services, '_check_redemption', slow_check):
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        return results

    def test_global_limit_holds_under_parallel_redemption(self):
        coupon = make_coupon(code='RACE2', usage_limit=2)
        orders = [make_order(make_user(f'race{i}@example.com'), subtotal='300.00') for i in range(6)]
        results = self.run_parallel(
            [lambda o=o: reserve_coupon_usage(o, coupon, Decimal('10.00')) and 'ok' for o in orders]
        )
        self.assertEqual(results.count('ok'), 2, results)
        self.assertEqual(results.count('rejected'), 4, results)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 2)
        self.assertEqual(CouponUsage.objects.filter(coupon=coupon,
                                                    status=CouponUsageStatus.RESERVED).count(), 2)

    def test_per_customer_limit_holds_under_parallel_redemption(self):
        coupon = make_coupon(code='RACEONE', usage_limit_per_customer=1)
        shopper = make_user('greedy@example.com')
        orders = [make_order(shopper, subtotal='300.00') for _ in range(4)]
        results = self.run_parallel(
            [lambda o=o: reserve_coupon_usage(o, coupon, Decimal('10.00')) and 'ok' for o in orders]
        )
        self.assertEqual(results.count('ok'), 1, results)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)

    def test_parallel_retries_of_one_order_create_one_reservation(self):
        coupon = make_coupon(code='RETRY')
        order = make_order(make_user('retry@example.com'), subtotal='300.00')
        results = self.run_parallel(
            [lambda: reserve_coupon_usage(order, coupon, Decimal('10.00')).pk for _ in range(4)]
        )
        self.assertEqual(len(set(results)), 1, results)
        self.assertEqual(CouponUsage.objects.filter(order=order).count(), 1)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 1)

    def test_parallel_releases_decrement_only_once(self):
        coupon = make_coupon(code='FREEME')
        order = make_order(make_user('release@example.com'), subtotal='300.00')
        reserve_coupon_usage(order, coupon, Decimal('10.00'))
        results = self.run_parallel(
            [lambda: release_coupon_usage(order, 'cancelled') for _ in range(4)]
        )
        self.assertEqual(results.count(True), 1, results)
        self.assertEqual(results.count(False), 3, results)
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)
        self.assertEqual(CouponUsage.objects.filter(order=order).count(), 1)