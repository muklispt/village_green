import React, { useEffect, useState, useCallback } from "react";
import {
  Users,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Ban,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Calendar,
  AlertCircle,
} from "lucide-react";
import {
  getAdminCustomers,
  blockCustomer,
  unblockCustomer,
} from "../../services/adminService";

export default function AdminCustomers() {
  const [customers, setCustomers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");

  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const fetchCustomers = useCallback(
    async (page = 1, search = "", is_active = "") => {
      setLoading(true);
      setError("");
      try {
        const res = await getAdminCustomers({
          page,
          search,
          is_active,
        });
        setCustomers(res?.results || []);
        setTotalCount(res?.count || 0);
        setCurrentPage(page);
      } catch (err) {
        setError(
          err?.response?.data?.detail || "Failed to load customers from server."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCustomers(1, searchQuery, statusFilter);
  }, [fetchCustomers, statusFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchCustomers(1, searchQuery, statusFilter);
  };

  const handleToggleBlock = async (customer) => {
    const isBlocking = customer.is_active;
    const confirmText = isBlocking
      ? `Are you sure you want to block ${customer.full_name || customer.email}? Their active session tokens will be immediately revoked.`
      : `Re-activate customer ${customer.full_name || customer.email}?`;

    if (!window.confirm(confirmText)) return;

    setActionLoadingId(customer.id);
    try {
      if (isBlocking) {
        await blockCustomer(customer.id);
        showToast(
          `Customer ${customer.full_name || customer.email} blocked successfully.`
        );
      } else {
        await unblockCustomer(customer.id);
        showToast(
          `Customer ${customer.full_name || customer.email} unblocked successfully.`
        );
      }
      // Refresh list
      fetchCustomers(currentPage, searchQuery, statusFilter);
    } catch (err) {
      showToast(
        err?.response?.data?.detail || "Operation failed. Please try again.",
        "error"
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

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
            zIndex: 1000,
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
            Customer Accounts
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Total registered patrons: <strong style={{ color: "#111827" }}>{totalCount}</strong>
          </p>
        </div>
        <button
          onClick={() => fetchCustomers(currentPage, searchQuery, statusFilter)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
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

      {/* Filter and Search Bar */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          padding: "16px 20px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          marginBottom: "20px",
          display: "flex",
          gap: "16px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
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
            placeholder="Search by full name, email, or phone..."
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

        {/* Status Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Filter size={16} color="#6b7280" />
          <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>
            Status:
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              backgroundColor: "#ffffff",
              fontSize: "13px",
              fontWeight: "500",
              color: "#374151",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="">All Accounts</option>
            <option value="true">Active Only</option>
            <option value="false">Blocked Only</option>
          </select>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div
          style={{
            padding: "14px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            color: "#b91c1c",
            fontSize: "14px",
            marginBottom: "20px",
          }}
        >
          {error}
        </div>
      )}

      {/* Customer Table */}
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
              fontSize: "13px",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f9fafb",
                  borderBottom: "1px solid #e5e7eb",
                  color: "#4b5563",
                  fontSize: "12px",
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <th style={{ padding: "14px 20px" }}>Customer</th>
                <th style={{ padding: "14px 20px" }}>Contact Details</th>
                <th style={{ padding: "14px 20px" }}>Joined</th>
                <th style={{ padding: "14px 20px" }}>Status</th>
                <th style={{ padding: "14px 20px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      <RefreshCw size={18} className="gv-spin" />
                      <span>Loading customer list...</span>
                    </div>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "48px 20px", textAlign: "center", color: "#6b7280" }}>
                    <Users size={36} color="#9ca3af" style={{ margin: "0 auto 12px" }} />
                    <p style={{ fontWeight: "600", color: "#111827", marginBottom: "4px" }}>
                      No customers found
                    </p>
                    <p style={{ fontSize: "13px" }}>
                      {searchQuery || statusFilter
                        ? "Try adjusting your search query or status filter."
                        : "No customer records currently exist in the database."}
                    </p>
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const isBusy = actionLoadingId === c.id;
                  return (
                    <tr
                      key={c.id}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        transition: "background-color 0.1s ease",
                      }}
                    >
                      {/* Name & Avatar */}
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "38px",
                              height: "38px",
                              borderRadius: "50%",
                              backgroundColor: c.is_active ? "#e8f7ec" : "#fee2e2",
                              color: c.is_active ? "#15803d" : "#b91c1c",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: "600",
                              fontSize: "14px",
                              flexShrink: 0,
                            }}
                          >
                            {(c.full_name || c.email || "U")[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: "600", color: "#111827" }}>
                              {c.full_name || "Anonymous Patron"}
                            </div>
                            <div style={{ fontSize: "11px", color: "#6b7280" }}>
                              UUID: {c.id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#374151" }}>
                          <Mail size={14} color="#9ca3af" />
                          <span>{c.email}</span>
                        </div>
                        {c.phone && (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#6b7280", marginTop: "4px", fontSize: "12px" }}>
                            <Phone size={13} color="#9ca3af" />
                            <span>{c.phone}</span>
                          </div>
                        )}
                      </td>

                      {/* Joined Date */}
                      <td style={{ padding: "16px 20px", color: "#6b7280" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Calendar size={14} color="#9ca3af" />
                          <span>{formatDate(c.date_joined)}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "16px 20px" }}>
                        {c.is_active ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "4px 10px",
                              borderRadius: "9999px",
                              backgroundColor: "#f0fdf4",
                              border: "1px solid #bbf7d0",
                              color: "#166534",
                              fontWeight: "600",
                              fontSize: "12px",
                            }}
                          >
                            <CheckCircle size={13} />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "4px 10px",
                              borderRadius: "9999px",
                              backgroundColor: "#fef2f2",
                              border: "1px solid #fecaca",
                              color: "#991b1b",
                              fontWeight: "600",
                              fontSize: "12px",
                            }}
                          >
                            <XCircle size={13} />
                            <span>Blocked</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "16px 20px", textAlign: "right" }}>
                        {c.is_active ? (
                          <button
                            onClick={() => handleToggleBlock(c)}
                            disabled={isBusy}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "6px 12px",
                              borderRadius: "6px",
                              border: "1px solid #fecaca",
                              backgroundColor: "#fff5f5",
                              color: "#dc2626",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: isBusy ? "not-allowed" : "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {isBusy ? (
                              <RefreshCw size={13} className="gv-spin" />
                            ) : (
                              <Ban size={13} />
                            )}
                            <span>Block User</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggleBlock(c)}
                            disabled={isBusy}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "6px 12px",
                              borderRadius: "6px",
                              border: "1px solid #bbf7d0",
                              backgroundColor: "#f0fdf4",
                              color: "#16a34a",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: isBusy ? "not-allowed" : "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {isBusy ? (
                              <RefreshCw size={13} className="gv-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                            <span>Unblock</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalCount > pageSize && (
          <div
            style={{
              padding: "14px 20px",
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "13px",
              color: "#6b7280",
            }}
          >
            <span>
              Showing Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => fetchCustomers(currentPage - 1, searchQuery, statusFilter)}
                disabled={currentPage <= 1 || loading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  fontSize: "12px",
                  fontWeight: "500",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                  color: currentPage <= 1 ? "#9ca3af" : "#374151",
                }}
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>
              <button
                onClick={() => fetchCustomers(currentPage + 1, searchQuery, statusFilter)}
                disabled={currentPage >= totalPages || loading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  fontSize: "12px",
                  fontWeight: "500",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                  color: currentPage >= totalPages ? "#9ca3af" : "#374151",
                }}
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
