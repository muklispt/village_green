import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from orders.factories import make_product, make_user
from product.models import ProductCategory

from .discounts import calculate_discounts
from .factories import make_offer, window
from .models import ApplicableType, DiscountType, Offer, OfferCategory, OfferProduct
from .offer_services import create_offer, update_offer


class OfferServiceBase(TestCase):

    def setUp(self):
        self.spices = ProductCategory.objects.create(name='Spices')
        self.grains = ProductCategory.objects.create(name='Grains')
        self.rice = make_product(self.grains, 'Rice', price='60.00', stock=10)
        self.turmeric = make_product(self.spices, 'Turmeric', price='100.00', stock=10)
        self.admin = make_user('admin@example.com')

    def fields(self, **extra):
        start, end = window()
        values = dict(name='Harvest', discount_type=DiscountType.PERCENTAGE,
                      discount_value=Decimal('10.00'),
                      applicable_type=ApplicableType.ALL_PRODUCTS, is_active=True,
                      start_date=start, end_date=end)
        values.update(extra)
        return values


class CreateOfferTests(OfferServiceBase):

    def test_store_wide_offer_is_created_without_links(self):
        offer = create_offer(fields=self.fields(), created_by=self.admin)
        self.assertEqual(offer.created_by, self.admin)
        self.assertFalse(offer.offer_products.exists())
        self.assertFalse(offer.offer_categories.exists())

    def test_store_wide_offer_rejects_product_links(self):
        with self.assertRaises(ValidationError) as ctx:
            create_offer(fields=self.fields(), product_ids=[self.rice.pk])
        self.assertIn('applicable_type', ctx.exception.detail)
        self.assertFalse(Offer.objects.filter(name='Harvest').exists())

    def test_store_wide_offer_rejects_category_links(self):
        with self.assertRaises(ValidationError):
            create_offer(fields=self.fields(), category_ids=[self.grains.pk])
        self.assertFalse(Offer.objects.exists())

    def test_product_offer_needs_at_least_one_product(self):
        with self.assertRaises(ValidationError):
            create_offer(fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS))
        self.assertFalse(Offer.objects.exists())

    def test_product_offer_rejects_category_links(self):
        with self.assertRaises(ValidationError):
            create_offer(
                fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
                product_ids=[self.rice.pk], category_ids=[self.grains.pk],
            )
        self.assertFalse(Offer.objects.exists())

    def test_product_offer_is_created_with_links(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[str(self.rice.pk)],
        )
        self.assertEqual(list(offer.offer_products.values_list('product_id', flat=True)),
                         [self.rice.pk])

    def test_category_offer_needs_at_least_one_category(self):
        with self.assertRaises(ValidationError):
            create_offer(fields=self.fields(applicable_type=ApplicableType.CATEGORIES))

    def test_category_offer_rejects_product_links(self):
        with self.assertRaises(ValidationError):
            create_offer(
                fields=self.fields(applicable_type=ApplicableType.CATEGORIES),
                category_ids=[self.grains.pk], product_ids=[self.rice.pk],
            )

    def test_category_offer_is_created_with_links(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.CATEGORIES),
            category_ids=[self.grains.pk],
        )
        self.assertEqual(list(offer.offer_categories.values_list('category_id', flat=True)),
                         [self.grains.pk])

    def test_nonexistent_product_is_rejected_and_nothing_is_written(self):
        with self.assertRaises(ValidationError):
            create_offer(
                fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
                product_ids=[str(uuid.uuid4())],
            )
        self.assertFalse(Offer.objects.exists())
        self.assertFalse(OfferProduct.objects.exists())

    def test_malformed_link_id_is_rejected(self):
        with self.assertRaises(ValidationError):
            create_offer(
                fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
                product_ids=['not-a-uuid'],
            )

    def test_fixed_offer_is_created_through_the_service(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS,
                               discount_type=DiscountType.FIXED, discount_value=Decimal('20'),
                               maximum_discount=Decimal('100')),
            product_ids=[self.rice.pk],
        )
        self.assertEqual(offer.discount_type, DiscountType.FIXED)
        self.assertEqual(offer.maximum_discount, Decimal('100.00'))
        self.assertEqual(offer.offer_products.count(), 1)

    def test_percentage_over_one_hundred_is_refused(self):
        with self.assertRaises(ValidationError):
            create_offer(fields=self.fields(discount_value=Decimal('150')))

    def test_end_before_start_is_refused(self):
        now = timezone.now()
        with self.assertRaises(ValidationError):
            create_offer(fields=self.fields(start_date=now, end_date=now - timedelta(days=1)))

    def test_unknown_fields_are_ignored(self):
        offer = create_offer(fields=self.fields(used_count=99, id=str(uuid.uuid4())))
        self.assertEqual(offer.name, 'Harvest')


class UpdateOfferTests(OfferServiceBase):

    def test_update_keeps_links_when_none_are_passed(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        updated = update_offer(offer, fields={'discount_value': Decimal('20')})
        self.assertEqual(updated.discount_value, Decimal('20'))
        self.assertEqual(list(updated.offer_products.values_list('product_id', flat=True)),
                         [self.rice.pk])

    def test_update_to_a_different_product_replaces_links(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        update_offer(offer, fields={}, product_ids=[self.turmeric.pk])
        self.assertEqual(list(offer.offer_products.values_list('product_id', flat=True)),
                         [self.turmeric.pk])

    def test_keeps_existing_link_rows_that_remain_wanted(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        kept_pk = offer.offer_products.get().pk
        update_offer(offer, fields={}, product_ids=[self.rice.pk, self.turmeric.pk])
        self.assertTrue(OfferProduct.objects.filter(pk=kept_pk).exists())
        self.assertEqual(offer.offer_products.count(), 2)

    def test_changing_scope_to_store_wide_requires_clearing_links(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        with self.assertRaises(ValidationError):
            update_offer(offer, fields={'applicable_type': ApplicableType.ALL_PRODUCTS})
        offer.refresh_from_db()
        self.assertEqual(offer.applicable_type, ApplicableType.SPECIFIC_PRODUCTS)
        self.assertEqual(offer.offer_products.count(), 1)

    def test_changing_scope_and_clearing_links_succeeds(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        update_offer(offer, fields={'applicable_type': ApplicableType.ALL_PRODUCTS},
                     product_ids=[])
        self.assertEqual(offer.offer_products.count(), 0)

    def test_failed_update_leaves_offer_and_links_unchanged(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS),
            product_ids=[self.rice.pk],
        )
        with self.assertRaises(ValidationError):
            update_offer(offer, fields={'discount_value': Decimal('30')}, product_ids=[])
        offer.refresh_from_db()
        self.assertEqual(offer.discount_value, Decimal('10.00'))
        self.assertEqual(offer.offer_products.count(), 1)

    def test_offer_can_be_switched_to_fixed_through_the_service(self):
        offer = create_offer(fields=self.fields())
        update_offer(offer, fields={'discount_type': DiscountType.FIXED, 'discount_value': Decimal('5')})
        offer.refresh_from_db()
        self.assertEqual(offer.discount_type, DiscountType.FIXED)
        self.assertEqual(offer.discount_value, Decimal('5.00'))

    def test_fixed_offer_maximum_can_be_set_and_changed_through_the_service(self):
        offer = create_offer(fields=self.fields(discount_type=DiscountType.FIXED,
                                                discount_value=Decimal('5')))
        update_offer(offer, fields={'maximum_discount': Decimal('40')})
        offer.refresh_from_db()
        self.assertEqual(offer.maximum_discount, Decimal('40.00'))

    def test_percentage_offer_cannot_be_switched_to_a_zero_maximum(self):
        offer = create_offer(fields=self.fields())
        with self.assertRaises(ValidationError):
            update_offer(offer, fields={'maximum_discount': Decimal('0')})
        offer.refresh_from_db()
        self.assertIsNone(offer.maximum_discount)

    def test_existing_fixed_offer_can_still_be_disabled(self):
        offer = make_offer(discount_type=DiscountType.FIXED, discount_value=Decimal('5'))
        update_offer(offer, fields={'is_active': False})
        offer.refresh_from_db()
        self.assertFalse(offer.is_active)

    def test_category_link_update_on_category_offer(self):
        offer = create_offer(
            fields=self.fields(applicable_type=ApplicableType.CATEGORIES),
            category_ids=[self.grains.pk],
        )
        update_offer(offer, fields={}, category_ids=[self.spices.pk])
        self.assertEqual(list(OfferCategory.objects.filter(offer=offer)
                              .values_list('category_id', flat=True)), [self.spices.pk])


class ServiceOutputFeedsEngineTests(OfferServiceBase):

    def test_offer_created_by_service_is_used_by_the_engine(self):
        create_offer(
            fields=self.fields(applicable_type=ApplicableType.SPECIFIC_PRODUCTS, discount_value=Decimal('10')),
            product_ids=[self.rice.pk],
        )
        result = calculate_discounts(
            customer=self.admin,
            items=[{'product_id': str(self.rice.pk), 'quantity': 2}],
        )
        self.assertEqual(result.offer_discount, Decimal('12.00'))

    def test_fixed_offer_created_through_service_is_priced_per_unit(self):
        offer = create_offer(fields=self.fields(discount_type=DiscountType.FIXED,
                                                discount_value=Decimal('20')))
        result = calculate_discounts(customer=self.admin,
                                     items=[{'product_id': str(self.turmeric.pk), 'quantity': 3}])
        self.assertEqual(result.offer_discount, Decimal('60.00'))
        self.assertEqual(result.applied_offers[0].offer_id, offer.pk)

    def test_fixed_offer_updated_through_service_is_priced_per_unit(self):
        offer = create_offer(fields=self.fields())
        update_offer(offer, fields={'discount_type': DiscountType.FIXED,
                                    'discount_value': Decimal('20'),
                                    'maximum_discount': Decimal('50')})
        result = calculate_discounts(customer=self.admin,
                                     items=[{'product_id': str(self.turmeric.pk), 'quantity': 3}])
        self.assertEqual(result.offer_discount, Decimal('50.00'))   # raw 60 capped at 50