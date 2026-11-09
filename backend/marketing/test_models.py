from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from django.utils import timezone

from product.models import Product, ProductCategory

from .factories import make_order, make_user, window
from .models import (ApplicableType, Coupon, CouponUsage, CouponUsageStatus, DiscountType,
                     Offer, OfferCategory, OfferProduct)


def make_offer(**extra):
    start, end = window()
    values = dict(
        name='Monsoon sale',
        discount_type=DiscountType.PERCENTAGE,
        discount_value=Decimal('10.00'),
        applicable_type=ApplicableType.ALL_PRODUCTS,
        start_date=start,
        end_date=end,
    )
    values.update(extra)
    return Offer.objects.create(**values)


def make_coupon(**extra):
    start, end = window()
    values = dict(
        code='WELCOME10',
        discount_type=DiscountType.PERCENTAGE,
        discount_value=Decimal('10.00'),
        start_date=start,
        end_date=end,
    )
    values.update(extra)
    return Coupon.objects.create(**values)


class OfferValidationTests(TestCase):

    def test_valid_store_wide_percentage_offer_saves(self):
        offer = make_offer()
        offer.full_clean()
        self.assertTrue(offer.is_live())

    def test_fixed_offer_may_exceed_100(self):
        offer = make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('250.00'))
        offer.full_clean()

    def test_zero_or_negative_discount_is_rejected(self):
        for value in ('0', '-5.00'):
            start, end = window()
            offer = Offer(
                name='Bad', discount_type=DiscountType.FIXED, discount_value=Decimal(value),
                applicable_type=ApplicableType.ALL_PRODUCTS, start_date=start, end_date=end)
            with self.assertRaises(ValidationError) as ctx:
                offer.clean()
            self.assertIn('discount_value', ctx.exception.message_dict)

    def test_percentage_over_100_is_rejected_in_clean_and_database(self):
        start, end = window()
        offer = Offer(name='Too much', discount_type=DiscountType.PERCENTAGE,
                      discount_value=Decimal('100.01'), applicable_type=ApplicableType.ALL_PRODUCTS,
                      start_date=start, end_date=end)
        with self.assertRaises(ValidationError):
            offer.clean()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Offer.objects.create(name='Too much', discount_type=DiscountType.PERCENTAGE,
                                 discount_value=Decimal('100.01'),
                                 applicable_type=ApplicableType.ALL_PRODUCTS,
                                 start_date=start, end_date=end)

    def test_end_before_start_is_rejected(self):
        start, end = window()
        with self.assertRaises(ValidationError) as ctx:
            Offer(name='Backwards', discount_type=DiscountType.FIXED, discount_value=Decimal('5'),
                  applicable_type=ApplicableType.ALL_PRODUCTS,
                  start_date=end, end_date=start).clean()
        self.assertIn('end_date', ctx.exception.message_dict)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Offer.objects.create(name='Backwards', discount_type=DiscountType.FIXED,
                                 discount_value=Decimal('5'),
                                 applicable_type=ApplicableType.ALL_PRODUCTS,
                                 start_date=end, end_date=start)

    def test_end_equal_to_start_is_rejected(self):
        start, _ = window()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Offer.objects.create(name='Empty', discount_type=DiscountType.FIXED,
                                 discount_value=Decimal('5'),
                                 applicable_type=ApplicableType.ALL_PRODUCTS,
                                 start_date=start, end_date=start)

    def test_maximum_discount_only_for_percentage_and_must_be_positive(self):
        with self.assertRaises(ValidationError) as ctx:
            Offer(name='Capped fixed', discount_type=DiscountType.FIXED, discount_value=Decimal('5'),
                  maximum_discount=Decimal('50'), applicable_type=ApplicableType.ALL_PRODUCTS,
                  **dict(zip(('start_date', 'end_date'), window()))).clean()
        self.assertIn('maximum_discount', ctx.exception.message_dict)
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_offer(maximum_discount=Decimal('0.00'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'),
                       maximum_discount=Decimal('50'))

    def test_negative_minimum_order_is_rejected(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_offer(minimum_order_amount=Decimal('-1'))

    def test_expired_inactive_and_future_offers_are_not_live(self):
        offer = make_offer()
        self.assertTrue(offer.is_live())
        offer.is_active = False
        self.assertFalse(offer.is_live())
        offer.is_active = True
        offer.end_date = timezone.now() - timedelta(minutes=1)
        offer.start_date = timezone.now() - timedelta(days=2)
        self.assertFalse(offer.is_live())
        offer.start_date = timezone.now() + timedelta(days=1)
        offer.end_date = timezone.now() + timedelta(days=2)
        self.assertFalse(offer.is_live())


class OfferTargetTests(TestCase):

    def setUp(self):
        self.category = ProductCategory.objects.create(name='Spices')
        self.other_category = ProductCategory.objects.create(name='Grains')
        self.turmeric = Product.objects.create(product_category=self.category, name='Turmeric',
                                               price=Decimal('50'), stock_quantity=5, unit='kg')

    def test_store_wide_offer_rejects_links(self):
        offer = make_offer(applicable_type=ApplicableType.ALL_PRODUCTS)
        offer.check_targets()
        OfferProduct.objects.create(offer=offer, product=self.turmeric)
        with self.assertRaises(ValidationError):
            offer.check_targets()

    def test_product_offer_needs_a_product(self):
        offer = make_offer(applicable_type=ApplicableType.SPECIFIC_PRODUCTS)
        with self.assertRaises(ValidationError):
            offer.check_targets()
        OfferProduct.objects.create(offer=offer, product=self.turmeric)
        offer.check_targets()

    def test_category_offer_needs_a_category_and_no_products(self):
        offer = make_offer(applicable_type=ApplicableType.CATEGORIES)
        with self.assertRaises(ValidationError):
            offer.check_targets()
        OfferCategory.objects.create(offer=offer, category=self.category)
        offer.check_targets()
        OfferProduct.objects.create(offer=offer, product=self.turmeric)
        with self.assertRaises(ValidationError):
            offer.check_targets()

    def test_unsaved_offer_cannot_be_target_checked(self):
        start, end = window()
        offer = Offer(name='x', discount_type=DiscountType.FIXED, discount_value=Decimal('1'),
                      applicable_type=ApplicableType.ALL_PRODUCTS, start_date=start, end_date=end)
        with self.assertRaises(ValidationError):
            offer.check_targets()

    def test_same_product_cannot_be_linked_twice(self):
        offer = make_offer(applicable_type=ApplicableType.SPECIFIC_PRODUCTS)
        OfferProduct.objects.create(offer=offer, product=self.turmeric)
        with self.assertRaises(IntegrityError), transaction.atomic():
            OfferProduct.objects.create(offer=offer, product=self.turmeric)

    def test_same_category_cannot_be_linked_twice(self):
        offer = make_offer(applicable_type=ApplicableType.CATEGORIES)
        OfferCategory.objects.create(offer=offer, category=self.other_category)
        with self.assertRaises(IntegrityError), transaction.atomic():
            OfferCategory.objects.create(offer=offer, category=self.other_category)

    def test_deleting_an_offer_removes_its_links_only(self):
        offer = make_offer(applicable_type=ApplicableType.SPECIFIC_PRODUCTS)
        OfferProduct.objects.create(offer=offer, product=self.turmeric)
        offer.delete()
        self.assertTrue(Product.objects.filter(pk=self.turmeric.pk).exists())
        self.assertEqual(OfferProduct.objects.count(), 0)

    def test_offer_keeps_creator_reference_until_user_is_removed(self):
        admin = make_user('admin@example.com', is_staff=True)
        offer = make_offer(created_by=admin)
        admin.delete()
        offer.refresh_from_db()
        self.assertIsNone(offer.created_by)


class CouponValidationTests(TestCase):

    def test_code_is_normalized_to_uppercase_on_save(self):
        coupon = make_coupon(code='  welcome10 ')
        self.assertEqual(coupon.code, 'WELCOME10')
        coupon.refresh_from_db()
        self.assertEqual(coupon.code, 'WELCOME10')

    def test_codes_are_unique_after_normalization(self):
        make_coupon(code='WELCOME10')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='welcome10')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code=' WELCOME10 ')

    def test_invalid_code_formats_are_rejected(self):
        for bad in ('AB', 'HAS SPACE', 'BAD$CODE', '-LEADING', 'A' * 31):
            with self.subTest(code=bad):
                coupon = Coupon(code=bad, discount_type=DiscountType.FIXED,
                                discount_value=Decimal('5'), **dict(zip(
                                    ('start_date', 'end_date'), window())))
                with self.assertRaises(ValidationError) as ctx:
                    coupon.clean()
                self.assertIn('code', ctx.exception.message_dict)

    def test_invalid_code_is_rejected_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='no spaces')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='ab')

    def test_discount_rules_are_enforced(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='ZERO', discount_value=Decimal('0'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='TOOBIG', discount_value=Decimal('101'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='CAPFIX', discount_type=DiscountType.FIXED, maximum_discount=Decimal('5'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='NEGMIN', minimum_order_amount=Decimal('-1'))

    def test_limits_must_be_positive_when_set(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='NOLIMIT', usage_limit=0)
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_coupon(code='NOPER', usage_limit_per_customer=0)
        make_coupon(code='FREE', usage_limit=None, usage_limit_per_customer=None)

    def test_clean_reports_field_errors_together(self):
        start, end = window()
        coupon = Coupon(code='x', discount_type=DiscountType.PERCENTAGE, discount_value=Decimal('150'),
                        usage_limit=0, start_date=end, end_date=start)
        with self.assertRaises(ValidationError) as ctx:
            coupon.clean()
        self.assertEqual(set(ctx.exception.message_dict),
                         {'code', 'discount_value', 'end_date', 'usage_limit'})

    def test_used_count_cannot_exceed_usage_limit(self):
        coupon = make_coupon(code='ONCE', usage_limit=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Coupon.objects.filter(pk=coupon.pk).update(used_count=2)

    def test_used_count_cannot_go_negative(self):
        coupon = make_coupon(code='NEG')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Coupon.objects.filter(pk=coupon.pk).update(used_count=-1)

    def test_used_count_is_not_editable_in_forms(self):
        self.assertFalse(Coupon._meta.get_field('used_count').editable)

    def test_window_and_active_flag(self):
        coupon = make_coupon(code='WINDOW')
        self.assertTrue(coupon.is_within_window())
        coupon.is_active = False
        self.assertFalse(coupon.is_within_window())
        coupon.is_active = True
        coupon.end_date = timezone.now() - timedelta(seconds=1)
        coupon.start_date = timezone.now() - timedelta(days=1)
        self.assertFalse(coupon.is_within_window())


class CouponUsageModelTests(TestCase):

    def setUp(self):
        self.coupon = make_coupon(code='USAGE10')
        self.customer = make_user('usage@example.com')
        self.order = make_order(self.customer)

    def make_usage(self, **extra):
        values = dict(coupon=self.coupon, customer=self.customer, order=self.order,
                      discount_amount=Decimal('50.00'))
        values.update(extra)
        return CouponUsage.objects.create(**values)

    def test_one_usage_per_order(self):
        self.make_usage()
        other_coupon = make_coupon(code='OTHER10')
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_usage(coupon=other_coupon)

    def test_reserved_usage_has_no_release_fields(self):
        usage = self.make_usage()
        self.assertEqual(usage.status, CouponUsageStatus.RESERVED)
        self.assertIsNone(usage.released_at)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CouponUsage.objects.filter(pk=usage.pk).update(release_reason='cancelled')

    def test_released_usage_requires_release_time(self):
        usage = self.make_usage()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CouponUsage.objects.filter(pk=usage.pk).update(status=CouponUsageStatus.RELEASED)

    def test_discount_amount_cannot_be_negative(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_usage(discount_amount=Decimal('-0.01'))

    def test_coupon_and_customer_are_protected_from_deletion(self):
        self.make_usage()
        with self.assertRaises(ProtectedError):
            self.coupon.delete()
        with self.assertRaises(ProtectedError):
            self.customer.delete()

    def test_order_cannot_be_deleted_while_usage_exists(self):
        self.make_usage()
        with self.assertRaises(ProtectedError):
            self.order.delete()


class OrderSnapshotCompatibilityTests(TestCase):
    """Existing orders keep their values. New snapshot fields default to empty."""

    def test_new_order_fields_default_to_no_discount(self):
        customer = make_user('legacy@example.com')
        order = make_order(customer, subtotal='300.00')
        order.refresh_from_db()
        self.assertEqual(order.coupon_code, '')
        self.assertEqual(order.coupon_discount, Decimal('0.00'))
        self.assertEqual(order.offer_discount, Decimal('0.00'))
        self.assertEqual(order.applied_offers, [])
        self.assertEqual(order.total_amount, Decimal('300.00'))

    def test_discount_must_equal_offer_plus_coupon_parts(self):
        customer = make_user('parts@example.com')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_order(customer, subtotal='300.00', discount_amount=Decimal('30.00'),
                       offer_discount=Decimal('10.00'), coupon_discount=Decimal('10.00'))

    def test_consistent_discount_parts_are_saved_as_snapshot(self):
        customer = make_user('snap@example.com')
        order = make_order(customer, subtotal='300.00', discount_amount=Decimal('30.00'),
                           offer_discount=Decimal('10.00'), coupon_discount=Decimal('20.00'),
                           coupon_code='SAVE20', total_amount=Decimal('270.00'),
                           applied_offers=[{'name': 'Monsoon sale', 'amount': '10.00'}])
        order.refresh_from_db()
        self.assertEqual(order.coupon_code, 'SAVE20')
        self.assertEqual(order.applied_offers[0]['name'], 'Monsoon sale')

    def test_negative_discount_parts_are_rejected(self):
        customer = make_user('neg@example.com')
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_order(customer, subtotal='300.00', discount_amount=Decimal('-5.00'),
                       offer_discount=Decimal('-5.00'), coupon_discount=Decimal('0.00'))