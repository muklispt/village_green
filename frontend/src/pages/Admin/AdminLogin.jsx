import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { ShieldCheck, Lock, Mail, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { adminLogin } from "../../services/adminService";

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/admin/dashboard";

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockoutSeconds, setLockoutSeconds] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      setError("Please provide both email and password.");
      return;
    }

    setLoading(true);
    setError("");
    setLockoutSeconds(null);

    try {
      await adminLogin(formData.email.trim(), formData.password);
      navigate(from, { replace: true });
    } catch (err) {
      const resp = err?.response;
      if (resp?.status === 429) {
        const retryAfter = resp.data?.retry_after || 60;
        setLockoutSeconds(retryAfter);
        setError(`Security lockout: too many failed attempts. Try again in ${retryAfter} seconds.`);
      } else if (resp?.status === 401 || resp?.status === 400) {
        setError(resp.data?.detail || "Invalid administrative credentials or insufficient privileges.");
      } else {
        setError("Unable to authenticate with admin server. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0d2015",
        padding: "20px",
        fontFamily: "var(--font-family)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "36px 32px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.35)",
        }}
      >
        {/* Header Icon & Title */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #15803d, #22c55e)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              marginBottom: "16px",
              boxShadow: "0 8px 16px rgba(34, 197, 94, 0.3)",
            }}
          >
            <ShieldCheck size={32} />
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#111827", marginBottom: "6px" }}>
            Admin Control Center
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280" }}>
            Sign in with your staff or superuser credentials
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              padding: "12px 14px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              marginBottom: "20px",
              color: "#b91c1c",
              fontSize: "13px",
              lineHeight: "1.4",
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div>
            <label
              htmlFor="admin-email"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}
            >
              Email Address
            </label>
            <div style={{ position: "relative" }}>
              <Mail
                size={18}
                color="#9ca3af"
                style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                id="admin-email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="admin@greenvillage.com"
                required
                disabled={loading || Boolean(lockoutSeconds)}
                style={{
                  width: "100%",
                  padding: "10px 14px 10px 38px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontSize: "14px",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="admin-password"
              style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}
            >
              Password
            </label>
            <div style={{ position: "relative" }}>
              <Lock
                size={18}
                color="#9ca3af"
                style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                id="admin-password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••••••"
                required
                disabled={loading || Boolean(lockoutSeconds)}
                style={{
                  width: "100%",
                  padding: "10px 14px 10px 38px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontSize: "14px",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || Boolean(lockoutSeconds)}
            style={{
              marginTop: "8px",
              padding: "12px",
              backgroundColor: loading ? "#15803d" : "#0d2015",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "14px",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 4px 12px rgba(13, 32, 21, 0.25)",
              transition: "all 0.15s ease",
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="gv-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign In to Admin</span>
            )}
          </button>
        </form>

        <div style={{ marginTop: "24px", textAlign: "center" }}>
          <Link
            to="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "#4b5563",
              fontWeight: "500",
            }}
          >
            <ArrowLeft size={14} />
            <span>Return to storefront</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
