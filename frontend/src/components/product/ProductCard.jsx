import { Link } from "react-router-dom";
import { ShoppingBag, Check, AlertCircle } from "lucide-react";
import useCart from "../../context/CartContext";
import { resolveImageUrl, formatPrice } from "../../services/productService";

/**
 * Reusable Product Card
 * @param {Object} props
 * @param {Object} props.product
 */
export default function ProductCard({ product }) {
  const { addToCart } = useCart();

  if (!product) return null;

  const inStock = product.stock_quantity > 0;
  const imageUrl = resolveImageUrl(product.product_img);
  const formattedPrice = formatPrice(product.price, product.unit);

  const handleAddToCart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inStock) return;
    addToCart(product, 1);
  };

  return (
    <article className="gv-product-card">
      <Link to={`/products/${product.id}`} className="gv-product-card-media" tabIndex={-1}>
        <img
          src={imageUrl}
          alt={product.name}
          className="gv-product-card-img"
          loading="lazy"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=600&q=80";
          }}
        />
        {inStock ? (
          <span className="gv-badge-organic">100% Organic</span>
        ) : (
          <span className="gv-badge-soldout">Sold Out</span>
        )}
      </Link>

      <div className="gv-product-card-body">
        <div className="gv-product-card-header">
          <span className="gv-product-category">{product.category_name || "Organic Farm"}</span>
          <span className={`gv-stock-status ${inStock ? "is-instock" : "is-out"}`}>
            {inStock ? (
              <>
                <Check size={12} aria-hidden="true" />
                <span>{product.stock_quantity} {product.unit || "units"} left</span>
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
            disabled={!inStock}
            aria-label={`Add ${product.name} to basket`}
            title={inStock ? "Add to cart" : "Currently out of stock"}
          >
            <ShoppingBag size={16} aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>
      </div>
    </article>
  );
}
