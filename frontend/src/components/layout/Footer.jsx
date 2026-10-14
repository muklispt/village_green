import { useState } from "react";
import { Link } from "react-router-dom";
import { Leaf, Mail, ShieldCheck, Heart, Sparkles } from "lucide-react";

/**
 * Green Village Global Footer component
 */
export default function Footer() {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (email.trim()) {
      setSubscribed(true);
      setEmail("");
    }
  };

  return (
    <footer className="gv-footer">
      <div className="gv-footer-container">
        <div className="gv-footer-grid">
          {/* Brand & Mission */}
          <div className="gv-footer-col gv-footer-col--brand">
            <Link to="/" className="gv-footer-brand-logo" aria-label="Green Village Home">
              <Leaf size={22} className="gv-footer-leaf" />
              <span>Green Village</span>
            </Link>
            <p className="gv-footer-about">
              Direct-from-farm transparency, certified organic produce, and regenerative soil practices.
              Connecting conscientious patrons directly with family growers across India.
            </p>
            <div className="gv-footer-badges">
              <span className="gv-footer-badge">
                <ShieldCheck size={14} /> 100% Organic
              </span>
              <span className="gv-footer-badge">
                <Heart size={14} /> Fair Farm Revenue
              </span>
            </div>
          </div>

          {/* Marketplace Navigation */}
          <div className="gv-footer-col">
            <h4 className="gv-footer-title">Marketplace</h4>
            <ul className="gv-footer-links">
              <li>
                <Link to="/products">All Products</Link>
              </li>
              <li>
                <Link to="/categories">Produce Categories</Link>
              </li>
              <li>
                <Link to="/products?category=organic-fruits">Fresh Organic Fruits</Link>
              </li>
              <li>
                <Link to="/products">Seasonal Harvests</Link>
              </li>
            </ul>
          </div>

          {/* Trust & Farming */}
          <div className="gv-footer-col">
            <h4 className="gv-footer-title">Our Ecosystem</h4>
            <ul className="gv-footer-links">
              <li>
                <a href="/#farms">Partner Family Farms</a>
              </li>
              <li>
                <a href="/#traceability">Soil &amp; Traceability</a>
              </li>
              <li>
                <a href="/#about">Regenerative Pledge</a>
              </li>
              <li>
                <Link to="/profile">Patron Account</Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <div className="gv-footer-col gv-footer-col--newsletter">
            <h4 className="gv-footer-title">Seasonal Harvest Dispatch</h4>
            <p className="gv-footer-text">
              Receive notifications when seasonal fruits and limited heirloom harvests land from the orchard.
            </p>
            {subscribed ? (
              <div className="gv-newsletter-success">
                <Sparkles size={16} />
                <span>Thank you! You are subscribed to harvest dispatches.</span>
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="gv-newsletter-form">
                <div className="gv-newsletter-input-wrap">
                  <Mail size={16} className="gv-newsletter-icon" />
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    aria-label="Email for harvest newsletter"
                  />
                </div>
                <button type="submit" className="gv-newsletter-btn">
                  Subscribe
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer bottom */}
        <div className="gv-footer-bottom">
          <p className="gv-footer-copyright">
            © {new Date().getFullYear()} Green Village Inc. Direct-from-farm agricultural e-commerce. All rights reserved.
          </p>
          <div className="gv-footer-legal">
            <span>Clean Agriculture</span>
            <span className="gv-footer-dot">•</span>
            <span>Zero Synthetic Pesticides</span>
            <span className="gv-footer-dot">•</span>
            <span>Cold-Chain Delivery</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
