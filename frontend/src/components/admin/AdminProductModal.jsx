import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Upload,
  Plus,
  Trash2,
  Check,
  Star,
  Film,
  Image as ImageIcon,
  Layers,
  AlertCircle,
  RefreshCw,
  Edit2,
  Save,
  CheckCircle2,
} from "lucide-react";
import {
  PRODUCT_UNIT_CHOICES,
  getAdminProductById,
  mapProductToFormData,
  createAdminProduct,
  updateAdminProduct,
  getAdminCategories,
  createAdminCategory,
  getAdminProductImages,
  uploadAdminProductImages,
  deleteAdminProductImage,
  setAdminPrimaryProductImage,
  getAdminProductVideos,
  uploadAdminProductVideo,
  deleteAdminProductVideo,
  getAdminProductVariants,
  createAdminProductVariant,
  updateAdminProductVariant,
  deleteAdminProductVariant,
} from "../../services/adminService";
import { resolveImageUrl, resolveMediaUrl } from "../../services/productService";

export default function AdminProductModal({
  isOpen = true,
  onClose,
  product = null, // null for create, object for edit
  productId = null,
  initialTab = "info",
  onSaved,
  onSuccess,
}) {
  const activeProductId = productId || product?.id || null;
  const isEdit = Boolean(activeProductId);
  const [activeTab, setActiveTab] = useState(initialTab || "info");

  // Categories
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  // Form State
  const [formData, setFormData] = useState(() => mapProductToFormData(product));

  // Current product ID (either from editing product or after creation)
  const [persistedId, setPersistedId] = useState(activeProductId);
  const [loadingProduct, setLoadingProduct] = useState(false);

  // Status & Feedback
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [successMsg, setSuccessMsg] = useState("");

  // Media: Images
  const [images, setImages] = useState(() => (Array.isArray(product?.images) ? product.images : []));
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedImageFiles, setSelectedImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  // Media: Video
  const [videoObj, setVideoObj] = useState(() => product?.promotion_video || product?.video || null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [selectedVideoFile, setSelectedVideoFile] = useState(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // Variants
  const [variants, setVariants] = useState(() => (Array.isArray(product?.variants) ? product.variants : []));
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState(null);
  const [variantForm, setVariantForm] = useState({
    sku: "",
    quantity: "1",
    unit: "kg",
    price: "",
    mrp: "",
    stock_quantity: 10,
    is_active: true,
  });
  const [variantError, setVariantError] = useState("");
  const [submittingVariant, setSubmittingVariant] = useState(false);

  // Load categories (never overwrite an editing product's category)
  useEffect(() => {
    let isCancelled = false;
    async function loadCats() {
      try {
        setLoadingCategories(true);
        const cats = await getAdminCategories();
        if (isCancelled) return;
        const catList = Array.isArray(cats) ? cats : cats.results || [];
        setCategories(catList);
        // Only set default category for NEW product creation
        if (catList.length > 0 && !activeProductId) {
          setFormData((prev) => {
            if (!prev.product_category) {
              return { ...prev, product_category: catList[0].id };
            }
            return prev;
          });
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load categories", err);
        }
      } finally {
        if (!isCancelled) {
          setLoadingCategories(false);
        }
      }
    }
    if (isOpen) {
      loadCats();
    }
    return () => {
      isCancelled = true;
    };
  }, [isOpen, activeProductId]);

  // Fetch images, videos, variants
  const loadMediaAndVariants = useCallback(async (prodId) => {
    if (!prodId) return;

    // Load images
    setLoadingImages(true);
    try {
      const imgs = await getAdminProductImages(prodId);
      setImages(imgs);
    } catch {
      // Ignored
    } finally {
      setLoadingImages(false);
    }

    // Load video
    setLoadingVideo(true);
    try {
      const vids = await getAdminProductVideos(prodId);
      setVideoObj(vids.length > 0 ? vids[0] : null);
    } catch {
      // Ignored
    } finally {
      setLoadingVideo(false);
    }

    // Load variants
    setLoadingVariants(true);
    setVariantError("");
    try {
      const vars = await getAdminProductVariants(prodId);
      if (Array.isArray(vars)) {
        setVariants(vars);
      }
    } catch (err) {
      console.error("Failed to load variants:", err);
      setVariantError(
        err.response?.data?.detail || "Could not load variants from server. Please check your connection."
      );
    } finally {
      setLoadingVariants(false);
    }
  }, []);

  // Populate form on open / activeProductId change
  useEffect(() => {
    let isCancelled = false;

    async function initForm() {
      if (activeProductId) {
        setPersistedId(activeProductId);
        setLoadingProduct(true);
        setErrorMsg("");
        setFieldErrors({});

        // If product prop is already provided, pre-populate immediately to eliminate empty flash
        if (product && (product.id === activeProductId || !product.id)) {
          setFormData(mapProductToFormData(product));
          if (Array.isArray(product.images) && product.images.length > 0) {
            setImages(product.images);
          }
          if (product.promotion_video || product.video) {
            setVideoObj(product.promotion_video || product.video);
          }
          if (Array.isArray(product.variants) && product.variants.length > 0) {
            setVariants(product.variants);
          }
        }

        try {
          // Authoritative fetch from server endpoint
          const fetched = await getAdminProductById(activeProductId);
          if (isCancelled) return;

          const fullProduct = (fetched && typeof fetched === "object")
            ? (fetched.data || fetched.result || fetched)
            : fetched;

          if (fullProduct) {
            setFormData(mapProductToFormData(fullProduct));

            if (Array.isArray(fullProduct.images)) {
              setImages(fullProduct.images);
            }
            if (fullProduct.promotion_video !== undefined) {
              setVideoObj(fullProduct.promotion_video);
            } else if (fullProduct.video !== undefined) {
              setVideoObj(fullProduct.video);
            }
            if (Array.isArray(fullProduct.variants)) {
              setVariants(fullProduct.variants);
            }
          }
        } catch (err) {
          if (isCancelled) return;
          console.error("Failed to load product details for editing:", err);
          if (product) {
            setFormData(mapProductToFormData(product));
          } else {
            setErrorMsg("Failed to load product details from server. Please check your connection.");
          }
        } finally {
          if (!isCancelled) {
            setLoadingProduct(false);
          }
        }

        loadMediaAndVariants(activeProductId);
        if (initialTab && ["info", "photos", "video", "variants"].includes(initialTab)) {
          setActiveTab(initialTab);
        }
      } else {
        // Create mode: reset all fields
        setPersistedId(null);
        setFormData({
          name: "",
          product_category: categories[0]?.id || "",
          price: "",
          stock_quantity: 0,
          unit: "kg",
          description: "",
          is_active: true,
        });
        setImages([]);
        setVideoObj(null);
        setVariants([]);
        setSelectedImageFiles([]);
        setImagePreviews([]);
        setActiveTab("info");
        setErrorMsg("");
        setFieldErrors({});
        setSuccessMsg("");
      }
    }

    if (isOpen) {
      initForm();
    }

    return () => {
      isCancelled = true;
    };
  }, [activeProductId, isOpen, loadMediaAndVariants, categories, product]);

  if (!isOpen) return null;

  // Handle Quick Category Create
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const newCat = await createAdminCategory({ name: newCatName.trim() });
      setCategories((prev) => [...prev, newCat]);
      setFormData((prev) => ({ ...prev, product_category: newCat.id }));
      setNewCatName("");
      setShowNewCatInput(false);
    } catch (err) {
      alert(err.response?.data?.name?.[0] || "Could not create category.");
    } finally {
      setCreatingCat(false);
    }
  };

  // Handle Basic Info Save
  const handleSaveBasicInfo = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setFieldErrors({});
    setSuccessMsg("");

    // Validation
    const errors = {};
    if (!formData.name?.trim()) errors.name = "Product name is required.";
    if (!formData.product_category) errors.product_category = "Category is required.";
    if (formData.price === "" || isNaN(parseFloat(formData.price)) || parseFloat(formData.price) < 0) {
      errors.price = "Enter a valid non-negative price.";
    }
    if (formData.stock_quantity === "" || isNaN(parseInt(formData.stock_quantity, 10)) || parseInt(formData.stock_quantity, 10) < 0) {
      errors.stock_quantity = "Stock quantity cannot be negative.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        product_category: formData.product_category,
        price: parseFloat(formData.price).toFixed(2),
        stock_quantity: parseInt(formData.stock_quantity, 10),
        unit: formData.unit || "kg",
        description: (formData.description || "").trim(),
        is_active: Boolean(formData.is_active),
      };

      let result;
      if (persistedId) {
        result = await updateAdminProduct(persistedId, payload);
        if (result) {
          setFormData(mapProductToFormData(result));
        }
        setSuccessMsg("Product updated successfully!");
      } else {
        result = await createAdminProduct(payload);
        setPersistedId(result.id);
        if (result) {
          setFormData(mapProductToFormData(result));
        }
        setSuccessMsg("Product created! Photos, videos, and package variants are now unlocked.");
      }

      // If initial images were queued for upload, upload them now
      if (selectedImageFiles.length > 0) {
        const targetId = persistedId || result.id;
        try {
          const imgData = new FormData();
          imgData.append("product", targetId);
          selectedImageFiles.forEach((file) => {
            imgData.append("images", file);
          });
          await uploadAdminProductImages(imgData);
          setSelectedImageFiles([]);
          setImagePreviews([]);
          const updatedImgs = await getAdminProductImages(targetId);
          setImages(updatedImgs);
        } catch (imgErr) {
          console.error("Initial images upload failed:", imgErr);
        }
      }

      if (onSaved) onSaved(result);
      if (onSuccess) onSuccess(result);
    } catch (err) {
      const respData = err.response?.data;
      if (respData && typeof respData === "object") {
        setFieldErrors(respData);
        setErrorMsg(respData.detail || "Validation failed. Please correct highlighted fields.");
      } else {
        setErrorMsg("Failed to save product. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ----------------- PHOTOS MANAGEMENT -----------------
  const handleImageFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setSelectedImageFiles(files);
    const previews = files.map((file) => ({
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2),
      url: URL.createObjectURL(file),
    }));
    setImagePreviews(previews);
  };

  const handleUploadImages = async () => {
    if (!persistedId || !selectedImageFiles.length) return;
    setUploadingImages(true);
    setErrorMsg("");

    try {
      const data = new FormData();
      data.append("product", persistedId);
      selectedImageFiles.forEach((file) => {
        data.append("images", file);
      });

      await uploadAdminProductImages(data);
      setSelectedImageFiles([]);
      setImagePreviews([]);
      // Reload images list
      const updatedImgs = await getAdminProductImages(persistedId);
      setImages(updatedImgs);
      setSuccessMsg("Images uploaded successfully!");
    } catch (err) {
      setErrorMsg(err.response?.data?.images || err.response?.data?.detail || "Image upload failed.");
    } finally {
      setUploadingImages(false);
    }
  };

  const handleSetPrimaryImage = async (imageId) => {
    try {
      await setAdminPrimaryProductImage(imageId);
      const updated = await getAdminProductImages(persistedId);
      setImages(updated);
    } catch (err) {
      alert("Failed to update primary image.");
    }
  };

  const handleDeleteImage = async (imageId) => {
    if (!window.confirm("Are you sure you want to delete this photo?")) return;
    try {
      await deleteAdminProductImage(imageId);
      setImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      alert("Failed to delete image.");
    }
  };

  // ----------------- VIDEO MANAGEMENT -----------------
  const handleVideoFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedVideoFile(file);
  };

  const handleUploadVideo = async () => {
    if (!persistedId || !selectedVideoFile) return;
    setUploadingVideo(true);
    setErrorMsg("");

    try {
      const data = new FormData();
      data.append("product", persistedId);
      data.append("video", selectedVideoFile);
      if (videoTitle.trim()) {
        data.append("title", videoTitle.trim());
      }

      await uploadAdminProductVideo(data);
      setSelectedVideoFile(null);
      setVideoTitle("");
      const vids = await getAdminProductVideos(persistedId);
      setVideoObj(vids.length > 0 ? vids[0] : null);
      setSuccessMsg("Promotional video uploaded successfully!");
    } catch (err) {
      setErrorMsg(err.response?.data?.video || err.response?.data?.product || "Video upload failed.");
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleDeleteVideo = async () => {
    if (!videoObj?.id) return;
    if (!window.confirm("Remove promotional video from this product?")) return;
    try {
      await deleteAdminProductVideo(videoObj.id);
      setVideoObj(null);
      setSuccessMsg("Video removed.");
    } catch (err) {
      alert("Failed to delete video.");
    }
  };

  // ----------------- VARIANTS MANAGEMENT -----------------
  const handleOpenVariantEditor = (variant = null) => {
    setVariantError("");
    if (variant) {
      setEditingVariantId(variant.id);
      setVariantForm({
        sku: variant.sku,
        quantity: variant.quantity,
        unit: variant.unit,
        price: variant.price,
        mrp: variant.mrp,
        stock_quantity: variant.stock_quantity,
        is_active: variant.is_active,
      });
    } else {
      setEditingVariantId("new");
      // Generate default SKU proposal
      const cleanName = (formData.name || "PROD").slice(0, 4).toUpperCase().replace(/[^A-Z]/g, "");
      setVariantForm({
        sku: `${cleanName}-${Math.floor(100 + Math.random() * 900)}`,
        quantity: "500",
        unit: "g",
        price: formData.price || "100.00",
        mrp: formData.price ? (parseFloat(formData.price) * 1.1).toFixed(2) : "110.00",
        stock_quantity: 10,
        is_active: true,
      });
    }
  };

  const handleSaveVariant = async (e) => {
    e.preventDefault();
    setVariantError("");

    const priceNum = parseFloat(variantForm.price);
    const mrpNum = parseFloat(variantForm.mrp);
    const qtyNum = parseFloat(variantForm.quantity);

    if (!variantForm.sku.trim()) {
      setVariantError("SKU code is required.");
      return;
    }
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setVariantError("Quantity must be greater than zero.");
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      setVariantError("Selling price must be 0 or greater.");
      return;
    }
    if (isNaN(mrpNum) || mrpNum < 0) {
      setVariantError("MRP must be 0 or greater.");
      return;
    }
    if (priceNum > mrpNum) {
      setVariantError("Selling price cannot exceed MRP.");
      return;
    }

    setSubmittingVariant(true);
    try {
      const payload = {
        product: persistedId,
        sku: variantForm.sku.trim().toUpperCase(),
        quantity: qtyNum,
        unit: variantForm.unit,
        price: priceNum.toFixed(2),
        mrp: mrpNum.toFixed(2),
        stock_quantity: parseInt(variantForm.stock_quantity, 10) || 0,
        is_active: variantForm.is_active,
      };

      if (editingVariantId === "new") {
        const created = await createAdminProductVariant(payload);
        setVariants((prev) => [...prev, created]);
      } else {
        const updated = await updateAdminProductVariant(editingVariantId, payload);
        setVariants((prev) => prev.map((v) => (v.id === editingVariantId ? updated : v)));
      }
      setEditingVariantId(null);
      if (onSaved) onSaved();
    } catch (err) {
      const d = err.response?.data;
      if (d?.sku) setVariantError(d.sku[0]);
      else if (d?.price) setVariantError(d.price[0]);
      else if (d?.non_field_errors) setVariantError(d.non_field_errors[0]);
      else setVariantError("Failed to save variant.");
    } finally {
      setSubmittingVariant(false);
    }
  };

  const handleDeleteVariant = async (variantId) => {
    if (!window.confirm("Are you sure you want to delete this variant?")) return;
    try {
      await deleteAdminProductVariant(variantId);
      setVariants((prev) => prev.filter((v) => v.id !== variantId));
      if (onSaved) onSaved();
    } catch (err) {
      alert("Failed to delete variant.");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(13, 32, 21, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
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
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "#f9fafb",
          }}
        >
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
              {isEdit ? `Edit Product: ${formData.name || product?.name || "Product"}` : "Add New Produce"}
            </h2>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "4px 0 0 0" }}>
              {isEdit
                ? "Manage product specification, photography, promo videos, and size variants."
                : "Fill in the harvest details. Photos, promo video, and variants can be added next."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "8px",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
            padding: "0 24px",
            backgroundColor: "#ffffff",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("info")}
            style={{
              padding: "14px 18px",
              fontSize: "13px",
              fontWeight: "600",
              color: activeTab === "info" ? "#15803d" : "#6b7280",
              borderBottom: activeTab === "info" ? "2px solid #15803d" : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>General Info</span>
          </button>

          <button
            type="button"
            onClick={() => persistedId && setActiveTab("photos")}
            disabled={!persistedId}
            style={{
              padding: "14px 18px",
              fontSize: "13px",
              fontWeight: "600",
              color: !persistedId ? "#d1d5db" : activeTab === "photos" ? "#15803d" : "#6b7280",
              borderBottom: activeTab === "photos" ? "2px solid #15803d" : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: persistedId ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <ImageIcon size={15} />
            <span>Photos ({images.length})</span>
          </button>

          <button
            type="button"
            onClick={() => persistedId && setActiveTab("video")}
            disabled={!persistedId}
            style={{
              padding: "14px 18px",
              fontSize: "13px",
              fontWeight: "600",
              color: !persistedId ? "#d1d5db" : activeTab === "video" ? "#15803d" : "#6b7280",
              borderBottom: activeTab === "video" ? "2px solid #15803d" : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: persistedId ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Film size={15} />
            <span>Promo Video {videoObj ? "✓" : ""}</span>
          </button>

          <button
            type="button"
            onClick={() => persistedId && setActiveTab("variants")}
            disabled={!persistedId}
            style={{
              padding: "14px 18px",
              fontSize: "13px",
              fontWeight: "600",
              color: !persistedId ? "#d1d5db" : activeTab === "variants" ? "#15803d" : "#6b7280",
              borderBottom: activeTab === "variants" ? "2px solid #15803d" : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: persistedId ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Layers size={15} />
            <span>Variants ({variants.length})</span>
          </button>
        </div>

        {/* Feedback Toasts */}
        {errorMsg && (
          <div
            style={{
              margin: "16px 24px 0 24px",
              padding: "12px 16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#b91c1c",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div
            style={{
              margin: "16px 24px 0 24px",
              padding: "12px 16px",
              backgroundColor: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "8px",
              color: "#166534",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {loadingProduct && !formData.name ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                color: "#166534",
              }}
            >
              <RefreshCw size={28} className="gv-spin" style={{ marginBottom: "12px" }} />
              <p style={{ fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                Loading product details...
              </p>
            </div>
          ) : (
            <>
              {/* TAB 1: BASIC INFO */}
          {activeTab === "info" && (
            <form onSubmit={handleSaveBasicInfo} id="product-info-form">
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px", marginBottom: "18px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                    Product Name <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Organic Alphonso Mangoes"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: fieldErrors.name ? "1px solid #ef4444" : "1px solid #d1d5db",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                  {fieldErrors.name && (
                    <span style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", display: "block" }}>
                      {Array.isArray(fieldErrors.name) ? fieldErrors.name[0] : fieldErrors.name}
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151" }}>
                      Category <span style={{ color: "#dc2626" }}>*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewCatInput(!showNewCatInput)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#15803d",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      {showNewCatInput ? "Cancel" : "+ New"}
                    </button>
                  </div>

                  {showNewCatInput ? (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="Category name"
                        style={{
                          flex: 1,
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #d1d5db",
                          fontSize: "13px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCreateCategory}
                        disabled={creatingCat || !newCatName.trim()}
                        style={{
                          padding: "8px 12px",
                          backgroundColor: "#15803d",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        {creatingCat ? "..." : "Add"}
                      </button>
                    </div>
                  ) : (
                    <select
                      value={formData.product_category}
                      onChange={(e) => setFormData({ ...formData, product_category: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: fieldErrors.product_category ? "1px solid #ef4444" : "1px solid #d1d5db",
                        fontSize: "14px",
                        backgroundColor: "#fff",
                      }}
                    >
                      <option value="">Select Category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      {Boolean(
                        formData.product_category &&
                        !categories.some((c) => String(c.id) === String(formData.product_category))
                      ) && (
                        <option value={formData.product_category}>
                          Current Category ({String(formData.product_category).slice(0, 8)}...)
                        </option>
                      )}
                    </select>
                  )}
                  {fieldErrors.product_category && (
                    <span style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", display: "block" }}>
                      {Array.isArray(fieldErrors.product_category) ? fieldErrors.product_category[0] : fieldErrors.product_category}
                    </span>
                  )}
                </div>
              </div>

              {/* Price, Stock, Unit Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", marginBottom: "18px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                    Price (₹) <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0.00"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: fieldErrors.price ? "1px solid #ef4444" : "1px solid #d1d5db",
                      fontSize: "14px",
                    }}
                  />
                  {fieldErrors.price && (
                    <span style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", display: "block" }}>
                      {fieldErrors.price}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                    Stock Quantity <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.stock_quantity}
                    onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: fieldErrors.stock_quantity ? "1px solid #ef4444" : "1px solid #d1d5db",
                      fontSize: "14px",
                    }}
                  />
                  {fieldErrors.stock_quantity && (
                    <span style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", display: "block" }}>
                      {fieldErrors.stock_quantity}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                    Sales Unit
                  </label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      backgroundColor: "#fff",
                    }}
                  >
                    {PRODUCT_UNIT_CHOICES.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                  Product Story & Cultivation Details
                </label>
                <textarea
                  rows={4}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe farm origin, taste profile, harvest date, and storage guidance..."
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Initial Product Photos (especially helpful during product creation) */}
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "6px" }}>
                  Product Photos {isEdit ? "(Add More Photos)" : "(Initial Photos)"}
                </label>
                <div
                  style={{
                    border: "2px dashed #d1d5db",
                    borderRadius: "8px",
                    padding: "16px",
                    backgroundColor: "#f9fafb",
                    textAlign: "center",
                  }}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    id="info-photo-input"
                    onChange={handleImageFileSelect}
                    style={{ display: "none" }}
                  />
                  <label
                    htmlFor="info-photo-input"
                    style={{
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      backgroundColor: "#ffffff",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#374151",
                    }}
                  >
                    <Upload size={14} />
                    <span>Choose Images to Upload</span>
                  </label>
                  <p style={{ fontSize: "12px", color: "#6b7280", margin: "6px 0 0 0" }}>
                    Select high-quality PNG, JPG, or WEBP photos (max 5MB each).
                  </p>

                  {imagePreviews.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px", justifyContent: "center" }}>
                      {imagePreviews.map((prev, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: "relative",
                            width: "72px",
                            height: "72px",
                            borderRadius: "6px",
                            overflow: "hidden",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <img
                            src={prev.url}
                            alt={prev.name}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedImageFiles((files) => files.filter((_, i) => i !== idx));
                              setImagePreviews((previews) => previews.filter((_, i) => i !== idx));
                            }}
                            style={{
                              position: "absolute",
                              top: "2px",
                              right: "2px",
                              backgroundColor: "rgba(0,0,0,0.6)",
                              color: "#fff",
                              border: "none",
                              borderRadius: "50%",
                              width: "18px",
                              height: "18px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 16px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  marginBottom: "20px",
                }}
              >
                <input
                  type="checkbox"
                  id="prod-is-active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  style={{ width: "18px", height: "18px", accentColor: "#15803d", cursor: "pointer" }}
                />
                <label htmlFor="prod-is-active" style={{ fontSize: "14px", fontWeight: "500", color: "#1f2937", cursor: "pointer" }}>
                  Active in Storefront (customers can browse and buy this product)
                </label>
              </div>

              {/* Submit Button */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "10px 18px",
                    backgroundColor: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "10px 22px",
                    backgroundColor: "#15803d",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: submitting ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {submitting && <RefreshCw size={14} className="gv-spin" />}
                  <span>{persistedId ? "Save Changes" : "Create & Continue"}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: PHOTOS GALLERY */}
          {activeTab === "photos" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#111827", margin: 0 }}>
                    Product Photography Gallery
                  </h3>
                  <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0 0" }}>
                    Manage high-resolution images. The primary photo is displayed in search cards and catalog headers.
                  </p>
                </div>
              </div>

              {/* Existing Images Grid */}
              {loadingImages ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                  <RefreshCw size={20} className="gv-spin" />
                  <p style={{ marginTop: "8px" }}>Loading product photos...</p>
                </div>
              ) : images.length === 0 ? (
                <div
                  style={{
                    padding: "36px",
                    textAlign: "center",
                    border: "2px dashed #e5e7eb",
                    borderRadius: "12px",
                    marginBottom: "24px",
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <ImageIcon size={32} color="#9ca3af" style={{ margin: "0 auto 10px auto" }} />
                  <p style={{ fontWeight: "600", color: "#374151", margin: 0 }}>No photos uploaded yet</p>
                  <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
                    Add clear, bright produce photos below to showcase harvest quality.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                    gap: "16px",
                    marginBottom: "24px",
                  }}
                >
                  {images.map((img) => (
                    <div
                      key={img.id}
                      style={{
                        borderRadius: "10px",
                        border: img.is_primary ? "2px solid #16a34a" : "1px solid #e5e7eb",
                        overflow: "hidden",
                        backgroundColor: "#fff",
                        display: "flex",
                        flexDirection: "column",
                        position: "relative",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                      }}
                    >
                      <div style={{ position: "relative", width: "100%", height: "130px", backgroundColor: "#f3f4f6" }}>
                        <img
                          src={resolveImageUrl(img.image)}
                          alt="Product"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        {img.is_primary && (
                          <span
                            style={{
                              position: "absolute",
                              top: "8px",
                              left: "8px",
                              backgroundColor: "#16a34a",
                              color: "#fff",
                              fontSize: "11px",
                              fontWeight: "700",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            }}
                          >
                            <Star size={11} fill="#fff" /> Primary
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          padding: "10px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          backgroundColor: "#fafafa",
                          borderTop: "1px solid #f3f4f6",
                        }}
                      >
                        {!img.is_primary ? (
                          <button
                            type="button"
                            onClick={() => handleSetPrimaryImage(img.id)}
                            style={{
                              background: "none",
                              border: "1px solid #d1d5db",
                              borderRadius: "6px",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: "600",
                              color: "#374151",
                              cursor: "pointer",
                            }}
                          >
                            Make Primary
                          </button>
                        ) : (
                          <span style={{ fontSize: "11px", color: "#16a34a", fontWeight: "600" }}>Active Cover</span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteImage(img.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#dc2626",
                            cursor: "pointer",
                            padding: "4px",
                          }}
                          title="Delete photo"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload Dropzone */}
              <div
                style={{
                  border: "2px dashed #cbd5e1",
                  borderRadius: "12px",
                  padding: "24px",
                  textAlign: "center",
                  backgroundColor: "#ffffff",
                }}
              >
                <input
                  type="file"
                  id="image-upload-input"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageFileSelect}
                  style={{ display: "none" }}
                />
                <label
                  htmlFor="image-upload-input"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 20px",
                    backgroundColor: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    color: "#166534",
                    borderRadius: "8px",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <Upload size={16} />
                  <span>Choose Photo Files</span>
                </label>
                <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
                  Supported formats: JPEG, PNG, WebP (up to 5MB each).
                </p>

                {/* Previews before upload */}
                {imagePreviews.length > 0 && (
                  <div style={{ marginTop: "16px", textAlign: "left" }}>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "8px" }}>
                      Selected for Upload ({imagePreviews.length}):
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                      {imagePreviews.map((p, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: "80px",
                            height: "80px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: "1px solid #d1d5db",
                            position: "relative",
                          }}
                        >
                          <img src={p.url} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleUploadImages}
                      disabled={uploadingImages}
                      style={{
                        padding: "10px 20px",
                        backgroundColor: "#15803d",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: uploadingImages ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {uploadingImages && <RefreshCw size={14} className="gv-spin" />}
                      <span>Upload {imagePreviews.length} Photos</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PROMO VIDEO */}
          {activeTab === "video" && (
            <div>
              <div style={{ marginBottom: "18px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#111827", margin: 0 }}>
                  Promotional Video Clip
                </h3>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0 0" }}>
                  Showcase farm harvesting, grower interviews, or cooking tips right on the product page.
                </p>
              </div>

              {loadingVideo ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                  <RefreshCw size={20} className="gv-spin" />
                  <p style={{ marginTop: "8px" }}>Loading video data...</p>
                </div>
              ) : videoObj ? (
                <div
                  style={{
                    backgroundColor: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: "14px", fontWeight: "600", color: "#111827" }}>
                        {videoObj.title || "Promotional Video"}
                      </span>
                      <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "10px" }}>
                        Uploaded {new Date(videoObj.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeleteVideo}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        backgroundColor: "#fef2f2",
                        color: "#b91c1c",
                        border: "1px solid #fecaca",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Remove Video</span>
                    </button>
                  </div>

                  <div style={{ borderRadius: "8px", overflow: "hidden", backgroundColor: "#000", maxHeight: "320px" }}>
                    <video
                      controls
                      src={resolveMediaUrl(videoObj.video)}
                      style={{ width: "100%", maxHeight: "320px", display: "block" }}
                    >
                      Your browser does not support HTML5 video preview.
                    </video>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    border: "2px dashed #cbd5e1",
                    borderRadius: "12px",
                    padding: "32px",
                    textAlign: "center",
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <Film size={36} color="#9ca3af" style={{ margin: "0 auto 12px auto" }} />
                  <p style={{ fontWeight: "600", color: "#374151", margin: 0 }}>No Promotional Video</p>
                  <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px", marginBottom: "20px" }}>
                    Upload an MP4 or WebM video under 50MB to highlight this harvest.
                  </p>

                  <div style={{ maxWidth: "400px", margin: "0 auto", textAlign: "left" }}>
                    <div style={{ marginBottom: "12px" }}>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        Video Title / Hook
                      </label>
                      <input
                        type="text"
                        value={videoTitle}
                        onChange={(e) => setVideoTitle(e.target.value)}
                        placeholder="e.g. Farm Fresh Harvest Morning"
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid #d1d5db",
                          fontSize: "13px",
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <input
                        type="file"
                        id="video-upload-file"
                        accept="video/mp4,video/webm"
                        onChange={handleVideoFileSelect}
                        style={{ display: "none" }}
                      />
                      <label
                        htmlFor="video-upload-file"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "8px 14px",
                          backgroundColor: "#fff",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          fontWeight: "500",
                          color: "#374151",
                          cursor: "pointer",
                        }}
                      >
                        <Upload size={14} />
                        <span>{selectedVideoFile ? selectedVideoFile.name : "Select Video File"}</span>
                      </label>
                      {selectedVideoFile && (
                        <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "10px" }}>
                          ({(selectedVideoFile.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      )}
                    </div>

                    {selectedVideoFile && (
                      <button
                        type="button"
                        onClick={handleUploadVideo}
                        disabled={uploadingVideo}
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "#15803d",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "13px",
                          fontWeight: "600",
                          cursor: uploadingVideo ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {uploadingVideo && <RefreshCw size={14} className="gv-spin" />}
                        <span>Upload Video Clip</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: VARIANTS */}
          {activeTab === "variants" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#111827", margin: 0 }}>
                    Product Size & Packaging Variants
                  </h3>
                  <p style={{ fontSize: "13px", color: "#6b7280", margin: "2px 0 0 0" }}>
                    Offer multiple packaging sizes (e.g., 250g, 500g, 1kg) with individual stock tracking and MRP pricing.
                  </p>
                </div>
                {!editingVariantId && (
                  <button
                    type="button"
                    onClick={() => handleOpenVariantEditor(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      backgroundColor: "#15803d",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    <Plus size={14} />
                    <span>Add Variant</span>
                  </button>
                )}
              </div>

              {/* Inline Variant Editor */}
              {editingVariantId && (
                <form
                  onSubmit={handleSaveVariant}
                  style={{
                    backgroundColor: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "10px",
                    padding: "18px",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#166534" }}>
                      {editingVariantId === "new" ? "New Variant Option" : "Edit Variant Option"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingVariantId(null)}
                      style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer" }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {variantError && (
                    <div
                      style={{
                        padding: "8px 12px",
                        backgroundColor: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "6px",
                        color: "#b91c1c",
                        fontSize: "12px",
                        marginBottom: "12px",
                      }}
                    >
                      {variantError}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        SKU Code *
                      </label>
                      <input
                        type="text"
                        value={variantForm.sku}
                        onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })}
                        placeholder="e.g. ALF-500G"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        Size Quantity *
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={variantForm.quantity}
                        onChange={(e) => setVariantForm({ ...variantForm, quantity: e.target.value })}
                        placeholder="500"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        Unit
                      </label>
                      <select
                        value={variantForm.unit}
                        onChange={(e) => setVariantForm({ ...variantForm, unit: e.target.value })}
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px", backgroundColor: "#fff" }}
                      >
                        {PRODUCT_UNIT_CHOICES.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        MRP (₹) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={variantForm.mrp}
                        onChange={(e) => setVariantForm({ ...variantForm, mrp: e.target.value })}
                        placeholder="120.00"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        Selling Price (₹) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={variantForm.price}
                        onChange={(e) => setVariantForm({ ...variantForm, price: e.target.value })}
                        placeholder="100.00"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#374151", marginBottom: "4px" }}>
                        Stock *
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={variantForm.stock_quantity}
                        onChange={(e) => setVariantForm({ ...variantForm, stock_quantity: e.target.value })}
                        placeholder="10"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "12px" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#374151", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={variantForm.is_active}
                        onChange={(e) => setVariantForm({ ...variantForm, is_active: e.target.checked })}
                        style={{ accentColor: "#15803d" }}
                      />
                      <span>Active</span>
                    </label>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setEditingVariantId(null)}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#fff",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "12px",
                          color: "#374151",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingVariant}
                        style={{
                          padding: "6px 16px",
                          backgroundColor: "#15803d",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: submittingVariant ? "not-allowed" : "pointer",
                        }}
                      >
                        {submittingVariant ? "Saving..." : "Save Variant"}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Variants Table */}
              {loadingVariants ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                  <RefreshCw size={20} className="gv-spin" />
                  <p style={{ marginTop: "8px" }}>Loading package options...</p>
                </div>
              ) : variants.length === 0 ? (
                <div
                  style={{
                    padding: "32px",
                    textAlign: "center",
                    border: "2px dashed #e5e7eb",
                    borderRadius: "12px",
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <Layers size={32} color="#9ca3af" style={{ margin: "0 auto 8px auto" }} />
                  <p style={{ fontWeight: "600", color: "#374151", margin: 0 }}>No Variants Configured</p>
                  <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
                    Configure specific pack sizes (like 500g, 1kg) for customers to choose from.
                  </p>
                </div>
              ) : (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                    <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#6b7280" }}>
                      <tr>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>SKU</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>Pack Size</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>MRP</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>Price</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>Stock</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600" }}>Status</th>
                        <th style={{ padding: "10px 14px", fontWeight: "600", textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "12px 14px", fontWeight: "600", color: "#111827" }}>{v.sku}</td>
                          <td style={{ padding: "12px 14px", color: "#374151" }}>
                            {parseFloat(v.quantity)} {v.unit}
                          </td>
                          <td style={{ padding: "12px 14px", color: "#6b7280", textDecoration: "line-through" }}>
                            ₹{parseFloat(v.mrp).toFixed(2)}
                          </td>
                          <td style={{ padding: "12px 14px", fontWeight: "600", color: "#15803d" }}>
                            ₹{parseFloat(v.price).toFixed(2)}
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: "600",
                                backgroundColor: v.stock_quantity > 5 ? "#f0fdf4" : v.stock_quantity > 0 ? "#fffbeb" : "#fef2f2",
                                color: v.stock_quantity > 5 ? "#166534" : v.stock_quantity > 0 ? "#b45309" : "#b91c1c",
                              }}
                            >
                              {v.stock_quantity} left
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontWeight: "600",
                                backgroundColor: v.is_active ? "#f0fdf4" : "#f3f4f6",
                                color: v.is_active ? "#166534" : "#6b7280",
                              }}
                            >
                              {v.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 14px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => handleOpenVariantEditor(v)}
                                style={{
                                  background: "none",
                                  border: "1px solid #d1d5db",
                                  borderRadius: "6px",
                                  padding: "4px 8px",
                                  color: "#374151",
                                  cursor: "pointer",
                                }}
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteVariant(v.id)}
                                style={{
                                  background: "none",
                                  border: "1px solid #fecaca",
                                  borderRadius: "6px",
                                  padding: "4px 8px",
                                  color: "#dc2626",
                                  cursor: "pointer",
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
