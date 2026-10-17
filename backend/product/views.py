import uuid
from django.db import transaction
from django.db.models import Prefetch
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import (ProductCategory, Product, ProductVariant,
                     ProductImage, ProductVideo)
from .pagination import ProductPagination
from .permissions import IsAdminOrReadOnly
from .serializers import (ProductCategorySerializer, ProductSerializer,
                           ProductVariantSerializer, ProductImageSerializer,
                           ProductVideoSerializer, ProductListSerializer,
                           ProductDetailSerializer)
from .validators import validate_product_image_file


class ProductCategoryViewSet(ModelViewSet):
    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    permission_classes = [IsAdminOrReadOnly]


class ProductViewSet(ModelViewSet):
    pagination_class = ProductPagination
    filter_backends = [SearchFilter, OrderingFilter]
    permission_classes = [IsAdminOrReadOnly]
    ordering_fields = ['price', 'created_at']
    ordering = ['-created_at']

    search_fields = [
        'name',
        'description',
        'slug',
        'product_category__name'
    ]

    def get_serializer_class(self):
        if self.action == 'list':
            return ProductListSerializer
        elif self.action == 'retrieve':
            return ProductDetailSerializer
        return ProductSerializer

    def get_queryset(self):
        is_staff = self.request.user.is_authenticated and self.request.user.is_staff
        queryset = Product.objects.select_related('product_category', 'promotion_video')

        if not is_staff:
            queryset = queryset.filter(is_active=True)
            variant_qs = ProductVariant.objects.filter(is_active=True)
        else:
            is_active_param = self.request.query_params.get('is_active')
            if is_active_param is not None:
                if is_active_param.lower() in ('true', '1'):
                    queryset = queryset.filter(is_active=True)
                elif is_active_param.lower() in ('false', '0'):
                    queryset = queryset.filter(is_active=False)
            variant_qs = ProductVariant.objects.all()

        category_id = self.request.query_params.get('category')
        if category_id:
            try:
                category_uuid = uuid.UUID(category_id)
            except ValueError:
                raise ValidationError({'category': 'Enter a valid category id.'})
            queryset = queryset.filter(product_category_id=category_uuid)

        primary_image_prefetch = Prefetch(
            'images',
            queryset=ProductImage.objects.filter(is_primary=True),
            to_attr='prefetched_primary_image'
        )

        if self.action == 'list':
            queryset = queryset.prefetch_related(primary_image_prefetch)
        elif self.action == 'retrieve':
            queryset = queryset.prefetch_related(
                Prefetch('images', queryset=ProductImage.objects.all()),
                Prefetch('variants', queryset=variant_qs),
                primary_image_prefetch,
            )
        else:
            queryset = queryset.prefetch_related(
                Prefetch('images', queryset=ProductImage.objects.all()),
                Prefetch('variants', queryset=variant_qs),
                primary_image_prefetch,
            )

        return queryset


class ProductVariantViewSet(ModelViewSet):
    serializer_class = ProductVariantSerializer
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    permission_classes = [IsAdminOrReadOnly]

    search_fields = [
        'sku',
        'product__name'
    ]

    def get_queryset(self):
        queryset = ProductVariant.objects.select_related('product')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(is_active=True, product__is_active=True)

        product_id = self.request.query_params.get('product')
        if product_id:
            try:
                product_id = uuid.UUID(product_id)
            except ValueError:
                raise ValidationError({'product': 'Enter a valid product id.'})
            queryset = queryset.filter(product_id=product_id)
        return queryset


class ProductImageViewSet(ModelViewSet):
    serializer_class = ProductImageSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    search_fields = ['product__name']

    def get_queryset(self):
        queryset = ProductImage.objects.select_related('product')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(product__is_active=True)

        product_id = self.request.query_params.get('product')
        if product_id:
            try:
                product_uuid = uuid.UUID(product_id)
            except ValueError:
                raise ValidationError({'product': 'Enter a valid product id.'})
            queryset = queryset.filter(product_id=product_uuid)

        return queryset

    def create(self, request, *args, **kwargs):
        product_id = request.data.get('product')
        if not product_id:
            raise ValidationError({'product': 'This field is required.'})

        try:
            product = Product.objects.get(pk=product_id)
        except (Product.DoesNotExist, ValueError):
            raise ValidationError({'product': 'Enter a valid product.'})

        uploaded_images = request.FILES.getlist('images')
        is_list_upload = bool(uploaded_images)

        if not uploaded_images and 'image' in request.FILES:
            uploaded_images = [request.FILES['image']]

        if not uploaded_images:
            raise ValidationError({'images': 'No image files provided.'})

        for img_file in uploaded_images:
            validate_product_image_file(img_file)

        created_instances = []
        with transaction.atomic():
            has_primary = ProductImage.objects.filter(
                product=product, is_primary=True
            ).exists()

            max_sort = ProductImage.objects.filter(
                product=product
            ).order_by('-sort_order').values_list('sort_order', flat=True).first() or 0

            for idx, img_file in enumerate(uploaded_images):
                should_be_primary = (not has_primary and idx == 0)
                if not is_list_upload and 'is_primary' in request.data:
                    is_primary_val = str(request.data.get('is_primary')).lower() in ('true', '1')
                    if is_primary_val:
                        ProductImage.objects.filter(product=product, is_primary=True).update(is_primary=False)
                        has_primary = True
                    should_be_primary = is_primary_val

                image_obj = ProductImage.objects.create(
                    product=product,
                    image=img_file,
                    is_primary=should_be_primary,
                    sort_order=max_sort + idx + 1,
                )
                created_instances.append(image_obj)
                if should_be_primary:
                    has_primary = True

        if is_list_upload or len(created_instances) > 1:
            serializer = self.get_serializer(created_instances, many=True)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        else:
            serializer = self.get_serializer(created_instances[0])
            return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='set-primary')
    def set_primary(self, request, pk=None):
        with transaction.atomic():
            image = self.get_object()
            product = Product.objects.select_for_update().get(pk=image.product_id)
            ProductImage.objects.filter(
                product=product, is_primary=True
            ).exclude(pk=image.pk).update(is_primary=False)
            image.is_primary = True
            image.save(update_fields=['is_primary'])
            serializer = self.get_serializer(image)
            return Response(serializer.data, status=status.HTTP_200_OK)

    def perform_destroy(self, instance):
        product_id = instance.product_id
        was_primary = instance.is_primary
        storage = instance.image.storage if instance.image else None
        file_name = instance.image.name if instance.image else None

        def remove_file():
            if file_name and storage and storage.exists(file_name):
                try:
                    storage.delete(file_name)
                except Exception:
                    pass

        with transaction.atomic():
            instance.delete()
            if was_primary:
                next_image = ProductImage.objects.filter(
                    product_id=product_id
                ).order_by('sort_order', 'created_at').first()
                if next_image:
                    next_image.is_primary = True
                    next_image.save(update_fields=['is_primary'])

            transaction.on_commit(remove_file)


# Backwards compatibility alias
ProductImagViewSet = ProductImageViewSet


class ProductVideoViewSet(ModelViewSet):
    queryset = ProductVideo.objects.select_related('product').all()
    serializer_class = ProductVideoSerializer
    permission_classes = [IsAdminOrReadOnly]
