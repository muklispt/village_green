from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (ProductCategoryViewSet, ProductViewSet, ProductVariantViewSet,
                    ProductImageViewSet, ProductImagViewSet, ProductVideoViewSet,
                    ProductReviewListCreateView,MyReviewListView,
                    MyReviewDetailView)

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
    path('products/<uuid:product_id>/reviews/',
         ProductReviewListCreateView.as_view(),
         name='product-reviews',),
    path('my-reviews/',MyReviewListView.as_view(),name='my-reviews'),
    path('my-reviews/<uuid:pk>/',MyReviewDetailView.as_view(),name='my-review-detail')

]