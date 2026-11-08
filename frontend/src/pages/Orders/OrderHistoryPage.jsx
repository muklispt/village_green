import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  ShoppingBag,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import { getOrders } from "../../services/orderService";
import { formatPrice } from "../../services/productService";

/* ── helpers ─────────────────────────────────────────────── */

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
  return MAP[status] || (status || "");
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

function formatDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/* ── component ───────────────────────────────────────────── */

export default function OrderHistoryPage() {
  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [page, setPage]         = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function fetchOrders() {
      try {
        setLoading(true);
        setError("");
        const data = await getOrders(page);
        if (!active) return;
        if (Array.isArray(data)) {
          setOrders(data);
          setTotalPages(1);
          setTotalCount(data.length);
        } else {
          setOrders(data.results || []);
          const count = data.count || 0;
          const perPage = data.results ? data.results.length : 10;
          const pages = data.count
            ? Math.ceil(data.count / (perPage || 10))
            : 1;
          setTotalPages(pages);
          setTotalCount(count);
        }
      } catch {
        if (active) setError("Could not load your orders. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchOrders();
    return () => {
      active = false;
    };
  }, [page]);

  function handlePrev() {
    if (page > 1) setPage((p) => p - 1);
  }
  function handleNext() {
    if (page < totalPages) setPage((p) => p + 1);
  }

  return (
    <div className="gv-order-history-page">
      <Navbar />

      <div className="gv-order-history-content">
        <div className="gv-order-history-title">My Orders</div>
        <div className="gv-order-history-subtitle">
          {totalCount > 0 ? `${totalCount} order${totalCount !== 1 ? "s" : ""}` : "Your order history"}
        </div>

        {loading && (
          <div className="gv-loading-state">
            <Loader2 size={32} style={{ color: "#08712f" }} className="gv-spin" />
            <p>Loading orders…</p>
          </div>
        )}

        {!loading && error && (
          <div className="gv-alert gv-alert--error">
            <AlertCircle size={18} className="gv-alert-icon" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="gv-empty-state-card">
            <ShoppingBag size={48} className="gv-icon-muted" style={{ margin: "0 auto 1rem" }} />
            <h3>No orders yet</h3>
            <p style={{ fontSize: "0.875rem", marginBottom: "1.25rem" }}>
              Your order history will appear here once you place your first order.
            </p>
            <Link
              to="/products"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                background: "#08712f", color: "#fff", padding: "0.65rem 1.25rem",
                borderRadius: "10px", fontWeight: 700, fontSize: "0.9rem", textDecoration: "none",
              }}
            >
              <ShoppingBag size={16} /> Start Shopping
            </Link>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <>
            <div className="gv-order-history-list">
              {orders.map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="gv-order-history-row"
                >
                  <div className="gv-order-history-left">
                    <div className="gv-order-history-num">#{order.order_number}</div>
                    <div className="gv-order-history-meta">
                      <span>{formatDateShort(order.created_at)}</span>
                      {order.item_count != null && (
                        <span>
                          {order.item_count} item{order.item_count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span style={{ textTransform: "capitalize" }}>
                        {order.payment_method === "online" ? "Online Payment" : "Cash on Delivery"}
                      </span>
                    </div>
                  </div>
                  <div className="gv-order-history-right">
                    <div className="gv-order-history-total">
                      {formatPrice(order.total_amount)}
                    </div>
                    <div className="gv-order-history-badges">
                      <span className={`gv-status-badge ${orderStatusBadgeClass(order.status)}`}>
                        {orderStatusLabel(order.status)}
                      </span>
                      {order.payment_status && (
                        <span className={`gv-payment-status-badge ${paymentStatusBadgeClass(order.payment_status)}`}>
                          {paymentStatusLabel(order.payment_status)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: "#9ca3af", gridColumn: "span 1" }} />
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="gv-pagination">
                <button
                  className="gv-pagination-btn"
                  onClick={handlePrev}
                  disabled={page <= 1}
                >
                  <ArrowLeft size={15} /> Previous
                </button>
                <span className="gv-pagination-info">Page {page} of {totalPages}</span>
                <button
                  className="gv-pagination-btn"
                  onClick={handleNext}
                  disabled={page >= totalPages}
                >
                  Next <ArrowRight size={15} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}

