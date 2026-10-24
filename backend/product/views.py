import uuid
from django.db import transaction
from rest_framework import serializers
from django.db.models import Prefetch, Exists, OuterRef,Avg,Count,Q
from django.shortcuts import get_object_or_404
from rest_framework import status,generics
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from adminpanel.permissions import has_admin_scope
from rest_framework.permissions import AllowAny,IsAuthenticated,SAFE_METHODS
from .models import (ProductCategory, Product, ProductVariant,
                     ProductImage, ProductVideo,ProductReview)
from .pagination import ProductPagination
from .authentication import SafeStorefrontJWTAuthentication
from .permissions import IsAdminOrReadOnly
from .serializers import (ProductCategorySerializer, ProductSerializer,
                           ProductVariantSerializer, ProductImageSerializer,
                           ProductVideoSerializer, ProductListSerializer,
                           ProductDetailSerializer,ProductReviewSerializer,ProductReviewCreateSerializer)
from .validators import validate_product_image_file,MAX_IMAGE_PER_PRODUCT



class ProductCategoryViewSet(ModelViewSet):
    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [IsAdminOrReadOnly]


def is_admin_or_staff(request):
    user = getattr(request, 'user', None)
    if not (user and user.is_authenticated):
        return False
    return bool(
        user.is_staff
        or user.is_superuser
        or getattr(user, 'role', None) == 'admin'
        or has_admin_scope(request)
    )


class ProductViewSet(ModelViewSet):
    pagination_class = ProductPagination
    filter_backends = [SearchFilter, OrderingFilter]
    authentication_classes = [SafeStorefrontJWTAuthentication]
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
        is_staff = is_admin_or_staff(self.request)
        has_variants_subquery = Exists(
            ProductVariant.objects.filter(product=OuterRef('pk'), is_active=True)
        )
        approved_reviews = Q(reviews__is_approved=True)
        queryset = Product.objects.select_related('product_category', 'promotion_video').annotate(
            has_active_variants=has_variants_subquery,
            approved_review_count=Count('reviews',filter=approved_reviews),
            average_rating=Avg('reviews__rating',filter=approved_reviews),
            
        )

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
        if category_id is not None:
            category_id = category_id.strip()
            if category_id and category_id.lower() != 'all':
                try:
                    category_uuid = uuid.UUID(category_id)
                    queryset = queryset.filter(product_category_id=category_uuid)
                except ValueError:
                    raise ValidationError({'category': 'Enter a valid category id.'})

        primary_image_prefetch = Prefetch(
            'images',
            queryset=ProductImage.objects.filter(is_primary=True),
            to_attr='prefetched_primary_image'
        )
        variants_prefetch = Prefetch(
            'variants',
            queryset=variant_qs
        )

        if self.action == 'list':
            if is_staff:
                queryset = queryset.prefetch_related(
                    primary_image_prefetch,
                    variants_prefetch
                )
            else:
                queryset = queryset.prefetch_related(primary_image_prefetch)
        elif self.action == 'retrieve':
            queryset = queryset.prefetch_related(
                Prefetch('images', queryset=ProductImage.objects.all()),
                variants_prefetch,
                primary_image_prefetch,
            )
        else:
            queryset = queryset.prefetch_related(
                Prefetch('images', queryset=ProductImage.objects.all()),
                variants_prefetch,
                primary_image_prefetch,
            )

        return queryset


class ProductVariantViewSet(ModelViewSet):
    serializer_class = ProductVariantSerializer
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [IsAdminOrReadOnly]

    search_fields = [
        'sku',
        'product__name'
    ]

    @property
    def paginator(self):
        if self.request and self.request.query_params.get('product'):
            return None
        return super().paginator

    def get_queryset(self):
        queryset = ProductVariant.objects.select_related('product')

        if not is_admin_or_staff(self.request):
            queryset = queryset.filter(is_active=True, product__is_active=True)

        product_id = self.request.query_params.get('product')
        if product_id is not None:
            product_id = product_id.strip()
            if product_id and product_id.lower() != 'all':
                try:
                    product_uuid = uuid.UUID(product_id)
                    queryset = queryset.filter(product_id=product_uuid)
                except ValueError:
                    raise ValidationError({'product': 'Enter a valid product id.'})
        return queryset


class ProductImageViewSet(ModelViewSet):
    serializer_class = ProductImageSerializer
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    search_fields = ['product__name']

    def get_queryset(self):
        queryset = ProductImage.objects.select_related('product')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(product__is_active=True)

        product_id = self.request.query_params.get('product')
        if product_id is not None:
            product_id = product_id.strip()
            if product_id and product_id.lower() != 'all':
                try:
                    product_uuid = uuid.UUID(product_id)
                    queryset = queryset.filter(product_id=product_uuid)
                except ValueError:
                    raise ValidationError({'product': 'Enter a valid product id.'})

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
    serializer_class = ProductVideoSerializer
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    ordering = ['-created_at']
    search_fields = ['product__name', 'title']

    def get_queryset(self):
        queryset = ProductVideo.objects.select_related('product')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(product__is_active=True)

        product_id = self.request.query_params.get('product')
        if product_id is not None:
            product_id = product_id.strip()
            if product_id and product_id.lower() != 'all':
                try:
                    product_uuid = uuid.UUID(product_id)
                    queryset = queryset.filter(product_id=product_uuid)
                except ValueError:
                    raise ValidationError({'product': 'Enter a valid product id.'})

        return queryset.order_by('-created_at')

    def create(self, request, *args, **kwargs):
        product_id = request.data.get('product')
        if not product_id:
            raise ValidationError({'product': 'This field is required.'})

        try:
            product = Product.objects.get(pk=product_id)
        except (Product.DoesNotExist, ValueError):
            raise ValidationError({'product': 'Enter a valid product.'})

        if ProductVideo.objects.filter(product=product).exists():
            raise ValidationError({'product': 'This product already has a promotional video.'})

        return super().create(request, *args, **kwargs)

    def perform_update(self, serializer):
        instance = self.get_object()
        old_file_name = instance.video.name if instance.video else None
        old_storage = instance.video.storage if instance.video else None
        has_new_file = 'video' in self.request.FILES

        def remove_old_file():
            if old_file_name and old_storage and old_storage.exists(old_file_name):
                try:
                    old_storage.delete(old_file_name)
                except Exception:
                    pass

        with transaction.atomic():
            serializer.save()
            if has_new_file:
                transaction.on_commit(remove_old_file)

    def perform_destroy(self, instance):
        storage = instance.video.storage if instance.video else None
        file_name = instance.video.name if instance.video else None

        def remove_file():
            if file_name and storage and storage.exists(file_name):
                try:
                    storage.delete(file_name)
                except Exception:
                    pass

        with transaction.atomic():
            instance.delete()
            transaction.on_commit(remove_file)

# ---------------------------------------------------------------------------
# Product reviews
#
# Three deliberately separate access paths:
#   * public    -> approved reviews of active products only (read-only)
#   * customer  -> own reviews, including pending ones (ownership via queryset)
#   * staff     -> Django admin moderation (see product/admin.py)
# ---------------------------------------------------------------------------


class ProductReviewListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/v1/product/products/<product_id>/reviews/
        Public. Approved reviews of an active product, newest first, paginated.
    POST /api/v1/product/products/<product_id>/reviews/
        Authenticated customer. Creates a review in pending state.
    """
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [AllowAny]   # GET is public; POST is tightened below
    pagination_class = ProductPagination

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [AllowAny()]
        return [IsAuthenticated()]

    def get_product(self):
        """Active product or 404. Also rejects malformed UUIDs via URL routing."""
        if not hasattr(self, '_product'):
            self._product = get_object_or_404(
                Product.objects.filter(is_active=True),
                pk=self.kwargs['product_id'],
            )
        return self._product

    def get_serializer_class(self):
        if self.request.method in SAFE_METHODS:
            return ProductReviewSerializer
        return ProductReviewCreateSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['product'] = self.get_product()
        return context

    def get_queryset(self):
        # Unapproved reviews are never exposed, and never leak their text.
        return (
            ProductReview.objects
            .filter(product=self.get_product(), is_approved=True)
            .select_related('user', 'product')
        )


class MyReviewQuerysetMixin:
    """
    Ownership is enforced by the queryset itself: another customer's review is
    simply not found (404), so pending/private reviews are not disclosed.
    """
    authentication_classes = [SafeStorefrontJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            ProductReview.objects
            .filter(user=self.request.user)
            .select_related('product')
        )


class MyReviewListView(MyReviewQuerysetMixin, generics.ListAPIView):
    """GET /api/v1/product/my-reviews/ - own reviews, pending included."""
    serializer_class = ProductReviewSerializer
    pagination_class = ProductPagination


class MyReviewDetailView(MyReviewQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """
    GET/PATCH/DELETE /api/v1/product/my-reviews/<review_id>/

    Only `rating` and `review_text` can change (serializer read-only fields),
    and every update resets `is_approved` to False for re-moderation.
    """
    serializer_class = ProductReviewSerializer

