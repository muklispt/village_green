from rest_framework import serializers
from .models import (ProductCategory, Product, ProductVariant,
                     ProductImage, ProductVideo)
from django.utils.text import slugify
from rest_framework.validators import UniqueTogetherValidator
from pathlib import Path
from django.db import transaction
from .validators import validate_product_image_file, validate_product_video_file


class ProductCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductCategory
        fields = (
            'id',
            'name',
            'slug',
            'description',
            'created_at',
            'updated_at'
        )
        read_only_fields = ('id', 'created_at', 'updated_at')
        extra_kwargs = {
            'slug': {'required': False}
        }

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Category name cannot be empty.')
        return value

    def validate_slug(self, value):
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
            counter += 1
        validated_data['slug'] = slug

        return super().create(validated_data)


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source='product_category.name',
        read_only=True
    )

    class Meta:
        model = Product
        fields = (
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
        read_only_fields = (
            'id',
            'slug',
            'created_at',
            'updated_at'
        )

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(
                'Product name cannot be empty.'
            )
        return value

    def validate_price(self, value):
        if value < 0:
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
                'name': 'Product name must contain letters or numbers'
            })

        slug = base_slug
        counter = 1

        while Product.objects.filter(slug=slug).exists():
            slug = f'{base_slug}-{counter}'
            counter += 1

        validated_data['slug'] = slug
        return super().create(validated_data)


class ProductVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields = (
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
        read_only_fields = ('id',)

        validators = [
            UniqueTogetherValidator(
                queryset=ProductVariant.objects.all(),
                fields=('product', 'quantity', 'unit'),
                message='A variant with this product, quantity and unit alredy exists.'
            )
        ]

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError('Selling price cannot be nagative')
        return value

    def validate_mrp(self, value):
        if value < 0:
            raise serializers.ValidationError('MRP cannot be nagative.')
        return value

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError('Quantity must be greater than zero.')
        return value

    def validate(self, attrs):
        price = attrs.get('price', getattr(self.instance, 'price', None))
        mrp = attrs.get('mrp', getattr(self.instance, 'mrp', None))

        if price is not None and mrp is not None and price > mrp:
            raise serializers.ValidationError({
                'price': 'Selling prince cannot be greater then MRP.'
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
        read_only_fields = ('id', 'created_at')

    def validate_image(self, value):
        return validate_product_image_file(value)

    def update(self, instance, validated_data):
        is_primary = validated_data.get('is_primary', instance.is_primary)
        with transaction.atomic():
            if is_primary and not instance.is_primary:
                ProductImage.objects.filter(
                    product_id=instance.product_id,
                    is_primary=True
                ).exclude(pk=instance.pk).update(is_primary=False)
            return super().update(instance, validated_data)


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
        read_only_fields = ('id', 'created_at')

    def validate_video(self, value):
        return validate_product_video_file(value)

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        video_field = instance.video
        if not video_field:
            ret['video'] = None
        else:
            try:
                if hasattr(video_field, 'storage') and hasattr(video_field, 'name'):
                    if not video_field.storage.exists(video_field.name):
                        ret['video'] = None
            except Exception:
                ret['video'] = None
        return ret


class ProductListSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source='product_category.name',
        read_only=True
    )
    primary_image = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = (
            'id',
            'product_category',
            'category_name',
            'name',
            'slug',
            'price',
            'unit',
            'stock_quantity',
            'is_active',
            'product_img',
            'primary_image',
        )

    def get_primary_image(self, obj):
        primary_list = getattr(obj, 'prefetched_primary_image', None)
        if primary_list:
            img = primary_list[0]
            if img.image and hasattr(img.image, 'url'):
                request = self.context.get('request')
                return request.build_absolute_uri(img.image.url) if request else img.image.url
        elif obj.product_img and hasattr(obj.product_img, 'url'):
            request = self.context.get('request')
            return request.build_absolute_uri(obj.product_img.url) if request else obj.product_img.url
        return None


class ProductDetailSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source='product_category.name',
        read_only=True
    )
    category = ProductCategorySerializer(
        source='product_category',
        read_only=True
    )
    images = ProductImageSerializer(
        many=True,
        read_only=True
    )
    promotion_video = ProductVideoSerializer(
        read_only=True
    )
    variants = ProductVariantSerializer(
        many=True,
        read_only=True
    )

    class Meta:
        model = Product
        fields = (
            'id',
            'product_category',
            'category_name',
            'category',
            'name',
            'slug',
            'price',
            'stock_quantity',
            'unit',
            'product_img',
            'description',
            'is_active',
            'images',
            'promotion_video',
            'variants',
            'created_at',
            'updated_at',
        )