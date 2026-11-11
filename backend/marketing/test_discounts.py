from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from cart.models import Cart
from orders.factories import make_product, make_user, make_variant, put_in_cart
from orders.models import Order, OrderStatus
from orders.services import calculate_totals
from product.models import ProductCategory

from . import services
from .discounts import allocate_capped, calculate_cart_discounts, calculate_discounts
from .factories import make_coupon, make_offer, make_order
from .models import (ApplicableType, CouponUsage, DiscountType, Offer, OfferCategory,
                     OfferProduct)


def item(product, quantity=1, variant=None):
    return {
        'product_id': str(product.pk),
        'variant_id': str(variant.pk) if variant is not None else None,
        'quantity': quantity,
    }


class DiscountBase(TestCase):
    """Catalog used by every test:
    rice     Grains, 60.00, no sizes
    turmeric Spices, 100.00, no sizes
    pepper   Spices, no product-level stock; sold only by its 250g size at 45.00 (MRP 50.00)
    """

    def setUp(self):
        self.spices = ProductCategory.objects.create(name='Spices')
        self.grains = ProductCategory.objects.create(name='Grains')
        self.rice = make_product(self.grains, 'Rice', price='60.00', stock=50)
        self.turmeric = make_product(self.spices, 'Turmeric', price='100.00', stock=50)
        self.pepper = make_product(self.spices, 'Pepper', price='100.00', stock=0)
        self.pepper_250 = make_variant(self.pepper, 'PEP-250', '250', 'g', '45.00', '50.00', stock=20)
        self.customer = make_user('shopper@example.com')

    def calc(self, items, coupon_code=None, order=None, now=None):
        return calculate_discounts(customer=self.customer, items=items,
                                   coupon_code=coupon_code, order=order, now=now)

    def product_offer(self, product, **extra):
        offer = make_offer(applicable_type=ApplicableType.SPECIFIC_PRODUCTS, **extra)
        OfferProduct.objects.create(offer=offer, product=product)
        return offer

    def category_offer(self, category, **extra):
        offer = make_offer(applicable_type=ApplicableType.CATEGORIES, **extra)
        OfferCategory.objects.create(offer=offer, category=category)
        return offer


class AutomaticOfferTests(DiscountBase):

    def test_store_wide_percentage_offer(self):
        make_offer(name='Harvest', discount_value=Decimal('10'))
        result = self.calc([item(self.rice, 2)])
        self.assertEqual(result.subtotal, Decimal('120.00'))
        self.assertEqual(result.offer_discount, Decimal('12.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('108.00'))
        self.assertEqual(result.applied_offers[0].offer_name, 'Harvest')

    def test_product_specific_offer_touches_only_that_product(self):
        self.product_offer(self.rice, discount_value=Decimal('20'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 1)])
        self.assertEqual(result.offer_discount, Decimal('24.00'))
        turmeric_line = next(line for line in result.lines if line.product_id == self.turmeric.pk)
        self.assertIsNone(turmeric_line.offer_id)

    def test_category_offer_touches_only_that_category(self):
        self.category_offer(self.grains, discount_value=Decimal('25'))
        result = self.calc([item(self.rice, 1), item(self.turmeric, 1)])
        self.assertEqual(result.offer_discount, Decimal('15.00'))     # 25% of 60 only

    def test_fixed_offer_not_touching_the_cart_is_ignored(self):
        offer = self.product_offer(self.turmeric, discount_type=DiscountType.FIXED,
                                   discount_value=Decimal('5'))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.offer_discount, Decimal('0.00'))
        self.assertTrue(Offer.objects.filter(pk=offer.pk).exists())

    def test_inactive_offer_is_not_applied(self):
        make_offer(is_active=False)
        self.assertEqual(self.calc([item(self.rice, 1)]).offer_discount, Decimal('0.00'))

    def test_not_yet_started_offer_is_not_applied(self):
        now = timezone.now()
        make_offer(start_date=now + timedelta(days=1), end_date=now + timedelta(days=3))
        self.assertEqual(self.calc([item(self.rice, 1)]).offer_discount, Decimal('0.00'))

    def test_expired_offer_is_not_applied(self):
        now = timezone.now()
        make_offer(start_date=now - timedelta(days=3), end_date=now - timedelta(minutes=1))
        self.assertEqual(self.calc([item(self.rice, 1)]).offer_discount, Decimal('0.00'))

    def test_offer_window_is_checked_at_the_given_time(self):
        now = timezone.now()
        make_offer(start_date=now - timedelta(days=1), end_date=now + timedelta(days=1))
        later = now + timedelta(days=2)
        self.assertEqual(self.calc([item(self.rice, 1)], now=later).offer_discount, Decimal('0.00'))
        self.assertEqual(self.calc([item(self.rice, 1)], now=now).offer_discount, Decimal('6.00'))

    def test_minimum_order_requirement(self):
        make_offer(minimum_order_amount=Decimal('200.00'))
        self.assertEqual(self.calc([item(self.rice, 2)]).offer_discount, Decimal('0.00'))
        self.assertEqual(self.calc([item(self.rice, 4)]).offer_discount, Decimal('24.00'))

    def test_maximum_discount_caps_the_offer(self):
        make_offer(discount_value=Decimal('50'), maximum_discount=Decimal('10.00'))
        result = self.calc([item(self.rice, 2)])          # 50% of 120 = 60, capped at 10
        self.assertEqual(result.offer_discount, Decimal('10.00'))

    def test_maximum_discount_is_a_cap_across_the_whole_order(self):
        make_offer(discount_value=Decimal('10'), maximum_discount=Decimal('15.00'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 1)])   # 12 + 10 raw
        self.assertEqual(result.offer_discount, Decimal('15.00'))
        self.assertEqual(result.discounted_subtotal, result.subtotal - Decimal('15.00'))

    def test_best_offer_wins_for_a_line(self):
        make_offer(name='Store 10', discount_value=Decimal('10'))
        best = self.product_offer(self.rice, name='Rice 25', discount_value=Decimal('25'))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.offer_discount, Decimal('15.00'))
        self.assertEqual(result.lines[0].offer_id, best.pk)
        self.assertEqual(len(result.applied_offers), 1)            # never stacked

    def test_equal_discounts_use_lowest_offer_id(self):
        first = make_offer(name='A', discount_value=Decimal('10'))
        second = make_offer(name='B', discount_value=Decimal('10'))
        expected = min(first, second, key=lambda offer: str(offer.id))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.lines[0].offer_id, expected.pk)
        self.assertEqual(result.offer_discount, Decimal('6.00'))

    def test_variant_uses_its_own_selling_price(self):
        make_offer(discount_value=Decimal('10'))
        result = self.calc([item(self.pepper, 2, variant=self.pepper_250)])
        self.assertEqual(result.lines[0].unit_price, Decimal('45.00'))
        self.assertEqual(result.subtotal, Decimal('90.00'))
        self.assertEqual(result.offer_discount, Decimal('9.00'))

    def test_quantity_greater_than_one_is_multiplied(self):
        make_offer(discount_value=Decimal('10'))
        self.assertEqual(self.calc([item(self.rice, 3)]).offer_discount, Decimal('18.00'))

    def test_mrp_is_never_the_discount_base(self):
        make_offer(discount_value=Decimal('50'))
        result = self.calc([item(self.pepper, 1, variant=self.pepper_250)])
        self.assertEqual(result.offer_discount, Decimal('22.50'))        # 50% of 45, not of MRP 50
        self.assertNotEqual(result.offer_discount, Decimal('25.00'))

    def test_full_offer_never_makes_a_line_negative(self):
        make_offer(discount_value=Decimal('100'))
        result = self.calc([item(self.rice, 2)])
        self.assertEqual(result.offer_discount, Decimal('120.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('0.00'))
        self.assertGreaterEqual(result.lines[0].discounted_total, Decimal('0.00'))

    def test_cap_below_one_rupee_still_applies_the_exact_amount(self):
        make_offer(discount_value=Decimal('10'), maximum_discount=Decimal('0.01'))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.offer_discount, Decimal('0.01'))
        self.assertEqual(len(result.applied_offers), 1)


class CouponTests(DiscountBase):

    def test_valid_percentage_coupon(self):
        make_coupon(code='SAVE10', discount_value=Decimal('10'))
        result = self.calc([item(self.rice, 2)], coupon_code='SAVE10')
        self.assertEqual(result.coupon_discount, Decimal('12.00'))
        self.assertEqual(result.coupon_code, 'SAVE10')
        self.assertEqual(result.discounted_subtotal, Decimal('108.00'))

    def test_valid_fixed_coupon(self):
        make_coupon(code='FLAT30', discount_type=DiscountType.FIXED, discount_value=Decimal('30'))
        result = self.calc([item(self.rice, 2)], coupon_code='FLAT30')
        self.assertEqual(result.coupon_discount, Decimal('30.00'))

    def test_code_is_normalized_before_lookup(self):
        make_coupon(code='SAVE10')
        self.assertEqual(self.calc([item(self.rice, 1)], coupon_code='  save10 ').coupon_code, 'SAVE10')

    def test_invalid_code(self):
        with self.assertRaises(ValidationError) as ctx:
            self.calc([item(self.rice, 1)], coupon_code='NOSUCH')
        self.assertIn('coupon_code', ctx.exception.detail)

    def test_inactive_coupon(self):
        make_coupon(code='OFF', is_active=False)
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='OFF')

    def test_expired_coupon(self):
        now = timezone.now()
        make_coupon(code='OLD', start_date=now - timedelta(days=3), end_date=now - timedelta(minutes=1))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='OLD')

    def test_future_coupon(self):
        now = timezone.now()
        make_coupon(code='SOON', start_date=now + timedelta(days=1), end_date=now + timedelta(days=2))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='SOON')

    def test_minimum_order_requirement(self):
        make_coupon(code='BIG', minimum_order_amount=Decimal('200.00'))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 2)], coupon_code='BIG')
        self.assertEqual(self.calc([item(self.rice, 4)], coupon_code='BIG').coupon_discount,
                         Decimal('24.00'))

    def test_maximum_discount_cap(self):
        make_coupon(code='CAP20', discount_value=Decimal('50'), maximum_discount=Decimal('20.00'))
        self.assertEqual(self.calc([item(self.rice, 2)], coupon_code='CAP20').coupon_discount,
                         Decimal('20.00'))

    def test_global_usage_limit_counts_reserved_usage_of_other_orders(self):
        coupon = make_coupon(code='ONE', usage_limit=1)
        other = make_order(make_user('earlier@example.com'), subtotal='300.00')
        services.reserve_coupon_usage(other, coupon, Decimal('10.00'))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='ONE')

    def test_released_usage_does_not_count_toward_global_limit(self):
        coupon = make_coupon(code='ONCE', usage_limit=1)
        other = make_order(make_user('cancelled@example.com'), subtotal='300.00')
        services.reserve_coupon_usage(other, coupon, Decimal('10.00'))
        services.release_coupon_usage(other, 'cancelled')
        self.assertEqual(self.calc([item(self.rice, 1)], coupon_code='ONCE').coupon_discount,
                         Decimal('6.00'))

    def test_per_customer_limit(self):
        coupon = make_coupon(code='MINE', usage_limit_per_customer=1)
        earlier = make_order(self.customer, subtotal='300.00')
        services.reserve_coupon_usage(earlier, coupon, Decimal('10.00'))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='MINE')

    def test_per_customer_limit_does_not_block_other_customers(self):
        coupon = make_coupon(code='THEIRS', usage_limit_per_customer=1)
        earlier = make_order(make_user('someone@example.com'), subtotal='300.00')
        services.reserve_coupon_usage(earlier, coupon, Decimal('10.00'))
        self.assertEqual(self.calc([item(self.rice, 1)], coupon_code='THEIRS').coupon_discount,
                         Decimal('6.00'))

    def test_first_order_coupon_rejected_after_a_pending_order(self):
        make_coupon(code='WELCOME', first_order_only=True)
        make_order(self.customer, status=OrderStatus.PENDING)
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='WELCOME')

    def test_first_order_coupon_rejected_after_a_delivered_order(self):
        make_coupon(code='WELCOME', first_order_only=True)
        make_order(self.customer, status=OrderStatus.DELIVERED)
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='WELCOME')

    def test_first_order_coupon_allowed_after_only_cancelled_orders(self):
        make_coupon(code='WELCOME', first_order_only=True)
        make_order(self.customer, status=OrderStatus.CANCELLED)
        self.assertEqual(self.calc([item(self.rice, 1)], coupon_code='WELCOME').coupon_discount,
                         Decimal('6.00'))

    def test_first_order_check_ignores_the_current_order(self):
        make_coupon(code='WELCOME', first_order_only=True)
        current = make_order(self.customer, subtotal='60.00', status=OrderStatus.PENDING)
        result = self.calc([item(self.rice, 1)], coupon_code='WELCOME', order=current)
        self.assertEqual(result.coupon_discount, Decimal('6.00'))

    def test_first_order_check_still_sees_other_orders_when_order_supplied(self):
        make_coupon(code='WELCOME', first_order_only=True)
        make_order(self.customer, status=OrderStatus.PENDING)
        current = make_order(self.customer, subtotal='60.00')
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='WELCOME', order=current)

    def test_coupon_applies_after_automatic_offers(self):
        make_offer(discount_value=Decimal('10'))                  # 120 -> 108
        make_coupon(code='HALF', discount_value=Decimal('50'))
        result = self.calc([item(self.rice, 2)], coupon_code='HALF')
        self.assertEqual(result.offer_discount, Decimal('12.00'))
        self.assertEqual(result.coupon_discount, Decimal('54.00'))     # 50% of 108, not of 120
        self.assertEqual(result.discounted_subtotal, Decimal('54.00'))

    def test_coupon_cannot_exceed_eligible_subtotal(self):
        make_offer(discount_value=Decimal('10'))
        make_coupon(code='HUGE', discount_type=DiscountType.FIXED, discount_value=Decimal('500'))
        result = self.calc([item(self.rice, 2)], coupon_code='HUGE')
        self.assertEqual(result.coupon_discount, Decimal('108.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('0.00'))

    def test_coupon_is_rejected_when_offers_leave_nothing(self):
        make_offer(discount_value=Decimal('100'))
        make_coupon(code='NOTHING')
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='NOTHING')

    def test_only_one_coupon_code_is_accepted(self):
        make_coupon(code='FIRST')
        make_coupon(code='SECOND')
        result = self.calc([item(self.rice, 1)], coupon_code='FIRST')
        self.assertEqual(result.coupon_code, 'FIRST')
        self.assertEqual(result.coupon_discount, Decimal('6.00'))

    def test_existing_reservation_of_this_order_is_not_counted_against_limits(self):
        coupon = make_coupon(code='LASTONE', usage_limit=1, usage_limit_per_customer=1)
        order = make_order(self.customer, subtotal='60.00')
        services.reserve_coupon_usage(order, coupon, Decimal('6.00'))
        result = self.calc([item(self.rice, 1)], coupon_code='LASTONE', order=order)
        self.assertEqual(result.coupon_discount, Decimal('6.00'))

    def test_released_reservation_of_this_order_is_rejected(self):
        coupon = make_coupon(code='GONE')
        order = make_order(self.customer, subtotal='60.00')
        services.reserve_coupon_usage(order, coupon, Decimal('6.00'))
        services.release_coupon_usage(order, 'cancelled')
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='GONE', order=order)

    def test_order_with_a_different_coupon_is_rejected(self):
        first = make_coupon(code='ORIGINAL')
        make_coupon(code='OTHER')
        order = make_order(self.customer, subtotal='60.00')
        services.reserve_coupon_usage(order, first, Decimal('6.00'))
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='OTHER', order=order)

    def test_order_of_another_customer_is_rejected(self):
        stranger_order = make_order(make_user('stranger@example.com'), subtotal='60.00')
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], order=stranger_order)

    def test_engine_discount_is_accepted_by_the_reservation_service(self):
        coupon = make_coupon(code='MATCH', discount_value=Decimal('10'))
        order = make_order(self.customer, subtotal='120.00')
        result = self.calc([item(self.rice, 2)], coupon_code='MATCH', order=order)
        usage = services.reserve_coupon_usage(order, coupon, result.coupon_discount)
        self.assertEqual(usage.discount_amount, result.coupon_discount)


class SecurityAndCalculationTests(DiscountBase):

    def test_client_supplied_prices_are_ignored(self):
        result = self.calc([{
            'product_id': str(self.rice.pk), 'variant_id': None, 'quantity': 1,
            'price': '0.01', 'unit_price': '0.01', 'line_total': '0.01', 'mrp': '1.00',
        }])
        self.assertEqual(result.lines[0].unit_price, Decimal('60.00'))
        self.assertEqual(result.subtotal, Decimal('60.00'))

    def test_client_supplied_discounts_and_totals_are_ignored(self):
        make_coupon(code='REAL', discount_value=Decimal('10'))
        result = self.calc([{
            'product_id': str(self.rice.pk), 'quantity': 1,
            'offer_discount': '59.00', 'discount_amount': '59.00', 'discounted_subtotal': '1.00',
            'applied_offers': [{'offer_id': 'x', 'discount_amount': '59.00'}],
        }], coupon_code='REAL')
        self.assertEqual(result.offer_discount, Decimal('0.00'))
        self.assertEqual(result.coupon_discount, Decimal('6.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('54.00'))

    def test_half_up_rounding_on_money(self):
        cheap = make_product(self.grains, 'Cheap', price='2.50', stock=10)
        make_offer(discount_value=Decimal('5'))                    # 2.50 x 5% = 0.125
        self.assertEqual(self.calc([item(cheap, 1)]).offer_discount, Decimal('0.13'))

    def test_totals_are_exact_decimals_and_consistent(self):
        make_offer(discount_value=Decimal('7'))
        make_coupon(code='CENTS', discount_value=Decimal('3'))
        result = self.calc([item(self.rice, 3), item(self.turmeric, 2)], coupon_code='CENTS')
        self.assertIsInstance(result.subtotal, Decimal)
        self.assertEqual(result.subtotal, Decimal('380.00'))
        self.assertEqual(result.discount_amount, result.offer_discount + result.coupon_discount)
        self.assertEqual(result.discounted_subtotal, result.subtotal - result.discount_amount)
        self.assertEqual(sum((line.offer_discount for line in result.lines), Decimal('0')),
                         result.offer_discount)
        self.assertGreaterEqual(result.discounted_subtotal, Decimal('0.00'))

    def test_multiple_lines_are_all_priced(self):
        result = self.calc([
            item(self.rice, 1), item(self.turmeric, 2), item(self.pepper, 1, variant=self.pepper_250),
        ])
        self.assertEqual(result.subtotal, Decimal('60.00') + Decimal('200.00') + Decimal('45.00'))
        self.assertEqual(len(result.lines), 3)

    def test_calculation_performs_no_coupon_writes(self):
        coupon = make_coupon(code='READONLY', usage_limit=5)
        make_offer(discount_value=Decimal('10'))
        order = make_order(self.customer, subtotal='120.00')
        with CaptureQueriesContext(connection) as context:
            self.calc([item(self.rice, 2)], coupon_code='READONLY', order=order)
        writes = [q['sql'] for q in context.captured_queries
                  if q['sql'].lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE'))]
        self.assertEqual(writes, [])
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)
        self.assertFalse(CouponUsage.objects.exists())

    def test_calculation_does_not_increment_used_count(self):
        coupon = make_coupon(code='COUNTME', usage_limit=5)
        for _ in range(3):
            self.calc([item(self.rice, 1)], coupon_code='COUNTME')
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)

    def test_query_count_does_not_grow_with_lines(self):
        make_offer(discount_value=Decimal('10'))
        make_coupon(code='FLAT5', discount_value=Decimal('5'))

        def queries_for(line_count):
            products = [make_product(self.grains, f'Item {line_count} {i}', price='10.00', stock=9)
                        for i in range(line_count)]
            with CaptureQueriesContext(connection) as context:
                self.calc([item(p, 1) for p in products], coupon_code='FLAT5')
            return len(context.captured_queries)

        self.assertEqual(queries_for(1), queries_for(6))

    def test_result_serializes_money_as_strings_without_customer_data(self):
        make_offer(discount_value=Decimal('10'))
        result = self.calc([item(self.rice, 2)]).to_dict()
        self.assertEqual(result['subtotal'], '120.00')
        self.assertEqual(result['offer_discount'], '12.00')
        self.assertIsInstance(result['discount_amount'], str)
        self.assertNotIn('customer', str(result).lower())
        self.assertNotIn('shopper@example.com', str(result))
        self.assertNotIn('used_count', str(result))

    def test_invalid_quantities_are_rejected(self):
        for quantity in (0, -1, '2', True, 1.5, None):
            with self.subTest(quantity=quantity):
                with self.assertRaises(ValidationError):
                    self.calc([{'product_id': str(self.rice.pk), 'quantity': quantity}])

    def test_quantity_above_stock_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 51)])

    def test_duplicate_lines_are_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1), item(self.rice, 2)])

    def test_unknown_product_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([{'product_id': '00000000-0000-0000-0000-000000000000', 'quantity': 1}])

    def test_malformed_ids_are_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([{'product_id': 'not-a-uuid', 'quantity': 1}])

    def test_inactive_product_is_rejected(self):
        self.rice.is_active = False
        self.rice.save(update_fields=['is_active'])
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)])

    def test_product_with_sizes_needs_a_size(self):
        with self.assertRaises(ValidationError) as ctx:
            self.calc([item(self.pepper, 1)])
        self.assertIn('needs a size selected', str(ctx.exception.detail))

    def test_variant_of_another_product_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1, variant=self.pepper_250)])

    def test_out_of_stock_variant_is_rejected(self):
        self.pepper_250.stock_quantity = 0
        self.pepper_250.save(update_fields=['stock_quantity'])
        with self.assertRaises(ValidationError):
            self.calc([item(self.pepper, 1, variant=self.pepper_250)])

    def test_empty_request_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.calc([])

    def test_cart_calculation_reads_the_saved_cart(self):
        put_in_cart(self.customer, self.rice, 2)
        make_offer(discount_value=Decimal('10'))
        result = calculate_cart_discounts(self.customer)
        self.assertEqual(result.subtotal, Decimal('120.00'))
        self.assertEqual(result.offer_discount, Decimal('12.00'))

    def test_cart_calculation_rejects_an_empty_cart(self):
        Cart.objects.create(user=self.customer)
        with self.assertRaises(ValidationError):
            calculate_cart_discounts(self.customer)


def cent_amounts(result):
    """Every money amount in a result, for precision checks."""
    values = [result.subtotal, result.offer_discount, result.coupon_discount,
              result.discount_amount, result.discounted_subtotal]
    values += [line.line_total for line in result.lines]
    values += [line.offer_discount for line in result.lines]
    values += [item.discount_amount for item in result.applied_offers]
    return values


class FixedOfferTests(DiscountBase):
    """Decision A: a fixed discount_value is per unit, times the eligible quantity."""

    def test_fixed_offer_on_one_unit(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('20'))
        result = self.calc([item(self.turmeric, 1)])
        self.assertEqual(result.offer_discount, Decimal('20.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('80.00'))

    def test_fixed_offer_is_multiplied_by_quantity(self):
        # Spec example: 100 x 3 = 300; Rs 20 per unit = 60 off; 240 left.
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('20'))
        result = self.calc([item(self.turmeric, 3)])
        self.assertEqual(result.subtotal, Decimal('300.00'))
        self.assertEqual(result.offer_discount, Decimal('60.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('240.00'))

    def test_fixed_offer_with_variant_uses_variant_price(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'))
        result = self.calc([item(self.pepper, 2, variant=self.pepper_250)])
        self.assertEqual(result.lines[0].unit_price, Decimal('45.00'))
        self.assertEqual(result.offer_discount, Decimal('10.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('80.00'))

    def test_fixed_offer_never_exceeds_the_line_subtotal(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('100'))
        result = self.calc([item(self.rice, 1)])          # 100 per unit, but the line is 60
        self.assertEqual(result.offer_discount, Decimal('60.00'))
        self.assertEqual(result.lines[0].discounted_total, Decimal('0.00'))

    def test_fixed_offer_with_maximum_discount(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('20'),
                   maximum_discount=Decimal('50.00'))
        result = self.calc([item(self.turmeric, 3)])       # raw 60, capped at 50
        self.assertEqual(result.offer_discount, Decimal('50.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('250.00'))

    def test_fixed_offer_without_maximum_discount_is_uncapped(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('20'),
                   maximum_discount=None)
        result = self.calc([item(self.turmeric, 5)])       # 5 x 20 = 100, no cap
        self.assertEqual(result.offer_discount, Decimal('100.00'))

    def test_fixed_offer_minimum_order_requirement(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('20'),
                   minimum_order_amount=Decimal('200.00'))
        self.assertEqual(self.calc([item(self.turmeric, 1)]).offer_discount, Decimal('0.00'))
        self.assertEqual(self.calc([item(self.turmeric, 2)]).offer_discount, Decimal('40.00'))

    def test_fixed_offer_on_multiple_product_lines(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 1)])   # 10 + 5
        self.assertEqual(result.offer_discount, Decimal('15.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('205.00'))   # 220 - 15
        self.assertEqual(len(result.applied_offers), 1)
        self.assertEqual(result.applied_offers[0].discount_amount, Decimal('15.00'))

    def test_fixed_offer_never_uses_mrp(self):
        # Variant MRP is 50.00, selling price 45.00. Fixed 5 per unit must come from 45.
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'))
        result = self.calc([item(self.pepper, 1, variant=self.pepper_250)])
        self.assertEqual(result.lines[0].unit_price, Decimal('45.00'))
        self.assertEqual(result.offer_discount, Decimal('5.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('40.00'))

    def test_fixed_offer_respects_product_scope(self):
        self.product_offer(self.rice, discount_type=DiscountType.FIXED, discount_value=Decimal('7'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 2)])
        self.assertEqual(result.offer_discount, Decimal('14.00'))
        turmeric_line = next(line for line in result.lines if line.product_id == self.turmeric.pk)
        self.assertEqual(turmeric_line.offer_discount, Decimal('0.00'))

    def test_fixed_offer_on_one_line_and_percentage_on_another(self):
        self.product_offer(self.rice, discount_type=DiscountType.FIXED,
                           discount_value=Decimal('10'), maximum_discount=Decimal('15'))
        self.product_offer(self.turmeric, discount_value=Decimal('10'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 1)])
        self.assertEqual(result.offer_discount, Decimal('25.00'))    # rice min(20,15)=15, turmeric 10
        self.assertEqual(len(result.applied_offers), 2)


class AggregateCapTests(DiscountBase):
    """Decision C: an offer's maximum_discount is one cap across all its matching lines."""

    def test_percentage_offer_on_one_line(self):
        self.product_offer(self.turmeric, discount_value=Decimal('20'))
        self.assertEqual(self.calc([item(self.turmeric, 1)]).offer_discount, Decimal('20.00'))

    def test_percentage_offer_on_multiple_lines(self):
        make_offer(discount_value=Decimal('10'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 1)])   # 12 + 10
        self.assertEqual(result.offer_discount, Decimal('22.00'))

    def test_aggregate_cap_across_lines(self):
        # Spec example: 20% with max 100. Rice 5 x 60 = 300 -> 60; turmeric 4 x 100 = 400 -> 80.
        # Raw total 140, so the offer gives 100 in total.
        make_offer(discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        result = self.calc([item(self.rice, 5), item(self.turmeric, 4)])
        self.assertEqual(result.subtotal, Decimal('700.00'))
        self.assertEqual(result.offer_discount, Decimal('100.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('600.00'))

    def test_cap_is_not_applied_independently_to_each_line(self):
        make_offer(discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        result = self.calc([item(self.rice, 5), item(self.turmeric, 4)])
        self.assertNotEqual(result.offer_discount, Decimal('140.00'))     # raw total
        self.assertNotEqual(result.offer_discount, Decimal('160.00'))     # 100 cap per line
        self.assertEqual(result.offer_discount, Decimal('100.00'))

    def test_two_different_offers_have_independent_caps(self):
        self.product_offer(self.rice, name='Rice cap', discount_value=Decimal('20'),
                           maximum_discount=Decimal('5'))
        self.product_offer(self.turmeric, name='Turmeric cap', discount_value=Decimal('20'),
                           maximum_discount=Decimal('5'))
        result = self.calc([item(self.rice, 2), item(self.turmeric, 2)])   # raw 24 and 40
        self.assertEqual(result.offer_discount, Decimal('10.00'))
        self.assertEqual(sorted(a.discount_amount for a in result.applied_offers),
                         [Decimal('5.00'), Decimal('5.00')])

    def test_best_offer_per_line_is_chosen_before_the_cap(self):
        # Store 10% capped at 5 gives rice 6 raw -> 5 after cap. Product 25% gives 15 raw.
        # The product offer wins the line; the store offer is not applied to rice at all.
        make_offer(name='Store', discount_value=Decimal('10'), maximum_discount=Decimal('5'))
        best = self.product_offer(self.rice, name='Rice 25', discount_value=Decimal('25'))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.lines[0].offer_id, best.pk)
        self.assertEqual(result.offer_discount, Decimal('15.00'))
        self.assertEqual(len(result.applied_offers), 1)

    def test_equal_discount_tie_breaker_is_deterministic(self):
        first = make_offer(name='A', discount_value=Decimal('10'), maximum_discount=Decimal('5'))
        second = make_offer(name='B', discount_value=Decimal('10'), maximum_discount=Decimal('5'))
        winner = min(first, second, key=lambda offer: str(offer.id))
        items = [item(self.rice, 1), item(self.turmeric, 1)]
        for ordering in (items, list(reversed(items))):
            result = self.calc(ordering)
            self.assertEqual({line.offer_id for line in result.lines}, {winner.pk})
            self.assertEqual(len(result.applied_offers), 1)

    def test_line_allocations_sum_to_the_offer_total(self):
        make_offer(discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        result = self.calc([item(self.rice, 5), item(self.turmeric, 4)])
        line_sum = sum((line.offer_discount for line in result.lines), Decimal('0'))
        self.assertEqual(line_sum, result.applied_offers[0].discount_amount)
        self.assertEqual(line_sum, result.offer_discount)

    def test_allocated_line_never_exceeds_its_raw_discount(self):
        make_offer(discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        result = self.calc([item(self.rice, 5), item(self.turmeric, 4)])
        raw = {self.rice.pk: Decimal('60.00'), self.turmeric.pk: Decimal('80.00')}
        for line in result.lines:
            self.assertLessEqual(line.offer_discount, raw[line.product_id])

    def test_rounding_remainder_goes_to_largest_fraction(self):
        # Raw: rice 6.00, turmeric 10.00, pepper 4.50 = 20.50. Cap 10.00.
        # Floors 2.92 + 4.87 + 2.19 = 9.98. The 2 leftover cents go to turmeric (.00804)
        # and rice (.00682) ahead of pepper (.00512).
        make_offer(discount_value=Decimal('10'), maximum_discount=Decimal('10.00'))
        result = self.calc([
            item(self.rice, 1), item(self.turmeric, 1), item(self.pepper, 1, variant=self.pepper_250),
        ])
        by_product = {line.product_id: line.offer_discount for line in result.lines}
        self.assertEqual(by_product[self.rice.pk], Decimal('2.93'))
        self.assertEqual(by_product[self.turmeric.pk], Decimal('4.88'))
        self.assertEqual(by_product[self.pepper.pk], Decimal('2.19'))
        self.assertEqual(result.offer_discount, Decimal('10.00'))

    def test_input_ordering_does_not_change_the_result(self):
        make_offer(discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        make_offer(name='Fixed', discount_type=DiscountType.FIXED, discount_value=Decimal('3'))
        items = [item(self.rice, 5), item(self.turmeric, 4)]
        forward = self.calc(items).to_dict()
        backward = self.calc(list(reversed(items))).to_dict()
        self.assertEqual(forward, backward)

    def test_line_totals_never_go_negative_under_a_cap(self):
        make_offer(discount_value=Decimal('100'), maximum_discount=Decimal('50'))
        result = self.calc([item(self.rice, 1)])
        self.assertEqual(result.offer_discount, Decimal('50.00'))
        self.assertGreaterEqual(result.lines[0].discounted_total, Decimal('0'))


class AllocateCappedTests(TestCase):
    """The pure allocation function, checked directly."""

    def test_no_cap_or_cap_above_total_returns_raw_amounts(self):
        raws = [Decimal('3.33'), Decimal('6.67')]
        self.assertEqual(allocate_capped(raws, None), raws)
        self.assertEqual(allocate_capped(raws, Decimal('50.00')), raws)

    def test_cent_remainders_go_to_earlier_lines_on_ties(self):
        raws = [Decimal('0.01'), Decimal('0.01'), Decimal('0.01')]
        self.assertEqual(allocate_capped(raws, Decimal('0.02')),
                         [Decimal('0.01'), Decimal('0.01'), Decimal('0.00')])

    def test_sum_equals_cap_and_no_line_exceeds_its_raw(self):
        raws = [Decimal('3.33'), Decimal('6.67'), Decimal('0.01'), Decimal('12.50')]
        result = allocate_capped(raws, Decimal('5.00'))
        self.assertEqual(sum(result, Decimal('0')), Decimal('5.00'))
        for allocated, raw in zip(result, raws):
            self.assertLessEqual(allocated, raw)
            self.assertGreaterEqual(allocated, Decimal('0'))

    def test_result_is_deterministic(self):
        raws = [Decimal('7.10'), Decimal('2.90'), Decimal('4.44')]
        self.assertEqual(allocate_capped(raws, Decimal('9.99')),
                         allocate_capped(raws, Decimal('9.99')))

    def test_every_allocation_is_at_cent_precision(self):
        raws = [Decimal('1.11'), Decimal('2.22'), Decimal('3.33')]
        for allocated in allocate_capped(raws, Decimal('4.00')):
            self.assertEqual(allocated.as_tuple().exponent, -2)


class DiscountedSubtotalTests(DiscountBase):
    """Decision B: discounted_subtotal = subtotal - offer discount - coupon discount.
    free_shipping_subtotal is the same value. Shipping and tax are not computed here."""

    def test_no_discounts_leaves_subtotal_unchanged(self):
        result = self.calc([item(self.rice, 2)])
        self.assertEqual(result.discounted_subtotal, Decimal('120.00'))
        self.assertEqual(result.free_shipping_subtotal, Decimal('120.00'))
        self.assertEqual(result.discount_amount, Decimal('0.00'))

    def test_automatic_offer_only(self):
        make_offer(discount_value=Decimal('10'))
        result = self.calc([item(self.turmeric, 1)])
        self.assertEqual(result.discounted_subtotal, Decimal('90.00'))

    def test_coupon_only(self):
        make_coupon(code='TEN', discount_value=Decimal('10'))
        result = self.calc([item(self.turmeric, 1)], coupon_code='TEN')
        self.assertEqual(result.discounted_subtotal, Decimal('90.00'))

    def test_offer_and_coupon_together(self):
        make_offer(discount_value=Decimal('10'))                 # 120 -> 108
        make_coupon(code='TEN', discount_value=Decimal('10'))    # 10% of 108 = 10.80
        result = self.calc([item(self.rice, 2)], coupon_code='TEN')
        self.assertEqual(result.discounted_subtotal, Decimal('97.20'))
        self.assertEqual(result.discount_amount, Decimal('22.80'))

    def _spec_cart(self):
        # Original 1100 (turmeric x11). Fixed 10/unit capped at 100 -> offer 100.
        # Coupon fixed 100 -> coupon 100. Discounted merchandise 900.
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('10'),
                   maximum_discount=Decimal('100'))
        make_coupon(code='HUNDRED', discount_type=DiscountType.FIXED, discount_value=Decimal('100'))
        return self.calc([item(self.turmeric, 11)], coupon_code='HUNDRED')

    @override_settings(ORDER_SHIPPING_FEE=Decimal('50.00'),
                       ORDER_FREE_SHIPPING_THRESHOLD=Decimal('1000.00'),
                       ORDER_TAX_RATE_PERCENT=Decimal('0'))
    def test_discounted_subtotal_below_threshold_pays_shipping(self):
        result = self._spec_cart()
        self.assertEqual(result.subtotal, Decimal('1100.00'))
        self.assertEqual(result.discounted_subtotal, Decimal('900.00'))
        # The spec's example: gross 1100 clears 1000, but the discounted 900 does not.
        self.assertEqual(calculate_totals(result.free_shipping_subtotal)['shipping_fee'],
                         Decimal('50.00'))

    @override_settings(ORDER_SHIPPING_FEE=Decimal('50.00'),
                       ORDER_FREE_SHIPPING_THRESHOLD=Decimal('900.00'),
                       ORDER_TAX_RATE_PERCENT=Decimal('0'))
    def test_discounted_subtotal_equal_to_threshold_is_free_shipping(self):
        result = self._spec_cart()
        self.assertEqual(calculate_totals(result.free_shipping_subtotal)['shipping_fee'],
                         Decimal('0.00'))

    @override_settings(ORDER_SHIPPING_FEE=Decimal('50.00'),
                       ORDER_FREE_SHIPPING_THRESHOLD=Decimal('500.00'),
                       ORDER_TAX_RATE_PERCENT=Decimal('0'))
    def test_discounted_subtotal_above_threshold_is_free_shipping(self):
        result = self._spec_cart()
        self.assertEqual(calculate_totals(result.free_shipping_subtotal)['shipping_fee'],
                         Decimal('0.00'))

    def test_discounted_subtotal_never_becomes_negative(self):
        make_offer(discount_value=Decimal('100'))
        result = self.calc([item(self.rice, 2)])
        self.assertEqual(result.discounted_subtotal, Decimal('0.00'))
        self.assertGreaterEqual(result.discounted_subtotal, Decimal('0'))

    def test_serialized_output_exposes_discounted_subtotal(self):
        make_offer(discount_value=Decimal('10'))
        data = self.calc([item(self.rice, 2)]).to_dict()
        self.assertEqual(data['discounted_subtotal'], '108.00')
        self.assertEqual(data['free_shipping_subtotal'], '108.00')
        self.assertEqual(data['taxable_subtotal'], '108.00')


class PrecisionAndSafetyTests(DiscountBase):

    def test_all_money_is_decimal_at_cent_precision(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('3.33'),
                   maximum_discount=Decimal('40.01'))
        make_coupon(code='CENTS', discount_value=Decimal('7.5'))
        result = self.calc([item(self.rice, 3), item(self.turmeric, 2)], coupon_code='CENTS')
        for amount in cent_amounts(result):
            self.assertIsInstance(amount, Decimal)
            self.assertEqual(amount.as_tuple().exponent, -2)

    def test_offers_and_coupon_calculation_performs_no_writes(self):
        coupon = make_coupon(code='NOWRITE', usage_limit=5, usage_limit_per_customer=5)
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'),
                   maximum_discount=Decimal('12'))
        make_offer(name='Pct', discount_value=Decimal('20'), maximum_discount=Decimal('100'))
        order = make_order(self.customer, subtotal='700.00')
        orders_before = Order.objects.count()
        with CaptureQueriesContext(connection) as context:
            self.calc([item(self.rice, 5), item(self.turmeric, 4)], coupon_code='NOWRITE',
                      order=order)
        writes = [q['sql'] for q in context.captured_queries
                  if q['sql'].lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE'))]
        self.assertEqual(writes, [])
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)
        self.assertFalse(CouponUsage.objects.exists())
        self.assertEqual(Order.objects.count(), orders_before)
        order.refresh_from_db()
        self.assertEqual(order.discount_amount, Decimal('0.00'))

    def test_used_count_and_usage_rows_unchanged_with_offers_and_coupon(self):
        coupon = make_coupon(code='STAYS', usage_limit=3)
        make_offer(discount_value=Decimal('10'), maximum_discount=Decimal('30'))
        for _ in range(2):
            self.calc([item(self.rice, 4), item(self.turmeric, 2)], coupon_code='STAYS')
        coupon.refresh_from_db()
        self.assertEqual(coupon.used_count, 0)
        self.assertEqual(CouponUsage.objects.count(), 0)

    def test_first_order_coupon_rule_unchanged_when_offers_apply(self):
        make_offer(discount_value=Decimal('10'))
        make_coupon(code='WELCOME', first_order_only=True)
        make_order(self.customer, status=OrderStatus.PENDING)
        with self.assertRaises(ValidationError):
            self.calc([item(self.rice, 1)], coupon_code='WELCOME')
        fresh = make_user('fresh@example.com')
        result = calculate_discounts(customer=fresh, items=[item(self.rice, 1)],
                                     coupon_code='WELCOME')
        self.assertEqual(result.offer_discount, Decimal('6.00'))
        self.assertEqual(result.coupon_discount, Decimal('5.40'))   # 10% of 54