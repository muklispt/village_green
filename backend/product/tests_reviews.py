"""Tests for the product review / rating feature."""
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status

from .media_helpers import ProductAPIBase
from .models import ProductReview, ProductVariant


User = get_user_model()


class ReviewTestBase(ProductAPIBase):
    """Shared fixtures: product from the base class + a second customer."""

    def setUp(self):
        super().setUp()
        self.other_customer = User.objects.create_user(
            email='other.customer@example.com',
            full_name='Other Customer',
            password='StrongPass@123',
        )
        self.reviews_url = f'/api/v1/product/products/{self.product.id}/reviews/'
        self.my_reviews_url = '/api/v1/product/my-reviews/'

    def make_review(self, user=None, product=None, rating=5,
                    text='Very good product', approved=False):
        return ProductReview.objects.create(
            user=user or self.customer,
            product=product or self.product,
            rating=rating,
            review_text=text,
            is_approved=approved,
        )


class ReviewCreationTests(ReviewTestBase):

    def test_authenticated_user_can_submit_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url,
            {'rating': 4, 'review_text': '  Fresh and well packed  '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        review = ProductReview.objects.get(id=response.data['id'])
        self.assertEqual(review.user, self.customer)       # from request.user
        self.assertEqual(review.product, self.product)     # from the URL
        self.assertEqual(review.rating, 4)
        self.assertEqual(review.review_text, 'Fresh and well packed')  # trimmed
        self.assertFalse(review.is_approved)               # always pending
        self.assertEqual(response.data['display_name'], self.customer.full_name)
        self.assertFalse(response.data['is_approved'])

    def test_unauthenticated_user_cannot_submit_review(self):
        response = self.client.post(
            self.reviews_url, {'rating': 5, 'review_text': 'Nice'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(ProductReview.objects.count(), 0)

    def test_rating_below_one_is_rejected(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url, {'rating': 0, 'review_text': 'bad'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('rating', response.data)
        self.assertEqual(ProductReview.objects.count(), 0)

    def test_rating_above_five_is_rejected(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url, {'rating': 6, 'review_text': 'great'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('rating', response.data)

    def test_non_integer_rating_is_rejected(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url, {'rating': 'five'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('rating', response.data)

    def test_overlong_review_text_is_rejected(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url,
            {'rating': 5, 'review_text': 'x' * 2001},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('review_text', response.data)
        self.assertEqual(ProductReview.objects.count(), 0)

    def test_review_text_of_exactly_max_length_is_accepted(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url,
            {'rating': 5, 'review_text': 'x' * 2000},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_inactive_product_cannot_receive_review(self):
        inactive = self.make_product('Inactive Product', is_active=False)
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            f'/api/v1/product/products/{inactive.id}/reviews/',
            {'rating': 5, 'review_text': 'hidden'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(ProductReview.objects.filter(product=inactive).exists())

    def test_nonexistent_product_returns_404(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            '/api/v1/product/products/11111111-1111-1111-1111-111111111111/reviews/',
            {'rating': 5, 'review_text': 'ghost'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_malformed_product_uuid_returns_404(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.get('/api/v1/product/products/not-a-uuid/reviews/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_backend_controlled_fields_cannot_be_overridden(self):
        fake_id = '11111111-1111-1111-1111-111111111111'
        self.client.force_authenticate(user=self.customer)
        response = self.client.post(
            self.reviews_url,
            {
                'id': fake_id,
                'rating': 2,
                'review_text': 'attempted override',
                'user': str(self.other_customer.id),
                'user_id': str(self.other_customer.id),
                'product': str(self.make_product('Another Product').id),
                'is_approved': True,
                'created_at': '2000-01-01T00:00:00Z',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        review = ProductReview.objects.get(id=response.data['id'])
        self.assertNotEqual(str(review.id), fake_id)
        self.assertEqual(review.user, self.customer)
        self.assertEqual(review.product, self.product)
        self.assertFalse(review.is_approved)

    def test_customer_cannot_submit_two_reviews_for_same_product(self):
        self.client.force_authenticate(user=self.customer)
        first = self.client.post(
            self.reviews_url, {'rating': 5, 'review_text': 'first'}, format='json'
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            self.reviews_url, {'rating': 1, 'review_text': 'second'}, format='json'
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', second.data)
        self.assertEqual(ProductReview.objects.count(), 1)

    def test_database_unique_constraint_holds_without_serializer(self):
        self.make_review(user=self.customer)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self.make_review(user=self.customer, rating=1)

    def test_database_check_constraint_rejects_out_of_range_rating(self):
        for bad_rating in (0, 6):
            with self.assertRaises(IntegrityError):
                with transaction.atomic():
                    ProductReview.objects.create(
                        user=self.customer,
                        product=self.product,
                        rating=bad_rating,
                        review_text='bypassing the serializer',
                    )
        self.assertEqual(ProductReview.objects.count(), 0)

    def test_concurrent_duplicate_is_caught_by_database_constraint(self):
        """Simulates a race: the pre-check passes, the unique index still wins."""
        self.client.force_authenticate(user=self.customer)
        first = self.client.post(
            self.reviews_url, {'rating': 5, 'review_text': 'first'}, format='json'
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        with patch(
            'product.serializers.ProductReviewCreateSerializer._already_reviewed',
            return_value=False,
        ):
            second = self.client.post(
                self.reviews_url, {'rating': 4, 'review_text': 'race'}, format='json'
            )

        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', second.data)
        self.assertEqual(ProductReview.objects.count(), 1)

    def test_duplicate_error_does_not_leak_sql(self):
        self.client.force_authenticate(user=self.customer)
        self.client.post(self.reviews_url, {'rating': 5}, format='json')
        with patch(
            'product.serializers.ProductReviewCreateSerializer._already_reviewed',
            return_value=False,
        ):
            response = self.client.post(self.reviews_url, {'rating': 4}, format='json')

        body = str(response.data).lower()
        for leak in ('unique constraint', 'duplicate key', 'sql', 'insert into', 'traceback'):
            self.assertNotIn(leak, body)


class ReviewVisibilityTests(ReviewTestBase):

    def setUp(self):
        super().setUp()
        self.approved = self.make_review(
            user=self.customer, rating=5, text='Approved text', approved=True
        )
        self.pending = self.make_review(
            user=self.other_customer, rating=1, text='Secret pending text', approved=False
        )

    def test_public_can_read_approved_reviews(self):
        response = self.client.get(self.reviews_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in response.data['results']]
        self.assertIn(str(self.approved.id), ids)

    def test_public_cannot_see_pending_reviews(self):
        response = self.client.get(self.reviews_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in response.data['results']]
        self.assertNotIn(str(self.pending.id), ids)
        self.assertNotIn('Secret pending text', str(response.data))

    def test_approved_review_payload_has_expected_shape(self):
        response = self.client.get(self.reviews_url)
        item = response.data['results'][0]
        for key in (
            'id', 'product', 'product_name', 'display_name', 'rating',
            'review_text', 'is_approved', 'created_at', 'updated_at',
        ):
            self.assertIn(key, item)
        self.assertNotIn('user', item)

    def test_public_reviews_of_inactive_product_are_not_listed(self):
        self.product.is_active = False
        self.product.save(update_fields=['is_active'])
        response = self.client.get(self.reviews_url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reviews_endpoint_is_paginated(self):
        for i in range(12):
            user = User.objects.create_user(
                email=f'reviewer{i}@example.com', full_name=f'Reviewer {i}'
            )
            self.make_review(user=user, rating=4, text=f'ok {i}', approved=True)

        response = self.client.get(self.reviews_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('count', response.data)
        self.assertIn('results', response.data)
        self.assertEqual(len(response.data['results']), 10)  # page_size

    def test_customer_can_list_own_pending_reviews(self):
        self.client.force_authenticate(user=self.other_customer)
        response = self.client.get(self.my_reviews_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in response.data['results']]
        self.assertEqual(ids, [str(self.pending.id)])

    def test_my_reviews_requires_authentication(self):
        response = self.client.get(self.my_reviews_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_my_reviews_never_include_other_customers(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.get(self.my_reviews_url)
        ids = [item['id'] for item in response.data['results']]
        self.assertEqual(ids, [str(self.approved.id)])

    def test_customer_cannot_read_another_customers_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.get(f'{self.my_reviews_url}{self.pending.id}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_customer_cannot_update_another_customers_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.patch(
            f'{self.my_reviews_url}{self.pending.id}/',
            {'rating': 5, 'review_text': 'hijacked'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.rating, 1)
        self.assertEqual(self.pending.review_text, 'Secret pending text')

    def test_customer_cannot_delete_another_customers_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.delete(f'{self.my_reviews_url}{self.pending.id}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ProductReview.objects.filter(id=self.pending.id).exists())

    def test_owner_can_update_own_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.patch(
            f'{self.my_reviews_url}{self.approved.id}/',
            {'rating': 4, 'review_text': '  edited text  '},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.approved.refresh_from_db()
        self.assertEqual(self.approved.rating, 4)
        self.assertEqual(self.approved.review_text, 'edited text')

    def test_editing_a_review_resets_approval(self):
        self.assertTrue(self.approved.is_approved)
        self.client.force_authenticate(user=self.customer)
        response = self.client.patch(
            f'{self.my_reviews_url}{self.approved.id}/',
            {'rating': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.approved.refresh_from_db()
        self.assertFalse(self.approved.is_approved)
        self.assertFalse(response.data['is_approved'])

    def test_customer_cannot_approve_own_review_via_crafted_patch(self):
        self.client.force_authenticate(user=self.other_customer)
        response = self.client.patch(
            f'{self.my_reviews_url}{self.pending.id}/',
            {'is_approved': True, 'rating': 5},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.pending.refresh_from_db()
        self.assertFalse(self.pending.is_approved)

    def test_customer_cannot_reassign_review_to_another_product_or_user(self):
        other_product = self.make_product('Other Product')
        self.client.force_authenticate(user=self.customer)
        response = self.client.patch(
            f'{self.my_reviews_url}{self.approved.id}/',
            {
                'product': str(other_product.id),
                'user': str(self.other_customer.id),
                'display_name': 'Hacker',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.approved.refresh_from_db()
        self.assertEqual(self.approved.product, self.product)
        self.assertEqual(self.approved.user, self.customer)

    def test_owner_can_delete_own_review(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.delete(f'{self.my_reviews_url}{self.approved.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProductReview.objects.filter(id=self.approved.id).exists())

    def test_nonexistent_review_returns_404(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.get(
            f'{self.my_reviews_url}11111111-1111-1111-1111-111111111111/'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_malformed_review_uuid_returns_404(self):
        self.client.force_authenticate(user=self.customer)
        response = self.client.get(f'{self.my_reviews_url}not-a-uuid/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_ordinary_customer_cannot_moderate_through_product_endpoint(self):
        self.client.force_authenticate(user=self.other_customer)
        response = self.client.patch(
            f'/api/v1/product/products/{self.product.id}/',
            {'is_approved': True},
            format='json',
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class ReviewAggregationTests(ReviewTestBase):

    def setUp(self):
        super().setUp()
        self.list_url = '/api/v1/product/products/'

    def get_product_from_list(self, product=None):
        product = product or self.product
        response = self.client.get(self.list_url, {'page_size': 50})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return next(
            item for item in response.data['results'] if item['id'] == str(product.id)
        )

    def test_average_rating_uses_only_approved_reviews(self):
        self.make_review(rating=5, approved=True)
        self.make_review(user=self.other_customer, rating=1, approved=False)

        item = self.get_product_from_list()
        self.assertEqual(item['approved_review_count'], 1)
        self.assertEqual(item['average_rating'], 5.0)

    def test_review_count_excludes_pending_reviews(self):
        self.make_review(rating=4, approved=True)
        watcher = User.objects.create_user(email='w@example.com', full_name='Watcher')
        self.make_review(user=watcher, rating=4, approved=False)

        item = self.get_product_from_list()
        self.assertEqual(item['approved_review_count'], 1)

    def test_product_without_reviews_returns_null_and_zero(self):
        item = self.get_product_from_list()
        self.assertIsNone(item['average_rating'])
        self.assertEqual(item['approved_review_count'], 0)

    def test_average_rating_is_rounded_to_two_decimals(self):
        for rating in (5, 5, 4):
            reviewer = User.objects.create_user(
                email=f'r{rating}{ProductReview.objects.count()}@example.com',
                full_name='Reviewer',
            )
            self.make_review(user=reviewer, rating=rating, approved=True)

        item = self.get_product_from_list()
        self.assertEqual(item['average_rating'], 4.67)
        self.assertEqual(item['approved_review_count'], 3)

    def test_product_detail_exposes_rating_fields(self):
        self.make_review(rating=3, approved=True)
        response = self.client.get(f'/api/v1/product/products/{self.product.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['approved_review_count'], 1)
        self.assertEqual(response.data['average_rating'], 3.0)

    def test_existing_product_fields_are_preserved(self):
        item = self.get_product_from_list()
        for key in (
            'id', 'product_category', 'category_name', 'name', 'slug', 'price',
            'unit', 'stock_quantity', 'is_in_stock', 'has_variants', 'is_active',
            'product_img', 'primary_image', 'variants', 'variants_count',
        ):
            self.assertIn(key, item)

    def test_inactive_product_with_approved_reviews_is_not_public(self):
        self.make_review(rating=5, approved=True)
        self.product.is_active = False
        self.product.save(update_fields=['is_active'])
        response = self.client.get(self.list_url)
        ids = [item['id'] for item in response.data['results']]
        self.assertNotIn(str(self.product.id), ids)

    def test_rating_aggregation_does_not_duplicate_with_variant_or_image_joins(self):
        ProductVariant.objects.create(
            product=self.product, sku='TUR-500G', quantity=Decimal('500'),
            unit='g', price=Decimal('90.00'), mrp=Decimal('100.00'),
            stock_quantity=4, is_active=True,
        )
        self.make_review(rating=5, approved=True)
        self.make_review(user=self.other_customer, rating=5, approved=True)

        item = self.get_product_from_list()
        # the variant is prefetched separately and must not inflate the counts
        self.assertEqual(item['approved_review_count'], 2)
        self.assertEqual(item['average_rating'], 5.0)

    def test_product_list_query_count_does_not_grow_with_reviews(self):
        """Reviews must be aggregated in the product query (no N+1)."""
        def count_list_queries():
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get(self.list_url)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
            return len(ctx.captured_queries)

        baseline = count_list_queries()

        for user_number in range(4):
            reviewer = User.objects.create_user(
                email=f'perf{user_number}@example.com',
                full_name=f'Perf Reviewer {user_number}',
            )
            self.make_review(user=reviewer, rating=5 - user_number, approved=True)

        with_reviews = count_list_queries()
        self.assertEqual(
            with_reviews, baseline,
            msg=f'product list ran {with_reviews} queries with reviews vs '
                f'{baseline} without; aggregation is issuing per-product queries',
        )

    def test_review_list_select_related_avoids_per_review_queries(self):
        for i in range(5):
            reviewer = User.objects.create_user(
                email=f'sel{i}@example.com', full_name=f'Select Reviewer {i}'
            )
            self.make_review(user=reviewer, rating=5, approved=True)

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(self.reviews_url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(len(response.data['results']), 5)

        # 1 count + 1 page of reviews joined with users + product/session noise
        self.assertLessEqual(len(ctx.captured_queries), 3)


class ReviewAdminModerationTests(ReviewTestBase):
    """Moderation lives in Django admin and is limited to staff accounts."""

    def setUp(self):
        super().setUp()
        self.changelist_url = reverse('admin:product_productreview_changelist')
        self.review = self.make_review(
            user=self.customer, rating=4, text='Admin moderation sample'
        )

    def test_staff_can_open_review_changelist(self):
        self.client.force_login(self.admin)
        response = self.client.get(self.changelist_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertContains(response, 'Turmeric Powder')
        self.assertContains(response, self.customer.email)

    def test_non_staff_customer_is_redirected_to_admin_login(self):
        self.client.force_login(self.customer)
        response = self.client.get(self.changelist_url)
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)
        self.assertIn(f'/{settings.DJANGO_ADMIN_PATH}login/', response['Location'])

    def test_anonymous_user_is_redirected_to_admin_login(self):
        response = self.client.get(self.changelist_url)
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)
        self.assertIn(f'/{settings.DJANGO_ADMIN_PATH}login/', response['Location'])

    def run_admin_action(self, action, review):
        return self.client.post(
            self.changelist_url,
            {'action': action, '_selected_action': [str(review.id)]},
            follow=True,
        )

    def test_admin_can_approve_review(self):
        self.assertFalse(self.review.is_approved)
        self.client.force_login(self.admin)
        self.run_admin_action('approve_reviews', self.review)
        self.review.refresh_from_db()
        self.assertTrue(self.review.is_approved)

    def test_admin_can_reject_review(self):
        self.review.is_approved = True
        self.review.save(update_fields=['is_approved'])
        self.client.force_login(self.admin)
        self.run_admin_action('reject_reviews', self.review)
        self.review.refresh_from_db()
        self.assertFalse(self.review.is_approved)