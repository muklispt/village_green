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
        registered_user = User.objects.get(email='newuser@example.com')
        self.assertFalse(registered_user.is_active)


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

    def test_profile_throttle_returns_429_after_limit(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        for _ in range(30):
            res = self.client.get('/api/v1/account/profile/')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 31st request triggers 429
        throttled_res = self.client.get('/api/v1/account/profile/')
        self.assertEqual(throttled_res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class AdminCustomerManagementTestCase(APITestCase):

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_superuser(
            email='portaladmin@example.com',
            password='AdminPassword123!',
            full_name='Portal Admin'
        )
        self.staff_no_scope = User.objects.create_user(
            email='staffnoscope@example.com',
            password='StaffPassword123!',
            full_name='Staff Member',
            is_staff=True,
            role='admin',
            is_active=True
        )
        self.customer = User.objects.create_user(
            email='shopper@example.com',
            password='CustomerPassword123!',
            full_name='Alice Shopper',
            phone='+18888888888',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_customer_token_gets_403_on_admin_customer_endpoints(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(self.customer)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.get('/api/v1/account/admin/customers/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        detail_res = self.client.get(f'/api/v1/account/admin/customers/{self.customer.pk}/')
        self.assertEqual(detail_res.status_code, status.HTTP_403_FORBIDDEN)

        block_res = self.client.post(f'/api/v1/account/admin/customers/{self.customer.pk}/block/')
        self.assertEqual(block_res.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_account_with_non_admin_scope_token_gets_403(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        # Standard token without scope=admin
        refresh = RefreshToken.for_user(self.staff_no_scope)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(refresh.access_token)}')

        response = self.client.get('/api/v1/account/admin/customers/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_with_admin_scope_can_list_and_paginate_customers(self):
        from adminpanel.tokens import AdminRefreshToken
        # Create 25 additional customers
        for i in range(25):
            User.objects.create_user(
                email=f'bulkcustomer{i}@example.com',
                password='TestPassword123!',
                full_name=f'Bulk Customer {i}',
                is_active=True
            )

        admin_refresh = AdminRefreshToken.for_user(self.admin)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(admin_refresh.access_token)}')

        response = self.client.get('/api/v1/account/admin/customers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('results', response.data)
        # Default page_size is 20
        self.assertEqual(len(response.data['results']), 20)
        self.assertGreaterEqual(response.data['count'], 26)

    def test_admin_search_and_active_filters(self):
        from adminpanel.tokens import AdminRefreshToken
        inactive_customer = User.objects.create_user(
            email='banned@example.com',
            password='TestPassword123!',
            full_name='Banned Bob',
            is_active=False
        )
        admin_refresh = AdminRefreshToken.for_user(self.admin)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(admin_refresh.access_token)}')

        # Search by full_name
        search_res = self.client.get('/api/v1/account/admin/customers/?search=Shopper')
        self.assertEqual(search_res.status_code, status.HTTP_200_OK)
        emails = [c['email'] for c in search_res.data['results']]
        self.assertIn(self.customer.email, emails)

        # Filter ?is_active=false
        inactive_res = self.client.get('/api/v1/account/admin/customers/?is_active=false')
        self.assertEqual(inactive_res.status_code, status.HTTP_200_OK)
        inactive_emails = [c['email'] for c in inactive_res.data['results']]
        self.assertIn('banned@example.com', inactive_emails)
        self.assertNotIn(self.customer.email, inactive_emails)

    def test_admin_block_and_unblock_calls_revoke_tokens(self):
        from adminpanel.tokens import AdminRefreshToken
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        customer_refresh = RefreshToken.for_user(self.customer)
        admin_refresh = AdminRefreshToken.for_user(self.admin)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {str(admin_refresh.access_token)}')

        # Block customer
        block_res = self.client.post(f'/api/v1/account/admin/customers/{self.customer.pk}/block/')
        self.assertEqual(block_res.status_code, status.HTTP_200_OK)
        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_active)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=customer_refresh['jti']).exists())

        # Unblock customer
        unblock_res = self.client.post(f'/api/v1/account/admin/customers/{self.customer.pk}/unblock/')
        self.assertEqual(unblock_res.status_code, status.HTTP_200_OK)
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_active)


class EmailVerificationEnforcementTestCase(APITestCase):
    """
    Test F1: Email verification enforcement before customer login.
    Ensures newly registered customers start inactive and only verified
    accounts can log in.
    """

    def setUp(self):
        cache.clear()
        self.password = 'StrongSecret123!'
        self.verified_user = User.objects.create_user(
            email='verified_cust@example.com',
            password=self.password,
            full_name='Verified Cust',
            is_active=True
        )
        self.unverified_user = User.objects.create_user(
            email='unverified_cust@example.com',
            password=self.password,
            full_name='Unverified Cust',
            is_active=False
        )

    def tearDown(self):
        cache.clear()

    def test_registration_creates_inactive_customer(self):
        data = {
            'full_name': 'Pending Cust',
            'email': 'pending_cust@example.com',
            'password': 'PendingPass123!',
            'confirm_password': 'PendingPass123!'
        }
        res = self.client.post('/api/v1/account/register/', data)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='pending_cust@example.com')
        self.assertFalse(user.is_active)
        self.assertEqual(user.role, 'Customer')

    def test_unverified_customer_cannot_login(self):
        res = self.client.post('/api/v1/account/login/', {
            'email': self.unverified_user.email,
            'password': self.password
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        error_val = str(res.data)
        self.assertIn('Verify your email before logging in', error_val)

    def test_unverified_customer_wrong_password_does_not_leak_verification_state(self):
        res = self.client.post('/api/v1/account/login/', {
            'email': self.unverified_user.email,
            'password': 'WrongPassword999!'
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        error_val = str(res.data)
        self.assertIn('Check email and password', error_val)
        self.assertNotIn('Verify your email', error_val)

    def test_verified_customer_logs_in_normally(self):
        res = self.client.post('/api/v1/account/login/', {
            'email': self.verified_user.email,
            'password': self.password
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)

    def test_otp_verification_activates_account_then_login_succeeds(self):
        _, plain_otp = create_otp(self.unverified_user)

        # Before OTP verification, login fails
        pre_login = self.client.post('/api/v1/account/login/', {
            'email': self.unverified_user.email,
            'password': self.password
        })
        self.assertEqual(pre_login.status_code, status.HTTP_400_BAD_REQUEST)

        # Verify OTP
        verify_res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.unverified_user.email,
            'otp': plain_otp
        })
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)

        self.unverified_user.refresh_from_db()
        self.assertTrue(self.unverified_user.is_active)

        # Now login succeeds
        post_login = self.client.post('/api/v1/account/login/', {
            'email': self.unverified_user.email,
            'password': self.password
        })
        self.assertEqual(post_login.status_code, status.HTTP_200_OK)
        self.assertIn('access', post_login.data)
        self.assertIn('refresh', post_login.data)

    def test_invalid_otp_does_not_activate_account(self):
        create_otp(self.unverified_user)

        res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.unverified_user.email,
            'otp': '000000'
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        self.unverified_user.refresh_from_db()
        self.assertFalse(self.unverified_user.is_active)

        # Login must still fail
        login_res = self.client.post('/api/v1/account/login/', {
            'email': self.unverified_user.email,
            'password': self.password
        })
        self.assertEqual(login_res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_expired_otp_does_not_activate_account(self):
        otp_rec, plain_otp = create_otp(self.unverified_user)
        EmailOtp.objects.filter(pk=otp_rec.pk).update(
            expir_at=timezone.now() - timedelta(minutes=2)
        )

        res = self.client.post('/api/v1/account/otp_veryfication/', {
            'email': self.unverified_user.email,
            'otp': plain_otp
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        self.unverified_user.refresh_from_db()
        self.assertFalse(self.unverified_user.is_active)


class CustomerTokenRefreshTestCase(APITestCase):
    """
    Test F2: Customer JWT token refresh endpoint.
    Verifies rotation, blacklisting, invalid/expired tokens, and admin token isolation.
    """

    def setUp(self):
        cache.clear()
        self.customer = User.objects.create_user(
            email='refreshtest@example.com',
            password='RefreshPassword123!',
            full_name='Refresh Customer',
            is_active=True
        )

    def tearDown(self):
        cache.clear()

    def test_valid_customer_token_refresh_and_rotation(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        initial_refresh = RefreshToken.for_user(self.customer)
        res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': str(initial_refresh)
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertNotEqual(res.data['refresh'], str(initial_refresh))

        # Initial refresh token must now be blacklisted
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=initial_refresh['jti']).exists())

        # Second attempt with rotated (blacklisted) token fails
        fail_res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': str(initial_refresh)
        })
        self.assertEqual(fail_res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_customer_token_refresh_fallback_url(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        initial_refresh = RefreshToken.for_user(self.customer)

        res = self.client.post('/api/v1/account/refresh/', {
            'refresh': str(initial_refresh)
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)

    def test_invalid_refresh_token_fails(self):
        res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': 'completely.invalid.token'
        })
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data.get('code'), 'token_not_valid')

    def test_expired_refresh_token_fails(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        refresh = RefreshToken.for_user(self.customer)
        # Manually alter exp claim to past
        refresh.set_exp(lifetime=-timedelta(minutes=10))

        res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': str(refresh)
        })
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data.get('code'), 'token_not_valid')

    def test_missing_refresh_payload_fails(self):
        res = self.client.post('/api/v1/account/token/refresh/', {})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('refresh', res.data)

    def test_customer_refresh_rejects_admin_scoped_token(self):
        from adminpanel.tokens import AdminRefreshToken

        admin_user = User.objects.create_superuser(
            email='adminuser@example.com',
            password='AdminPass123!',
            full_name='Admin User'
        )
        admin_refresh = AdminRefreshToken.for_user(admin_user)

        res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': str(admin_refresh)
        })
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        detail = str(res.data)
        self.assertIn('Admin tokens cannot be refreshed', detail)

    def test_customer_refresh_rejects_inactive_account(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        inactive_user = User.objects.create_user(
            email='inactiveuser@example.com',
            password='InactivePass123!',
            full_name='Inactive User',
            is_active=False
        )
        refresh = RefreshToken.for_user(inactive_user)

        res = self.client.post('/api/v1/account/token/refresh/', {
            'refresh': str(refresh)
        })
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
