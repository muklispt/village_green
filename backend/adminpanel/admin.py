from django.contrib import admin
from .models import AdminLoginAttempt

@admin.register(AdminLoginAttempt)
class AdminLoginAttemptAdmin(admin.ModelAdmin):
    list_display = ('email', 'ip_address', 'success', 'reason', 'created_at')
    list_filter = ('success', 'created_at')
    search_fields = ('email', 'ip_address')
    readonly_fields = ('email', 'ip_address', 'success', 'reason', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
