import api from "./api.js";

const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_REFRESH_KEY = "admin_refresh";
const ADMIN_USER_KEY = "admin_user";

/**
 * Retrieve active admin token
 */
export const getAdminToken = () => {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || null;
  } catch {
    return null;
  }
};

/**
 * Retrieve active admin user profile
 */
export const getAdminUser = () => {
  try {
    const raw = localStorage.getItem(ADMIN_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Check if admin is currently authenticated
 */
export const isAdminAuthenticated = () => {
  return Boolean(getAdminToken());
};

/**
 * Clear stored admin authentication session
 */
export const clearAdminAuth = () => {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_REFRESH_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  } catch {
    // Ignore
  }
};

/**
 * Admin Login API
 * @param {string} email
 * @param {string} password
 */
export const adminLogin = async (email, password) => {
  const response = await api.post("/admin-auth/login/", { email, password });
  const data = response.data;

  if (data?.access) {
    localStorage.setItem(ADMIN_TOKEN_KEY, data.access);
  }
  if (data?.refresh) {
    localStorage.setItem(ADMIN_REFRESH_KEY, data.refresh);
  }
  if (data?.user) {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
  }

  return data;
};

/**
 * Admin Logout API
 */
export const adminLogout = async () => {
  try {
    const refresh = localStorage.getItem(ADMIN_REFRESH_KEY);
    await api.post("/admin-auth/logout/", { refresh });
  } catch {
    // Ignore network/server errors during logout
  } finally {
    clearAdminAuth();
  }
};

/**
 * Get current admin user profile
 */
export const getAdminMe = async () => {
  const response = await api.get("/admin-auth/me/");
  return response.data;
};

/**
 * Get high-level admin dashboard statistics
 */
export const getAdminDashboard = async () => {
  const response = await api.get("/admin-auth/dashboard/");
  return response.data;
};

/**
 * Get paginated customers list with search and filter
 * @param {Object} params - { page, search, is_active }
 */
export const getAdminCustomers = async (params = {}) => {
  const cleanParams = {};
  if (params.page) cleanParams.page = params.page;
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.is_active !== undefined && params.is_active !== "") {
    cleanParams.is_active = params.is_active;
  }

  const response = await api.get("/account/admin/customers/", { params: cleanParams });
  return response.data;
};

/**
 * Block a customer (deactivate and revoke tokens)
 * @param {string} customerId
 */
export const blockCustomer = async (customerId) => {
  const response = await api.post(`/account/admin/customers/${customerId}/block/`);
  return response.data;
};

/**
 * Unblock a customer (reactivate and revoke tokens)
 * @param {string} customerId
 */
export const unblockCustomer = async (customerId) => {
  const response = await api.post(`/account/admin/customers/${customerId}/unblock/`);
  return response.data;
};

/**
 * Standard product unit options aligned with backend UNIT_CHOICES
 */
export const PRODUCT_UNIT_CHOICES = [
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "l", label: "Litre (L)" },
  { value: "ml", label: "Millilitre (ml)" },
  { value: "piece", label: "Piece" },
  { value: "pack", label: "Pack" },
  { value: "dozen", label: "Dozen" },
];

/**
 * Safely map raw backend product data to form state properties.
 * Handles nested category objects, numeric zero preservation,
 * field name variations (product_name vs name), and fallback defaults.
 *
 * @param {Object} rawProduct
 * @returns {Object} formData
 */
export const mapProductToFormData = (rawProduct) => {
  if (!rawProduct || typeof rawProduct !== "object") {
    return {
      name: "",
      product_category: "",
      price: "",
      stock_quantity: 0,
      unit: "kg",
      description: "",
      is_active: true,
    };
  }

  // Handle potential nested wrapping (response.data, response.result, etc.)
  const p = rawProduct.data || rawProduct.result || rawProduct;

  // Name: map name or product_name
  const name = p.name ?? p.product_name ?? "";

  // Category: support UUID string, nested object { id: ... }, or category_id
  let catId = "";
  if (p.product_category) {
    catId = typeof p.product_category === "object" ? p.product_category.id : p.product_category;
  } else if (p.category) {
    catId = typeof p.category === "object" ? p.category.id : p.category;
  } else if (p.category_id) {
    catId = p.category_id;
  }

  // Price: preserve 0 ("0"), only empty if truly undefined/null/empty
  const rawPrice = p.price ?? p.regular_price;
  const price = (rawPrice !== undefined && rawPrice !== null && rawPrice !== "")
    ? String(rawPrice)
    : "";

  // Stock quantity: preserve 0 (0), check stock_quantity, stock, and quantity
  const rawStock = p.stock_quantity ?? p.stock ?? p.quantity;
  const stock_quantity = (rawStock !== undefined && rawStock !== null && rawStock !== "")
    ? Number(rawStock)
    : 0;

  // Unit: default to kg or backend model default
  const unit = p.unit || "kg";

  // Description
  const description = p.description ?? p.desc ?? "";

  // Status (is_active)
  const is_active = p.is_active !== undefined
    ? Boolean(p.is_active)
    : (p.status !== undefined ? p.status === "active" : true);

  return {
    name: String(name),
    product_category: String(catId || ""),
    price,
    stock_quantity,
    unit: String(unit),
    description: String(description),
    is_active,
  };
};

/**
 * Fetch all products for admin with full filters, search, and pagination
 */
export const getAdminProducts = async (params = {}) => {
  const cleanParams = {};
  if (params.page) cleanParams.page = params.page;
  if (params.page_size) cleanParams.page_size = params.page_size;
  if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
  if (params.category && params.category !== "all") cleanParams.category = params.category;
  if (params.is_active !== undefined && params.is_active !== "" && params.is_active !== "all") {
    cleanParams.is_active = params.is_active;
  }
  if (params.ordering) cleanParams.ordering = params.ordering;

  const response = await api.get("/product/products/", {
    params: cleanParams,
    headers: { "X-Admin-panel": "1" },
  });
  return response.data;
};

/**
 * Retrieve single product details with nested relations
 */
export const getAdminProductById = async (id) => {
  const response = await api.get(`/product/products/${id}/`, {
    headers: { "X-Admin-panel": "1" },
  });
  return response.data;
};

/**
 * Create a new product
 * @param {FormData|Object} data
 */
export const createAdminProduct = async (data) => {
  const config = data instanceof FormData
    ? { headers: { "Content-Type": "multipart/form-data" } }
    : {};
  const response = await api.post("/product/products/", data, config);
  return response.data;
};

/**
 * Update an existing product
 * @param {string} id
 * @param {FormData|Object} data
 */
export const updateAdminProduct = async (id, data) => {
  const config = data instanceof FormData
    ? { headers: { "Content-Type": "multipart/form-data" } }
    : {};
  const response = await api.patch(`/product/products/${id}/`, data, config);
  return response.data;
};

/**
 * Delete a product permanently
 */
export const deleteAdminProduct = async (id) => {
  const response = await api.delete(`/product/products/${id}/`);
  return response.data;
};

/**
 * Fetch all product categories
 */
export const getAdminCategories = async () => {
  const response = await api.get("/product/categories/");
  return Array.isArray(response.data) ? response.data : response.data?.results || [];
};

/**
 * Create a new produce category
 */
export const createAdminCategory = async (data) => {
  const response = await api.post("/product/categories/", data);
  return response.data;
};

/**
 * Delete a category
 */
export const deleteAdminCategory = async (id) => {
  const response = await api.delete(`/product/categories/${id}/`);
  return response.data;
};

/**
 * Fetch variants for a specific product
 */
export const getAdminProductVariants = async (productId) => {
  const response = await api.get("/product/variants/", {
    params: { product: productId },
  });
  return Array.isArray(response.data) ? response.data : response.data?.results || [];
};

/**
 * Create a product variant
 */
export const createAdminProductVariant = async (data) => {
  const response = await api.post("/product/variants/", data);
  return response.data;
};

/**
 * Update an existing variant
 */
export const updateAdminProductVariant = async (variantId, data) => {
  const response = await api.patch(`/product/variants/${variantId}/`, data);
  return response.data;
};

/**
 * Delete a variant
 */
export const deleteAdminProductVariant = async (variantId) => {
  const response = await api.delete(`/product/variants/${variantId}/`);
  return response.data;
};

/**
 * Fetch images for a product
 */
export const getAdminProductImages = async (productId) => {
  const response = await api.get("/product/product-images/", {
    params: { product: productId },
  });
  return Array.isArray(response.data) ? response.data : response.data?.results || [];
};

/**
 * Upload one or multiple photos for a product
 * @param {FormData} formData - contains 'product' (UUID) and 'images' (files)
 */
export const uploadAdminProductImages = async (formData) => {
  const response = await api.post("/product/product-images/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

/**
 * Atomically set an image as primary for its parent product
 */
export const setAdminPrimaryProductImage = async (imageId) => {
  const response = await api.post(`/product/product-images/${imageId}/set-primary/`);
  return response.data;
};

/**
 * Delete a product photo
 */
export const deleteAdminProductImage = async (imageId) => {
  const response = await api.delete(`/product/product-images/${imageId}/`);
  return response.data;
};

/**
 * Fetch promotional video for a product
 */
export const getAdminProductVideos = async (productId) => {
  const response = await api.get("/product/product-videos/", {
    params: { product: productId },
  });
  return Array.isArray(response.data) ? response.data : response.data?.results || [];
};

/**
 * Upload a promotional video for a product
 * @param {FormData} formData - contains 'product' (UUID), 'video' (file), optional 'title'
 */
export const uploadAdminProductVideo = async (formData) => {
  const response = await api.post("/product/product-videos/", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

/**
 * Update a product video (e.g., replace video or title)
 */
export const updateAdminProductVideo = async (videoId, data) => {
  const config = data instanceof FormData
    ? { headers: { "Content-Type": "multipart/form-data" } }
    : {};
  const response = await api.patch(`/product/product-videos/${videoId}/`, data, config);
  return response.data;
};

/**
 * Delete a product video
 */
export const deleteAdminProductVideo = async (videoId) => {
  const response = await api.delete(`/product/product-videos/${videoId}/`);
  return response.data;
};

