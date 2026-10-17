from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (ProductCategoryViewSet, ProductViewSet, ProductVariantViewSet,
                    ProductImageViewSet, ProductImagViewSet, ProductVideoViewSet)

router = DefaultRouter()
router.register('categories', ProductCategoryViewSet, basename='product-category')
router.register('products', ProductViewSet, basename='product')
router.register('variants', ProductVariantViewSet, basename='product-variant')
router.register('images', ProductImageViewSet, basename='image')
router.register('product-images', ProductImagViewSet, basename='product-image')
router.register('videos', ProductVideoViewSet, basename='video')
router.register('product-videos', ProductVideoViewSet, basename='product-video')

urlpatterns = [
    path("", include(router.urls)),
]