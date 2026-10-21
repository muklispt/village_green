from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal
from django.core.files.uploadedfile import SimpleUploadedFile
from .models import ProductCategory, Product, ProductVariant, ProductImage, ProductVideo
from .serializers import ProductCategorySerializer, ProductVariantSerializer
from .media_helpers import ProductAPIBase, make_image, make_mp4, make_webm


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


class ProductDetailAndListAPITestCase(ProductAPIBase):

    def test_query_count_stays_constant_as_products_grow(self):
        Product.objects.all().delete()
        # Create initial 2 products
        for i in range(2):
            p = self.make_product(f"Sample Product {i}")
            ProductImage.objects.create(product=p, image=make_image(), is_primary=True)
            ProductVariant.objects.create(
                product=p, sku=f"SKU-QUERY-{i}", quantity=Decimal('100'),
                unit='g', price=Decimal('10.00'), mrp=Decimal('15.00')
            )

        # Baseline query count with 2 products
        with self.assertNumQueries(3):
            res = self.client.get('/api/v1/product/products/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res.data['count'], 2)

        # Add 6 more products
        for i in range(2, 8):
            p = self.make_product(f"Sample Product {i}")
            ProductImage.objects.create(product=p, image=make_image(), is_primary=True)
            ProductVariant.objects.create(
                product=p, sku=f"SKU-QUERY-{i}", quantity=Decimal('100'),
                unit='g', price=Decimal('10.00'), mrp=Decimal('15.00')
            )

        # Query count must remain constant (3 queries) even with 8 products!
        with self.assertNumQueries(3):
            res = self.client.get('/api/v1/product/products/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res.data['count'], 8)

    def test_public_detail_works_with_nested_relations(self):
        img = ProductImage.objects.create(product=self.product, image=make_image(), is_primary=True)
        vid = ProductVideo.objects.create(product=self.product, video=make_mp4(), title="Promo")
        var_active = ProductVariant.objects.create(
            product=self.product, sku="TUR-ACT", quantity=Decimal('100'),
            unit='g', price=Decimal('20.00'), mrp=Decimal('25.00'), is_active=True
        )
        var_inactive = ProductVariant.objects.create(
            product=self.product, sku="TUR-INACT", quantity=Decimal('200'),
            unit='g', price=Decimal('35.00'), mrp=Decimal('40.00'), is_active=False
        )

        # Public anonymous access
        url = f'/api/v1/product/products/{self.product.id}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], str(self.product.id))
        self.assertIn('category', response.data)
        self.assertEqual(response.data['category']['name'], self.category.name)
        self.assertEqual(len(response.data['images']), 1)
        self.assertIsNotNone(response.data['promotion_video'])
        # Public only sees active variants
        variant_skus = [v['sku'] for v in response.data['variants']]
        self.assertIn('TUR-ACT', variant_skus)
        self.assertNotIn('TUR-INACT', variant_skus)

    def test_staff_detail_includes_inactive_variants(self):
        ProductVariant.objects.create(
            product=self.product, sku="TUR-INACT-2", quantity=Decimal('200'),
            unit='g', price=Decimal('35.00'), mrp=Decimal('40.00'), is_active=False
        )
        self.client.force_authenticate(user=self.admin)
        url = f'/api/v1/product/products/{self.product.id}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        variant_skus = [v['sku'] for v in response.data['variants']]
        self.assertIn('TUR-INACT-2', variant_skus)

    def test_product_with_no_media_or_variants_renders(self):
        url = f'/api/v1/product/products/{self.product.id}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['images'], [])
        self.assertEqual(response.data['variants'], [])
        self.assertIsNone(response.data['promotion_video'])

    def test_admin_create_product_success(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'product_category': str(self.category.id),
            'name': 'Fresh Cardamom',
            'price': '120.00',
            'stock_quantity': 25,
            'unit': 'g',
            'description': 'Aromatic green cardamom'
        }
        response = self.client.post('/api/v1/product/products/', payload)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], 'Fresh Cardamom')

    def test_non_admin_write_product_rejected_401_403(self):
        payload = {
            'product_category': str(self.category.id),
            'name': 'Hacker Product',
            'price': '10.00'
        }
        # Anonymous -> 401
        res_anon = self.client.post('/api/v1/product/products/', payload)
        self.assertEqual(res_anon.status_code, status.HTTP_401_UNAUTHORIZED)

        # Customer -> 403
        self.client.force_authenticate(user=self.customer)
        res_cust = self.client.post('/api/v1/product/products/', payload)
        self.assertEqual(res_cust.status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_product_data_rejected(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'product_category': str(self.category.id),
            'name': 'Negative Price Herb',
            'price': '-50.00',
            'unit': 'g'
        }
        response = self.client.post('/api/v1/product/products/', payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('price', response.data)

    def test_staff_only_is_active_filter(self):
        Product.objects.all().delete()
        active_p = self.make_product('Active Item', is_active=True)
        inactive_p = self.make_product('Inactive Item', is_active=False)

        # Public caller only sees active
        res_pub = self.client.get('/api/v1/product/products/?is_active=false')
        self.assertEqual(res_pub.status_code, status.HTTP_200_OK)
        names = [item['name'] for item in res_pub.data['results']]
        self.assertIn('Active Item', names)
        self.assertNotIn('Inactive Item', names)

        # Staff caller can filter is_active=false
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.get('/api/v1/product/products/?is_active=false')
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        admin_names = [item['name'] for item in res_admin.data['results']]
        self.assertIn('Inactive Item', admin_names)
        self.assertNotIn('Active Item', admin_names)

    def test_ordering_by_price_and_created_at(self):
        Product.objects.all().delete()
        p1 = self.make_product('Cheap', price=Decimal('10.00'))
        p2 = self.make_product('Expensive', price=Decimal('90.00'))

        res_asc = self.client.get('/api/v1/product/products/?ordering=price')
        self.assertEqual(res_asc.status_code, status.HTTP_200_OK)
        self.assertEqual(res_asc.data['results'][0]['name'], 'Cheap')

        res_desc = self.client.get('/api/v1/product/products/?ordering=-price')
        self.assertEqual(res_desc.status_code, status.HTTP_200_OK)
        self.assertEqual(res_desc.data['results'][0]['name'], 'Expensive')


class ProductImageAPITestCase(ProductAPIBase):

    def test_multipart_batch_upload_first_image_becomes_primary(self):
        self.client.force_authenticate(user=self.admin)
        img1 = make_image('first.png')
        img2 = make_image('second.png')

        response = self.client.post(
            '/api/v1/product/images/',
            {'product': str(self.product.id), 'images': [img1, img2]},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 2)
        # First image must be primary, second must not
        self.assertTrue(response.data[0]['is_primary'])
        self.assertFalse(response.data[1]['is_primary'])

    def test_subsequent_upload_does_not_become_primary_if_primary_exists(self):
        self.client.force_authenticate(user=self.admin)
        ProductImage.objects.create(product=self.product, image=make_image('initial.png'), is_primary=True)

        img = make_image('new.png')
        response = self.client.post(
            '/api/v1/product/images/',
            {'product': str(self.product.id), 'images': [img]},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        new_img_data = response.data[0] if isinstance(response.data, list) else response.data
        self.assertFalse(new_img_data['is_primary'])

    def test_image_validation_pillow_verify_format_size_dimensions(self):
        self.client.force_authenticate(user=self.admin)

        # 1. Invalid text file disguised as image
        bad_file = SimpleUploadedFile('fake.png', b'not a real image content', content_type='image/png')
        res_bad = self.client.post(
            '/api/v1/product/images/',
            {'product': str(self.product.id), 'images': [bad_file]},
            format='multipart'
        )
        self.assertEqual(res_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Oversized dimensions (>6000px)
        huge_dim_img = make_image('huge.png', size=(6001, 10))
        res_dim = self.client.post(
            '/api/v1/product/images/',
            {'product': str(self.product.id), 'images': [huge_dim_img]},
            format='multipart'
        )
        self.assertEqual(res_dim.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Valid WebP image accepted
        webp_img = make_image('valid.webp', image_format='WEBP')
        res_webp = self.client.post(
            '/api/v1/product/images/',
            {'product': str(self.product.id), 'images': [webp_img]},
            format='multipart'
        )
        self.assertEqual(res_webp.status_code, status.HTTP_201_CREATED)

    def test_patch_supports_is_primary_and_sort_order(self):
        self.client.force_authenticate(user=self.admin)
        img1 = ProductImage.objects.create(product=self.product, image=make_image('1.png'), is_primary=True, sort_order=1)
        img2 = ProductImage.objects.create(product=self.product, image=make_image('2.png'), is_primary=False, sort_order=2)

        # PATCH img2 to is_primary=True -> should demote img1
        res = self.client.patch(f'/api/v1/product/images/{img2.id}/', {'is_primary': True, 'sort_order': 10})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['is_primary'])
        self.assertEqual(res.data['sort_order'], 10)

        img1.refresh_from_db()
        self.assertFalse(img1.is_primary)

    def test_set_primary_endpoint_atomic(self):
        self.client.force_authenticate(user=self.admin)
        img1 = ProductImage.objects.create(product=self.product, image=make_image('1.png'), is_primary=True)
        img2 = ProductImage.objects.create(product=self.product, image=make_image('2.png'), is_primary=False)

        res = self.client.post(f'/api/v1/product/images/{img2.id}/set-primary/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['is_primary'])

        img1.refresh_from_db()
        img2.refresh_from_db()
        self.assertFalse(img1.is_primary)
        self.assertTrue(img2.is_primary)

    def test_delete_removes_file_and_promotes_next_by_sort_order(self):
        self.client.force_authenticate(user=self.admin)
        img1 = ProductImage.objects.create(product=self.product, image=make_image('first.png'), is_primary=True, sort_order=1)
        img2 = ProductImage.objects.create(product=self.product, image=make_image('second.png'), is_primary=False, sort_order=2)

        stored = self.stored_files()
        self.assertEqual(len(stored), 2)

        # Delete primary image with on_commit callback execution
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.delete(f'/api/v1/product/images/{img1.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

        # File is deleted via transaction.on_commit
        stored_after = self.stored_files()
        self.assertEqual(len(stored_after), 1)

        # img2 is promoted to primary by sort_order
        img2.refresh_from_db()
        self.assertTrue(img2.is_primary)

    def test_public_get_only_active_products(self):
        inactive_prod = self.make_product('Hidden Product', is_active=False)
        img_active = ProductImage.objects.create(product=self.product, image=make_image('act.png'))
        img_inactive = ProductImage.objects.create(product=inactive_prod, image=make_image('inact.png'))

        # Public GET
        res_pub = self.client.get('/api/v1/product/images/')
        self.assertEqual(res_pub.status_code, status.HTTP_200_OK)
        returned_ids = [str(item['id']) for item in res_pub.data['results']]
        self.assertIn(str(img_active.id), returned_ids)
        self.assertNotIn(str(img_inactive.id), returned_ids)

        # Filter by product works
        res_filter = self.client.get(f'/api/v1/product/images/?product={self.product.id}')
        self.assertEqual(res_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(res_filter.data['count'], 1)

        # Bad UUID filter gives 400
        res_bad = self.client.get('/api/v1/product/images/?product=not-a-valid-uuid')
        self.assertEqual(res_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Staff can see inactive product images
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.get('/api/v1/product/images/')
        staff_ids = [str(item['id']) for item in res_admin.data['results']]
        self.assertIn(str(img_inactive.id), staff_ids)

    def test_non_admin_image_writes_rejected(self):
        # Anonymous
        res_anon = self.client.post('/api/v1/product/images/', {'product': str(self.product.id)})
        self.assertEqual(res_anon.status_code, status.HTTP_401_UNAUTHORIZED)

        # Customer
        self.client.force_authenticate(user=self.customer)
        res_cust = self.client.post('/api/v1/product/images/', {'product': str(self.product.id)})
        self.assertEqual(res_cust.status_code, status.HTTP_403_FORBIDDEN)


class ProductVideoAPITestCase(ProductAPIBase):

    def test_upload_video_mp4_and_webm(self):
        self.client.force_authenticate(user=self.admin)

        # Upload MP4
        mp4_file = make_mp4('promo.mp4')
        res_mp4 = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': mp4_file, 'title': 'Turmeric Overview'},
            format='multipart'
        )
        self.assertEqual(res_mp4.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_mp4.data['title'], 'Turmeric Overview')
        self.assertIn('.mp4', res_mp4.data['video'])

        # Delete and upload WebM
        with self.captureOnCommitCallbacks(execute=True):
            self.client.delete(f"/api/v1/product/videos/{res_mp4.data['id']}/")

        webm_file = make_webm('promo.webm')
        res_webm = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': webm_file, 'title': 'WebM Overview'},
            format='multipart'
        )
        self.assertEqual(res_webm.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_webm.data['title'], 'WebM Overview')
        self.assertIn('.webm', res_webm.data['video'])

    def test_duplicate_video_rejected(self):
        self.client.force_authenticate(user=self.admin)
        ProductVideo.objects.create(product=self.product, video=make_mp4(), title="Existing Video")

        new_video = make_mp4('another.mp4')
        response = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': new_video},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already has a promotional video', str(response.data))

    def test_wrong_type_rejected(self):
        self.client.force_authenticate(user=self.admin)
        avi_file = SimpleUploadedFile('clip.avi', b'RIFF\x00\x00\x00\x00AVI ', content_type='video/avi')
        response = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': avi_file},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Only MP4 and WebM', str(response.data))

    def test_fake_file_with_mp4_extension_rejected(self):
        self.client.force_authenticate(user=self.admin)
        fake_mp4 = SimpleUploadedFile('fake.mp4', b'This is plain text content', content_type='video/mp4')
        response = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': fake_mp4},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid MP4 file', str(response.data))

    def test_oversize_video_rejected(self):
        self.client.force_authenticate(user=self.admin)
        # Create a file whose size exceeds 50MB
        header = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00'
        oversize_content = header + (b'0' * (50 * 1024 * 1024 + 16))
        oversize_file = SimpleUploadedFile('huge.mp4', oversize_content, content_type='video/mp4')

        response = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': oversize_file},
            format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('exceed 50MB', str(response.data))

    def test_replace_video_removes_old_file_via_on_commit(self):
        self.client.force_authenticate(user=self.admin)
        initial_file = make_mp4('initial.mp4')
        res_create = self.client.post(
            '/api/v1/product/videos/',
            {'product': str(self.product.id), 'video': initial_file, 'title': 'Original'},
            format='multipart'
        )
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        video_id = res_create.data['id']
        files_after_create = self.stored_files()
        self.assertEqual(len(files_after_create), 1)

        # Replace file via PATCH
        replacement_file = make_mp4('replacement.mp4')
        with self.captureOnCommitCallbacks(execute=True):
            res_patch = self.client.patch(
                f'/api/v1/product/videos/{video_id}/',
                {'video': replacement_file, 'title': 'Replaced Title'},
                format='multipart'
            )
        self.assertEqual(res_patch.status_code, status.HTTP_200_OK)
        self.assertEqual(res_patch.data['title'], 'Replaced Title')

        # Old file removed, exactly one video file remains on disk
        files_after_patch = self.stored_files()
        self.assertEqual(len(files_after_patch), 1)

    def test_patch_change_title_without_replacing_file(self):
        self.client.force_authenticate(user=self.admin)
        vid = ProductVideo.objects.create(product=self.product, video=make_mp4('clip.mp4'), title="Old Title")
        stored_before = self.stored_files()

        res = self.client.patch(f'/api/v1/product/videos/{vid.id}/', {'title': 'Updated Title'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'Updated Title')
        stored_after = self.stored_files()
        self.assertEqual(len(stored_before), len(stored_after))

    def test_delete_video_removes_row_and_file(self):
        self.client.force_authenticate(user=self.admin)
        vid = ProductVideo.objects.create(product=self.product, video=make_mp4('clip.mp4'), title="To Delete")
        self.assertEqual(len(self.stored_files()), 1)

        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.delete(f'/api/v1/product/videos/{vid.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProductVideo.objects.filter(id=vid.id).exists())
        self.assertEqual(len(self.stored_files()), 0)

    def test_missing_file_on_disk_returns_null_url_no_500(self):
        vid = ProductVideo.objects.create(product=self.product, video=make_mp4('missing.mp4'), title="Missing")
        # Remove the file from storage
        if vid.video and vid.video.storage.exists(vid.video.name):
            vid.video.storage.delete(vid.video.name)

        # GET detail endpoint on videos
        res_video = self.client.get(f'/api/v1/product/videos/{vid.id}/')
        self.assertEqual(res_video.status_code, status.HTTP_200_OK)
        self.assertIsNone(res_video.data['video'])

        # GET detail on product also renders clean null promotion_video
        res_product = self.client.get(f'/api/v1/product/products/{self.product.id}/')
        self.assertEqual(res_product.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(res_product.data['promotion_video'])
        self.assertIsNone(res_product.data['promotion_video']['video'])

    def test_public_get_only_active_products_video(self):
        inactive_prod = self.make_product('Hidden Product', is_active=False)
        vid_active = ProductVideo.objects.create(product=self.product, video=make_mp4('act.mp4'))
        vid_inactive = ProductVideo.objects.create(product=inactive_prod, video=make_mp4('inact.mp4'))

        # Public GET
        res_pub = self.client.get('/api/v1/product/videos/')
        self.assertEqual(res_pub.status_code, status.HTTP_200_OK)
        returned_ids = [str(item['id']) for item in res_pub.data['results']]
        self.assertIn(str(vid_active.id), returned_ids)
        self.assertNotIn(str(vid_inactive.id), returned_ids)

        # Filter by product works
        res_filter = self.client.get(f'/api/v1/product/videos/?product={self.product.id}')
        self.assertEqual(res_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(res_filter.data['count'], 1)

        # Non-admin writes rejected
        res_unauth = self.client.post('/api/v1/product/videos/', {'product': str(self.product.id)})
        self.assertEqual(res_unauth.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_or_expired_bearer_token_gracefully_allows_storefront_get(self):
        # Even if client sends an expired/invalid token in Authorization header,
        # safe GET browsing on categories and products must succeed with 200 OK
        invalid_headers = {'HTTP_AUTHORIZATION': 'Bearer an.invalid.token'}

        res_cat = self.client.get('/api/v1/product/categories/', **invalid_headers)
        self.assertEqual(res_cat.status_code, status.HTTP_200_OK)

        res_prod = self.client.get('/api/v1/product/products/', **invalid_headers)
        self.assertEqual(res_prod.status_code, status.HTTP_200_OK)

        # Mutating endpoints must STILL reject invalid/expired token with 401 Unauthorized
        res_post_cat = self.client.post(
            '/api/v1/product/categories/',
            {'name': 'Hack Category'},
            **invalid_headers
        )
        self.assertEqual(res_post_cat.status_code, status.HTTP_401_UNAUTHORIZED)

        res_post_prod = self.client.post(
            '/api/v1/product/products/',
            {'name': 'Hack Product'},
            **invalid_headers
        )
        self.assertEqual(res_post_prod.status_code, status.HTTP_401_UNAUTHORIZED)


class ProductVariantStockSynchronizationTestCase(ProductAPIBase):
    def setUp(self):
        super().setUp()
        self.category = ProductCategory.objects.create(name='Pantry Essentials')

    def test_stock_flow_create_product_stock_zero_then_add_variant_stock_five(self):
        # 1. Create a product without variants with stock 0
        product = Product.objects.create(
            product_category=self.category,
            name='Himalayan Rock Salt',
            price=Decimal('120.00'),
            stock_quantity=0,
            unit='kg',
            is_active=True
        )

        # Confirm product initially has 0 stock and is not in stock
        self.assertEqual(product.stock_quantity, 0)
        self.assertFalse(product.is_in_stock)

        # Verify via detail API
        detail_res = self.client.get(f'/api/v1/product/products/{product.id}/')
        self.assertEqual(detail_res.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_res.data['stock_quantity'], 0)
        self.assertFalse(detail_res.data['is_in_stock'])

        # Verify via list API
        list_res = self.client.get(f'/api/v1/product/products/?search={product.name}')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        item = next(p for p in list_res.data['results'] if p['id'] == str(product.id))
        self.assertEqual(item['stock_quantity'], 0)
        self.assertFalse(item['is_in_stock'])

        # 2. Add a 500 g variant with stock 5 via API or model
        variant = ProductVariant.objects.create(
            product=product,
            sku='HRS-500G',
            quantity=Decimal('500'),
            unit='g',
            price=Decimal('65.00'),
            mrp=Decimal('70.00'),
            stock_quantity=5,
            is_active=True
        )

        # 3. Confirm API returns correct variant stock
        v_res = self.client.get(f'/api/v1/product/variants/{variant.id}/')
        self.assertEqual(v_res.status_code, status.HTTP_200_OK)
        self.assertEqual(v_res.data['stock_quantity'], 5)

        # 4. Confirm product is available when at least one variant has stock
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 5)
        self.assertTrue(product.is_in_stock)

        # Check detail API
        detail_res2 = self.client.get(f'/api/v1/product/products/{product.id}/')
        self.assertEqual(detail_res2.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_res2.data['stock_quantity'], 5)
        self.assertTrue(detail_res2.data['is_in_stock'])
        self.assertTrue(detail_res2.data['has_variants'])

        # Check list API
        list_res2 = self.client.get(f'/api/v1/product/products/?search={product.name}')
        self.assertEqual(list_res2.status_code, status.HTTP_200_OK)
        item2 = next(p for p in list_res2.data['results'] if p['id'] == str(product.id))
        self.assertEqual(item2['stock_quantity'], 5)
        self.assertTrue(item2['is_in_stock'])
        self.assertTrue(item2['has_variants'])

        # 5. Add second variant with stock 0; product is STILL in stock because variant 1 has stock 5
        variant2 = ProductVariant.objects.create(
            product=product,
            sku='HRS-1KG',
            quantity=Decimal('1'),
            unit='kg',
            price=Decimal('120.00'),
            mrp=Decimal('130.00'),
            stock_quantity=0,
            is_active=True
        )
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 5)
        self.assertTrue(product.is_in_stock)

        # 6. Update variant 1's stock from 5 to 0 -> now all variants have stock 0 -> product is out of stock
        variant.stock_quantity = 0
        variant.save()
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 0)
        self.assertFalse(product.is_in_stock)

        detail_res3 = self.client.get(f'/api/v1/product/products/{product.id}/')
        self.assertEqual(detail_res3.data['stock_quantity'], 0)
        self.assertFalse(detail_res3.data['is_in_stock'])

    def test_updating_product_with_nested_variants_without_duplicating(self):
        self.client.force_authenticate(user=self.admin)
        # Create product with nested variants
        payload = {
            'product_category': str(self.category.id),
            'name': 'Cold Pressed Mustard Oil',
            'price': '220.00',
            'stock_quantity': 0,
            'unit': 'l',
            'variants': [
                {
                    'sku': 'OIL-500ML',
                    'quantity': '500',
                    'unit': 'ml',
                    'price': '115.00',
                    'mrp': '125.00',
                    'stock_quantity': 8,
                    'is_active': True,
                },
                {
                    'sku': 'OIL-1L',
                    'quantity': '1',
                    'unit': 'l',
                    'price': '220.00',
                    'mrp': '240.00',
                    'stock_quantity': 12,
                    'is_active': True,
                }
            ]
        }
        res = self.client.post('/api/v1/product/products/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        prod_id = res.data['id']
        self.assertEqual(res.data['stock_quantity'], 20)  # 8 + 12
        self.assertTrue(res.data['is_in_stock'])

        # Update product without duplicating variants
        update_payload = {
            'variants': [
                {
                    'sku': 'OIL-500ML',
                    'quantity': '500',
                    'unit': 'ml',
                    'price': '115.00',
                    'mrp': '125.00',
                    'stock_quantity': 10,
                    'is_active': True,
                }
            ]
        }
        res_update = self.client.patch(f'/api/v1/product/products/{prod_id}/', update_payload, format='json')
        self.assertEqual(res_update.status_code, status.HTTP_200_OK)

        # Confirm no duplicate variants created for OIL-500ML
        product = Product.objects.get(id=prod_id)
        self.assertEqual(product.variants.filter(sku='OIL-500ML').count(), 1)
        self.assertEqual(product.variants.count(), 2)
        # 10 + 12 = 22 total variant stock
        self.assertEqual(product.stock_quantity, 22)


class AdminProductVariantsAPITestCase(ProductAPIBase):
    """
    Tests ensuring product variants are properly represented in Admin API responses,
    created, updated, and deleted with data integrity preserved.
    """

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.admin)
        self.category = ProductCategory.objects.create(name="Farm Harvest")

    def test_case_1_product_with_no_variants(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Raw Honey",
            price=Decimal('250.00'),
            stock_quantity=15,
            unit="piece"
        )
        # Check list endpoint for admin
        res_list = self.client.get('/api/v1/product/products/', HTTP_X_ADMIN_PANEL='1')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        target = next(item for item in res_list.data['results'] if item['id'] == str(product.id))
        self.assertEqual(target['variants'], [])
        self.assertEqual(target['variants_count'], 0)
        self.assertFalse(target['has_variants'])
        self.assertEqual(target['stock_quantity'], 15)

        # Check detail endpoint
        res_detail = self.client.get(f'/api/v1/product/products/{product.id}/', HTTP_X_ADMIN_PANEL='1')
        self.assertEqual(res_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(res_detail.data['variants'], [])
        self.assertEqual(res_detail.data['variants_count'], 0)
        self.assertFalse(res_detail.data['has_variants'])

    def test_case_2_product_with_one_variant(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Organic Ghee",
            price=Decimal('350.00'),
            stock_quantity=0,
            unit="l"
        )
        variant = ProductVariant.objects.create(
            product=product,
            sku="GHEE-500ML",
            quantity=Decimal('500'),
            unit="ml",
            price=Decimal('350.00'),
            mrp=Decimal('380.00'),
            stock_quantity=10,
            is_active=True
        )

        res_list = self.client.get('/api/v1/product/products/', HTTP_X_ADMIN_PANEL='1')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        target = next(item for item in res_list.data['results'] if item['id'] == str(product.id))
        self.assertEqual(target['variants_count'], 1)
        self.assertEqual(len(target['variants']), 1)
        self.assertEqual(target['variants'][0]['sku'], "GHEE-500ML")
        self.assertEqual(target['variants'][0]['stock_quantity'], 10)
        self.assertTrue(target['has_variants'])
        self.assertEqual(target['stock_quantity'], 10)

    def test_case_3_product_with_multiple_variants(self):
        # Specific test case: 500g at ₹60, Stock 5 and 1kg at ₹110, Stock 10
        product = Product.objects.create(
            product_category=self.category,
            name="Fresh Organic Wheat Flour",
            price=Decimal('60.00'),
            stock_quantity=0,
            unit="kg"
        )
        v1 = ProductVariant.objects.create(
            product=product,
            sku="WHEAT-500G",
            quantity=Decimal('500'),
            unit="g",
            price=Decimal('60.00'),
            mrp=Decimal('70.00'),
            stock_quantity=5,
            is_active=True
        )
        v2 = ProductVariant.objects.create(
            product=product,
            sku="WHEAT-1KG",
            quantity=Decimal('1'),
            unit="kg",
            price=Decimal('110.00'),
            mrp=Decimal('125.00'),
            stock_quantity=10,
            is_active=True
        )

        # Verify list response contains both variants with full metadata
        res = self.client.get('/api/v1/product/products/', HTTP_X_ADMIN_PANEL='1')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        target = next(item for item in res.data['results'] if item['id'] == str(product.id))
        self.assertEqual(target['variants_count'], 2)
        self.assertEqual(len(target['variants']), 2)

        skus = {v['sku']: v for v in target['variants']}
        self.assertIn("WHEAT-500G", skus)
        self.assertIn("WHEAT-1KG", skus)
        self.assertEqual(Decimal(str(skus["WHEAT-500G"]['price'])), Decimal('60.00'))
        self.assertEqual(skus["WHEAT-500G"]['stock_quantity'], 5)
        self.assertEqual(Decimal(str(skus["WHEAT-1KG"]['price'])), Decimal('110.00'))
        self.assertEqual(skus["WHEAT-1KG"]['stock_quantity'], 10)

        # Effective inventory stock is 5 + 10 = 15
        self.assertEqual(target['stock_quantity'], 15)

    def test_case_4_creating_new_variant_via_api(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Organic Mustard Oil",
            price=Decimal('100.00'),
            stock_quantity=0,
            unit="l"
        )

        payload = {
            'product': str(product.id),
            'sku': 'MUST-1L',
            'quantity': '1',
            'unit': 'l',
            'price': '190.00',
            'mrp': '210.00',
            'stock_quantity': 25,
            'is_active': True
        }
        res = self.client.post('/api/v1/product/variants/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        variant_id = res.data['id']

        # Confirm variant exists in DB
        variant = ProductVariant.objects.get(id=variant_id)
        self.assertEqual(variant.sku, 'MUST-1L')
        self.assertEqual(variant.stock_quantity, 25)

        # Confirm product stock synchronized to 25
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 25)

    def test_case_5_editing_existing_variant(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Organic Rice",
            price=Decimal('80.00'),
            stock_quantity=0,
            unit="kg"
        )
        variant = ProductVariant.objects.create(
            product=product,
            sku="RICE-1KG",
            quantity=Decimal('1'),
            unit="kg",
            price=Decimal('80.00'),
            mrp=Decimal('90.00'),
            stock_quantity=10,
            is_active=True
        )

        # Edit variant: update price, mrp, stock
        update_data = {
            'price': '85.00',
            'mrp': '95.00',
            'stock_quantity': 18,
            'is_active': True,
        }
        res = self.client.patch(f'/api/v1/product/variants/{variant.id}/', update_data, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(res.data['price'])), Decimal('85.00'))
        self.assertEqual(res.data['stock_quantity'], 18)

        # Confirm DB updated and no duplicate variant was created
        self.assertEqual(ProductVariant.objects.filter(product=product).count(), 1)
        variant.refresh_from_db()
        self.assertEqual(variant.price, Decimal('85.00'))
        self.assertEqual(variant.stock_quantity, 18)

        # Check product synced stock
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 18)

    def test_case_6_deleting_variant_and_preservation(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Spiced Tea",
            price=Decimal('50.00'),
            stock_quantity=0,
            unit="pack"
        )
        v1 = ProductVariant.objects.create(
            product=product,
            sku="TEA-100G",
            quantity=Decimal('100'),
            unit="g",
            price=Decimal('50.00'),
            mrp=Decimal('60.00'),
            stock_quantity=7,
            is_active=True
        )
        v2 = ProductVariant.objects.create(
            product=product,
            sku="TEA-250G",
            quantity=Decimal('250'),
            unit="g",
            price=Decimal('115.00'),
            mrp=Decimal('130.00'),
            stock_quantity=9,
            is_active=True
        )

        # Delete v1
        res = self.client.delete(f'/api/v1/product/variants/{v1.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

        # v2 remains preserved
        self.assertTrue(ProductVariant.objects.filter(id=v2.id).exists())
        self.assertFalse(ProductVariant.objects.filter(id=v1.id).exists())

        # Product stock syncs to 9
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, 9)

    def test_case_7_querying_variants_by_product_returns_untruncated_list(self):
        product = Product.objects.create(
            product_category=self.category,
            name="Assorted Seeds",
            price=Decimal('30.00'),
            stock_quantity=0,
            unit="pack"
        )
        # Create 12 variants to test that pagination does not truncate when querying by product
        for i in range(12):
            ProductVariant.objects.create(
                product=product,
                sku=f"SEED-VAR-{i}",
                quantity=Decimal(f"{i + 1}"),
                unit="pack",
                price=Decimal('30.00') + Decimal(f"{i * 5}"),
                mrp=Decimal('40.00') + Decimal(f"{i * 5}"),
                stock_quantity=5,
                is_active=True
            )

        res = self.client.get(f'/api/v1/product/variants/?product={product.id}', HTTP_X_ADMIN_PANEL='1')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # Paginator is None when filtering by product, so it returns all 12 variants directly
        self.assertEqual(len(res.data), 12)




