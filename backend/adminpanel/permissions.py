from rest_framework.permissions import BasePermission

from .tokens import ADMIN_SCOPE

def has_admin_scope(request):
    token = request.auth
    if token is None or not hasattr(token,'get'):
        return False
    return token.get('scope') == ADMIN_SCOPE

def is_admin_account(user):
    return bool(
        user
        and user.is_authenticated
        and user.is_active
        and (user.is_staff or user.is_superuser)
        and (user.role == 'admin' or user.is_superuser)
    )


class IsAdminPanelUser(BasePermission):
    '''Admin account AND a token issued by the admin login.'''

    message = 'Admin access required.'

    def has_permission(self, request, view):
        return is_admin_account(request.user) and has_admin_scope(request)
