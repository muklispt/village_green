import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Package,
  MapPin,
  CreditCard,
  Banknote,
  CheckCircle2,
  Clock,
  ShoppingBag,
  XCircle,
  AlertCircle,
  ArrowLeft,
  Printer,
  RefreshCw,
  Phone,
  Loader2,
  ChevronRight,
} from "lucide-react";

import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import { getOrder, getMyOrderById, cancelOrder, initiatePayment, verifyPayment } from "../../services/orderService";
import { loadRazorpayScript, openRazorpayCheckout } from "../../services/razorpayService";
import { resolveImageUrl, formatPrice } from "../../services/productService";

/* ── helpers ─────────────────────────────────────────────── */

const ORDER_STEPS = [
  { key: "placed",      label: "Order\nPlaced",  statuses: ["pending", "confirmed", "processing", "shipped", "delivered"] },
  { key: "confirmed",   label: "Confirmed",       statuses: ["confirmed", "processing", "shipped", "delivered"] },
  { key: "processing",  label: "Packing",         statuses: ["processing", "shipped", "delivered"] },
  { key: "shipped",     label: "Shipped",         statuses: ["shipped", "delivered"] },
  { key: "delivered",   label: "Delivered",       statuses: ["delivered"] },
];

function getStepState(step, currentStatus) {
  if (currentStatus === "cancelled" || currentStatus === "failed") {
    return step.key === "placed" ? "cancelled" : "pending";
  }
  if (step.statuses.includes(currentStatus)) return "completed";
  return "pending";
}

function orderStatusLabel(status) {
  const MAP = {
    pending:    "Pending",
    confirmed:  "Confirmed",
    processing: "Processing",
    shipped:    "Shipped",
    delivered:  "Delivered",
    cancelled:  "Cancelled",
    failed:     "Failed",
  };
  return MAP[status] || status;
}

function orderStatusBadgeClass(status) {
  const MAP = {
    pending:    "gv-status-badge--pending",
    confirmed:  "gv-status-badge--confirmed",
    processing: "gv-status-badge--processing",
    shipped:    "gv-status-badge--shipped",
    delivered:  "gv-status-badge--delivered",
    cancelled:  "gv-status-badge--cancelled",
    failed:     "gv-status-badge--failed",
  };
  return MAP[status] || "gv-status-badge--pending";
}

function paymentStatusLabel(status) {
  const MAP = {
    pending:   "Payment Pending",
    paid:      "Paid",
    failed:    "Payment Failed",
    cancelled: "Payment Cancelled",
    refunded:  "Refunded",
  };
  return MAP[status] || status;
}

function paymentStatusBadgeClass(status) {
  const MAP = {
    pending:   "gv-payment-status-badge--pending",
    paid:      "gv-payment-status-badge--paid",
    failed:    "gv-payment-status-badge--failed",
    cancelled: "gv-payment-status-badge--cancelled",
  };
  return MAP[status] || "gv-payment-status-badge--pending";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDateShort(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/* ── component ───────────────────────────────────────────── */

export default function OrderDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const [order, setOrder]             = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [cancelling, setCancelling]   = useState(false);
  const [showCancel, setShowCancel]   = useState(false);
  const [cancelError, setCancelError] = useState("");

  const paymentSuccess = searchParams.get("payment_success") === "1";
  const paymentPending = searchParams.get("payment_pending") === "1";
  const paymentError = searchParams.get("payment_error") === "1";

  const [retryingPayment, setRetryingPayment] = useState(false);
  const [retryPaymentError, setRetryPaymentError] = useState("");
  const [retryPaymentSuccess, setRetryPaymentSuccess] = useState("");
  const [checkingStatus, setCheckingStatus] = useState(false);
  const isRetryingRef = useRef(false);

  const canRetryPayment = Boolean(
    order &&
    order.payment_method === "online" &&
    order.status === "pending" &&
    order.payment?.status !== "paid" &&
    order.status !== "cancelled"
  );

  const handleCheckStatus = async () => {
    if (checkingStatus) return;
    try {
      setCheckingStatus(true);
      const data = await getMyOrderById(id).catch(() => getOrder(id));
      setOrder(data);
      if (data?.payment?.status === "paid") {
        setRetryPaymentSuccess("Payment confirmed! Your order is now confirmed.");
        setRetryPaymentError("");
      } else {
        setRetryPaymentError("Payment is currently awaiting settlement. If you just completed payment in your UPI app, please refresh again in a few moments.");
      }
    } catch (err) {
      console.warn("Could not check payment status:", err);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleRetryPayment = async () => {
    if (retryingPayment || isRetryingRef.current || !canRetryPayment) return;
    try {
      isRetryingRef.current = true;
      setRetryingPayment(true);
      setRetryPaymentError("");
      setRetryPaymentSuccess("");

      await loadRazorpayScript();
      const sessionData = await initiatePayment(order.id);

      openRazorpayCheckout({
        sessionData,
        onSuccess: async (paymentResponse) => {
          try {
            setRetryingPayment(true);
            await verifyPayment(order.id, {
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature,
            });
            setRetryPaymentSuccess("Payment verified successfully! Your order is now confirmed.");
            // Refresh order details from backend
            const refreshed = await getOrder(order.id);
            setOrder(refreshed);
          } catch (verifyErr) {
            console.error("Retry payment verification failed/pending:", verifyErr);
            const msg =
              verifyErr.response?.data?.detail ||
              verifyErr.response?.data?.error ||
              "Payment verification is in progress. Please refresh this page shortly to check your updated status.";
            setRetryPaymentError(msg);
            try {
              const refreshed = await getOrder(order.id);
              setOrder(refreshed);
            } catch {
              // ignore
            }
          } finally {
            isRetryingRef.current = false;
            setRetryingPayment(false);
          }
        },
        onDismiss: () => {
          isRetryingRef.current = false;
          setRetryingPayment(false);
          setRetryPaymentError("Payment session was closed. You can retry whenever you are ready.");
        },
        onError: (err) => {
          isRetryingRef.current = false;
          setRetryingPayment(false);
          setRetryPaymentError(err.description || "Payment failed. Please try again or select another payment option.");
        },
      });
    } catch (err) {
      isRetryingRef.current = false;
      setRetryingPayment(false);
      const msg =
        err.response?.data?.detail ||
        err.response?.data?.error ||
        err.message ||
        "Could not initiate payment. The payment gateway may be temporarily unavailable.";
      setRetryPaymentError(msg);
    }
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await getMyOrderById(id).catch(() => getOrder(id));
      setOrder(data);
    } catch (err) {
      if (err?.response?.status === 404) {
        setError("Order not found.");
      } else {
        setError("Could not load order. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    async function fetchOrder() {
      try {
        setLoading(true);
        setError("");
        const data = await getOrder(id);
        if (active) setOrder(data);
      } catch (err) {
        if (active) {
          if (err?.response?.status === 404) {
            setError("Order not found.");
          } else {
            setError("Could not load order. Please try again.");
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchOrder();
    return () => {
      active = false;
    };
  }, [id]);

  async function handleCancelOrder() {
    setCancelling(true);
    setCancelError("");
    try {
      await cancelOrder(id);
      await load(); // Refresh order
      setShowCancel(false);
    } catch (err) {
      setCancelError(
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Failed to cancel order. Please try again."
      );
    } finally {
      setCancelling(false);
    }
  }

  /* ── render states ── */
  if (loading) {
    return (
      <div className="gv-order-detail-page">
        <Navbar />
        <div className="gv-loading-state">
          <Loader2 size={36} className="gv-spin" style={{ color: "#08712f" }} />
          <p>Loading order…</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="gv-order-detail-page">
        <Navbar />
        <div className="gv-order-detail-content">
          <div className="gv-alert gv-alert--error">
            <AlertCircle size={18} className="gv-alert-icon" />
            <span>{error}</span>
          </div>
          <Link to="/orders" className="gv-order-action-btn gv-order-action-btn--outline" style={{ width: "auto", display: "inline-flex" }}>
            <ArrowLeft size={16} /> Back to Orders
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const payment = order.payment || {};
  const items   = order.items   || [];

  /* ── status timeline ── */
  const isCancelled = ["cancelled", "failed"].includes(order.status);
  const steps = ORDER_STEPS.map((step) => {
    const state = getStepState(step, order.status);
    const isCurrent =
      !isCancelled &&
      step.statuses.includes(order.status) &&
      !ORDER_STEPS.find(
        (s, i) => ORDER_STEPS.indexOf(step) < i && s.statuses.includes(order.status)
      );
    return { ...step, state, isCurrent };
  });

  // Determine which step is the "current" (most advanced completed)
  let currentIdx = -1;
  if (!isCancelled) {
    steps.forEach((s, i) => { if (s.state === "completed") currentIdx = i; });
  }

  return (
    <div className="gv-order-detail-page">
      <Navbar />

      <div className="gv-order-detail-content">
        {/* Breadcrumb nav */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
          <Link to="/products" className="gv-link-subtle">Shop</Link>
          <ChevronRight size={14} />
          <Link to="/orders" className="gv-link-subtle">My Orders</Link>
          <ChevronRight size={14} />
          <span style={{ color: "#111", fontWeight: 600 }}>Order #{order.order_number}</span>
        </div>

        {/* Payment Success notification */}
        {(paymentSuccess || retryPaymentSuccess) && (
          <div
            className="gv-alert gv-alert--success"
            style={{
              marginBottom: "1.25rem",
              background: "#f0fdf4",
              borderColor: "#86efac",
              color: "#166534",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.9rem 1.25rem",
              borderRadius: "12px",
            }}
          >
            <CheckCircle2 size={20} className="gv-alert-icon" style={{ color: "#16a34a", flexShrink: 0 }} />
            <div>
              <strong>Payment Confirmed!</strong>{" "}
              {retryPaymentSuccess || "Your payment has been successfully verified and your farm order is now confirmed."}
            </div>
          </div>
        )}

        {/* Payment Pending notice */}
        {paymentPending && !paymentSuccess && !retryPaymentSuccess && (
          <div
            className="gv-alert gv-alert--info"
            style={{
              marginBottom: "1.25rem",
              background: "#eff6ff",
              borderColor: "#bfdbfe",
              color: "#1e40af",
              display: "flex",
              alignItems: "flex-start",
              gap: "0.75rem",
              padding: "0.9rem 1.25rem",
              borderRadius: "12px",
            }}
          >
            <Clock size={20} className="gv-alert-icon" style={{ color: "#3b82f6", flexShrink: 0, marginTop: "2px" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.25rem" }}>Payment Awaiting Confirmation</div>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>
                Your farm order has been registered. You can scan a dynamic UPI QR code on desktop or pay directly using Google Pay, PhonePe, Paytm, or BHIM on mobile.
              </div>
              <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
                {canRetryPayment && (
                  <button
                    type="button"
                    onClick={handleRetryPayment}
                    disabled={retryingPayment}
                    className="gv-btn gv-btn--primary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.85rem",
                      padding: "0.45rem 1rem",
                      background: "#1b4332",
                      color: "#fff",
                      borderRadius: "8px",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {retryingPayment ? <Loader2 size={14} className="gv-spin" /> : <CreditCard size={14} />}
                    {retryingPayment ? "Connecting..." : "Pay Now"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={checkingStatus}
                  className="gv-btn gv-btn--outline"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    fontSize: "0.85rem",
                    padding: "0.45rem 0.9rem",
                    background: "#fff",
                    color: "#1e40af",
                    borderColor: "#bfdbfe",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  <RefreshCw size={14} className={checkingStatus ? "gv-spin" : ""} />
                  {checkingStatus ? "Checking..." : "Check Status"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Payment error warning */}
        {(paymentError || retryPaymentError) && !paymentSuccess && !retryPaymentSuccess && (
          <div className="gv-alert gv-alert--warning" style={{ marginBottom: "1.25rem" }}>
            <AlertCircle size={18} className="gv-alert-icon" />
            <div style={{ flex: 1 }}>
              <strong>Payment Pending or Incomplete.</strong>{" "}
              {retryPaymentError || "Your order was placed but payment was not completed. You can retry payment below or contact farm support."}
              <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
                {canRetryPayment && (
                  <button
                    type="button"
                    onClick={handleRetryPayment}
                    disabled={retryingPayment}
                    className="gv-btn gv-btn--primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}
                  >
                    {retryingPayment ? <Loader2 size={14} className="gv-spin" /> : <CreditCard size={14} />}
                    {retryingPayment ? "Connecting..." : "Retry Payment"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCheckStatus}
                  disabled={checkingStatus}
                  className="gv-btn gv-btn--outline"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    fontSize: "0.85rem",
                    padding: "0.4rem 0.9rem",
                    background: "#fff",
                    color: "#854d0e",
                    borderColor: "#fde047",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  <RefreshCw size={14} className={checkingStatus ? "gv-spin" : ""} />
                  {checkingStatus ? "Checking..." : "Check Status"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="gv-order-detail-layout">
          {/* ── Left / main column ── */}
          <div>
            {/* Confirmation card */}
            <div className="gv-order-confirmation-card">
              <div className="gv-order-conf-top">
                <div className="gv-order-conf-left">
                  <div className="gv-order-conf-title">
                    {order.status === "delivered" ? "✓ Order Delivered!" :
                     order.status === "cancelled" ? "Order Cancelled" :
                     "Order Placed"}
                  </div>
                  <div className="gv-order-number">#{order.order_number}</div>
                  <div className="gv-order-date">Placed on {formatDateShort(order.created_at)}</div>
                </div>
                <div className="gv-order-conf-badges">
                  <span className={`gv-status-badge ${orderStatusBadgeClass(order.status)}`}>
                    {orderStatusLabel(order.status)}
                  </span>
                  {payment.status && (
                    <span className={`gv-payment-status-badge ${paymentStatusBadgeClass(payment.status)}`}>
                      {paymentStatusLabel(payment.status)}
                    </span>
                  )}
                </div>
              </div>

              {/* Status timeline */}
              <div className="gv-status-timeline">
                {steps.map((step, i) => {
                  const isCurr = i === currentIdx && !isCancelled;
                  const stepClass =
                    isCancelled && i === 0 ? "is-cancelled" :
                    step.state === "completed" ? "is-completed" :
                    isCurr ? "is-current" : "";
                  return (
                    <div key={step.key} className={`gv-timeline-item ${stepClass}`}>
                      <div className="gv-timeline-dot">
                        {step.state === "completed" || isCurr ? (
                          isCancelled && i === 0 ? <XCircle size={14} /> : <CheckCircle2 size={14} />
                        ) : (
                          <Clock size={14} style={{ color: "#9ca3af" }} />
                        )}
                      </div>
                      <div className="gv-timeline-label" style={{ whiteSpace: "pre-line" }}>
                        {step.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status History & Chronological Timeline */}
            {order.history && order.history.length > 0 && (
              <div className="gv-order-card" style={{ marginBottom: "1.25rem" }}>
                <div className="gv-order-card-header">
                  <Clock size={18} />
                  Order Activity Timeline
                </div>
                <div className="gv-order-card-body">
                  <div className="gv-order-history-timeline" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {order.history.map((hist, idx) => {
                      const isCancel = hist.to_status === "cancelled";
                      const isDelivered = hist.to_status === "delivered";
                      return (
                        <div key={idx} style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
                          <div
                            style={{
                              width: "30px",
                              height: "30px",
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: isCancel ? "#fee2e2" : isDelivered ? "#dcfce7" : "#e0f2fe",
                              color: isCancel ? "#dc2626" : isDelivered ? "#16a34a" : "#0284c7",
                              flexShrink: 0,
                              marginTop: "2px",
                            }}
                          >
                            {isCancel ? <XCircle size={16} /> : isDelivered ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
                              <strong style={{ fontSize: "0.875rem", color: "#111827", textTransform: "capitalize" }}>
                                {hist.from_status && hist.from_status !== hist.to_status
                                  ? `${orderStatusLabel(hist.from_status)} → ${orderStatusLabel(hist.to_status)}`
                                  : orderStatusLabel(hist.to_status)}
                              </strong>
                              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                                {formatDate(hist.created_at)}
                              </span>
                            </div>
                            {hist.note ? (
                              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: "#4b5563" }}>
                                {hist.note}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Ordered items */}
            <div className="gv-order-card">
              <div className="gv-order-card-header">
                <ShoppingBag size={18} />
                Ordered Items ({items.length})
              </div>
              <div className="gv-order-card-body">
                <div className="gv-order-items-list">
                  {items.map((item, idx) => (
                    <div key={item.id || idx} className="gv-order-item-row">
                      <img
                        src={resolveImageUrl(item.product_image || "")}
                        alt={item.product_name}
                        className="gv-order-item-thumb"
                        onError={(e) => { e.target.src = "/placeholder-product.png"; }}
                      />
                      <div className="gv-order-item-details">
                        <div className="gv-order-item-name">{item.product_name}</div>
                        {item.variant_label && (
                          <div className="gv-order-item-variant">{item.variant_label}</div>
                        )}
                        <div className="gv-order-item-price-row">
                          {formatPrice(item.unit_price)} × {item.quantity}
                        </div>
                      </div>
                      <div className="gv-order-item-total">
                        {formatPrice(item.line_total)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Payment summary */}
            <div className="gv-order-card">
              <div className="gv-order-card-header">
                <CreditCard size={18} />
                Payment Summary
              </div>
              <div className="gv-order-card-body">
                <div className="gv-payment-summary-rows">
                  <div className="gv-payment-summary-row">
                    <span>Subtotal</span>
                    <span>{formatPrice(order.subtotal)}</span>
                  </div>
                  {parseFloat(order.discount_amount) > 0 && (
                    <div className="gv-payment-summary-row is-discount">
                      <span>Discount</span>
                      <span>− {formatPrice(order.discount_amount)}</span>
                    </div>
                  )}
                  {parseFloat(order.shipping_fee) > 0 && (
                    <div className="gv-payment-summary-row">
                      <span>Shipping</span>
                      <span>{formatPrice(order.shipping_fee)}</span>
                    </div>
                  )}
                  {parseFloat(order.tax_amount) > 0 && (
                    <div className="gv-payment-summary-row">
                      <span>Tax</span>
                      <span>{formatPrice(order.tax_amount)}</span>
                    </div>
                  )}
                  <div className="gv-payment-summary-row is-total">
                    <span>Total</span>
                    <span>{formatPrice(order.total_amount)} {order.currency}</span>
                  </div>
                </div>

                <div className="gv-payment-method-section">
                  <div style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.4rem" }}>Payment method</div>
                  <span className="gv-payment-method-tag">
                    {order.payment_method === "online" ? <CreditCard size={14} /> : <Banknote size={14} />}
                    {order.payment_method === "online" ? "Online Payment" : "Cash on Delivery"}
                  </span>
                  {payment.paid_at && (
                    <div className="gv-paid-at">Paid on {formatDate(payment.paid_at)}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Delivery address */}
            <div className="gv-order-card">
              <div className="gv-order-card-header">
                <MapPin size={18} />
                Delivery Address
              </div>
              <div className="gv-order-card-body">
                <div className="gv-delivery-address-block">
                  <div className="gv-delivery-name">{order.recipient_name}</div>
                  <div className="gv-delivery-phone">
                    <Phone size={14} />
                    {order.recipient_phone}
                  </div>
                  <div className="gv-delivery-address-text">
                    {order.shipping_address}<br />
                    {order.shipping_city} — {order.shipping_pincode}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right / actions column ── */}
          <div>
            <div className="gv-order-actions-card">
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111", marginBottom: "0.25rem" }}>
                Actions
              </div>

              {canRetryPayment && (
                <button
                  type="button"
                  onClick={handleRetryPayment}
                  disabled={retryingPayment}
                  className="gv-order-action-btn gv-order-action-btn--primary"
                  style={{ backgroundColor: "#1b4332", color: "#fff", borderColor: "#1b4332" }}
                >
                  {retryingPayment ? <Loader2 size={16} className="gv-spin" /> : <CreditCard size={16} />}
                  <span>{retryingPayment ? "Connecting..." : "Retry Payment"}</span>
                </button>
              )}

              <Link to="/products" className="gv-order-action-btn gv-order-action-btn--primary">
                <ShoppingBag size={16} />
                Continue Shopping
              </Link>

              <Link to="/orders" className="gv-order-action-btn gv-order-action-btn--outline">
                <Package size={16} />
                View Order History
              </Link>

              <Link to="/profile?tab=orders" className="gv-order-action-btn gv-order-action-btn--outline">
                <ShoppingBag size={16} />
                My Orders in Profile
              </Link>

              <button
                className="gv-order-action-btn gv-order-action-btn--print"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Print Receipt
              </button>

              <button
                className="gv-order-action-btn gv-order-action-btn--outline"
                onClick={load}
                style={{ color: "#6b7280" }}
              >
                <RefreshCw size={15} />
                Refresh Status
              </button>

              {/* Cancel order */}
              {order.can_cancel && !showCancel && (
                <button
                  className="gv-order-action-btn gv-order-action-btn--danger"
                  onClick={() => setShowCancel(true)}
                >
                  <XCircle size={16} />
                  Cancel Order
                </button>
              )}

              {showCancel && (
                <div className="gv-cancel-confirm-box">
                  <p>Are you sure you want to cancel this order? This cannot be undone.</p>
                  {cancelError && (
                    <div style={{ fontSize: "0.8rem", color: "#b91c1c", marginBottom: "0.5rem" }}>
                      {cancelError}
                    </div>
                  )}
                  <div className="gv-cancel-confirm-actions">
                    <button
                      className="gv-cancel-btn-yes"
                      onClick={handleCancelOrder}
                      disabled={cancelling}
                    >
                      {cancelling ? "Cancelling…" : "Yes, Cancel"}
                    </button>
                    <button
                      className="gv-cancel-btn-no"
                      onClick={() => { setShowCancel(false); setCancelError(""); }}
                      disabled={cancelling}
                    >
                      Keep Order
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Order meta info */}
            <div className="gv-order-card" style={{ marginTop: "1rem" }}>
              <div className="gv-order-card-header" style={{ fontSize: "0.85rem" }}>
                <Clock size={15} />
                Order Timeline
              </div>
              <div className="gv-order-card-body">
                <div style={{ fontSize: "0.8rem", color: "#6b7280", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "#374151" }}>Placed: </span>
                    {formatDate(order.created_at)}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: "#374151" }}>Last Updated: </span>
                    {formatDate(order.updated_at)}
                  </div>
                  {payment.paid_at && (
                    <div>
                      <span style={{ fontWeight: 600, color: "#374151" }}>Paid: </span>
                      {formatDate(payment.paid_at)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

