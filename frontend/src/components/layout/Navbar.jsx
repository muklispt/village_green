import { useState, useMemo } from "react";
import { Link, NavLink } from "react-router-dom";
import { Leaf, UserRound, Menu, X, LogOut, ShoppingBag } from "lucide-react";
import useAuth from "../../hooks/useAuth";
import useCart from "../../context/CartContext";
import CartDrawer from "../cart/CartDrawer";

/**
 * Green Village Global Navbar component
 */
export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const { totalCount, setIsCartOpen } = useCart();

  const displayName =
    user?.full_name || (typeof user === "string" ? user : "") || user?.email?.split("@")[0] || "Patron";

  // Compute initials fallback (e.g., "Muklis Broto" -> "MB", "Jane" -> "JA", or email prefix)
  const initials = useMemo(() => {
    if (!user) return "U";
    const name =
      user?.full_name ||
      (typeof user === "string" ? user : "") ||
      "";

    if (name && typeof name === "string" && name.trim()) {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      if (parts.length === 1 && parts[0].length > 0) {
        return parts[0].slice(0, Math.min(2, parts[0].length)).toUpperCase();
      }
    }

    if (user?.email && typeof user.email === "string") {
      const prefix = user.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      if (prefix.length > 0) {
        return prefix.slice(0, Math.min(2, prefix.length)).toUpperCase();
      }
    }

    return "U";
  }, [user]);

  return (
    <>
      <header className="gv-navbar">
        <div className="gv-navbar-container">
          {/* Brand Logo */}
          <Link to="/" className="gv-brand" aria-label="Green Village Home">
            <Leaf className="gv-brand-icon" size={24} />
            <span className="gv-brand-name">Green Village</span>
          </Link>

          {/* Desktop Nav */}
          <nav className={`gv-nav-links ${mobileMenuOpen ? "is-open" : ""}`}>
            <NavLink
              to="/products"
              className={({ isActive }) => (isActive ? "is-active" : "")}
              onClick={() => setMobileMenuOpen(false)}
            >
              Marketplace
            </NavLink>
            <NavLink
              to="/categories"
              className={({ isActive }) => (isActive ? "is-active" : "")}
              onClick={() => setMobileMenuOpen(false)}
            >
              Categories
            </NavLink>
            <a href="/#farms" onClick={() => setMobileMenuOpen(false)}>Our Farms</a>
            <a href="/#traceability" onClick={() => setMobileMenuOpen(false)}>Traceability</a>
            <a href="/#about" onClick={() => setMobileMenuOpen(false)}>About Us</a>
          </nav>

          {/* Right side cart, account & mobile toggle */}
          <div className="gv-nav-right">
            {/* Basket Button */}
            <button
              type="button"
              className="gv-nav-cart-btn"
              onClick={() => setIsCartOpen(true)}
              aria-label={`Open shopping basket with ${totalCount} items`}
              title="Shopping Basket"
            >
              <ShoppingBag size={20} />
              {totalCount > 0 && (
                <span className="gv-nav-cart-badge">{totalCount}</span>
              )}
            </button>

            {isAuthenticated ? (
              <div className="gv-nav-auth-user">
                {/* Clickable user profile avatar & details */}
                <Link
                  to="/profile"
                  className="gv-account-link gv-account-link--logged-in"
                  aria-label="View profile"
                  title={`View profile (${displayName})`}
                >
                  <div className="gv-avatar-circle" aria-hidden="true">
                    {user?.profileImage ? (
                      <img
                        src={user.profileImage}
                        alt={displayName}
                        className="gv-avatar-img"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="gv-avatar-initials">{initials}</span>
                    )}
                  </div>
                  <div className="gv-user-meta">
                    <span className="gv-account-text">{displayName}</span>
                  </div>
                </Link>

                {/* Sign Out Button */}
                <button
                  type="button"
                  className="gv-logout-btn"
                  onClick={logout}
                  title="Sign out of account"
                  aria-label="Sign out"
                >
                  <LogOut size={16} />
                  <span className="gv-logout-text">Sign Out</span>
                </button>
              </div>
            ) : (
              <Link to="/login" className="gv-account-link" aria-label="Sign in">
                <span className="gv-account-text">Account / Sign In</span>
                <div className="gv-avatar-circle" aria-hidden="true">
                  <UserRound size={17} />
                </div>
              </Link>
            )}

            <button
              type="button"
              className="gv-mobile-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {/* Cart Slide-out Drawer */}
      <CartDrawer />
    </>
  );
}
