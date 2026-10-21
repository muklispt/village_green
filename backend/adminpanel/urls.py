from django.urls import path

from .views import (AdminDashboardView, AdminLoginView, AdminLogoutView,
                    AdminMeView, AdminRefreshView)

urlpatterns = [
    path('login/', AdminLoginView.as_view(), name='admin-login'),
    path('refresh/', AdminRefreshView.as_view(), name='admin-refresh'),
    path('logout/', AdminLogoutView.as_view(), name='admin-logout'),
    path('me/', AdminMeView.as_view(), name='admin-me'),
    path('dashboard/', AdminDashboardView.as_view(), name='admin-dashboard'),
]