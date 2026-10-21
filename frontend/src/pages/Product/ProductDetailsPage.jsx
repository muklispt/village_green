import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
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
  Award,
  Play,
  Film,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import QuantitySelector from "../../components/common/QuantitySelector";
import ProductCard from "../../components/product/ProductCard";
import ProductMediaGallery from "../../components/product/ProductMediaGallery";
import useCart from "../../context/CartContext";
import {
  getProductDetailsComplete,
  getProducts,
  formatPrice,
  formatVariantLabel,
  calculateDiscount,
} from "../../services/productService";

export default function ProductDetailsPage() {
  const { id } = useParams();
  const { addToCart, setIsCartOpen } = useCart();

  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Active media selection: selected image & media mode ('image' | 'video')
  const [selectedImage, setSelectedImage] = useState(null);
  const [mediaMode, setMediaMode] = useState("image");

  // Selected package variant
  const [selectedVariant, setSelectedVariant] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadProduct() {
      try {
        setLoading(true);
        setError(null);
        setQuantity(1);
        setMediaMode("image");

        const prod = await getProductDetailsComplete(id);
        if (!isMounted) return;
        setProduct(prod);

        // Determine default active image: primary image first, else first image, else product_img
        if (prod.images && prod.images.length > 0) {
          const primary = prod.images.find((img) => img.is_primary);
          setSelectedImage(primary ? primary.image : prod.images[0].image);
        } else if (prod.product_img) {
          setSelectedImage(prod.product_img);
        } else {
          setSelectedImage(null);
        }

        // Determine default variant if variants exist
        if (prod.variants && prod.variants.length > 0) {
          const inStockVariant = prod.variants.find(
            (v) => (v.stock_quantity || 0) > 0 && v.is_active !== false
          );
          setSelectedVariant(inStockVariant || prod.variants[0]);
        } else {
          setSelectedVariant(null);
        }

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
          console.error("Error loading product detail:", err);
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

  // Handle variant change
  const handleVariantSelect = (variant) => {
    setSelectedVariant(variant);
    const maxForVariant =
      typeof variant?.stock_quantity === "number" ? variant.stock_quantity : 99;
    if (quantity > maxForVariant) {
      setQuantity(Math.max(1, maxForVariant));
    }
  };


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

  // Stock, price, MRP, and discount calculations
  const hasVariants = Array.isArray(product?.variants) && product.variants.length > 0;
  const anyVariantInStock = hasVariants && product.variants.some(
    (v) => (v.stock_quantity || 0) > 0 && v.is_active !== false
  );

  const inStock = selectedVariant
    ? (selectedVariant.stock_quantity || 0) > 0 && selectedVariant.is_active !== false
    : (hasVariants
        ? anyVariantInStock
        : (product?.is_in_stock !== undefined ? product.is_in_stock : (product?.stock_quantity || 0) > 0));

  const currentStockQuantity = selectedVariant
    ? selectedVariant.stock_quantity
    : (hasVariants
        ? product.variants.reduce((acc, v) => acc + (v.is_active !== false ? (v.stock_quantity || 0) : 0), 0)
        : product?.stock_quantity);

  const maxStock = Math.max(1, currentStockQuantity || 1);
  const hasVideo = Boolean(product?.video?.video || product?.promotion_video?.video);

  const displayPrice = selectedVariant
    ? parseFloat(selectedVariant.price) || 0
    : parseFloat(product.price) || 0;

  const displayMrp = selectedVariant?.mrp ? parseFloat(selectedVariant.mrp) : null;
  const discountPercent = calculateDiscount(displayPrice, displayMrp);

  const displayUnit = selectedVariant
    ? formatVariantLabel(selectedVariant)
    : product.unit || "unit";

  const subtotal = (displayPrice * quantity).toFixed(2);

  const handleAddToCart = () => {
    if (!inStock) return;
    addToCart(product, quantity, selectedVariant);
  };

  const handleBuyNow = () => {
    if (!inStock) return;
    addToCart(product, quantity, selectedVariant);
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
            {/* Left: Product Media Gallery (Hover Zoom + Auto Slider + Image/Video Sequence) */}
            <ProductMediaGallery
              key={product.id}
              images={product.images}
              video={product.video || product.promotion_video}
              productImg={product.product_img}
              productName={product.name}
              imageDuration={3000}
              inStock={inStock}
              zoomScale={2.2}
              activeImageUrl={selectedImage}
              mediaMode={mediaMode}
              onActiveMediaChange={(activeItem) => {
                if (activeItem.type === "image") {
                  setSelectedImage(activeItem.url);
                  setMediaMode("image");
                } else if (activeItem.type === "video") {
                  setMediaMode("video");
                }
              }}
            />

            {/* Right: Product Details & Purchase Actions */}
            <div className="gv-details-info">
              {/* Category & Stock Status */}
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
                      <span>
                        In Stock ({currentStockQuantity} {displayUnit} available)
                      </span>
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

              {/* SKU Tag if available */}
              {selectedVariant?.sku && (
                <div className="gv-details-sku-row">
                  <span className="gv-details-sku-badge">
                    SKU: <strong>{selectedVariant.sku}</strong>
                  </span>
                </div>
              )}

              {/* Price & MRP Block */}
              <div className="gv-details-price-box">
                <div className="gv-details-price-main">
                  <div className="gv-details-price-line">
                    <span className="gv-details-price-value">
                      {formatPrice(displayPrice, displayUnit)}
                    </span>
                    {displayMrp && displayMrp > displayPrice && (
                      <span className="gv-details-mrp-block">
                        <span className="gv-details-mrp-label">MRP</span>
                        <span className="gv-details-mrp-value">
                          ₹{displayMrp.toFixed(2)}
                        </span>
                      </span>
                    )}
                    {discountPercent > 0 && (
                      <span className="gv-details-discount-pill">
                        {discountPercent}% OFF
                      </span>
                    )}
                  </div>
                  <span className="gv-details-price-sub">
                    Direct grower price • Zero middlemen • Fresh farm guarantee
                  </span>
                </div>
              </div>

              {/* Package Variants Selector */}
              {product.variants && product.variants.length > 0 && (
                <div className="gv-details-variants-section">
                  <div className="gv-details-variants-header">
                    <h3 className="gv-details-section-label">Available Package Sizes</h3>
                    {selectedVariant && (
                      <span className="gv-variant-selected-hint">
                        Selected: <strong>{formatVariantLabel(selectedVariant)}</strong>
                      </span>
                    )}
                  </div>

                  <div
                    className="gv-variants-grid"
                    role="radiogroup"
                    aria-label="Package sizes"
                  >
                    {product.variants.map((v) => {
                      const isSelected = selectedVariant?.id === v.id;
                      const isVariantInStock =
                        (v.stock_quantity || 0) > 0 && v.is_active !== false;
                      const variantLabel = formatVariantLabel(v);
                      const variantPriceNum = parseFloat(v.price) || 0;
                      const variantMrpNum = v.mrp ? parseFloat(v.mrp) : null;
                      const vDiscount = calculateDiscount(variantPriceNum, variantMrpNum);

                      return (
                        <button
                          key={v.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          disabled={!isVariantInStock}
                          className={`gv-variant-chip ${isSelected ? "is-selected" : ""} ${
                            !isVariantInStock ? "is-disabled" : ""
                          }`}
                          onClick={() => handleVariantSelect(v)}
                          title={
                            isVariantInStock
                              ? `${variantLabel} - ₹${variantPriceNum.toFixed(2)}`
                              : `${variantLabel} (Out of Stock)`
                          }
                        >
                          <span className="gv-variant-chip-top">
                            <span className="gv-variant-chip-label">{variantLabel}</span>
                            {isSelected && <Check size={14} className="gv-variant-check" />}
                          </span>

                          <span className="gv-variant-chip-price">
                            ₹{variantPriceNum.toFixed(2)}
                          </span>

                          {vDiscount > 0 && (
                            <span className="gv-variant-chip-discount">
                              {vDiscount}% OFF
                            </span>
                          )}

                          {!isVariantInStock && (
                            <span className="gv-variant-chip-stock-label">
                              Out of stock
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="gv-details-desc-box">
                <h3 className="gv-details-section-label">About This Harvest</h3>
                <p className="gv-details-desc-text">
                  {product.description ||
                    "Naturally grown and harvested fresh from verified partner orchards. Sourced under sustainable cultivation standards with complete cold-chain integrity from farm gate to your kitchen."}
                </p>
              </div>

              {/* Promotional Video Notice Card (if video available and not yet playing) */}
              {hasVideo && mediaMode !== "video" && (
                <div className="gv-details-video-banner">
                  <div className="gv-video-banner-info">
                    <Film size={18} className="gv-video-banner-icon" />
                    <div>
                      <strong>Watch Farm Video</strong>
                      <span>
                        {product.video?.title ||
                          "See the harvest grounds, grading process, and farm story"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="gv-btn-watch-video"
                    onClick={() => {
                      setMediaMode("video");
                      window.scrollTo({ top: 120, behavior: "smooth" });
                    }}
                  >
                    <Play size={14} fill="currentColor" /> Watch Video
                  </button>
                </div>
              )}

              {/* Quantity Selector & Subtotal Calculation */}
              {inStock && (
                <div className="gv-details-qty-block">
                  <div className="gv-qty-row">
                    <label className="gv-details-qty-label">
                      Quantity ({displayUnit}):
                    </label>
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

