from decimal import Decimal
from rest_framework import serializers
from .models import (ProductCategory, Product, ProductVariant,
                     ProductImage, ProductVideo,ProductReview)
from django.utils.text import slugify
from rest_framework.validators import UniqueTogetherValidator
from django.core.exceptions import ValidationError as DjangoValidationError,ObjectDoesNotExist
from django.db import transaction,IntegrityError
from .validators import validate_product_image_file, validate_product_video_file,MAX_IMAGES_PER_PRODUCT




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


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(
        source='product_category.name',
        read_only=True
    )
    variants = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        write_only=True
    )
    is_in_stock = serializers.SerializerMethodField(read_only=True)
    has_variants = serializers.SerializerMethodField(read_only=True)
    variants_count = serializers.SerializerMethodField(read_only=True)

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
            'variants',
            'variants_count',
            'is_in_stock',
            'has_variants',
            'created_at',
            'updated_at'
        )
        read_only_fields = (
            'id',
            'slug',
            'variants_count',
            'is_in_stock',
            'has_variants',
            'created_at',
            'updated_at'
        )

    def get_is_in_stock(self, obj):
        return obj.is_in_stock

    def get_has_variants(self, obj):
        return obj.variants.filter(is_active=True).exists()

    def get_variants_count(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return len(obj.variants.all())
        return obj.variants.count()

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['stock_quantity'] = instance.effective_stock
        ret['is_in_stock'] = instance.is_in_stock
        ret['has_variants'] = instance.variants.filter(is_active=True).exists()
        variant_qs = instance.variants.all()
        ret['variants'] = ProductVariantSerializer(variant_qs, many=True).data
        ret['variants_count'] = len(ret['variants'])
        return ret

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
        variants_data = validated_data.pop('variants', None)
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
        product = super().create(validated_data)

        if variants_data:
            with transaction.atomic():
                for idx, v_data in enumerate(variants_data):
                    sku = str(v_data.get('sku', '')).strip().upper()
                    if not sku:
                        sku = f"PROD-{product.id.hex[:6].upper()}-{idx + 1}"
                    qty = Decimal(str(v_data.get('quantity', 1)))
                    unit = str(v_data.get('unit', product.unit or 'piece'))
                    price = Decimal(str(v_data.get('price', product.price)))
                    mrp = Decimal(str(v_data.get('mrp', price)))
                    stock = int(v_data.get('stock_quantity', 0))
                    is_active = bool(v_data.get('is_active', True))

                    ProductVariant.objects.update_or_create(
                        product=product,
                        sku=sku,
                        defaults={
                            'quantity': qty,
                            'unit': unit,
                            'price': price,
                            'mrp': mrp,
                            'stock_quantity': stock,
                            'is_active': is_active,
                        }
                    )
                product.sync_stock_from_variants()

        return product

    def update(self, instance, validated_data):
        variants_data = validated_data.pop('variants', None)
        name = validated_data.get('name')
        if name and name != instance.name:
            base_slug = slugify(name)
            if base_slug:
                slug = base_slug
                counter = 1
                while Product.objects.filter(slug=slug).exclude(pk=instance.pk).exists():
                    slug = f'{base_slug}-{counter}'
                    counter += 1
                validated_data['slug'] = slug
        product = super().update(instance, validated_data)

        if variants_data is not None:
            with transaction.atomic():
                for idx, v_data in enumerate(variants_data):
                    sku = str(v_data.get('sku', '')).strip().upper()
                    if not sku:
                        sku = f"PROD-{product.id.hex[:6].upper()}-{idx + 1}"
                    qty = Decimal(str(v_data.get('quantity', 1)))
                    unit = str(v_data.get('unit', product.unit or 'piece'))
                    price = Decimal(str(v_data.get('price', product.price)))
                    mrp = Decimal(str(v_data.get('mrp', price)))
                    stock = int(v_data.get('stock_quantity', 0))
                    is_active = bool(v_data.get('is_active', True))
                    variant_id = v_data.get('id')

                    defaults = {
                        'quantity': qty,
                        'unit': unit,
                        'price': price,
                        'mrp': mrp,
                        'stock_quantity': stock,
                        'is_active': is_active,
                    }
                    if sku:
                        defaults['sku'] = sku

                    if variant_id:
                        ProductVariant.objects.filter(
                            pk=variant_id, product=product
                        ).update(**defaults)
                    else:
                        ProductVariant.objects.update_or_create(
                            product=product,
                            sku=sku,
                            defaults=defaults
                        )
                product.sync_stock_from_variants()

        return product


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
        validators =[]

    def validate_product(self,value):
        if self.instance is not None and value != self.instance.product:
            raise serializers.ValidationError('Product of an image cannot be changed.')
        return value

    def validate_image(self,value):
        try:
            validate_product_image_file(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)
        return value

    def validate(self, attrs):
        product = attrs.get('product')
        if self.instance is None and product is not None:
            if ProductImage.objects.filter(product=product).count() >=MAX_IMAGES_PER_PRODUCT:
                raise serializers.ValidationError({
                    'product':f'A product can have at most {MAX_IMAGES_PER_PRODUCT} images.'
                })
        return attrs

    
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
        # one-to-one uniqueness is checked in validate_product for a clearer message
        extra_kwargs = {'product': {'validators': []}}

    def validate_product(self,value):
        if self.instance is not None:
            if value != self.instance.product:
                raise serializers.ValidationError('Product of a video cannot be changed.')
        elif ProductVideo.objects.filter(product=value).exists():
            raise serializers.ValidationError(
                'This product already has a promotional video. Update or delete it instead.'
            )
        return value

    def validate_video(self, value):
        try:
            validate_product_video_file(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)
        return value

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

class ProductReviewStatsMixin:
    """
    Reads the review aggregates annotated by ProductViewSet.get_queryset().

    The values are computed in the product query (one aggregate, no extra
    per-product queries). If a serializer is ever used with a product that was
    not annotated, fall back to the empty representation instead of silently
    issuing a query per object.
    """

    def get_average_rating(self,obj):
        average = getattr(obj,'average_rating',None)
        if average is None:
            return None
        return float(round(average,2))

    def get_approved_review_count(self,obj):
        return int(getattr(obj,'approved_review_count',0) or 0)

class ProductListSerializer(ProductReviewStatsMixin,serializers.ModelSerializer):
    category_name = serializers.CharField(
        source='product_category.name',
        read_only=True
    )
    primary_image = serializers.SerializerMethodField()
    is_in_stock = serializers.SerializerMethodField()
    has_variants = serializers.SerializerMethodField()
    variants = serializers.SerializerMethodField()
    variants_count = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    approved_review_count = serializers.SerializerMethodField()
    

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
            'is_in_stock',
            'has_variants',
            'is_active',
            'product_img',
            'primary_image',
            'variants',
            'variants_count',
            'average_rating',
            'approved_review_count',
        )

    def get_is_in_stock(self, obj):
        return (obj.stock_quantity or 0) > 0

    def get_has_variants(self, obj):
        if hasattr(obj, 'has_active_variants'):
            return bool(obj.has_active_variants)
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return any(v.is_active for v in obj.variants.all())
        return False

    def get_variants(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return ProductVariantSerializer(obj.variants.all(), many=True).data
        return []

    def get_variants_count(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return len(obj.variants.all())
        return 0

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


class ProductDetailSerializer(ProductReviewStatsMixin, serializers.ModelSerializer):
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
    promotion_video = serializers.SerializerMethodField()
    variants = ProductVariantSerializer(
        many=True,
        read_only=True
    )
    variants_count = serializers.SerializerMethodField()
    stock_quantity = serializers.SerializerMethodField()
    is_in_stock = serializers.SerializerMethodField()
    has_variants = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    approved_review_count = serializers.SerializerMethodField()

    class Meta(ProductSerializer.Meta):
        fields = ProductSerializer.Meta.fields + (
            'category',
            'images',
            'promotion_video',
            'variants',
            'variants_count',
            'is_in_stock',
            'has_variants',
            'average_rating',
            'approved_review_count',
        )

    def get_variants_count(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return len(obj.variants.all())
        return obj.variants.count()

    def _get_active_variants(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'variants' in obj._prefetched_objects_cache:
            return [v for v in obj.variants.all() if v.is_active]
        return list(obj.variants.filter(is_active=True))

    def get_stock_quantity(self, obj):
        active_vars = self._get_active_variants(obj)
        if active_vars:
            return sum(v.stock_quantity for v in active_vars)
        return obj.stock_quantity

    def get_is_in_stock(self, obj):
        active_vars = self._get_active_variants(obj)
        if active_vars:
            return any(v.stock_quantity > 0 for v in active_vars)
        return obj.stock_quantity > 0

    def get_has_variants(self, obj):
        return bool(self._get_active_variants(obj))

    def get_promotion_video(self,obj):
        try:
            video = obj.promotion_video
        except ObjectDoesNotExist:
            return None
        return ProductVideoSerializer(video,context=self.context).data


REVIEW_DUPLICATE_MESSAGE = 'You have already reviewed this product.'

class ProductReviewSerializer(serializers.ModelSerializer):
    """
    Read/update representation of a single review.

    Only `rating` and `review_text` are writable. Product, author, approval
    state and timestamps are owned by the backend: the customer's identity
    always comes from request.user, never from the payload.
    """
    display_name = serializers.CharField(source='user.full_name',read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = ProductReview
        fields = (
            'id',
            'product',
            'product_name',
            'display_name',
            'rating',
            'review_text',
            'is_approved',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'product',
            'product_name',
            'display_name',
            'is_approved',
            'created_at',
            'updated_at',
        )
        extra_kwargs = {
            # Overrides the PositiveSmallIntegerField's 0..32767 range with the
            # business range. The CheckConstraint is the database backstop.
            'rating': {
                'min_value': ProductReview.RATING_MIN,
                'max_value': ProductReview.RATING_MAX,
            },
            'review_text': {
                'required': False,
                'allow_blank': True,
                'allow_null': False,
            },
        }

    def validate_review_text(self, value):
        value = (value or '').strip()
        if len(value) > ProductReview.REVIEW_TEXT_MAX_LENGTH:
            raise serializers.ValidationError(
                f'Review text must be at most '
                f'{ProductReview.REVIEW_TEXT_MAX_LENGTH} characters.'
            )
        return value

    def update(self, instance, validated_data):
        # An edited review is content that has not been moderated yet.
        validated_data['is_approved'] = False
        return super().update(instance, validated_data)


class ProductReviewCreateSerializer(ProductReviewSerializer):
    """
    Create representation. The product comes from the URL and the author from
    request.user; both are read-only in the payload.
    """

    @staticmethod
    def _already_reviewed(user, product):
        """Application-level duplicate check (indexed unique lookup)."""
        return ProductReview.objects.filter(user=user, product=product).exists()

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        product = self.context.get('product')

        if product is None or user is None or not user.is_authenticated:
            raise serializers.ValidationError(
                {'detail': 'Unable to create this review.'}
            )

        if self._already_reviewed(user, product):
            raise serializers.ValidationError({'detail': REVIEW_DUPLICATE_MESSAGE})

        attrs['user'] = user
        attrs['product'] = product
        return attrs

    def create(self, validated_data):
        try:
            with transaction.atomic():
                return ProductReview.objects.create(**validated_data)
        except IntegrityError:
            # Two concurrent submissions can both pass _already_reviewed();
            # the UniqueConstraint wins and we translate it to a 400.
            raise serializers.ValidationError(
                {'detail': REVIEW_DUPLICATE_MESSAGE}
            )
        



    
     


