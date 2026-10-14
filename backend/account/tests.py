from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import User


class RegisterTest(APITestCase):

    def setUp(self):
        self.url = reverse('register')

    # ==========================================
    # 1. Successful Registration
    # ==========================================

    def test_register_success(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'muklis@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED
        )

        self.assertTrue(
            User.objects.filter(
                email='muklis@gmail.com'
            ).exists()
        )

    # ==========================================
    # 2. Full Name Validation
    # ==========================================

    def test_full_name_with_numbers(self):
        data = {
            'full_name': 'Muklis123',
            'email': 'muklis1@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'full_name',
            response.data
        )

    def test_full_name_with_special_character(self):
        data = {
            'full_name': 'Muklis@PT',
            'email': 'muklis2@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'full_name',
            response.data
        )

    def test_full_name_with_only_spaces(self):
        data = {
            'full_name': '   ',
            'email': 'muklis3@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'full_name',
            response.data
        )

    # ==========================================
    # 3. Email Validation
    # ==========================================

    def test_email_starting_with_number(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': '123muklis@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'email',
            response.data
        )

    def test_duplicate_email(self):
        User.objects.create_user(
            email='muklis@gmail.com',
            password='Hello@123',
            full_name='Old User'
        )

        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'muklis@gmail.com',
            'password': 'Hello@456',
            'confirm_password': 'Hello@456'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'email',
            response.data
        )

    def test_email_is_converted_to_lowercase(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'MUKLIS@GMAIL.COM',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED
        )

        self.assertTrue(
            User.objects.filter(
                email='muklis@gmail.com'
            ).exists()
        )

    # ==========================================
    # 4. Password Validation
    # ==========================================

    def test_password_mismatch(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'mismatch@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@456'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'confirm_password',
            response.data
        )

    def test_password_too_short(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'short@gmail.com',
            'password': 'Hi12',
            'confirm_password': 'Hi12'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'password',
            response.data
        )

    def test_common_password(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'common@gmail.com',
            'password': 'password',
            'confirm_password': 'password'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'password',
            response.data
        )

    # ==========================================
    # 5. Required Fields
    # ==========================================

    def test_missing_full_name(self):
        data = {
            'email': 'missingname@gmail.com',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'full_name',
            response.data
        )

    def test_missing_email(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'password': 'Hello@123',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'email',
            response.data
        )

    def test_missing_password(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'missingpassword@gmail.com',
            'confirm_password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'password',
            response.data
        )

    def test_missing_confirm_password(self):
        data = {
            'full_name': 'Muhammad Muklis',
            'email': 'missingconfirm@gmail.com',
            'password': 'Hello@123'
        }

        response = self.client.post(
            self.url,
            data,
            format='json'
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST
        )

        self.assertIn(
            'confirm_password',
            response.data
        )
