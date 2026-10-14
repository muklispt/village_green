import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Leaf,
  Home,
  ChevronRight,
  Gift,
  Mail,
  ShieldCheck,
  Clock3,
  Zap,
  WalletCards,
  Ticket,
  ArrowRight,
  PartyPopper,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import SocialLogin from "../../components/auth/SocialLogin";
import PasswordInput from "../../components/auth/PasswordInput";
import ImpactCard from "../../components/auth/ImpactCard";
import Input from "../../components/common/Input";
import Button from "../../components/common/Button";
import useAuth from "../../hooks/useAuth";
import { validateRegistrationForm } from "../../utils/validation";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm_password: "",
  });

  const [subscribeHarvest, setSubscribeHarvest] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [termsError, setTermsError] = useState("");
  const isSubmittingRef = useRef(false);

  const {
    loading,
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    successMessage,
    clearFieldError,
    register,
    googleLogin,
  } = useAuth();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    clearFieldError(name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions
    if (loading || isSubmittingRef.current) return;

    setTermsError("");

    // Client-side validation
    const clientErrors = validateRegistrationForm(form);
    if (!agreeTerms) {
      setTermsError("You must agree to the Terms of Service and Farm Escrow Policy to register.");
      clientErrors.terms = "You must agree to the Terms of Service and Farm Escrow Policy.";
    }

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setGeneralError("Please correct the highlighted fields before submitting.");
      return;
    }

    isSubmittingRef.current = true;

    try {
      // Submit payload exactly matching required fields
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        confirm_password: form.confirm_password,
      };

      const res = await register(payload);
      if (res.success) {
        // Clear form on success
        setForm({
          full_name: "",
          email: "",
          password: "",
          confirm_password: "",
        });

        // Redirect to /verify-otp passing returned email in navigation state
        const userEmail = res.data?.email || res.response?.data?.email || payload.email;
        if (typeof window !== "undefined" && window.sessionStorage) {
          sessionStorage.setItem("pending_verification_email", userEmail);
        }
        navigate("/verify-otp", {
          state: {
            email: userEmail,
          },
        });
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleGoogleSuccess = async (idToken) => {
    if (loading || isSubmittingRef.current) return;
    const res = await googleLogin(idToken);
    if (res.success) {
      navigate("/");
    }
  };

  const handleGoogleError = (err) => {
    setGeneralError(err || "Google authentication was cancelled or failed. Please try again.");
  };

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        {/* Breadcrumb Navigation */}
        <div className="gv-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/" className="gv-breadcrumb-link">
            <Home size={14} />
            <span>Home</span>
          </Link>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <span className="gv-breadcrumb-current">Account</span>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <strong className="gv-breadcrumb-active">Create Account</strong>
        </div>

        {/* Two-Column Registration Layout */}
        <div className="gv-registration-layout">
          {/* LEFT SIDE: Registration Card */}
          <section className="gv-register-card" aria-labelledby="register-heading">
            {/* Promo Banner */}
            <div className="gv-promo-badge">
              <Gift size={15} className="gv-promo-icon" />
              <PartyPopper size={14} className="gv-promo-icon" />
              <span>
                Sign up today &amp; receive $20 in Regenerative Farm Credits on your first delivery!
              </span>
            </div>

            <h1 id="register-heading" className="gv-register-title">
              Join the Green Village Community
            </h1>
            <p className="gv-register-desc">
              Connect directly with local organic family farms, enjoy sustainable cold-chain delivery, and customize your seasonal harvest.
            </p>

            {/* Social Logins */}
            <SocialLogin
              mode="register"
              onGoogleSuccess={handleGoogleSuccess}
              onGoogleError={handleGoogleError}
              isLoading={loading}
              disabled={loading}
            />

            {/* General Feedback Alert */}
            {generalError && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{generalError}</span>
              </div>
            )}

            {successMessage && (
              <div className="gv-alert gv-alert--success" role="status">
                <CheckCircle2 size={16} />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Main Registration Form */}
            <form onSubmit={handleSubmit} noValidate className="gv-form">
              {/* Field 1: Full Name */}
              <Input
                label="Full Name"
                id="full_name"
                name="full_name"
                placeholder="Enter your full name"
                value={form.full_name}
                onChange={handleChange}
                error={fieldErrors.full_name}
                required
                autoComplete="name"
              />

              {/* Field 2: Email Address */}
              <Input
                label="Email Address"
                id="email"
                name="email"
                type="email"
                placeholder="Enter your email address"
                value={form.email}
                onChange={handleChange}
                error={fieldErrors.email}
                icon={<Mail size={18} />}
                required
                autoComplete="email"
              />

              {/* Field 3: Create Password */}
              <PasswordInput
                label="Create Password"
                id="password"
                name="password"
                placeholder="Minimum 8 characters"
                value={form.password}
                onChange={handleChange}
                error={fieldErrors.password}
                required
                showStrength={true}
                autoComplete="new-password"
              />

              {/* Field 4: Confirm Password */}
              <PasswordInput
                label="Confirm Password"
                id="confirm_password"
                name="confirm_password"
                placeholder="Re-enter your password"
                value={form.confirm_password}
                onChange={handleChange}
                error={fieldErrors.confirm_password}
                required
                showStrength={false}
                autoComplete="new-password"
              />

              {/* Checkboxes */}
              <div className="gv-checkboxes-group">
                <label className="gv-checkbox-label">
                  <input
                    type="checkbox"
                    checked={subscribeHarvest}
                    onChange={(e) => setSubscribeHarvest(e.target.checked)}
                    className="gv-checkbox"
                  />
                  <span>
                    Send me weekly seasonal harvest forecasts and farm dispatch updates
                  </span>
                </label>

                <label className="gv-checkbox-label">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => {
                      setAgreeTerms(e.target.checked);
                      if (e.target.checked) setTermsError("");
                    }}
                    className="gv-checkbox"
                  />
                  <span>
                    I agree to Green Village{" "}
                    <a href="#terms" className="gv-text-link">Terms of Service</a> and{" "}
                    <a href="#policy" className="gv-text-link">Farm Escrow Policy</a>
                  </span>
                </label>
                {termsError && (
                  <small className="gv-field-error" role="alert">
                    {termsError}
                  </small>
                )}
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading ? "Creating Account..." : false}
                disabled={loading}
                className="gv-submit-btn"
                icon={<ArrowRight size={18} />}
              >
                Create My Farm Patron Account
              </Button>
            </form>

            {/* Bottom Sign-In Prompt */}
            <div className="gv-signin-box">
              <span>Already have a Green Village account?</span>{" "}
              <Link to="/login" className="gv-signin-link">
                Sign In
              </Link>
            </div>
          </section>

          {/* RIGHT SIDE: Farm / Impact Sidebar */}
          <aside className="gv-sidebar" aria-label="Farm and Impact Highlights">
            {/* Top Organic Farm Card */}
            <div className="gv-impact-card-wrapper">
              <div className="gv-farm-banner">
                <img
                  src="https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=1200&q=85"
                  alt="Organic regenerative farmland in Salinas Valley"
                  className="gv-farm-image"
                  loading="lazy"
                />
                <div className="gv-farm-overlay">
                  <div className="gv-farm-badge-icon" aria-hidden="true">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="gv-farm-details">
                    <strong className="gv-farm-title">Salinas River Basin Alliance</strong>
                    <span className="gv-farm-subtitle">
                      Certified Regenerative • Harvested Today
                    </span>
                  </div>
                </div>
              </div>

              <div className="gv-impact-body">
                <h2 className="gv-impact-heading">
                  <Leaf size={18} className="gv-impact-heading-leaf" />
                  <span>Your Impact as a Member</span>
                </h2>

                <div className="gv-impact-items-list">
                  <ImpactCard
                    icon={<WalletCards size={18} />}
                    title="$0 Middlemen Markup"
                    description="Up to 85% of each dollar flows directly to local growers, supporting generational stewardship."
                  />

                  <ImpactCard
                    icon={<Clock3 size={18} />}
                    title="Harvested Dawn to Doorstep"
                    description="Picked at peak sugar brix and rapidly pre-chilled within 60 minutes for unparalleled crispness."
                  />

                  <ImpactCard
                    icon={<Zap size={18} />}
                    title="100% Electric Cold-Chain"
                    description="Zero tailpipe emissions refrigerated delivery vans route directly to your doorstep."
                  />
                </div>
              </div>
            </div>

            {/* Voucher Card */}
            <div className="gv-voucher-card">
              <div className="gv-voucher-header">
                <span className="gv-voucher-tag">Automated Farm Voucher</span>
                <Ticket size={18} className="gv-voucher-ticket-icon" />
              </div>
              <h2 className="gv-voucher-amount">$20 Welcome Credit</h2>
              <p className="gv-voucher-desc">
                Applied directly at your first seasonal basket checkout.
              </p>
              <div className="gv-voucher-code-pill">
                <span className="gv-voucher-code"># WELCOME-HARVEST20</span>
                <span className="gv-voucher-status">Active</span>
              </div>
            </div>

            {/* Statistics Card */}
            <div className="gv-stats-card">
              <div className="gv-stat-item">
                <strong className="gv-stat-value">14,200+</strong>
                <span className="gv-stat-label">Farm Patrons</span>
              </div>
              <div className="gv-stat-item">
                <strong className="gv-stat-value">142 Tons</strong>
                <span className="gv-stat-label">Local Harvest</span>
              </div>
              <div className="gv-stat-item">
                <strong className="gv-stat-value">99.8%</strong>
                <span className="gv-stat-label">Cold Freshness</span>
              </div>
            </div>

            {/* Farm Verification Note */}
            <div className="gv-verified-note">
              <ShieldCheck size={18} className="gv-verified-note-icon" />
              <span>
                Independent family-owned farms verified under regenerative organic standards.
              </span>
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}
