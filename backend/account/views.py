from . import serializer 
from rest_framework import generics
from .models import User,EmailOtp
from rest_framework.views import APIView
from rest_framework.response import Response
from . utils import send_otp_email,send_reset_password_mail,send_welcom_email
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.views import status
from rest_framework.permissions import AllowAny,IsAuthenticated
from django.contrib.auth.models import update_last_login
from rest_framework.throttling import ScopedRateThrottle


# Create your views here.

class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'register'
    def post(self,request):
        serializers = serializer.RegisterSerializer(data=request.data)

        if serializers.is_valid():
            serializers.save()
            send_otp_email(serializers.validated_data['email'])
            return Response(
                {'message':'Registration successful. A verification code has been sent to your email.',
                 'email':serializers.validated_data['email']},
                status=status.HTTP_201_CREATED,
            )
        return Response(serializers.errors,status=status.HTTP_400_BAD_REQUEST)

class VerifyOTPView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'verify-otp'
    def post(self,request):
        serializers = serializer.VerifyOTPSerializer(data=request.data)

        serializers.is_valid(raise_exception=True)
        user = serializers.validated_data['user']
        otp_obj = serializers.validated_data['otp_obj']

        user.is_active=True
        user.save(update_fields=["is_active"])

        otp_obj.is_used = True
        otp_obj.save(update_fields=['is_used'])

        return Response(
            {'message':'Email verified successfully'},status=status.HTTP_200_OK
        )

class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'login'

    def post(self,request):
        serializers = serializer.LoginSerializer(data=request.data,context={'request':request})
        serializers.is_valid(raise_exception=True)

        user = serializers.validated_data['user']

        refresh = RefreshToken.for_user(user)

        return Response({
            'message':'Login successfuly',
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        },status=status.HTTP_200_OK)


class UserView(generics.RetrieveAPIView):
    permission_classes =[IsAuthenticated]
    serializer_class =serializer.UserSerializer
    queryset = User.objects.all()

    def get_object(self):
        return self.request.user

class ForgetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'forgot-password'
    GENERIC_RESPONSE = {"detail": "If that email is registered, a reset link has been sent."}

    def post(self,request):
        serializers = serializer.ForgetPassword(data=request.data)
        serializers.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializers.validated_data['email'],is_active=True).first()
        if user:
            send_reset_password_mail(user)
        return Response(self.GENERIC_RESPONSE,status=status.HTTP_200_OK)

class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'reset-password'

    def post(self,request):
        serializers = serializer.ResetPasswordSerializer(data=request.data)
        serializers.is_valid(raise_exception=True)
        serializers.save()
        return Response({"detail": "Password reset successfully."}, status=status.HTTP_200_OK)
        
class ChangePasswordView(generics.CreateAPIView):
    permission_classes=[IsAuthenticated]
    def post(self,request):
        serializers = serializer.ChangePasswordSerializer(data=request.user,context={'request':request})
        serializers.is_valid(raise_exception=True)
        serializers.save()

        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken,OutstandingToken
        outstanding_tokens = OutstandingToken.objects.filter(user=request.user)
        existing = set(
            BlacklistedToken.objects.filter(token__in=outstanding_tokens)
            .values_list('token_id',flat=True)
        )
        BlacklistedToken.objects.bulk_create(
            [BlacklistedToken(token=t) for t in outstanding_tokens if t.pk not in existing],
            ignore_conflicts=True,
        )
        refresh = RefreshToken.for_user(request.user)
        return Response({
            "detail": "Password changed successfully.",
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        }, status=status.HTTP_200_OK)
     
class GoogleLoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'google-login'

    def post(self, request):
        serializers = serializer.GoogleLoginSerializer(data=request.data, context={'request': request})
        serializers.is_valid(raise_exception=True)
        user, created = serializers.save()

        if not user.is_active:
            return Response({
                'detail': "This account has been deactivated."
            }, status=status.HTTP_403_FORBIDDEN)

        if created:
            send_welcom_email(user)

        refresh = RefreshToken.for_user(user)
        # Fixed: update_last_login(sender, user) expects (None, user)
        update_last_login(None, user)

        return Response(
            {
                "message": "Login successful",
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": {
                    "id": str(user.id),
                    "full_name": user.full_name,
                    "email": user.email,
                    "role": user.role,
                    "profileImage": user.profileImage,
                },
            },
            status=status.HTTP_200_OK,
        )

class ResendOTPView(APIView):

    permission_classes =[AllowAny]
    throttle_classes =[ScopedRateThrottle]
    throttle_scope = 'resend-otp'

    def post(self,request):
        serializers = serializer.ResendOTPSerializer(data=request.data)
        serializers.is_valid(raise_exception=True)
        user = serializers.validated_data['email']
        send_otp_email(user)
        return Response(
            {"detail": "A new verification code has been sent to your email."},
            status=status.HTTP_200_OK,
        )

class ProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = serializer.ProfileSerializer
    permission_classes =[IsAuthenticated]

    def get_object(self):
        return self.request.user

    def get_serializer_class(self):
        if self.request.method in ('PATCH','PUT'):
            return serializer.ProfileUpdateSerializer
        return serializer.ProfileSerializer


         
            




    


    


