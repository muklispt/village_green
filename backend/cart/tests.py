import threading
import time
from decimal import Decimal
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from product.models import Product, ProductCategory, ProductImage, ProductVariant

from . import services
from .models import Cart, CartItem

User = get_user_model()
PASSWORD = 'StrongPass@123'


def make_user(email):
    return User.objects.create_user(email=email, password=PASSWORD, full_name='Test User')


def make_product(category, name, price='50.00', stock=10, **extra):
    return Product.objects.create(
        product_category=category, name=name, price=Decimal(price),
        stock_quantity=stock, unit='kg', **extra,
    )


def make_variant(product, sku, quantity='250', unit='g', price='45.00', mrp='50.00', stock=5, **extra):
    return ProductVariant.objects.create(
        product=product, sku=sku, quantity=Decimal(quantity), unit=unit,
        price=Decimal(price), mrp=Decimal(mrp), stock_quantity=stock, **extra,
    )


class CartBase(APITestCase):

    def setUp(self):
        self.user = make_user('buyer@example.com')
        self.other = make_user('other@example.com')
        self.category = ProductCategory.objects.create(name='Spices')
        # simple product, no variants
        self.rice = make_product(self.category, 'Rice', price='60.00', stock=10)
        # product sold only through variants
        self.turmeric = make_product(self.category, 'Turmeric', stock=0)
        self.v250 = make_variant(self.turmeric, 'TUR-250G', '250', 'g', '45.00', '50.00', stock=5)
        self.v500 = make_variant(self.turmeric, 'TUR-500G', '500', 'g', '85.00', '100.00', stock=2)
        self.cart_url = reverse('cart')
        self.items_url = reverse('cart-items')
        self.client.force_authenticate(self.user)

    def add(self, product, quantity=1, variant=None, **extra):
        data = {'product': str(product.id), 'quantity': quantity, **extra}
        if variant is not None:
            data['variant'] = str(variant.id)
        return self.client.post(self.items_url, data, format='json')

    def item_url(self, item_id):
        return reverse('cart-item-detail', args=[item_id])


class CartReadTests(CartBase):

    def test_unauthenticated_requests_are_rejected(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.cart_url).status_code, 401)
        self.assertEqual(self.client.post(self.items_url, {}, format='json').status_code, 401)
        self.assertEqual(self.client.delete(self.cart_url).status_code, 401)
        self.assertEqual(self.client.patch(self.item_url(self.rice.id), {}, format='json').status_code, 401)

    def test_user_without_cart_gets_empty_cart_and_no_row_is_created(self):
        response = self.client.get(self.cart_url)

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['id'])
        self.assertEqual(response.data['items'], [])
        self.assertEqual(response.data['subtotal'], '0.00')
        self.assertFalse(response.data['can_checkout'])
        self.assertEqual(Cart.objects.count(), 0)

    def test_user_reads_own_cart_with_server_prices(self):
        self.add(self.rice, 2)
        self.add(self.turmeric, 1, self.v250)
        response = self.client.get(self.cart_url)

        self.assertEqual(response.data['total_quantity'], 3)
        self.assertEqual(response.data['subtotal'], '165.00')   # 2 x 60  1 x 45
        self.assertTrue(response.data['can_checkout'])
        rows = {row['product']['name']: row for row in response.data['items']}
        self.assertEqual(rows['Rice']['unit_price'], '60.00')
        self.assertEqual(rows['Rice']['line_total'], '120.00')
        self.assertIsNone(rows['Rice']['variant'])
        self.assertEqual(rows['Turmeric']['variant']['sku'], 'TUR-250G')
        self.assertEqual(rows['Turmeric']['unit_price'], '45.00')

    def test_cart_shows_primary_image_url(self):
        ProductImage.objects.create(product=self.rice, image='products/images/rice.png', is_primary=True)
        self.add(self.rice)
        image = self.client.get(self.cart_url).data['items'][0]['product']['image']
        self.assertTrue(image.endswith('products/images/rice.png'))

    def test_get_query_count_does_not_grow_with_items(self):
        def count():
            with CaptureQueriesContext(connection) as queries:
                self.client.get(self.cart_url)
            return len(queries)

        self.add(self.rice)
        baseline = count()

        cart = Cart.objects.get(user=self.user)
        for index in range(6):
            product = make_product(self.category, f'Extra {index}')
            ProductImage.objects.create(product=product, image=f'p{index}.png', is_primary=True)
            CartItem.objects.create(cart=cart, product=product, quantity=1)

        self.assertEqual(count(), baseline)


class CartAddTests(CartBase):

    def test_add_valid_product(self):
        response = self.add(self.rice, 3)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['items'][0]['quantity'], 3)
        self.assertEqual(CartItem.objects.count(), 1)

    def test_default_quantity_is_one(self):
        response = self.client.post(self.items_url, {'product': str(self.rice.id)}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['items'][0]['quantity'], 1)

    def test_adding_same_product_twice_increments_without_duplicate(self):
        first = self.add(self.rice, 2)
        second = self.add(self.rice, 3)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 1)
        self.assertEqual(second.data['items'][0]['quantity'], 5)

    def test_different_users_have_separate_carts(self):
        self.add(self.rice, 2)
        self.client.force_authenticate(self.other)
        self.add(self.rice, 7)

        self.assertEqual(Cart.objects.count(), 2)
        mine = CartItem.objects.get(cart__user=self.user)
        theirs = CartItem.objects.get(cart__user=self.other)
        self.assertEqual((mine.quantity, theirs.quantity), (2, 7))

    def test_invalid_input_is_rejected(self):
        cases = [
            ({'product': 'not-a-uuid', 'quantity': 1}, 'product'),
            ({'quantity': 1}, 'product'),
            ({'product': str(self.rice.id), 'quantity': 0}, 'quantity'),
            ({'product': str(self.rice.id), 'quantity': -3}, 'quantity'),
            ({'product': str(self.rice.id), 'quantity': 1.5}, 'quantity'),
            ({'product': str(self.rice.id), 'quantity': 'abc'}, 'quantity'),
            ({'product': str(self.rice.id), 'quantity': 100000}, 'quantity'),
            ({'product': str(self.rice.id), 'variant': 'nope', 'quantity': 1}, 'variant'),
        ]
        for payload, field in cases:
            response = self.client.post(self.items_url, payload, format='json')
            self.assertEqual(response.status_code, 400, payload)
            self.assertIn(field, response.data, payload)
        self.assertEqual(CartItem.objects.count(), 0)

    def test_unknown_product_is_rejected(self):
        response = self.client.post(
            self.items_url,
            {'product': '11111111-1111-1111-1111-111111111111', 'quantity': 1},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('product', response.data)

    def test_inactive_product_cannot_be_added(self):
        self.rice.is_active = False
        self.rice.save()
        response = self.add(self.rice)

        self.assertEqual(response.status_code, 400)
        self.assertIn('product', response.data)
        self.assertEqual(CartItem.objects.count(), 0)

    def test_client_cannot_set_price_user_or_totals(self):
        response = self.add(
            self.rice, 1, price='0.01', unit_price='0.01', subtotal='0.01',
            user=str(self.other.id), cart=str(self.other.id), line_total='0.01',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['subtotal'], '60.00')
        self.assertEqual(CartItem.objects.get().cart.user, self.user)


class CartVariantTests(CartBase):

    def test_product_with_variants_requires_a_variant(self):
        response = self.add(self.turmeric, 1)
        self.assertEqual(response.status_code, 400)
        self.assertIn('variant', response.data)

    def test_variant_from_another_product_is_rejected(self):
        response = self.add(self.rice, 1, self.v250)
        self.assertEqual(response.status_code, 400)
        self.assertIn('variant', response.data)

    def test_inactive_variant_is_rejected(self):
        self.v250.is_active = False
        self.v250.save()
        response = self.add(self.turmeric, 1, self.v250)

        self.assertEqual(response.status_code, 400)
        self.assertIn('variant', response.data)

    def test_variants_are_separate_lines_with_their_own_price_and_stock(self):
        self.add(self.turmeric, 1, self.v250)
        response = self.add(self.turmeric, 2, self.v500)

        self.assertEqual(CartItem.objects.count(), 2)
        self.assertEqual(response.data['subtotal'], '215.00')   # 45  2 x 85

    def test_same_variant_twice_increments(self):
        self.add(self.turmeric, 1, self.v250)
        response = self.add(self.turmeric, 2, self.v250)

        self.assertEqual(CartItem.objects.count(), 1)
        self.assertEqual(response.data['items'][0]['quantity'], 3)

    def test_variant_stock_is_enforced_not_product_stock(self):
        # v500 has stock 2
        over = self.add(self.turmeric, 3, self.v500)
        ok = self.add(self.turmeric, 2, self.v500)

        self.assertEqual(over.status_code, 400)
        self.assertIn('Only 2 available', str(over.data['quantity']))
        self.assertEqual(ok.status_code, 201)

    def test_variant_on_product_without_variants_is_rejected(self):
        other_variant = make_variant(make_product(self.category, 'Other'), 'OTH-1')
        response = self.add(self.rice, 1, other_variant)
        self.assertEqual(response.status_code, 400)


class CartStockTests(CartBase):

    def test_insufficient_stock_on_add(self):
        response = self.add(self.rice, 11)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(str(response.data['quantity'][0]), 'Only 10 available.')

    def test_insufficient_stock_on_increment_mentions_cart_quantity(self):
        self.add(self.rice, 8)
        response = self.add(self.rice, 3)

        self.assertEqual(response.status_code, 400)
        self.assertIn('already have 8', str(response.data['quantity']))
        self.assertEqual(CartItem.objects.get().quantity, 8)

    def test_out_of_stock_product_is_rejected(self):
        self.rice.stock_quantity = 0
        self.rice.save()
        response = self.add(self.rice)

        self.assertEqual(response.status_code, 400)
        self.assertIn('out of stock', str(response.data['quantity']))

    def test_unavailable_line_is_flagged_and_left_out_of_subtotal(self):
        self.add(self.rice, 2)
        self.add(self.turmeric, 1, self.v250)
        self.rice.is_active = False
        self.rice.save()

        data = self.client.get(self.cart_url).data
        rows = {row['product']['name']: row for row in data['items']}

        self.assertFalse(rows['Rice']['is_available'])
        self.assertEqual(rows['Rice']['issue'], 'no_longer_available')
        self.assertEqual(data['subtotal'], '45.00')
        self.assertEqual(data['unavailable_count'], 1)
        self.assertFalse(data['can_checkout'])

    def test_stock_drop_after_adding_is_flagged_not_silently_changed(self):
        self.add(self.rice, 8)
        Product.objects.filter(pk=self.rice.pk).update(stock_quantity=3)

        data = self.client.get(self.cart_url).data
        row = data['items'][0]

        self.assertEqual(row['issue'], 'insufficient_stock')
        self.assertEqual(row['quantity'], 8)
        self.assertEqual(row['available_stock'], 3)
        self.assertEqual(data['subtotal'], '0.00')

    def test_product_that_gained_variants_later_needs_a_size(self):
        self.add(self.rice, 1)
        make_variant(self.rice, 'RICE-1KG', '1', 'kg', '55.00', '60.00', stock=5)

        row = self.client.get(self.cart_url).data['items'][0]
        self.assertEqual(row['issue'], 'variant_required')
        self.assertFalse(row['is_available'])


class CartUpdateRemoveTests(CartBase):

    def setUp(self):
        super().setUp()
        self.item = CartItem.objects.create(
            cart=Cart.objects.create(user=self.user), product=self.rice, quantity=2,
        )

    def test_update_quantity(self):
        response = self.client.patch(self.item_url(self.item.id), {'quantity': 5}, format='json')

        self.assertEqual(response.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 5)
        self.assertEqual(response.data['subtotal'], '300.00')

    def test_update_rejects_bad_quantities_and_over_stock(self):
        for value in (0, -1, 'x', 1.5, 1000):
            response = self.client.patch(self.item_url(self.item.id), {'quantity': value}, format='json')
            self.assertEqual(response.status_code, 400, value)
            self.assertIn('quantity', response.data)

        over = self.client.patch(self.item_url(self.item.id), {'quantity': 11}, format='json')
        self.assertEqual(over.status_code, 400)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 2)

    def test_update_cannot_change_anything_but_quantity(self):
        self.client.patch(
            self.item_url(self.item.id),
            {'quantity': 3, 'product': str(self.turmeric.id), 'price': '1.00'},
            format='json',
        )
        self.item.refresh_from_db()
        self.assertEqual((self.item.quantity, self.item.product_id), (3, self.rice.id))

    def test_cannot_update_inactive_item(self):
        self.rice.is_active = False
        self.rice.save()
        response = self.client.patch(self.item_url(self.item.id), {'quantity': 3}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_remove_item(self):
        response = self.client.delete(self.item_url(self.item.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['items'], [])
        self.assertEqual(CartItem.objects.count(), 0)
        self.assertEqual(self.client.delete(self.item_url(self.item.id)).status_code, 404)

    def test_other_users_item_is_hidden_and_untouched(self):
        self.client.force_authenticate(self.other)

        patch = self.client.patch(self.item_url(self.item.id), {'quantity': 9}, format='json')
        delete = self.client.delete(self.item_url(self.item.id))

        self.assertEqual(patch.status_code, 404)
        self.assertEqual(delete.status_code, 404)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 2)

    def test_other_user_never_sees_my_items(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.cart_url).data['items'], [])

    def test_clear_cart_only_affects_own_cart(self):
        other_cart = Cart.objects.create(user=self.other)
        CartItem.objects.create(cart=other_cart, product=self.rice, quantity=4)

        response = self.client.delete(self.cart_url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['items'], [])
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 0)
        self.assertEqual(CartItem.objects.filter(cart__user=self.other).count(), 1)

    def test_clear_without_a_cart_is_fine(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.delete(self.cart_url).status_code, 200)


class CartLimitTests(CartBase):

    @override_settings(CART_MAX_LINES=2)
    def test_cart_line_limit(self):
        self.add(self.rice)
        self.add(self.turmeric, 1, self.v250)
        extra = make_product(self.category, 'Extra')
        response = self.add(extra)

        self.assertEqual(response.status_code, 400)
        self.assertIn('cart', response.data)
        # existing lines can still grow
        self.assertEqual(self.add(self.rice).status_code, 200)

    @override_settings(CART_MAX_ITEM_QUANTITY=3)
    def test_per_item_quantity_limit(self):
        self.assertEqual(self.add(self.rice, 3).status_code, 201)
        self.assertEqual(self.add(self.rice, 1).status_code, 400)


class CartConstraintTests(CartBase):

    def setUp(self):
        super().setUp()
        self.cart = Cart.objects.create(user=self.user)

    def test_one_cart_per_user(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Cart.objects.create(user=self.user)

    def test_duplicate_product_without_variant_is_blocked_by_database(self):
        CartItem.objects.create(cart=self.cart, product=self.rice, quantity=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CartItem.objects.create(cart=self.cart, product=self.rice, quantity=1)

    def test_duplicate_variant_is_blocked_by_database(self):
        CartItem.objects.create(cart=self.cart, product=self.turmeric, variant=self.v250, quantity=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CartItem.objects.create(cart=self.cart, product=self.turmeric, variant=self.v250, quantity=1)

    def test_same_product_allowed_in_different_carts_and_with_different_variants(self):
        other_cart = Cart.objects.create(user=self.other)
        CartItem.objects.create(cart=self.cart, product=self.turmeric, variant=self.v250, quantity=1)
        CartItem.objects.create(cart=self.cart, product=self.turmeric, variant=self.v500, quantity=1)
        CartItem.objects.create(cart=other_cart, product=self.turmeric, variant=self.v250, quantity=1)
        self.assertEqual(CartItem.objects.count(), 3)

    def test_quantity_must_be_at_least_one(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            CartItem.objects.create(cart=self.cart, product=self.rice, quantity=0)

    def test_deleting_product_removes_its_cart_lines(self):
        CartItem.objects.create(cart=self.cart, product=self.rice, quantity=1)
        self.rice.delete()
        self.assertEqual(CartItem.objects.count(), 0)

    def test_failed_add_leaves_no_partial_data(self):
        with self.assertRaises(ValidationError):
            services.add_item(self.user, self.rice.id, None, 999)
        self.assertEqual(CartItem.objects.count(), 0)


@skipUnless(connection.vendor == 'postgresql', 'row locking needs PostgreSQL')
class CartConcurrencyTests(TransactionTestCase):
    """Real parallel requests. Runs only on PostgreSQL, where row locks work."""

    def setUp(self):
        self.user = make_user('racer@example.com')
        category = ProductCategory.objects.create(name='Race')
        self.product = make_product(category, 'Race Rice', stock=3)

    def run_parallel(self, user, quantity, workers=2):
        barrier = threading.Barrier(workers)
        results = []

        def worker():
            try:
                barrier.wait()
                services.add_item(user, self.product.id, None, quantity)
                results.append('ok')
            except ValidationError:
                results.append('rejected')
            except Exception as exc:    # any other error is a real bug
                results.append(f'error: {exc!r}')
            finally:
                connection.close()

        # Pause inside the critical section so parallel requests really overlap.
        # Without the cart row lock both workers would read the same quantity.
        original = services._check_quantity

        def slow_check(*args, **kwargs):
            time.sleep(0.3)
            return original(*args, **kwargs)

        threads = [threading.Thread(target=worker) for _ in range(workers)]
        with patch.object(services, '_check_quantity', slow_check):
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        return results

    def test_parallel_first_adds_create_one_cart_and_one_line(self):
        # no cart exists yet: both requests try to create it
        results = self.run_parallel(self.user, quantity=1)

        self.assertEqual(sorted(results), ['ok', 'ok'])
        self.assertEqual(Cart.objects.filter(user=self.user).count(), 1)
        self.assertEqual(CartItem.objects.get(cart__user=self.user).quantity, 2)

    def test_parallel_adds_to_existing_cart_do_not_lose_updates(self):
        cart = Cart.objects.create(user=self.user)
        CartItem.objects.create(cart=cart, product=self.product, quantity=1)

        results = self.run_parallel(self.user, quantity=1)

        self.assertEqual(sorted(results), ['ok', 'ok'])
        self.assertEqual(CartItem.objects.get(cart=cart).quantity, 3)   # 1  1  1

    def test_parallel_new_line_in_existing_cart_makes_one_row(self):
        Cart.objects.create(user=self.user)

        results = self.run_parallel(self.user, quantity=1)

        self.assertEqual(sorted(results), ['ok', 'ok'])
        self.assertEqual(CartItem.objects.filter(cart__user=self.user).count(), 1)

    def test_parallel_adds_cannot_exceed_stock(self):
        Cart.objects.create(user=self.user)
        # stock is 3, two requests of 2 each: exactly one may succeed
        results = self.run_parallel(self.user, quantity=2)

        self.assertEqual(sorted(results), ['ok', 'rejected'])
        self.assertEqual(CartItem.objects.get(cart__user=self.user).quantity, 2)