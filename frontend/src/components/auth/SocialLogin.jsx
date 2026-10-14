import { Apple } from "lucide-react";
import GoogleAuthButton from "./GoogleAuthButton";

/**
 * Social login buttons and divider component with Google OAuth integration
 */
export default function SocialLogin({
  mode = "login",
  onGoogleSuccess,
  onGoogleError,
  isLoading = false,
  disabled = false,
  dividerText,
}) {
  const isRegister = mode === "register";
  const defaultDividerText = isRegister
    ? "or register with email"
    : "or sign in with email";

  const handleAppleClick = () => {
    alert("Apple Sign-In is configured for enterprise domains in production.");
  };

  return (
    <div className="gv-social-section">
      <div className="gv-social-provider-list">
        {/* Google OAuth Identity Services Button */}
        <div className="gv-social-google-slot">
          <GoogleAuthButton
            text={isRegister ? "signup_with" : "signin_with"}
            onSuccess={onGoogleSuccess}
            onError={onGoogleError}
            isLoading={isLoading}
            disabled={disabled}
          />
        </div>

        {/* Apple Sign-In button for secondary aesthetic balance */}
        <button
          type="button"
          className="gv-social-btn gv-social-apple-btn"
          onClick={handleAppleClick}
          aria-label={isRegister ? "Sign up with Apple" : "Sign in with Apple"}
          disabled={disabled || isLoading}
        >
          <Apple size={17} fill="currentColor" className="gv-social-icon" />
          <span>{isRegister ? "Sign up with Apple" : "Sign in with Apple"}</span>
        </button>
      </div>

      <div className="gv-divider">
        <span className="gv-divider-line" />
        <span className="gv-divider-text">{dividerText || defaultDividerText}</span>
        <span className="gv-divider-line" />
      </div>
    </div>
  );
}
