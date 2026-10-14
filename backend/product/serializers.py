from rest_framework import serializers
from .models import ProductCategory,Product
from django.utils.text import slugify



class ProductCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductCategory
        fields =(
            'id',
            'name',
            'slug',
            'description',
            'created_at',
            'updated_at'
        )
        read_only_fields=('id','created_at','updated_at')

    def validate_name(self,value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError('Category name cannot be empty.')

        return value
    
    def validate_slug(self,value):
        value = value.strip().lower()

        if not value:
            raise serializers.ValidationError('Category slug cannot be empty.')
        return value

    def create(self, validated_data):
        name = validated_data['name']
        base_slug = slugify(name)
        slug = base_slug
        counter = 1
        while ProductCategory.objects.filter(slug=slug).exists():
            slug = f'{base_slug}-{counter}'
            counter +=1
        validated_data['slug'] = slug

        return super().create(validated_data)

class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source ='category.name',
        read_only=True
    )

    class Meta:
        model = Product
        fields =(
            'id',
            'product_category',
            'category_name',
            'name',
            'slug',
            'price',
            'stock_quantity',
            'unit',
            'product_img',
            'description',
            'is_active',
            'created_at',
            'updated_at'
        )
        read_only_fields=(
            'id',
            'slug',
            'created_at',
            'updated_at'
        )

    def validate_name(self,value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(
                'Product name cannot be empty.'
            )
        return value

    def validate_price(self,value):
        if value<0:
            raise serializers.ValidationError(
                'Pirce cannot be negative.'
            )
        return value

    def validate_stock_quantity(self, value):
        if value < 0:
            raise serializers.ValidationError(
                "Stock quantity cannot be negative."
            )
        return value

    def create(self, validated_data):
        name = validated_data['name']
        base_slug = slugify(name)

        if not base_slug:
            raise serializers.ValidationError({
                'name':'Product name must contain letters or numbers'
            })

        slug = base_slug
        counter = 1

        while Product.objects.filter(slug=slug).exists():
            slug = f'{base_slug}-{counter}'
            counter +=1

        validated_data['slug'] = slug
        return super().create(validated_data)

    