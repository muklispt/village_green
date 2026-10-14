import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowRight, Home, ChevronRight, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Input from "../../components/common/Input";
import Button from "../../components/common/Button";
import { forgotPassword } from "../../services/authService";
import { validateForgotPasswordForm, parseApiError } from "../../utils/validation";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: "" }));
    }
    if (generalError) {
      setGeneralError("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions while in-flight
    if (loading) return;

    setGeneralError("");
    setFieldErrors({});

    // Client-side validation
    const clientErrors = validateForgotPasswordForm({ email });
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setLoading(true);

    try {
      const response = await forgotPassword(email.trim().toLowerCase());
      const data = response?.data;
      const detailMsg =
        data?.detail ||
        data?.message ||
        "If an account exists for that email address, a password reset link will be sent.";

      setSuccessMessage(detailMsg);
      setSubmitted(true);
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } = parseApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(
        parsedFields.email ||
        parsedGeneral ||
        "Failed to send reset link. Please check your internet connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetForm = () => {
    setSubmitted(false);
    setSuccessMessage("");
    setGeneralError("");
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
          <Link to="/login" className="gv-breadcrumb-link">
            <span>Sign In</span>
          </Link>
          <ChevronRight size={14} className="gv-breadcrumb-sep" />
          <strong className="gv-breadcrumb-active">Forgot Password</strong>
        </div>

        <div className="gv-auth-card-centered">
          <section className="gv-register-card gv-auth-card-compact">
            <h1 className="gv-register-title">Reset Your Password</h1>
            <p className="gv-register-desc">
              Enter the email address registered with your Green Village account and we’ll send you a password reset link.
            </p>

            {generalError && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{generalError}</span>
              </div>
            )}

            {submitted && successMessage ? (
              <div className="gv-forgot-success-container">
                <div className="gv-alert gv-alert--success" role="status">
                  <CheckCircle2 size={18} />
                  <span>{successMessage}</span>
                </div>

                <div className="gv-info-notice" style={{ marginTop: "16px", marginBottom: "20px" }}>
                  <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: "1.6" }}>
                    Please check your email inbox and spam folder for instructions to choose a new password. The reset link is time-limited for security.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleResetForm}
                    className="gv-submit-btn"
                  >
                    Try another email address
                  </Button>

                  <Link to="/login" style={{ textDecoration: "none" }}>
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      className="gv-submit-btn"
                      icon={<ArrowLeft size={16} />}
                    >
                      Return to Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="gv-form">
                <Input
                  label="Registered Email Address"
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter your registered email"
                  value={email}
                  onChange={handleEmailChange}
                  error={fieldErrors.email}
                  icon={<Mail size={18} />}
                  required
                  autoComplete="email"
                />

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading ? "Sending reset link..." : false}
                  disabled={loading}
                  className="gv-submit-btn"
                  icon={<ArrowRight size={18} />}
                >
                  Send Reset Link
                </Button>
              </form>
            )}

            <div className="gv-signin-box">
              <span>Remember your password?</span>{" "}
              <Link to="/login" className="gv-signin-link">
                Sign In
              </Link>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
