"""Razorpay payment gateway integration module.

Official Razorpay API & Signature Contract:
- Currency unit: paise (1 INR = 100 paise)
- Order creation: POST /v1/orders with amount in paise
- Checkout signature verification: HMAC-SHA256(order_id + "|" + payment_id, secret)
- Webhook signature verification: HMAC-SHA256(raw_body_bytes, webhook_secret)
- Constant-time comparison using hmac.compare_digest to prevent timing attacks.
"""

import hashlib
import hmac
import logging
from decimal import Decimal

from django.conf import settings
import razorpay
import requests
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)


class TimeoutSession(requests.Session):
    """Custom requests Session enforcing explicit connect and read timeouts on Razorpay API calls."""

    def __init__(self, timeout=(5.0, 10.0), *args, **kwargs):
        self.default_timeout = getattr(settings, 'RAZORPAY_HTTP_TIMEOUT', timeout)
        super().__init__(*args, **kwargs)

    def request(self, *args, **kwargs):
        kwargs.setdefault('timeout', self.default_timeout)
        return super().request(*args, **kwargs)


class GatewayUnavailable(APIException):
    status_code = 503
    default_detail = "Online payment gateway is temporarily unavailable. Please try again or select Cash on Delivery."
    default_code = "gateway_unavailable"


def is_configured() -> bool:
    """Return True if Razorpay key and secret are configured."""
    return bool(
        getattr(settings, "RAZORPAY_KEY_ID", "").strip()
        and getattr(settings, "RAZORPAY_KEY_SECRET", "").strip()
    )


def get_client():
    """Return an authenticated Razorpay client instance with explicit connection and read timeouts."""
    if not is_configured():
        raise GatewayUnavailable("Razorpay gateway is not configured on this environment.")
    return razorpay.Client(
        session=TimeoutSession(),
        auth=(settings.RAZORPAY_KEY_ID.strip(), settings.RAZORPAY_KEY_SECRET.strip())
    )


def create_order(amount_paise: int, currency: str = "INR", receipt: str = "", notes: dict = None) -> dict:
    """Create a new order in Razorpay using the official SDK.

    Args:
        amount_paise: Total amount in smallest currency unit (paise). Must be integer >= 100 (min 1 INR).
        currency: 3-letter currency code, default 'INR'.
        receipt: Merchant internal order number (e.g. 'GVXXXXXXXX').
        notes: Optional key-value metadata dict for merchant reference.

    Returns:
        dict: Razorpay order object (id, amount, currency, status, etc.).
    """
    if not isinstance(amount_paise, int) or amount_paise <= 0:
        raise ValueError("amount_paise must be a positive integer.")

    client = get_client()
    data = {
        "amount": amount_paise,
        "currency": (currency or "INR").upper(),
        "receipt": str(receipt)[:40] if receipt else "",
        "notes": notes or {},
        "payment_capture": 1,  # Auto-capture payments
    }

    try:
        order = client.order.create(data=data)
        logger.info("Razorpay order created successfully for receipt=%s", receipt)
        return order
    except Exception as exc:
        logger.error("Razorpay order creation failed for receipt=%s: %s", receipt, exc)
        raise GatewayUnavailable("Unable to initiate payment with Razorpay. Please try again shortly.")


def fetch_payment(payment_id: str) -> dict:
    """Fetch authoritative payment record directly from Razorpay.

    Args:
        payment_id: Razorpay payment identifier ('pay_...').

    Returns:
        dict: Razorpay payment entity.
    """
    if not payment_id:
        raise ValueError("payment_id is required.")

    client = get_client()
    try:
        return client.payment.fetch(payment_id)
    except Exception as exc:
        logger.error("Razorpay fetch_payment failed for %s: %s", payment_id, exc)
        raise GatewayUnavailable("Unable to verify payment status with payment gateway.")


def verify_payment_signature(razorpay_order_id: str, razorpay_payment_id: str, signature: str) -> bool:
    """Verify checkout payment signature using constant-time HMAC-SHA256 comparison.

    Razorpay Signature Formula:
        HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)

    Returns:
        bool: True if signature is cryptographically valid, False otherwise.
    """
    secret = getattr(settings, "RAZORPAY_KEY_SECRET", "").strip()
    if not secret or not razorpay_order_id or not razorpay_payment_id or not signature:
        return False

    msg = f"{razorpay_order_id}|{razorpay_payment_id}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """Verify Razorpay server-to-server webhook signature against raw request body.

    Razorpay Webhook Signature Formula:
        HMAC_SHA256(raw_body_bytes, webhook_secret)

    Returns:
        bool: True if signature is cryptographically valid, False otherwise.
    """
    secret = getattr(settings, "RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not secret or not signature or not raw_body:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())

