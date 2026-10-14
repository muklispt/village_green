import { X, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import useCart from "../../context/CartContext";
import QuantitySelector from "../common/QuantitySelector";
import { resolveImageUrl, formatPrice } from "../../services/productService";

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
          {cartItems.length === 0 ? (
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
            <ul className="gv-cart-items-list">
              {cartItems.map((item) => {
                const prod = item.product;
                const unitPrice = parseFloat(prod.price) || 0;
                const itemSubtotal = (unitPrice * item.quantity).toFixed(2);
                const itemImg = resolveImageUrl(prod.product_img);

                return (
                  <li key={prod.id} className="gv-cart-item">
                    <img
                      src={itemImg}
                      alt={prod.name}
                      className="gv-cart-item-img"
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
                          onClick={() => removeFromCart(prod.id)}
                          aria-label={`Remove ${prod.name} from basket`}
                          title="Remove item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="gv-cart-item-unit-price">
                        {formatPrice(prod.price, prod.unit)}
                      </div>

                      <div className="gv-cart-item-actions">
                        <QuantitySelector
                          quantity={item.quantity}
                          max={prod.stock_quantity || 99}
                          min={1}
                          onChange={(newQty) => updateQuantity(prod.id, newQty)}
                        />
                        <span className="gv-cart-item-total">₹{itemSubtotal}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
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
              <button
                type="button"
                className="gv-checkout-btn"
                onClick={() => {
                  alert(
                    `Thank you for shopping with Green Village!\nOrder subtotal: ₹${subtotal.toFixed(
                      2
                    )}\n(Payment gateway & checkout operational demonstration)`
                  );
                }}
              >
                <span>Proceed to Checkout</span>
                <ArrowRight size={18} />
              </button>

              <button
                type="button"
                className="gv-cart-clear-link"
                onClick={clearCart}
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
