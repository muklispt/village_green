from django.test import TestCase
from rest_framework.test import APITestCase
from .serializers import ProductCategorySerializer


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

        
