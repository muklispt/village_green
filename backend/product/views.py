from django.shortcuts import render
from . models import ProductCategory,Product
from rest_framework.viewsets import ModelViewSet
from . permissions import IsAdminOrReadOnly
from . serializers import ProductCategorySerializer,ProductSerializer
from .pagination import ProductPagination
from rest_framework.filters import SearchFilter

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

        if self.request.user.is_authenticated and self.request.user.is_staff:
            return queryset 
        return queryset.filter(is_active=True)
        
    



