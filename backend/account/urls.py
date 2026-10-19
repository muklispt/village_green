from django.urls import path
from .views import (RegisterView,VerifyOTPView,LoginView,UserView,
                    ForgetPasswordView,ResetPasswordView,GoogleLoginView,
                    ResendOTPView,ProfileView,ChangePasswordView,LogoutView,LogoutAllView,
                    DeactivateAccountView)

urlpatterns=[
    path('register/',RegisterView.as_view(),name='register'),
    path('otp_veryfication/',VerifyOTPView.as_view(),name='otp_veryfication'),
    path('login/',LoginView.as_view(),name='login'),
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
]


