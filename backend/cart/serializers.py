from rest_framework import serializers
from decimal import Decimal

from product.models import Product
from .models import Cart,CartItem

from . import services

class AddToCartSerializer(serializers.Serializer):
    """Only product, variant and quantity are accepted. Anything else sent by the
    client (user, price, subtotal) is ignored."""

    product = serializers.UUIDField()
    variant = serializers.UUIDField(required=False,allow_null=True,default=None)
    quantity = serializers.IntegerField(min_value=1,default=1)

    def validate_quantity(self,value):
        if value> services.max_item_quantity():
            raise serializers.ValidationError(
                f'You can order at most {services.max_item_quantity()} of one item.'
            )
        return value

class UpdateQuantitySerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1)

    def validate_quantity(self,value):
        if value > services.max_item_quantity():
            raise serializers.ValidationError(
                f'You can order at most {services.max_item_quantity()} of one item.'
            )
        return value

def _image_url(product,request):
    primary = getattr(product,'primary_images',None)
    file = primary[0].image if primary else product.product_img
    if not file:
        return None
    try:
        url = file.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request else url

def serialize_item(item,request):
    product , variant = item.product, item.variant
    issue = services.line_issue(item)
    return {
        'id' : str(item.id),
        'product':{
            'id':str(product.id),
            'name':product.name,
            'slug':product.slug,
            'unit':product.unit,
            'image': _image_url(product,request),
        },
        'variant': None if variant is None else{
            'id':str(variant.id),
            'sku':variant.sku,
            'quantity':str(variant.quantity.normalize()) if variant.quantity else '0',
            'unit':variant.unit,
            'mrp':str(variant.mrp),
        },
        'quantity': item.quantity,
        'unit_price': str(services.unit_price(item)),
        'line_total':str(services.line_total(item)),
        'available_stock':services.available_stock(item),
        'is_available':issue is None,
        'issue':issue,
        'issue_message':services.ISSUE_MESSAGES.get(issue),
        'added_at': item.added_at,
    }

def serialize_cart(cart,request):
    """Cart payload. Subtotal only counts lines that can be bought right now."""
    if cart is None:
        return {
            'id':None,
            'items':[],
            'total_quantity':0,
            'subtotal':'0.00',
            'unavailable_count':0,
            'can_checkout':False,
            'updated_at':None,
        }

    items = list(cart.items.all())
    rows = [serialize_item(item,request) for item in items]
    purchasable = [row for row in rows if row['is_available']]
    subtotal = sum((Decimal(row['line_total']) for row in purchasable),Decimal('0.00'))

    return {
        'id':str(cart.id),
        'items':rows,
        'total_quantity':sum(row['quantity'] for row in rows),
        'subtotal':str(subtotal.quantize(services.MONEY)),
        'unavailable_count':len(rows) - len(purchasable),
        'can_checkout':bool(rows) and len(purchasable) == len(rows),
        'updated_at':cart.updated_at,
    }



