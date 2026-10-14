from importlib import import_module
from django.conf import settings
import random
from . models import EmailOtp,User
from datetime import timedelta
from django.utils import timezone
from django.core.mail import send_mail
import logging
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.contrib.auth.tokens import default_token_generator

logger = logging.getLogger(__name__)

# OTP lifetime in minutes
OTP_EXPIRY_MINUTES = 5

# Minimum seconds between consecutive OTP sends for the same user
OTP_COOLDOWN_SECONDS = 60

_sys_random = random.SystemRandom()
def generateOtp():
    return str(_sys_random.randint(100000, 999999))

def _uid_for(user):
    return urlsafe_base64_encode(force_bytes(user.pk))

def send_otp_email(email):
    otp = generateOtp()
    
    user =  User.objects.get(email=email)
   
        

    EmailOtp.objects.filter(user=user,is_used=False).update(is_used=True)
    otp_record=EmailOtp.objects.create(
        user = user,
        otp=otp,
        expir_at = timezone.now()+timedelta(minutes=OTP_EXPIRY_MINUTES)
        
    )

    html_message = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Green Village Email Verification</title>
    </head>
    <body style="margin:0;padding:0;background-color:#f0f7f0;
                 font-family:Arial,Helvetica,sans-serif;">

        <div style="max-width:480px;margin:35px auto;padding:0 12px;">
          <div style="background:#ffffff;border-radius:16px;
                      overflow:hidden;border:1px solid #dce9dc;">

            <!-- Header -->
            <div style="background-color:#166534;padding:30px 24px;
                        text-align:center;">
              <div style="font-size:32px;">🌿</div>
              <h1 style="color:#ffffff;font-size:25px;margin:8px 0;">
                Green Village
              </h1>
              <p style="color:#dcfce7;font-size:14px;margin:0;">
                Connecting communities, growing together
              </p>
            </div>

            <!-- Email body -->
            <div style="padding:32px 24px;text-align:center;">
              <h2 style="color:#166534;font-size:21px;margin:0 0 18px;">
                Verify Your Email
              </h2>

              <p style="color:#374151;font-size:15px;line-height:1.7;">
                Hello <strong>{user.full_name}</strong>,
              </p>

              <p style="color:#4b5563;font-size:14px;line-height:1.7;">
                Welcome to Green Village! Use the verification code below
                to confirm your email address and continue creating your account.
              </p>

              <!-- OTP -->
              <div style="display:inline-block;background:#f0fdf4;
                          border:2px solid #16a34a;border-radius:12px;
                          padding:18px 24px;margin:18px 0;">
                <span style="color:#166534;font-family:Courier New,monospace;
                             font-size:32px;font-weight:bold;
                             letter-spacing:8px;">
                  {otp}
                </span>
              </div>

              <p style="color:#4b5563;font-size:13px;line-height:1.6;">
                This verification code expires in
                <strong>{OTP_EXPIRY_MINUTES} minutes</strong>.
              </p>

              <p style="color:#6b7280;font-size:13px;line-height:1.6;">
                If you did not request this code, you can safely ignore
                this email. Never share your verification code with anyone.
              </p>
            </div>

            <!-- Footer -->
            <div style="background:#f8faf8;border-top:1px solid #e5eee5;
                        padding:20px;text-align:center;">
              <p style="color:#166534;font-size:14px;font-weight:bold;
                        margin:0 0 8px;">
                Green Village
              </p>
              <p style="color:#6b7280;font-size:12px;line-height:1.6;
                        margin:0;">
                A better way to connect with your local community.<br>
                © Green Village. All rights reserved.
              </p>
            </div>

          </div>
        </div>
    </body>
    </html>
    """
    
    plain_message = (
        f"Hi {user.full_name},\n\n"
        f"Your email verification code is: {otp}\n\n"
        f"This code expires in {OTP_EXPIRY_MINUTES} minutes.\n"
        f"If you didn't create an account, you can safely ignore this email."
    )
    
    try:

       send_mail(
        subject="Your Verification Code — Green Village",
        message=plain_message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html_message,
       )
       logger.info("[EMAIL] OTP verification email sent to %s", user.email)
    except Exception:
       logger.exception("[EMAIL] Failed to send OTP verification email to %s", user.email)
       raise
        
    return otp_record

def send_reset_password_mail(user):
    uid = _uid_for(user)
    toke = default_token_generator.make_token(user)
    link = f'{settings.FRONTEND_URL}/reset-password/{uid}/{toke}'

    try:

        send_mail(
            subject="Reset your Green Village password",
            message=(
                f"Hi {user.full_name},\n\n"
                f"A password reset was requested for your account. Visit the link "
                f"below to choose a new password:\n{link}\n\n"
                f"This link expires in {settings.PASSWORD_RESET_TIMEOUT // 3600} hours. "
                f"If you didn't request this, you can safely ignore this email."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
        logger.info("[EMAIL] Password reset email sent to %s", user.email)
    except Exception:
        logger.exception("[EMAIL] Failed to send password reset email to %s", user.email)
        raise

def send_welcom_email(user):
    try:
        send_mail(
             subject="Welcome to Green Village!",
            message=(
                f"Hi {user.full_name},\n\n"
                f"Your email has been verified and your account is now active.\n\n"
                f"You can start exploring services at:\n"
                f"{settings.FRONTEND_URL}\n\n"
                f"Thank you for joining Local Worker Booking!"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
        logger.info("[EMAIL] Welcome email sent to %s", user.email)
    except Exception:
        logger.exception("[EMAIL] Failed to send welcome email to %s", user.email)
  