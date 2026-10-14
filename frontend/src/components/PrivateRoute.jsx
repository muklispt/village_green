import React from "react";
import { Navigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";

/**
 * PrivateRoute protects child routes by ensuring the user is authenticated.
 * Waits for session initialization before redirecting to avoid premature logouts.
 */
const PrivateRoute = ({ children }) => {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className="gv-page-wrapper">
        <div className="gv-auth-loading-state" role="status" aria-live="polite">
          <div className="gv-spinner" />
          <span>Verifying secure session…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default PrivateRoute;
