import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Leaf,
  ArrowRight,
  ShieldCheck,
  Truck,
  HeartHandshake,
  Sparkles,
  ShoppingBag,
  Award,
  RefreshCw,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import ProductCard from "../../components/product/ProductCard";
import CategoryCard from "../../components/product/CategoryCard";
import { getCategories, getProducts } from "../../services/productService";

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState("all");
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [errorCategories, setErrorCategories] = useState(null);
  const [errorProducts, setErrorProducts] = useState(null);

  // Fetch categories
  useEffect(() => {
    let isMounted = true;
    async function loadCategories() {
      try {
        setLoadingCategories(true);
        setErrorCategories(null);
        const data = await getCategories();
        if (isMounted) setCategories(data);
      } catch (err) {
        if (isMounted) setErrorCategories("Unable to load produce categories.");
      } finally {
        if (isMounted) setLoadingCategories(false);
      }
    }
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch products
  useEffect(() => {
    let isMounted = true;
    async function loadProducts() {
      try {
        setLoadingProducts(true);
        setErrorProducts(null);
        const data = await getProducts();
        if (isMounted) setProducts(data.results || []);
      } catch (err) {
        if (isMounted) setErrorProducts("Unable to load featured products.");
      } finally {
        if (isMounted) setLoadingProducts(false);
      }
    }
    loadProducts();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter products by selected tab
  const filteredProducts =
    selectedCategoryTab === "all"
      ? products
      : products.filter(
          (p) =>
            p.product_category === selectedCategoryTab ||
            p.product_category?.id === selectedCategoryTab
        );

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        {/* HERO SECTION */}
        <section className="gv-home-hero">
          <div className="gv-hero-grid">
            <div className="gv-hero-copy">
              <div className="gv-home-badge">
                <Leaf size={16} />
                <span>100% Certified Organic • Direct From Growers</span>
              </div>

              <h1 className="gv-home-title">
                Direct from Farm to Your Table
              </h1>

              <p className="gv-home-subtitle">
                Experience wholesome, naturally ripened agricultural produce sourced directly
                from regenerative family farms. Harvested at dawn, pre-chilled with zero middlemen markup,
                and delivered directly to your doorstep.
              </p>

              <div className="gv-home-actions">
                <Link to="/products" className="gv-home-cta-primary">
                  <span>Shop Products</span>
                  <ShoppingBag size={18} />
                </Link>
                <Link to="/categories" className="gv-home-cta-secondary">
                  <span>Explore Categories</span>
                  <ArrowRight size={18} />
                </Link>
              </div>

              {/* Trust Metrics */}
              <div className="gv-hero-stats">
                <div className="gv-hero-stat-item">
                  <span className="gv-stat-number">100%</span>
                  <span className="gv-stat-label">Organic Certified</span>
                </div>
                <div className="gv-hero-stat-divider" />
                <div className="gv-hero-stat-item">
                  <span className="gv-stat-number">&lt; 24h</span>
                  <span className="gv-stat-label">Harvest to Delivery</span>
                </div>
                <div className="gv-hero-stat-divider" />
                <div className="gv-hero-stat-item">
                  <span className="gv-stat-number">85%</span>
                  <span className="gv-stat-label">Direct Farm Payout</span>
                </div>
              </div>
            </div>

            <div className="gv-hero-visual">
              <div className="gv-hero-card-img-wrap">
                <img
                  src="https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=1000&q=80"
                  alt="Fresh farm organic harvest"
                  className="gv-hero-main-img"
                />
                <div className="gv-hero-floating-badge gv-hero-floating-badge--top">
                  <ShieldCheck size={18} className="gv-floating-badge-icon" />
                  <div>
                    <strong>Pesticide Free</strong>
                    <span>Verified lab testing</span>
                  </div>
                </div>
                <div className="gv-hero-floating-badge gv-hero-floating-badge--bottom">
                  <Truck size={18} className="gv-floating-badge-icon" />
                  <div>
                    <strong>Cold-Chain Protected</strong>
                    <span>Farm gate to doorstep</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* EXPLORE CATEGORIES SECTION */}
        <section className="gv-section gv-section--categories">
          <div className="gv-container">
            <div className="gv-section-header">
              <div>
                <span className="gv-section-eyebrow">Fresh Agricultural Selection</span>
                <h2 className="gv-section-title">Explore Categories</h2>
                <p className="gv-section-desc">
                  Browse harvest offerings organized by agricultural category.
                </p>
              </div>
              <Link to="/categories" className="gv-link-view-all">
                <span>View all categories</span>
                <ArrowRight size={16} />
              </Link>
            </div>

            {loadingCategories ? (
              <div className="gv-cards-skeleton-grid">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="gv-skeleton-card" />
                ))}
              </div>
            ) : errorCategories ? (
              <div className="gv-error-banner">
                <p>{errorCategories}</p>
                <button
                  type="button"
                  className="gv-btn-retry"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : categories.length === 0 ? (
              <div className="gv-empty-state">
                <p>No categories currently available.</p>
              </div>
            ) : (
              <div className="gv-category-grid">
                {categories.map((cat) => {
                  const count = products.filter(
                    (p) =>
                      p.product_category === cat.id ||
                      p.product_category?.id === cat.id
                  ).length;
                  return (
                    <CategoryCard
                      key={cat.id}
                      category={cat}
                      productCount={count}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* FEATURED PRODUCTS SECTION */}
        <section className="gv-section gv-section--products">
          <div className="gv-container">
            <div className="gv-section-header">
              <div>
                <span className="gv-section-eyebrow">Today’s Orchard Picks</span>
                <h2 className="gv-section-title">Featured Products</h2>
                <p className="gv-section-desc">
                  Naturally ripened, peak-season fruits and farm fresh produce.
                </p>
              </div>

              {/* Category Filter Tabs */}
              {categories.length > 0 && (
                <div className="gv-tabs-wrap" role="tablist">
                  <button
                    type="button"
                    className={`gv-tab-btn ${selectedCategoryTab === "all" ? "is-active" : ""}`}
                    onClick={() => setSelectedCategoryTab("all")}
                    role="tab"
                    aria-selected={selectedCategoryTab === "all"}
                  >
                    All Harvests ({products.length})
                  </button>
                  {categories.map((cat) => {
                    const isSelected = selectedCategoryTab === cat.id;
                    const catCount = products.filter(
                      (p) =>
                        p.product_category === cat.id ||
                        p.product_category?.id === cat.id
                    ).length;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        className={`gv-tab-btn ${isSelected ? "is-active" : ""}`}
                        onClick={() => setSelectedCategoryTab(cat.id)}
                        role="tab"
                        aria-selected={isSelected}
                      >
                        {cat.name} ({catCount})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {loadingProducts ? (
              <div className="gv-products-skeleton-grid">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="gv-skeleton-product-card" />
                ))}
              </div>
            ) : errorProducts ? (
              <div className="gv-error-banner">
                <p>{errorProducts}</p>
                <button
                  type="button"
                  className="gv-btn-retry"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="gv-empty-state">
                <p>No products found in this category.</p>
                <Link to="/products" className="gv-btn gv-btn--primary">
                  Browse All Products
                </Link>
              </div>
            ) : (
              <div className="gv-products-grid">
                {filteredProducts.map((prod) => (
                  <ProductCard key={prod.id} product={prod} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SEASONAL HARVEST PROMO BANNER */}
        <section className="gv-section gv-section--promo">
          <div className="gv-container">
            <div className="gv-promo-banner">
              <div className="gv-promo-content">
                <span className="gv-promo-pill">
                  <Sparkles size={14} /> Harvest of the Season
                </span>
                <h2 className="gv-promo-title">
                  Fresh Indian Pears &amp; Exotic Red Dragon Fruit
                </h2>
                <p className="gv-promo-text">
                  Picked at optimal ripeness from local partner orchards. Crunchy texture,
                  naturally high in micronutrients, and handled with zero chemical post-harvest baths.
                </p>
                <div className="gv-promo-actions">
                  <Link to="/products" className="gv-btn gv-btn--light">
                    <span>Order Seasonal Box</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
              <div className="gv-promo-graphic">
                <img
                  src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80"
                  alt="Harvest fruit basket"
                  className="gv-promo-img"
                />
              </div>
            </div>
          </div>
        </section>

        {/* WHY CHOOSE GREEN VILLAGE */}
        <section id="about" className="gv-section gv-section--why">
          <div className="gv-container">
            <div className="gv-section-header gv-text-center">
              <span className="gv-section-eyebrow">Our Sustainable Promise</span>
              <h2 className="gv-section-title">Why Choose Green Village</h2>
              <p className="gv-section-desc">
                Rethinking modern food systems from soil fertility to doorstep nutrition.
              </p>
            </div>

            <div className="gv-home-highlights">
              <div className="gv-home-highlight-card">
                <div className="gv-highlight-icon-wrap">
                  <ShieldCheck className="gv-highlight-icon" size={26} />
                </div>
                <h3>100% Certified Organic</h3>
                <p>
                  Zero synthetic pesticides, zero GMOs, and zero chemical preservatives. Every partner
                  farm undergoes regular soil audits.
                </p>
              </div>

              <div className="gv-home-highlight-card">
                <div className="gv-highlight-icon-wrap">
                  <Truck className="gv-highlight-icon" size={26} />
                </div>
                <h3>Dawn-to-Doorstep Freshness</h3>
                <p>
                  Fruits and vegetables are harvested at sunrise and packed into temperature-controlled
                  cold vans to lock in vitamins and crunch.
                </p>
              </div>

              <div className="gv-home-highlight-card">
                <div className="gv-highlight-icon-wrap">
                  <HeartHandshake className="gv-highlight-icon" size={26} />
                </div>
                <h3>Fair Agricultural Economics</h3>
                <p>
                  By eliminating distribution middlemen, 85% of retail revenue flows directly back
                  to the family farmers who nurtured the crop.
                </p>
              </div>

              <div className="gv-home-highlight-card">
                <div className="gv-highlight-icon-wrap">
                  <Award className="gv-highlight-icon" size={26} />
                </div>
                <h3>Full Batch Traceability</h3>
                <p>
                  Scan the farm origin tag to view grower notes, harvest timestamp, and soil health
                  certificates for every single order.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
