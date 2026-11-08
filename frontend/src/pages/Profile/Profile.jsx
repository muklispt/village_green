import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import { getProfile, updateProfile } from "../../services/profileService.js";
import { getMyOrders } from "../../services/orderService.js";
import { resolveImageUrl, formatPrice } from "../../services/productService.js";
import Input from "../../components/common/Input";
import Button from "../../components/common/Button";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import {
  UserRound,
  Home,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Mail,
  MapPin,
  Phone,
  Edit3,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Lock,
  Bell,
  Package,
  Layers,
  Sparkles,
  Check,
  Camera,
  Trash2,
  Upload,
  Link2,
  ShoppingBag,
  CreditCard,
  Banknote,
  ArrowLeft,
  ArrowRight,
  Eye,
  Clock,
  Loader2,
} from "lucide-react";

/* ── Order Display Helpers ── */
function orderStatusLabel(status) {
  const MAP = {
    pending: "Pending",
    confirmed: "Confirmed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    failed: "Failed",
  };
  return MAP[status] || status;
}

function orderStatusBadgeClass(status) {
  const MAP = {
    pending: "gv-status-badge--pending",
    confirmed: "gv-status-badge--confirmed",
    processing: "gv-status-badge--processing",
    shipped: "gv-status-badge--shipped",
    delivered: "gv-status-badge--delivered",
    cancelled: "gv-status-badge--cancelled",
    failed: "gv-status-badge--failed",
  };
  return MAP[status] || "gv-status-badge--pending";
}

function paymentStatusLabel(status) {
  const MAP = {
    pending: "Payment Pending",
    paid: "Paid",
    failed: "Payment Failed",
    cancelled: "Payment Cancelled",
    refunded: "Refunded",
  };
  return MAP[status] || (status || "");
}

function paymentStatusBadgeClass(status) {
  const MAP = {
    pending: "gv-payment-status-badge--pending",
    paid: "gv-payment-status-badge--paid",
    failed: "gv-payment-status-badge--failed",
    cancelled: "gv-payment-status-badge--cancelled",
  };
  return MAP[status] || "gv-payment-status-badge--pending";
}

function formatDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Curated high-resolution organic portraits for instant selection
const CURATED_AVATARS = [
  {
    id: "farmer",
    label: "Organic Farmer",
    role: "Cultivator",
    url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80",
  },
  {
    id: "harvester",
    label: "Botanical Harvester",
    role: "Harvest Lead",
    url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=256&q=80",
  },
  {
    id: "patron",
    label: "Village Patron",
    role: "Patron Member",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
  },
  {
    id: "steward",
    label: "Green Steward",
    role: "Ecologist",
    url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80",
  },
  {
    id: "grower",
    label: "Estate Grower",
    role: "Organic Lead",
    url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80",
  },
  {
    id: "gardener",
    label: "Urban Gardener",
    role: "Permaculturist",
    url: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=256&q=80",
  },
];

export default function Profile() {
  const { user, isAuthenticated, isInitializing, logout, updateUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const VALID_TABS = useMemo(() => ["all", "orders", "personal", "addresses", "preferences", "security"], []);
  const urlTab = searchParams.get("tab");
  const [activeTab, setActiveTabState] = useState(
    VALID_TABS.includes(urlTab) ? urlTab : "all"
  );

  const setActiveTab = useCallback((newTab) => {
    setActiveTabState(newTab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === "all") {
        next.delete("tab");
      } else {
        next.set("tab", newTab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams, VALID_TABS, activeTab]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [personalEditing, setPersonalEditing] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  // Customer Orders state
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersTotalCount, setOrdersTotalCount] = useState(0);

  const fetchCustomerOrders = useCallback(async (page = 1) => {
    try {
      setOrdersLoading(true);
      setOrdersError("");
      const data = await getMyOrders({ page });
      if (Array.isArray(data)) {
        setOrders(data);
        setOrdersTotalPages(1);
        setOrdersTotalCount(data.length);
      } else {
        setOrders(data.results || []);
        const count = data.count || 0;
        const perPage = (data.results && data.results.length > 0) ? data.results.length : 10;
        const pages = count ? Math.ceil(count / (perPage || 10)) : 1;
        setOrdersTotalPages(pages);
        setOrdersTotalCount(count);
      }
    } catch (err) {
      console.error("Failed to fetch customer orders:", err);
      setOrdersError(
        err?.response?.data?.detail || "Could not load your orders. Please try again."
      );
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && (activeTab === "orders" || activeTab === "all")) {
      fetchCustomerOrders(ordersPage);
    }
  }, [isAuthenticated, activeTab, ordersPage, fetchCustomerOrders]);

  // Change Photo Modal state
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoInputUrl, setPhotoInputUrl] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoSourceTab, setPhotoSourceTab] = useState("presets"); // 'presets' | 'url' | 'upload'

  // Personal form state
  const [personalForm, setPersonalForm] = useState({
    full_name: "",
    phone: "",
  });

  // Address form state
  const [addressForm, setAddressForm] = useState({
    address: "",
    city: "",
    pincode: "",
  });

  // Client preferences state
  const [preferences, setPreferences] = useState({
    deliveryUpdates: true,
    harvestAlerts: true,
    ecoPackaging: true,
  });

  // Fetch the authenticated user's profile once session initialization is complete
  const loadProfile = async () => {
    if (isInitializing || !isAuthenticated) return;

    setLoading(true);
    setError("");

    try {
      const res = await getProfile();
      const data = res?.data || {};
      setProfile(data);
      setPersonalForm({
        full_name: data.full_name || "",
        phone: data.phone || "",
      });
      setAddressForm({
        address: data.address || "",
        city: data.city || "",
        pincode: data.pincode || "",
      });
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        "Failed to load profile. Please verify your connection and session."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [isAuthenticated, isInitializing]);

  const handlePersonalChange = (e) => {
    const { name, value } = e.target;
    setPersonalForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddressChange = (e) => {
    const { name, value } = e.target;
    setAddressForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSavePersonal = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const payload = {
        full_name: personalForm.full_name,
        phone: personalForm.phone,
        address: profile?.address || "",
        city: profile?.city || "",
        pincode: profile?.pincode || "",
        profileImage: profile?.profileImage || null,
      };
      const res = await updateProfile(payload);
      const updated = res?.data || {};
      setProfile(updated);
      if (updateUser) {
        updateUser(updated);
      }
      setSuccessMessage("Personal details updated successfully.");
      setPersonalEditing(false);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.phone?.[0] ||
        err.response?.data?.message ||
        "Failed to update personal details. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAddress = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const payload = {
        full_name: profile?.full_name || personalForm.full_name,
        phone: profile?.phone || personalForm.phone,
        address: addressForm.address,
        city: addressForm.city,
        pincode: addressForm.pincode,
        profileImage: profile?.profileImage || null,
      };
      const res = await updateProfile(payload);
      const updated = res?.data || {};
      setProfile(updated);
      if (updateUser) {
        updateUser(updated);
      }
      setSuccessMessage("Delivery address updated successfully.");
      setAddressEditing(false);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        "Failed to update delivery address. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  // Photo change handlers
  const openPhotoModal = () => {
    const current = profile?.profileImage || user?.profileImage || "";
    setPhotoInputUrl(current);
    setPhotoPreviewUrl(current);
    setPreviewError(false);
    setPhotoError("");
    setPhotoSourceTab(current ? "url" : "presets");
    setPhotoModalOpen(true);
  };

  const closePhotoModal = () => {
    if (savingPhoto) return;
    setPhotoModalOpen(false);
    setPhotoError("");
    setPreviewError(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && photoModalOpen) {
        closePhotoModal();
      }
    };
    if (photoModalOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [photoModalOpen, savingPhoto]);

  const handleSavePhoto = async (overrideUrl) => {
    const targetUrl = overrideUrl !== undefined ? overrideUrl : photoInputUrl;
    const cleanUrl = targetUrl ? targetUrl.trim() : "";

    // If clearing / removing photo
    if (!cleanUrl) {
      setSavingPhoto(true);
      setPhotoError("");
      try {
        const payload = {
          full_name: profile?.full_name || personalForm.full_name,
          phone: profile?.phone || personalForm.phone,
          address: profile?.address || "",
          city: profile?.city || "",
          pincode: profile?.pincode || "",
          profileImage: null,
        };
        const res = await updateProfile(payload);
        const updated = res?.data || {};

        setProfile((prev) => ({
          ...prev,
          ...updated,
          profileImage: null,
        }));

        if (updateUser) {
          updateUser({
            profileImage: null,
          });
        }

        setSuccessMessage("Profile photo removed successfully.");
        setPhotoModalOpen(false);
      } catch (err) {
        setPhotoError(
          err.response?.data?.detail ||
          err.response?.data?.message ||
          "Failed to remove profile photo. Please try again."
        );
      } finally {
        setSavingPhoto(false);
      }
      return;
    }

    if (cleanUrl.startsWith("data:")) {
      setPhotoError(
        "Direct HTTPS image links are required for cloud sync across devices. Please paste an HTTPS image URL or choose a curated avatar."
      );
      return;
    }

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      setPhotoError("Please provide a valid web URL starting with https:// or http://");
      return;
    }

    setSavingPhoto(true);
    setPhotoError("");

    try {
      const payload = {
        full_name: profile?.full_name || personalForm.full_name,
        phone: profile?.phone || personalForm.phone,
        address: profile?.address || "",
        city: profile?.city || "",
        pincode: profile?.pincode || "",
        profileImage: cleanUrl,
      };

      const res = await updateProfile(payload);
      const updated = res?.data || {};
      const finalImage =
        updated.profileImage !== undefined ? updated.profileImage : cleanUrl;

      setProfile((prev) => ({
        ...prev,
        ...updated,
        profileImage: finalImage,
      }));

      if (updateUser) {
        updateUser({
          profileImage: finalImage,
        });
      }

      setSuccessMessage("Profile photo updated successfully!");
      setPhotoModalOpen(false);
    } catch (err) {
      const backendErr =
        err.response?.data?.profileImage?.[0] ||
        err.response?.data?.detail ||
        err.response?.data?.message;
      setPhotoError(
        backendErr || "Failed to update profile photo. Please verify the URL."
      );
    } finally {
      setSavingPhoto(false);
    }
  };

  const togglePreference = (key) => {
    setPreferences((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setSuccessMessage(`Updated preference setting.`);
      setTimeout(() => setSuccessMessage(""), 3000);
      return next;
    });
  };

  // Compute initials fallback
  const initials = useMemo(() => {
    const target = profile || user;
    if (!target) return "U";
    const name =
      target.full_name ||
      (typeof target === "string" ? target : "") ||
      "";

    if (name && typeof name === "string" && name.trim()) {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      if (parts.length === 1 && parts[0].length > 0) {
        return parts[0].slice(0, Math.min(2, parts[0].length)).toUpperCase();
      }
    }

    if (target.email && typeof target.email === "string") {
      const prefix = target.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      if (prefix.length > 0) {
        return prefix.slice(0, Math.min(2, prefix.length)).toUpperCase();
      }
    }

    return "U";
  }, [profile, user]);

  const memberSince = useMemo(() => {
    if (!profile?.created_at) return "Active Member";
    try {
      const date = new Date(profile.created_at);
      return date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    } catch {
      return "Active Member";
    }
  }, [profile?.created_at]);

  const hasSavedAddress = Boolean(
    profile?.address || profile?.city || profile?.pincode
  );

  return (
    <div className="gv-page-wrapper gv-account-dashboard">
      <Navbar />

      <main className="gv-main-content">
        {/* Breadcrumb Navigation */}
        <div className="gv-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/" className="gv-breadcrumb-link">
            <Home size={14} />
            <span>Home</span>
          </Link>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <span>Account</span>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <strong className="gv-breadcrumb-active">Profile &amp; Addresses</strong>
        </div>

        {/* Page Top Heading & Subtitle */}
        <header className="gv-dashboard-header">
          <div className="gv-dashboard-title-group">
            <h1 className="gv-dashboard-title">Account Settings &amp; Profile</h1>
            <p className="gv-dashboard-subtitle">
              Manage your personal details, delivery addresses, and account preferences.
            </p>
          </div>

          <div className="gv-dashboard-header-badges">
            <span className="gv-badge-pill gv-badge-verified">
              <ShieldCheck size={14} />
              <span>Verified Patron</span>
            </span>
            <span className="gv-badge-pill gv-badge-role">
              <Sparkles size={14} />
              <span>{profile?.role || user?.role || "Customer"}</span>
            </span>
            <span className="gv-badge-pill gv-badge-date">
              <Calendar size={14} />
              <span>Member since {memberSince}</span>
            </span>
          </div>
        </header>

        {loading ? (
          <div className="gv-auth-card-centered">
            <div className="gv-profile-card gv-profile-loading-box">
              <div className="gv-spinner" />
              <p>Loading your patron profile and addresses…</p>
            </div>
          </div>
        ) : error && !profile ? (
          <div className="gv-auth-card-centered">
            <div className="gv-profile-card">
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
              <div className="gv-profile-actions-bar" style={{ marginTop: 16 }}>
                <Button variant="primary" onClick={loadProfile} icon={<RefreshCw size={15} />}>
                  Retry Loading
                </Button>
                <Button variant="outline" onClick={logout} icon={<LogOut size={15} />}>
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="gv-dashboard-layout">
            {/* =========================================================
                LEFT SIDEBAR (User Summary & Navigation)
                ========================================================= */}
            <aside className="gv-dashboard-sidebar">
              {/* User Summary Card */}
              <div className="gv-dashboard-card gv-user-summary-card">
                <div className="gv-user-summary-avatar-wrap">
                  <div
                    className="gv-user-summary-avatar gv-avatar-interactive"
                    onClick={openPhotoModal}
                    role="button"
                    tabIndex={0}
                    aria-label="Change profile photo"
                    title="Click to change profile photo"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openPhotoModal();
                      }
                    }}
                  >
                    {profile?.profileImage ? (
                      <img
                        src={profile.profileImage}
                        alt={profile.full_name || "Profile avatar"}
                        className="gv-avatar-img"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="gv-user-summary-initials">{initials}</span>
                    )}
                    <div className="gv-avatar-hover-overlay" aria-hidden="true">
                      <Camera size={20} />
                      <span className="gv-avatar-hover-text">Update</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="gv-avatar-upload-btn"
                    onClick={openPhotoModal}
                    aria-label="Change profile photo"
                    title="Change profile photo"
                  >
                    <Camera size={13} />
                  </button>
                  <span className="gv-avatar-online-dot" title="Active session" />
                </div>

                <button
                  type="button"
                  className="gv-avatar-change-link"
                  onClick={openPhotoModal}
                  aria-label="Change profile photo"
                >
                  <Camera size={13} />
                  <span>Change Photo</span>
                </button>

                <div className="gv-user-summary-info">
                  <h2 className="gv-user-summary-name">
                    {profile?.full_name || user?.full_name || "Patron"}
                  </h2>
                  <p className="gv-user-summary-email" title={profile?.email || user?.email}>
                    <Mail size={13} />
                    <span>{profile?.email || user?.email}</span>
                  </p>
                  {profile?.phone && (
                    <p className="gv-user-summary-phone">
                      <Phone size={13} />
                      <span>{profile.phone}</span>
                    </p>
                  )}
                  <div className="gv-user-summary-meta-badges">
                    <span className="gv-role-tag">
                      {profile?.role || user?.role || "Customer"}
                    </span>
                    <span className="gv-active-status-badge">Active</span>
                  </div>
                </div>
              </div>

              {/* Account Navigation Card */}
              <nav className="gv-dashboard-card gv-nav-card" aria-label="Account navigation">
                <h3 className="gv-nav-card-heading">Navigation</h3>
                <ul className="gv-nav-list">
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "all" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("all")}
                    >
                      <Layers size={17} className="gv-nav-item-icon" />
                      <span>Overview &amp; All</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "orders" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("orders")}
                    >
                      <ShoppingBag size={17} className="gv-nav-item-icon" />
                      <span>My Orders</span>
                      {ordersTotalCount > 0 && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "999px",
                            backgroundColor: activeTab === "orders" ? "#166534" : "#e5e7eb",
                            color: activeTab === "orders" ? "#ffffff" : "#374151",
                            fontWeight: 600,
                          }}
                        >
                          {ordersTotalCount}
                        </span>
                      )}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "personal" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("personal")}
                    >
                      <UserRound size={17} className="gv-nav-item-icon" />
                      <span>Personal Information</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "addresses" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("addresses")}
                    >
                      <MapPin size={17} className="gv-nav-item-icon" />
                      <span>Delivery Addresses</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "preferences" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("preferences")}
                    >
                      <Bell size={17} className="gv-nav-item-icon" />
                      <span>Account Preferences</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`gv-nav-item ${activeTab === "security" ? "is-active" : ""}`}
                      onClick={() => setActiveTab("security")}
                    >
                      <Lock size={17} className="gv-nav-item-icon" />
                      <span>Security &amp; Login</span>
                    </button>
                  </li>
                </ul>

                {/* Sidebar Sign Out Action */}
                <div className="gv-sidebar-logout-wrap">
                  <button
                    type="button"
                    className="gv-sidebar-logout-btn"
                    onClick={logout}
                    aria-label="Sign out of account"
                  >
                    <LogOut size={16} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </nav>
            </aside>

            {/* =========================================================
                MAIN CONTENT PANELS
                ========================================================= */}
            <section className="gv-dashboard-main">
              {/* Notifications */}
              {successMessage && (
                <div className="gv-alert gv-alert--success" role="status">
                  <CheckCircle2 size={18} />
                  <span>{successMessage}</span>
                </div>
              )}

              {error && (
                <div className="gv-alert gv-alert--error" role="alert">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {/* SECTION: MY ORDERS (FULL VIEW) */}
              {activeTab === "orders" && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <h2 className="gv-card-title">My Orders</h2>
                      <p className="gv-card-subtitle">
                        Track deliveries, view order invoices, and review your farm-fresh purchase history.
                      </p>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fetchCustomerOrders(ordersPage)}
                      disabled={ordersLoading}
                      icon={<RefreshCw size={14} className={ordersLoading ? "gv-spin" : ""} />}
                    >
                      Refresh
                    </Button>
                  </header>

                  {/* Orders Loading State */}
                  {ordersLoading && (
                    <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                      <Loader2 size={36} className="gv-spin" style={{ color: "#08712f", margin: "0 auto 1rem" }} />
                      <p style={{ color: "#6b7280", fontSize: "0.95rem" }}>Loading your orders...</p>
                    </div>
                  )}

                  {/* Orders Error State */}
                  {!ordersLoading && ordersError && (
                    <div className="gv-alert gv-alert--error" style={{ marginBottom: "1.5rem" }} role="alert">
                      <AlertCircle size={18} />
                      <span style={{ flex: 1 }}>{ordersError}</span>
                      <button
                        type="button"
                        onClick={() => fetchCustomerOrders(ordersPage)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          fontWeight: 700,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Empty State */}
                  {!ordersLoading && !ordersError && orders.length === 0 && (
                    <div className="gv-empty-state-card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
                      <ShoppingBag size={52} className="gv-icon-muted" style={{ margin: "0 auto 1.25rem", color: "#9ca3af" }} />
                      <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#111", marginBottom: "0.5rem" }}>
                        You haven't placed any orders yet.
                      </h3>
                      <p style={{ fontSize: "0.9rem", color: "#6b7280", maxWidth: "420px", margin: "0 auto 1.5rem", lineHeight: 1.5 }}>
                        Your order history will appear here once you place your first order.
                      </p>
                      <Link
                        to="/products"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          background: "#08712f",
                          color: "#ffffff",
                          padding: "0.75rem 1.5rem",
                          borderRadius: "10px",
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          textDecoration: "none",
                          boxShadow: "0 2px 8px rgba(8,113,47,0.2)",
                        }}
                      >
                        <ShoppingBag size={18} /> Start Shopping
                      </Link>
                    </div>
                  )}

                  {/* Orders List */}
                  {!ordersLoading && !ordersError && orders.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                      {orders.map((ord) => (
                        <div
                          key={ord.id}
                          style={{
                            background: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "14px",
                            padding: "1.25rem",
                            transition: "all 0.2s ease",
                            display: "flex",
                            flexDirection: "column",
                            gap: "1rem",
                          }}
                        >
                          {/* Order Card Top Bar */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              flexWrap: "wrap",
                              gap: "0.75rem",
                              borderBottom: "1px solid #f3f4f6",
                              paddingBottom: "0.75rem",
                            }}
                          >
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                                <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#111827", fontFamily: "monospace" }}>
                                  #{ord.order_number}
                                </span>
                                <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                                  Placed on {formatDateShort(ord.created_at)}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                              <span className={`gv-status-badge ${orderStatusBadgeClass(ord.status)}`}>
                                {orderStatusLabel(ord.status)}
                              </span>
                              {ord.payment_status && (
                                <span className={`gv-payment-status-badge ${paymentStatusBadgeClass(ord.payment_status)}`}>
                                  {paymentStatusLabel(ord.payment_status)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Order Card Content Bar */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                              gap: "1rem",
                            }}
                          >
                            {/* Product Thumbnail & Meta */}
                            <div style={{ display: "flex", alignItems: "center", gap: "1rem", minWidth: 0 }}>
                              <div
                                style={{
                                  width: "56px",
                                  height: "56px",
                                  borderRadius: "10px",
                                  overflow: "hidden",
                                  background: "#f9fafb",
                                  border: "1px solid #e5e7eb",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {ord.product_image ? (
                                  <img
                                    src={resolveImageUrl(ord.product_image)}
                                    alt={`Order ${ord.order_number}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    onError={(e) => {
                                      e.target.style.display = "none";
                                      if (e.target.nextSibling) e.target.nextSibling.style.display = "block";
                                    }}
                                  />
                                ) : null}
                                <ShoppingBag
                                  size={22}
                                  style={{
                                    color: "#9ca3af",
                                    display: ord.product_image ? "none" : "block",
                                  }}
                                />
                              </div>

                              <div>
                                <div style={{ fontSize: "0.85rem", color: "#374151", fontWeight: 600 }}>
                                  {ord.item_count != null
                                    ? `${ord.item_count} item${ord.item_count !== 1 ? "s" : ""}`
                                    : "Items ordered"}
                                </div>
                                <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                  {ord.payment_method === "online" ? <CreditCard size={13} /> : <Banknote size={13} />}
                                  <span>{ord.payment_method === "online" ? "Online Payment" : "Cash on Delivery"}</span>
                                </div>
                              </div>
                            </div>

                            {/* Total Amount & Action */}
                            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginLeft: "auto" }}>
                              <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: "0.75rem", color: "#6b7280", display: "block" }}>Total</span>
                                <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#111827" }}>
                                  {formatPrice(ord.total_amount)}
                                </span>
                              </div>

                              <Link
                                to={`/orders/${ord.id}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.4rem",
                                  padding: "0.55rem 1rem",
                                  borderRadius: "8px",
                                  border: "1.5px solid #d1d5db",
                                  background: "#ffffff",
                                  color: "#111827",
                                  fontWeight: 600,
                                  fontSize: "0.85rem",
                                  textDecoration: "none",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Eye size={15} />
                                <span>View Details</span>
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Pagination Controls */}
                      {ordersTotalPages > 1 && (
                        <div className="gv-pagination" style={{ marginTop: "1rem" }}>
                          <button
                            type="button"
                            className="gv-pagination-btn"
                            onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                            disabled={ordersPage <= 1}
                          >
                            <ArrowLeft size={15} /> Previous
                          </button>
                          <span className="gv-pagination-info">
                            Page {ordersPage} of {ordersTotalPages}
                          </span>
                          <button
                            type="button"
                            className="gv-pagination-btn"
                            onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                            disabled={ordersPage >= ordersTotalPages}
                          >
                            Next <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )}

              {/* RECENT ORDERS OVERVIEW PREVIEW */}
              {activeTab === "all" && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <h2 className="gv-card-title">Recent Orders</h2>
                      <p className="gv-card-subtitle">
                        Your latest purchases and farm deliveries.
                      </p>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveTab("orders")}
                      icon={<ChevronRight size={14} />}
                    >
                      View All Orders {ordersTotalCount > 0 ? `(${ordersTotalCount})` : ""}
                    </Button>
                  </header>

                  {ordersLoading ? (
                    <div style={{ textAlign: "center", padding: "1.5rem" }}>
                      <Loader2 size={24} className="gv-spin" style={{ color: "#08712f", margin: "0 auto" }} />
                    </div>
                  ) : orders.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "1.5rem", color: "#6b7280" }}>
                      <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem" }}>You haven't placed any orders yet.</p>
                      <Link to="/products" className="gv-text-link">Explore Organic Harvest</Link>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {orders.slice(0, 3).map((ord) => (
                        <div
                          key={ord.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "0.75rem",
                            padding: "0.75rem 1rem",
                            background: "#f9fafb",
                            borderRadius: "10px",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "0.85rem" }}>
                              #{ord.order_number}
                            </span>
                            <span className={`gv-status-badge ${orderStatusBadgeClass(ord.status)}`} style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}>
                              {orderStatusLabel(ord.status)}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                              {formatPrice(ord.total_amount)}
                            </span>
                            <Link to={`/orders/${ord.id}`} className="gv-text-link" style={{ fontSize: "0.8rem" }}>
                              Details
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              )}

              {/* SECTION 1: PERSONAL INFORMATION */}
              {(activeTab === "all" || activeTab === "personal") && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <h2 className="gv-card-title">Personal Details</h2>
                      <p className="gv-card-subtitle">
                        Your identity and primary contact information for Green Village.
                      </p>
                    </div>

                    {!personalEditing ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPersonalEditing(true)}
                        icon={<Edit3 size={14} />}
                      >
                        Edit Details
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPersonalEditing(false);
                          setError("");
                        }}
                        icon={<X size={14} />}
                      >
                        Cancel
                      </Button>
                    )}
                  </header>

                  {!personalEditing ? (
                    /* Read-Only Details Grid */
                    <div className="gv-details-grid">
                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Full Name</span>
                        <div className="gv-detail-value">
                          <UserRound size={16} className="gv-detail-icon" />
                          <span>{profile?.full_name || "—"}</span>
                        </div>
                      </div>

                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Email Address</span>
                        <div className="gv-detail-value">
                          <Mail size={16} className="gv-detail-icon" />
                          <span>{profile?.email || "—"}</span>
                          <span className="gv-verified-tag">
                            <Check size={12} /> Verified
                          </span>
                        </div>
                      </div>

                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Contact Phone</span>
                        <div className="gv-detail-value">
                          <Phone size={16} className="gv-detail-icon" />
                          <span>{profile?.phone || "No phone added"}</span>
                        </div>
                      </div>

                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Patron Role</span>
                        <div className="gv-detail-value">
                          <Sparkles size={16} className="gv-detail-icon" />
                          <span>{profile?.role || "Customer"}</span>
                        </div>
                      </div>

                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Member Since</span>
                        <div className="gv-detail-value">
                          <Calendar size={16} className="gv-detail-icon" />
                          <span>{memberSince}</span>
                        </div>
                      </div>

                      <div className="gv-detail-item">
                        <span className="gv-detail-label">Verification Status</span>
                        <div className="gv-detail-value">
                          <ShieldCheck size={16} className="gv-detail-icon gv-text-primary" />
                          <span className="gv-text-primary">Email &amp; Account Verified</span>
                        </div>
                      </div>

                      <div className="gv-detail-item gv-detail-item--photo">
                        <span className="gv-detail-label">Profile Photo</span>
                        <div className="gv-detail-value gv-detail-value--photo">
                          <div className="gv-detail-avatar-thumb">
                            {profile?.profileImage ? (
                              <img
                                src={profile.profileImage}
                                alt="Current avatar"
                                className="gv-avatar-img"
                              />
                            ) : (
                              <span>{initials}</span>
                            )}
                          </div>
                          <div className="gv-detail-photo-meta">
                            <span className="gv-photo-status">
                              {profile?.profileImage ? "Custom photo set" : "Initials avatar"}
                            </span>
                            <button
                              type="button"
                              className="gv-photo-quick-btn"
                              onClick={openPhotoModal}
                              aria-label="Change profile photo"
                            >
                              <Camera size={13} />
                              <span>{profile?.profileImage ? "Change Photo" : "Add Photo"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Personal Details Edit Form */
                    <form onSubmit={handleSavePersonal} className="gv-card-form" noValidate>
                      <div className="gv-form-grid-2">
                        <Input
                          label="Full Name"
                          id="full_name"
                          name="full_name"
                          value={personalForm.full_name}
                          onChange={handlePersonalChange}
                          disabled={saving}
                          placeholder="Enter your full name"
                          required
                          icon={<UserRound size={16} />}
                        />

                        <Input
                          label="Email Address"
                          id="email"
                          name="email"
                          value={profile?.email || ""}
                          disabled={true}
                          icon={<Mail size={16} />}
                          hint="Email address is permanently verified for this account"
                        />
                      </div>

                      <div className="gv-form-grid-2">
                        <Input
                          label="Contact Phone"
                          id="phone"
                          name="phone"
                          value={personalForm.phone}
                          onChange={handlePersonalChange}
                          disabled={saving}
                          placeholder="e.g. +91 98765 43210"
                          icon={<Phone size={16} />}
                          hint="Used exclusively for delivery dispatch alerts"
                        />
                      </div>

                      <div className="gv-card-form-actions">
                        <Button
                          type="submit"
                          variant="primary"
                          icon={<Check size={16} />}
                          loading={saving ? "Saving Changes…" : false}
                          disabled={saving}
                        >
                          Save Changes
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          icon={<X size={15} />}
                          onClick={() => setPersonalEditing(false)}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              )}

              {/* SECTION 2: DELIVERY ADDRESSES */}
              {(activeTab === "all" || activeTab === "addresses") && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <div className="gv-card-title-row">
                        <h2 className="gv-card-title">Delivery Addresses</h2>
                        <span className="gv-count-pill">
                          {hasSavedAddress ? "1 Saved Address" : "No Address Saved"}
                        </span>
                      </div>
                      <p className="gv-card-subtitle">
                        Default address used for organic farm harvest doorstep deliveries.
                      </p>
                    </div>

                    {!addressEditing ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAddressEditing(true)}
                        icon={<Edit3 size={14} />}
                      >
                        {hasSavedAddress ? "Edit Address" : "Add Address"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAddressEditing(false);
                          setError("");
                        }}
                        icon={<X size={14} />}
                      >
                        Cancel
                      </Button>
                    )}
                  </header>

                  {!addressEditing ? (
                    <div className="gv-address-cards-wrap">
                      {hasSavedAddress ? (
                        <div className="gv-address-box is-default">
                          <div className="gv-address-box-header">
                            <div className="gv-address-type">
                              <MapPin size={17} className="gv-address-type-icon" />
                              <strong>Primary Delivery Destination</strong>
                            </div>
                            <span className="gv-default-badge">
                              <Check size={12} /> Default
                            </span>
                          </div>

                          <div className="gv-address-box-body">
                            <p className="gv-address-recipient">
                              {profile?.full_name || user?.full_name || "Valued Patron"}
                            </p>
                            <p className="gv-address-street">
                              {profile?.address || "Street address pending"}
                            </p>
                            <p className="gv-address-locality">
                              {[profile?.city, profile?.pincode].filter(Boolean).join(" — ") ||
                                "City and postal pincode"}
                            </p>
                            {profile?.phone && (
                              <p className="gv-address-contact">
                                <Phone size={13} />
                                <span>{profile.phone}</span>
                              </p>
                            )}
                          </div>

                          <div className="gv-address-box-footer">
                            <button
                              type="button"
                              className="gv-address-link-btn"
                              onClick={() => setAddressEditing(true)}
                            >
                              <Edit3 size={14} />
                              <span>Update Address Details</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="gv-address-empty-state">
                          <MapPin size={36} className="gv-address-empty-icon" />
                          <h3>No delivery address saved yet</h3>
                          <p>
                            Add your home or farm pick-up location to receive automated fresh deliveries.
                          </p>
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<MapPin size={14} />}
                            onClick={() => setAddressEditing(true)}
                            style={{ marginTop: 12 }}
                          >
                            Set Delivery Address
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Address Edit Form */
                    <form onSubmit={handleSaveAddress} className="gv-card-form" noValidate>
                      <div className="gv-form-grid-1">
                        <Input
                          label="Street Address / Residence"
                          id="address"
                          name="address"
                          value={addressForm.address}
                          onChange={handleAddressChange}
                          disabled={saving}
                          placeholder="Apartment, suite, street name and number"
                          required
                          icon={<MapPin size={16} />}
                        />
                      </div>

                      <div className="gv-form-grid-2">
                        <Input
                          label="City / Region"
                          id="city"
                          name="city"
                          value={addressForm.city}
                          onChange={handleAddressChange}
                          disabled={saving}
                          placeholder="e.g. Bangalore, Karnataka"
                          required
                        />

                        <Input
                          label="Postal Pincode"
                          id="pincode"
                          name="pincode"
                          value={addressForm.pincode}
                          onChange={handleAddressChange}
                          disabled={saving}
                          placeholder="e.g. 560001"
                          required
                        />
                      </div>

                      <div className="gv-card-form-actions">
                        <Button
                          type="submit"
                          variant="primary"
                          icon={<Check size={16} />}
                          loading={saving ? "Saving Address…" : false}
                          disabled={saving}
                        >
                          Save Address
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          icon={<X size={15} />}
                          onClick={() => setAddressEditing(false)}
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              )}

              {/* SECTION 3: ACCOUNT PREFERENCES */}
              {(activeTab === "all" || activeTab === "preferences") && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <h2 className="gv-card-title">Account Preferences</h2>
                      <p className="gv-card-subtitle">
                        Fine-tune your notifications and sustainable delivery options.
                      </p>
                    </div>
                  </header>

                  <div className="gv-preferences-list">
                    <div className="gv-preference-row">
                      <div className="gv-preference-info">
                        <div className="gv-preference-heading">
                          <Bell size={16} className="gv-preference-icon" />
                          <strong>Delivery Dispatch Notifications</strong>
                        </div>
                        <p>Receive SMS and email dispatch updates for dawn-to-doorstep drops.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.deliveryUpdates}
                        className={`gv-toggle-switch ${preferences.deliveryUpdates ? "is-on" : ""}`}
                        onClick={() => togglePreference("deliveryUpdates")}
                      >
                        <span className="gv-toggle-handle" />
                      </button>
                    </div>

                    <div className="gv-preference-row">
                      <div className="gv-preference-info">
                        <div className="gv-preference-heading">
                          <Package size={16} className="gv-preference-icon" />
                          <strong>Seasonal Harvest Availability Alerts</strong>
                        </div>
                        <p>Get notified when fresh seasonal produce arrives from partner family farms.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.harvestAlerts}
                        className={`gv-toggle-switch ${preferences.harvestAlerts ? "is-on" : ""}`}
                        onClick={() => togglePreference("harvestAlerts")}
                      >
                        <span className="gv-toggle-handle" />
                      </button>
                    </div>

                    <div className="gv-preference-row">
                      <div className="gv-preference-info">
                        <div className="gv-preference-heading">
                          <ShieldCheck size={16} className="gv-preference-icon" />
                          <strong>Zero-Waste Reusable Cold Totes</strong>
                        </div>
                        <p>Default deliveries in sanitized, reusable insulated fabric tote bags.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.ecoPackaging}
                        className={`gv-toggle-switch ${preferences.ecoPackaging ? "is-on" : ""}`}
                        onClick={() => togglePreference("ecoPackaging")}
                      >
                        <span className="gv-toggle-handle" />
                      </button>
                    </div>
                  </div>
                </article>
              )}

              {/* SECTION 4: SECURITY & LOGIN */}
              {(activeTab === "all" || activeTab === "security") && (
                <article className="gv-dashboard-card gv-content-card">
                  <header className="gv-card-header">
                    <div>
                      <h2 className="gv-card-title">Security &amp; Login</h2>
                      <p className="gv-card-subtitle">
                        Authentication safeguards and password settings for your account.
                      </p>
                    </div>
                  </header>

                  <div className="gv-security-grid">
                    <div className="gv-security-box">
                      <div className="gv-security-box-header">
                        <Lock size={18} className="gv-security-icon" />
                        <div>
                          <strong>Account Password</strong>
                          <p>Securely encrypted with salt hashing</p>
                        </div>
                      </div>
                      <div className="gv-security-box-actions">
                        <Link to="/forgot-password" className="gv-text-link">
                          Request Password Reset Link
                        </Link>
                      </div>
                    </div>

                    <div className="gv-security-box">
                      <div className="gv-security-box-header">
                        <ShieldCheck size={18} className="gv-security-icon gv-text-primary" />
                        <div>
                          <strong>Session &amp; Token Safeguards</strong>
                          <p>Authenticated using JWT Bearer rotation</p>
                        </div>
                      </div>
                      <div className="gv-security-box-actions">
                        <span className="gv-session-active-tag">Current Session Active</span>
                      </div>
                    </div>
                  </div>
                </article>
              )}
            </section>
          </div>
        )}

        {/* =========================================================
            CHANGE PHOTO MODAL
            ========================================================= */}
        {photoModalOpen && (
          <div
            className="gv-modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) closePhotoModal();
            }}
            role="presentation"
          >
            <div
              className="gv-modal-container"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gv-photo-modal-title"
            >
              <div className="gv-modal-header">
                <div className="gv-modal-title-group">
                  <div className="gv-modal-icon-badge">
                    <Camera size={18} />
                  </div>
                  <div>
                    <h2 id="gv-photo-modal-title" className="gv-modal-title">
                      Update Profile Photo
                    </h2>
                    <p className="gv-modal-subtitle">
                      Personalize your Green Village patron account with a fresh avatar.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="gv-modal-close-btn"
                  onClick={closePhotoModal}
                  aria-label="Close dialog"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="gv-modal-body">
                {/* Photo Preview Circle */}
                <div className="gv-photo-preview-section">
                  <div className="gv-photo-preview-circle">
                    {photoPreviewUrl && !previewError ? (
                      <img
                        src={photoPreviewUrl}
                        alt="Avatar preview"
                        className="gv-avatar-img"
                        referrerPolicy="no-referrer"
                        onError={() => setPreviewError(true)}
                        onLoad={() => setPreviewError(false)}
                      />
                    ) : (
                      <span className="gv-photo-preview-initials">{initials}</span>
                    )}
                  </div>
                  <div className="gv-photo-preview-meta">
                    <strong className="gv-photo-preview-label">Live Preview</strong>
                    <span className="gv-photo-preview-hint">
                      {photoPreviewUrl
                        ? previewError
                          ? "Image failed to load. Check URL."
                          : "Previewing avatar"
                        : "Showing default initials avatar"}
                    </span>
                  </div>
                </div>

                {photoError && (
                  <div className="gv-alert gv-alert--error" role="alert" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} />
                    <span>{photoError}</span>
                  </div>
                )}

                {/* Source Selection Tabs */}
                <div className="gv-photo-tab-bar" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={photoSourceTab === "presets"}
                    className={`gv-photo-tab-btn ${photoSourceTab === "presets" ? "is-active" : ""}`}
                    onClick={() => {
                      setPhotoSourceTab("presets");
                      setPhotoError("");
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Curated Avatars</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={photoSourceTab === "url"}
                    className={`gv-photo-tab-btn ${photoSourceTab === "url" ? "is-active" : ""}`}
                    onClick={() => {
                      setPhotoSourceTab("url");
                      setPhotoError("");
                    }}
                  >
                    <Link2 size={14} />
                    <span>Image Web URL</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={photoSourceTab === "upload"}
                    className={`gv-photo-tab-btn ${photoSourceTab === "upload" ? "is-active" : ""}`}
                    onClick={() => {
                      setPhotoSourceTab("upload");
                      setPhotoError("");
                    }}
                  >
                    <Upload size={14} />
                    <span>Upload Local</span>
                  </button>
                </div>

                {/* TAB 1: CURATED AVATARS */}
                {photoSourceTab === "presets" && (
                  <div className="gv-photo-tab-content">
                    <p className="gv-photo-tab-desc">
                      Select one of our curated botanical portraits:
                    </p>
                    <div className="gv-curated-avatars-grid">
                      {CURATED_AVATARS.map((item) => {
                        const isSelected = photoInputUrl === item.url;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`gv-curated-avatar-card ${isSelected ? "is-selected" : ""}`}
                            onClick={() => {
                              setPhotoInputUrl(item.url);
                              setPhotoPreviewUrl(item.url);
                              setPreviewError(false);
                              setPhotoError("");
                            }}
                          >
                            <div className="gv-curated-thumb-wrap">
                              <img
                                src={item.url}
                                alt={item.label}
                                className="gv-curated-thumb"
                                loading="lazy"
                              />
                              {isSelected && (
                                <div className="gv-curated-selected-badge" aria-label="Selected">
                                  <Check size={12} />
                                </div>
                              )}
                            </div>
                            <span className="gv-curated-name">{item.label}</span>
                            <span className="gv-curated-role">{item.role}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TAB 2: IMAGE URL */}
                {photoSourceTab === "url" && (
                  <div className="gv-photo-tab-content">
                    <label htmlFor="gv-photo-url-input" className="gv-photo-input-label">
                      Paste Direct Image URL
                    </label>
                    <div className="gv-photo-input-row">
                      <div className="gv-photo-input-wrap">
                        <Link2 size={16} className="gv-photo-input-icon" />
                        <input
                          id="gv-photo-url-input"
                          type="url"
                          className="gv-photo-url-input"
                          placeholder="https://images.unsplash.com/... or hosted image link"
                          value={photoInputUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPhotoInputUrl(val);
                            setPhotoPreviewUrl(val.trim());
                            setPreviewError(false);
                            setPhotoError("");
                          }}
                        />
                        {photoInputUrl && (
                          <button
                            type="button"
                            className="gv-input-clear-btn"
                            onClick={() => {
                              setPhotoInputUrl("");
                              setPhotoPreviewUrl("");
                              setPreviewError(false);
                            }}
                            aria-label="Clear URL"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="gv-photo-helper-text">
                      Supports direct HTTPS links (.jpg, .png, .webp) or hosted URLs from Unsplash, Imgur, Cloudinary, etc.
                    </p>
                  </div>
                )}

                {/* TAB 3: UPLOAD LOCAL */}
                {photoSourceTab === "upload" && (
                  <div className="gv-photo-tab-content">
                    <div className="gv-upload-dropzone">
                      <Upload size={28} className="gv-upload-icon" />
                      <strong className="gv-upload-title">Choose image from your device</strong>
                      <p className="gv-upload-desc">
                        Select a JPG, PNG, or WebP photo (up to 5 MB).
                      </p>
                      <label className="gv-upload-file-btn">
                        <span>Browse Files</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="gv-file-input-hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (!file.type.startsWith("image/")) {
                              setPhotoError("Please select a valid image file.");
                              return;
                            }
                            if (file.size > 5 * 1024 * 1024) {
                              setPhotoError("Image size must be less than 5 MB.");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const result = ev.target?.result;
                              setPhotoPreviewUrl(result);
                              setPhotoInputUrl(result);
                              setPreviewError(false);
                              setPhotoError("");
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      <p className="gv-upload-note">
                        Tip: To sync your photo seamlessly across all devices, select one of our curated avatars or provide a hosted HTTPS link.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="gv-modal-footer">
                <div className="gv-modal-footer-left">
                  {profile?.profileImage && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleSavePhoto("")}
                      disabled={savingPhoto}
                    >
                      Remove Photo
                    </Button>
                  )}
                </div>

                <div className="gv-modal-footer-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    icon={<X size={14} />}
                    onClick={closePhotoModal}
                    disabled={savingPhoto}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    icon={<Check size={16} />}
                    onClick={() => handleSavePhoto()}
                    loading={savingPhoto ? "Saving Photo…" : false}
                    disabled={savingPhoto}
                  >
                    Save Photo
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
