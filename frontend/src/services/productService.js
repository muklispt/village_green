import api from "./api";

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

  if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
    return imgPath;
  }

  // Prepend backend URL
  const backendBase =
    import.meta.env?.VITE_API_URL?.replace(/\/api\/v1\/?$/, "") ||
    "http://localhost:8000";

  const cleanPath = imgPath.startsWith("/") ? imgPath : `/${imgPath}`;
  return `${backendBase}${cleanPath}`;
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

// In-memory cache for categories to enrich product category names
let categoryCache = null;

/**
 * Fetch all categories from backend
 * @returns {Promise<Array>}
 */
export async function getCategories() {
  try {
    let response;
    try {
      response = await api.get("/productcategories/");
    } catch (firstErr) {
      if (firstErr.response?.status === 404) {
        response = await api.get("/categories/");
      } else {
        throw firstErr;
      }
    }

    const data = Array.isArray(response.data)
      ? response.data
      : response.data?.results || [];

    // Cache categories map
    categoryCache = data.reduce((acc, cat) => {
      acc[cat.id] = cat;
      return acc;
    }, {});

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

    let response;
    try {
      response = await api.get("/productproducts/", { params });
    } catch (firstErr) {
      if (firstErr.response?.status === 404) {
        response = await api.get("/products/", { params });
      } else {
        throw firstErr;
      }
    }

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

    // Enrich products with category_name if missing and cache exists
    let enriched = rawResults.map((prod) => {
      let catName = prod.category_name;
      if (!catName && categoryCache && prod.product_category) {
        catName = categoryCache[prod.product_category]?.name;
      }
      return {
        ...prod,
        category_name: catName || "Fresh Produce",
        price_num: parseFloat(prod.price) || 0,
      };
    });

    // If client specified a specific categoryId, apply client-side filter if backend didn't filter it
    if (categoryId) {
      enriched = enriched.filter(
        (p) =>
          p.product_category === categoryId ||
          p.product_category?.id === categoryId
      );
    }

    return {
      count: categoryId ? enriched.length : count,
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
  try {
    let response;
    try {
      response = await api.get(`/productproducts/${id}/`);
    } catch (firstErr) {
      if (firstErr.response?.status === 404) {
        response = await api.get(`/products/${id}/`);
      } else {
        throw firstErr;
      }
    }

    const prod = response.data;
    let catName = prod.category_name;
    if (!catName && categoryCache && prod.product_category) {
      catName = categoryCache[prod.product_category]?.name;
    }

    return {
      ...prod,
      category_name: catName || "Fresh Produce",
      price_num: parseFloat(prod.price) || 0,
    };
  } catch (error) {
    console.error(`Failed to fetch product ${id}:`, error);
    throw error;
  }
}
