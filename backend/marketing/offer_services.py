"""Offer write operations. Target rules are checked here, before any write.

Model clean() is not enough on its own: save() does not call full_clean(), so every
create and update goes through these functions.

Links are only replaced when the caller passes product_ids or category_ids. Leaving
them as None keeps the existing OfferProduct / OfferCategory rows unchanged.
"""
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.exceptions import ValidationError

from product.models import Product, ProductCategory

from .models import DiscountType, Offer, OfferCategory, OfferProduct
from .validators import offer_target_error

OFFER_FIELDS = (
    'name', 'description', 'discount_type', 'discount_value', 'applicable_type',
    'minimum_order_amount', 'maximum_discount', 'start_date', 'end_date', 'is_active',
)

FIXED_NOT_SUPPORTED = (
    'Fixed-amount offers are not supported yet. It is not decided whether the amount '
    'applies per unit or per line.'
)


def _parse_ids(values, field):
    """Return a set of UUIDs. Raises ValidationError for anything that is not a UUID."""
    result = set()
    for value in values or ():
        try:
            result.add(uuid.UUID(str(value)))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError({field: [f'Invalid id: {value!r}.']})
    return result


def _check_links_exist(product_ids, category_ids):
    if product_ids:
        found = Product.objects.filter(pk__in=product_ids).count()
        if found != len(product_ids):
            raise ValidationError({'product_ids': ['One or more products do not exist.']})
    if category_ids:
        found = ProductCategory.objects.filter(pk__in=category_ids).count()
        if found != len(category_ids):
            raise ValidationError({'category_ids': ['One or more categories do not exist.']})


def _validate(offer, product_ids, category_ids):
    """Field rules, scope rules and link existence. Raises ValidationError, writes nothing."""
    try:
        offer.clean()
    except DjangoValidationError as exc:
        raise ValidationError(exc.message_dict)

    message = offer_target_error(offer.applicable_type, len(product_ids), len(category_ids))
    if message:
        raise ValidationError({'applicable_type': [message]})

    _check_links_exist(product_ids, category_ids)


def _reject_fixed(discount_type):
    if discount_type == DiscountType.FIXED:
        raise ValidationError({'discount_type': [FIXED_NOT_SUPPORTED]})


def _sync_links(offer, product_ids, category_ids):
    """Make the link rows equal the given sets. Keeps rows that are still wanted."""
    if product_ids is not None:
        OfferProduct.objects.filter(offer=offer).exclude(product_id__in=product_ids).delete()
        existing = set(OfferProduct.objects.filter(offer=offer).values_list('product_id', flat=True))
        OfferProduct.objects.bulk_create(
            OfferProduct(offer=offer, product_id=pid) for pid in product_ids - existing
        )
    if category_ids is not None:
        OfferCategory.objects.filter(offer=offer).exclude(category_id__in=category_ids).delete()
        existing = set(OfferCategory.objects.filter(offer=offer).values_list('category_id', flat=True))
        OfferCategory.objects.bulk_create(
            OfferCategory(offer=offer, category_id=cid) for cid in category_ids - existing
        )


def create_offer(*, fields, product_ids=(), category_ids=(), created_by=None):
    """Create an offer with its links, all or nothing. Returns the saved Offer."""
    data = {key: value for key, value in fields.items() if key in OFFER_FIELDS}
    _reject_fixed(data.get('discount_type'))

    products = _parse_ids(product_ids, 'product_ids')
    categories = _parse_ids(category_ids, 'category_ids')
    offer = Offer(created_by=created_by, **data)
    _validate(offer, products, categories)

    with transaction.atomic():
        offer.save()
        _sync_links(offer, products, categories)
    return offer


def update_offer(offer, *, fields, product_ids=None, category_ids=None):
    """Update an offer. Unchanged fields and unlisted links are kept as they are."""
    data = {key: value for key, value in fields.items() if key in OFFER_FIELDS}

    with transaction.atomic():
        locked = Offer.objects.select_for_update().get(pk=offer.pk)

        # Switching an offer to fixed is refused. Editing or disabling an existing
        # fixed offer stays allowed, so it can be switched off.
        if 'discount_type' in data and data['discount_type'] != locked.discount_type:
            _reject_fixed(data['discount_type'])

        for key, value in data.items():
            setattr(locked, key, value)

        if product_ids is None:
            products = set(locked.offer_products.values_list('product_id', flat=True))
        else:
            products = _parse_ids(product_ids, 'product_ids')
        if category_ids is None:
            categories = set(locked.offer_categories.values_list('category_id', flat=True))
        else:
            categories = _parse_ids(category_ids, 'category_ids')

        _validate(locked, products, categories)
        locked.save()
        _sync_links(
            locked,
            products if product_ids is not None else None,
            categories if category_ids is not None else None,
        )
    return locked