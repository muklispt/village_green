import { Link } from "react-router-dom";
import { ArrowRight, Layers } from "lucide-react";
import { CATEGORY_FALLBACK_IMAGES } from "../../services/productService";

/**
 * Reusable Category Card
 * @param {Object} props
 * @param {Object} props.category
 * @param {number} [props.productCount]
 */
export default function CategoryCard({ category, productCount }) {
  if (!category) return null;

  // Determine category theme image based on category name
  const nameLower = (category.name || "").toLowerCase();
  let coverImg = CATEGORY_FALLBACK_IMAGES.default;
  if (nameLower.includes("fruit")) {
    coverImg = CATEGORY_FALLBACK_IMAGES.fruits;
  } else if (nameLower.includes("veg")) {
    coverImg = CATEGORY_FALLBACK_IMAGES.vegetables;
  } else if (nameLower.includes("grain") || nameLower.includes("pulse")) {
    coverImg = CATEGORY_FALLBACK_IMAGES.grains;
  } else if (nameLower.includes("organic")) {
    coverImg = CATEGORY_FALLBACK_IMAGES.organic;
  }

  return (
    <Link
      to={`/products?category=${category.id}`}
      className="gv-category-card"
      aria-label={`Browse ${category.name} products`}
    >
      <div className="gv-category-card-media">
        <img
          src={coverImg}
          alt={category.name}
          className="gv-category-card-img"
          loading="lazy"
        />
        <div className="gv-category-card-overlay" />
        {typeof productCount === "number" && (
          <span className="gv-category-count-badge">
            <Layers size={12} aria-hidden="true" />
            <span>{productCount} {productCount === 1 ? "Product" : "Products"}</span>
          </span>
        )}
      </div>

      <div className="gv-category-card-content">
        <div className="gv-category-card-header">
          <h3 className="gv-category-title">{category.name}</h3>
          <span className="gv-category-arrow" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </div>

        {category.description && (
          <p className="gv-category-desc">{category.description}</p>
        )}

        <div className="gv-category-explore-link">
          <span>Explore Harvest</span>
        </div>
      </div>
    </Link>
  );
}
