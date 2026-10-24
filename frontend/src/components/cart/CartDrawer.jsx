import { X, Trash2, ShoppingBag, ArrowRight, AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import useCart from "../../context/CartContext";
import QuantitySelector from "../common/QuantitySelector";
import { resolveImageUrl } from "../../services/productService";

/**
 * Slide-out Shopping Basket Drawer
 */
export default function CartDrawer() {
  const {
    cartItems,
    isCartOpen,
    setIsCartOpen,
    updateQuantity,
    removeFromCart,
    clearCart,
    subtotal,
    totalCount,
    canCheckout,
    unavailableCount,
    loading,
    mutatingItemId,
    toastMessage,
  } = useCart();

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="gv-toast" role="status" aria-live="polite">
          <div className="gv-toast-dot" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Cart Drawer Backdrop */}
      {isCartOpen && (
        <div
          className="gv-cart-backdrop"
          onClick={() => setIsCartOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Slide-out Drawer Panel */}
      <aside
        className={`gv-cart-drawer ${isCartOpen ? "is-open" : ""}`}
        aria-label="Shopping Basket"
        aria-hidden={!isCartOpen}
      >
        <div className="gv-cart-drawer-header">
          <div className="gv-cart-title-wrap">
            <ShoppingBag size={20} className="gv-cart-icon" />
            <h2 className="gv-cart-title">Your Basket</h2>
            <span className="gv-cart-count-pill">{totalCount}</span>
          </div>

          <button
            type="button"
            className="gv-cart-close-btn"
            onClick={() => setIsCartOpen(false)}
            aria-label="Close basket"
          >
            <X size={20} />
          </button>
        </div>

        <div className="gv-cart-drawer-body">
          {loading && cartItems.length === 0 ? (
            <div className="gv-cart-loading-state">
              <Loader2 size={32} className="gv-spin" />
              <p>Loading your fresh basket...</p>
            </div>
          ) : cartItems.length === 0 ? (
            <div className="gv-cart-empty">
              <div className="gv-cart-empty-icon">
                <ShoppingBag size={48} strokeWidth={1.5} />
              </div>
              <h3>Your basket is empty</h3>
              <p>Explore our fresh organic harvest and support direct family farms.</p>
              <Link
                to="/products"
                className="gv-btn gv-btn--primary"
                onClick={() => setIsCartOpen(false)}
              >
                Browse Marketplace
              </Link>
            </div>
          ) : (
            <>
              {unavailableCount > 0 && (
                <div className="gv-cart-unavailable-banner">
                  <AlertTriangle size={16} />
                  <span>
                    {unavailableCount} item{unavailableCount > 1 ? "s" : ""} in your basket requires attention before checkout.
                  </span>
                </div>
              )}

              <ul className="gv-cart-items-list">
                {cartItems.map((item) => {
                  const prod = item.product || {};
                  const variant = item.variant;
                  const itemKey = item.id;
                  const isMutating = mutatingItemId === item.id;

                  const unitPriceNum = parseFloat(item.unit_price) || 0;
                  const lineTotalNum = parseFloat(item.line_total) || 0;
                  const itemImg = resolveImageUrl(prod.image || prod.product_img);
                  const maxStock = item.available_stock !== undefined ? item.available_stock : 99;

                  const packageLabel = variant
                    ? `${parseFloat(variant.quantity) || variant.quantity} ${variant.unit || ""}`.trim()
                    : null;

                  return (
                    <li
                      key={itemKey}
                      className={`gv-cart-item ${!item.is_available ? "is-unavailable" : ""}`}
                    >
                      <img
                        src={itemImg}
                        alt={prod.name}
                        className="gv-cart-item-img"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src =
                            "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=600&q=80";
                        }}
                      />

                      <div className="gv-cart-item-info">
                        <div className="gv-cart-item-header">
                          <Link
                            to={`/products/${prod.id}`}
                            className="gv-cart-item-name"
                            onClick={() => setIsCartOpen(false)}
                          >
                            {prod.name}
                          </Link>
                          <button
                            type="button"
                            className="gv-cart-item-remove"
                            onClick={() => removeFromCart(itemKey)}
                            disabled={isMutating}
                            aria-label={`Remove ${prod.name} from basket`}
                            title="Remove item"
                          >
                            {isMutating ? <Loader2 size={14} className="gv-spin" /> : <Trash2 size={16} />}
                          </button>
                        </div>

                        {packageLabel && (
                          <div className="gv-cart-item-variant-tag">
                            <span>Pack: <strong>{packageLabel}</strong></span>
                            {variant.sku && (
                              <span className="gv-cart-item-sku">SKU: {variant.sku}</span>
                            )}
                          </div>
                        )}

                        <div className="gv-cart-item-unit-price">
                          ₹{unitPriceNum.toFixed(2)} / {packageLabel || prod.unit || "unit"}
                        </div>

                        {!item.is_available && item.issue_message && (
                          <div className="gv-item-issue-badge">
                            <AlertTriangle size={12} />
                            <span>{item.issue_message}</span>
                          </div>
                        )}

                        <div className="gv-cart-item-actions">
                          <QuantitySelector
                            quantity={item.quantity}
                            max={Math.max(1, maxStock)}
                            min={1}
                            disabled={isMutating}
                            onChange={(newQty) => updateQuantity(itemKey, newQty)}
                          />
                          <span className="gv-cart-item-total">
                            ₹{lineTotalNum.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {cartItems.length > 0 && (
          <div className="gv-cart-drawer-footer">
            <div className="gv-cart-summary-row">
              <span>Subtotal</span>
              <span className="gv-cart-subtotal-val">₹{subtotal.toFixed(2)}</span>
            </div>

            <div className="gv-cart-delivery-note">
              <span>🌱 100% Zero-emission electric cold chain delivery</span>
            </div>

            <div className="gv-cart-cta-wrap">
              <Link
                to="/cart"
                className="gv-btn gv-btn--secondary gv-view-full-cart-btn"
                onClick={() => setIsCartOpen(false)}
              >
                View Full Cart & Summary
              </Link>

              <button
                type="button"
                className="gv-checkout-btn"
                disabled={!canCheckout}
                title={!canCheckout ? "Please remove or resolve unavailable items first" : "Proceed to Checkout"}
                onClick={() => {
                  alert(
                    `Green Village Checkout Demonstration\n\nSubtotal: ₹${subtotal.toFixed(
                      2
                    )}\nItems: ${totalCount}\n\n(Checkout & Payment gateway operational demonstration)`
                  );
                }}
              >
                <span>Proceed to Checkout</span>
                <ArrowRight size={18} />
              </button>

              <button
                type="button"
                className="gv-cart-clear-link"
                onClick={() => {
                  if (window.confirm("Are you sure you want to clear your fresh harvest basket?")) {
                    clearCart();
                  }
                }}
              >
                Clear all items
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
