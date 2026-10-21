from django.db import models

# Create your models here.

class AdminLoginAttempt(models.Model):

    email = models.CharField(max_length=254,db_index=False)
    ip_address = models.GenericIPAddressField(null=True,blank=True)
    success = models.BooleanField(default=False)
    reason = models.CharField(max_length=40,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'admin_login_attempt'
        verbose_name = 'Admin Login Attempt'
        verbose_name_plural = 'Admin Login Attempts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['email', 'created_at']),
            models.Index(fields=['ip_address', 'created_at']),
        ]

    def __str__(self):
        state = 'ok' if self.success else 'failed'
        created_str = f'{self.created_at:%Y-%m-%d %H:%M}' if self.created_at else 'unsaved'
        return f'{self.email} {state} {created_str}'