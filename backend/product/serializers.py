from rest_framework import serializers
from .models import (ProductCategory,Product,ProductVariant,
                     ProductImage,ProductVideo)
from django.utils.text import slugify
from  rest_framework.validators import  UniqueTogetherValidator
from pathlib import Path


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
        extra_kwargs = {
            'slug': {'required': False}
        }

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
        source='product_category.name',
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
                'Price cannot be negative.'
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

class ProductVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields =(
            'id',
            'product',
            'sku',
            'quantity',
            'unit',
            'price',
            'mrp',
            'stock_quantity',
            'is_active'
        )
        read_only_fields=('id',)

        validators = [
            UniqueTogetherValidator(
                queryset=ProductVariant.objects.all(),
                fields=('product','quantity','unit'),
                message='A variant with this product, quantity and unit alredy exists.'
            )
        ]

    def validate_price(self,value):
        if value<0:
            raise serializers.ValidationError('Selling price cannot be nagative')
        return value

    def validate_mrp(self,value):
        if value<0:
            raise serializers.ValidationError('MRP cannot be nagative.')
        return value

    def validate_quantity(self,value):
        if value<=0:
            raise serializers.ValidationError('Quantity must be greater than zero.')
        return value

    def validate(self, attrs):
        price = attrs.get('price',getattr(self.instance,'price',None))
        mrp = attrs.get('mrp',getattr(self.instance,'mrp',None))

        if price is not None and mrp is not None and price>mrp:
            raise serializers.ValidationError({
                'price':'Selling prince cannot be greater then MRP.'
            })
        return attrs

class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = (
            'id',
            'product',
            'image',
            'is_primary',
            'sort_order',
            'created_at',
        )
        read_only_fields = ('id','created_at')

    def validate_image(self,value):
        allowed_types =['image/jpeg','image/png','image/webp']

        if value.content_type not in allowed_types:
            raise serializers.ValidationError('Only JPEG,PNG, and Webp images are allowed.')

        max_size = 5 * 1024 * 1024

        if value.size> max_size:
            raise serializers.ValidationError('Image size must not exceed 5 MB.')
        
        return value

class ProductVideoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVideo
        fields = (
            'id',
            'product',
            'video',
            'title',
            'created_at'
        )
        read_only_fields =('id','created_at')

    def validate_video(self,value):
        allowed_extensions = {'.mp4','.webm','.mov'}
        extension = Path(value.name).suffix.lower()

        if extension not in allowed_extensions:
            raise serializers.ValidationError('Only MP4,WebM,and MOV video files are allowed.')
        max_size = 50 * 1024 * 1024 

        if value.size>max_size:
            raise serializers.ValidationError('Video size must not exceed 50 MB.')
        
        return value
    