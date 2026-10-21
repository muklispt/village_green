from django.db import models
from django.utils.text import slugify
import uuid

# Create your models here.

class ProductCategory(models.Model):
    id = models.UUIDField(default=uuid.uuid4,unique=True,editable=False,primary_key=True)
    name = models.CharField(max_length=225,unique=True)
    slug = models.SlugField(max_length=230,unique=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_category'
        ordering = ['name']

    def save(self,*args,**kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args,**kwargs)

    def __str__(self):
        return self.name

UNIT_CHOICES = [
    ("kg", "Kilogram (kg)"),
    ("g", "Gram (g)"),
    ("l", "Litre (L)"),
    ("ml", "Millilitre (ml)"),
    ("piece", "Piece"),
    ("pack", "Pack"),
    ("dozen", "Dozen"),
]


class Product(models.Model):
    id = models.UUIDField(default=uuid.uuid4,unique=True,editable=False,primary_key=True)
    product_category = models.ForeignKey(ProductCategory,on_delete=models.PROTECT,related_name='products',db_column='category_id')
    name = models.CharField(max_length=225)
    slug = models.SlugField(max_length=250,unique=True)
    price = models.DecimalField(max_digits=12,decimal_places=2)
    stock_quantity = models.PositiveIntegerField(default=0)
    unit = models.CharField(max_length=20,choices=UNIT_CHOICES,default='piece',)
    product_img = models.ImageField(upload_to='products/',blank=True,null=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product'
        ordering =['-created_at']
        indexes =[
            models.Index(fields=['product_category','is_active']),
            models.Index(fields=['price']),
        ]

    def save(self,*args,**kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args,**kwargs)

    def sync_stock_from_variants(self):
        """
        Calculates sellable availability from valid, active variants.
        If the product has active variants, stock_quantity is set to the sum
        of sellable variant stock (without adding product-level stock).
        If the product has no variants, preserves valid product-level stock.
        """
        active_vars = self.variants.filter(is_active=True)
        if active_vars.exists():
            total = active_vars.aggregate(total=models.Sum('stock_quantity'))['total'] or 0
            if self.stock_quantity != total:
                self.stock_quantity = total
                Product.objects.filter(pk=self.pk).update(stock_quantity=total)
            return total
        return self.stock_quantity

    @property
    def is_in_stock(self):
        active_vars = self.variants.filter(is_active=True)
        if active_vars.exists():
            return any(v.stock_quantity > 0 for v in active_vars)
        return self.stock_quantity > 0

    @property
    def effective_stock(self):
        active_vars = self.variants.filter(is_active=True)
        if active_vars.exists():
            return active_vars.aggregate(total=models.Sum('stock_quantity'))['total'] or 0
        return self.stock_quantity

    def __str__(self):
        return self.name

# product variant
class ProductVariant(models.Model):
    id = models.UUIDField(
        default=uuid.uuid4,primary_key=True,editable=False
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='variants',
    )
    sku = models.CharField(max_length=100,unique=True)
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=3,
    )
    unit = models.CharField(
        max_length=20,
        choices=UNIT_CHOICES
    )
    price = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )
    mrp = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    )

    stock_quantity = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'product_variant'
        ordering =['price']
        constraints =[
            models.UniqueConstraint(
                fields=['product','quantity','unit'],
                name='unique_product_variant_size',
            ),
        ]
        indexes =[
            models.Index(fields=['product','is_active'])
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.product_id:
            try:
                self.product.sync_stock_from_variants()
            except Exception:
                pass

    def delete(self, *args, **kwargs):
        product = self.product
        super().delete(*args, **kwargs)
        if product:
            try:
                product.sync_stock_from_variants()
            except Exception:
                pass

    def __str__(self):
        return (
            f"{self.product.name} - "
            f"{self.quantity} {self.unit}"
        )
    
# product multiple images table
class ProductImage(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name='images',
    )
    image = models.ImageField(upload_to='products/images/')
    is_primary = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'product_image'
        ordering =['sort_order','created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['product'],
                condition=models.Q(is_primary=True),
                name='unique_image_per_product',
            )
        ]

    def __str__(self):
        return f'Image for {self.product.name}'


# product video promotion table
class ProductVideo(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    product = models.OneToOneField(
        Product,
        on_delete=models.CASCADE,
        related_name='promotion_video',
    )
    video = models.FileField(upload_to='products/videos/')
    title = models.CharField(max_length=150,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'product_video'

    def __str__(self):
        return f'Promotion video for {self.product.name}'


from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


@receiver(post_save, sender=ProductVariant)
def sync_product_stock_on_variant_save(sender, instance, **kwargs):
    if instance.product_id:
        try:
            instance.product.sync_stock_from_variants()
        except Exception:
            pass


@receiver(post_delete, sender=ProductVariant)
def sync_product_stock_on_variant_delete(sender, instance, **kwargs):
    if instance.product_id:
        try:
            instance.product.sync_stock_from_variants()
        except Exception:
            pass

