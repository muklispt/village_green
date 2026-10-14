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

class Product(models.Model):
    id = models.UUIDField(default=uuid.uuid4,unique=True,editable=False,primary_key=True)
    product_category = models.ForeignKey(ProductCategory,on_delete=models.PROTECT,related_name='products',db_column='category_id')
    name = models.CharField(max_length=225)
    slug = models.SlugField(max_length=250,unique=True)
    price = models.DecimalField(max_digits=12,decimal_places=2)
    stock_quantity = models.PositiveIntegerField(default=0)
    unit = models.CharField(max_length=50)
    product_img = models.ImageField(upload_to='products/',blank=True,null=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
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