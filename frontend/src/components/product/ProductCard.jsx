import React, { useState, useRef, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { ShoppingBag, Check, AlertCircle, Loader2 } from "lucide-react";
import useCart from "../../context/CartContext";
import { resolveImageUrl, formatPrice } from "../../services/productService";

/**
 * Reusable Product Card with Hover Zoom Magnification & Image Preview
 * @param {Object} props
 * @param {Object} props.product
 */
export default function ProductCard({ product }) {
  const { addToCart } = useCart();
  const [isHovered, setIsHovered] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const cardMediaRef = useRef(null);

  if (!product) return null;

  const inStock = product.is_in_stock !== undefined
    ? Boolean(product.is_in_stock)
    : (Number(product.stock_quantity) > 0);

  // Available images list for card preview if present
  const cardImages = useMemo(() => {
    const list = [];
    if (product.primary_image) list.push(product.primary_image);
    if (Array.isArray(product.images) && product.images.length > 0) {
      product.images.forEach((img) => {
        const url = typeof img === "string" ? img : img.image || img.url;
        if (url && !list.includes(url)) list.push(url);
      });
    }
    if (product.product_img && !list.includes(product.product_img)) {
      list.push(product.product_img);
    }
    return list.length > 0 ? list : [null];
  }, [product]);

  // Optional auto-slide on hover if product has multiple images
  useEffect(() => {
    if (!isHovered || cardImages.length <= 1) {
      setActiveImageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setActiveImageIndex((prev) => (prev + 1) % cardImages.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isHovered, cardImages.length]);

  const activeImage = cardImages[activeImageIndex] || product.primary_image || product.product_img;
  const imageUrl = resolveImageUrl(activeImage);
  const formattedPrice = formatPrice(product.price, product.unit);

  const handleMouseMove = (e) => {
    if (!cardMediaRef.current) return;
    const rect = cardMediaRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      setZoomOrigin({
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
      });
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setZoomOrigin({ x: 50, y: 50 });
  };

  const handleAddToCart = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inStock || isAdding) return;

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

    try {
      setIsAdding(true);
      await addToCart(product, 1, targetVariant);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <article className="gv-product-card">
      <Link
        ref={cardMediaRef}
        to={`/products/${product.id}`}
        className="gv-product-card-media"
        tabIndex={-1}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          position: "relative",
          display: "block",
          height: "220px",
          backgroundColor: "#f3f7f2",
          overflow: "hidden",
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        <img
          src={imageUrl}
          alt={product.name}
          className="gv-product-card-img"
          loading="lazy"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src =
              "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=600&q=80";
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
            transform: isHovered ? "scale(1.28)" : "scale(1)",
            transition: isHovered ? "transform 0.1s ease-out" : "transform 0.3s ease-out",
          }}
        />
        {inStock ? (
          <span className="gv-badge-organic">100% Organic</span>
        ) : (
          <span className="gv-badge-soldout">Sold Out</span>
        )}

        {/* Thumbnail Dots if multiple images are available on the card */}
        {cardImages.length > 1 && (
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: "4px",
              padding: "3px 6px",
              backgroundColor: "rgba(0, 0, 0, 0.45)",
              borderRadius: "10px",
              pointerEvents: "none",
            }}
          >
            {cardImages.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === activeImageIndex ? "10px" : "4px",
                  height: "4px",
                  borderRadius: "2px",
                  backgroundColor: i === activeImageIndex ? "#ffffff" : "rgba(255, 255, 255, 0.5)",
                  transition: "all 0.2s ease",
                }}
              />
            ))}
          </div>
        )}
      </Link>

      <div className="gv-product-card-body">
        <div className="gv-product-card-header">
          <span className="gv-product-category">{product.category_name || "Organic Farm"}</span>
          <span className={`gv-stock-status ${inStock ? "is-instock" : "is-out"}`}>
            {inStock ? (
              <>
                <Check size={12} aria-hidden="true" />
                <span>
                  {product.has_variants
                    ? "In Stock • Sizes available"
                    : `${product.stock_quantity} ${product.unit || "units"} left`}
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={12} aria-hidden="true" />
                <span>Out of stock</span>
              </>
            )}
          </span>
        </div>

        <h3 className="gv-product-name">
          <Link to={`/products/${product.id}`} className="gv-product-name-link">
            {product.name}
          </Link>
        </h3>

        {product.description && (
          <p className="gv-product-snippet">
            {product.description.slice(0, 80)}
            {product.description.length > 80 ? "…" : ""}
          </p>
        )}

        <div className="gv-product-footer">
          <div className="gv-product-price-block">
            <span className="gv-product-price-label">Price</span>
            <span className="gv-product-price-value">{formattedPrice}</span>
          </div>

          <button
            type="button"
            className="gv-add-cart-btn"
            onClick={handleAddToCart}
            disabled={!inStock || isAdding}
            aria-label={`Add ${product.name} to basket`}
            title={inStock ? "Add to cart" : "Currently out of stock"}
          >
            {isAdding ? (
              <Loader2 size={16} className="gv-spin" aria-hidden="true" />
            ) : (
              <ShoppingBag size={16} aria-hidden="true" />
            )}
            <span>{isAdding ? "Adding…" : "Add"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
