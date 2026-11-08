import React, { useState, useEffect, useCallback } from "react";
import {
  FolderTree,
  Plus,
  Search,
  RefreshCw,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Package,
  AlertTriangle,
} from "lucide-react";
import {
  getAdminCategoriesList,
  createAdminCategory,
  updateAdminCategory,
  deleteAdminCategory,
} from "../../services/adminService";

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [formData, setFormData] = useState({ name: "", slug: "", description: "" });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Deletion modal state
  const [deletingCategory, setDeletingCategory] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const pageSize = 12;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const fetchCategories = useCallback(
    async (page = 1, search = "") => {
      setLoading(true);
      setError("");
      try {
        const res = await getAdminCategoriesList({
          page,
          page_size: pageSize,
          search,
          ordering: "-created_at",
        });
        setCategories(res?.results || []);
        setTotalCount(res?.count || 0);
        setCurrentPage(page);
      } catch (err) {
        setError(
          err?.response?.data?.detail || "Failed to load categories from server."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCategories(1, searchQuery);
  }, [fetchCategories]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchCategories(1, searchQuery);
  };

  const handleOpenCreateModal = () => {
    setModalMode("create");
    setSelectedCategory(null);
    setFormData({ name: "", slug: "", description: "" });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cat) => {
    setModalMode("edit");
    setSelectedCategory(cat);
    setFormData({
      name: cat.name || "",
      slug: cat.slug || "",
      description: cat.description || "",
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.name.trim()) {
      errs.name = "Category name is required.";
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormErrors({});
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description ? formData.description.trim() : "",
      };
      if (formData.slug && formData.slug.trim()) {
        payload.slug = formData.slug.trim().toLowerCase();
      }

      if (modalMode === "create") {
        await createAdminCategory(payload);
        showToast("Category created successfully.");
      } else {
        await updateAdminCategory(selectedCategory.id, payload);
        showToast("Category updated successfully.");
      }

      setIsModalOpen(false);
      fetchCategories(currentPage, searchQuery);
    } catch (err) {
      const backendErrors = err?.response?.data;
      if (backendErrors && typeof backendErrors === "object") {
        const formatted = {};
        for (const [key, val] of Object.entries(backendErrors)) {
          formatted[key] = Array.isArray(val) ? val.join(" ") : String(val);
        }
        setFormErrors(formatted);
      } else {
        showToast(
          err?.response?.data?.detail || "Failed to save category. Please try again.",
          "error"
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDeleteModal = (cat) => {
    setDeletingCategory(cat);
    setDeleteError("");
  };

  const handleConfirmDelete = async () => {
    if (!deletingCategory) return;
    if (deletingCategory.products_count > 0) {
      setDeleteError(
        `Cannot delete "${deletingCategory.name}" because it contains ${deletingCategory.products_count} active product(s). Please reassign or delete these products first.`
      );
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteAdminCategory(deletingCategory.id);
      showToast(`Category "${deletingCategory.name}" deleted successfully.`);
      setDeletingCategory(null);
      // Refresh list, adjusting page if needed
      const remainingOnPage = categories.length - 1;
      const targetPage = remainingOnPage === 0 && currentPage > 1 ? currentPage - 1 : currentPage;
      fetchCategories(targetPage, searchQuery);
    } catch (err) {
      const errMsg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Failed to delete category.";
      setDeleteError(errMsg);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            backgroundColor: toast.type === "error" ? "#ef4444" : "#15803d",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            fontWeight: "500",
            zIndex: 1000,
          }}
        >
          {toast.type === "error" ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#111827", margin: 0 }}>
            Category Management
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Total classification categories: <strong style={{ color: "#111827" }}>{totalCount}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            onClick={() => fetchCategories(currentPage, searchQuery)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 14px",
              backgroundColor: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "500",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={14} />
            <span>Reload</span>
          </button>
          <button
            onClick={handleOpenCreateModal}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 16px",
              backgroundColor: "#15803d",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#ffffff",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(21, 128, 61, 0.25)",
            }}
          >
            <Plus size={16} />
            <span>Add Category</span>
          </button>
        </div>
      </div>

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
          gap: "16px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <form
          onSubmit={handleSearchSubmit}
          style={{
            flex: "1 1 300px",
            display: "flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          <Search
            size={18}
            color="#9ca3af"
            style={{ position: "absolute", left: "12px" }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories by name or description..."
            style={{
              width: "100%",
              padding: "9px 12px 9px 38px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </form>
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              fetchCategories(1, "");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              backgroundColor: "#f3f4f6",
              border: "none",
              color: "#4b5563",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Clear Search
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "#b91c1c",
            marginBottom: "20px",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Table Card */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: "14px",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f9fafb",
                  borderBottom: "1px solid #e5e7eb",
                  color: "#4b5563",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <th style={{ padding: "14px 20px" }}>Category Name</th>
                <th style={{ padding: "14px 20px" }}>Slug</th>
                <th style={{ padding: "14px 20px" }}>Assigned Products</th>
                <th style={{ padding: "14px 20px" }}>Created Date</th>
                <th style={{ padding: "14px 20px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ padding: "48px 20px", textAlign: "center", color: "#6b7280" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      <RefreshCw size={18} className="gv-spin" />
                      <span>Loading categories...</span>
                    </div>
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ padding: "48px 20px", textAlign: "center", color: "#6b7280" }}>
                    <FolderTree size={32} color="#9ca3af" style={{ margin: "0 auto 8px" }} />
                    <p style={{ fontWeight: "600", color: "#374151", margin: "0 0 4px" }}>
                      No categories found
                    </p>
                    <p style={{ fontSize: "13px", margin: 0 }}>
                      {searchQuery
                        ? "Try modifying your search criteria."
                        : "Click 'Add Category' above to create your first category."}
                    </p>
                  </td>
                </tr>
              ) : (
                categories.map((cat) => {
                  const hasProducts = (cat.products_count || 0) > 0;
                  return (
                    <tr
                      key={cat.id}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        transition: "background-color 0.1s ease",
                      }}
                    >
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ fontWeight: "600", color: "#111827" }}>
                          {cat.name}
                        </div>
                        {cat.description && (
                          <div
                            style={{
                              fontSize: "13px",
                              color: "#6b7280",
                              marginTop: "2px",
                              maxWidth: "360px",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {cat.description}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "16px 20px", color: "#4b5563" }}>
                        <code
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: "#f3f4f6",
                            fontSize: "12px",
                            color: "#1f2937",
                          }}
                        >
                          {cat.slug}
                        </code>
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "4px 10px",
                            borderRadius: "9999px",
                            fontSize: "12px",
                            fontWeight: "600",
                            backgroundColor: hasProducts ? "#eff6ff" : "#f3f4f6",
                            color: hasProducts ? "#1d4ed8" : "#6b7280",
                            border: `1px solid ${hasProducts ? "#bfdbfe" : "#e5e7eb"}`,
                          }}
                        >
                          <Package size={13} />
                          <span>{cat.products_count || 0} products</span>
                        </span>
                      </td>
                      <td style={{ padding: "16px 20px", color: "#6b7280", fontSize: "13px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <Calendar size={14} color="#9ca3af" />
                          <span>{formatDate(cat.created_at)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "16px 20px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "8px" }}>
                          <button
                            onClick={() => handleOpenEditModal(cat)}
                            title="Edit Category"
                            style={{
                              padding: "6px 10px",
                              borderRadius: "6px",
                              backgroundColor: "#ffffff",
                              border: "1px solid #d1d5db",
                              color: "#374151",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: "500",
                            }}
                          >
                            <Edit2 size={13} />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => handleOpenDeleteModal(cat)}
                            title={
                              hasProducts
                                ? "Cannot delete category with active products"
                                : "Delete Category"
                            }
                            style={{
                              padding: "6px 10px",
                              borderRadius: "6px",
                              backgroundColor: hasProducts ? "#f9fafb" : "rgba(239, 68, 68, 0.08)",
                              border: `1px solid ${hasProducts ? "#e5e7eb" : "rgba(239, 68, 68, 0.25)"}`,
                              color: hasProducts ? "#9ca3af" : "#dc2626",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: "500",
                            }}
                          >
                            <Trash2 size={13} />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            fontSize: "13px",
            color: "#6b7280",
          }}
        >
          <div>
            Showing Page <strong style={{ color: "#111827" }}>{currentPage}</strong> of{" "}
            <strong style={{ color: "#111827" }}>{totalPages}</strong> ({totalCount} total)
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => fetchCategories(currentPage - 1, searchQuery)}
              disabled={currentPage <= 1 || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                color: currentPage <= 1 ? "#9ca3af" : "#374151",
                cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              <ChevronLeft size={16} />
              <span>Previous</span>
            </button>
            <button
              onClick={() => fetchCategories(currentPage + 1, searchQuery)}
              disabled={currentPage >= totalPages || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                color: currentPage >= totalPages ? "#9ca3af" : "#374151",
                cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              <span>Next</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Category Modal */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    backgroundColor: "#f0fdf4",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#15803d",
                  }}
                >
                  <FolderTree size={20} />
                </div>
                <h2 style={{ fontSize: "17px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  {modalMode === "create" ? "Add New Category" : "Edit Category"}
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  padding: "4px",
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleFormSubmit}>
              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Name */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#374151",
                      marginBottom: "6px",
                    }}
                  >
                    Category Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleFormChange}
                    placeholder="e.g. Organic Produce, Cold-Pressed Oils"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: `1px solid ${formErrors.name ? "#ef4444" : "#d1d5db"}`,
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                  {formErrors.name && (
                    <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "4px" }}>
                      {formErrors.name}
                    </div>
                  )}
                </div>

                {/* Slug */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#374151",
                      marginBottom: "6px",
                    }}
                  >
                    URL Slug
                  </label>
                  <input
                    type="text"
                    name="slug"
                    value={formData.slug}
                    onChange={handleFormChange}
                    placeholder="e.g. organic-produce (optional)"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: `1px solid ${formErrors.slug ? "#ef4444" : "#d1d5db"}`,
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                    Leave blank to automatically generate an SEO-friendly URL slug from name.
                  </span>
                  {formErrors.slug && (
                    <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "4px" }}>
                      {formErrors.slug}
                    </div>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#374151",
                      marginBottom: "6px",
                    }}
                  >
                    Description
                  </label>
                  <textarea
                    name="description"
                    rows="3"
                    value={formData.description}
                    onChange={handleFormChange}
                    placeholder="Brief description of items grouped under this classification..."
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                  {formErrors.description && (
                    <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "4px" }}>
                      {formErrors.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: "16px 24px",
                  borderTop: "1px solid #e5e7eb",
                  backgroundColor: "#f9fafb",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    backgroundColor: "#ffffff",
                    color: "#374151",
                    fontSize: "13px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "9px 18px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#15803d",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: submitting ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {submitting && <RefreshCw size={14} className="gv-spin" />}
                  <span>{modalMode === "create" ? "Create Category" : "Save Changes"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Delete Confirmation Modal */}
      {deletingCategory && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              width: "100%",
              maxWidth: "460px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
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
                <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  Delete Category
                </h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0" }}>
                  Confirm deletion for <strong>"{deletingCategory.name}"</strong>
                </p>
              </div>
            </div>

            <div style={{ padding: "20px 24px" }}>
              {deletingCategory.products_count > 0 ? (
                <div
                  style={{
                    backgroundColor: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: "8px",
                    padding: "14px",
                    color: "#92400e",
                    fontSize: "13px",
                    lineHeight: "1.5",
                  }}
                >
                  <div style={{ fontWeight: "700", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <AlertCircle size={16} color="#d97706" />
                    <span>Deletion Prohibited</span>
                  </div>
                  This category contains <strong>{deletingCategory.products_count} active product(s)</strong>.
                  To protect catalog integrity, you must reassign or remove all assigned products before deleting this category.
                </div>
              ) : (
                <p style={{ fontSize: "14px", color: "#4b5563", margin: 0, lineHeight: "1.5" }}>
                  Are you sure you want to permanently delete this category? This action cannot be undone.
                </p>
              )}

              {deleteError && (
                <div
                  style={{
                    marginTop: "14px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    padding: "12px",
                    color: "#b91c1c",
                    fontSize: "13px",
                  }}
                >
                  {deleteError}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  color: "#374151",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingCategory.products_count > 0 || isDeleting}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: deletingCategory.products_count > 0 ? "#9ca3af" : "#dc2626",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: deletingCategory.products_count > 0 || isDeleting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isDeleting && <RefreshCw size={14} className="gv-spin" />}
                <span>{deletingCategory.products_count > 0 ? "Deletion Blocked" : "Confirm Delete"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

