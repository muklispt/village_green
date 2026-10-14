import { Routes, Route, Navigate } from "react-router-dom";
import Home from "../pages/Home/Home";
import CategoryPage from "../pages/Category/CategoryPage";
import ProductListingPage from "../pages/Product/ProductListingPage";
import ProductDetailsPage from "../pages/Product/ProductDetailsPage";
import Register from "../pages/Auth/Register";
import Login from "../pages/Auth/Login";
import VerifyOTP from "../pages/Auth/VerifyOTP";
import ForgotPassword from "../pages/Auth/ForgotPassword";
import ResetPassword from "../pages/Auth/ResetPassword";
import Profile from "../pages/Profile/Profile";
import PrivateRoute from "../components/PrivateRoute";

/**
 * Main application routes
 */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Public Storefront Routes */}
      <Route path="/" element={<Home />} />
      <Route path="/categories" element={<CategoryPage />} />
      <Route path="/products" element={<ProductListingPage />} />
      <Route path="/marketplace" element={<Navigate to="/products" replace />} />
      <Route path="/products/:id" element={<ProductDetailsPage />} />

      {/* Auth & Patron Account Routes */}
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify-otp" element={<VerifyOTP />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />
      <Route path="/reset-password/:uid/:token/" element={<ResetPassword />} />
      <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
