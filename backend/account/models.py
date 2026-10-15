from django.contrib.auth.models import (
    AbstractBaseUser,
    PermissionsMixin,
    BaseUserManager,
)
import uuid
from django.db import models
from django.conf import settings
from django.core.validators import RegexValidator

# Create your models here.
class UserManager(BaseUserManager):
    def create_user(self,email,password=None,**extra_fields):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email)

        user = self.model(
            email=email,
            **extra_fields)

        user.set_password(password)
        user.save(using=self._db)
        return user


    def create_superuser(self,email,password=None,**extra_fields):
        extra_fields.setdefault('role','admin')
        extra_fields.setdefault('is_active',True)
        extra_fields.setdefault('is_staff',True)
        extra_fields.setdefault('is_superuser',True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")

        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")

        return self.create_user(
            email=email,
            password=password,
            **extra_fields
        )




class User(AbstractBaseUser,PermissionsMixin):
    roleChoices=(
        ('admin','Admin'),  
        ('Customer','Customer')
    )

    phone_regex = RegexValidator(
        regex=r"^\+?\d{9,15}$",
        message="Phone number must be entered in the format: '+999999999'. Up to 15 digits allowed.",
    )

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False
    )
    full_name = models.CharField(max_length=120)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=17,null=True,validators=[phone_regex],unique=True)
    role = models.CharField(max_length=20,
                            choices=roleChoices,
                            default='customer')
    profileImage = models.URLField(
        blank=True,
        null=True
    )
    address = models.TextField(null=True,blank=True)
    city = models.CharField(max_length=100,
                            null=True,
                            blank=True)
    pincode = models.CharField(max_length=10,blank=True,null=True)
    google_id = models.CharField(max_length=225,unique=True,null=True,blank=True,db_index=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD ='email'
    REQUIRED_FIELDS=['full_name']

class EmailOtp(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.CASCADE,related_name='otp')
    otp = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expir_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    failed_attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "Email OTP"
        verbose_name_plural = "Email OTPs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_used"]),
        ]

    def __str__(self):
        return f"OTP for {self.user.email} ({'used' if self.is_used else 'active'})"

    @property
    def is_expired(self):
        from django.utils import timezone
        return timezone.now() >= self.expir_at

        
    


