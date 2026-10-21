import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Package,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Layers,
  IndianRupee,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import {
  getAdminProducts,
  getAdminCategories,
  deleteAdminProduct,
  getAdminProductById,
} from "../../services/adminService";
import AdminProductModal from "../../components/admin/AdminProductModal";
import AdminProductDetailsModal from "../../components/admin/AdminProductDetailsModal";

export default function AdminProducts() {
  // Data state
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedStock, setSelectedStock] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 12;

  // Modals state
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [initialModalTab, setInitialModalTab] = useState("info");
  const [editingProductId, setEditingProductId] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Expanded variant row
  const [expandedProductId, setExpandedProductId] = useState(null);
  const toggleRowExpansion = (productId) => {
    setExpandedProductId((prev) => (prev === productId ? null : productId));
  };

  // Load categories once
  useEffect(() => {
    async function loadCategories() {
      try {
        const catRes = await getAdminCategories();
        const catList = Array.isArray(catRes) ? catRes : catRes.results || [];
        setCategories(catList);
      } catch (err) {
        console.error("Failed to load categories for filter:", err);
      }
    }
    loadCategories();
  }, []);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        page: currentPage,
      };

      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }

      if (selectedCategory && selectedCategory !== "all") {
        params.category = selectedCategory;
      }

      const res = await getAdminProducts(params);
      if (res && Array.isArray(res.results)) {
        setProducts(res.results);
        setTotalCount(res.count || res.results.length);
      } else if (Array.isArray(res)) {
        setProducts(res);
        setTotalCount(res.length);
      } else {
        setProducts([]);
        setTotalCount(0);
      }
    } catch (err) {
      console.error("Error loading products:", err);
      setError("Failed to fetch products. Please ensure the backend is running and you have admin access.");
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, selectedCategory]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Client-side filtering for status and stock level (if DRF pagination doesn't filter them)
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Status filter
      if (selectedStatus === "active" && !p.is_active) return false;
      if (selectedStatus === "inactive" && p.is_active) return false;

      // Stock filter
      const stock = Number(p.stock_quantity) || 0;
      const hasStock = p.is_in_stock !== undefined ? Boolean(p.is_in_stock) : stock > 0;
      if (selectedStock === "in_stock" && !hasStock) return false;
      if (selectedStock === "low_stock" && (!hasStock || stock > 5)) return false;
      if (selectedStock === "out_of_stock" && hasStock) return false;

      return true;
    });
  }, [products, selectedStatus, selectedStock]);

  // Quick stats
  const stats = useMemo(() => {
    const total = totalCount;
    const inStock = products.filter((p) => p.is_in_stock !== undefined ? Boolean(p.is_in_stock) : Number(p.stock_quantity) > 0).length;
    const outOfStock = products.filter((p) => p.is_in_stock !== undefined ? !p.is_in_stock : Number(p.stock_quantity) <= 0).length;
    return { total, inStock, outOfStock };
  }, [totalCount, products]);

  // Handlers
  const handleOpenCreateModal = (tab = "info") => {
    setEditingProductId(null);
    setEditingProduct(null);
    setInitialModalTab(tab);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (product, tab = "info") => {
    setEditingProductId(product.id);
    setEditingProduct(product);
    setInitialModalTab(tab);
    setIsFormModalOpen(true);
  };

  const handleOpenViewModal = async (product) => {
    try {
      // Fetch full details including all images and variants
      const full = await getAdminProductById(product.id);
      setViewingProduct(full);
    } catch (err) {
      setViewingProduct(product);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProduct) return;
    setIsDeleting(true);
    try {
      await deleteAdminProduct(deletingProduct.id);
      setSuccessMessage(`Product "${deletingProduct.name}" deleted successfully.`);
      setDeletingProduct(null);
      fetchProducts();
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Failed to delete product:", err);
      setError("Failed to delete product. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleModalSaveSuccess = () => {
    fetchProducts();
    setSuccessMessage(
      editingProductId ? "Product updated successfully!" : "New product created successfully!"
    );
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "12px",
                fontWeight: "700",
                color: "#166534",
                backgroundColor: "#dcfce7",
                padding: "2px 8px",
                borderRadius: "6px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Catalog Operations
            </span>
            <span style={{ fontSize: "13px", color: "#6b7280" }}>
              Total {stats.total} item{stats.total !== 1 ? "s" : ""}
            </span>
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111827", margin: 0 }}>
            Product Management
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Create and maintain organic products, multi-size variants, photos, and video showcase
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={fetchProducts}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 14px",
              backgroundColor: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={14} className={loading ? "gv-spin" : ""} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleOpenCreateModal}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 18px",
              backgroundColor: "#15803d",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#ffffff",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(21, 128, 61, 0.25)",
            }}
          >
            <Plus size={16} />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 16px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "10px",
            color: "#166534",
            fontSize: "14px",
            fontWeight: "500",
            marginBottom: "20px",
          }}
        >
          <CheckCircle2 size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "#b91c1c",
            fontSize: "14px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError("")}
            style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          padding: "16px 20px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          marginBottom: "20px",
          display: "flex",
          flexWrap: "wrap",
          gap: "14px",
          alignItems: "center",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
          <Search
            size={16}
            style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }}
          />
          <input
            type="text"
            placeholder="Search products by name or details..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              width: "100%",
              padding: "9px 12px 9px 36px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: "600", color: "#4b5563" }}>Category:</label>
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              backgroundColor: "#ffffff",
              color: "#374151",
              outline: "none",
            }}
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.slug || cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: "600", color: "#4b5563" }}>Status:</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              backgroundColor: "#ffffff",
              color: "#374151",
              outline: "none",
            }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        {/* Stock Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label style={{ fontSize: "12px", fontWeight: "600", color: "#4b5563" }}>Stock:</label>
          <select
            value={selectedStock}
            onChange={(e) => setSelectedStock(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
              backgroundColor: "#ffffff",
              color: "#374151",
              outline: "none",
            }}
          >
            <option value="all">All Inventory</option>
            <option value="in_stock">In Stock (&gt;0)</option>
            <option value="low_stock">Low Stock (≤5)</option>
            <option value="out_of_stock">Out of Stock (0)</option>
          </select>
        </div>

        {/* Reset button if filtered */}
        {(searchQuery || selectedCategory !== "all" || selectedStatus !== "all" || selectedStock !== "all") && (
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
              setSelectedStatus("all");
              setSelectedStock("all");
              setCurrentPage(1);
            }}
            style={{
              padding: "8px 12px",
              backgroundColor: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: "600",
              color: "#4b5563",
              cursor: "pointer",
            }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Main Table or Loading/Empty States */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#6b7280" }}>
            <RefreshCw size={24} className="gv-spin" style={{ margin: "0 auto 12px", display: "block" }} />
            <p style={{ fontSize: "14px", margin: 0 }}>Loading product inventory...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: "#f0fdf4",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <Package size={24} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#111827", marginBottom: "6px" }}>
              No products found
            </h3>
            <p style={{ fontSize: "13px", color: "#6b7280", maxWidth: "380px", margin: "0 auto 16px" }}>
              {searchQuery || selectedCategory !== "all" || selectedStatus !== "all" || selectedStock !== "all"
                ? "No products match the selected filter criteria. Try clearing search keywords or filters."
                : "Your store does not have any products yet. Get started by creating your first product."}
            </p>
            {searchQuery || selectedCategory !== "all" || selectedStatus !== "all" || selectedStock !== "all" ? (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                  setSelectedStatus("all");
                  setSelectedStock("all");
                  setCurrentPage(1);
                }}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                Clear Filters
              </button>
            ) : (
              <button
                onClick={handleOpenCreateModal}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  backgroundColor: "#15803d",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#ffffff",
                  cursor: "pointer",
                }}
              >
                <Plus size={14} />
                <span>Add Your First Product</span>
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
              <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <tr>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Product</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Category</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Base Price</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Inventory</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Variants</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563" }}>Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "#4b5563", textAlign: "right" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const isExpanded = expandedProductId === p.id;
                  const stockNum = Number(p.stock_quantity) || 0;
                  const variantsCount = p.variants ? p.variants.length : p.variants_count ?? 0;
                  const hasStock = p.is_in_stock !== undefined ? Boolean(p.is_in_stock) : stockNum > 0;
                  const thumb = p.primary_image || (p.images && p.images[0] ? p.images[0].image : null);

                  return (
                    <React.Fragment key={p.id}>
                      <tr
                        style={{
                          borderBottom: "1px solid #f3f4f6",
                          transition: "background-color 0.15s ease",
                        }}
                      >
                      {/* Product thumbnail & name */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "44px",
                              height: "44px",
                              borderRadius: "8px",
                              backgroundColor: "#f3f4f6",
                              overflow: "hidden",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={p.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <Package size={20} color="#9ca3af" />
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: "600", color: "#111827", fontSize: "14px" }}>
                              {p.name}
                            </div>
                            <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                              ID #{p.id} • {p.unit ? `Unit: ${p.unit}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: "600",
                            color: "#166534",
                            backgroundColor: "#f0fdf4",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            border: "1px solid #dcfce7",
                          }}
                        >
                          {p.category_name || "Uncategorized"}
                        </span>
                      </td>

                      {/* Base Price */}
                      <td style={{ padding: "12px 16px", fontWeight: "700", color: "#111827" }}>
                        ₹{Number(p.price || 0).toFixed(2)}
                      </td>

                      {/* Stock Quantity */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              backgroundColor:
                                hasStock ? (stockNum > 5 ? "#16a34a" : "#f59e0b") : "#dc2626",
                            }}
                          />
                          <span
                            style={{
                              fontWeight: "600",
                              color: hasStock ? (stockNum > 5 ? "#15803d" : "#d97706") : "#b91c1c",
                            }}
                          >
                            {stockNum} {variantsCount > 0 ? "in stock (variants)" : (p.unit || "unit")}
                          </span>
                        </div>
                      </td>

                      {/* Variants Count & Expand Action */}
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          type="button"
                          onClick={() => toggleRowExpansion(p.id)}
                          title={variantsCount > 0 ? (isExpanded ? "Collapse variants" : "Expand to view variants") : "Click to view or add variants"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            fontWeight: "600",
                            color: variantsCount > 0 ? "#4338ca" : "#6b7280",
                            backgroundColor: variantsCount > 0 ? "#e0e7ff" : "#f3f4f6",
                            border: `1px solid ${variantsCount > 0 ? "#c7d2fe" : "#e5e7eb"}`,
                            padding: "4px 9px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Layers size={13} color={variantsCount > 0 ? "#4f46e5" : "#9ca3af"} />
                          <span>{variantsCount > 0 ? `${variantsCount} variant${variantsCount !== 1 ? "s" : ""}` : "No variants"}</span>
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "600",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            backgroundColor: p.is_active ? "#f0fdf4" : "#fef2f2",
                            color: p.is_active ? "#15803d" : "#b91c1c",
                            border: `1px solid ${p.is_active ? "#bbf7d0" : "#fecaca"}`,
                          }}
                        >
                          {p.is_active ? "Active" : "Hidden"}
                        </span>
                      </td>

                      {/* Action buttons */}
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <button
                            onClick={() => handleOpenViewModal(p)}
                            title="View Details"
                            style={{
                              padding: "6px",
                              backgroundColor: "#f9fafb",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              color: "#4b5563",
                              cursor: "pointer",
                            }}
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => handleOpenEditModal(p)}
                            title="Edit Product, Photos, Video & Variants"
                            style={{
                              padding: "6px",
                              backgroundColor: "#f0fdf4",
                              border: "1px solid #bbf7d0",
                              borderRadius: "6px",
                              color: "#15803d",
                              cursor: "pointer",
                            }}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => setDeletingProduct(p)}
                            title="Delete Product"
                            style={{
                              padding: "6px",
                              backgroundColor: "#fef2f2",
                              border: "1px solid #fecaca",
                              borderRadius: "6px",
                              color: "#b91c1c",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Expandable Variants Panel */}
                    {isExpanded && (
                      <tr key={`${p.id}-variants`} style={{ backgroundColor: "#f8fafc" }}>
                        <td colSpan={7} style={{ padding: "16px 20px", borderBottom: "2px solid #e2e8f0" }}>
                          <div
                            style={{
                              backgroundColor: "#ffffff",
                              borderRadius: "10px",
                              border: "1px solid #e2e8f0",
                              padding: "16px 18px",
                              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "14px",
                                flexWrap: "wrap",
                                gap: "10px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div
                                  style={{
                                    width: "28px",
                                    height: "28px",
                                    borderRadius: "6px",
                                    backgroundColor: "#f0fdf4",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Layers size={15} color="#15803d" />
                                </div>
                                <div>
                                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#111827" }}>
                                    Package Variants for "{p.name}"
                                  </span>
                                  <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "6px" }}>
                                    ({(p.variants || []).length} configured)
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(p, "variants")}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  backgroundColor: "#f0fdf4",
                                  border: "1px solid #bbf7d0",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "#15803d",
                                  cursor: "pointer",
                                }}
                              >
                                <Plus size={13} />
                                <span>Manage / Add Variant</span>
                              </button>
                            </div>

                            {(!p.variants || p.variants.length === 0) ? (
                              <div
                                style={{
                                  padding: "24px 20px",
                                  textAlign: "center",
                                  backgroundColor: "#f9fafb",
                                  borderRadius: "8px",
                                  border: "1px dashed #d1d5db",
                                }}
                              >
                                <p style={{ margin: 0, fontSize: "13px", fontWeight: "600", color: "#374151" }}>
                                  No variants configured for this product.
                                </p>
                                <p style={{ margin: "4px 0 12px 0", fontSize: "12px", color: "#6b7280" }}>
                                  This product is sold using the base price of ₹{Number(p.price).toFixed(2)} with base inventory of {p.stock_quantity} {p.unit || "unit"}.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(p, "variants")}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "6px 14px",
                                    backgroundColor: "#15803d",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                  }}
                                >
                                  <Plus size={13} />
                                  <span>Add First Variant</span>
                                </button>
                              </div>
                            ) : (
                              <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                                  <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                                    <tr>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>SKU</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>Size / Pack Quantity</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>Selling Price</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>MRP</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>Stock</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563" }}>Status</th>
                                      <th style={{ padding: "9px 12px", fontWeight: "600", color: "#4b5563", textAlign: "right" }}>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(p.variants || []).map((v) => {
                                      const variantPrice = parseFloat(v.price) || 0;
                                      const variantMrp = parseFloat(v.mrp) || 0;
                                      const variantQty = parseFloat(v.quantity) || 0;
                                      const variantStock = Number(v.stock_quantity) || 0;

                                      return (
                                        <tr key={v.id || v.sku} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                          <td style={{ padding: "9px 12px", fontWeight: "600", color: "#111827" }}>
                                            <code>{v.sku || "—"}</code>
                                          </td>
                                          <td style={{ padding: "9px 12px", color: "#374151" }}>
                                            {variantQty} {v.unit || ""}
                                          </td>
                                          <td style={{ padding: "9px 12px", fontWeight: "700", color: "#15803d" }}>
                                            ₹{variantPrice.toFixed(2)}
                                          </td>
                                          <td style={{ padding: "9px 12px", color: "#6b7280", textDecoration: variantMrp > variantPrice ? "line-through" : "none" }}>
                                            {variantMrp > 0 ? `₹${variantMrp.toFixed(2)}` : "—"}
                                          </td>
                                          <td style={{ padding: "9px 12px" }}>
                                            <span
                                              style={{
                                                display: "inline-block",
                                                padding: "2px 8px",
                                                borderRadius: "10px",
                                                fontSize: "11px",
                                                fontWeight: "600",
                                                backgroundColor: variantStock > 5 ? "#f0fdf4" : variantStock > 0 ? "#fffbeb" : "#fef2f2",
                                                color: variantStock > 5 ? "#166534" : variantStock > 0 ? "#b45309" : "#b91c1c",
                                              }}
                                            >
                                              {variantStock} in stock
                                            </span>
                                          </td>
                                        <td style={{ padding: "9px 12px" }}>
                                          <span
                                            style={{
                                              fontSize: "11px",
                                              padding: "2px 6px",
                                              borderRadius: "4px",
                                              fontWeight: "600",
                                              backgroundColor: v.is_active ? "#f0fdf4" : "#f3f4f6",
                                              color: v.is_active ? "#15803d" : "#6b7280",
                                              border: `1px solid ${v.is_active ? "#bbf7d0" : "#e5e7eb"}`,
                                            }}
                                          >
                                            {v.is_active ? "Active" : "Inactive"}
                                          </span>
                                        </td>
                                        <td style={{ padding: "9px 12px", textAlign: "right" }}>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenEditModal(p, "variants")}
                                            title="Edit this variant"
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: "4px",
                                              padding: "4px 8px",
                                              backgroundColor: "#f9fafb",
                                              border: "1px solid #d1d5db",
                                              borderRadius: "5px",
                                              fontSize: "11px",
                                              fontWeight: "600",
                                              color: "#374151",
                                              cursor: "pointer",
                                            }}
                                          >
                                            <Edit2 size={12} />
                                            <span>Edit</span>
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalCount > pageSize && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 20px",
              borderTop: "1px solid #e5e7eb",
              backgroundColor: "#f9fafb",
            }}
          >
            <span style={{ fontSize: "13px", color: "#6b7280" }}>
              Showing {(currentPage - 1) * pageSize + 1} to{" "}
              {Math.min(currentPage * pageSize, totalCount)} of {totalCount} products
            </span>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                disabled={currentPage <= 1 || loading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "600",
                  color: currentPage <= 1 ? "#9ca3af" : "#374151",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                <ChevronLeft size={14} />
                <span>Prev</span>
              </button>

              <button
                disabled={currentPage * pageSize >= totalCount || loading}
                onClick={() => setCurrentPage((p) => p + 1)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "600",
                  color: currentPage * pageSize >= totalCount ? "#9ca3af" : "#374151",
                  cursor: currentPage * pageSize >= totalCount ? "not-allowed" : "pointer",
                }}
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Product Create / Edit Modal */}
      {isFormModalOpen && (
        <AdminProductModal
          isOpen={isFormModalOpen}
          productId={editingProductId}
          product={editingProduct}
          initialTab={initialModalTab}
          onClose={() => {
            setIsFormModalOpen(false);
            setEditingProductId(null);
            setEditingProduct(null);
            fetchProducts();
          }}
          onSaved={handleModalSaveSuccess}
          onSuccess={handleModalSaveSuccess}
        />
      )}

      {/* Product Details Modal */}
      {viewingProduct && (
        <AdminProductDetailsModal
          product={viewingProduct}
          onClose={() => setViewingProduct(null)}
          onEdit={(prod) => {
            setViewingProduct(null);
            handleOpenEditModal(prod);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "20px",
          }}
          onClick={() => !isDeleting && setDeletingProduct(null)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "460px",
              padding: "24px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "10px",
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  Delete Product?
                </h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0" }}>
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <p style={{ fontSize: "14px", color: "#374151", lineHeight: "1.5", marginBottom: "20px" }}>
              Are you sure you want to permanently remove{" "}
              <strong>"{deletingProduct.name}"</strong>? All associated pack variants, gallery photos, and promotional video will also be removed.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingProduct(null)}
                style={{
                  padding: "9px 16px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#374151",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "9px 18px",
                  backgroundColor: "#dc2626",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#ffffff",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 4px rgba(220, 38, 38, 0.25)",
                }}
              >
                {isDeleting ? (
                  <>
                    <RefreshCw size={14} className="gv-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
