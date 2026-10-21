from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import AdminLoginAttempt


def get_client_ip(request):
    return request.META.get('REMOTE_ADDR') or None


def record_attempt(email,ip,success,reason=''):
    AdminLoginAttempt.objects.create(
        email = email[:254],ip_address=ip,success=success,reason=reason
    )

def lockout_seconds(email,ip):
    """Seconds left on a lockout, or 0 when the login may proceed.
    Locked when this email has too many failures since its last success inside
    the window, or this IP has too many failures from any email.
    """
    now = timezone.now()
    window = settings.ADMIN_LOCKOUT_WINDOW
    window_start = now - window
    retry_after =0

    email_attempts = AdminLoginAttempt.objects.filter(email=email,created_at__gte=window_start)
    last_success = email_attempts.filter(success=True).order_by('-created_at').first()
    failures = email_attempts.filter(success=False)
    if last_success:
        failures = failures.filter(created_at__gt=last_success.created_at)
    failures_times = list(failures.order_by('created_at').values_list('created_at',flat=True))
    if len(failures_times)>=settings.ADMIN_MAX_FAILURES_PER_EMAIL:
        oldest_counted = failures_times[-settings.ADMIN_MAX_FAILURES_PER_EMAIL]
        retry_after = max(retry_after,int((oldest_counted+window-now).total_seconds())+1)
    if ip:
        ip_failures = list(
            AdminLoginAttempt.objects.filter(
                ip_address=ip, success=False, created_at__gte=window_start
            ).order_by('created_at').values_list('created_at', flat=True)
        )
        if len(ip_failures)>= settings.ADMIN_MAX_FAILURES_PER_IP:
            oldest_counted = ip_failures[-settings.ADMIN_MAX_FAILURES_PER_IP]
            retry_after = max(retry_after,int((oldest_counted+window-now).total_seconds())+1)
    return max(retry_after,0)

