from django.urls import path

from .views import CartItemDetailView,CartItemListView, CartView

urlpatterns =[
    path('', CartView.as_view(), name='cart'),
    path('items/', CartItemListView.as_view(), name='cart-items'),
    path('items/<uuid:pk>/', CartItemDetailView.as_view(), name='cart-item-detail'),
]