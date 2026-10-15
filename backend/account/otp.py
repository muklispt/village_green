import random
from datetime import timedelta
from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers

from .models import EmailOtp

OTP_EXPIRY_MINUTES = 5
OTP_COOLDOWN_SECONDS = 60
MAX_FAILED_ATTEMPTS = 5

_sys_random = random.SystemRandom()

def generate_plain_otp():
    """Generate a secure 6-digit numeric OTP."""
    return str(_sys_random.randint(100000, 999999))

def create_otp(user):
    """
    Invalidate previous unused OTPs for the user, generate a new plain OTP,
    store its cryptographic hash, and return (otp_record, plain_otp).
    """
    EmailOtp.objects.filter(user=user, is_used=False).update(is_used=True)

    plain_otp = generate_plain_otp()
    hashed_otp = make_password(plain_otp)
    expir_at = timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)

    otp_record = EmailOtp.objects.create(
        user=user,
        otp=hashed_otp,
        expir_at=expir_at,
        is_used=False,
        failed_attempts=0
    )
    return otp_record, plain_otp

def get_latest_unused_otp(user):
    """Retrieve the newest unused OTP for the user, avoiding duplicate object collisions."""
    return EmailOtp.objects.filter(user=user, is_used=False).order_by('-created_at').first()

def verify_otp(user, plain_otp):
    """
    Verify a plain OTP against the user's latest unused hashed OTP record.
    Increments failed_attempts atomically on mismatch.
    Invalidates the OTP after 5 wrong attempts.
    """
    otp_obj = get_latest_unused_otp(user)

    if not otp_obj:
        raise serializers.ValidationError({
            'otp': 'Invalid or expired OTP.'
        })

    if otp_obj.is_expired:
        raise serializers.ValidationError({
            'otp': 'OTP has expired.'
        })

    if not check_password(plain_otp, otp_obj.otp):
        EmailOtp.objects.filter(pk=otp_obj.pk).update(
            failed_attempts=F('failed_attempts') + 1
        )
        otp_obj.refresh_from_db(fields=['failed_attempts'])

        if otp_obj.failed_attempts >= MAX_FAILED_ATTEMPTS:
            EmailOtp.objects.filter(pk=otp_obj.pk).update(is_used=True)
            raise serializers.ValidationError({
                'otp': 'Too many attempts. Request a new code.'
            })

        raise serializers.ValidationError({
            'otp': 'Invalid OTP.'
        })

    return otp_obj

def mark_otp_used(otp_obj):
    """Mark an OTP record as used."""
    EmailOtp.objects.filter(pk=otp_obj.pk).update(is_used=True)
    otp_obj.is_used = True
