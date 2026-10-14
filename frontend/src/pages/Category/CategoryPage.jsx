import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, RefreshCw, Layers, AlertCircle, ArrowLeft } from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import CategoryCard from "../../components/product/CategoryCard";
import { getCategories, getProducts } from "../../services/productService";

export default function CategoryPage() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [catsData, prodsData] = await Promise.all([
          getCategories(),
          getProducts(),
        ]);
        if (isMounted) {
          setCategories(catsData);
          setProducts(prodsData.results || []);
        }
      } catch (err) {
        if (isMounted) {
          setError("Failed to load agricultural categories. Please verify your connection.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter categories by search term
  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return categories;
    const term = searchTerm.toLowerCase().trim();
    return categories.filter(
      (cat) =>
        cat.name.toLowerCase().includes(term) ||
        (cat.description && cat.description.toLowerCase().includes(term))
    );
  }, [categories, searchTerm]);

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        <div className="gv-container">
          {/* Breadcrumb Navigation */}
          <div className="gv-page-top-nav">
            <Breadcrumb items={[{ label: "Produce Categories" }]} />
          </div>

          {/* Page Header */}
          <div className="gv-page-header">
            <div>
              <span className="gv-section-eyebrow">Browse by Cultivation Type</span>
              <h1 className="gv-page-title">Produce Categories</h1>
              <p className="gv-page-subtitle">
                Explore our sustainably grown agricultural collections, from orchard fruits
                to leafy field greens.
              </p>
            </div>

            {/* Category Search Input */}
            <div className="gv-search-box">
              <Search size={18} className="gv-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="gv-search-input"
                placeholder="Search categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search categories"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="gv-search-clear"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Quick Summary Bar */}
          <div className="gv-category-summary-bar">
            <div className="gv-summary-stat">
              <Layers size={16} className="gv-summary-icon" />
              <span>
                Showing <strong>{filteredCategories.length}</strong> {filteredCategories.length === 1 ? "category" : "categories"}
              </span>
            </div>

            {searchTerm && (
              <span className="gv-search-tag">
                Filtered by: “{searchTerm}”
              </span>
            )}
          </div>

          {/* States: Loading, Error, Empty, Grid */}
          {loading ? (
            <div className="gv-cards-skeleton-grid">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="gv-skeleton-card" />
              ))}
            </div>
          ) : error ? (
            <div className="gv-error-banner">
              <AlertCircle size={20} />
              <p>{error}</p>
              <button
                type="button"
                className="gv-btn-retry"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="gv-empty-state">
              <div className="gv-empty-icon">🔍</div>
              <h3>No categories found</h3>
              <p>
                No agricultural categories matched your search for “{searchTerm}”.
              </p>
              <button
                type="button"
                className="gv-btn gv-btn--secondary"
                onClick={() => setSearchTerm("")}
              >
                Clear Search Filter
              </button>
            </div>
          ) : (
            <div className="gv-category-grid gv-category-grid--full">
              {filteredCategories.map((cat) => {
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

          {/* Bottom Call to Action */}
          <div className="gv-category-footer-cta">
            <div className="gv-footer-cta-text">
              <h3>Looking for a specific farm harvest?</h3>
              <p>View all available produce in our live seasonal marketplace.</p>
            </div>
            <Link to="/products" className="gv-btn gv-btn--primary">
              Browse All Products
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
