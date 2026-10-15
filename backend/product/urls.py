from django.urls import path,include
from rest_framework.routers import DefaultRouter

from . views import (ProductCategoryViewSet,ProductViewSet,ProductVariantViewSet)

router = DefaultRouter()
router.register(
    'categories',
    ProductCategoryViewSet,
    basename='product-category',
)

router.register('products',
                ProductViewSet,basename='product')

router.register('variants',ProductVariantViewSet,basename='product-variant')

urlpatterns = [
    path("",include(router.urls)),

]