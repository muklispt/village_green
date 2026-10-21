import React, { useState, useEffect } from "react";
import {
  X,
  Package,
  Layers,
  IndianRupee,
  Boxes,
  CheckCircle2,
  XCircle,
  Film,
  Image as ImageIcon,
  Edit,
  Tag,
  RefreshCw,
} from "lucide-react";
import { getAdminProductVariants } from "../../services/adminService";

/**
 * AdminProductDetailsModal
 * Clean read-only inspection modal for complete product details, variants, photos, and video.
 */
export default function AdminProductDetailsModal({
  product,
  onClose,
  onEdit,
}) {
  const [variants, setVariants] = useState(() => (Array.isArray(product?.variants) ? product.variants : []));
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [errorVariants, setErrorVariants] = useState("");

  useEffect(() => {
    if (!product?.id) {
      setVariants([]);
      return;
    }
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      setVariants(product.variants);
    } else {
      setLoadingVariants(true);
      setErrorVariants("");
      getAdminProductVariants(product.id)
        .then((vars) => {
          if (Array.isArray(vars)) {
            setVariants(vars);
          }
        })
        .catch((err) => {
          console.error("Failed to load variants in detail modal:", err);
          setErrorVariants(err.response?.data?.detail || "Could not load variants from server.");
        })
        .finally(() => {
          setLoadingVariants(false);
        });
    }
  }, [product?.id, product?.variants]);

  if (!product) return null;

  const images = product.images || [];
  const video = product.promotion_video || product.video;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1050,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "880px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid #e5e7eb",
            backgroundColor: "#f9fafb",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "700",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#166534",
                  backgroundColor: "#dcfce7",
                  padding: "3px 10px",
                  borderRadius: "9999px",
                }}
              >
                {product.category_name || "Uncategorized"}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "12px",
                  fontWeight: "600",
                  color: product.is_active ? "#15803d" : "#b91c1c",
                  backgroundColor: product.is_active ? "#f0fdf4" : "#fef2f2",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  border: `1px solid ${product.is_active ? "#bbf7d0" : "#fecaca"}`,
                }}
              >
                {product.is_active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {product.is_active ? "Active in Catalog" : "Inactive / Hidden"}
              </span>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                ID: #{product.id} • Slug: <code style={{ color: "#374151" }}>{product.slug}</code>
              </span>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#111827", margin: 0 }}>
              {product.name}
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
              display: "flex",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Quick Metrics Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "12px",
            }}
          >
            <div style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" }}>
                <IndianRupee size={13} /> Base Price
              </div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a" }}>
                ₹{Number(product.price).toFixed(2)}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>Per {product.unit || "unit"}</div>
            </div>

            <div style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" }}>
                <Boxes size={13} /> Inventory Stock
              </div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: product.stock_quantity > 0 ? "#15803d" : "#dc2626" }}>
                {product.stock_quantity} {product.unit}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                {product.stock_quantity > 5 ? "In Stock" : product.stock_quantity > 0 ? "Low Stock" : "Out of Stock"}
              </div>
            </div>

            <div style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" }}>
                <Layers size={13} /> Variants
              </div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a" }}>
                {variants.length} option{variants.length !== 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>Configured pack sizes</div>
            </div>

            <div style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" }}>
                <ImageIcon size={13} /> Photos / Video
              </div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a" }}>
                {images.length} photo{images.length !== 1 ? "s" : ""} {video ? "+ 1 video" : ""}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>Media assets</div>
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Description
            </h3>
            <div
              style={{
                padding: "14px 16px",
                backgroundColor: "#f9fafb",
                borderRadius: "10px",
                border: "1px solid #e5e7eb",
                fontSize: "14px",
                color: "#4b5563",
                lineHeight: "1.6",
                whiteSpace: "pre-line",
              }}
            >
              {product.description || "No description provided."}
            </div>
          </div>

          {/* Media Section: Photos & Video */}
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.03em", display: "flex", alignItems: "center", gap: "6px" }}>
              <ImageIcon size={16} /> Product Photos & Media
            </h3>

            {images.length === 0 && !video ? (
              <p style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
                No media files uploaded for this product yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Images grid */}
                {images.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "12px" }}>
                    {images.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          position: "relative",
                          border: img.is_primary ? "2px solid #16a34a" : "1px solid #e5e7eb",
                          borderRadius: "10px",
                          overflow: "hidden",
                          aspectRatio: "1",
                          backgroundColor: "#f3f4f6",
                        }}
                      >
                        <img
                          src={img.image}
                          alt={img.alt_text || product.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        {img.is_primary && (
                          <span
                            style={{
                              position: "absolute",
                              top: "6px",
                              left: "6px",
                              backgroundColor: "#15803d",
                              color: "#fff",
                              fontSize: "10px",
                              fontWeight: "700",
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            Primary
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Video Preview */}
                {video && (
                  <div style={{ padding: "14px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <Film size={16} color="#2563eb" />
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "#1e293b" }}>
                        Promotional Video: {video.title || "Product Showcase"}
                      </span>
                    </div>
                    <video
                      controls
                      src={video.video}
                      style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", backgroundColor: "#000" }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Variants Table */}
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.03em", display: "flex", alignItems: "center", gap: "6px" }}>
              <Tag size={16} /> Variants & Pack Sizes ({variants.length})
            </h3>

            {loadingVariants ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#6b7280" }}>
                <RefreshCw size={18} className="gv-spin" style={{ margin: "0 auto 8px", display: "block" }} />
                <p style={{ fontSize: "13px", margin: 0 }}>Loading package options...</p>
              </div>
            ) : errorVariants ? (
              <div style={{ padding: "14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#b91c1c", fontSize: "13px" }}>
                {errorVariants}
              </div>
            ) : variants.length === 0 ? (
              <div style={{ padding: "18px 20px", backgroundColor: "#f9fafb", borderRadius: "10px", border: "1px dashed #d1d5db" }}>
                <p style={{ fontSize: "13px", color: "#4b5563", margin: 0, fontWeight: "600" }}>
                  No variants configured for this product.
                </p>
                <p style={{ fontSize: "12px", color: "#6b7280", margin: "4px 0 0" }}>
                  This product is sold at the base price of ₹{Number(product.price).toFixed(2)} with base inventory of {product.stock_quantity} {product.unit || "unit"}.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "10px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                  <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <tr>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>SKU</th>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>Size / Unit</th>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>Selling Price</th>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>MRP</th>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>Stock</th>
                      <th style={{ padding: "10px 14px", color: "#4b5563", fontWeight: "600" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v) => (
                      <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "10px 14px", fontWeight: "600", color: "#111827" }}>
                          <code>{v.sku}</code>
                        </td>
                        <td style={{ padding: "10px 14px", color: "#374151" }}>
                          {parseFloat(v.quantity)} {v.unit}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: "700", color: "#15803d" }}>
                          ₹{Number(v.price).toFixed(2)}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#6b7280" }}>
                          {v.mrp ? `₹${Number(v.mrp).toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            style={{
                              fontWeight: "600",
                              color: v.stock_quantity > 5 ? "#15803d" : v.stock_quantity > 0 ? "#d97706" : "#dc2626",
                            }}
                          >
                            {v.stock_quantity} units
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: "600",
                              color: v.is_active ? "#15803d" : "#9ca3af",
                              backgroundColor: v.is_active ? "#f0fdf4" : "#f3f4f6",
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            {v.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "10px",
            padding: "16px 24px",
            borderTop: "1px solid #e5e7eb",
            backgroundColor: "#f9fafb",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              backgroundColor: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              color: "#374151",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          {onEdit && (
            <button
              onClick={() => {
                onClose();
                onEdit(product);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                backgroundColor: "#15803d",
                border: "none",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(21, 128, 61, 0.2)",
              }}
            >
              <Edit size={14} />
              <span>Edit Product</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
