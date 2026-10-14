import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ShoppingBag,
  Check,
  ShieldCheck,
  Truck,
  Leaf,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Share2,
  Heart,
  Award,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import QuantitySelector from "../../components/common/QuantitySelector";
import ProductCard from "../../components/product/ProductCard";
import useCart from "../../context/CartContext";
import {
  getProductById,
  getProducts,
  resolveImageUrl,
  formatPrice,
} from "../../services/productService";

export default function ProductDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart, setIsCartOpen } = useCart();

  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadProduct() {
      try {
        setLoading(true);
        setError(null);
        setQuantity(1);

        const prod = await getProductById(id);
        if (!isMounted) return;
        setProduct(prod);

        // Fetch related products from same category or general harvest
        try {
          const relatedData = await getProducts({
            categoryId: prod.product_category,
          });
          if (isMounted) {
            const others = (relatedData.results || []).filter((p) => p.id !== prod.id);
            setRelatedProducts(others.slice(0, 3));
          }
        } catch (relatedErr) {
          console.warn("Unable to load related products", relatedErr);
        }
      } catch (err) {
        if (isMounted) {
          setError("Product could not be found or has been deactivated.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (id) {
      loadProduct();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="gv-page-wrapper">
        <Navbar />
        <main className="gv-main-content">
          <div className="gv-container">
            <div className="gv-details-skeleton">
              <div className="gv-skeleton-media" />
              <div className="gv-skeleton-info">
                <div className="gv-skeleton-line gv-skeleton-line--title" />
                <div className="gv-skeleton-line gv-skeleton-line--price" />
                <div className="gv-skeleton-line gv-skeleton-line--desc" />
                <div className="gv-skeleton-line gv-skeleton-line--desc" />
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="gv-page-wrapper">
        <Navbar />
        <main className="gv-main-content">
          <div className="gv-container">
            <div className="gv-error-state-card">
              <AlertCircle size={44} className="gv-error-icon" />
              <h2>Product Not Found</h2>
              <p>{error || "This produce item is currently unavailable in our harvest records."}</p>
              <div className="gv-error-actions">
                <Link to="/products" className="gv-btn gv-btn--primary">
                  <ArrowLeft size={16} /> Return to Marketplace
                </Link>
                <button
                  type="button"
                  className="gv-btn gv-btn--secondary"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const inStock = (product.stock_quantity || 0) > 0;
  const maxStock = product.stock_quantity || 1;
  const unitPrice = parseFloat(product.price) || 0;
  const subtotal = (unitPrice * quantity).toFixed(2);
  const imageUrl = resolveImageUrl(product.product_img);

  const handleAddToCart = () => {
    if (!inStock) return;
    addToCart(product, quantity);
  };

  const handleBuyNow = () => {
    if (!inStock) return;
    addToCart(product, quantity);
    setIsCartOpen(true);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        <div className="gv-container">
          {/* Breadcrumbs: Home > Marketplace > Category > Product */}
          <div className="gv-page-top-nav">
            <Breadcrumb
              items={[
                { label: "Marketplace", to: "/products" },
                {
                  label: product.category_name || "Produce",
                  to: `/products?category=${product.product_category}`,
                },
                { label: product.name },
              ]}
            />
          </div>

          {/* Product Overview Section */}
          <section className="gv-details-grid">
            {/* Left: Product Gallery / Image */}
            <div className="gv-details-gallery">
              <div className="gv-details-main-img-box">
                <img
                  src={imageUrl}
                  alt={product.name}
                  className="gv-details-main-img"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src =
                      "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=800&q=80";
                  }}
                />
                {inStock ? (
                  <span className="gv-details-badge-organic">
                    <ShieldCheck size={14} /> 100% Certified Organic
                  </span>
                ) : (
                  <span className="gv-badge-soldout">Sold Out</span>
                )}
              </div>
            </div>

            {/* Right: Product Details & Purchase Actions */}
            <div className="gv-details-info">
              {/* Category & Status */}
              <div className="gv-details-meta-row">
                <span className="gv-details-category-pill">
                  {product.category_name || "Fresh Orchard"}
                </span>

                <span
                  className={`gv-stock-status gv-stock-status--lg ${
                    inStock ? "is-instock" : "is-out"
                  }`}
                >
                  {inStock ? (
                    <>
                      <Check size={14} />
                      <span>In Stock ({product.stock_quantity} {product.unit || "units"} available)</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} />
                      <span>Out of stock</span>
                    </>
                  )}
                </span>
              </div>

              {/* Product Title */}
              <h1 className="gv-details-title">{product.name}</h1>

              {/* Price Block */}
              <div className="gv-details-price-box">
                <div className="gv-details-price-main">
                  <span className="gv-details-price-value">
                    {formatPrice(product.price, product.unit)}
                  </span>
                  <span className="gv-details-price-sub">
                    Direct grower price • Zero middlemen
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="gv-details-desc-box">
                <h3 className="gv-details-section-label">About This Harvest</h3>
                <p className="gv-details-desc-text">
                  {product.description ||
                    "Naturally grown and harvested fresh from verified partner orchards. Sourced under sustainable cultivation standards with complete cold-chain integrity from farm gate to your kitchen."}
                </p>
              </div>

              {/* Quantity Selector & Subtotal Calculation */}
              {inStock && (
                <div className="gv-details-qty-block">
                  <div className="gv-qty-row">
                    <label className="gv-details-qty-label">Quantity ({product.unit || "kg"}):</label>
                    <QuantitySelector
                      quantity={quantity}
                      max={maxStock}
                      min={1}
                      onChange={setQuantity}
                    />
                  </div>

                  <div className="gv-subtotal-row">
                    <span className="gv-subtotal-label">Subtotal:</span>
                    <span className="gv-subtotal-val">₹{subtotal}</span>
                  </div>
                </div>
              )}

              {/* CTA Action Buttons */}
              <div className="gv-details-actions">
                <button
                  type="button"
                  className="gv-btn-details-cart"
                  onClick={handleAddToCart}
                  disabled={!inStock}
                  aria-label="Add to shopping basket"
                >
                  <ShoppingBag size={18} />
                  <span>Add to Basket</span>
                </button>

                <button
                  type="button"
                  className="gv-btn-details-buy"
                  onClick={handleBuyNow}
                  disabled={!inStock}
                  aria-label="Buy now and proceed to checkout"
                >
                  <span>Buy Now</span>
                </button>

                <button
                  type="button"
                  className="gv-btn-share"
                  onClick={handleShare}
                  aria-label="Share product link"
                  title="Copy link"
                >
                  <Share2 size={18} />
                  <span>{copiedLink ? "Copied!" : "Share"}</span>
                </button>
              </div>

              {/* Farm Guarantee Pillars */}
              <div className="gv-details-trust-pillars">
                <div className="gv-trust-pillar">
                  <Truck size={18} className="gv-pillar-icon" />
                  <div>
                    <strong>Cold-Chain Protected</strong>
                    <span>Chilled immediately post-harvest</span>
                  </div>
                </div>
                <div className="gv-trust-pillar">
                  <Leaf size={18} className="gv-pillar-icon" />
                  <div>
                    <strong>Zero Chemical Wax</strong>
                    <span>100% natural skin &amp; peel</span>
                  </div>
                </div>
                <div className="gv-trust-pillar">
                  <Award size={18} className="gv-pillar-icon" />
                  <div>
                    <strong>Direct Farm Support</strong>
                    <span>Fair pricing to local growers</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Related Harvests Section */}
          {relatedProducts.length > 0 && (
            <section className="gv-details-related-section">
              <div className="gv-section-header">
                <div>
                  <span className="gv-section-eyebrow">Complementary Picks</span>
                  <h2 className="gv-section-title">Related Harvests</h2>
                </div>
                <Link
                  to={`/products?category=${product.product_category}`}
                  className="gv-link-view-all"
                >
                  <span>View more in this category</span>
                  <ArrowLeft size={16} style={{ transform: "rotate(180deg)" }} />
                </Link>
              </div>

              <div className="gv-products-grid">
                {relatedProducts.map((rel) => (
                  <ProductCard key={rel.id} product={rel} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
