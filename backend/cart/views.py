from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from . serializers import AddToCartSerializer,UpdateQuantitySerializer,serialize_cart


# Create your views here.
class CartBaseView(APIView):
    """Every cart view needs a logged-in user and only ever touches request.user's cart."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'cart'

    def cart_response(self,request,http_status=status.HTTP_200_OK):
        cart = services.fetch_cart(request.user)
        return Response(serialize_cart(cart,request),status=http_status)


class CartView(CartBaseView):
    def get(self,request):
        return self.cart_response(request)

    def delete(self, request):
        services.clear_cart(request.user)
        return self.cart_response(request)


class CartItemListView(CartBaseView):
    def post(self,request):
        serializer = AddToCartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        created = services.add_item(
            request.user, data['product'],data['variant'],data['quantity'],
        )
        return self.cart_response(
            request,
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

class CartItemDetailView(CartBaseView):
    def patch(self,request,pk):
        serializer = UpdateQuantitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        services.set_quantity(request.user,pk,serializer.validated_data['quantity'])
        return self.cart_response(request)

    def delete(self,request,pk):
        services.remove_item(request.user,pk)
        return self.cart_response(request)