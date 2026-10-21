from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed


class SafeStorefrontJWTAuthentication(JWTAuthentication):
    """
    JWT Authentication tailored for public-facing storefront endpoints.

    On safe read-only methods (GET, HEAD, OPTIONS), if a client presents an
    expired, stale, or malformed JWT token (e.g., from an old session in localStorage),
    this authenticator gracefully falls back to AnonymousUser rather than failing the
    entire storefront catalog request with HTTP 401.

    For mutating HTTP methods (POST, PUT, PATCH, DELETE), strict JWT authentication
    remains enforced, raising 401 Unauthorized immediately if the token is invalid.
    """

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except (InvalidToken, AuthenticationFailed):
            if request.method in SAFE_METHODS:
                return None
            raise
