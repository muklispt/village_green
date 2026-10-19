import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  KeyRound,
  Mail,
  ArrowRight,
  Home,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Clock,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Input from "../../components/common/Input";
import Button from "../../components/common/Button";
import { verifyOtp, resendOtp } from "../../services/authService";
import { parseApiError, extractCooldownSeconds } from "../../utils/validation";

// Backend cooldown defined in backend/account/utils.py (OTP_COOLDOWN_SECONDS = 60)
const OTP_COOLDOWN_SECONDS = 60;

export default function VerifyOTP() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMountedRef = useRef(true);

  // Retrieve email from route state, query param, or sessionStorage for refresh persistence
  const searchParams = new URLSearchParams(location.search);
  const emailParam = searchParams.get("email");
  const emailFromState = location.state?.email;
  const emailFromStorage =
    typeof window !== "undefined" && window.sessionStorage
      ? sessionStorage.getItem("pending_verification_email")
      : null;

  const email = (emailFromState || emailParam || emailFromStorage || "").trim();

  // Verification state
  const [otp, setOtp] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyStatusMessage, setVerifyStatusMessage] = useState("");
  const [verifyErrorMessage, setVerifyErrorMessage] = useState(
    !email ? "No email found for verification. Please register your account first." : ""
  );
  const [fieldErrors, setFieldErrors] = useState({});

  // Resend OTP state
  const [resendLoading, setResendLoading] = useState(false);
  const [resendStatusMessage, setResendStatusMessage] = useState("");
  const [resendErrorMessage, setResendErrorMessage] = useState("");
  const [countdown, setCountdown] = useState(0);

  // Persist email in sessionStorage so page refreshes retain user's context
  useEffect(() => {
    isMountedRef.current = true;
    if (email && typeof window !== "undefined" && window.sessionStorage) {
      sessionStorage.setItem("pending_verification_email", email);
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [email]);

  // Handle countdown timer ticking
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  // Handle Resend OTP action
  const handleResendOtp = async () => {
    // Guard against repeated clicks, active countdown, or missing email
    if (resendLoading || countdown > 0) return;

    if (!email) {
      setResendErrorMessage("No email provided. Please complete registration first.");
      return;
    }

    setResendLoading(true);
    setResendStatusMessage("");
    setResendErrorMessage("");

    try {
      const response = await resendOtp({ email: email.toLowerCase() });
      if (!isMountedRef.current) return;

      const successMsg =
        response.data?.detail ||
        response.data?.message ||
        "If an unverified account exists for this email, a verification code has been sent.";
      setResendStatusMessage(successMsg);

      // Start countdown only after a successful resend request
      setCountdown(OTP_COOLDOWN_SECONDS);

      // Clear previous verification-level error so user is ready for new attempt
      setVerifyErrorMessage("");
    } catch (error) {
      if (!isMountedRef.current) return;

      const { fieldErrors: parsedFields, generalError: parsedGeneral } = parseApiError(error);
      const errorText =
        parsedFields.email ||
        parsedGeneral ||
        "Unable to resend verification code. Please try again.";

      setResendErrorMessage(errorText);

      // If backend responded with 429 or 400 cooldown, sync countdown to backend wait duration
      const waitSecs = extractCooldownSeconds(errorText);
      if (waitSecs && waitSecs > 0) {
        setCountdown(waitSecs);
      }
    } finally {
      if (isMountedRef.current) {
        setResendLoading(false);
      }
    }
  };

  // Handle Verify OTP form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (verifyLoading) return;
    setVerifyStatusMessage("");
    setVerifyErrorMessage("");
    setFieldErrors({});

    // Guard: Do not send request if email is missing
    if (!email) {
      setVerifyErrorMessage("No email provided. Please complete registration first.");
      return;
    }

    if (!otp.trim()) {
      setFieldErrors({ otp: "Please enter the 6-digit verification code." });
      return;
    }

    setVerifyLoading(true);

    try {
      const response = await verifyOtp({
        email: email.toLowerCase(),
        otp: otp.trim(),
      });

      if (!isMountedRef.current) return;

      const successMsg =
        response.data?.message ||
        response.data?.massage ||
        "Email verified successfully!";
      setVerifyStatusMessage(`${successMsg} Redirecting to sign in...`);

      // Clean up session storage after successful verification
      if (typeof window !== "undefined" && window.sessionStorage) {
        sessionStorage.removeItem("pending_verification_email");
      }

      setTimeout(() => {
        if (isMountedRef.current) {
          navigate("/login");
        }
      }, 1500);
    } catch (error) {
      if (!isMountedRef.current) return;
      const { fieldErrors: parsedFields, generalError: parsedGeneral } = parseApiError(error);
      setFieldErrors(parsedFields);
      setVerifyErrorMessage(
        parsedFields.otp ||
        parsedFields.email ||
        parsedGeneral ||
        "Verification failed. Please check your code and try again."
      );
    } finally {
      if (isMountedRef.current) {
        setVerifyLoading(false);
      }
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
          <strong className="gv-breadcrumb-active">Verify OTP</strong>
        </div>

        <div className="gv-auth-card-centered">
          <section className="gv-register-card gv-auth-card-compact">
            <h1 className="gv-register-title">Verify One-Time Passcode</h1>
            <p className="gv-register-desc">
              Enter the 6-digit confirmation code sent to{" "}
              {email ? (
                <span className="gv-recipient-highlight">{email}</span>
              ) : (
                "your registered email address"
              )}
              .
            </p>

            {/* Verification status and error alerts */}
            {verifyErrorMessage && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{verifyErrorMessage}</span>
              </div>
            )}

            {verifyStatusMessage && (
              <div className="gv-alert gv-alert--success" role="status">
                <CheckCircle2 size={16} />
                <span>{verifyStatusMessage}</span>
              </div>
            )}

            {/* Resend status and error alerts */}
            {resendErrorMessage && (
              <div className="gv-alert gv-alert--error" role="alert">
                <AlertCircle size={16} />
                <span>{resendErrorMessage}</span>
              </div>
            )}

            {resendStatusMessage && (
              <div className="gv-alert gv-alert--success" role="status">
                <CheckCircle2 size={16} />
                <span>{resendStatusMessage}</span>
              </div>
            )}

            {!email && (
              <div style={{ marginBottom: "16px" }}>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => navigate("/register")}
                  className="gv-submit-btn"
                >
                  Return to Registration
                </Button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="gv-form">
              <Input
                label="Email"
                id="email"
                name="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                readOnly
                icon={<Mail size={18} />}
              />

              <Input
                label="OTP"
                id="otp"
                name="otp"
                placeholder="6-digit code"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value);
                  if (fieldErrors.otp) {
                    setFieldErrors((prev) => ({ ...prev, otp: "" }));
                  }
                }}
                error={fieldErrors.otp}
                icon={<KeyRound size={18} />}
                required
                autoComplete="one-time-code"
              />

              {/* Resend OTP Container */}
              <div className="gv-resend-container">
                <div className="gv-resend-text-wrap">
                  <span className="gv-resend-prompt">Didn't receive the code?</span>
                  <span className="gv-resend-subtext">Check spam folder or request a new OTP.</span>
                </div>

                <button
                  type="button"
                  id="resend-otp-btn"
                  onClick={handleResendOtp}
                  disabled={!email || resendLoading || countdown > 0}
                  className="gv-resend-btn"
                  aria-live="polite"
                >
                  {resendLoading ? (
                    <>
                      <span className="gv-spinner gv-spinner--green" />
                      <span>Sending...</span>
                    </>
                  ) : countdown > 0 ? (
                    <span className="gv-resend-countdown">
                      <Clock size={14} />
                      <span>Resend OTP in</span>
                      <span className="gv-countdown-pill">{countdown}s</span>
                    </span>
                  ) : (
                    <>
                      <RotateCw size={14} />
                      <span>Resend OTP</span>
                    </>
                  )}
                </button>
              </div>

              <Button
                type="submit"
                id="verify-otp-submit-btn"
                variant="primary"
                size="lg"
                loading={verifyLoading ? "Verifying..." : false}
                className="gv-submit-btn"
                icon={<ArrowRight size={18} />}
                disabled={!email || verifyLoading}
              >
                Verify
              </Button>
            </form>

            <div className="gv-signin-box">
              <span>Return to</span>{" "}
              <Link to="/register" className="gv-signin-link">
                Registration
              </Link>
              {" or "}
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
