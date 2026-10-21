from django.conf import settings
from rest_framework_simplejwt.tokens import AccessToken,RefreshToken

ADMIN_SCOPE = 'admin'

class AdminAccessToken(AccessToken):
    lifetime = settings.ADMIN_ACCESS_TOKEN_LIFETIME


class AdminRefreshToken(RefreshToken):
    """Refresh token that is only minted by the admin login.

    It carries scope=admin. The access token made from it copies that claim,
    so admin APIs can tell an admin-panel session from any other login.
    """

    lifetime = settings.ADMIN_REFRESH_TOKEN_LIFETIME
    access_token_class = AdminAccessToken

    @classmethod
    def for_user(cls,user):
        token = super().for_user(user)
        token['scope'] = ADMIN_SCOPE
        return token
    
    
