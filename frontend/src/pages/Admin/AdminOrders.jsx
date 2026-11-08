import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShoppingBag,
  Search,
  Filter,
  RefreshCw,
  Eye,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  Truck,
  Package,
  Calendar,
  CreditCard,
  User,
  MapPin,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowRight,
  ShieldAlert,
  Ban,
  Check,
} from "lucide-react";
import {
  getAdminOrders,
  getAdminOrderById,
  updateAdminOrderStatus,
  cancelAdminOrder,
  getValidOrderTransitions,
  ORDER_VALID_TRANSITIONS,
} from "../../services/adminService";

export default function AdminOrders() {
  // Orders list state
  const [orders, setOrders] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Order detail modal state
  const [viewingOrderId, setViewingOrderId] = useState(null);
  const [orderDetail, setOrderDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // Status update in modal state
  const [newStatus, setNewStatus] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState("");

  // Cancellation modal state
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancellationLockRef = useRef(false);

  const pageSize = 15;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const fetchOrders = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError("");
      try {
        const res = await getAdminOrders({
          page,
          page_size: pageSize,
          search: searchQuery,
          status: statusFilter,
          payment_status: paymentStatusFilter,
          payment_method: paymentMethodFilter,
          date_from: dateFrom,
          date_to: dateTo,
        });
        setOrders(res?.results || []);
        setTotalCount(res?.count || 0);
        setCurrentPage(page);
      } catch (err) {
        setError(
          err?.response?.data?.detail || "Failed to load orders from server."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      searchQuery,
      statusFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      dateFrom,
      dateTo,
    ]
  );

  useEffect(() => {
    fetchOrders(1);
  }, [fetchOrders]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchOrders(1);
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPaymentStatusFilter("all");
    setPaymentMethodFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  // Open order details modal
  const handleOpenOrderDetail = async (orderId) => {
    setViewingOrderId(orderId);
    setDetailLoading(true);
    setDetailError("");
    setStatusUpdateError("");
    setNewStatus("");
    setStatusNotes("");
    try {
      const data = await getAdminOrderById(orderId);
      setOrderDetail(data);
    } catch (err) {
      setDetailError(
        err?.response?.data?.detail || "Failed to load order details."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  // Close order detail modal
  const handleCloseOrderDetail = () => {
    setViewingOrderId(null);
    setOrderDetail(null);
    setStatusUpdateError("");
  };

  // Submit status update
  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    if (!newStatus || !orderDetail) return;

    setIsUpdatingStatus(true);
    setStatusUpdateError("");
    try {
      await updateAdminOrderStatus(orderDetail.id, {
        status: newStatus,
        notes: statusNotes ? statusNotes.trim() : "",
      });
      showToast(`Order status updated to ${newStatus}.`);
      // Reload detail
      const refreshed = await getAdminOrderById(orderDetail.id);
      setOrderDetail(refreshed);
      setNewStatus("");
      setStatusNotes("");
      // Refresh list in background
      fetchOrders(currentPage);
    } catch (err) {
      const errDetail =
        err?.response?.data?.detail ||
        err?.response?.data?.status?.[0] ||
        err?.response?.data?.error ||
        "Failed to update status. Invalid transition or server error.";
      setStatusUpdateError(errDetail);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Open cancel modal
  const handleOpenCancelModal = (order) => {
    setCancellingOrder(order);
    setCancelReason("");
    setCancelError("");
  };

  // Confirm cancel with double-submission lock
  const handleConfirmCancel = async () => {
    if (!cancellingOrder) return;
    if (cancellationLockRef.current) return;

    cancellationLockRef.current = true;
    setIsCancelling(true);
    setCancelError("");

    try {
      await cancelAdminOrder(cancellingOrder.id, {
        reason: cancelReason ? cancelReason.trim() : "",
      });
      showToast(`Order #${cancellingOrder.order_number || cancellingOrder.id} cancelled successfully.`);
      setCancellingOrder(null);
      // If order details modal is open, refresh it
      if (orderDetail && orderDetail.id === cancellingOrder.id) {
        const refreshed = await getAdminOrderById(cancellingOrder.id);
        setOrderDetail(refreshed);
      }
      fetchOrders(currentPage);
    } catch (err) {
      const errDetail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Failed to cancel order. Terminal status or permission issue.";
      setCancelError(errDetail);
    } finally {
      setIsCancelling(false);
      cancellationLockRef.current = false;
    }
  };

  // Format currency
  const formatMoney = (amount) => {
    if (amount === undefined || amount === null) return "₹0.00";
    return `₹${Number(amount).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // Format dates
  const formatDateTime = (isoString) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  // Badges styling
  const getStatusBadge = (status) => {
    const s = String(status || "").toUpperCase();
    const map = {
      PENDING: { bg: "#fef3c7", text: "#92400e", border: "#fde68a" },
      CONFIRMED: { bg: "#e0e7ff", text: "#3730a3", border: "#c7d2fe" },
      PROCESSING: { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd" },
      SHIPPED: { bg: "#f3e8ff", text: "#6b21a8", border: "#e9d5ff" },
      DELIVERED: { bg: "#dcfce7", text: "#166534", border: "#bbf7d0" },
      CANCELLED: { bg: "#fee2e2", text: "#991b1b", border: "#fecaca" },
    };
    const style = map[s] || { bg: "#f3f4f6", text: "#374151", border: "#e5e7eb" };

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 8px",
          borderRadius: "9999px",
          fontSize: "12px",
          fontWeight: "600",
          backgroundColor: style.bg,
          color: style.text,
          border: `1px solid ${style.border}`,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {s}
      </span>
    );
  };

  const getPaymentStatusBadge = (status) => {
    const s = String(status || "").toUpperCase();
    if (s === "REFUND_PENDING") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "3px 9px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: "700",
            backgroundColor: "#fff7ed",
            color: "#c2410c",
            border: "1px solid #ffedd5",
            boxShadow: "0 1px 2px rgba(194, 65, 12, 0.1)",
          }}
        >
          <AlertCircle size={12} />
          <span>REFUND PENDING</span>
        </span>
      );
    }
    if (s === "SUCCESS" || s === "PAID") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: "600",
            backgroundColor: "#ecfdf5",
            color: "#047857",
            border: "1px solid #a7f3d0",
          }}
        >
          <CheckCircle size={12} />
          <span>PAID</span>
        </span>
      );
    }
    if (s === "FAILED") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: "600",
            backgroundColor: "#fef2f2",
            color: "#b91c1c",
            border: "1px solid #fecaca",
          }}
        >
          <X size={12} />
          <span>FAILED</span>
        </span>
      );
    }
    if (s === "REFUNDED") {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 8px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: "600",
            backgroundColor: "#f5f3ff",
            color: "#6d28d9",
            border: "1px solid #ddd6fe",
          }}
        >
          REFUNDED
        </span>
      );
    }
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 8px",
          borderRadius: "9999px",
          fontSize: "12px",
          fontWeight: "600",
          backgroundColor: "#fefce8",
          color: "#854d0e",
          border: "1px solid #fef08a",
        }}
      >
        <Clock size={12} />
        <span>PENDING</span>
      </span>
    );
  };

  // Compute summary stats from current orders batch
  const countPending = orders.filter((o) => o.status === "PENDING").length;
  const countProcessing = orders.filter((o) =>
    ["CONFIRMED", "PROCESSING", "SHIPPED"].includes(o.status)
  ).length;
  const countDelivered = orders.filter((o) => o.status === "DELIVERED").length;
  const countRefundPending = orders.filter(
    (o) => o.payment_status === "REFUND_PENDING"
  ).length;

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            backgroundColor: toast.type === "error" ? "#ef4444" : "#15803d",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            fontWeight: "500",
            zIndex: 1100,
          }}
        >
          {toast.type === "error" ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#111827", margin: 0 }}>
            Order Management
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Total patron orders: <strong style={{ color: "#111827" }}>{totalCount}</strong>
          </p>
        </div>
        <button
          onClick={() => fetchOrders(currentPage)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "9px 14px",
            backgroundColor: "#ffffff",
            border: "1px solid #d1d5db",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "500",
            color: "#374151",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          <span>Reload</span>
        </button>
      </div>

      {/* Order Statistics KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "18px 20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>Total Orders</span>
            <div style={{ padding: "8px", borderRadius: "8px", backgroundColor: "#f0fdf4", color: "#16a34a" }}>
              <ShoppingBag size={18} />
            </div>
          </div>
          <div style={{ fontSize: "26px", fontWeight: "800", color: "#111827", marginTop: "8px" }}>
            {totalCount}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Across all time</div>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "18px 20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>Pending Action</span>
            <div style={{ padding: "8px", borderRadius: "8px", backgroundColor: "#fefce8", color: "#ca8a04" }}>
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: "26px", fontWeight: "800", color: "#ca8a04", marginTop: "8px" }}>
            {countPending}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Awaiting confirmation</div>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "18px 20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>In Fulfillment</span>
            <div style={{ padding: "8px", borderRadius: "8px", backgroundColor: "#eff6ff", color: "#2563eb" }}>
              <Truck size={18} />
            </div>
          </div>
          <div style={{ fontSize: "26px", fontWeight: "800", color: "#2563eb", marginTop: "8px" }}>
            {countProcessing}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Confirmed, Processing, Shipped</div>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "18px 20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>Delivered</span>
            <div style={{ padding: "8px", borderRadius: "8px", backgroundColor: "#f0fdf4", color: "#15803d" }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <div style={{ fontSize: "26px", fontWeight: "800", color: "#15803d", marginTop: "8px" }}>
            {countDelivered}
          </div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>Completed patron orders</div>
        </div>

        {countRefundPending > 0 && (
          <div
            style={{
              backgroundColor: "#fff7ed",
              borderRadius: "12px",
              padding: "18px 20px",
              border: "1px solid #fed7aa",
              boxShadow: "0 1px 3px rgba(194, 65, 12, 0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", color: "#c2410c", fontWeight: "600" }}>Refund Attention</span>
              <div style={{ padding: "8px", borderRadius: "8px", backgroundColor: "#ffedd5", color: "#c2410c" }}>
                <ShieldAlert size={18} />
              </div>
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#c2410c", marginTop: "8px" }}>
              {countRefundPending}
            </div>
            <div style={{ fontSize: "12px", color: "#9a3412", marginTop: "4px" }}>Pending gateway reconciliation</div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          padding: "18px 20px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          marginBottom: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          {/* Search */}
          <form
            onSubmit={handleSearchSubmit}
            style={{
              flex: "1 1 280px",
              display: "flex",
              alignItems: "center",
              position: "relative",
            }}
          >
            <Search
              size={18}
              color="#9ca3af"
              style={{ position: "absolute", left: "12px" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order number, customer name, or email..."
              style={{
                width: "100%",
                padding: "9px 12px 9px 38px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
                outline: "none",
              }}
            />
          </form>

          {/* Order Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>STATUS:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                fontSize: "13px",
                color: "#374151",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PROCESSING">Processing</option>
              <option value="SHIPPED">Shipped</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Payment Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>PAYMENT:</span>
            <select
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                fontSize: "13px",
                color: "#374151",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">All Payment Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCESS">Success / Paid</option>
              <option value="FAILED">Failed</option>
              <option value="REFUND_PENDING">Refund Pending</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </div>

          {/* Payment Method */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>METHOD:</span>
            <select
              value={paymentMethodFilter}
              onChange={(e) => setPaymentMethodFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                fontSize: "13px",
                color: "#374151",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">All Methods</option>
              <option value="online">Online (Razorpay)</option>
              <option value="cod">Cash On Delivery (COD)</option>
            </select>
          </div>
        </div>

        {/* Date Filters Row */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", fontSize: "13px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Calendar size={15} color="#6b7280" />
            <span style={{ color: "#6b7280", fontWeight: "500" }}>From:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#6b7280", fontWeight: "500" }}>To:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>

          {(searchQuery ||
            statusFilter !== "all" ||
            paymentStatusFilter !== "all" ||
            paymentMethodFilter !== "all" ||
            dateFrom ||
            dateTo) && (
            <button
              onClick={handleResetFilters}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: "#f3f4f6",
                border: "none",
                color: "#4b5563",
                fontSize: "12px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "#b91c1c",
            marginBottom: "20px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Orders Table Card */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: "14px",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f9fafb",
                  borderBottom: "1px solid #e5e7eb",
                  color: "#4b5563",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <th style={{ padding: "14px 18px" }}>Order Ref</th>
                <th style={{ padding: "14px 18px" }}>Date & Time</th>
                <th style={{ padding: "14px 18px" }}>Customer</th>
                <th style={{ padding: "14px 18px" }}>Amount / Items</th>
                <th style={{ padding: "14px 18px" }}>Order Status</th>
                <th style={{ padding: "14px 18px" }}>Payment</th>
                <th style={{ padding: "14px 18px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ padding: "48px 20px", textAlign: "center", color: "#6b7280" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      <RefreshCw size={18} className="gv-spin" />
                      <span>Loading orders...</span>
                    </div>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: "48px 20px", textAlign: "center", color: "#6b7280" }}>
                    <ShoppingBag size={32} color="#9ca3af" style={{ margin: "0 auto 8px" }} />
                    <p style={{ fontWeight: "600", color: "#374151", margin: "0 0 4px" }}>
                      No orders found
                    </p>
                    <p style={{ fontSize: "13px", margin: 0 }}>
                      No orders matched the specified filters or date criteria.
                    </p>
                  </td>
                </tr>
              ) : (
                orders.map((ord) => {
                  const canCancel = !["SHIPPED", "DELIVERED", "CANCELLED"].includes(ord.status);
                  return (
                    <tr
                      key={ord.id}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        transition: "background-color 0.1s ease",
                      }}
                    >
                      {/* Order Number */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ fontWeight: "700", color: "#111827" }}>
                          #{ord.order_number || ord.id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                          {ord.id.slice(0, 18)}...
                        </div>
                      </td>

                      {/* Date */}
                      <td style={{ padding: "14px 18px", color: "#6b7280", fontSize: "13px" }}>
                        {formatDateTime(ord.created_at)}
                      </td>

                      {/* Customer */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ fontWeight: "600", color: "#111827" }}>
                          {ord.customer?.full_name || ord.shipping_address?.full_name || "Guest Patron"}
                        </div>
                        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                          {ord.customer?.email || ord.shipping_address?.phone || "—"}
                        </div>
                      </td>

                      {/* Amount / Items */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ fontWeight: "700", color: "#111827" }}>
                          {formatMoney(ord.total_amount)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                          {ord.items_count || (ord.items ? ord.items.length : 1)} item(s)
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "14px 18px" }}>
                        {getStatusBadge(ord.status)}
                      </td>

                      {/* Payment */}
                      <td style={{ padding: "14px 18px" }}>
                        <div>{getPaymentStatusBadge(ord.payment_status)}</div>
                        <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", textTransform: "uppercase" }}>
                          {ord.payment_method === "online" ? "Online (Razorpay)" : "Cash On Delivery"}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            onClick={() => handleOpenOrderDetail(ord.id)}
                            title="View Full Order Details"
                            style={{
                              padding: "6px 10px",
                              borderRadius: "6px",
                              backgroundColor: "#ffffff",
                              border: "1px solid #d1d5db",
                              color: "#374151",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: "500",
                            }}
                          >
                            <Eye size={13} />
                            <span>Details</span>
                          </button>
                          {canCancel && (
                            <button
                              onClick={() => handleOpenCancelModal(ord)}
                              title="Cancel Order & Release Inventory"
                              style={{
                                padding: "6px 10px",
                                borderRadius: "6px",
                                backgroundColor: "rgba(239, 68, 68, 0.08)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                color: "#dc2626",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "12px",
                                fontWeight: "500",
                              }}
                            >
                              <Ban size={13} />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            fontSize: "13px",
            color: "#6b7280",
          }}
        >
          <div>
            Showing Page <strong style={{ color: "#111827" }}>{currentPage}</strong> of{" "}
            <strong style={{ color: "#111827" }}>{totalPages}</strong> ({totalCount} total)
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => fetchOrders(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                color: currentPage <= 1 ? "#9ca3af" : "#374151",
                cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              <ChevronLeft size={16} />
              <span>Previous</span>
            </button>
            <button
              onClick={() => fetchOrders(currentPage + 1)}
              disabled={currentPage >= totalPages || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                color: currentPage >= totalPages ? "#9ca3af" : "#374151",
                cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              <span>Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Order Details Drawer / Modal */}
      {viewingOrderId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "880px",
              maxHeight: "90vh",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#fafafa",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "8px",
                    backgroundColor: "#f0fdf4",
                    color: "#15803d",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ShoppingBag size={20} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                      Order #{orderDetail?.order_number || viewingOrderId.slice(0, 8)}
                    </h2>
                    {orderDetail && getStatusBadge(orderDetail.status)}
                    {orderDetail && getPaymentStatusBadge(orderDetail.payment_status)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                    UUID: {viewingOrderId} • Placed {orderDetail ? formatDateTime(orderDetail.created_at) : "..."}
                  </div>
                </div>
              </div>
              <button
                onClick={handleCloseOrderDetail}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  padding: "4px",
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content Body */}
            <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
              {detailLoading ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: "#6b7280" }}>
                  <RefreshCw size={24} className="gv-spin" style={{ margin: "0 auto 8px" }} />
                  <div>Loading authoritative order details...</div>
                </div>
              ) : detailError ? (
                <div
                  style={{
                    padding: "16px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    color: "#b91c1c",
                  }}
                >
                  {detailError}
                </div>
              ) : orderDetail ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                  {/* Status Banner when REFUND_PENDING */}
                  {orderDetail.payment_status === "REFUND_PENDING" && (
                    <div
                      style={{
                        padding: "14px 18px",
                        backgroundColor: "#fff7ed",
                        border: "1px solid #fed7aa",
                        borderRadius: "8px",
                        color: "#9a3412",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontSize: "13px",
                      }}
                    >
                      <AlertTriangle size={20} color="#ea580c" />
                      <div>
                        <strong>Refund Pending Notice:</strong> This order was cancelled after payment was authorized. The payment status is marked <strong>REFUND_PENDING</strong>. Reconcile refund directly in your Razorpay merchant dashboard if not auto-processed.
                      </div>
                    </div>
                  )}

                  {/* Customer & Shipping Details Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "16px",
                    }}
                  >
                    {/* Customer */}
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        backgroundColor: "#f9fafb",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", fontWeight: "600", color: "#374151", fontSize: "13px" }}>
                        <User size={16} color="#15803d" />
                        <span>Customer Account</span>
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: "600", color: "#111827" }}>
                        {orderDetail.customer?.full_name || orderDetail.shipping_address?.full_name || "Guest Patron"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "2px" }}>
                        {orderDetail.customer?.email || "—"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "2px" }}>
                        {orderDetail.customer?.phone || orderDetail.shipping_address?.phone || "—"}
                      </div>
                    </div>

                    {/* Shipping Address */}
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        backgroundColor: "#f9fafb",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", fontWeight: "600", color: "#374151", fontSize: "13px" }}>
                        <MapPin size={16} color="#15803d" />
                        <span>Shipping Destination</span>
                      </div>
                      {orderDetail.shipping_address ? (
                        <div style={{ fontSize: "13px", color: "#374151", lineHeight: "1.5" }}>
                          <div style={{ fontWeight: "600", color: "#111827" }}>
                            {orderDetail.shipping_address.full_name}
                          </div>
                          <div>{orderDetail.shipping_address.address_line1 || orderDetail.shipping_address.address}</div>
                          {orderDetail.shipping_address.address_line2 && (
                            <div>{orderDetail.shipping_address.address_line2}</div>
                          )}
                          <div>
                            {orderDetail.shipping_address.city}, {orderDetail.shipping_address.state} — {orderDetail.shipping_address.postal_code || orderDetail.shipping_address.pincode}
                          </div>
                          <div style={{ marginTop: "4px", color: "#6b7280" }}>
                            Phone: {orderDetail.shipping_address.phone}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "13px", color: "#6b7280" }}>No delivery address recorded.</div>
                      )}
                    </div>
                  </div>

                  {/* Order Items Table */}
                  <div>
                    <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Ordered Items ({orderDetail.items?.length || 0})
                    </h3>
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#4b5563" }}>
                            <th style={{ padding: "10px 14px", textAlign: "left" }}>Product / Variant</th>
                            <th style={{ padding: "10px 14px", textAlign: "right" }}>Unit Price</th>
                            <th style={{ padding: "10px 14px", textAlign: "center" }}>Qty</th>
                            <th style={{ padding: "10px 14px", textAlign: "right" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderDetail.items?.map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "12px 14px" }}>
                                <div style={{ fontWeight: "600", color: "#111827" }}>
                                  {item.product_name || item.product?.name || "Product"}
                                </div>
                                {item.variant_name && (
                                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                                    Pack/Variant: {item.variant_name}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "right", color: "#374151" }}>
                                {formatMoney(item.unit_price)}
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: "600" }}>
                                {item.quantity}
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: "700", color: "#111827" }}>
                                {formatMoney(item.total_price)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Financial Breakdown & Payment Info */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "16px",
                    }}
                  >
                    {/* Payment Info */}
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        backgroundColor: "#f9fafb",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", fontWeight: "600", color: "#374151" }}>
                        <CreditCard size={16} color="#15803d" />
                        <span>Payment & Gateway Information</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#6b7280" }}>Method:</span>
                          <strong style={{ textTransform: "uppercase" }}>{orderDetail.payment_method}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#6b7280" }}>Status:</span>
                          <span>{getPaymentStatusBadge(orderDetail.payment_status)}</span>
                        </div>
                        {orderDetail.payment && (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "#6b7280" }}>Provider:</span>
                              <span style={{ textTransform: "capitalize" }}>{orderDetail.payment.provider}</span>
                            </div>
                            {orderDetail.payment.provider_order_id && (
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#6b7280" }}>Gateway Order ID:</span>
                                <code style={{ fontSize: "11px" }}>{orderDetail.payment.provider_order_id}</code>
                              </div>
                            )}
                            {orderDetail.payment.provider_payment_id && (
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#6b7280" }}>Payment ID:</span>
                                <code style={{ fontSize: "11px" }}>{orderDetail.payment.provider_payment_id}</code>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        backgroundColor: "#f9fafb",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ fontWeight: "600", color: "#374151", marginBottom: "12px" }}>
                        Financial Calculation
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563" }}>
                          <span>Subtotal:</span>
                          <span>{formatMoney(orderDetail.subtotal || orderDetail.total_amount)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563" }}>
                          <span>Delivery Fee:</span>
                          <span>{formatMoney(orderDetail.shipping_fee || 0)}</span>
                        </div>
                        {orderDetail.discount_amount > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", color: "#15803d" }}>
                            <span>Discount:</span>
                            <span>-{formatMoney(orderDetail.discount_amount)}</span>
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            borderTop: "1px solid #e5e7eb",
                            paddingTop: "8px",
                            fontWeight: "700",
                            fontSize: "15px",
                            color: "#111827",
                          }}
                        >
                          <span>Total Amount:</span>
                          <span>{formatMoney(orderDetail.total_amount)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status Transition Control (Admin Action) */}
                  <div
                    style={{
                      padding: "18px",
                      borderRadius: "10px",
                      border: "1px solid #bbf7d0",
                      backgroundColor: "#f0fdf4",
                    }}
                  >
                    <div style={{ fontWeight: "700", color: "#166534", marginBottom: "6px", fontSize: "14px" }}>
                      Manage Order Status & Transition
                    </div>
                    <div style={{ fontSize: "13px", color: "#4b5563", marginBottom: "14px" }}>
                      Authorized transitions from current status <strong>{orderDetail.status}</strong> are restricted to:{" "}
                      <code>{getValidOrderTransitions(orderDetail.status).join(", ") || "None (Terminal Status)"}</code>.
                    </div>

                    {getValidOrderTransitions(orderDetail.status).length > 0 ? (
                      <form onSubmit={handleUpdateStatus} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                          <select
                            value={newStatus}
                            onChange={(e) => setNewStatus(e.target.value)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "8px",
                              border: "1px solid #d1d5db",
                              backgroundColor: "#ffffff",
                              fontSize: "13px",
                              fontWeight: "600",
                              color: "#111827",
                              outline: "none",
                              cursor: "pointer",
                            }}
                          >
                            <option value="">Select Next Status...</option>
                            {getValidOrderTransitions(orderDetail.status).map((s) => (
                              <option key={s} value={s}>
                                Transition to {s}
                              </option>
                            ))}
                          </select>

                          <input
                            type="text"
                            value={statusNotes}
                            onChange={(e) => setStatusNotes(e.target.value)}
                            placeholder="Optional transition audit note (e.g., Courier tracking #)..."
                            style={{
                              flex: "1 1 240px",
                              padding: "8px 12px",
                              borderRadius: "8px",
                              border: "1px solid #d1d5db",
                              fontSize: "13px",
                              outline: "none",
                            }}
                          />

                          <button
                            type="submit"
                            disabled={!newStatus || isUpdatingStatus}
                            style={{
                              padding: "8px 16px",
                              borderRadius: "8px",
                              border: "none",
                              backgroundColor: "#15803d",
                              color: "#ffffff",
                              fontSize: "13px",
                              fontWeight: "600",
                              cursor: !newStatus || isUpdatingStatus ? "not-allowed" : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            {isUpdatingStatus && <RefreshCw size={14} className="gv-spin" />}
                            <span>Apply Status</span>
                          </button>
                        </div>

                        {statusUpdateError && (
                          <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>
                            {statusUpdateError}
                          </div>
                        )}
                      </form>
                    ) : (
                      <div style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic" }}>
                        Order is in a terminal state ({orderDetail.status}). Further status updates are prohibited by business rules.
                      </div>
                    )}
                  </div>

                  {/* Status History Timeline */}
                  <div>
                    <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Order Status Timeline
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {orderDetail.status_history && orderDetail.status_history.length > 0 ? (
                        orderDetail.status_history.map((h, idx) => (
                          <div
                            key={h.id || idx}
                            style={{
                              padding: "12px 14px",
                              borderRadius: "8px",
                              backgroundColor: "#f9fafb",
                              border: "1px solid #e5e7eb",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: "13px",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: "600", color: "#111827", display: "flex", alignItems: "center", gap: "6px" }}>
                                <span>{h.from_status ? h.from_status : "CREATED"}</span>
                                <ArrowRight size={14} color="#9ca3af" />
                                <span style={{ color: "#15803d" }}>{h.to_status}</span>
                                {h.actor && (
                                  <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: "normal", marginLeft: "4px" }}>
                                    by {h.actor.full_name || h.actor.email || "System"}
                                  </span>
                                )}
                              </div>
                              {h.notes && (
                                <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "3px" }}>
                                  Note: {h.notes}
                                </div>
                              )}
                            </div>
                            <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                              {formatDateTime(h.created_at)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: "13px", color: "#6b7280", fontStyle: "italic" }}>
                          No audit entries recorded.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                {orderDetail && !["SHIPPED", "DELIVERED", "CANCELLED"].includes(orderDetail.status) && (
                  <button
                    onClick={() => handleOpenCancelModal(orderDetail)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "6px",
                      backgroundColor: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: "#dc2626",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Ban size={14} />
                    <span>Cancel Order</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseOrderDetail}
                style={{
                  padding: "8px 18px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  color: "#374151",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {cancellingOrder && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Ban size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  Cancel Order Confirmation
                </h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0" }}>
                  Order #{cancellingOrder.order_number || cancellingOrder.id.slice(0, 8)}
                </p>
              </div>
            </div>

            <div style={{ padding: "20px 24px" }}>
              <p style={{ fontSize: "14px", color: "#374151", marginTop: 0, lineHeight: "1.5" }}>
                Cancelling this order will restore reserved product quantities back into active inventory
                and transition the order to <strong>CANCELLED</strong>.
              </p>

              {cancellingOrder.payment_status === "SUCCESS" && (
                <div
                  style={{
                    backgroundColor: "#fff7ed",
                    border: "1px solid #fed7aa",
                    borderRadius: "8px",
                    padding: "12px",
                    color: "#c2410c",
                    fontSize: "13px",
                    marginBottom: "14px",
                  }}
                >
                  <strong>Payment Alert:</strong> This order has confirmed payment. The payment status will transition to <strong>REFUND_PENDING</strong>.
                </div>
              )}

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#374151",
                    marginBottom: "6px",
                  }}
                >
                  Cancellation Reason / Note
                </label>
                <textarea
                  rows="3"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer requested cancellation, out of delivery zone, item defect..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>

              {cancelError && (
                <div
                  style={{
                    marginTop: "14px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    padding: "12px",
                    color: "#b91c1c",
                    fontSize: "13px",
                  }}
                >
                  {cancelError}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={() => setCancellingOrder(null)}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  color: "#374151",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#dc2626",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: isCancelling ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isCancelling && <RefreshCw size={14} className="gv-spin" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

