from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase
from adminpanel.tokens import AdminRefreshToken, ADMIN_SCOPE

User = get_user_model()


class AdminPanelAuthTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email='admin@greenvillage.com',
            password='Password123!',
            role='admin',
            is_staff=True,
            is_active=True,
        )
        self.customer = User.objects.create_user(
            email='customer@example.com',
            password='Password123!',
            role='customer',
            is_staff=False,
            is_active=True,
        )

    def test_admin_login_success_and_scope(self):
        url = '/api/v1/admin-auth/login/'
        payload = {
            'email': 'admin@greenvillage.com',
            'password': 'Password123!'
        }
        res = self.client.post(url, payload)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)

        # Validate scope claim in refresh token
        refresh_token = AdminRefreshToken(res.data['refresh'])
        self.assertEqual(refresh_token.get('scope'), ADMIN_SCOPE)
        self.assertEqual(refresh_token.access_token.get('scope'), ADMIN_SCOPE)

    def test_customer_cannot_login_to_admin_panel(self):
        url = '/api/v1/admin-auth/login/'
        payload = {
            'email': 'customer@example.com',
            'password': 'Password123!'
        }
        res = self.client.post(url, payload)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_admin_refresh_view_via_request_body(self):
        refresh = AdminRefreshToken.for_user(self.admin)
        url = '/api/v1/admin-auth/refresh/'
        headers = {'HTTP_X_ADMIN_PANEL': '1'}
        res = self.client.post(url, {'refresh': str(refresh)}, **headers)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
