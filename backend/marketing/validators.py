"""Normalization and validation helpers for offers and coupons.

Kept free of model imports so models, serializers and services can share them.
"""
import re

from django.core.exceptions import ValidationError

COUPON_CODE_PATTERN = re.compile(r'^[A-Z0-9][A-Z0-9_-]{2,29}$')
COUPON_CODE_REGEX = r'^[A-Z0-9][A-Z0-9_-]{2,29}$'  # same rule, for the database CHECK


def normalize_coupon_code(raw):
    """Trim and upper-case a coupon code. Does not validate the characters."""
    return str(raw or '').strip().upper()


def validate_coupon_code(code):
    """Raise ValidationError unless the normalized code is 3-30 characters of
    A-Z, 0-9, '-' or '_', starting with a letter or digit."""
    if not COUPON_CODE_PATTERN.match(code or ''):
        raise ValidationError(
            'Coupon code must be 3-30 characters: letters, digits, "-" or "_", '
            'starting with a letter or digit.'
        )


def validate_discount_rules(discount_type, discount_value, maximum_discount, allow_maximum_for_fixed=False):
    """Shared rules for offers and coupons. Returns a dict of field errors.

    Coupons pass allow_maximum_for_fixed=False (maximum applies only to percentages).
    Offers pass True: a fixed offer's maximum is an aggregate cap over the order.
    """
    from .models import DiscountType

    errors = {}
    if discount_value is None or discount_value <= 0:
        errors['discount_value'] = 'Discount value must be greater than zero.'
    elif discount_type == DiscountType.PERCENTAGE and discount_value > 100:
        errors['discount_value'] = 'A percentage discount cannot exceed 100.'

    if maximum_discount is not None:
        if discount_type != DiscountType.PERCENTAGE and not allow_maximum_for_fixed:
            errors['maximum_discount'] = 'A maximum discount applies only to percentage discounts.'
        elif maximum_discount <= 0:
            errors['maximum_discount'] = 'Maximum discount must be greater than zero.'
    return errors


def validate_date_range(start_date, end_date):
    """Return a field error dict if the window is empty or inverted."""
    if start_date and end_date and end_date <= start_date:
        return {'end_date': 'End date must be after the start date.'}
    return {}


def offer_target_error(applicable_type, product_count, category_count):
    """Return why a scope and its links do not fit together, or None when they do.

    Single source of truth for offer target rules. Used by the models, the offer
    services and the discount engine.
    """
    from .models import ApplicableType

    if applicable_type == ApplicableType.ALL_PRODUCTS:
        if product_count or category_count:
            return 'A store-wide offer cannot be linked to products or categories.'
    elif applicable_type == ApplicableType.SPECIFIC_PRODUCTS:
        if product_count == 0 or category_count:
            return 'A product offer needs at least one product and no categories.'
    elif applicable_type == ApplicableType.CATEGORIES:
        if category_count == 0 or product_count:
            return 'A category offer needs at least one category and no products.'
    else:
        return 'Unknown offer scope.'
    return None