import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isAdminAuthenticated } from "../../services/adminService";
import AdminLayout from "./AdminLayout";

/**
 * Route guard that ensures the user has a valid admin session.
 * Automatically wraps authorized views in the AdminLayout.
 */
export default function AdminRoute({ children }) {
  const location = useLocation();
  const authenticated = isAdminAuthenticated();

  if (!authenticated) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return <AdminLayout>{children}</AdminLayout>;
}
