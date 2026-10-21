import api from "./api.js";

// Fallback high quality agricultural produce image for when a product image is missing
export const DEFAULT_PRODUCT_IMAGE =
  "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=800&q=80";

// Fallback agricultural category cover images
export const CATEGORY_FALLBACK_IMAGES = {
  fruits: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80",
  vegetables: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80",
  grains: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80",
  organic: "https://images.unsplash.com/photo-1597362925123-77861d3fbac7?auto=format&fit=crop&w=800&q=80",
  default: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80",
};

/**
 * Resolves a backend media path to an absolute image URL
 * @param {string|null} imgPath
 * @param {string} fallbackType
 * @returns {string}
 */
export function resolveImageUrl(imgPath, fallbackType = "default") {
  if (!imgPath) {
    return CATEGORY_FALLBACK_IMAGES[fallbackType] || DEFAULT_PRODUCT_IMAGE;
  }

  const backendBase =
    import.meta.env?.VITE_API_URL?.replace(/\/api\/v1\/?$/, "") ||
    "http://localhost:8000";

  // Normalize localhost/127.0.0.1 media URLs if serialized without port
  if (
    imgPath.startsWith("http://localhost/media/") ||
    imgPath.startsWith("http://127.0.0.1/media/")
  ) {
    const subPath = imgPath.replace(/^http:\/\/(localhost|127\.0\.0\.1)/, "");
    return `${backendBase}${subPath}`;
  }

  if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
    return imgPath;
  }

  const cleanPath = imgPath.startsWith("/") ? imgPath : `/${imgPath}`;
  return `${backendBase}${cleanPath}`;
}

/**
 * Resolves any backend media asset (video, documents) to an absolute URL without fallback
 * @param {string|null} mediaPath
 * @returns {string|null}
 */
export function resolveMediaUrl(mediaPath) {
  if (!mediaPath) return null;

  const backendBase =
    import.meta.env?.VITE_API_URL?.replace(/\/api\/v1\/?$/, "") ||
    "http://localhost:8000";

  // Normalize localhost/127.0.0.1 media URLs if serialized without port
  if (
    mediaPath.startsWith("http://localhost/media/") ||
    mediaPath.startsWith("http://127.0.0.1/media/")
  ) {
    const subPath = mediaPath.replace(/^http:\/\/(localhost|127\.0\.0\.1)/, "");
    return `${backendBase}${subPath}`;
  }

  // Absolute external or fully specified URLs
  if (mediaPath.startsWith("http://") || mediaPath.startsWith("https://")) {
    return mediaPath;
  }

  const cleanPath = mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`;
  const finalPath = cleanPath.startsWith("/media/") ? cleanPath : `/media${cleanPath}`;
  return `${backendBase}${finalPath}`;
}

/**
 * Format price and unit cleanly
 * @param {number|string} price
 * @param {string} unit
 * @returns {string}
 */
export function formatPrice(price, unit = "kg") {
  const num = parseFloat(price);
  if (isNaN(num)) return `₹0.00 / ${unit}`;
  return `₹${num.toFixed(2)} / ${unit}`;
}

/**
 * Fetch all categories from backend
 * @returns {Promise<Array>}
 */
export async function getCategories() {
  try {
    const response = await api.get("/product/categories/", {
      _skipAuthRedirect: true,
    });

    const data = Array.isArray(response.data)
      ? response.data
      : response.data?.results || [];

    return data;
  } catch (error) {
    console.error("Failed to fetch product categories:", error);
    throw error;
  }
}

/**
 * Fetch products list with optional search and pagination
 * @param {Object} options
 * @param {string} [options.search]
 * @param {number} [options.page]
 * @param {number} [options.pageSize]
 * @param {string} [options.categoryId]
 * @returns {Promise<{ count: number, next: string|null, previous: string|null, results: Array }>}
 */
export async function getProducts({ search = "", page = 1, pageSize, categoryId = "" } = {}) {
  try {
    const params = {};
    if (search && search.trim()) {
      params.search = search.trim();
    }
    if (page && page > 1) {
      params.page = page;
    }
    if (pageSize) {
      params.page_size = pageSize;
    }
    if (
      categoryId &&
      typeof categoryId === "string" &&
      categoryId.trim() &&
      categoryId.trim().toLowerCase() !== "all" &&
      categoryId.trim().toLowerCase() !== "undefined" &&
      categoryId.trim().toLowerCase() !== "null"
    ) {
      params.category = categoryId.trim();
    }

    const response = await api.get("/product/products/", {
      params,
      _skipAuthRedirect: true,
    });

    let rawResults = [];
    let count = 0;
    let next = null;
    let previous = null;

    if (Array.isArray(response.data)) {
      rawResults = response.data;
      count = rawResults.length;
    } else if (response.data && Array.isArray(response.data.results)) {
      rawResults = response.data.results;
      count = response.data.count || rawResults.length;
      next = response.data.next || null;
      previous = response.data.previous || null;
    }

    const enriched = rawResults.map((prod) => ({
      ...prod,
      category_name: prod.category_name || "",
      price_num: parseFloat(prod.price) || 0,
    }));

    return {
      count,
      next,
      previous,
      results: enriched,
    };
  } catch (error) {
    console.error("Failed to fetch products:", error);
    throw error;
  }
}

/**
 * Fetch a single product by ID
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getProductById(id) {
  if (!id || id === "undefined" || id === "null") {
    throw new Error("Invalid product id");
  }
  try {
    const response = await api.get(`/product/products/${id}/`, {
      _skipAuthRedirect: true,
    });
    const prod = response.data;

    return {
      ...prod,
      category_name: prod.category_name || "",
      price_num: parseFloat(prod.price) || 0,
    };
  } catch (error) {
    console.error(`Failed to fetch product ${id}:`, error);
    throw error;
  }
}

/**
 * Format variant package size label cleanly (e.g. "250 g", "1.5 kg")
 * @param {Object} variant
 * @returns {string}
 */
export function formatVariantLabel(variant) {
  if (!variant) return "";
  const qty = parseFloat(variant.quantity);
  const formattedQty = isNaN(qty) ? variant.quantity : Number(qty.toFixed(3));
  const unit = variant.unit || "";
  return `${formattedQty} ${unit}`.trim();
}

/**
 * Calculate percentage discount from selling price and MRP
 * @param {number|string} price
 * @param {number|string} mrp
 * @returns {number} discount percentage rounded to nearest integer (0 if invalid)
 */
export function calculateDiscount(price, mrp) {
  const p = parseFloat(price);
  const m = parseFloat(mrp);
  if (isNaN(p) || isNaN(m) || m <= 0 || p >= m) {
    return 0;
  }
  return Math.round(((m - p) / m) * 100);
}

/**
 * Fetch product images from backend
 * @param {string} productId
 * @returns {Promise<Array>}
 */
export async function getProductImages(productId) {
  if (!productId || productId === "undefined" || productId === "null" || productId === "all") return [];
  try {
    const response = await api.get("/product/product-images/", {
      params: { product: productId },
      _skipAuthRedirect: true,
    });

    const raw = Array.isArray(response.data)
      ? response.data
      : response.data?.results || [];

    // Filter to this product in case backend endpoint returns unfiltered set
    const filtered = raw.filter((img) => String(img.product) === String(productId));

    // Sort by sort_order ascending, primary image first
    return filtered.sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  } catch (error) {
    console.warn(`Could not load images for product ${productId}:`, error.message);
    return [];
  }
}

/**
 * Fetch product promotional video from backend
 * Note: Handled gracefully if video is unavailable or request fails
 * @param {string} productId
 * @returns {Promise<Object|null>}
 */
export async function getProductVideo(productId) {
  if (!productId || productId === "undefined" || productId === "null" || productId === "all") return null;
  try {
    const response = await api.get("/product/product-videos/", {
      params: { product: productId },
      _skipAuthRedirect: true,
    });

    const raw = Array.isArray(response.data)
      ? response.data
      : response.data?.results || [];

    const found = raw.find((v) => String(v.product) === String(productId));
    return found || null;
  } catch (error) {
    // Gracefully handle any failure without disrupting page render
    console.warn(`Could not load video for product ${productId}:`, error.message);
    return null;
  }
}

/**
 * Fetch product variants from backend
 * Note: Handled gracefully if backend endpoint fails
 * @param {string} productId
 * @returns {Promise<Array>}
 */
export async function getProductVariants(productId) {
  if (!productId || productId === "undefined" || productId === "null" || productId === "all") return [];
  try {
    const response = await api.get("/product/variants/", {
      params: { product: productId },
      _skipAuthRedirect: true,
    });

    const raw = Array.isArray(response.data)
      ? response.data
      : response.data?.results || [];

    const filtered = raw.filter((v) => String(v.product) === String(productId));

    // Sort variants by quantity or price
    return filtered.sort((a, b) => {
      const pA = parseFloat(a.price) || 0;
      const pB = parseFloat(b.price) || 0;
      return pA - pB;
    });
  } catch (error) {
    console.warn(`Could not load variants for product ${productId}:`, error.message);
    return [];
  }
}

/**
 * Composite fetch for complete product details (product, images, video, variants)
 * Uses Promise.allSettled to guarantee the product detail page always renders
 * even if auxiliary endpoints fail or return permission errors.
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getProductDetailsComplete(id) {
  const prod = await getProductById(id);

  const [imagesSettled, videoSettled, variantsSettled] = await Promise.allSettled([
    getProductImages(id),
    getProductVideo(id),
    getProductVariants(id),
  ]);

  const images = imagesSettled.status === "fulfilled" ? imagesSettled.value : [];
  const video = videoSettled.status === "fulfilled" ? videoSettled.value : null;
  const variants = variantsSettled.status === "fulfilled" ? variantsSettled.value : [];

  return {
    ...prod,
    images: images || [],
    video: video || null,
    variants: variants || [],
  };
}

