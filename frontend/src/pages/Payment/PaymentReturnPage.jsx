import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ShoppingBag,
  Package,
} from "lucide-react";

import { getOrder } from "../../services/orderService";

/* ── constants ───────────────────────────────────────────── */
const MAX_POLLS    = 6;     // Maximum polling attempts
const POLL_INTERVAL_MS = 2500; // 2.5 seconds between polls

/* ── helpers ─────────────────────────────────────────────── */
/**
 * Derive a page state from the order/payment data returned by the backend.
 * A successful redirect from a payment gateway is NOT proof of payment.
 * We always fetch the authoritative status from our own backend.
 */
function resolveState(order) {
  if (!order) return "pending";
  const pStatus = order.payment?.status;
  if (pStatus === "paid") return "success";
  if (pStatus === "failed")    return "failed";
  if (pStatus === "cancelled") return "cancelled";
  // Order itself cancelled (e.g. already cancelled before payment)
  if (order.status === "cancelled") return "cancelled";
  // Still awaiting webhook confirmation
  return "pending";
}

/* ── component ───────────────────────────────────────────── */

export default function PaymentReturnPage() {
  const [searchParams]              = useSearchParams();
  const navigate                    = useNavigate();

  const orderId  = searchParams.get("order_id");

  const [pageState, setPageState] = useState(() => (!orderId ? "no_order" : "pending"));
  const timerRef = useRef(null);

  /* Poll backend for authoritative payment status */
  useEffect(() => {
    if (!orderId) return;

    let attempts = 0;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const data = await getOrder(orderId);
        if (cancelled) return;
        const state = resolveState(data);
        setPageState(state);

        if (state === "pending" && attempts < MAX_POLLS) {
          attempts++;
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (state === "pending") {
          // Exhausted retries — show "verification pending"
          setPageState("unknown");
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.response?.status === 404) {
          setPageState("no_order");
        } else {
          setPageState("unknown");
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [orderId]);

  /* Auto-redirect on success after a short pause */
  useEffect(() => {
    if (pageState === "success" && orderId) {
      const t = setTimeout(() => navigate(`/orders/${orderId}`, { replace: true }), 3000);
      return () => clearTimeout(t);
    }
  }, [pageState, orderId, navigate]);

  /* ── render ── */
  const config = {
    pending: {
      iconClass: "gv-payment-return-icon--pending",
      icon: <Clock size={32} />,
      title: "Verifying Payment…",
      desc: "Please wait while we confirm your payment with our records. Do not close this page.",
      showDots: true,
    },
    success: {
      iconClass: "gv-payment-return-icon--success",
      icon: <CheckCircle2 size={32} />,
      title: "Payment Confirmed!",
      desc: "Your payment has been verified and your order is confirmed. Redirecting you to your order…",
      showDots: false,
    },
    failed: {
      iconClass: "gv-payment-return-icon--failed",
      icon: <XCircle size={32} />,
      title: "Payment Failed",
      desc: "Your payment could not be completed. Your order has been recorded. You can try again or contact support.",
      showDots: false,
    },
    cancelled: {
      iconClass: "gv-payment-return-icon--failed",
      icon: <XCircle size={32} />,
      title: "Payment Cancelled",
      desc: "Your payment was cancelled. No charge has been made. You can retry or choose a different payment method.",
      showDots: false,
    },
    unknown: {
      iconClass: "gv-payment-return-icon--unknown",
      icon: <AlertCircle size={32} />,
      title: "Verification Pending",
      desc: "We could not confirm your payment status yet. Please check your order page for the latest status. If you were charged, your payment will be reconciled automatically.",
      showDots: false,
    },
    no_order: {
      iconClass: "gv-payment-return-icon--unknown",
      icon: <AlertCircle size={32} />,
      title: "Order Not Found",
      desc: "We could not find the order associated with this payment. Please check your order history or contact support.",
      showDots: false,
    },
  };

  const c = config[pageState] || config.unknown;

  return (
    <div className="gv-payment-return-page">
      {/* Minimal nav — no full Navbar to avoid distraction */}
      <div
        style={{
          position: "fixed", top: 0, left: 0, right: 0,
          background: "#fff", borderBottom: "1px solid #e5e7eb",
          padding: "0.75rem 1.5rem", zIndex: 100,
          display: "flex", alignItems: "center", gap: "0.5rem",
        }}
      >
        <span style={{ fontWeight: 800, color: "#08712f", fontSize: "1.1rem" }}>🌿 Green Village</span>
      </div>

      <div style={{ paddingTop: "80px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="gv-payment-return-card">
          {/* Icon */}
          <div className={`gv-payment-return-icon ${c.iconClass}`}>
            {c.icon}
          </div>

          {/* Title + description */}
          <div className="gv-payment-return-title">{c.title}</div>
          <div className="gv-payment-return-desc">{c.desc}</div>

          {/* Animated dots while polling */}
          {c.showDots && (
            <div className="gv-poll-dots">
              <div className="gv-poll-dot" />
              <div className="gv-poll-dot" />
              <div className="gv-poll-dot" />
            </div>
          )}

          {/* Actions */}
          <div className="gv-payment-return-actions">
            {pageState === "success" && orderId && (
              <Link to={`/orders/${orderId}`} className="gv-payment-return-btn gv-payment-return-btn--primary">
                <Package size={16} /> View My Order
              </Link>
            )}

            {(pageState === "failed" || pageState === "cancelled") && orderId && (
              <Link to={`/orders/${orderId}`} className="gv-payment-return-btn gv-payment-return-btn--primary">
                <Package size={16} /> View Order Details
              </Link>
            )}

            {pageState === "unknown" && orderId && (
              <Link to={`/orders/${orderId}`} className="gv-payment-return-btn gv-payment-return-btn--primary">
                <Package size={16} /> Check Order Status
              </Link>
            )}

            {pageState !== "success" && (
              <Link to="/orders" className="gv-payment-return-btn gv-payment-return-btn--outline">
                <Package size={16} /> My Orders
              </Link>
            )}

            <Link to="/products" className="gv-payment-return-btn gv-payment-return-btn--outline">
              <ShoppingBag size={16} /> Continue Shopping
            </Link>
          </div>

          {/* Security note */}
          <div style={{ marginTop: "1.5rem", fontSize: "0.72rem", color: "#9ca3af", lineHeight: 1.5 }}>
            Payment status is verified directly from our secure backend.
            A browser redirect alone is never used as proof of payment.
          </div>
        </div>
      </div>
    </div>
  );
}

