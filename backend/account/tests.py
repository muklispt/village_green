from rest_framework.test import APITestCase
from rest_framework import status
from django.utils import timezone
from datetime import timedelta
from django.core.cache import cache
from django.contrib.auth.hashers import check_password

from .models import User, EmailOtp
from .otp import create_otp, MAX_FAILED_ATTEMPTS

class AccountStatusCodeTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.user_password = 'TestPassword123!'
        self.user = User.objects.create_user(
            email='testuser@example.com',
            password=self.user_password,
            full_name='Test User',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_register_returns_201(self):
        data = {
            'full_name': 'New User',
            'email': 'newuser@example.com',
            'password': 'SecurePass123!',
            'confirm_password': 'SecurePass123!'
        }
        response = self.client.post('/api/v1/account/register/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_login_returns_200(self):
        data = {
            'email': 'testuser@example.com',
            'password': self.user_password
        }
        response = self.client.post('/api/v1/account/login/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_verify_otp_returns_200(self):
        unverified_user = User.objects.create_user(
            email='unverified@example.com',
            password='TestPassword123!',
            full_name='Unverified User',
            is_active=False
        )
        _, plain_otp = create_otp(unverified_user)
        data = {
            'email': 'unverified@example.com',
            'otp': plain_otp
        }
        response = self.client.post('/api/v1/account/otp_veryfication/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_forgot_password_returns_200(self):
        data = {
            'email': 'testuser@example.com'
        }
        response = self.client.post('/api/v1/account/forget-password/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class EmailOTPSecurityTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='otpuser@example.com',
            password='SecurePass123!',
            full_name='OTP User',
            is_active=False
        )
        self.otp_record, self.plain_otp = create_otp(self.user)

    def tearDown(self):
        cache.clear()

    def test_wrong_code_increments_attempts(self):
        response = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': '000000'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('otp', response.data)
        self.assertEqual(str(response.data['otp'][0]), 'Invalid OTP.')

        self.otp_record.refresh_from_db()
        self.assertEqual(self.otp_record.failed_attempts, 1)
        self.assertFalse(self.otp_record.is_used)

    def test_fifth_wrong_guess_invalidates_and_correct_code_fails(self):
        for attempt in range(1, 5):
            res = self.client.post('/api/v1/account/otp_veryfication/', {
                'email': self.user.email,
                'otp': '111111'
            })
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertEqual(str(res.data['otp'][0]), 'Invalid OTP.')
            self.otp_record.refresh_from_db()
            self.assertEqual(self.otp_record.failed_attempts, attempt)
            self.assertFalse(self.otp_record.is_used)

        # 5th wrong guess
        fifth_res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': '111111'
        })
        self.assertEqual(fifth_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(fifth_res.data['otp'][0]), 'Too many attempts. Request a new code.')

        self.otp_record.refresh_from_db()
        self.assertEqual(self.otp_record.failed_attempts, 5)
        self.assertTrue(self.otp_record.is_used)

        # Now trying the correct plain OTP fails because the record was invalidated
        correct_res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': self.plain_otp
        })
        self.assertEqual(correct_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(correct_res.data['otp'][0]), 'Invalid or expired OTP.')

    def test_expired_code_rejected(self):
        EmailOtp.objects.filter(pk=self.otp_record.pk).update(
            expir_at=timezone.now() - timedelta(minutes=1)
        )
        response = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': self.plain_otp
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(response.data['otp'][0]), 'OTP has expired.')

    def test_correct_code_verifies(self):
        response = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': self.plain_otp
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get('message'), 'Email verified successfully')

        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

        self.otp_record.refresh_from_db()
        self.assertTrue(self.otp_record.is_used)

    def test_stored_value_is_not_plain_code(self):
        self.otp_record.refresh_from_db()
        self.assertNotEqual(self.otp_record.otp, self.plain_otp)
        self.assertGreater(len(self.otp_record.otp), 20)
        self.assertTrue(check_password(self.plain_otp, self.otp_record.otp))

    def test_throttle_returns_429_on_eleventh_verify_call(self):
        # 10 calls allowed per minute under verify-otp scope
        for i in range(10):
            res = self.client.post('/api/v1/account/otp_veryfication/', {
                'email': self.user.email,
                'otp': '999999'
            })
            self.assertIn(res.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_200_OK))

        # 11th call must be throttled
        eleventh_res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': self.plain_otp
        })
        self.assertEqual(eleventh_res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('detail', eleventh_res.data)
        self.assertIn('throttled', str(eleventh_res.data['detail']).lower())

    def test_resend_otp_still_works(self):
        # Ensure cooldown has passed by setting created_at older than OTP_COOLDOWN_SECONDS
        EmailOtp.objects.filter(pk=self.otp_record.pk).update(
            created_at=timezone.now() - timedelta(seconds=70)
        )
        response = self.client.post('/api/v1/account/resend-otp/', {
            'email': self.user.email
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.otp_record.refresh_from_db()
        self.assertTrue(self.otp_record.is_used)

        newest_otp = EmailOtp.objects.filter(user=self.user, is_used=False).order_by('-created_at').first()
        self.assertIsNotNone(newest_otp)
        self.assertNotEqual(newest_otp.pk, self.otp_record.pk)
        self.assertEqual(newest_otp.failed_attempts, 0)
