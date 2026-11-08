import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Package,
  Store,
  LogOut,
  ShieldCheck,
  ChevronRight,
  ShoppingBag,
  FolderTree,
  Menu,
  X,
} from "lucide-react";
import { adminLogout, getAdminUser } from "../../services/adminService";

export default function AdminLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const adminUser = getAdminUser() || { email: "admin@greenvillage.com", full_name: "Admin" };

  const handleLogout = async () => {
    await adminLogout();
    navigate("/admin/login", { replace: true });
  };

  const navItems = [
    {
      label: "Dashboard",
      path: "/admin/dashboard",
      alternatePath: "/admin",
      icon: LayoutDashboard,
    },
    {
      label: "Orders",
      path: "/admin/orders",
      icon: ShoppingBag,
    },
    {
      label: "Categories",
      path: "/admin/categories",
      icon: FolderTree,
    },
    {
      label: "Products",
      path: "/admin/products",
      icon: Package,
    },
    {
      label: "Customers",
      path: "/admin/customers",
      icon: Users,
    },
  ];

  const isCurrentActive = (item) => {
    return (
      location.pathname === item.path ||
      (item.alternatePath && location.pathname === item.alternatePath)
    );
  };

  const getHeaderTitle = () => {
    if (location.pathname.includes("/admin/orders")) return "Order Management";
    if (location.pathname.includes("/admin/categories")) return "Category Management";
    if (location.pathname.includes("/admin/products")) return "Product Management";
    if (location.pathname.includes("/admin/customers")) return "Customer Management";
    return "Dashboard Overview";
  };

  const renderNavLinks = () => (
    <>
      {/* Brand */}
      <div
        style={{
          padding: "24px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #15803d, #22c55e)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(34, 197, 94, 0.25)",
            }}
          >
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "-0.01em", color: "#f0fdf4" }}>
              Green Village
            </div>
            <div style={{ fontSize: "11px", color: "#86efac", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: "600" }}>
              Control Center
            </div>
          </div>
        </div>
        {mobileOpen && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "4px",
            }}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ padding: "20px 12px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ padding: "0 12px 8px 12px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280", fontWeight: "600" }}>
          Management
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isCurrentActive(item);
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: active ? "600" : "500",
                color: active ? "#ffffff" : "#9ca3af",
                backgroundColor: active ? "rgba(34, 197, 94, 0.18)" : "transparent",
                borderLeft: active ? "3px solid #22c55e" : "3px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              <Icon size={18} color={active ? "#4ade80" : "#9ca3af"} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {active && <ChevronRight size={14} color="#4ade80" />}
            </Link>
          );
        })}

        <div style={{ padding: "16px 12px 8px 12px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280", fontWeight: "600" }}>
          Storefront
        </div>
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "500",
            color: "#9ca3af",
            transition: "all 0.15s ease",
          }}
        >
          <Store size={18} color="#9ca3af" />
          <span>Customer Store</span>
        </Link>
      </nav>

      {/* Admin User & Logout */}
      <div
        style={{
          padding: "16px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          backgroundColor: "rgba(0, 0, 0, 0.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "#166534",
              color: "#bbf7d0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "600",
              fontSize: "13px",
            }}
          >
            {(adminUser.full_name || "A")[0].toUpperCase()}
          </div>
          <div style={{ overflow: "hidden", flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: "600", color: "#f3f4f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {adminUser.full_name || "Admin"}
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {adminUser.email}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "#fca5a5",
            fontSize: "13px",
            fontWeight: "500",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <LogOut size={15} />
          <span>Sign Out</span>
        </button>
      </div>
    </>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "#f8faf9", fontFamily: "var(--font-family)" }}>
      {/* Desktop Sidebar */}
      <aside
        style={{
          width: "260px",
          backgroundColor: "#0d2015",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          borderRight: "1px solid rgba(255, 255, 255, 0.08)",
        }}
        className="admin-desktop-sidebar"
      >
        {renderNavLinks()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 998,
          }}
        />
      )}
      {mobileOpen && (
        <aside
          style={{
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            width: "280px",
            backgroundColor: "#0d2015",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            zIndex: 999,
            boxShadow: "4px 0 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          {renderNavLinks()}
        </aside>
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto" }}>
        {/* Top Header */}
        <header
          style={{
            height: "64px",
            backgroundColor: "#ffffff",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "#6b7280" }}>
            <button
              onClick={() => setMobileOpen(true)}
              style={{
                display: "none",
                background: "none",
                border: "none",
                padding: "6px",
                borderRadius: "6px",
                color: "#374151",
                cursor: "pointer",
              }}
              className="admin-mobile-toggle-btn"
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>
            <span style={{ fontWeight: "500" }}>Administration</span>
            <ChevronRight size={14} />
            <span style={{ fontWeight: "600", color: "#111827" }}>
              {getHeaderTitle()}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "9999px",
                backgroundColor: "#f0fdf4",
                border: "1px solid #bbf7d0",
                fontSize: "12px",
                fontWeight: "500",
                color: "#166534",
              }}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#22c55e" }} />
              Live System
            </span>
          </div>
        </header>

        {/* Content Body */}
        <main style={{ padding: "28px", flex: 1 }}>{children}</main>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .admin-desktop-sidebar {
            display: none !important;
          }
          .admin-mobile-toggle-btn {
            display: inline-flex !important;
          }
        }
      `}</style>
    </div>
  );
}
