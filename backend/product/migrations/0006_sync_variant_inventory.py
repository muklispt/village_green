from django.db import migrations
from django.db.models import Sum


def sync_inventory(apps, schema_editor):
    Product = apps.get_model('product', 'Product')
    ProductVariant = apps.get_model('product', 'ProductVariant')

    for product in Product.objects.all():
        active_vars = ProductVariant.objects.filter(product=product, is_active=True)
        if active_vars.exists():
            total = active_vars.aggregate(total=Sum('stock_quantity'))['total'] or 0
            Product.objects.filter(pk=product.pk).update(stock_quantity=total)


def reverse_sync(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('product', '0005_productimage_unique_image_per_product'),
    ]

    operations = [
        migrations.RunPython(sync_inventory, reverse_code=reverse_sync),
    ]
