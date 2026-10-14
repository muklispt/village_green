from .models import User,EmailOtp
import re
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from django.contrib.auth import authenticate
from django.utils.http import urlsafe_base64_decode
from django.utils.encoding import force_str
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from datetime import timedelta
from django.utils import timezone

from .utils import OTP_COOLDOWN_SECONDS

class _CleanFieldsMixin:
    def validate_full_name(self, value):
        value = ' '.join(value.strip().split())
   
        if not re.fullmatch(r'[A-Za-z]+(?: [A-Za-z]+)*',value):
            raise serializers.ValidationError('Full name can contain only letters and spaces.')
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if re.match(r'^\d', value.split('@')[0]):
            raise serializers.ValidationError('Email address cannot start with a number.')

        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('Email already exists.')
        return value

        

    

class RegisterSerializer(_CleanFieldsMixin,serializers.ModelSerializer):
    
    password = serializers.CharField(
        write_only=True,
        min_length=8
    )

    confirm_password = serializers.CharField(
        write_only=True,
        min_length=8
    )

    full_name = serializers.CharField(
        min_length=3,
        max_length=50,
        required=True
    )

    class Meta:
        model = User
        fields = [
            'full_name',
            'email',
            'password',
            'confirm_password'
        ]


    def validate(self, attrs):
        password = attrs['password']
        confirm_password = attrs.pop('confirm_password')

        if password != confirm_password:
            raise serializers.ValidationError({
                'confirm_password': 'Passwords do not match.'
            })

        try:
            validate_password(password)

        except DjangoValidationError as exc:
            raise serializers.ValidationError({
                'password': exc.messages
            })

        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class VerifyOTPSerializer(serializers.Serializer):
    email = serializers.EmailField()

    otp = serializers.CharField(min_length=6,max_length=6)

    def validate_otp(sef,value):

        if not value.isdigit():
            raise serializers.ValidationError('OTP must contain only numbers')

        return value

    def validate(self, attrs):
        email = attrs['email']
        otp = attrs['otp']

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError({
                'email':'Invalid verification request.'
            })

        try:
            otp_obj = EmailOtp.objects.get(
                user=user,
                is_used = False
            )
        except EmailOtp.DoesNotExist:
            raise serializers.ValidationError({
                'otp':'Invalid or expired OTP.'
            })

        if otp_obj.is_expired:
            raise serializers.ValidationError({
               'otp':"OTP has expired."
            })

        if otp_obj.otp !=otp:
            raise serializers.ValidationError({
                'otp':"Invalid OTP."
            })

        attrs['user'] = user
        attrs['otp_obj'] = otp_obj
        return attrs

class LoginSerializer(serializers.Serializer):
    email = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email = attrs['email'].strip().lower()
        password = attrs['password']

        user = authenticate(
                request=self.context.get('request'),
                email=email,
                password=password
        ) 

        if user is None:
            raise serializers.ValidationError({
                    'error':'Check email and password'
            })

        if user.is_superuser:
            raise serializers.ValidationError({
                'error':'Check email and password'
            })

        if not user.is_active:
            raise serializers.ValidationError({
                    'error':'Verify your email'
            })

        attrs['user'] = user
        attrs['email'] = email

        return attrs
            
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields =[
            'id',
            'full_name',
            'email',
            'role',
            'phone',
            'profileImage',
            'is_active'
        ]
        read_only_fields=('id','role','is_active')

class ForgetPassword(serializers.Serializer):
    email = serializers.EmailField()

class ResetPasswordSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True,min_length=8)
    confirm_password = serializers.CharField(write_only=True,min_length=8)

    def validate(self, attrs):
        if attrs['new_password']!=attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password':'password do not match'})
        try:
            uid = force_str(urlsafe_base64_decode(attrs['uid']))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist,ValueError,TypeError,OverflowError):
            raise serializers.ValidationError({'uid':'Invalid reset link'})
        try:
            validate_password(attrs['new_password'])
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password':exc.messages})
        attrs['user'] = user
        return attrs

    def save(self, **kwargs):
        user = self.validated_data['user']
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        return user

    
class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True,min_length=8)
    new_password = serializers.CharField(write_only=True,min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate_current_password(self,value):
        if not self.context['request'].user.chack_password(value):
            raise serializers.ValidationError('current password is incorrect.')
        return value

    def validate(self, attrs):
        if attrs['new_password']!=attrs.pop('confirm_password'):
            raise serializers.ValidationError({'confirm_passwrod':'password do not match.'})
        try:
            validate_password(attrs['new_password'])
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'message':exc.messages})
        
        return attrs

    def save(self, **kwargs):
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        return user

class GoogleLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField(write_only=True, required=False)
    credential = serializers.CharField(write_only=True, required=False)
    role = serializers.CharField(
        required=False,
        default='Customer'
    )

    def validate(self, attrs):
        token = attrs.get('id_token') or attrs.get('credential')
        if not token:
            raise serializers.ValidationError({
                "credential": "Google ID token is required."
            })

        client_id = getattr(settings, 'GOOGLE_CLIENT_ID', None) or getattr(settings, 'GOOGLE_CLINT_ID', None)
        if not client_id:
            raise serializers.ValidationError("Google sign-in is not available right now.")

        try:
            payload = google_id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                client_id,
                clock_skew_in_seconds=10,
            )
        except ValueError as exc:
            raise serializers.ValidationError(f"Google sign-in failed: {str(exc)}")
        except Exception:
            raise serializers.ValidationError("Google sign-in failed. Please try again.")

        if not payload.get('email'):
            raise serializers.ValidationError("Google account has no email address.")

        if not payload.get('email_verified'):
            raise serializers.ValidationError("Google account email is not verified.")

        if not payload.get('sub'):
            raise serializers.ValidationError("Google account has no valid subject identifier.")

        self.context['google_payload'] = payload
        return attrs

    @staticmethod
    def _unique_username(email, name=None):
        if name and name.strip():
            base = ' '.join(name.strip().split())[:50]
        else:
            base = email.split('@')[0][:50] or 'user'
        return base

    def save(self, **kwargs):
        payload = self.context['google_payload']
        google_id = str(payload['sub'])
        email = str(payload['email']).strip().lower()
        full_name = payload.get('name') or email.split('@')[0]
        picture = payload.get('picture')

      
        user = User.objects.filter(google_id=google_id).first()
        if user:
            if not user.is_active:
                raise serializers.ValidationError({
                    'detail': "This account has been deactivated."
                })
            if picture and not user.profileImage:
                user.profileImage = picture
                user.save(update_fields=['profileImage'])
            return user, False

        user = User.objects.filter(email__iexact=email).first()
        if user:
            if not user.is_active:
                raise serializers.ValidationError({
                    'detail': "This account is inactive. Please verify your email first."
                })
        
            if user.google_id and user.google_id != google_id:
                raise serializers.ValidationError({
                    'detail': "An account with this email is already linked to another Google account."
                })

            update_fields = []
            if not user.google_id:
                user.google_id = google_id
                update_fields.append('google_id')
            if picture and not user.profileImage:
                user.profileImage = picture
                update_fields.append('profileImage')
            if update_fields:
                user.save(update_fields=update_fields)
            return user, False

    
        role_val = self.validated_data.get('role', 'Customer')
        if isinstance(role_val, (tuple, list)):
            role_val = role_val[0]

        user = User.objects.create(
            full_name=self._unique_username(email, full_name),
            email=email,
            role=role_val,
            is_active=True,
            google_id=google_id,
            profileImage=picture,
        )
        user.set_unusable_password()
      
        user.save(update_fields=['password'])
        return user, True


class ResendOTPSerializer(serializers.Serializer):

    email = serializers.EmailField()

    def validate_email(self,value):
        try:
            user = User.objects.get(email__iexact=value)
        except User.DoesNotExist:
            raise serializers.ValidationError("No account found with this email.")

        if user.is_active:
            raise serializers.ValidationError("Email is already verified.")

        cooldown_cutoff = timezone.now() - timedelta(seconds=OTP_COOLDOWN_SECONDS)
        recent_otp = (
            EmailOtp.objects.filter(user=user,created_at__gte=cooldown_cutoff).exists()

        )
        if recent_otp:
            raise serializers.ValidationError(
                  f"Please wait {OTP_COOLDOWN_SECONDS} seconds before requesting a new code."
            )
        
        self.context['user'] = user
        return value

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields =('full_name','email','profileImage','phone','created_at','is_active','role',
                 'city','address','pincode')
        read_only_fields = fields

class ProfileUpdateSerializer(serializers.ModelSerializer,_CleanFieldsMixin):
    class Meta:
        model = User
        fields=('full_name','profileImage','phone','address','city','pincode')

