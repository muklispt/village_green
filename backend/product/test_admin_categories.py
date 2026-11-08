from decimal import Decimal
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from adminpanel.tokens import AdminRefreshToken
from product.models import Product, ProductCategory

User = get_user_model()


class AdminCategoryManagementTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email='admin@greenvillage.com',
            password='Password123!',
            full_name='Admin Lead',
            role='admin',
            is_staff=True,
            is_active=True,
        )
        admin_refresh = AdminRefreshToken.for_user(self.admin)
        self.admin_token = str(admin_refresh.access_token)

        self.customer = User.objects.create_user(
            email='shopper@example.com',
            password='Password123!',
            full_name='Regular Shopper',
            role='customer',
            is_staff=False,
            is_active=True,
        )
        cust_refresh = RefreshToken.for_user(self.customer)
        self.customer_token = str(cust_refresh.access_token)

        # Create sample categories
        self.cat1 = ProductCategory.objects.create(
            name='Fresh Greens',
            slug='fresh-greens',
            description='Crisp organic leafy vegetables harvested daily',
        )
        self.cat2 = ProductCategory.objects.create(
            name='Root Vegetables',
            slug='root-vegetables',
            description='Farm fresh carrots, potatoes and beets',
        )

        # Attach a product to cat1
        self.product = Product.objects.create(
            product_category=self.cat1,
            name='Organic Spinach',
            slug='organic-spinach',
            price=Decimal('45.00'),
            stock_quantity=40,
            unit='pack',
            is_active=True,
        )

    def auth_admin(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.admin_token}')

    def auth_customer(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.customer_token}')

    # 1. Permission checks
    def test_category_mutation_permissions(self):
        # Anonymous GET allowed for public storefront
        self.client.credentials()
        res = self.client.get('/api/v1/product/categories/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Anonymous POST/PATCH/DELETE rejected
        res = self.client.post('/api/v1/product/categories/', {'name': 'Unauthorized Cat'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        # Customer POST/PATCH/DELETE rejected
        self.auth_customer()
        res = self.client.post('/api/v1/admin/categories/', {'name': 'Customer Cat'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        res = self.client.delete(f'/api/v1/admin/categories/{self.cat2.id}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 2. Listing and search
    def test_category_listing_and_search_with_products_count(self):
        self.auth_admin()

        # Test listing on both endpoints
        for endpoint in ['/api/v1/admin/categories/', '/api/v1/product/categories/']:
            res = self.client.get(endpoint)
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertIn('count', res.data)
            self.assertIn('results', res.data)
            self.assertGreaterEqual(res.data['count'], 2)

            # Check products_count annotation
            cat1_item = next(c for c in res.data['results'] if c['id'] == str(self.cat1.id))
            self.assertEqual(cat1_item['products_count'], 1)

            cat2_item = next(c for c in res.data['results'] if c['id'] == str(self.cat2.id))
            self.assertEqual(cat2_item['products_count'], 0)

        # Search by name
        res = self.client.get('/api/v1/admin/categories/?search=Greens')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['name'], 'Fresh Greens')

        # Search by description
        res = self.client.get('/api/v1/admin/categories/?search=carrots')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['name'], 'Root Vegetables')

    # 3. Pagination override for storefront compatibility
    def test_category_pagination_and_all_param(self):
        self.client.credentials()
        # Default paginated
        res = self.client.get('/api/v1/product/categories/')
        self.assertIn('results', res.data)

        # ?all=true returns unpaginated array
        res_all = self.client.get('/api/v1/product/categories/?all=true')
        self.assertIsInstance(res_all.data, list)
        self.assertGreaterEqual(len(res_all.data), 2)

    # 4. Create category and slug generation
    def test_create_category_and_unique_slug_generation(self):
        self.auth_admin()

        # Create category with auto-slug
        res = self.client.post('/api/v1/admin/categories/', {
            'name': 'Exotic Fruits',
            'description': 'Dragon fruit, kiwi, and avocados',
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['name'], 'Exotic Fruits')
        self.assertEqual(res.data['slug'], 'exotic-fruits')
        self.assertEqual(res.data['products_count'], 0)

        # Create category with duplicate name is rejected
        res_dup = self.client.post('/api/v1/admin/categories/', {
            'name': 'Exotic Fruits',
        })
        self.assertEqual(res_dup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', res_dup.data)

    # 5. Update category
    def test_update_category(self):
        self.auth_admin()

        res = self.client.patch(f'/api/v1/admin/categories/{self.cat2.id}/', {
            'name': 'Heritage Root Crops',
            'description': 'Ancient heirloom tubers and carrots',
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['name'], 'Heritage Root Crops')
        self.cat2.refresh_from_db()
        self.assertEqual(self.cat2.name, 'Heritage Root Crops')

    # 6. Safe deletion: empty category can be deleted
    def test_safe_deletion_of_empty_category(self):
        self.auth_admin()

        # cat2 has 0 products
        self.assertEqual(self.cat2.products.count(), 0)
        res = self.client.delete(f'/api/v1/admin/categories/{self.cat2.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProductCategory.objects.filter(pk=self.cat2.id).exists())

    # 7. Safe deletion: category with products is rejected with HTTP 400
    def test_category_deletion_blocked_when_products_exist(self):
        self.auth_admin()

        # cat1 has 1 product
        self.assertEqual(self.cat1.products.count(), 1)
        res = self.client.delete(f'/api/v1/admin/categories/{self.cat1.id}/')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', res.data)
        self.assertIn('Cannot delete category', res.data['detail'])
        self.assertIn('Fresh Greens', res.data['detail'])
        self.assertEqual(res.data['products_count'], 1)

        # Ensure category was NOT deleted
        self.assertTrue(ProductCategory.objects.filter(pk=self.cat1.id).exists())
        # Ensure product remains intact
        self.product.refresh_from_db()
        self.assertEqual(self.product.product_category_id, self.cat1.id)

