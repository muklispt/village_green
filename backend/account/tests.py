from rest_framework.test import APITestCase
from rest_framework import status
from django.utils import timezone
from datetime import timedelta
from .models import User, EmailOtp

class AccountStatusCodeTestCase(APITestCase):

    def setUp(self):
        self.user_password = 'TestPassword123'
        self.user = User.objects.create_user(
            email='testuser@example.com',
            password=self.user_password,
            full_name='Test User',
            is_active=True
        )

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
            password='TestPassword123',
            full_name='Unverified User',
            is_active=False
        )
        otp = '123456'
        EmailOtp.objects.create(
            user=unverified_user,
            otp=otp,
            expir_at=timezone.now() + timedelta(minutes=10),
            is_used=False
        )
        data = {
            'email': 'unverified@example.com',
            'otp': otp
        }
        response = self.client.post('/api/v1/account/otp_veryfication/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_forgot_password_returns_200(self):
        data = {
            'email': 'testuser@example.com'
        }
        response = self.client.post('/api/v1/account/forget-password/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
