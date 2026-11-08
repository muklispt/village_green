from django.db.models import Count,Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView,RetrieveAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from adminpanel.permissions import IsAdminPanelUser

from . import services
from .models import Order
from .serializers import (AdminOrderSerializer, AdminOrderListSerializer, AdminStatusSerializer, CheckoutSerializer,
                          OrderListSerializer, OrderSerializer)


class OrderPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 50


def customer_orders():
    return Order.objects.select_related('payment').prefetch_related('items__product', 'history')


def owned_order_or_404(user,pk):
    """Scoped lookup. Another customer's order id behaves like a missing one."""
    return get_object_or_404(customer_orders().filter(customer=user),pk=pk)


class CheckoutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'checkout'

    def post(self,request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        key = (request.headers.get('Idempotency-Key') or data.get('idempotency_key') or '').strip()
        if len(key)>64:
            return Response({'idempotency_key':['At most 64 characters.']},status=400)

        order, created = services.checkout(request.user,data,key or None)
        order = customer_orders().get(pk=order.pk)
        return Response(
            {
                'order':OrderSerializer(order).data,
                'idempotent_replay':not created,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class OrderListView(ListAPIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'orders'
    serializer_class = OrderListSerializer
    pagination_class = OrderPagination

    def get_queryset(self):
        return (
            Order.objects.filter(customer=self.request.user)
            .select_related('payment')
            .prefetch_related('items__product')
            .annotate(item_count=Count('items'))
            .order_by('-created_at')
        )

class OrderDetailView(RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'orders'
    serializer_class = OrderSerializer

    def get_queryset(self):
        return customer_orders().filter(customer=self.request.user)

class OrderCancelView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'orders'

    def post(self,request,pk):
        try:
            services.cancel_order_for_customer(pk,request.user)
        except Order.DoesNotExist:
            raise NotFound()
        return Response(OrderSerializer(owned_order_or_404(request.user,pk)).data)


class OrderPaymentInitiateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'checkout'

    def post(self, request, pk):
        try:
            result = services.create_razorpay_order(pk, request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Order.DoesNotExist:
            raise NotFound()


class OrderPaymentVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'checkout'

    def post(self, request, pk):
        try:
            result = services.verify_razorpay_payment(pk, request.user, request.data)
            return Response(result, status=status.HTTP_200_OK)
        except Order.DoesNotExist:
            raise NotFound()


class RazorpayWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw_body = request.body
        headers = request.META
        success, message = services.process_razorpay_webhook(raw_body, headers)
        if not success:
            if "signature" in message.lower():
                return Response({"error": message}, status=status.HTTP_401_UNAUTHORIZED)
            if "not found" in message.lower():
                return Response({"error": message}, status=status.HTTP_404_NOT_FOUND)
            return Response({"error": message}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "received", "detail": message}, status=status.HTTP_200_OK)


# ----------------------------------------------------------------- staff

class AdminOrderQuerysetMixin:
    permission_classes = [IsAdminPanelUser]

    def get_queryset(self):
        return(
            Order.objects.select_related('payment','customer')
            .prefetch_related('items','history__changed_by')
        )

class AdminOrderListView(AdminOrderQuerysetMixin, ListAPIView):
    serializer_class = AdminOrderListSerializer
    pagination_class = OrderPagination

    def get_queryset(self):
        queryset = (
            Order.objects.select_related('payment', 'customer')
            .annotate(item_count=Count('items'))
            .order_by('-created_at')
        )
        params = self.request.query_params

        # Filter by order status
        if params.get('status'):
            queryset = queryset.filter(status=params['status'])

        # Filter by payment status
        if params.get('payment_status'):
            queryset = queryset.filter(payment__status=params['payment_status'])

        # Filter by payment method
        if params.get('payment_method'):
            queryset = queryset.filter(payment_method=params['payment_method'])

        # Filter by date range (from / to)
        date_from = params.get('date_from') or params.get('date_after') or params.get('start_date')
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)

        date_to = params.get('date_to') or params.get('date_before') or params.get('end_date')
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        search = params.get('search', '').strip()
        if search:
            queryset = queryset.filter(
                Q(order_number__icontains=search)
                | Q(customer__email__icontains=search)
                | Q(customer__full_name__icontains=search)
                | Q(recipient_name__icontains=search)
                | Q(recipient_phone__icontains=search)
            )
        return queryset


class AdminOrderDetailView(AdminOrderQuerysetMixin, RetrieveAPIView):
    serializer_class = AdminOrderSerializer


class AdminOrderStatusView(APIView):
    permission_classes = [IsAdminPanelUser]

    def _update_status(self, request, pk):
        serializer = AdminStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        get_object_or_404(Order, pk=pk)
        services.update_status(
            pk,
            serializer.validated_data['status'],
            request.user,
            serializer.validated_data.get('note', ''),
        )
        order = (
            Order.objects.select_related('payment', 'customer')
            .prefetch_related('items', 'history__changed_by')
            .get(pk=pk)
        )
        return Response(AdminOrderSerializer(order).data, status=status.HTTP_200_OK)

    def post(self, request, pk):
        return self._update_status(request, pk)

    def patch(self, request, pk):
        return self._update_status(request, pk)


class AdminOrderCancelView(APIView):
    permission_classes = [IsAdminPanelUser]

    def post(self, request, pk):
        get_object_or_404(Order, pk=pk)
        reason = request.data.get('reason') or request.data.get('note') or 'Cancelled by admin'
        services.cancel_order_for_admin(pk, request.user, reason)
        order = (
            Order.objects.select_related('payment', 'customer')
            .prefetch_related('items', 'history__changed_by')
            .get(pk=pk)
        )
        return Response(AdminOrderSerializer(order).data, status=status.HTTP_200_OK)


