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
        self.assertEqual(str(response.data['otp'][0]), 'Invalid or expired verification code.')

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
            self.assertEqual(str(res.data['otp'][0]), 'Invalid or expired verification code.')
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
        self.assertEqual(str(correct_res.data['otp'][0]), 'Invalid or expired verification code.')

    def test_expired_code_rejected(self):
        EmailOtp.objects.filter(pk=self.otp_record.pk).update(
            expir_at=timezone.now() - timedelta(minutes=1)
        )
        response = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.user.email,
            'otp': self.plain_otp
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(response.data['otp'][0]), 'Invalid or expired verification code.')

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

    def test_resend_otp_non_existent_email_returns_200_generic(self):
        response = self.client.post('/api/v1/account/resend-otp/', {
            'email': 'nosuchuser@example.com'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('If an unverified account exists', response.data.get('detail', ''))

    def test_resend_otp_already_verified_returns_200_generic(self):
        verified_user = User.objects.create_user(
            email='alreadyverified@example.com',
            password='SecurePassword123!',
            full_name='Verified User',
            is_active=True
        )
        response = self.client.post('/api/v1/account/resend-otp/', {
            'email': verified_user.email
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('If an unverified account exists', response.data.get('detail', ''))


class SecurityIsolationTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            email='userforreset@example.com',
            password='OldSecurePass123!',
            full_name='Reset Tester',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_reset_password_rejects_tampered_token_with_generic_error(self):
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        response = self.client.post('/api/v1/account/reset-password/', {
            'uid': uid,
            'token': 'completely-invalid-token',
            'new_password': 'NewPassword123!',
            'confirm_password': 'NewPassword123!'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = response.data.get('detail')
        detail_str = str(detail[0]) if isinstance(detail, list) else str(detail)
        self.assertEqual(detail_str, 'Invalid or expired reset link.')

    def test_reset_password_success_and_revokes_tokens(self):
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        from django.contrib.auth.tokens import default_token_generator
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        refresh = RefreshToken.for_user(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = default_token_generator.make_token(self.user)

        response = self.client.post('/api/v1/account/reset-password/', {
            'uid': uid,
            'token': token,
            'new_password': 'BrandNewPass123!',
            'confirm_password': 'BrandNewPass123!'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh['jti']).exists())

    def test_register_smtp_failure_rolls_back_user_and_returns_503(self):
        from unittest.mock import patch
        data = {
            'full_name': 'Failed Mail User',
            'email': 'failedmail@example.com',
            'password': 'SecurePassword123!',
            'confirm_password': 'SecurePassword123!'
        }
        with patch('account.views.send_otp_email', side_effect=Exception('SMTP Connection Refused')):
            response = self.client.post('/api/v1/account/register/', data)

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertFalse(User.objects.filter(email='failedmail@example.com').exists())

    def test_google_login_rejects_admin_or_staff_account(self):
        from unittest.mock import patch
        admin_user = User.objects.create_superuser(
            email='admin@example.com',
            password='AdminPassword123!',
            full_name='Admin User'
        )
        fake_payload = {
            'sub': '1234567890',
            'email': admin_user.email,
            'email_verified': True,
            'name': 'Admin User'
        }
        with patch('google.oauth2.id_token.verify_oauth2_token', return_value=fake_payload), \
             patch('django.conf.settings.GOOGLE_CLIENT_ID', 'test-client-id'):
            response = self.client.post('/api/v1/account/google-login/', {
                'id_token': 'fake-token'
            })
        self.assertIn(response.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN))
        detail_msg = str(response.data)
        self.assertIn('Admin accounts must sign in through the admin portal', detail_msg)


class PasswordAndSessionManagementTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.user_password = 'InitialPassword123!'
        self.user = User.objects.create_user(
            email='sessionsuser@example.com',
            password=self.user_password,
            full_name='Session Tester',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_change_password_success_and_rotates_tokens(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        old_refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(old_refresh.access_token)}')

        response = self.client.post('/api/v1/account/change-password/', {
            'current_password': self.user_password,
            'new_password': 'UpdatedPassword123!',
            'confirm_password': 'UpdatedPassword123!'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

        # Old refresh token is now blacklisted
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=old_refresh['jti']).exists())

        # Old password cannot log in
        login_fail = self.client.post('/api/v1/account/login/', {
            'email': self.user.email,
            'password': self.user_password
        })
        self.assertEqual(login_fail.status_code, status.HTTP_400_BAD_REQUEST)

        # New password logs in successfully
        login_success = self.client.post('/api/v1/account/login/', {
            'email': self.user.email,
            'password': 'UpdatedPassword123!'
        })
        self.assertEqual(login_success.status_code, status.HTTP_200_OK)

    def test_change_password_rejects_same_password(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.post('/api/v1/account/change-password/', {
            'current_password': self.user_password,
            'new_password': self.user_password,
            'confirm_password': self.user_password
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('new_password', response.data)
        self.assertIn('cannot be the same', str(response.data['new_password']))

    def test_change_password_rejects_incorrect_current_password(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.post('/api/v1/account/change-password/', {
            'current_password': 'WrongPassword999!',
            'new_password': 'BrandNewPassword123!',
            'confirm_password': 'BrandNewPassword123!'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('current_password', response.data)

    def test_logout_blacklists_refresh_token(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        refresh = RefreshToken.for_user(self.user)
        response = self.client.post('/api/v1/account/logout/', {
            'refresh': str(refresh)
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh['jti']).exists())

        # Second logout call with same token does not throw 500 error
        second_response = self.client.post('/api/v1/account/logout/', {
            'refresh': str(refresh)
        })
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)

    def test_logout_all_devices(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        refresh1 = RefreshToken.for_user(self.user)
        refresh2 = RefreshToken.for_user(self.user)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh1.access_token)}')
        response = self.client.post('/api/v1/account/logout-all/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh1['jti']).exists())
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh2['jti']).exists())


class AccountLifecycleAndProfileTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.password = 'UserSecret123!'
        self.user = User.objects.create_user(
            email='lifecycleuser@example.com',
            password=self.password,
            full_name='Lifecycle Tester',
            phone='+12345678901',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_deactivate_account_with_correct_password(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.post('/api/v1/account/deactivate/', {
            'password': self.password
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh['jti']).exists())

    def test_deactivate_account_rejects_wrong_password(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.post('/api/v1/account/deactivate/', {
            'password': 'WrongPassword123!'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_deactivate_google_only_account(self):
        from unittest.mock import patch
        from rest_framework_simplejwt.tokens import RefreshToken

        google_user = User.objects.create(
            email='googleonly@example.com',
            full_name='Google Only',
            google_id='gid-99999',
            is_active=True
        )
        google_user.set_unusable_password()
        google_user.save()

        refresh = RefreshToken.for_user(google_user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        fake_payload = {
            'sub': 'gid-99999',
            'email': google_user.email,
            'email_verified': True
        }
        with patch('google.oauth2.id_token.verify_oauth2_token', return_value=fake_payload), \
             patch('django.conf.settings.GOOGLE_CLIENT_ID', 'test-client-id'):
            response = self.client.post('/api/v1/account/deactivate/', {
                'credential': 'valid-google-cred'
            })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        google_user.refresh_from_db()
        self.assertFalse(google_user.is_active)

    def test_profile_update_normalizes_empty_phone_to_none(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.put('/api/v1/account/profile/', {
            'full_name': 'Lifecycle Tester Updated',
            'phone': '   ',
            'address': '123 Test St',
            'city': 'Testville',
            'pincode': '12345'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.phone)

    def test_profile_update_rejects_duplicate_phone(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        User.objects.create_user(
            email='otheruser@example.com',
            password='OtherPass123!',
            full_name='Other User',
            phone='+19999999999',
            is_active=True
        )
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.put('/api/v1/account/profile/', {
            'full_name': 'Lifecycle Tester',
            'phone': '+19999999999'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('phone', response.data)




