
from django.contrib import admin
from .models import ProductCategory,Product,ProductImage,ProductVariant,ProductVideo


@admin.register(ProductCategory)
class ProductCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")
    prepopulated_fields = {"slug": ("name",)}

@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name','slug','product_img','price','stock_quantity')
    prepopulated_fields ={'slug':('name',)}

admin.site.register(ProductVideo)
admin.site.register(ProductImage)
admin.site.register(ProductVariant)