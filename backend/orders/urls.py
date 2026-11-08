from django.urls import path
from .views import (AdminOrderCancelView, AdminOrderDetailView, AdminOrderListView, AdminOrderStatusView,
                    CheckoutView, OrderCancelView, OrderDetailView, OrderListView,
                    OrderPaymentInitiateView, OrderPaymentVerifyView, RazorpayWebhookView)

urlpatterns = [
    path('checkout/',CheckoutView.as_view(),name='order-checkout'),
    path('webhook/razorpay/',RazorpayWebhookView.as_view(),name='razorpay-webhook'),
    path('my-orders/',OrderListView.as_view(),name='customer-order-list'),
    path('my-orders/<uuid:pk>/',OrderDetailView.as_view(),name='customer-order-detail'),
    path('',OrderListView.as_view(),name='order-list'),
    path('<uuid:pk>/',OrderDetailView.as_view(),name='order-detail'),
    path('<uuid:pk>/cancel/',OrderCancelView.as_view(),name='order-cancel'),
    path('<uuid:pk>/pay/',OrderPaymentInitiateView.as_view(),name='order-payment-initiate'),
    path('<uuid:pk>/payment/initiate/',OrderPaymentInitiateView.as_view(),name='order-payment-initiate-alt'),
    path('<uuid:pk>/verify/',OrderPaymentVerifyView.as_view(),name='order-payment-verify'),

    #staff (admin-panel token required)
    path('admin/',AdminOrderListView.as_view(),name='admin-order-list'),
    path('admin/<uuid:pk>/',AdminOrderDetailView.as_view(),name='admin-order-detail'),
    path('admin/<uuid:pk>/status/',AdminOrderStatusView.as_view(),name='admin-order-status'),
    path('admin/<uuid:pk>/cancel/',AdminOrderCancelView.as_view(),name='admin-order-cancel'),
]
