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