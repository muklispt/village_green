"""Automated tests for Razorpay payment integration in Green Village."""

import hashlib
import hmac
import json
import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from .factories import OrderBase, make_user, put_in_cart
from .models import Order, OrderStatus, Payment, PaymentMethod, PaymentStatus, WebhookDelivery

RAZORPAY_TEST_SETTINGS = {
    "RAZORPAY_KEY_ID": "rzp_test_mock_key_123",
    "RAZORPAY_KEY_SECRET": "mock_secret_key_456",
    "RAZORPAY_WEBHOOK_SECRET": "mock_webhook_secret_789",
    "RAZORPAY_CURRENCY": "INR",
}


def _make_checkout_signature(order_id: str, payment_id: str, secret: str = "mock_secret_key_456") -> str:
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _make_webhook_signature(raw_body: bytes, secret: str = "mock_webhook_secret_789") -> str:
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


@override_settings(**RAZORPAY_TEST_SETTINGS)
class RazorpayPaymentTests(OrderBase):
    """Test suite covering Razorpay payment initiation, signature verification, and webhooks."""

    def setUp(self):
        super().setUp()
        self.webhook_url = "/api/v1/orders/webhook/razorpay/"

    def create_online_order(self, total_items=2, user=None):
        """Helper to create an online order with stock reserved."""
        return self.place_order(method="online", user=user or self.user, quantity=total_items)

    # -------------------------------------------------------------------------
    # 1. Successful Razorpay order creation
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.create_order")
    def test_successful_razorpay_order_creation(self, mock_create):
        mock_create.return_value = {
            "id": "order_mock_123456",
            "amount": 12000,
            "currency": "INR",
            "status": "created",
        }
        order = self.create_online_order()
        response = self.client.post(f"/api/v1/orders/{order.id}/pay/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["razorpay_order_id"], "order_mock_123456")
        self.assertEqual(response.data["key_id"], "rzp_test_mock_key_123")
        self.assertEqual(response.data["amount"], 12000)
        self.assertEqual(response.data["currency"], "INR")

        order.refresh_from_db()
        self.assertEqual(order.payment.provider_order_id, "order_mock_123456")
        self.assertEqual(order.payment.provider, "razorpay")

    # -------------------------------------------------------------------------
    # 2. Unauthorized payment initiation
    # -------------------------------------------------------------------------
    def test_unauthorized_payment_initiation(self):
        order = self.create_online_order()
        self.client.force_authenticate(user=None)
        response = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # -------------------------------------------------------------------------
    # 3. User cannot pay another user's order
    # -------------------------------------------------------------------------
    def test_user_cannot_pay_another_users_order(self):
        order = self.create_online_order(user=self.user)
        self.client.force_authenticate(self.other)
        response = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # -------------------------------------------------------------------------
    # 4. Invalid checkout signature
    # -------------------------------------------------------------------------
    def test_invalid_checkout_signature_rejected(self):
        order = self.create_online_order()
        order.payment.provider_order_id = "order_rzp_valid"
        order.payment.save()

        payload = {
            "razorpay_order_id": "order_rzp_valid",
            "razorpay_payment_id": "pay_test_123",
            "razorpay_signature": "invalid_fake_signature_hex",
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("signature", response.data)

    # -------------------------------------------------------------------------
    # 5. Valid signature but uncaptured payment
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_valid_signature_but_uncaptured_payment_rejected(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_valid_001"
        rzp_pay_id = "pay_test_uncaptured_001"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        valid_sig = _make_checkout_signature(rzp_order_id, rzp_pay_id)
        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "failed",
            "amount": 12000,
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": valid_sig,
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertNotEqual(order.payment.status, PaymentStatus.PAID)

    # -------------------------------------------------------------------------
    # 6. Mismatched Razorpay order ID
    # -------------------------------------------------------------------------
    def test_mismatched_razorpay_order_id_rejected(self):
        order = self.create_online_order()
        order.payment.provider_order_id = "order_actual_123"
        order.payment.save()

        payload = {
            "razorpay_order_id": "order_attacker_456",
            "razorpay_payment_id": "pay_test_123",
            "razorpay_signature": _make_checkout_signature("order_attacker_456", "pay_test_123"),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("order_id", response.data)

    # -------------------------------------------------------------------------
    # 7. Mismatched payment ID (payment entity points to different order)
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_mismatched_payment_id_rejected(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_valid_002"
        rzp_pay_id = "pay_test_other_order"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": "order_different_order_999",
            "status": "captured",
            "amount": 12000,
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------------------
    # 8. Incorrect amount rejected
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_incorrect_amount_rejected(self, mock_fetch):
        order = self.create_online_order()  # total 120.00 -> 12000 paise
        rzp_order_id = "order_rzp_amount_test"
        rzp_pay_id = "pay_test_amount_123"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "captured",
            "amount": 5000,  # Only 50.00 paid instead of 120.00!
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("amount", response.data)

    # -------------------------------------------------------------------------
    # 9. Incorrect currency rejected
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_incorrect_currency_rejected(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_curr_test"
        rzp_pay_id = "pay_test_curr_123"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "captured",
            "amount": 12000,
            "currency": "USD",  # USD instead of INR
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("currency", response.data)

    # -------------------------------------------------------------------------
    # 10. Successful captured payment confirmation
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_successful_captured_payment(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_success_001"
        rzp_pay_id = "pay_test_success_001"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "captured",
            "amount": 12000,
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CONFIRMED)
        self.assertEqual(order.payment.status, PaymentStatus.PAID)
        self.assertEqual(order.payment.provider_payment_id, rzp_pay_id)
        self.assertIsNotNone(order.payment.paid_at)

    # -------------------------------------------------------------------------
    # 11. Duplicate webhook delivery deduplication
    # -------------------------------------------------------------------------
    def test_duplicate_webhook_delivery_is_idempotent(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_webhook_001"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_duplicate_test_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_webhook_dup_001",
                        "order_id": rzp_order_id,
                        "status": "captured",
                        "amount": 12000,
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        sig = _make_webhook_signature(webhook_body)
        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": sig,
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_duplicate_test_123",
        }

        # First post
        r1 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        self.assertTrue(WebhookDelivery.objects.filter(delivery_id="evt_duplicate_test_123").exists())

        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.PAID)
        audit_count = order.history.count()

        # Second post with same delivery ID
        r2 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        # Verify no duplicate audit entries created
        self.assertEqual(order.history.count(), audit_count)

    # -------------------------------------------------------------------------
    # 12. Invalid webhook signature rejected
    # -------------------------------------------------------------------------
    def test_invalid_webhook_signature_rejected(self):
        webhook_body = json.dumps({"event": "payment.captured"}).encode("utf-8")
        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": "invalid_tampered_signature",
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_bad_sig_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # -------------------------------------------------------------------------
    # 13. Malformed JSON webhook payload rejected
    # -------------------------------------------------------------------------
    def test_malformed_json_webhook_rejected(self):
        raw_body = b"NOT_VALID_JSON{{"
        sig = _make_webhook_signature(raw_body)
        headers = {"HTTP_X_RAZORPAY_SIGNATURE": sig}
        response = self.client.post(self.webhook_url, data=raw_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------------------
    # 14. JSON primitive payload rejected
    # -------------------------------------------------------------------------
    def test_json_primitive_webhook_rejected(self):
        raw_body = b'"just a string"'
        sig = _make_webhook_signature(raw_body)
        headers = {"HTTP_X_RAZORPAY_SIGNATURE": sig}
        response = self.client.post(self.webhook_url, data=raw_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------------------
    # 15. Duplicate verification requests (idempotency)
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_duplicate_verification_requests_idempotent(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_dup_verify"
        rzp_pay_id = "pay_test_dup_verify"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "captured",
            "amount": 12000,
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }

        r1 = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(r1.status_code, status.HTTP_200_OK)

        # Immediate repeated verification call
        r2 = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertEqual(r2.data.get("status"), "already_paid")

    # -------------------------------------------------------------------------
    # 16. Out-of-order webhook events (failed after paid does not downgrade)
    # -------------------------------------------------------------------------
    def test_out_of_order_failed_event_does_not_downgrade_paid_payment(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_out_of_order"
        order.payment.provider_order_id = rzp_order_id
        order.payment.status = PaymentStatus.PAID
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.failed",
            "id": "evt_late_failure_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_late_fail",
                        "order_id": rzp_order_id,
                        "status": "failed",
                        "error_code": "BAD_REQUEST_ERROR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_late_failure_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.PAID)

    # -------------------------------------------------------------------------
    # 17. COD order receiving a payment webhook is strictly rejected
    # -------------------------------------------------------------------------
    def test_cod_order_receiving_webhook_rejected(self):
        order = self.place_order(method="cod")
        order.payment.provider_order_id = "order_rzp_cod_test"
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_cod_spoof_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_cod_spoof",
                        "order_id": "order_rzp_cod_test",
                        "status": "captured",
                        "amount": int(round(order.total_amount * 100)),
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_cod_spoof_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        order.refresh_from_db()
        self.assertNotEqual(order.payment.status, PaymentStatus.PAID)

    # -------------------------------------------------------------------------
    # 18. Concurrent webhook delivery safety
    # -------------------------------------------------------------------------
    def test_concurrent_webhook_delivery_handled_safely(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_concurrent"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_concurrent_001",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_concurrent_001",
                        "order_id": rzp_order_id,
                        "status": "captured",
                        "amount": 12000,
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_concurrent_001",
        }

        # Simulate two identical webhook posts in sequence
        r1 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        r2 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)

        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.PAID)

    # -------------------------------------------------------------------------
    # 19. Payment initiation retry reuses existing Razorpay order
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.create_order")
    def test_payment_initiation_retry_reuses_existing_order(self, mock_create):
        mock_create.return_value = {
            "id": "order_rzp_retry_first",
            "amount": 12000,
            "currency": "INR",
            "status": "created",
        }
        order = self.create_online_order()

        # First initiation creates the order
        r1 = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        self.assertEqual(r1.data["razorpay_order_id"], "order_rzp_retry_first")
        self.assertEqual(mock_create.call_count, 1)

        # Second initiation reuses the existing Razorpay order without calling API again
        r2 = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        self.assertEqual(r2.data["razorpay_order_id"], "order_rzp_retry_first")
        self.assertEqual(mock_create.call_count, 1)  # NOT incremented

    # -------------------------------------------------------------------------
    # 20. Existing COD checkout regression tests
    # -------------------------------------------------------------------------
    def test_cod_checkout_flow_remains_fully_functional(self):
        order = self.place_order(method="cod")
        self.assertEqual(order.payment_method, PaymentMethod.COD)
        self.assertEqual(order.status, OrderStatus.PENDING)
        self.assertEqual(order.payment.status, PaymentStatus.PENDING)
        self.assertEqual(order.payment.provider, "")

        # Pay endpoint must reject COD orders
        pay_res = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(pay_res.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------------------
    # 21. Authorized (uncaptured) payment is strictly rejected
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.fetch_payment")
    def test_authorized_payment_rejected(self, mock_fetch):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_auth_test"
        rzp_pay_id = "pay_test_auth_only"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        mock_fetch.return_value = {
            "id": rzp_pay_id,
            "order_id": rzp_order_id,
            "status": "authorized",  # Authorized but NOT captured!
            "amount": 12000,
            "currency": "INR",
        }

        payload = {
            "razorpay_order_id": rzp_order_id,
            "razorpay_payment_id": rzp_pay_id,
            "razorpay_signature": _make_checkout_signature(rzp_order_id, rzp_pay_id),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not captured", str(response.data))

        order.refresh_from_db()
        self.assertNotEqual(order.payment.status, PaymentStatus.PAID)
        self.assertNotEqual(order.status, OrderStatus.CONFIRMED)

    # -------------------------------------------------------------------------
    # 22. Verification rejected without an initiated Razorpay session
    # -------------------------------------------------------------------------
    def test_verification_rejected_without_initiated_razorpay_session(self):
        order = self.create_online_order()
        # Order payment has provider_order_id == '' (session not initiated)
        self.assertEqual(order.payment.provider_order_id, "")

        payload = {
            "razorpay_order_id": "order_uninitiated_123",
            "razorpay_payment_id": "pay_test_uninitiated",
            "razorpay_signature": _make_checkout_signature("order_uninitiated_123", "pay_test_uninitiated"),
        }
        response = self.client.post(f"/api/v1/orders/{order.id}/verify/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not been initiated", str(response.data))

    # -------------------------------------------------------------------------
    # 23. Refund-pending state protected from payment.failed
    # -------------------------------------------------------------------------
    def test_refund_pending_state_protected_from_payment_failed(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_ref_pending"
        order.payment.provider_order_id = rzp_order_id
        order.payment.status = PaymentStatus.REFUND_PENDING
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.failed",
            "id": "evt_failed_ref_pending_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_failed_after_ref",
                        "order_id": rzp_order_id,
                        "status": "failed",
                        "error_code": "GATEWAY_ERROR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_failed_ref_pending_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.REFUND_PENDING)

    # -------------------------------------------------------------------------
    # 24. Refunded state protected from payment.failed
    # -------------------------------------------------------------------------
    def test_refunded_state_protected_from_payment_failed(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_refunded"
        order.payment.provider_order_id = rzp_order_id
        order.payment.status = PaymentStatus.REFUNDED
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.failed",
            "id": "evt_failed_refunded_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_failed_after_refund",
                        "order_id": rzp_order_id,
                        "status": "failed",
                        "error_code": "GATEWAY_ERROR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_failed_refunded_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.REFUNDED)

    # -------------------------------------------------------------------------
    # 25. Missing webhook amount rejected
    # -------------------------------------------------------------------------
    def test_missing_webhook_amount_rejected(self):
        order = self.create_online_order()
        rzp_order_id = "order_rzp_no_amount"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_no_amount_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_no_amount",
                        "order_id": rzp_order_id,
                        "status": "captured",
                        # amount key omitted!
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_no_amount_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("amount", str(response.data).lower())

    # -------------------------------------------------------------------------
    # 26. One-paisa amount mismatch rejected (no tolerance)
    # -------------------------------------------------------------------------
    def test_one_paisa_amount_mismatch_rejected(self):
        order = self.create_online_order()  # 12000 paise
        rzp_order_id = "order_rzp_one_paisa"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        # Send 12001 paise (1 paisa difference)
        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_one_paisa_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_one_paisa_mismatch",
                        "order_id": rzp_order_id,
                        "status": "captured",
                        "amount": 12001,
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_one_paisa_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("amount mismatch", str(response.data).lower())

    # -------------------------------------------------------------------------
    # 27. Null payload container returns controlled 400 response
    # -------------------------------------------------------------------------
    def test_null_payload_returns_controlled_response(self):
        webhook_body = json.dumps({
            "event": "payment.captured",
            "payload": None,
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_null_payload_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------------------
    # 28. Receipt fallback rejects mismatched Razorpay order ID
    # -------------------------------------------------------------------------
    def test_receipt_fallback_rejects_mismatched_razorpay_order_id(self):
        order = self.create_online_order()
        order.payment.provider_order_id = "order_rzp_original_valid"
        order.payment.save()

        # Webhook targets order_rzp_attacker, but notes match receipt/order_number
        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_fallback_mismatch_123",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_fallback_spoof",
                        "order_id": "order_rzp_attacker_fake",
                        "status": "captured",
                        "amount": 12000,
                        "currency": "INR",
                        "notes": {
                            "order_number": order.order_number,
                        },
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_fallback_mismatch_123",
        }
        response = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("mismatch", str(response.data).lower())

    # -------------------------------------------------------------------------
    # 29. Duplicate late-payment webhook creates no duplicate refund history
    # -------------------------------------------------------------------------
    def test_duplicate_late_payment_webhook_creates_no_duplicate_refund_history(self):
        order = self.create_online_order()
        order.status = OrderStatus.CANCELLED
        order.save()
        rzp_order_id = "order_rzp_late_dup"
        order.payment.provider_order_id = rzp_order_id
        order.payment.save()

        webhook_body = json.dumps({
            "event": "payment.captured",
            "id": "evt_late_dup_001",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_late_dup_001",
                        "order_id": rzp_order_id,
                        "status": "captured",
                        "amount": 12000,
                        "currency": "INR",
                    }
                }
            }
        }).encode("utf-8")

        headers = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_late_dup_001",
        }
        # First webhook flags for refund
        r1 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers)
        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.payment.status, PaymentStatus.REFUND_PENDING)
        initial_history_count = order.history.count()

        # Second webhook with a different event ID (e.g. order.paid arriving after payment.captured)
        headers2 = {
            "HTTP_X_RAZORPAY_SIGNATURE": _make_webhook_signature(webhook_body),
            "HTTP_X_RAZORPAY_EVENT_ID": "evt_late_dup_002",
        }
        r2 = self.client.post(self.webhook_url, data=webhook_body, content_type="application/json", **headers2)
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        # Verify no duplicate history record was appended
        self.assertEqual(order.history.count(), initial_history_count)

    # -------------------------------------------------------------------------
    # 30. External API failure does not leave database rows locked
    # -------------------------------------------------------------------------
    @patch("orders.razorpay_client.create_order")
    def test_external_api_failure_does_not_hold_database_locks(self, mock_create):
        from orders.razorpay_client import GatewayUnavailable
        mock_create.side_effect = GatewayUnavailable("Gateway timeout")
        order = self.create_online_order()

        response = self.client.post(f"/api/v1/orders/{order.id}/pay/")
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

        # Confirm the order remains unlocked and accessible
        order.refresh_from_db()
        self.assertEqual(order.payment.provider_order_id, "")
        self.assertEqual(order.payment.status, PaymentStatus.PENDING)

