import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus, X, ShoppingBag, ShieldCheck, Leaf } from "lucide-react";

export default function CheckoutAuthModal({ isOpen, onClose }) {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSignIn = () => {
    navigate("/login?redirect=/checkout");
  };

  const handleRegister = () => {
    navigate("/register?redirect=/checkout");
  };

  return (
    <div className="gv-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="checkout-auth-title">
      <div className="gv-modal-card gv-checkout-auth-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="gv-modal-close-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={20} />
        </button>

        <div className="gv-checkout-auth-header">
          <div className="gv-checkout-auth-icon-wrap">
            <ShoppingBag size={28} className="gv-checkout-auth-icon" />
          </div>
          <h2 id="checkout-auth-title">Sign In to Complete Checkout</h2>
          <p>
            Your fresh harvest cart is saved. Please sign in or register an account so we can verify your delivery address and confirm your farm order.
          </p>
        </div>

        <div className="gv-checkout-auth-perks">
          <div className="gv-auth-perk-item">
            <ShieldCheck size={16} />
            <span>Secure checkout & direct farm order tracking</span>
          </div>
          <div className="gv-auth-perk-item">
            <Leaf size={16} />
            <span>Cold-chain delivery address verification</span>
          </div>
        </div>

        <div className="gv-checkout-auth-actions">
          <button
            type="button"
            className="gv-btn gv-btn--primary gv-auth-modal-btn"
            onClick={handleSignIn}
          >
            <LogIn size={18} />
            <span>Sign In to Your Account</span>
          </button>

          <button
            type="button"
            className="gv-btn gv-btn--outline gv-auth-modal-btn"
            onClick={handleRegister}
          >
            <UserPlus size={18} />
            <span>Create New Customer Account</span>
          </button>
        </div>

        <div className="gv-checkout-auth-footer">
          <button type="button" className="gv-link-subtle" onClick={onClose}>
            Continue reviewing your cart
          </button>
        </div>
      </div>
    </div>
  );
}

