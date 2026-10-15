from django.test import TestCase
from rest_framework.test import APITestCase
from decimal import Decimal
from .models import ProductCategory,Product,ProductVariant
from .serializers import ProductCategorySerializer,ProductVariantSerializer


# Create your tests here.

class ProductCategoryTestCase(TestCase):

    def test_product(self):
        serializer = ProductCategorySerializer(
            data={
                'name':'Organic Fruits',
                'description':'Fresh organic fruits'
            }
        )

        self.assertTrue(serializer.is_valid())

        category = serializer.save()
        self.assertEqual(category.name,'Organic Fruits')
        self.assertEqual(category.slug,'organic-fruits')
        self.assertEqual(category.description,'Fresh organic fruits')

    def test_custom_slug_ignored_in_create(self):
        serializer = ProductCategorySerializer(
            data={
                'name': 'Exotic Fruits',
                'slug': 'custom-slug-override',
                'description': 'Fresh exotic fruits',
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        category = serializer.save()
        self.assertEqual(category.name, 'Exotic Fruits')
        self.assertEqual(category.slug, 'exotic-fruits')


class ProductVariantSerializerTestCase(TestCase):

    def setUp(self):
        self.category = ProductCategory.objects.create(name='Spices')
        self.product = Product.objects.create(
            product_category=self.category,
            name='Turmeric Powder',
            price=Decimal('50.00'),
            stock_quantity=10,
            unit='g'
        )
        self.other_product = Product.objects.create(
            product_category=self.category,
            name='Black Pepper',
            price=Decimal('80.00'),
            stock_quantity=10,
            unit='g'
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku='TUR-250G',
            quantity=Decimal('250'),
            unit='g',
            price=Decimal('45.00'),
            mrp=Decimal('50.00'),
            stock_quantity=5
        )

    def build_data(self,**overrides):
        data = {
            'product':str(self.product.id),
            'sku':'TUR-500G',
            'quantity':'500',
            'unit':'g',
            'price':'90.00',
            'mrp':'100.00',
            'stock_quantity':20,
            'is_active':True
        }
        data.update(overrides)
        return data

    def test_valid_variant_creation(self):
        serializer = ProductVariantSerializer(data=self.build_data())

        self.assertTrue(serializer.is_valid(),serializer.errors)

        variant = serializer.save()
        self.assertEqual(variant.product,self.product)
        self.assertEqual(variant.sku,'TUR-500G')
        self.assertEqual(variant.price,Decimal('90.00'))
        self.assertEqual(variant.mrp,Decimal('100.00'))

    def test_id_is_read_only(self):
        fake_id = '11111111-1111-1111-1111-111111111111'
        serializer = ProductVariantSerializer(data=self.build_data(id=fake_id))

        self.assertTrue(serializer.is_valid(),serializer.errors)

        variant = serializer.save()
        self.assertNotEqual(str(variant.id),fake_id)

    def test_price_greater_than_mrp_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(price='120.00',mrp='100.00')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('price',serializer.errors)

    def test_price_equal_to_mrp_allowed(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(price='100.00',mrp='100.00')
        )

        self.assertTrue(serializer.is_valid(),serializer.errors)

    def test_negative_price_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(price='-1.00')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('price',serializer.errors)

    def test_negative_mrp_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(mrp='-1.00')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('mrp',serializer.errors)

    def test_zero_quantity_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(quantity='0')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('quantity',serializer.errors)

    def test_negative_quantity_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(quantity='-5')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('quantity',serializer.errors)

    def test_invalid_unit_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(unit='barrel')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('unit',serializer.errors)

    def test_duplicate_sku_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(sku='TUR-250G')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('sku',serializer.errors)

    def test_duplicate_product_quantity_unit_rejected(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(sku='TUR-NEW',quantity='250',unit='g')
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors',serializer.errors)

    def test_same_size_allowed_for_different_product(self):
        serializer = ProductVariantSerializer(
            data=self.build_data(
                product=str(self.other_product.id),
                sku='PEP-250G',
                quantity='250',
                unit='g'
            )
        )

        self.assertTrue(serializer.is_valid(),serializer.errors)

    def test_valid_partial_update(self):
        serializer = ProductVariantSerializer(
            self.variant,
            data={'price':'48.00'},
            partial=True
        )

        self.assertTrue(serializer.is_valid(),serializer.errors)

        variant = serializer.save()
        self.assertEqual(variant.price,Decimal('48.00'))
        self.assertEqual(variant.mrp,Decimal('50.00'))

    def test_partial_update_same_sku_on_same_variant_allowed(self):
        serializer = ProductVariantSerializer(
            self.variant,
            data={'sku':'TUR-250G','stock_quantity':7},
            partial=True
        )

        self.assertTrue(serializer.is_valid(),serializer.errors)

    def test_partial_update_price_above_existing_mrp_rejected(self):
        serializer = ProductVariantSerializer(
            self.variant,
            data={'price':'60.00'},
            partial=True
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('price',serializer.errors)

    def test_partial_update_mrp_below_existing_price_rejected(self):
        serializer = ProductVariantSerializer(
            self.variant,
            data={'mrp':'40.00'},
            partial=True
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('price',serializer.errors)

    def test_partial_update_zero_quantity_rejected(self):
        serializer = ProductVariantSerializer(
            self.variant,
            data={'quantity':'0'},
            partial=True
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('quantity',serializer.errors)

    def test_partial_update_duplicate_combination_rejected(self):
        ProductVariant.objects.create(
            product=self.product,
            sku='TUR-500G',
            quantity=Decimal('500'),
            unit='g',
            price=Decimal('90.00'),
            mrp=Decimal('100.00')
        )
        serializer = ProductVariantSerializer(
            self.variant,
            data={'quantity':'500'},
            partial=True
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('non_field_errors',serializer.errors)


class ProductAPITestCase(APITestCase):

    def setUp(self):
        self.category_fruits = ProductCategory.objects.create(name='Organic Fruits')
        self.category_veggies = ProductCategory.objects.create(name='Fresh Vegetables')

        self.products = []
        for i in range(15):
            cat = self.category_fruits if i < 10 else self.category_veggies
            self.products.append(
                Product.objects.create(
                    product_category=cat,
                    name=f'Product {i:02d}',
                    price=Decimal('10.00') + Decimal(i),
                    stock_quantity=10,
                    unit='kg',
                    is_active=True
                )
            )

    def test_category_name_present_in_product(self):
        url = '/api/v1/product/products/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        results = response.data.get('results', [])
        self.assertGreater(len(results), 0)
        first_product = results[0]
        self.assertIn('category_name', first_product)
        self.assertEqual(first_product['category_name'], self.products[-1].product_category.name)

    def test_pagination_page_2_works(self):
        url = '/api/v1/product/products/?page=2'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 15)
        self.assertEqual(len(response.data['results']), 5)
        self.assertIsNotNone(response.data['previous'])
        self.assertIsNone(response.data['next'])

    def test_pagination_page_size_works(self):
        url = '/api/v1/product/products/?page_size=5'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 15)
        self.assertEqual(len(response.data['results']), 5)
        self.assertIsNotNone(response.data['next'])

    def test_category_filter_works(self):
        url = f'/api/v1/product/products/?category={self.category_fruits.id}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 10)
        for item in response.data['results']:
            self.assertEqual(item['category_name'], 'Organic Fruits')
            self.assertEqual(str(item['product_category']), str(self.category_fruits.id))

    def test_category_filter_bad_uuid_gives_400(self):
        url = '/api/v1/product/products/?category=invalid-uuid-123'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 400)
        self.assertIn('category', response.data)