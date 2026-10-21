import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Package,
  Layers,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  Plus,
  Boxes,
  IndianRupee,
  Eye,
  Edit2,
  ExternalLink,
} from "lucide-react";
import { getAdminDashboard } from "../../services/adminService";
import AdminProductModal from "../../components/admin/AdminProductModal";
import AdminProductDetailsModal from "../../components/admin/AdminProductDetailsModal";

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Quick modals from dashboard
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getAdminDashboard();
      setData(res);
    } catch (err) {
      setError("Failed to load dashboard metrics. Check server connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "350px", color: "#6b7280", gap: "10px" }}>
        <RefreshCw size={20} className="gv-spin" />
        <span>Loading store administration metrics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "20px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#b91c1c" }}>
        <p style={{ fontWeight: "600", marginBottom: "8px" }}>Error Loading Dashboard</p>
        <p style={{ fontSize: "14px", marginBottom: "12px" }}>{error}</p>
        <button
          onClick={fetchMetrics}
          style={{ padding: "8px 16px", backgroundColor: "#b91c1c", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}
        >
          Retry
        </button>
      </div>
    );
  }

  const kpis = [
    {
      label: "Registered Users",
      value: data?.customers ?? 0,
      icon: Users,
      bgColor: "#eff6ff",
      iconColor: "#2563eb",
      subtext: "Total registered patron accounts",
      link: "/admin/customers",
      linkLabel: "View customer directory",
    },
    {
      label: "Total Products",
      value: data?.products?.total ?? 0,
      icon: Package,
      bgColor: "#f0fdf4",
      iconColor: "#16a34a",
      subtext: `${data?.products?.active ?? 0} active in customer catalog`,
      link: "/admin/products",
      linkLabel: "Manage products",
    },
    {
      label: "Categories",
      value: data?.categories ?? 0,
      icon: Layers,
      bgColor: "#faf5ff",
      iconColor: "#9333ea",
      subtext: "Product classification tags",
      link: "/admin/products",
      linkLabel: "View catalog items",
    },
    {
      label: "Product Variants",
      value: data?.variants?.total ?? 0,
      icon: Boxes,
      bgColor: "#e0e7ff",
      iconColor: "#4f46e5",
      subtext: `${data?.variants?.active ?? 0} active pack sizes`,
      link: "/admin/products",
      linkLabel: "Review variants",
    },
    {
      label: "Low Stock Alert",
      value: data?.variants?.low_stock ?? 0,
      icon: AlertTriangle,
      bgColor: "#fffbeb",
      iconColor: "#d97706",
      subtext: `Stock ≤ ${data?.low_stock_threshold ?? 5} units`,
      link: "/admin/products",
      linkLabel: "Inspect inventory",
    },
  ];

  const recentProducts = data?.recent_products || [];

  return (
    <div>
      {/* Page Title & Quick Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111827", margin: 0 }}>
            Dashboard Overview
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Operational metrics, catalog health, inventory management, and user governance
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={fetchMetrics}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              backgroundColor: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => {
              setEditingProductId(null);
              setEditingProduct(null);
              setIsProductModalOpen(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              backgroundColor: "#15803d",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#ffffff",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(21, 128, 61, 0.2)",
            }}
          >
            <Plus size={15} />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "18px",
          marginBottom: "28px",
        }}
      >
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "12px",
                padding: "20px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#6b7280" }}>{kpi.label}</span>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "8px",
                      backgroundColor: kpi.bgColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: kpi.iconColor,
                    }}
                  >
                    <Icon size={18} />
                  </div>
                </div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827", lineHeight: "1" }}>
                  {kpi.value}
                </div>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>{kpi.subtext}</div>
              </div>

              {kpi.link && (
                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #f3f4f6" }}>
                  <Link
                    to={kpi.link}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#166534",
                    }}
                  >
                    <span>{kpi.linkLabel}</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Inventory Breakdown & Storefront Status Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "20px",
          marginBottom: "28px",
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Boxes size={18} color="#15803d" />
              <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", margin: 0 }}>
                Inventory & Stock Health
              </h2>
            </div>
            <Link to="/admin/products" style={{ fontSize: "12px", fontWeight: "600", color: "#166534" }}>
              Manage
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
              <span style={{ fontSize: "13px", color: "#4b5563" }}>Total Units in Stock</span>
              <span style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>
                {data?.inventory?.total_stock_units ?? 0}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
              <span style={{ fontSize: "13px", color: "#4b5563" }}>Active Catalog Products</span>
              <span style={{ fontSize: "15px", fontWeight: "700", color: "#15803d" }}>
                {data?.products?.active ?? 0} of {data?.products?.total ?? 0}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
              <span style={{ fontSize: "13px", color: "#4b5563" }}>Out of Stock Products</span>
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: (data?.inventory?.out_of_stock_products ?? 0) > 0 ? "#dc2626" : "#16a34a",
                }}
              >
                {data?.inventory?.out_of_stock_products ?? 0}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f9fafb", borderRadius: "8px" }}>
              <span style={{ fontSize: "13px", color: "#4b5563" }}>Low Stock Pack Variants</span>
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: (data?.variants?.low_stock ?? 0) > 0 ? "#d97706" : "#16a34a",
                }}
              >
                {data?.variants?.low_stock ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Governance & Security Posture */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "20px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Users size={18} color="#2563eb" />
              <h2 style={{ fontSize: "15px", fontWeight: "700", color: "#111827", margin: 0 }}>
                Customer Governance & Access
              </h2>
            </div>
            <p style={{ fontSize: "13px", color: "#6b7280", lineHeight: "1.5", marginBottom: "16px" }}>
              Review patron registrations, search profiles, and toggle active status. All administrative actions enforce server-side JWT admin scope checks and header validation.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              <span style={{ fontSize: "12px", backgroundColor: "#f0fdf4", color: "#166534", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", border: "1px solid #bbf7d0" }}>
                Total Patrons: {data?.customers ?? 0}
              </span>
              <span style={{ fontSize: "12px", backgroundColor: "#eff6ff", color: "#1e40af", padding: "4px 8px", borderRadius: "6px", fontWeight: "600", border: "1px solid #bfdbfe" }}>
                Admin Security Active
              </span>
            </div>
          </div>

          <Link
            to="/admin/customers"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "9px 16px",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              boxShadow: "0 2px 6px rgba(37, 99, 235, 0.2)",
            }}
          >
            <span>Open Customer Directory</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Recent Products Section */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          marginBottom: "28px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "18px 24px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#111827", margin: 0 }}>
              Recent Catalog Products
            </h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0" }}>
              Recently added or updated organic inventory items
            </p>
          </div>

          <Link
            to="/admin/products"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#166534",
            }}
          >
            <span>View All Products</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {recentProducts.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#6b7280" }}>
            <Package size={28} color="#9ca3af" style={{ margin: "0 auto 8px" }} />
            <p style={{ fontSize: "14px", margin: 0 }}>No products created yet.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
              <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <tr>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Product</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Category</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Price</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Stock</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Variants</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600" }}>Status</th>
                  <th style={{ padding: "10px 20px", color: "#4b5563", fontWeight: "600", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentProducts.map((p) => {
                  const stockNum = Number(p.stock_quantity) || 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "10px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "6px",
                              backgroundColor: "#f3f4f6",
                              overflow: "hidden",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            {p.primary_image ? (
                              <img src={p.primary_image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <Package size={16} color="#9ca3af" />
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: "600", color: "#111827" }}>{p.name}</div>
                            <div style={{ fontSize: "11px", color: "#9ca3af" }}>Unit: {p.unit || "unit"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "10px 20px" }}>
                        <span style={{ fontSize: "12px", color: "#166534", backgroundColor: "#f0fdf4", padding: "2px 8px", borderRadius: "6px", fontWeight: "600" }}>
                          {p.category_name || "Uncategorized"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px", fontWeight: "700", color: "#111827" }}>
                        ₹{Number(p.price).toFixed(2)}
                      </td>
                      <td style={{ padding: "10px 20px" }}>
                        <span
                          style={{
                            fontWeight: "600",
                            color: stockNum > 5 ? "#15803d" : stockNum > 0 ? "#d97706" : "#dc2626",
                          }}
                        >
                          {stockNum} {p.unit || ""}
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px" }}>
                        <span style={{ fontSize: "11px", color: "#4f46e5", backgroundColor: "#e0e7ff", padding: "2px 6px", borderRadius: "4px", fontWeight: "600" }}>
                          {p.variants_count} variant{p.variants_count !== 1 ? "s" : ""}
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "600",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: p.is_active ? "#f0fdf4" : "#fef2f2",
                            color: p.is_active ? "#15803d" : "#b91c1c",
                          }}
                        >
                          {p.is_active ? "Active" : "Hidden"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            onClick={() => setViewingProduct(p)}
                            title="Inspect Details"
                            style={{
                              padding: "5px",
                              backgroundColor: "#f9fafb",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              color: "#4b5563",
                              cursor: "pointer",
                            }}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingProductId(p.id);
                              setEditingProduct(p);
                              setIsProductModalOpen(true);
                            }}
                            title="Edit"
                            style={{
                              padding: "5px",
                              backgroundColor: "#f0fdf4",
                              border: "1px solid #bbf7d0",
                              borderRadius: "6px",
                              color: "#15803d",
                              cursor: "pointer",
                            }}
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Modal */}
      {isProductModalOpen && (
        <AdminProductModal
          isOpen={isProductModalOpen}
          productId={editingProductId}
          product={editingProduct}
          onClose={() => {
            setIsProductModalOpen(false);
            setEditingProductId(null);
            setEditingProduct(null);
          }}
          onSuccess={() => {
            fetchMetrics();
          }}
        />
      )}

      {/* Details Modal */}
      {viewingProduct && (
        <AdminProductDetailsModal
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onEdit={(prod) => {
            setEditingProductId(prod.id);
            setEditingProduct(prod);
            setIsProductModalOpen(true);
          }}
        />
      )}
    </div>
  );
}

