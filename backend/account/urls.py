from django.urls import path
from .views import (RegisterView,VerifyOTPView,LoginView,UserView,
                    ForgetPasswordView,ResetPasswordView,GoogleLoginView,
                    ResendOTPView,ProfileView,ChangePasswordView,LogoutView,LogoutAllView,
                    DeactivateAccountView,AdminCustomerListView,AdminCustomerDetailView,
                    AdminCustomerBlockView,AdminCustomerUnblockView,CustomerTokenRefreshView)

urlpatterns=[
    path('register/',RegisterView.as_view(),name='register'),
    path('otp_veryfication/',VerifyOTPView.as_view(),name='otp_veryfication'),
    path('login/',LoginView.as_view(),name='login'),
    path('token/refresh/',CustomerTokenRefreshView.as_view(),name='token-refresh'),
    path('refresh/',CustomerTokenRefreshView.as_view(),name='auth-refresh'),
    path('logout/',LogoutView.as_view(),name='auth-logout'),
    path('logout-all/',LogoutAllView.as_view(),name='auth-logout-all'),
    path('change-password/',ChangePasswordView.as_view(),name='auth-change-password'),
    path('deactivate/',DeactivateAccountView.as_view(),name='auth-deactivate'),
    path('user/',UserView.as_view(),name='user'),
    path('reset-password/',ResetPasswordView.as_view(),name='auth-reset-password'),
    path('forget-password/',ForgetPasswordView.as_view(),name='auth-forget-password'),
    path('google/',GoogleLoginView.as_view(),name='google-login'),
    path('google-login/',GoogleLoginView.as_view(),name='auth-google-login'),
    path('resend-otp/',ResendOTPView.as_view(),name="auth-resend-otp"),
    path('profile/',ProfileView.as_view(),name='auth-profile'),
    # Admin Customer Management
    path('admin/customers/',AdminCustomerListView.as_view(),name='admin-customer-list'),
    path('admin/customers/<uuid:pk>/',AdminCustomerDetailView.as_view(),name='admin-customer-detail'),
    path('admin/customers/<uuid:pk>/block/',AdminCustomerBlockView.as_view(),name='admin-customer-block'),
    path('admin/customers/<uuid:pk>/unblock/',AdminCustomerUnblockView.as_view(),name='admin-customer-unblock'),
]


