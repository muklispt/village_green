import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Loader2, AlertCircle } from "lucide-react";

/**
 * Google Authentication Button wrapping @react-oauth/google's GoogleLogin
 * Handles ID token extraction from response.credential, loading states, and error handling.
 */
export default function GoogleAuthButton({
  onSuccess,
  onError,
  text = "signin_with",
  isLoading = false,
  disabled = false,
}) {
  const [internalError, setInternalError] = useState("");
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleSuccess = (credentialResponse) => {
    setInternalError("");
    const idToken = credentialResponse?.credential;
    if (!idToken) {
      const err = "No credential received from Google Identity Services.";
      setInternalError(err);
      if (onError) onError(err);
      return;
    }
    if (onSuccess) {
      onSuccess(idToken);
    }
  };

  const handleError = () => {
    const errorMsg = "Google sign-in was closed or failed to complete. Please try again.";
    setInternalError(errorMsg);
    if (onError) onError(errorMsg);
  };

  if (!clientId || clientId.includes("your-google-client-id")) {
    return (
      <div className="gv-google-unconfigured-badge" role="status">
        <AlertCircle size={15} />
        <span>Configure VITE_GOOGLE_CLIENT_ID in your .env file to enable Google Sign-In.</span>
      </div>
    );
  }

  return (
    <div className={`gv-google-btn-container ${isLoading || disabled ? "is-loading" : ""}`}>
      {isLoading && (
        <div className="gv-google-loading-overlay" aria-live="polite">
          <Loader2 className="gv-spin-icon" size={18} />
          <span>Verifying Google account...</span>
        </div>
      )}

      <div className="gv-google-login-wrapper">
        <GoogleLogin
          onSuccess={handleSuccess}
          onError={handleError}
          text={text}
          theme="outline"
          shape="rectangular"
          size="large"
          width="100%"
          useOneTap={false}
          auto_select={false}
        />
      </div>

      {internalError && (
        <div className="gv-field-error-text" role="alert">
          {internalError}
        </div>
      )}
    </div>
  );
}
