"""Offers (automatic, admin-defined discounts) and coupons (customer-entered codes).

Money rules
- Offers discount the selling price (`product.price` / `variant.price`), never MRP.
- Shipping and tax are never discounted.
- Every amount is a Decimal with two places. Never use float.

Database constraints back up the validation in `clean()`, so invalid rows are
rejected even when code bypasses the forms and serializers.
"""
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from .validators import (COUPON_CODE_REGEX, normalize_coupon_code, offer_target_error,
                         validate_coupon_code, validate_date_range, validate_discount_rules)


class DiscountType(models.TextChoices):
    PERCENTAGE = 'percentage', 'Percentage'
    FIXED = 'fixed', 'Fixed amount'


class ApplicableType(models.TextChoices):
    ALL_PRODUCTS = 'all_products', 'Store-wide'
    SPECIFIC_PRODUCTS = 'specific_products', 'Specific products'
    CATEGORIES = 'categories', 'Categories'


class CouponUsageStatus(models.TextChoices):
    RESERVED = 'reserved', 'Reserved'      # counts against limits
    RELEASED = 'released', 'Released'      # order cancelled or expired; kept for audit


class Offer(models.Model):
    """A promotional discount on selling prices. Applies automatically, no code."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default='')
    discount_type = models.CharField(max_length=20, choices=DiscountType.choices)
    discount_value = models.DecimalField(max_digits=12, decimal_places=2)
    applicable_type = models.CharField(max_length=20, choices=ApplicableType.choices)
    products = models.ManyToManyField(
        'product.Product', through='OfferProduct', related_name='offers', blank=True,
    )
    categories = models.ManyToManyField(
        'product.ProductCategory', through='OfferCategory', related_name='offers', blank=True,
    )
    # Cart subtotal (before shipping/tax) the customer must reach for the offer to apply.
    minimum_order_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Cap for percentage offers. Null means no cap.
    maximum_discount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_offers',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'marketing_offer'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', 'end_date']),
            models.Index(fields=['applicable_type']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(discount_value__gt=0), name='offer_discount_value_positive',
            ),
            models.CheckConstraint(
                condition=Q(discount_type=DiscountType.FIXED) | Q(discount_value__lte=100),
                name='offer_percentage_at_most_100',
            ),
            models.CheckConstraint(
                condition=Q(end_date__gt=F('start_date')), name='offer_end_after_start',
            ),
            models.CheckConstraint(
                condition=Q(minimum_order_amount__gte=0), name='offer_minimum_not_negative',
            ),
            models.CheckConstraint(
                condition=Q(maximum_discount__isnull=True) | Q(maximum_discount__gt=0),
                name='offer_maximum_discount_positive',
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        errors = validate_discount_rules(
            self.discount_type, self.discount_value, self.maximum_discount,
            allow_maximum_for_fixed=True,
        )
        errors.update(validate_date_range(self.start_date, self.end_date))
        if self.minimum_order_amount is not None and self.minimum_order_amount < 0:
            errors['minimum_order_amount'] = 'Minimum order amount cannot be negative.'
        if errors:
            raise ValidationError(errors)

    def check_targets(self):
        """Confirm the product/category links match `applicable_type`.

        Needs a saved offer, because the links are separate rows. Raises ValidationError.
        """
        # `id` has a default, so pk is set before the first save. Check _state instead.
        if self._state.adding:
            raise ValidationError({'applicable_type': 'Save the offer before linking products or categories.'})
        message = offer_target_error(
            self.applicable_type,
            self.offer_products.count(),
            self.offer_categories.count(),
        )
        if message:
            raise ValidationError({'applicable_type': message})

    def is_live(self, now=None):
        """True when the offer is active and `now` is inside its window."""
        now = now or timezone.now()
        return self.is_active and self.start_date <= now <= self.end_date


class OfferProduct(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name='offer_products')
    product = models.ForeignKey(
        'product.Product', on_delete=models.CASCADE, related_name='offer_product_links',
    )

    class Meta:
        db_table = 'marketing_offer_product'
        constraints = [
            models.UniqueConstraint(fields=['offer', 'product'], name='unique_offer_product'),
        ]

    def __str__(self):
        return f'{self.offer} -> {self.product}'


class OfferCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name='offer_categories')
    category = models.ForeignKey(
        'product.ProductCategory', on_delete=models.CASCADE, related_name='offer_category_links',
    )

    class Meta:
        db_table = 'marketing_offer_category'
        constraints = [
            models.UniqueConstraint(fields=['offer', 'category'], name='unique_offer_category'),
        ]

    def __str__(self):
        return f'{self.offer} -> {self.category}'


class Coupon(models.Model):
    """A customer-entered discount code. Codes are stored upper-case and unique."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=30, unique=True)
    description = models.TextField(blank=True, default='')
    discount_type = models.CharField(max_length=20, choices=DiscountType.choices)
    discount_value = models.DecimalField(max_digits=12, decimal_places=2)
    minimum_order_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    maximum_discount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Null means unlimited. Counts only RESERVED usages.
    usage_limit = models.PositiveIntegerField(null=True, blank=True)
    usage_limit_per_customer = models.PositiveIntegerField(null=True, blank=True)
    # Maintained only by reserve_coupon_usage / release_coupon_usage, under a row lock.
    used_count = models.PositiveIntegerField(default=0, editable=False)
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    first_order_only = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_coupons',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'marketing_coupon'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', 'end_date']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(code__regex=COUPON_CODE_REGEX), name='coupon_code_format',
            ),
            models.CheckConstraint(
                condition=Q(discount_value__gt=0), name='coupon_discount_value_positive',
            ),
            models.CheckConstraint(
                condition=Q(discount_type=DiscountType.FIXED) | Q(discount_value__lte=100),
                name='coupon_percentage_at_most_100',
            ),
            models.CheckConstraint(
                condition=Q(end_date__gt=F('start_date')), name='coupon_end_after_start',
            ),
            models.CheckConstraint(
                condition=Q(minimum_order_amount__gte=0), name='coupon_minimum_not_negative',
            ),
            models.CheckConstraint(
                condition=Q(maximum_discount__isnull=True) | Q(maximum_discount__gt=0),
                name='coupon_maximum_discount_positive',
            ),
            models.CheckConstraint(
                condition=Q(maximum_discount__isnull=True)
                | Q(discount_type=DiscountType.PERCENTAGE),
                name='coupon_maximum_only_for_percentage',
            ),
            models.CheckConstraint(
                condition=Q(usage_limit__isnull=True) | Q(usage_limit__gt=0),
                name='coupon_usage_limit_positive',
            ),
            models.CheckConstraint(
                condition=Q(usage_limit_per_customer__isnull=True) | Q(usage_limit_per_customer__gt=0),
                name='coupon_per_customer_limit_positive',
            ),
            models.CheckConstraint(
                condition=Q(usage_limit__isnull=True) | Q(used_count__lte=F('usage_limit')),
                name='coupon_used_within_limit',
            ),
        ]

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        # Normalize on every save so "welcome10" and "WELCOME10" can never both exist.
        self.code = normalize_coupon_code(self.code)
        super().save(*args, **kwargs)

    def clean(self):
        errors = {}
        self.code = normalize_coupon_code(self.code)
        try:
            validate_coupon_code(self.code)
        except ValidationError as exc:
            errors['code'] = exc.messages
        errors.update(validate_discount_rules(self.discount_type, self.discount_value, self.maximum_discount))
        errors.update(validate_date_range(self.start_date, self.end_date))
        if self.minimum_order_amount is not None and self.minimum_order_amount < 0:
            errors['minimum_order_amount'] = 'Minimum order amount cannot be negative.'
        for field in ('usage_limit', 'usage_limit_per_customer'):
            value = getattr(self, field)
            if value is not None and value < 1:
                errors[field] = 'Must be at least 1, or left empty for unlimited.'
        if self.usage_limit is not None and self.used_count > self.usage_limit:
            errors['usage_limit'] = 'Usage limit cannot be below the number of uses so far.'
        if errors:
            raise ValidationError(errors)

    def is_within_window(self, now=None):
        now = now or timezone.now()
        return self.is_active and self.start_date <= now <= self.end_date


class CouponUsage(models.Model):
    """One coupon reservation per order.

    A reservation is created when the order is created, and released exactly once
    when the order is cancelled or expires unpaid. Rows are never deleted, so the
    audit trail is kept.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name='usages')
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='coupon_usages',
    )
    # One usage per order. Razorpay retries reuse the order, so they never add a second row.
    order = models.OneToOneField('orders.Order', on_delete=models.PROTECT, related_name='coupon_usage')
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=20, choices=CouponUsageStatus.choices, default=CouponUsageStatus.RESERVED,
    )
    release_reason = models.CharField(max_length=30, blank=True, default='')
    released_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'marketing_coupon_usage'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['coupon', 'status']),
            models.Index(fields=['coupon', 'customer', 'status']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(discount_amount__gte=0), name='coupon_usage_discount_not_negative',
            ),
            models.CheckConstraint(
                condition=(
                    Q(status=CouponUsageStatus.RESERVED, released_at__isnull=True, release_reason='')
                    | Q(status=CouponUsageStatus.RELEASED, released_at__isnull=False)
                ),
                name='coupon_usage_release_consistent',
            ),
        ]

    def __str__(self):
        return f'{self.coupon.code} on {self.order_id} ({self.status})'