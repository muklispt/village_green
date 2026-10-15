from . models import ProductCategory,Product,ProductVariant
from rest_framework.viewsets import ModelViewSet
from . permissions import IsAdminOrReadOnly
from . serializers import (ProductCategorySerializer,ProductSerializer,ProductVariantSerializer)
from .pagination import ProductPagination
from rest_framework.filters import SearchFilter
from rest_framework.exceptions import  ValidationError
import uuid


# Create your views here.

class ProductCategoryViewSet(ModelViewSet):
    queryset = ProductCategory.objects.all()
    serializer_class=ProductCategorySerializer
    permission_classes =[IsAdminOrReadOnly]

class ProductViewSet(ModelViewSet):
    serializer_class = ProductSerializer
    pagination_class=ProductPagination
    filter_backends=[SearchFilter]
    permission_classes =[IsAdminOrReadOnly]

    search_fields =[
        'name',
        'description',
        'slug',
        'product_category__name'
    ]

    def get_queryset(self):
        queryset = Product.objects.select_related('product_category')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(is_active=True)

        category_id = self.request.query_params.get('category')
        if category_id:
            try:
                category_uuid = uuid.UUID(category_id)
            except ValueError:
                raise ValidationError({'category': 'Enter a valid category id.'})
            queryset = queryset.filter(product_category_id=category_uuid)

        return queryset

class  ProductVariantViewSet(ModelViewSet):
    serializer_class  = ProductVariantSerializer
    pagination_class = ProductPagination
    filter_backends = [SearchFilter]
    permission_classes =[IsAdminOrReadOnly]

    search_fields = [
        'sku',
        'product__name'
    ]

    def get_queryset(self):
        queryset = ProductVariant.objects.select_related('product')

        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(is_active=True,product__is_active=True)

        product_id = self.request.query_parmas.get('product')
        if product_id:
            try:
                product_id= uuid.UUID(product_id)
            except ValueError:
                raise ValidationError({'product':'Enter a valid product id.'})
            queryset = queryset.filter(product_id=product_id)
        return queryset


