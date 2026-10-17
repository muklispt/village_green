import io
import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import Product, ProductCategory


def make_image(name='photo.png', image_format='PNG', size=(10, 10), content_type=None):
    buffer = io.BytesIO()
    fmt = image_format.upper()
    mode = 'RGB' if fmt != 'PNG' else 'RGBA'
    img = Image.new(mode, size, (20, 120, 40))
    img.save(buffer, format=fmt)
    mime = content_type or f'image/{image_format.lower()}'
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=mime)


def make_mp4(name='promo.mp4'):
    content = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00' + b'0' * 64
    return SimpleUploadedFile(name, content, content_type='video/mp4')


def make_webm(name='promo.webm'):
    content = b'\x1a\x45\xdf\xa3' + b'\x00' * 64
    return SimpleUploadedFile(name, content, content_type='video/webm')


class ProductAPIBase(APITestCase):
    """Creates users, a category, a product, and a temporary MEDIA_ROOT."""

    def setUp(self):
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.media_root = tmp.name
        self.enterContext(override_settings(MEDIA_ROOT=tmp.name))

        User = get_user_model()
        self.admin = User.objects.create_superuser(
            email='admin@example.com', password='StrongPass@123'
        )
        self.customer = User.objects.create_user(
            email='customer@example.com', password='StrongPass@123'
        )
        self.category = ProductCategory.objects.create(name='Spices')
        self.product = self.make_product('Turmeric Powder')

    def make_product(self, name, **kwargs):
        defaults = dict(
            product_category=self.category,
            name=name,
            price=Decimal('50.00'),
            unit='kg',
            is_active=True,
        )
        defaults.update(kwargs)
        return Product.objects.create(**defaults)

    def stored_files(self):
        """All files currently on the temporary media disk."""
        import os
        found = []
        for root, _, files in os.walk(self.media_root):
            found += [os.path.join(root, f) for f in files]
        return found