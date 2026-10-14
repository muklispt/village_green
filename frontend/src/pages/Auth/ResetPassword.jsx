import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowRight, Home, ChevronRight, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import PasswordInput from "../../components/auth/PasswordInput";
import Button from "../../components/common/Button";
import { resetPassword } from "../../services/authService";
import { validateResetPasswordForm, parseApiError } from "../../utils/validation";

export default function ResetPassword() {
  const { uid, token } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    new_password: "",
    confirm_password: "",
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [generalError, setGeneralError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [isInvalidLink, setIsInvalidLink] = useState(!uid || !token);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
    if (generalError) {
      setGeneralError("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions
    if (loading) return;

    setGeneralError("");
    setFieldErrors({});

    // Guard: Verify uid and token are available
    if (!uid || !token) {
      setIsInvalidLink(true);
      setGeneralError("Password reset link is invalid or incomplete. Please request a new link.");
      return;
    }

    // Client-side validation
    const clientErrors = validateResetPasswordForm(formData);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        uid: String(uid).trim(),
        token: String(token).trim(),
        new_password: formData.new_password,
        confirm_password: formData.confirm_password,
      };

      const response = await resetPassword(payload);
      const data = response?.data;
      const successDetail = data?.detail || data?.message || "Password reset successful. Please log in.";

      setSuccessMessage(successDetail);

      // Auto-navigate to login page after short delay
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } = parseApiError(error);
      setFieldErrors(parsedFields);

      // Check if the backend reported invalid uid or token
      const isTokenOrUidError =
        parsedFields.uid ||
        parsedFields.token ||
        (parsedGeneral &&
          (parsedGeneral.toLowerCase().includes("invalid") ||
            parsedGeneral.toLowerCase().includes("expired")));

      if (isTokenOrUidError) {
        setIsInvalidLink(true);
        setGeneralError(
          parsedFields.uid ||
          parsedFields.token ||
          parsedGeneral ||
          "This password reset link is invalid or has expired."
        );
      } else {
        setGeneralError(
          parsedFields.new_password ||
          parsedFields.confirm_password ||
          parsedGeneral ||
          "Unable to reset password. Please verify the information entered."
        );
      }
    } finally {
      setLoading(false);
    }
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
          <strong className="gv-breadcrumb-active">Reset Password</strong>
        </div>

        <div className="gv-auth-card-centered">
          <section className="gv-register-card gv-auth-card-compact">
            <h1 className="gv-register-title">Set New Password</h1>
            <p className="gv-register-desc">
              Create a new secure password for your Green Village account.
            </p>

            {generalError && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{generalError}</span>
              </div>
            )}

            {successMessage && (
              <div className="gv-alert gv-alert--success" role="status">
                <CheckCircle2 size={16} />
                <span>{successMessage} Redirecting to sign in...</span>
              </div>
            )}

            {isInvalidLink ? (
              <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
                <p style={{ fontSize: "13.5px", color: "var(--color-text-muted)", marginBottom: "18px", lineHeight: "1.6" }}>
                  Your password reset link is invalid, incomplete, or has expired. For your security, reset links can only be used once and expire after a limited period.
                </p>
                <Link to="/forgot-password" style={{ textDecoration: "none" }}>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="gv-submit-btn"
                    icon={<RefreshCw size={16} />}
                  >
                    Request a New Reset Link
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="gv-form">
                <PasswordInput
                  label="New Password"
                  id="new_password"
                  name="new_password"
                  placeholder="Minimum 8 characters"
                  value={formData.new_password}
                  onChange={handleChange}
                  error={fieldErrors.new_password || fieldErrors.password}
                  required
                  showStrength={true}
                  autoComplete="new-password"
                />

                <PasswordInput
                  label="Confirm New Password"
                  id="confirm_password"
                  name="confirm_password"
                  placeholder="Re-enter your new password"
                  value={formData.confirm_password}
                  onChange={handleChange}
                  error={fieldErrors.confirm_password}
                  required
                  showStrength={false}
                  autoComplete="new-password"
                />

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading ? "Resetting password..." : false}
                  disabled={loading || Boolean(successMessage)}
                  className="gv-submit-btn"
                  icon={<ArrowRight size={18} />}
                >
                  Save New Password
                </Button>
              </form>
            )}

            <div className="gv-signin-box">
              <span>Return to</span>{" "}
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
