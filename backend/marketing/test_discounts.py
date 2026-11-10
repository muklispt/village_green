from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from cart.models import Cart
from orders.factories import make_product, make_variant, make_user, put_in_cart
from orders.models import OrderStatus
from product.models import ProductCategory

from . import services
from .discounts import OfferConfigurationError, calculate_cart_discounts, calculate_discounts
from .factories import make_coupon, make_offer, make_order
from .models import ApplicableType, CouponUsage, DiscountType, Offer, OfferCategory, OfferProduct


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

    def test_fixed_offer_touching_the_cart_is_refused_not_guessed(self):
        make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'))
        with self.assertRaises(OfferConfigurationError):
            self.calc([item(self.rice, 1)])

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