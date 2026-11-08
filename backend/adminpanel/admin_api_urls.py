from django.urls import path
from orders.views import (AdminOrderCancelView, AdminOrderDetailView,
                          AdminOrderListView, AdminOrderStatusView)
from product.views import ProductCategoryViewSet

urlpatterns = [
    # Admin Orders API endpoints
    path('orders/', AdminOrderListView.as_view(), name='admin-orders-list'),
    path('orders/<uuid:pk>/', AdminOrderDetailView.as_view(), name='admin-orders-detail'),
    path('orders/<uuid:pk>/status/', AdminOrderStatusView.as_view(), name='admin-orders-status'),
    path('orders/<uuid:pk>/cancel/', AdminOrderCancelView.as_view(), name='admin-orders-cancel'),

    # Admin Categories API endpoints
    path('categories/', ProductCategoryViewSet.as_view({
        'get': 'list',
        'post': 'create',
    }), name='admin-categories-list'),
    path('categories/<uuid:pk>/', ProductCategoryViewSet.as_view({
        'get': 'retrieve',
        'put': 'update',
        'patch': 'partial_update',
        'delete': 'destroy',
    }), name='admin-categories-detail'),
]

