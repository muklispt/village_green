import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Truck,
  Leaf,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Check,
  Plus,
  Minus,
  Loader2,
  Clock,
  Heart,
  Tag,
} from "lucide-react";

import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import useCart from "../../context/CartContext";
import useAuth from "../../hooks/useAuth";
import {
  getProducts,
  resolveImageUrl,
  formatPrice,
} from "../../services/productService";

const FREE_DELIVERY_THRESHOLD = 500; // in INR (₹)
const STANDARD_DELIVERY_FEE = 40;

export default function CartPage() {
  const { isAuthenticated } = useAuth();
  const {
    cartItems,
    subtotal,
    totalCount,
    canCheckout,
    unavailableCount,
    loading: cartLoading,
    mutatingItemId,
    updateQuantity,
    removeFromCart,
    clearCart,
    addToCart,
    showToast,
  } = useCart();

  // Recommendations state
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [addingRecId, setAddingRecId] = useState(null);

  // Promo code state (prompts user that coupons are not yet supported on backend)
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState(null);

  // Fetch recommendations from real product API
  useEffect(() => {
    let isMounted = true;
    async function loadRecs() {
      try {
        setLoadingRecs(true);
        const res = await getProducts({ pageSize: 4 });
        if (isMounted) {
          const list = res.results || res || [];
          // Filter out products already in cart
          const cartProdIds = (cartItems || []).map((ci) => ci.product?.id);
          const filtered = list.filter((p) => !cartProdIds.includes(p.id));
          setRecommendations(filtered.slice(0, 4));
        }
      } catch (err) {
        console.warn("Could not load cart recommendations:", err);
      } finally {
        if (isMounted) setLoadingRecs(false);
      }
    }

    loadRecs();
    return () => {
      isMounted = false;
    };
  }, [cartItems]);

  // Delivery calculation
  const deliveryFee = useMemo(() => {
    if (cartItems.length === 0) return 0;
    return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_FEE;
  }, [subtotal, cartItems.length]);

  const deliveryProgress = useMemo(() => {
    if (subtotal <= 0) return 0;
    return Math.min(100, Math.round((subtotal / FREE_DELIVERY_THRESHOLD) * 100));
  }, [subtotal]);

  const amountNeededForFreeDelivery = useMemo(() => {
    return Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal);
  }, [subtotal]);

  const estimatedTotal = useMemo(() => {
    if (cartItems.length === 0) return 0;
    return subtotal + deliveryFee;
  }, [subtotal, deliveryFee, cartItems.length]);

  // Promo code handler
  const handleApplyPromo = (e) => {
    e.preventDefault();
    if (!promoCode.trim()) return;

    setPromoStatus({
      type: "info",
      message:
        "Promotional coupon service is currently being prepared for our upcoming seasonal harvest release.",
    });
  };

  // Add recommendation to cart
  const handleAddRecommendation = async (product) => {
    if (!product || !product.id) return;

    let targetVariant = null;
    if (
      product.has_variants &&
      Array.isArray(product.variants) &&
      product.variants.length > 0
    ) {
      targetVariant =
        product.variants.find(
          (v) => (v.stock_quantity || 0) > 0 && v.is_active !== false
        ) || product.variants[0];
    }

    setAddingRecId(product.id);
    try {
      await addToCart(product, 1, targetVariant);
    } finally {
      setAddingRecId(null);
    }
  };

  const handleClearCart = () => {
    if (
      window.confirm(
        "Are you sure you want to empty your fresh harvest cart?"
      )
    ) {
      clearCart();
    }
  };

  const handleCheckoutClick = () => {
    if (!canCheckout) {
      showToast("Please resolve unavailable or out-of-stock items before checkout.");
      return;
    }

    alert(
      `Green Village Checkout Demonstration\n\nSubtotal: ₹${subtotal.toFixed(
        2
      )}\nDelivery: ${deliveryFee === 0 ? "FREE" : "₹" + deliveryFee.toFixed(2)}\nEstimated Total: ₹${estimatedTotal.toFixed(
        2
      )}\nTotal Items: ${totalCount}\n\n(Checkout & Payment Gateway integration is operational for demonstration)`
    );
  };

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content gv-cart-page-content">
        <Breadcrumb
          items={[
            { label: "Home", to: "/" },
            { label: "Marketplace", to: "/products" },
            { label: "Your Fresh Harvest Cart" },
          ]}
        />

        {/* Page Header */}
        <section className="gv-cart-page-header">
          <div className="gv-cart-page-title-wrap">
            <h1 className="gv-cart-page-title">Your Fresh Harvest Cart</h1>
            <p className="gv-cart-page-subtitle">
              {totalCount > 0
                ? `${totalCount} item${totalCount > 1 ? "s" : ""} sustainably harvested from local organic farms`
                : "Review your basket items and proceed to eco-friendly delivery"}
            </p>
          </div>

          {cartItems.length > 0 && (
            <button
              type="button"
              className="gv-cart-clear-all-btn"
              onClick={handleClearCart}
              title="Empty your cart"
            >
              <Trash2 size={15} />
              <span>Clear Cart</span>
            </button>
          )}
        </section>

        {/* Free Refrigerated Delivery Progress Banner */}
        {cartItems.length > 0 && (
          <section
            className={`gv-delivery-banner ${
              subtotal >= FREE_DELIVERY_THRESHOLD ? "is-unlocked" : ""
            }`}
            aria-label="Delivery progress"
          >
            <div className="gv-delivery-banner-header">
              <div className="gv-delivery-banner-icon-title">
                <Truck size={20} className="gv-delivery-icon" />
                <span className="gv-delivery-banner-heading">
                  {subtotal >= FREE_DELIVERY_THRESHOLD ? (
                    <>
                      <strong>Free Refrigerated Eco-Delivery Unlocked!</strong> Your order qualifies for zero-emission cold chain dispatch.
                    </>
                  ) : (
                    <>
                      Add <strong>₹{amountNeededForFreeDelivery.toFixed(2)}</strong> more of fresh produce to get <strong>FREE Refrigerated Delivery</strong>!
                    </>
                  )}
                </span>
              </div>
              <span className="gv-delivery-threshold-badge">
                {subtotal >= FREE_DELIVERY_THRESHOLD ? "Unlocked" : `₹${subtotal.toFixed(0)} / ₹${FREE_DELIVERY_THRESHOLD}`}
              </span>
            </div>

            <div className="gv-delivery-progress-track">
              <div
                className="gv-delivery-progress-fill"
                style={{ width: `${deliveryProgress}%` }}
              />
            </div>

            <div className="gv-delivery-banner-footer">
              <span>❄️ Temperature-controlled active cold chain (2°C – 4°C)</span>
              <span>🌱 100% Biodegradable insulated packaging</span>
            </div>
          </section>
        )}

        {/* Unavailable items alert banner */}
        {unavailableCount > 0 && (
          <div className="gv-cart-warning-alert" role="alert">
            <AlertTriangle size={20} className="gv-warning-icon" />
            <div>
              <strong>Action required:</strong> {unavailableCount} item
              {unavailableCount > 1 ? "s" : ""} in your harvest cart cannot be
              ordered right now due to stock updates or product changes. Please
              adjust quantities or remove them to proceed.
            </div>
          </div>
        )}

        {/* Main 2-Column Cart Layout */}
        <div className="gv-cart-layout">
          {/* Left Column: Items, Guarantee, Saved Items, Recommendations */}
          <div className="gv-cart-main-col">
            {cartLoading && cartItems.length === 0 ? (
              <div className="gv-cart-empty-card">
                <Loader2 size={36} className="gv-spin gv-cart-empty-icon" />
                <h2>Loading your fresh harvest...</h2>
                <p>Retrieving your synchronized cart from our farm database.</p>
              </div>
            ) : cartItems.length === 0 ? (
              <div className="gv-cart-empty-card">
                <div className="gv-cart-empty-bubble">
                  <ShoppingBag size={52} strokeWidth={1.4} />
                </div>
                <h2>Your harvest cart is empty</h2>
                <p>
                  You haven&apos;t added any fresh seasonal produce yet. Direct family
                  farms harvest and pack immediately upon ordering.
                </p>
                <div className="gv-cart-empty-actions">
                  <Link to="/products" className="gv-btn gv-btn--primary">
                    <Leaf size={16} /> Browse Organic Harvest
                  </Link>
                  <Link to="/categories" className="gv-btn gv-btn--secondary">
                    View Categories
                  </Link>
                </div>
              </div>
            ) : (
              <div className="gv-cart-items-card">
                <div className="gv-cart-items-table-header">
                  <span className="gv-col-product">Product</span>
                  <span className="gv-col-price">Price</span>
                  <span className="gv-col-qty">Quantity</span>
                  <span className="gv-col-total">Total</span>
                  <span className="gv-col-action">Remove</span>
                </div>

                <div className="gv-cart-items-list-body">
                  {cartItems.map((item) => {
                    const prod = item.product || {};
                    const variant = item.variant;
                    const isMutating = mutatingItemId === item.id;
                    const itemImg = resolveImageUrl(
                      prod.image || prod.product_img
                    );
                    const unitPriceNum = parseFloat(item.unit_price) || 0;
                    const lineTotalNum = parseFloat(item.line_total) || 0;
                    const maxStock =
                      item.available_stock !== undefined
                        ? item.available_stock
                        : 99;

                    const packageLabel = variant
                      ? `${parseFloat(variant.quantity) || variant.quantity} ${
                          variant.unit || ""
                        }`.trim()
                      : null;

                    return (
                      <article
                        key={item.id}
                        className={`gv-cart-item-row ${
                          !item.is_available ? "has-issue" : ""
                        }`}
                      >
                        {/* Product details */}
                        <div className="gv-cart-item-cell gv-cell-product">
                          <Link
                            to={`/products/${prod.id}`}
                            className="gv-cart-item-thumb-link"
                          >
                            <img
                              src={itemImg}
                              alt={prod.name}
                              className="gv-cart-item-thumb"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src =
                                  "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=600&q=80";
                              }}
                            />
                          </Link>

                          <div className="gv-cart-item-meta">
                            <div className="gv-cart-item-tag-row">
                              <span className="gv-organic-pill">100% Organic</span>
                              {variant?.sku && (
                                <span className="gv-sku-pill">
                                  SKU: {variant.sku}
                                </span>
                              )}
                            </div>

                            <h3 className="gv-cart-item-title">
                              <Link to={`/products/${prod.id}`}>
                                {prod.name}
                              </Link>
                            </h3>

                            {packageLabel ? (
                              <span className="gv-cart-item-variant-info">
                                Package Size: <strong>{packageLabel}</strong>
                              </span>
                            ) : (
                              <span className="gv-cart-item-unit-info">
                                Sold by {prod.unit || "unit"}
                              </span>
                            )}

                            {/* Issue flag if unavailable */}
                            {!item.is_available && item.issue_message && (
                              <div className="gv-line-issue-badge">
                                <AlertTriangle size={13} />
                                <span>{item.issue_message}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Unit price */}
                        <div className="gv-cart-item-cell gv-cell-price">
                          <span className="gv-cell-label-mobile">Price:</span>
                          <span className="gv-cart-price-num">
                            ₹{unitPriceNum.toFixed(2)}
                          </span>
                          <span className="gv-cart-unit-small">
                            / {packageLabel || prod.unit || "unit"}
                          </span>
                        </div>

                        {/* Quantity controls */}
                        <div className="gv-cart-item-cell gv-cell-qty">
                          <span className="gv-cell-label-mobile">Quantity:</span>
                          <div className="gv-cart-qty-stepper">
                            <button
                              type="button"
                              className="gv-qty-btn"
                              disabled={isMutating || item.quantity <= 1}
                              onClick={() =>
                                updateQuantity(item.id, item.quantity - 1)
                              }
                              aria-label={`Decrease quantity of ${prod.name}`}
                            >
                              <Minus size={14} />
                            </button>
                            <span className="gv-qty-val">
                              {isMutating ? (
                                <Loader2 size={13} className="gv-spin" />
                              ) : (
                                item.quantity
                              )}
                            </span>
                            <button
                              type="button"
                              className="gv-qty-btn"
                              disabled={isMutating || item.quantity >= maxStock}
                              onClick={() =>
                                updateQuantity(item.id, item.quantity + 1)
                              }
                              aria-label={`Increase quantity of ${prod.name}`}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          {item.available_stock > 0 &&
                            item.available_stock <= 5 && (
                              <span className="gv-low-stock-hint">
                                Only {item.available_stock} left!
                              </span>
                            )}
                        </div>

                        {/* Line total */}
                        <div className="gv-cart-item-cell gv-cell-total">
                          <span className="gv-cell-label-mobile">Total:</span>
                          <span className="gv-cart-total-num">
                            ₹{lineTotalNum.toFixed(2)}
                          </span>
                        </div>

                        {/* Action: remove */}
                        <div className="gv-cart-item-cell gv-cell-action">
                          <button
                            type="button"
                            className="gv-cart-trash-btn"
                            disabled={isMutating}
                            onClick={() => removeFromCart(item.id)}
                            aria-label={`Remove ${prod.name} from harvest cart`}
                            title="Remove item"
                          >
                            {isMutating ? (
                              <Loader2 size={16} className="gv-spin" />
                            ) : (
                              <Trash2 size={17} />
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="gv-cart-items-footer-actions">
                  <Link to="/products" className="gv-continue-shopping-link">
                    <ArrowLeft size={16} />
                    <span>Continue Browsing Marketplace</span>
                  </Link>

                  <span className="gv-cart-items-count-summary">
                    {cartItems.length} line item{cartItems.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            )}

            {/* Direct Farm Dispatch Guarantee Card */}
            <section className="gv-farm-dispatch-card">
              <div className="gv-farm-dispatch-icon-wrap">
                <Leaf size={28} className="gv-farm-dispatch-icon" />
              </div>
              <div className="gv-farm-dispatch-content">
                <h3>Direct Farm-to-Table Dispatch</h3>
                <p>
                  Green Village partners directly with certified local organic
                  farmers. Produce is harvested early morning upon order placement,
                  quality-inspected, and shipped via electric refrigerated vehicles.
                </p>
                <div className="gv-farm-dispatch-badges">
                  <span>
                    <Check size={14} /> Verified zero chemical pesticide
                  </span>
                  <span>
                    <Clock size={14} /> Harvested within 24 hours of dispatch
                  </span>
                  <span>
                    <ShieldCheck size={14} /> 100% Fair price paid to growers
                  </span>
                </div>
              </div>
            </section>

            {/* Saved for Next Harvest (Wishlist / Seasonal Reservation Notice) */}
            <section className="gv-saved-harvest-card">
              <div className="gv-saved-harvest-header">
                <div className="gv-saved-harvest-title-wrap">
                  <Heart size={18} className="gv-saved-icon" />
                  <h3>Saved for Next Harvest</h3>
                </div>
                <span className="gv-badge-upcoming">Seasonal Feature</span>
              </div>
              <p className="gv-saved-harvest-desc">
                Plan your organic kitchen ahead. Upcoming seasonal crops and weekly
                farm basket subscriptions will be available for advance reservation in
                our seasonal harvest calendar.
              </p>
            </section>

            {/* Fresh Farm Recommendations */}
            {recommendations.length > 0 && (
              <section className="gv-cart-recommendations">
                <div className="gv-recommendations-header">
                  <div className="gv-recs-title-wrap">
                    <Sparkles size={20} className="gv-recs-icon" />
                    <h2>Fresh Farm Recommendations</h2>
                  </div>
                  <Link to="/products" className="gv-recs-view-all">
                    View full harvest <ArrowRight size={14} />
                  </Link>
                </div>

                <div className="gv-recs-grid">
                  {recommendations.map((rec) => {
                    const recImg = resolveImageUrl(
                      rec.primary_image || rec.product_img
                    );
                    const formatted = formatPrice(rec.price, rec.unit);
                    const isAddingThis = addingRecId === rec.id;
                    const inStock =
                      rec.is_in_stock !== undefined
                        ? Boolean(rec.is_in_stock)
                        : (rec.stock_quantity || 0) > 0;

                    return (
                      <div key={rec.id} className="gv-rec-card">
                        <Link
                          to={`/products/${rec.id}`}
                          className="gv-rec-card-media"
                        >
                          <img
                            src={recImg}
                            alt={rec.name}
                            className="gv-rec-img"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src =
                                "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=400&q=80";
                            }}
                          />
                          <span className="gv-rec-tag">Fresh</span>
                        </Link>

                        <div className="gv-rec-body">
                          <span className="gv-rec-category">
                            {rec.category_name || "Organic Farm"}
                          </span>
                          <h4 className="gv-rec-title">
                            <Link to={`/products/${rec.id}`}>{rec.name}</Link>
                          </h4>
                          <div className="gv-rec-footer">
                            <span className="gv-rec-price">{formatted}</span>
                            <button
                              type="button"
                              className="gv-rec-add-btn"
                              disabled={!inStock || isAddingThis}
                              onClick={() => handleAddRecommendation(rec)}
                              title={inStock ? "Add to cart" : "Out of stock"}
                            >
                              {isAddingThis ? (
                                <Loader2 size={14} className="gv-spin" />
                              ) : (
                                <>
                                  <Plus size={14} />
                                  <span>Add</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* Right Column: Order Summary Card (Sticky) */}
          <aside className="gv-cart-summary-col">
            <div className="gv-order-summary-card">
              <h2 className="gv-summary-title">Order Summary</h2>

              <div className="gv-summary-rows">
                <div className="gv-summary-row">
                  <span>Harvest Items Subtotal</span>
                  <span className="gv-summary-val">₹{subtotal.toFixed(2)}</span>
                </div>

                <div className="gv-summary-row">
                  <div className="gv-summary-label-help">
                    <span>Refrigerated Delivery</span>
                    <span className="gv-help-tag">Cold Chain</span>
                  </div>
                  <span
                    className={`gv-summary-val ${
                      deliveryFee === 0 && cartItems.length > 0
                        ? "gv-text-free"
                        : ""
                    }`}
                  >
                    {cartItems.length === 0
                      ? "₹0.00"
                      : deliveryFee === 0
                      ? "FREE"
                      : `₹${deliveryFee.toFixed(2)}`}
                  </span>
                </div>

                <div className="gv-summary-row">
                  <span>Organic Quality Inspection</span>
                  <span className="gv-summary-val gv-text-free">FREE</span>
                </div>

                <div className="gv-summary-row">
                  <span>Estimated Taxes (GST)</span>
                  <span className="gv-summary-val gv-text-muted">
                    Included in item prices
                  </span>
                </div>
              </div>

              {/* Promotional code input */}
              <form onSubmit={handleApplyPromo} className="gv-promo-box">
                <label htmlFor="promoCodeInput" className="gv-promo-label">
                  <Tag size={14} />
                  <span>Promotional Voucher</span>
                </label>
                <div className="gv-promo-input-wrap">
                  <input
                    id="promoCodeInput"
                    type="text"
                    placeholder="Enter harvest voucher code"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value);
                      setPromoStatus(null);
                    }}
                    className="gv-promo-input"
                  />
                  <button
                    type="submit"
                    className="gv-promo-apply-btn"
                    disabled={!promoCode.trim()}
                  >
                    Apply
                  </button>
                </div>
                {promoStatus && (
                  <p className="gv-promo-status-msg">{promoStatus.message}</p>
                )}
              </form>

              <div className="gv-summary-divider" />

              {/* Total Row */}
              <div className="gv-summary-total-row">
                <div>
                  <span className="gv-total-label">Estimated Total</span>
                  <span className="gv-total-tax-note">All agricultural taxes included</span>
                </div>
                <div className="gv-total-amount-wrap">
                  <span className="gv-total-val">₹{estimatedTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Checkout CTA */}
              <button
                type="button"
                className="gv-cart-checkout-cta"
                disabled={!canCheckout || cartItems.length === 0}
                onClick={handleCheckoutClick}
              >
                <span>Proceed to Checkout</span>
                <ArrowRight size={18} />
              </button>

              {!canCheckout && cartItems.length > 0 && (
                <p className="gv-checkout-disabled-warning">
                  ⚠️ Please resolve unavailable items in your cart to proceed to checkout.
                </p>
              )}

              {/* Trust Badges */}
              <div className="gv-summary-trust-badges">
                <div className="gv-trust-item">
                  <ShieldCheck size={18} className="gv-trust-icon" />
                  <span>Secure 256-bit encrypted checkout</span>
                </div>
                <div className="gv-trust-item">
                  <Leaf size={18} className="gv-trust-icon" />
                  <span>100% Direct farm traceability guaranteed</span>
                </div>
                <div className="gv-trust-item">
                  <Truck size={18} className="gv-trust-icon" />
                  <span>Eco-cold chain insulated transport</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}
