import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, ArrowRight, Home, ChevronRight, AlertCircle } from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import PasswordInput from "../../components/auth/PasswordInput";
import SocialLogin from "../../components/auth/SocialLogin";
import Input from "../../components/common/Input";
import Button from "../../components/common/Button";
import useAuth from "../../hooks/useAuth";
import { validateLoginForm } from "../../utils/validation";

export default function Login() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({
    email: "",
    password: "",
  });

  const {
    loading,
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    clearFieldError,
    login,
    googleLogin,
  } = useAuth();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
    clearFieldError(name);
  };

  const redirectAfterAuth = (userObj, dataObj) => {
    const role = (userObj?.role || dataObj?.user?.role || dataObj?.role || "").toLowerCase();
    if (role === "admin") {
      navigate("/admin/dashboard");
    } else {
      navigate("/");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions
    if (loading) return;

    // Client-side validation
    const clientErrors = validateLoginForm(credentials);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    const payload = {
      email: credentials.email.trim().toLowerCase(),
      password: credentials.password,
    };

    const res = await login(payload);
    if (res.success) {
      redirectAfterAuth(res.user, res.data);
    }
  };

  const handleGoogleSuccess = async (idToken) => {
    if (loading) return;
    const res = await googleLogin(idToken);
    if (res.success) {
      redirectAfterAuth(res.user, res.data);
    }
  };

  const handleGoogleError = (err) => {
    setGeneralError(err || "Google authentication was cancelled or failed. Please try again.");
  };

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        <div className="gv-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/" className="gv-breadcrumb-link">
            <Home size={14} />
            <span>Home</span>
          </Link>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <strong className="gv-breadcrumb-active">Sign In</strong>
        </div>

        <div className="gv-auth-card-centered">
          <section className="gv-register-card gv-auth-card-compact">
            <h1 className="gv-register-title">Sign In to Green Village</h1>
            <p className="gv-register-desc">
              Access your farm subscriptions, delivery schedules, and credit balances.
            </p>

            {/* General Feedback Alert */}
            {generalError && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{generalError}</span>
              </div>
            )}

            {/* Google and Social Logins */}
            <SocialLogin
              mode="login"
              onGoogleSuccess={handleGoogleSuccess}
              onGoogleError={handleGoogleError}
              isLoading={loading}
              disabled={loading}
            />

            {/* Email / Password Form */}
            <form onSubmit={handleSubmit} className="gv-form">
              <Input
                label="Email Address"
                id="email"
                name="email"
                type="email"
                placeholder="Enter your email address"
                value={credentials.email}
                onChange={handleChange}
                error={fieldErrors.email}
                icon={<Mail size={18} />}
                required
                autoComplete="email"
              />

              <PasswordInput
                label="Password"
                id="password"
                name="password"
                placeholder="Enter your password"
                value={credentials.password}
                onChange={handleChange}
                error={fieldErrors.password}
                required
                autoComplete="current-password"
              />

              <div className="gv-form-row-between">
                <Link to="/forgot-password" className="gv-text-link">
                  Forgot Password?
                </Link>
                <Link to="/verify-otp" className="gv-text-link">
                  Verify with OTP
                </Link>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading ? "Signing in..." : false}
                disabled={loading}
                className="gv-submit-btn"
                icon={<ArrowRight size={18} />}
              >
                Sign In to Account
              </Button>
            </form>

            <div className="gv-signin-box">
              <span>New to Green Village?</span>{" "}
              <Link to="/register" className="gv-signin-link">
                Create an Account
              </Link>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
