from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
from django.db.models import Count, Q, Sum, Prefetch
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError

from product.models import Product, ProductCategory, ProductImage, ProductVariant

from .models import AdminLoginAttempt
from .permissions import IsAdminPanelUser, is_admin_account
from .serializers import AdminLoginSerializer
from .services import get_client_ip, lockout_seconds, record_attempt
from .tokens import ADMIN_SCOPE, AdminRefreshToken

User = get_user_model()

REFRESH_COOKIE = 'admin_refresh'
REFRESH_COOKIE_PATH = '/api/v1/admin-auth/'
CLIENT_HEADER = 'X-Admin-panel'
LOW_STOCK_THRESHOLD = 5


def set_refresh_cookie(response, token):
    response.set_cookie(
        REFRESH_COOKIE,
        str(token),
        max_age=int(settings.ADMIN_REFRESH_TOKEN_LIFETIME.total_seconds()),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=not settings.DEBUG,
        samesite='Strict',
    )


def clear_refresh_cookie(response):
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, samesite='Strict')


def user_payload(user):
    return {
        'id': str(user.id),
        'email': user.email,
        'full_name': user.full_name,
        'role': user.role,
    }


def access_payload(refresh):
    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'expires_in': int(settings.ADMIN_ACCESS_TOKEN_LIFETIME.total_seconds()),
    }

def cookie_request_error(request):
    """Extra CSRF defence for endpoints that use the refresh cookie.

    A browser cannot add a custom header on a cross-site form post, and the
    Origin header must match one of our allowed origins.
    """
    if request.headers.get(CLIENT_HEADER) !='1':
        return Response({'detail':'Invalid request.'},status=status.HTTP_403_FORBIDDEN)
    origin = request.headers.get('Origin')
    if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
        return Response({'detail':'Invalid request.'},status=status.HTTP_403_FORBIDDEN)
    return None



class AdminLoginView(APIView):
    authentication_classes = []
    permission_classes =[AllowAny]
    throttle_scope = 'admin-login'

    def post(self,request):
        serializer = AdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        password = serializer.validated_data['password']
        ip = get_client_ip(request)

        wait = lockout_seconds(email,ip)
        if wait:
            record_attempt(email,ip,False,'locked')
            response = Response(
                {'detail':'Too many failed attempts. Try again later.','retry_after':wait},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
            response['Retry-After'] = str(wait)
            return response

        user = authenticate(request=request, email=email, password=password)

        # One generic answer for every failure so attackers learn nothing.
        if user is None:
            record_attempt(email, ip, False, 'bad_credentials')
            return self.invalid()
        if not is_admin_account(user):
            record_attempt(email, ip, False, 'not_admin')
            return self.invalid()

        record_attempt(email, ip, True)
        update_last_login(None, user)

        refresh = AdminRefreshToken.for_user(user)
        response = Response({**access_payload(refresh), 'user': user_payload(user)})
        set_refresh_cookie(response, refresh)
        return response

    @staticmethod
    def invalid():
        return Response(
            {'detail': 'Invalid email or password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )


class AdminRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = 'admin-refresh'

    def post(self, request):
        error = cookie_request_error(request)
        if error:
            return error

        raw = request.COOKIES.get(REFRESH_COOKIE)
        if not raw and hasattr(request, 'data'):
            raw = request.data.get('refresh')
        if not raw:
            return self.unauthorized()

        try:
            refresh = AdminRefreshToken(raw)
            if refresh.get('scope') != ADMIN_SCOPE:
                raise TokenError('Wrong token scope.')
            user = User.objects.get(pk=refresh['user_id'])
            if not is_admin_account(user):
                raise TokenError('Not an admin account.')
        except (TokenError, User.DoesNotExist, KeyError):
            return self.unauthorized()

        new_refresh = AdminRefreshToken.for_user(user)
        try:
            refresh.blacklist()
        except TokenError:
            return self.unauthorized()

        response = Response({**access_payload(new_refresh), 'user': user_payload(user)})
        set_refresh_cookie(response, new_refresh)
        return response

    @staticmethod
    def unauthorized():
        response = Response(
            {'detail': 'Session expired. Please sign in again.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
        clear_refresh_cookie(response)
        return response


class AdminLogoutView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        error = cookie_request_error(request)
        if error:
            return error

        rew = request.COOKIES.get(REFRESH_COOKIE)
        if rew:
            try:
                AdminRefreshToken(rew).blacklist()
            except (TokenError, Exception):
                pass

        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class AdminMeView(APIView):
    permission_classes = [IsAdminPanelUser]

    def get(self, request):
        user = request.user
        permissions = ['*'] if user.is_superuser else sorted(user.get_all_permissions())
        last_logins = list(
            AdminLoginAttempt.objects.filter(email=user.email, success=True)
            .values('ip_address', 'created_at')[:2]
        )
        previous = last_logins[1] if len(last_logins) > 1 else None
        return Response({
            **user_payload(user),
            'is_superuser': user.is_superuser,
            'permissions': permissions,
            'previous_login': previous,
        })


class AdminDashboardView(APIView):
    permission_classes = [IsAdminPanelUser]

    def get(self, request):
        products = Product.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(is_active=True)),
            out_of_stock=Count('id', filter=Q(stock_quantity=0)),
            total_stock=Sum('stock_quantity'),
        )
        variants = ProductVariant.objects.aggregate(
            total=Count('id'),
            low_stock=Count(
                'id',
                filter=Q(is_active=True, stock_quantity__lte=LOW_STOCK_THRESHOLD),
            ),
            out_of_stock=Count(
                'id',
                filter=Q(is_active=True, stock_quantity=0),
            ),
        )

        recent_qs = (
            Product.objects.select_related('product_category')
            .prefetch_related(
                Prefetch(
                    'images',
                    queryset=ProductImage.objects.filter(is_primary=True),
                    to_attr='prefetched_primary_image'
                ),
                'variants',
            )
            .order_by('-created_at')[:6]
        )

        recent_products = []
        for p in recent_qs:
            primary_url = None
            if hasattr(p, 'prefetched_primary_image') and p.prefetched_primary_image:
                img_field = p.prefetched_primary_image[0].image
                if img_field and hasattr(img_field, 'url'):
                    primary_url = request.build_absolute_uri(img_field.url) if request else img_field.url
            elif p.product_img and hasattr(p.product_img, 'url'):
                primary_url = request.build_absolute_uri(p.product_img.url) if request else p.product_img.url

            recent_products.append({
                'id': str(p.id),
                'name': p.name,
                'slug': p.slug,
                'category_name': p.product_category.name if p.product_category else 'Uncategorized',
                'category_id': str(p.product_category.id) if p.product_category else None,
                'price': str(p.price),
                'stock_quantity': p.stock_quantity,
                'unit': p.unit,
                'is_active': p.is_active,
                'image': primary_url,
                'variants_count': p.variants.count(),
                'created_at': p.created_at.isoformat(),
            })

        return Response({
            'products': {
                'total': products['total'] or 0,
                'active': products['active'] or 0,
                'inactive': (products['total'] or 0) - (products['active'] or 0),
                'out_of_stock': products['out_of_stock'] or 0,
                'total_stock': products['total_stock'] or 0,
            },
            'variants': {
                'total': variants['total'] or 0,
                'low_stock': variants['low_stock'] or 0,
                'out_of_stock': variants['out_of_stock'] or 0,
            },
            'categories': ProductCategory.objects.count(),
            'images': ProductImage.objects.count(),
            'customers': User.objects.filter(is_staff=False, is_superuser=False).count(),
            'low_stock_threshold': LOW_STOCK_THRESHOLD,
            'recent_products': recent_products,
        })



