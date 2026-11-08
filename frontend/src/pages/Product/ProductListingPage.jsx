import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  Filter,
  SlidersHorizontal,
  Grid3X3,
  List,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
} from "lucide-react";
import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import ProductCard from "../../components/product/ProductCard";
import { getCategories, getProducts } from "../../services/productService";

export default function ProductListingPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Query parameters from URL (single source of truth)
  const selectedCategory = searchParams.get("category") || "all";
  const initialSearch = searchParams.get("search") || "";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  // States
  const [categories, setCategories] = useState([]);
  const [productsData, setProductsData] = useState({ count: 0, next: null, previous: null, results: [] });
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [sortBy, setSortBy] = useState("newest");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceMax, setPriceMax] = useState(10000);
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'list'
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setCurrentPage = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const newPage = typeof val === "function" ? val(currentPage) : val;
      if (newPage > 1) {
        next.set("page", String(newPage));
      } else {
        next.delete("page");
      }
      return next;
    });
  }, [currentPage, setSearchParams]);

  // Debounce search input (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchTerm) {
          next.set("search", searchTerm);
        } else {
          next.delete("search");
        }
        next.delete("page");
        return next;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm, setSearchParams]);

  // Load categories
  useEffect(() => {
    let isMounted = true;
    async function loadCategories() {
      try {
        const cats = await getCategories();
        if (isMounted) setCategories(cats);
      } catch (e) {
        console.error("Failed to load categories for filter sidebar", e);
      }
    }
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch products from API based on search & page
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const data = await getProducts({
          search: debouncedSearch,
          page: currentPage,
          categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
        });
        if (isMounted) {
          setError(null);
          setProductsData(data);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setError("Unable to load marketplace products. Please check your network connection.");
          setLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [debouncedSearch, currentPage, selectedCategory]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    getProducts({
      search: debouncedSearch,
      page: currentPage,
      categoryId: selectedCategory !== "all" ? selectedCategory : undefined,
    })
      .then((data) => setProductsData(data))
      .catch(() => setError("Unable to load marketplace products. Please check your network connection."))
      .finally(() => setLoading(false));
  };

  // Handle client-side sorting & filters (stock & price)
  const displayedProducts = useMemo(() => {
    let list = [...(productsData.results || [])];

    // Filter by stock
    if (inStockOnly) {
      list = list.filter((p) => {
        if (p.is_in_stock !== undefined) return Boolean(p.is_in_stock);
        return (Number(p.stock_quantity) || 0) > 0;
      });
    }

    // Filter by price
    list = list.filter((p) => {
      const price = parseFloat(p.price) || 0;
      return price <= priceMax;
    });

    // Sort
    switch (sortBy) {
      case "price-asc":
        list.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0));
        break;
      case "price-desc":
        list.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
        break;
      case "name-asc":
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "newest":
      default:
        list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        break;
    }

    return list;
  }, [productsData.results, inStockOnly, priceMax, sortBy]);

  // Category switch handler
  const handleCategorySelect = (catId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (catId && catId !== "all") {
        next.set("category", catId);
      } else {
        next.delete("category");
      }
      next.delete("page");
      return next;
    });
    setMobileFilterOpen(false);
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setSearchParams({});
    setInStockOnly(false);
    setPriceMax(10000);
    setSortBy("newest");
  };

  const hasActiveFilters =
    selectedCategory !== "all" ||
    debouncedSearch !== "" ||
    inStockOnly ||
    priceMax < 10000;

  // Pagination calculation
  const totalCount = productsData.count || 0;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content">
        <div className="gv-container">
          {/* Top Breadcrumb */}
          <div className="gv-page-top-nav">
            <Breadcrumb items={[{ label: "Marketplace" }]} />
          </div>

          {/* Page Title & Search Bar */}
          <div className="gv-marketplace-header">
            <div>
              <span className="gv-section-eyebrow">Direct From Local Growers</span>
              <h1 className="gv-page-title">Marketplace</h1>
              <p className="gv-page-subtitle">
                Freshly harvested fruits, vegetables, and pantry staples straight from regenerative partner farms.
              </p>
            </div>

            {/* Product Search */}
            <div className="gv-marketplace-search-wrap">
              <div className="gv-search-box gv-search-box--wide">
                <Search size={18} className="gv-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  className="gv-search-input"
                  placeholder="Search products, fruits, varieties..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search products"
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
          </div>

          {/* Action Bar: Mobile filter button, Results count, View Mode, Sort Dropdown */}
          <div className="gv-marketplace-toolbar">
            <div className="gv-toolbar-left">
              <button
                type="button"
                className="gv-mobile-filter-trigger"
                onClick={() => setMobileFilterOpen(true)}
                aria-label="Open filter sidebar"
              >
                <SlidersHorizontal size={16} />
                <span>Filters {hasActiveFilters && "•"}</span>
              </button>

              <span className="gv-results-count">
                Showing <strong>{displayedProducts.length}</strong> of <strong>{totalCount}</strong> products
              </span>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="gv-btn-reset-filters"
                  onClick={handleResetFilters}
                >
                  <X size={14} /> Clear filters
                </button>
              )}
            </div>

            <div className="gv-toolbar-right">
              {/* Sort By Dropdown */}
              <div className="gv-sort-wrap">
                <label htmlFor="gv-sort-select" className="gv-sort-label">
                  Sort:
                </label>
                <select
                  id="gv-sort-select"
                  className="gv-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="newest">Newest Harvest</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="name-asc">Name: A to Z</option>
                </select>
              </div>

              {/* View Toggle */}
              <div className="gv-view-toggle" role="group" aria-label="Layout view">
                <button
                  type="button"
                  className={`gv-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  aria-label="Grid view"
                >
                  <Grid3X3 size={16} />
                </button>
                <button
                  type="button"
                  className={`gv-view-btn ${viewMode === "list" ? "is-active" : ""}`}
                  onClick={() => setViewMode("list")}
                  aria-label="List view"
                >
                  <List size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Main Layout: Sidebar Filters + Products Grid */}
          <div className="gv-marketplace-layout">
            {/* Desktop Filter Sidebar & Mobile Drawer */}
            <aside className={`gv-filter-sidebar ${mobileFilterOpen ? "is-mobile-open" : ""}`}>
              <div className="gv-sidebar-inner">
                <div className="gv-sidebar-header">
                  <div className="gv-sidebar-title-wrap">
                    <Filter size={18} />
                    <h3>Filters</h3>
                  </div>
                  {mobileFilterOpen && (
                    <button
                      type="button"
                      className="gv-sidebar-close-btn"
                      onClick={() => setMobileFilterOpen(false)}
                      aria-label="Close filters"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>

                {/* Filter 1: Categories */}
                <div className="gv-filter-group">
                  <h4 className="gv-filter-group-title">Categories</h4>
                  <ul className="gv-filter-list">
                    <li>
                      <button
                        type="button"
                        className={`gv-filter-item-btn ${selectedCategory === "all" ? "is-active" : ""}`}
                        onClick={() => handleCategorySelect("all")}
                      >
                        <span>All Categories</span>
                        {selectedCategory === "all" && <Check size={14} />}
                      </button>
                    </li>
                    {categories.map((cat) => (
                      <li key={cat.id}>
                        <button
                          type="button"
                          className={`gv-filter-item-btn ${selectedCategory === cat.id ? "is-active" : ""}`}
                          onClick={() => handleCategorySelect(cat.id)}
                        >
                          <span>{cat.name}</span>
                          {selectedCategory === cat.id && <Check size={14} />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Filter 2: Availability */}
                <div className="gv-filter-group">
                  <h4 className="gv-filter-group-title">Availability</h4>
                  <label className="gv-checkbox-label">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => setInStockOnly(e.target.checked)}
                    />
                    <span>In Stock Only</span>
                  </label>
                </div>

                {/* Filter 3: Price Range */}
                <div className="gv-filter-group">
                  <div className="gv-filter-group-title-row">
                    <h4 className="gv-filter-group-title">Max Price</h4>
                    <span className="gv-price-slider-val">₹{priceMax}</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="10000"
                    step="50"
                    value={priceMax}
                    onChange={(e) => setPriceMax(Number(e.target.value))}
                    className="gv-range-slider"
                    aria-label="Maximum price filter"
                  />
                  <div className="gv-range-labels">
                    <span>₹50</span>
                    <span>₹10,000</span>
                  </div>
                </div>

                {/* Reset Filters CTA */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    className="gv-btn gv-btn--secondary gv-w-full"
                    onClick={handleResetFilters}
                  >
                    Reset All Filters
                  </button>
                )}
              </div>
            </aside>

            {/* Mobile backdrop */}
            {mobileFilterOpen && (
              <div
                className="gv-filter-backdrop"
                onClick={() => setMobileFilterOpen(false)}
                aria-hidden="true"
              />
            )}

            {/* Product Grid Area */}
            <section className="gv-marketplace-results">
              {loading ? (
                <div className="gv-products-skeleton-grid">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div key={n} className="gv-skeleton-product-card" />
                  ))}
                </div>
              ) : error ? (
                <div className="gv-error-banner">
                  <AlertCircle size={20} />
                  <p>{error}</p>
                  <button
                    type="button"
                    className="gv-btn-retry"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={14} /> Retry
                  </button>
                </div>
              ) : displayedProducts.length === 0 ? (
                <div className="gv-empty-state">
                  <div className="gv-empty-icon">🌱</div>
                  <h3>No matching farm produce found</h3>
                  <p>
                    {debouncedSearch
                      ? `We couldn't find any products matching "${debouncedSearch}".`
                      : "No products currently fit the selected filter criteria."}
                  </p>
                  <button
                    type="button"
                    className="gv-btn gv-btn--primary"
                    onClick={handleResetFilters}
                  >
                    Clear All Filters
                  </button>
                </div>
              ) : (
                <>
                  <div className={`gv-products-grid ${viewMode === "list" ? "gv-products-grid--list" : ""}`}>
                    {displayedProducts.map((prod) => (
                      <ProductCard key={prod.id} product={prod} />
                    ))}
                  </div>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="gv-pagination" aria-label="Pagination Navigation">
                      <button
                        type="button"
                        className="gv-page-btn"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={!productsData.previous && currentPage <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                        <span>Previous</span>
                      </button>

                      <div className="gv-page-numbers">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                          <button
                            key={pageNum}
                            type="button"
                            className={`gv-page-num ${pageNum === currentPage ? "is-active" : ""}`}
                            onClick={() => setCurrentPage(pageNum)}
                            aria-current={pageNum === currentPage ? "page" : undefined}
                          >
                            {pageNum}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        className="gv-page-btn"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={!productsData.next && currentPage >= totalPages}
                        aria-label="Next page"
                      >
                        <span>Next</span>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
