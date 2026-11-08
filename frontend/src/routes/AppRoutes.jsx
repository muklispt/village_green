import { Routes, Route, Navigate } from "react-router-dom";
import Home from "../pages/Home/Home";
import CategoryPage from "../pages/Category/CategoryPage";
import ProductListingPage from "../pages/Product/ProductListingPage";
import ProductDetailsPage from "../pages/Product/ProductDetailsPage";
import CartPage from "../pages/Cart/CartPage";
import Register from "../pages/Auth/Register";
import Login from "../pages/Auth/Login";
import VerifyOTP from "../pages/Auth/VerifyOTP";
import ForgotPassword from "../pages/Auth/ForgotPassword";
import ResetPassword from "../pages/Auth/ResetPassword";
import Profile from "../pages/Profile/Profile";
import CheckoutPage from "../pages/Checkout/CheckoutPage";
import OrderDetailPage from "../pages/Orders/OrderDetailPage";
import OrderHistoryPage from "../pages/Orders/OrderHistoryPage";
import PaymentReturnPage from "../pages/Payment/PaymentReturnPage";
import PrivateRoute from "../components/PrivateRoute";
import AdminRoute from "../components/admin/AdminRoute";
import AdminLogin from "../pages/Admin/AdminLogin";
import AdminDashboard from "../pages/Admin/AdminDashboard";
import AdminCustomers from "../pages/Admin/AdminCustomers";
import AdminProducts from "../pages/Admin/AdminProducts";
import AdminOrders from "../pages/Admin/AdminOrders";
import AdminCategories from "../pages/Admin/AdminCategories";

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
      <Route path="/cart" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/orders" element={<PrivateRoute><OrderHistoryPage /></PrivateRoute>} />
      <Route path="/orders/:id" element={<PrivateRoute><OrderDetailPage /></PrivateRoute>} />
      <Route path="/payment/return" element={<PaymentReturnPage />} />

      {/* Auth & Patron Account Routes */}
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify-otp" element={<VerifyOTP />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />
      <Route path="/reset-password/:uid/:token/" element={<ResetPassword />} />
      <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />

      {/* Admin Panel Routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="/admin/orders" element={<AdminRoute><AdminOrders /></AdminRoute>} />
      <Route path="/admin/categories" element={<AdminRoute><AdminCategories /></AdminRoute>} />
      <Route path="/admin/customers" element={<AdminRoute><AdminCustomers /></AdminRoute>} />
      <Route path="/admin/products" element={<AdminRoute><AdminProducts /></AdminRoute>} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
