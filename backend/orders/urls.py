from django.urls import path
from .views import (AdminOrderDetailView,AdminOrderListView,AdminOrderStatusView,
                    CheckoutView,OrderCancelView,OrderDetailView,OrderListView)

urlpatterns = [
    path('checkout/',CheckoutView.as_view(),name='order-checkout'),
    path('',OrderListView.as_view(),name='order-list'),
    path('<uuid:pk>/',OrderDetailView.as_view(),name='order-detail'),
    path('<uuid:pk>/cancel/',OrderCancelView.as_view(),name='order-cancel'),

    #staff (admin-panel token required)
    path('admin/',AdminOrderListView.as_view(),name='admin-order-list'),
    path('admin/<uuid:pk>/',AdminOrderDetailView.as_view(),name='admin-order-detail'),
    path('admin/<uuid:pk>/status/',AdminOrderStatusView.as_view(),name='admin-order-status'),    
]