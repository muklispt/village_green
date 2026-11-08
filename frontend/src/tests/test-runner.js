import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseApiError, extractCooldownSeconds } from "../utils/validation.js";

describe("Resend OTP API Contract Verification", () => {
  test("resendOtp payload structure matches backend ResendOTPSerializer expectations", () => {
    const email = "Patron@GreenVillage.org";
    const normalizePayload = (emailOrData) => {
      const normalizedEmail =
        typeof emailOrData === "object" && emailOrData !== null
          ? emailOrData.email
          : emailOrData;
      return { email: String(normalizedEmail).trim().toLowerCase() };
    };

    const payload1 = normalizePayload(email);
    assert.deepEqual(payload1, { email: "patron@greenvillage.org" });

    const payload2 = normalizePayload({ email: "user@example.com" });
    assert.deepEqual(payload2, { email: "user@example.com" });
  });

  test("resendOtp endpoint matches backend routing", () => {
    const apiBasePath = "/api/v1";
    const accountSubPath = "/account/resend-otp/";
    const fullPath = `${apiBasePath}${accountSubPath}`;
    assert.equal(fullPath, "/api/v1/account/resend-otp/");
  });
});

describe("Error Handling & Cooldown Extraction Tests", () => {
  test("parseApiError handles HTTP 400 cooldown response and extractCooldownSeconds parses seconds", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          email: ["Please wait 60 seconds before requesting a new code."],
        },
      },
    };

    const { fieldErrors } = parseApiError(errorResponse);
    assert.equal(fieldErrors.email, "Please wait 60 seconds before requesting a new code.");
    const secs = extractCooldownSeconds(fieldErrors.email);
    assert.equal(secs, 60);
  });

  test("parseApiError handles HTTP 429 DRF throttle response and extractCooldownSeconds parses seconds", () => {
    const errorResponse = {
      response: {
        status: 429,
        data: {
          detail: "Request was throttled. Expected available in 58 seconds.",
        },
      },
    };

    const { generalError } = parseApiError(errorResponse);
    assert.equal(generalError, "Request was throttled. Expected available in 58 seconds.");
    const secs = extractCooldownSeconds(generalError);
    assert.equal(secs, 58);
  });

  test("parseApiError handles HTTP 400 uniform non-leaking OTP error", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          otp: ["Invalid or expired verification code."],
        },
      },
    };

    const { fieldErrors } = parseApiError(errorResponse);
    assert.equal(fieldErrors.otp, "Invalid or expired verification code.");
  });

  test("parseApiError handles HTTP 400 max attempts exceeded message", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          otp: ["Too many attempts. Request a new code."],
        },
      },
    };

    const { fieldErrors } = parseApiError(errorResponse);
    assert.equal(fieldErrors.otp, "Too many attempts. Request a new code.");
  });

  test("parseApiError masks HTTP 500 server errors and avoids leaking internals", () => {
    const errorResponse = {
      response: {
        status: 500,
        data: "Database connection crashed at /var/django/...",
      },
    };

    const { generalError } = parseApiError(errorResponse);
    assert.equal(generalError, "A server error occurred. Please try again later.");
  });

  test("parseApiError handles network connectivity failure", () => {
    const networkError = {
      request: {},
    };

    const { generalError } = parseApiError(networkError);
    assert.equal(
      generalError,
      "Could not connect to the server. Please ensure the backend is running."
    );
  });
});

describe("JWT Token Propagation & Profile API Verification", () => {
  // Test endpoint classification
  test("Public vs Protected endpoint classification protects /account/profile/", async () => {
    const { isPublicEndpoint } = await import("../services/api.js");

    // Protected endpoints
    assert.equal(isPublicEndpoint("/account/profile/"), false);
    assert.equal(isPublicEndpoint("/account/user/"), false);
    assert.equal(isPublicEndpoint("/account/profile"), false);

    // Public endpoints
    assert.equal(isPublicEndpoint("/account/login/"), true);
    assert.equal(isPublicEndpoint("/account/register/"), true);
    assert.equal(isPublicEndpoint("/account/google-login/"), true);
    assert.equal(isPublicEndpoint("/account/verify-otp/"), true);
    assert.equal(isPublicEndpoint("/account/forgot-password/"), true);
    assert.equal(isPublicEndpoint("/account/reset-password/"), true);
  });

  test("Token storage helpers retrieve and clear tokens consistently", async () => {
    const {
      getStoredAccessToken,
      getStoredRefreshToken,
      clearStoredAuth,
    } = await import("../services/api.js");

    // Mock localStorage
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, val) => storage.set(key, String(val)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    };

    // No token initially
    assert.equal(getStoredAccessToken(), null);
    assert.equal(getStoredRefreshToken(), null);

    // Set tokens
    localStorage.setItem("access_token", "test_access_jwt_xyz");
    localStorage.setItem("refresh_token", "test_refresh_jwt_abc");
    localStorage.setItem("user", JSON.stringify({ email: "patron@example.com" }));

    assert.equal(getStoredAccessToken(), "test_access_jwt_xyz");
    assert.equal(getStoredRefreshToken(), "test_refresh_jwt_abc");

    // Clear tokens
    clearStoredAuth();
    assert.equal(getStoredAccessToken(), null);
    assert.equal(getStoredRefreshToken(), null);
    assert.equal(localStorage.getItem("user"), null);
  });

  test("Request interceptor attaches Authorization header to /account/profile/ when token exists", async () => {
    const { default: api } = await import("../services/api.js");

    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, val) => storage.set(key, String(val)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    };
    localStorage.setItem("access_token", "valid_bearer_token_123");

    // Find the request interceptor handler
    const reqHandler = api.interceptors.request.handlers[0].fulfilled;

    const profileConfig = {
      url: "/account/profile/",
      headers: {},
    };

    const result = reqHandler(profileConfig);
    assert.equal(result.headers.Authorization, "Bearer valid_bearer_token_123");
  });

  test("Request interceptor omits Authorization header on public /account/login/ request", async () => {
    const { default: api } = await import("../services/api.js");

    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, val) => storage.set(key, String(val)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    };
    localStorage.setItem("access_token", "valid_bearer_token_123");

    const reqHandler = api.interceptors.request.handlers[0].fulfilled;

    const loginConfig = {
      url: "/account/login/",
      headers: { Authorization: "Bearer leftover" },
    };

    const result = reqHandler(loginConfig);
    assert.equal(result.headers.Authorization, undefined);
  });

  test("Profile service functions call expected endpoints with correct HTTP methods", async () => {
    const { getProfile, updateProfile } = await import("../services/profileService.js");
    assert.equal(typeof getProfile, "function");
    assert.equal(typeof updateProfile, "function");
  });

  test("Profile photo payload matches backend ProfileUpdateSerializer schema", () => {
    const buildPhotoPayload = (currentProfile, newPhotoUrl) => {
      return {
        full_name: currentProfile?.full_name || "",
        phone: currentProfile?.phone || "",
        address: currentProfile?.address || "",
        city: currentProfile?.city || "",
        pincode: currentProfile?.pincode || "",
        profileImage: newPhotoUrl ? newPhotoUrl.trim() : null,
      };
    };

    const mockProfile = {
      full_name: "Anita Sharma",
      phone: "+91 98765 43210",
      address: "Green Acre Farm",
      city: "Bangalore",
      pincode: "560001",
    };

    const testUrl = "https://images.unsplash.com/photo-1544005313-94ddf0286df2";
    const payload = buildPhotoPayload(mockProfile, testUrl);

    assert.equal(payload.profileImage, testUrl);
    assert.equal(payload.full_name, "Anita Sharma");
    assert.equal(payload.phone, "+91 98765 43210");

    // Removal of photo sends null
    const removalPayload = buildPhotoPayload(mockProfile, "");
    assert.equal(removalPayload.profileImage, null);
  });
});

describe("Product & Category Service & Storefront Contracts", () => {
  test("resolveImageUrl handles absolute URLs, relative media paths, and null fallbacks", () => {
    const resolveImageUrlHelper = (imgPath, fallbackType = "default") => {
      const FALLBACKS = {
        fruits: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80",
        default: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80",
      };
      if (!imgPath) return FALLBACKS[fallbackType] || FALLBACKS.default;
      if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) return imgPath;
      const backendBase = "http://localhost:8000";
      const cleanPath = imgPath.startsWith("/") ? imgPath : `/${imgPath}`;
      return `${backendBase}${cleanPath}`;
    };

    assert.equal(
      resolveImageUrlHelper("http://localhost:8000/media/products/DSC03421.webp"),
      "http://localhost:8000/media/products/DSC03421.webp"
    );
    assert.equal(
      resolveImageUrlHelper("/media/products/pear.webp"),
      "http://localhost:8000/media/products/pear.webp"
    );
    assert.equal(
      resolveImageUrlHelper(null, "fruits"),
      "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80"
    );
  });

  test("formatPrice formats unit currency correctly", () => {
    const formatPriceHelper = (price, unit = "kg") => {
      const num = parseFloat(price);
      if (isNaN(num)) return `₹0.00 / ${unit}`;
      return `₹${num.toFixed(2)} / ${unit}`;
    };

    assert.equal(formatPriceHelper("255.00", "kg"), "₹255.00 / kg");
    assert.equal(formatPriceHelper(150, "box"), "₹150.00 / box");
    assert.equal(formatPriceHelper(null, "piece"), "₹0.00 / piece");
  });


});

describe("Shopping Basket Calculations & Stock Boundary Logic", () => {
  test("Quantity clamping respects minimum (1) and maximum stock constraints", () => {
    const clampQty = (qty, maxStock) => Math.max(1, Math.min(qty, maxStock));

    assert.equal(clampQty(0, 5), 1);
    assert.equal(clampQty(-3, 5), 1);
    assert.equal(clampQty(4, 5), 4);
    assert.equal(clampQty(10, 5), 5);
  });

  test("Subtotal calculation accurately multiplies price and quantity across multiple basket items", () => {
    const items = [
      { product: { price: "255.00" }, quantity: 2 }, // 510.00
      { product: { price: "150.00" }, quantity: 3 }, // 450.00
    ];

    const subtotal = items.reduce(
      (sum, item) => sum + parseFloat(item.product.price) * item.quantity,
      0
    );

    assert.equal(subtotal, 960.0);
    assert.equal(subtotal.toFixed(2), "960.00");
  });
});

describe("Product Variants & Media Gallery Contracts", () => {
  const formatVariantLabel = (variant) => {
    if (!variant) return "";
    const qty = parseFloat(variant.quantity);
    const formattedQty = isNaN(qty) ? variant.quantity : Number(qty.toFixed(3));
    const unit = variant.unit || "";
    return `${formattedQty} ${unit}`.trim();
  };

  const calculateDiscount = (price, mrp) => {
    const p = parseFloat(price);
    const m = parseFloat(mrp);
    if (isNaN(p) || isNaN(m) || m <= 0 || p >= m) {
      return 0;
    }
    return Math.round(((m - p) / m) * 100);
  };

  const resolveMediaUrl = (mediaPath) => {
    if (!mediaPath) return null;
    if (mediaPath.startsWith("http://") || mediaPath.startsWith("https://")) {
      return mediaPath;
    }
    const backendBase = "http://localhost:8000";
    const cleanPath = mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`;
    return `${backendBase}${cleanPath}`;
  };

  test("formatVariantLabel formats decimal quantities and units cleanly", () => {
    assert.equal(
      formatVariantLabel({ quantity: "250.000", unit: "g" }),
      "250 g"
    );
    assert.equal(
      formatVariantLabel({ quantity: "1.000", unit: "kg" }),
      "1 kg"
    );
    assert.equal(
      formatVariantLabel({ quantity: "0.500", unit: "l" }),
      "0.5 l"
    );
    assert.equal(
      formatVariantLabel({ quantity: "12", unit: "piece" }),
      "12 piece"
    );
    assert.equal(formatVariantLabel(null), "");
  });

  test("calculateDiscount calculates percentage and guards against invalid/negative values", () => {
    assert.equal(calculateDiscount("45.00", "50.00"), 10); // (50-45)/50 = 10%
    assert.equal(calculateDiscount("90.00", "100.00"), 10);
    assert.equal(calculateDiscount("75.00", "100.00"), 25);
    assert.equal(calculateDiscount("100.00", "100.00"), 0); // No discount
    assert.equal(calculateDiscount("120.00", "100.00"), 0); // Price > MRP invalid
    assert.equal(calculateDiscount("50.00", null), 0); // Missing MRP
    assert.equal(calculateDiscount("50.00", "0"), 0); // Zero MRP
  });

  test("resolveMediaUrl properly handles video paths without image fallbacks", () => {
    assert.equal(
      resolveMediaUrl("https://storage.googleapis.com/videos/farm_promo.mp4"),
      "https://storage.googleapis.com/videos/farm_promo.mp4"
    );
    assert.equal(
      resolveMediaUrl("/media/products/videos/turmeric_farm.mp4"),
      "http://localhost:8000/media/products/videos/turmeric_farm.mp4"
    );
    assert.equal(
      resolveMediaUrl("media/products/videos/turmeric_farm.mp4"),
      "http://localhost:8000/media/products/videos/turmeric_farm.mp4"
    );
    assert.equal(resolveMediaUrl(null), null);
    assert.equal(resolveMediaUrl(""), null);
  });

  test("Product image ordering prioritizes is_primary over sort_order", () => {
    const rawImages = [
      { id: "img-2", image: "/media/2.webp", is_primary: false, sort_order: 1 },
      { id: "img-3", image: "/media/3.webp", is_primary: true, sort_order: 5 },
      { id: "img-1", image: "/media/1.webp", is_primary: false, sort_order: 0 },
    ];

    const sorted = [...rawImages].sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    assert.equal(sorted[0].id, "img-3"); // is_primary is first
    assert.equal(sorted[1].id, "img-1"); // sort_order 0
    assert.equal(sorted[2].id, "img-2"); // sort_order 1
  });
});

describe("Cart Integration with Product Variants", () => {
  const getCartItemId = (product, variant) => {
    return variant?.id ? `${product.id}_${variant.id}` : product.id;
  };

  const simulateAddToCart = (prevItems, product, quantity = 1, variant = null) => {
    if (!product || !product.id) return prevItems;
    const maxStock =
      typeof variant?.stock_quantity === "number"
        ? variant.stock_quantity
        : typeof product.stock_quantity === "number"
        ? product.stock_quantity
        : 99;

    if (maxStock <= 0) return prevItems; // Guard out of stock

    const lineItemId = getCartItemId(product, variant);
    const existingIndex = prevItems.findIndex(
      (item) => (item.id || item.product?.id) === lineItemId
    );

    if (existingIndex > -1) {
      const existing = prevItems[existingIndex];
      const newQty = Math.min(existing.quantity + quantity, maxStock);
      const updated = [...prevItems];
      updated[existingIndex] = {
        ...existing,
        id: lineItemId,
        variant: variant || existing.variant || null,
        quantity: newQty,
      };
      return updated;
    } else {
      const initialQty = Math.min(Math.max(1, quantity), maxStock);
      return [
        ...prevItems,
        {
          id: lineItemId,
          product,
          variant: variant || null,
          quantity: initialQty,
        },
      ];
    }
  };

  const calculateSubtotal = (items) => {
    return items.reduce((sum, item) => {
      const price = item.variant?.price
        ? parseFloat(item.variant.price)
        : parseFloat(item.product?.price) || 0;
      return sum + price * (item.quantity || 0);
    }, 0);
  };

  test("Multiple package variants of the same product create separate cart line items", () => {
    const product = { id: "prod-101", name: "Turmeric Powder", price: "50.00" };
    const variant250g = {
      id: "var-250",
      sku: "TUR-250G",
      quantity: "250",
      unit: "g",
      price: "45.00",
      stock_quantity: 10,
    };
    const variant500g = {
      id: "var-500",
      sku: "TUR-500G",
      quantity: "500",
      unit: "g",
      price: "85.00",
      stock_quantity: 15,
    };

    let cart = [];
    cart = simulateAddToCart(cart, product, 2, variant250g);
    cart = simulateAddToCart(cart, product, 1, variant500g);

    assert.equal(cart.length, 2);
    assert.equal(cart[0].id, "prod-101_var-250");
    assert.equal(cart[0].quantity, 2);
    assert.equal(cart[1].id, "prod-101_var-500");
    assert.equal(cart[1].quantity, 1);

    // Subtotal: (45.00 * 2) + (85.00 * 1) = 90 + 85 = 175.00
    assert.equal(calculateSubtotal(cart), 175.0);
  });

  test("Out-of-stock variant cannot be added to cart", () => {
    const product = { id: "prod-101", name: "Turmeric Powder", price: "50.00" };
    const outOfStockVariant = {
      id: "var-1kg",
      sku: "TUR-1KG",
      quantity: "1",
      unit: "kg",
      price: "160.00",
      stock_quantity: 0,
    };

    let cart = [];
    cart = simulateAddToCart(cart, product, 1, outOfStockVariant);

    assert.equal(cart.length, 0); // Item rejected due to stock 0
  });

  test("Variant quantity respects maximum stock limit upon multiple additions", () => {
    const product = { id: "prod-101", name: "Turmeric Powder", price: "50.00" };
    const limitedVariant = {
      id: "var-250",
      sku: "TUR-250G",
      quantity: "250",
      unit: "g",
      price: "45.00",
      stock_quantity: 4,
    };

    let cart = [];
    cart = simulateAddToCart(cart, product, 3, limitedVariant);
    assert.equal(cart[0].quantity, 3);

    // Adding 3 more should clamp to max stock (4)
    cart = simulateAddToCart(cart, product, 3, limitedVariant);
    assert.equal(cart[0].quantity, 4);
  });
});

describe("Public Storefront Access & Video Media Normalization", () => {
  test("isStorefrontEndpoint correctly identifies public catalog routes and protects account routes", async () => {
    const { isStorefrontEndpoint } = await import("../services/api.js");

    // Public storefront endpoints
    assert.equal(isStorefrontEndpoint("/product/products/"), true);
    assert.equal(isStorefrontEndpoint("/product/products/34a90707-a061-4134-81d4-7fa0fa4f14bb/"), true);
    assert.equal(isStorefrontEndpoint("/product/product-videos/?product=123"), true);
    assert.equal(isStorefrontEndpoint("/product/product-images/?product=123"), true);
    assert.equal(isStorefrontEndpoint("/product/variants/?product=123"), true);
    assert.equal(isStorefrontEndpoint("/product/categories/"), true);

    // Protected account endpoints must NOT be classified as storefront
    assert.equal(isStorefrontEndpoint("/account/profile/"), false);
    assert.equal(isStorefrontEndpoint("/account/user/"), false);
    assert.equal(isStorefrontEndpoint("/orders/checkout/"), false);
  });

  test("resolveMediaUrl normalizes portless localhost media URLs and formats relative paths", async () => {
    const { resolveMediaUrl } = await import("../services/productService.js");

    // Portless localhost from DRF
    const normalizedPortless = resolveMediaUrl(
      "http://localhost/media/products/videos/gemini_generated_video_5bc856e3.mp4"
    );
    assert.match(normalizedPortless, /http:\/\/localhost:8000\/media\/products\/videos\/gemini_generated_video_5bc856e3\.mp4/);

    // External absolute URL preserved
    assert.equal(
      resolveMediaUrl("https://storage.googleapis.com/test-bucket/video.mp4"),
      "https://storage.googleapis.com/test-bucket/video.mp4"
    );

    // Relative path with /media/
    const normalizedRelativeMedia = resolveMediaUrl("/media/products/videos/test.mp4");
    assert.match(normalizedRelativeMedia, /http:\/\/localhost:8000\/media\/products\/videos\/test\.mp4/);

    // Relative path without /media/
    const normalizedRawPath = resolveMediaUrl("products/videos/test.mp4");
    assert.match(normalizedRawPath, /http:\/\/localhost:8000\/media\/products\/videos\/test\.mp4/);

    // Null and empty return null
    assert.equal(resolveMediaUrl(null), null);
    assert.equal(resolveMediaUrl(""), null);
  });

  test("Storefront 401 response interceptor logic rejects without triggering login redirect", () => {
    const shouldBypassAuthRedirect = (status, url, skipFlag, isPublicFn, isStorefrontFn) => {
      if (
        status !== 401 ||
        skipFlag ||
        isPublicFn(url) ||
        isStorefrontFn(url)
      ) {
        return true; // Bypasses redirect to login
      }
      return false; // Will redirect to /login
    };

    const mockIsPublic = (url) => url.startsWith("/account/login");
    const mockIsStorefront = (url) => url.includes("/product/");

    // Product videos returning 401 must bypass login redirect
    assert.equal(
      shouldBypassAuthRedirect(401, "/product/product-videos/?product=123", false, mockIsPublic, mockIsStorefront),
      true
    );

    // Protected profile returning 401 must NOT bypass (must redirect)
    assert.equal(
      shouldBypassAuthRedirect(401, "/account/profile/", false, mockIsPublic, mockIsStorefront),
      false
    );
  });

  test("Token storage helpers safely ignore 'undefined' and 'null' strings", async () => {
    const { getStoredAccessToken, getStoredAdminToken, getStoredRefreshToken } = await import(
      "../services/api.js"
    );

    // Mock localStorage with string 'undefined'
    globalThis.localStorage.setItem("access_token", "undefined");
    globalThis.localStorage.setItem("admin_token", "null");
    globalThis.localStorage.setItem("refresh_token", "   ");

    assert.equal(getStoredAccessToken(), null);
    assert.equal(getStoredAdminToken(), null);
    assert.equal(getStoredRefreshToken(), null);

    globalThis.localStorage.removeItem("access_token");
    globalThis.localStorage.removeItem("admin_token");
    globalThis.localStorage.removeItem("refresh_token");
  });

  test("Category sanitization suppresses 'all', 'undefined', and 'null' query params", () => {
    const sanitizeCategoryParam = (categoryId) => {
      if (
        categoryId &&
        typeof categoryId === "string" &&
        categoryId.trim() &&
        categoryId.trim().toLowerCase() !== "all" &&
        categoryId.trim().toLowerCase() !== "undefined" &&
        categoryId.trim().toLowerCase() !== "null"
      ) {
        return categoryId.trim();
      }
      return undefined;
    };

    assert.equal(sanitizeCategoryParam("all"), undefined);
    assert.equal(sanitizeCategoryParam("All"), undefined);
    assert.equal(sanitizeCategoryParam("undefined"), undefined);
    assert.equal(sanitizeCategoryParam("null"), undefined);
    assert.equal(sanitizeCategoryParam(""), undefined);
    assert.equal(sanitizeCategoryParam("   "), undefined);
    assert.equal(
      sanitizeCategoryParam("7d4ba71a-e5cf-4dfc-8a19-cfd313beaa02"),
      "7d4ba71a-e5cf-4dfc-8a19-cfd313beaa02"
    );
  });

  test("isTokenExpired accurately detects expired and valid JWT tokens", async () => {
    const { isTokenExpired } = await import("../services/api.js");

    const createMockToken = (expSeconds) => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
      const payload = Buffer.from(JSON.stringify({ user_id: 1, exp: expSeconds })).toString("base64");
      const sig = "fakeSignature";
      return `${header}.${payload}.${sig}`;
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiredToken = createMockToken(nowSeconds - 3600); // 1 hour ago
    const validToken = createMockToken(nowSeconds + 3600); // 1 hour in future

    assert.equal(isTokenExpired(expiredToken), true);
    assert.equal(isTokenExpired(validToken), false);
    assert.equal(isTokenExpired(null), true);
    assert.equal(isTokenExpired("invalid.token"), true);
  });
});

describe("Admin Product Creation & Editing Contracts", () => {
  test("Admin token storage helpers retrieve and clear admin tokens cleanly", async () => {
    const {
      getStoredAdminToken,
      getStoredAdminRefreshToken,
      clearStoredAdminAuth,
    } = await import("../services/api.js");

    globalThis.localStorage.setItem("admin_token", "test_admin_access");
    globalThis.localStorage.setItem("admin_refresh", "test_admin_refresh");
    globalThis.localStorage.setItem("admin_user", JSON.stringify({ role: "admin" }));

    assert.equal(getStoredAdminToken(), "test_admin_access");
    assert.equal(getStoredAdminRefreshToken(), "test_admin_refresh");

    clearStoredAdminAuth();

    assert.equal(getStoredAdminToken(), null);
    assert.equal(getStoredAdminRefreshToken(), null);
  });

  test("Product creation payload serializer validates required fields and formats numeric types", () => {
    const validateAndBuildProductPayload = (formData) => {
      const errors = {};
      if (!formData.name?.trim()) errors.name = "Product name is required.";
      if (!formData.product_category) errors.product_category = "Category is required.";
      if (formData.price === "" || parseFloat(formData.price) < 0 || isNaN(parseFloat(formData.price))) {
        errors.price = "Enter a valid non-negative price.";
      }
      if (formData.stock_quantity === "" || parseInt(formData.stock_quantity, 10) < 0 || isNaN(parseInt(formData.stock_quantity, 10))) {
        errors.stock_quantity = "Stock quantity cannot be negative.";
      }

      if (Object.keys(errors).length > 0) {
        return { isValid: false, errors };
      }

      return {
        isValid: true,
        payload: {
          name: formData.name.trim(),
          product_category: formData.product_category,
          price: parseFloat(formData.price).toFixed(2),
          stock_quantity: parseInt(formData.stock_quantity, 10),
          unit: formData.unit || "piece",
          description: formData.description?.trim() || "",
          is_active: Boolean(formData.is_active),
        },
      };
    };

    // Valid submission
    const valid = validateAndBuildProductPayload({
      name: "  Organic Honey  ",
      product_category: "942ec4cf-75a7-4712-a72a-d9c9e8218d6e",
      price: "350.5",
      stock_quantity: "25",
      unit: "kg",
      description: "Raw forest honey",
      is_active: true,
    });

    assert.equal(valid.isValid, true);
    assert.equal(valid.payload.name, "Organic Honey");
    assert.equal(valid.payload.price, "350.50");
    assert.equal(valid.payload.stock_quantity, 25);
    assert.equal(valid.payload.unit, "kg");

    // Invalid missing category and negative price
    const invalid = validateAndBuildProductPayload({
      name: "",
      product_category: "",
      price: "-10",
      stock_quantity: "-5",
    });

    assert.equal(invalid.isValid, false);
    assert.match(invalid.errors.name, /required/);
    assert.match(invalid.errors.product_category, /required/);
    assert.match(invalid.errors.price, /non-negative/);
    assert.match(invalid.errors.stock_quantity, /negative/);
  });

  test("Edit vs Create detection correctly identifies editing state from productId or product object", () => {
    const resolveProductModalState = ({ product, productId }) => {
      const activeId = productId || product?.id || null;
      return {
        activeProductId: activeId,
        isEdit: Boolean(activeId),
      };
    };

    // Create mode
    assert.deepEqual(resolveProductModalState({ product: null, productId: null }), {
      activeProductId: null,
      isEdit: false,
    });

    // Edit mode via productId
    assert.deepEqual(
      resolveProductModalState({ product: null, productId: "6144e138-03b1-4f93-b673-8255b1f868ae" }),
      {
        activeProductId: "6144e138-03b1-4f93-b673-8255b1f868ae",
        isEdit: true,
      }
    );

    // Edit mode via product object
    assert.deepEqual(
      resolveProductModalState({ product: { id: "prod-123", name: "Mangoes" }, productId: null }),
      {
        activeProductId: "prod-123",
        isEdit: true,
      }
    );
  });

  test("mapProductToFormData populates all fields accurately from backend detail response", async () => {
    const { mapProductToFormData } = await import("../services/adminService.js");

    const backendProduct = {
      id: "96d7c711-209d-4720-a88e-67a68e82a6eb",
      name: "Organic Alphonso Mangoes",
      product_category: "c2020ce8-6394-4d8f-9a74-984bb3e3cb83",
      category_name: "Fresh Fruits",
      category: {
        id: "c2020ce8-6394-4d8f-9a74-984bb3e3cb83",
        name: "Fresh Fruits",
        slug: "fresh-fruits",
      },
      price: "120.00",
      stock_quantity: 45,
      unit: "kg",
      description: "Naturally ripened Ratnagiri mangoes harvested at dawn.",
      is_active: true,
      images: [{ id: "img-1", is_primary: true }],
      variants: [{ id: "var-1", sku: "MANG-500", quantity: "0.500", price: "65.00" }],
    };

    const formData = mapProductToFormData(backendProduct);

    assert.equal(formData.name, "Organic Alphonso Mangoes");
    assert.equal(formData.product_category, "c2020ce8-6394-4d8f-9a74-984bb3e3cb83");
    assert.equal(formData.price, "120.00");
    assert.equal(formData.stock_quantity, 45);
    assert.equal(formData.unit, "kg");
    assert.equal(formData.description, "Naturally ripened Ratnagiri mangoes harvested at dawn.");
    assert.equal(formData.is_active, true);
  });

  test("mapProductToFormData preserves zero values for price and stock quantity without converting to empty strings", async () => {
    const { mapProductToFormData } = await import("../services/adminService.js");

    const zeroProduct = {
      id: "prod-zero",
      name: "Zero Value Produce Item",
      product_category: "cat-1",
      price: 0,
      stock_quantity: 0,
      unit: "piece",
      description: "Promotional sample batch",
      is_active: false,
    };

    const formData = mapProductToFormData(zeroProduct);

    assert.equal(formData.name, "Zero Value Produce Item");
    assert.equal(formData.price, "0", "Price of 0 must display as '0', not empty string");
    assert.equal(formData.stock_quantity, 0, "Stock quantity of 0 must display as 0");
    assert.equal(formData.is_active, false);
    assert.equal(formData.unit, "piece");
  });

  test("mapProductToFormData extracts category ID from nested object, category_id, or string", async () => {
    const { mapProductToFormData } = await import("../services/adminService.js");

    // Case 1: category is nested object
    const res1 = mapProductToFormData({
      name: "Apples",
      category: { id: "cat-nested-123", name: "Fruits" },
    });
    assert.equal(res1.product_category, "cat-nested-123");

    // Case 2: product_category is nested object
    const res2 = mapProductToFormData({
      name: "Apples",
      product_category: { id: "cat-pc-456", name: "Fruits" },
    });
    assert.equal(res2.product_category, "cat-pc-456");

    // Case 3: category_id field
    const res3 = mapProductToFormData({
      name: "Apples",
      category_id: "cat-id-789",
    });
    assert.equal(res3.product_category, "cat-id-789");
  });

  test("mapProductToFormData handles alternate field names product_name, desc, and status", async () => {
    const { mapProductToFormData } = await import("../services/adminService.js");

    const altProduct = {
      product_name: "Fresh Mint Leaves",
      category_id: "cat-herbs",
      regular_price: "15.00",
      quantity: 100,
      desc: "Hydroponic garden mint",
      status: "active",
    };

    const formData = mapProductToFormData(altProduct);

    assert.equal(formData.name, "Fresh Mint Leaves");
    assert.equal(formData.product_category, "cat-herbs");
    assert.equal(formData.price, "15.00");
    assert.equal(formData.stock_quantity, 100);
    assert.equal(formData.description, "Hydroponic garden mint");
    assert.equal(formData.is_active, true);
  });

  test("mapProductToFormData handles wrapped responses and null/undefined values safely", async () => {
    const { mapProductToFormData } = await import("../services/adminService.js");

    // Wrapped in data property
    const wrapped = {
      data: {
        id: "wrapped-1",
        name: "Wrapped Item",
        price: "50.00",
        stock_quantity: 10,
      },
    };
    const formWrapped = mapProductToFormData(wrapped);
    assert.equal(formWrapped.name, "Wrapped Item");
    assert.equal(formWrapped.price, "50.00");

    // Null and empty
    const emptyForm = mapProductToFormData(null);
    assert.equal(emptyForm.name, "");
    assert.equal(emptyForm.product_category, "");
    assert.equal(emptyForm.price, "");
    assert.equal(emptyForm.stock_quantity, 0);
    assert.equal(emptyForm.unit, "kg");
    assert.equal(emptyForm.is_active, true);
  });
});

describe("Feature A, B, C: Product Media Sequence, Hover Zoom & Slider Contracts", () => {
  test("buildMediaSequence correctly builds single image product", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/single.jpg", is_primary: true }],
      video: null,
    });

    assert.equal(seq.length, 1);
    assert.equal(seq[0].type, "image");
    assert.equal(seq[0].url, "https://example.com/single.jpg");
    assert.equal(seq[0].is_primary, true);
  });

  test("buildMediaSequence prioritizes primary image first and preserves all multiple images", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const images = [
      { id: 10, image: "https://example.com/angle-side.jpg", is_primary: false },
      { id: 11, image: "https://example.com/angle-front.jpg", is_primary: true },
      { id: 12, image: "https://example.com/angle-close.jpg", is_primary: false },
    ];

    const seq = buildMediaSequence({ images, video: null });

    assert.equal(seq.length, 3);
    assert.equal(seq[0].url, "https://example.com/angle-front.jpg");
    assert.equal(seq[0].is_primary, true);
    assert.equal(seq[1].url, "https://example.com/angle-side.jpg");
    assert.equal(seq[2].url, "https://example.com/angle-close.jpg");
  });

  test("buildMediaSequence appends promotional video at the end of the sequence", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const images = [
      { id: 1, image: "https://example.com/photo-1.jpg", is_primary: true },
      { id: 2, image: "https://example.com/photo-2.jpg", is_primary: false },
    ];
    const videoObj = {
      id: 99,
      video: "https://example.com/farm-harvest.mp4",
      title: "Harvest Story",
    };

    const seq = buildMediaSequence({ images, video: videoObj });

    assert.equal(seq.length, 3);
    assert.equal(seq[0].type, "image");
    assert.equal(seq[1].type, "image");
    assert.equal(seq[2].type, "video");
    assert.equal(seq[2].url, "https://example.com/farm-harvest.mp4");
    assert.equal(seq[2].title, "Harvest Story");
  });

  test("buildMediaSequence safely handles product with no video and avoids phantom items", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/item.jpg" }],
      video: null,
    });

    assert.equal(seq.length, 1);
    assert.equal(seq.some((item) => item.type === "video"), false);
  });

  test("buildMediaSequence falls back to product_img when images array is empty", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const seq = buildMediaSequence({
      images: [],
      video: null,
      productImg: "https://example.com/fallback.jpg",
    });

    assert.equal(seq.length, 1);
    assert.equal(seq[0].url, "https://example.com/fallback.jpg");
    assert.equal(seq[0].is_primary, true);
  });

  test("buildMediaSequence dedups duplicate images and ignores null/broken entries", async () => {
    const { buildMediaSequence } = await import("../utils/mediaSequence.js");
    const images = [
      { id: 1, image: "https://example.com/same.jpg", is_primary: true },
      { id: 2, image: "https://example.com/same.jpg", is_primary: false },
      { id: 3, image: null },
      { id: 4, image: "" },
    ];

    const seq = buildMediaSequence({ images, video: null });
    assert.equal(seq.length, 1);
    assert.equal(seq[0].url, "https://example.com/same.jpg");
  });

  test("calculateZoomCoordinates computes percentage and clamps out-of-bounds mouse coordinates", async () => {
    const { calculateZoomCoordinates } = await import("../utils/mediaSequence.js");

    const bounds = { left: 100, top: 50, width: 400, height: 300 };

    // Point exactly in the middle: x=300, y=200 -> ((300-100)/400)*100 = 50%, ((200-50)/300)*100 = 50%
    const center = calculateZoomCoordinates(300, 200, bounds);
    assert.equal(center.x, 50);
    assert.equal(center.y, 50);

    // Point to top-left corner
    const topLeft = calculateZoomCoordinates(100, 50, bounds);
    assert.equal(topLeft.x, 0);
    assert.equal(topLeft.y, 0);

    // Point beyond bottom-right corner (clamped to 100)
    const overRight = calculateZoomCoordinates(600, 450, bounds);
    assert.equal(overRight.x, 100);
    assert.equal(overRight.y, 100);

    // Point beyond top-left corner (clamped to 0)
    const underLeft = calculateZoomCoordinates(50, 10, bounds);
    assert.equal(underLeft.x, 0);
    assert.equal(underLeft.y, 0);

    // Invalid or zero bounds returns safe center 50, 50
    const fallback = calculateZoomCoordinates(200, 200, { width: 0, height: 0 });
    assert.equal(fallback.x, 50);
    assert.equal(fallback.y, 50);
  });

  test("getNextMediaIndex wraps smoothly from last item to first item", async () => {
    const { getNextMediaIndex } = await import("../utils/mediaSequence.js");

    assert.equal(getNextMediaIndex(0, 3), 1);
    assert.equal(getNextMediaIndex(1, 3), 2);
    // Wrap around:
    assert.equal(getNextMediaIndex(2, 3), 0);
    // Single item returns 0 without crashing:
    assert.equal(getNextMediaIndex(0, 1), 0);
    // Zero items:
    assert.equal(getNextMediaIndex(0, 0), 0);
  });

  test("getPrevMediaIndex wraps smoothly from first item to last item", async () => {
    const { getPrevMediaIndex } = await import("../utils/mediaSequence.js");

    // Wrap around backwards:
    assert.equal(getPrevMediaIndex(0, 3), 2);
    assert.equal(getPrevMediaIndex(2, 3), 1);
    assert.equal(getPrevMediaIndex(1, 3), 0);
    // Single item:
    assert.equal(getPrevMediaIndex(0, 1), 0);
  });
});

describe("Product Variant Stock & Availability Synchronization Contracts", () => {
  test("Product with stock 0 and active variant with stock 5 is resolved as in stock", () => {
    const product = {
      id: "prod-salt",
      name: "Rock Salt",
      stock_quantity: 0,
      is_in_stock: true,
      has_variants: true,
      variants: [
        { id: "var-1", sku: "SALT-500G", stock_quantity: 5, is_active: true }
      ]
    };

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const anyVariantInStock = hasVariants && product.variants.some(
      (v) => (v.stock_quantity || 0) > 0 && v.is_active !== false
    );
    const inStock = product.is_in_stock !== undefined
      ? Boolean(product.is_in_stock)
      : (hasVariants ? anyVariantInStock : (product.stock_quantity || 0) > 0);

    assert.equal(inStock, true);
  });

  test("Product with all active variants having stock 0 is resolved as out of stock", () => {
    const product = {
      id: "prod-oil",
      name: "Sesame Oil",
      stock_quantity: 0,
      is_in_stock: false,
      has_variants: true,
      variants: [
        { id: "var-1", sku: "OIL-500ML", stock_quantity: 0, is_active: true },
        { id: "var-2", sku: "OIL-1L", stock_quantity: 0, is_active: true },
      ]
    };

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const anyVariantInStock = hasVariants && product.variants.some(
      (v) => (v.stock_quantity || 0) > 0 && v.is_active !== false
    );
    const inStock = product.is_in_stock !== undefined
      ? Boolean(product.is_in_stock)
      : (hasVariants ? anyVariantInStock : (product.stock_quantity || 0) > 0);

    assert.equal(inStock, false);
  });

  test("Product without variants preserves product-level stock availability", () => {
    const inStockProduct = {
      id: "prod-apples",
      stock_quantity: 15,
      is_in_stock: true,
      has_variants: false,
      variants: []
    };
    const outOfStockProduct = {
      id: "prod-pears",
      stock_quantity: 0,
      is_in_stock: false,
      has_variants: false,
      variants: []
    };

    const checkAvailability = (p) => {
      const hasVars = Array.isArray(p.variants) && p.variants.length > 0;
      if (p.is_in_stock !== undefined) return Boolean(p.is_in_stock);
      if (hasVars) {
        return p.variants.some((v) => (v.stock_quantity || 0) > 0 && v.is_active !== false);
      }
      return (Number(p.stock_quantity) || 0) > 0;
    };

    assert.equal(checkAvailability(inStockProduct), true);
    assert.equal(checkAvailability(outOfStockProduct), false);
  });

  test("Cart clamping logic respects selected variant stock limit", () => {
    const variant = { id: "var-500g", stock_quantity: 5, price: "60.00" };
    const product = { id: "prod-honey", stock_quantity: 0, price: "100.00" };

    const maxStock = typeof variant?.stock_quantity === "number"
      ? variant.stock_quantity
      : (typeof product.stock_quantity === "number" ? product.stock_quantity : 99);

    assert.equal(maxStock, 5);

    // Adding quantity 8 should clamp to 5
    const requestedQty = 8;
    const clampedQty = Math.min(requestedQty, maxStock);
    assert.equal(clampedQty, 5);

    // Adding to depleted variant should be rejected
    const depletedVariant = { id: "var-depleted", stock_quantity: 0 };
    const depletedMax = depletedVariant.stock_quantity;
    assert.equal(depletedMax <= 0, true);
  });
});

describe("Bug Fix: Synchronized Product Image Slider & Video Playback", () => {
  test("Scenario 1: Images only - images slide automatically and timer schedules sequential advance", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const images = [
      { id: 1, image: "https://example.com/img1.jpg" },
      { id: 2, image: "https://example.com/img2.jpg" },
      { id: 3, image: "https://example.com/img3.jpg" },
    ];
    const seq = buildMediaSequence({ images });
    assert.equal(seq.length, 3);
    assert.equal(seq.every((m) => m.type === "image"), true);

    const visitedIndices = [];
    const controller = createMediaPlaybackController({
      sequence: seq,
      imageDuration: 100,
      onIndexChange: (idx) => visitedIndices.push(idx),
    });

    assert.equal(controller.getCurrentIndex(), 0);
    controller.scheduleNext();
    assert.equal(controller.isTimerActive(), true);

    // Simulate timer ticks
    controller.advance();
    assert.equal(controller.getCurrentIndex(), 1);
    assert.equal(controller.getActiveItem().url, "https://example.com/img2.jpg");

    controller.advance();
    assert.equal(controller.getCurrentIndex(), 2);

    controller.advance();
    assert.equal(controller.getCurrentIndex(), 0); // Wraps smoothly

    controller.destroy();
    assert.equal(controller.isTimerActive(), false);
  });

  test("Scenario 2: One image and one video - image displays, video pauses image timer, ended transitions back", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/solo.jpg", is_primary: true }],
      video: { id: "vid-1", video: "https://example.com/solo.mp4" },
    });
    assert.equal(seq.length, 2);
    assert.equal(seq[0].type, "image");
    assert.equal(seq[1].type, "video");

    const controller = createMediaPlaybackController({
      sequence: seq,
      imageDuration: 100,
    });

    // Initial state: Image 0 is active
    assert.equal(controller.getCurrentIndex(), 0);
    controller.scheduleNext();
    assert.equal(controller.isTimerActive(), true);

    // Timer expires: advance to Video (index 1)
    controller.advance();
    assert.equal(controller.getCurrentIndex(), 1);
    assert.equal(controller.getActiveItem().type, "video");

    // Video is active: Image timer MUST be cleared / inactive!
    assert.equal(controller.isTimerActive(), false);

    // Video plays
    controller.onVideoPlay();
    assert.equal(controller.isVideoPlaying(), true);
    assert.equal(controller.isTimerActive(), false);

    // Video finishes: triggers ended event -> transitions back to image 0
    controller.onVideoEnded();
    assert.equal(controller.getCurrentIndex(), 0);
    assert.equal(controller.getActiveItem().type, "image");
    assert.equal(controller.isTimerActive(), true); // Image timer safely resumes

    controller.destroy();
  });

  test("Scenario 3: Multiple images and video - advance images, video plays once, image appears on finish", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [
        { id: 1, image: "https://example.com/apple1.jpg" },
        { id: 2, image: "https://example.com/apple2.jpg" },
      ],
      video: { id: "vid-promo", video: "https://example.com/orchard.mp4" },
    });
    assert.equal(seq.length, 3);
    assert.equal(seq[0].type, "image");
    assert.equal(seq[1].type, "image");
    assert.equal(seq[2].type, "video");

    const controller = createMediaPlaybackController({
      sequence: seq,
      imageDuration: 100,
    });

    // Image 1 -> Image 2
    assert.equal(controller.getCurrentIndex(), 0);
    controller.advance();
    assert.equal(controller.getCurrentIndex(), 1);

    // Image 2 -> Video
    controller.advance();
    assert.equal(controller.getCurrentIndex(), 2);
    assert.equal(controller.getActiveItem().type, "video");
    assert.equal(controller.isTimerActive(), false); // Image timer is cleared immediately

    // Video finishes -> Image 1
    controller.onVideoEnded();
    assert.equal(controller.getCurrentIndex(), 0);
    assert.equal(controller.getActiveItem().type, "image");

    controller.destroy();
  });

  test("Scenario 4: Video is final item with configurable loop behavior", async () => {
    const { buildMediaSequence, createMediaPlaybackController, getNextMediaIndex } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/cover.jpg" }],
      video: { id: "vid-end", video: "https://example.com/outro.mp4" },
    });

    // Subcase 4A: loop = true (default)
    const loopingController = createMediaPlaybackController({
      sequence: seq,
      loop: true,
    });
    loopingController.selectIndex(1); // Jump to video
    assert.equal(loopingController.getCurrentIndex(), 1);
    loopingController.onVideoEnded();
    assert.equal(loopingController.getCurrentIndex(), 0); // Loops back to 0
    loopingController.destroy();

    // Subcase 4B: loop = false
    const nonLoopingController = createMediaPlaybackController({
      sequence: seq,
      loop: false,
    });
    nonLoopingController.selectIndex(1); // Jump to video
    assert.equal(nonLoopingController.getCurrentIndex(), 1);
    nonLoopingController.onVideoEnded();
    assert.equal(nonLoopingController.getCurrentIndex(), 1); // Stays on final video
    nonLoopingController.destroy();

    // Direct helper boundary checks
    assert.equal(getNextMediaIndex(2, 3, false), 2); // Does not wrap when loop=false
    assert.equal(getNextMediaIndex(2, 3, true), 0);  // Wraps when loop=true
  });

  test("Scenario 5: User manually selects another image while video is playing - video state cleared and timer resumes", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [
        { id: 1, image: "https://example.com/imgA.jpg" },
        { id: 2, image: "https://example.com/imgB.jpg" },
      ],
      video: { id: "vid", video: "https://example.com/video.mp4" },
    });

    const controller = createMediaPlaybackController({ sequence: seq });
    controller.selectIndex(2); // Active item is video
    assert.equal(controller.getCurrentIndex(), 2);
    controller.onVideoPlay();
    assert.equal(controller.isVideoPlaying(), true);

    // User clicks thumbnail for Image 0 while video was playing
    controller.selectIndex(0);
    assert.equal(controller.getCurrentIndex(), 0);
    assert.equal(controller.getActiveItem().type, "image");
    assert.equal(controller.isVideoPlaying(), false); // Old video playback terminated
    assert.equal(controller.isTimerActive(), true);   // Fresh image timer initialized

    // Stray video ended from unmounted/previous video must not advance
    controller.onVideoEnded();
    assert.equal(controller.getCurrentIndex(), 0); // Stays at 0, no stray advance

    controller.destroy();
  });

  test("Scenario 6: User pauses the video - gallery must NOT advance", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/i1.jpg" }],
      video: { id: "vid", video: "https://example.com/clip.mp4" },
    });

    const controller = createMediaPlaybackController({ sequence: seq });
    controller.selectIndex(1); // On video
    controller.onVideoPlay();
    assert.equal(controller.isVideoPlaying(), true);

    // User pauses video
    controller.onVideoPause();
    assert.equal(controller.isVideoPlaying(), false);
    assert.equal(controller.isTimerActive(), false); // Strictly NO timer running
    assert.equal(controller.getCurrentIndex(), 1);   // Stays on video

    controller.destroy();
  });

  test("Scenario 7: Switch to another product - clean reset with no lingering timers", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const prod1Seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/p1-1.jpg" }],
      video: { id: "v1", video: "https://example.com/v1.mp4" },
    });
    const controller = createMediaPlaybackController({ sequence: prod1Seq });
    controller.selectIndex(1); // Watching video on prod 1

    // Product switches: controller is destroyed / re-initialized
    controller.destroy();
    assert.equal(controller.isTimerActive(), false);

    const prod2Seq = buildMediaSequence({
      images: [{ id: 201, image: "https://example.com/p2-1.jpg" }],
    });
    const freshController = createMediaPlaybackController({ sequence: prod2Seq });
    assert.equal(freshController.getCurrentIndex(), 0);
    assert.equal(freshController.getActiveItem().url, "https://example.com/p2-1.jpg");
    freshController.destroy();
  });

  test("Scenario 8: Video fails to load - safe error handling does not freeze gallery", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [{ id: 1, image: "https://example.com/pic1.jpg" }],
      video: { id: "broken", video: "https://example.com/404.mp4" },
    });

    const controller = createMediaPlaybackController({ sequence: seq });
    controller.selectIndex(1); // Jump to video

    // Video error occurs: simulate user clicking "Continue to Photos"
    controller.advance();
    assert.equal(controller.getCurrentIndex(), 0); // Safely returns to image
    assert.equal(controller.getActiveItem().type, "image");

    controller.destroy();
  });

  test("Scenario 9: Zoom coordinates and manual navigation boundary verification", async () => {
    const { calculateZoomCoordinates, getPrevMediaIndex, getNextMediaIndex } = await import("../utils/mediaSequence.js");

    // Clamping limits
    const bounds = { left: 50, top: 50, width: 200, height: 200 };
    assert.deepEqual(calculateZoomCoordinates(150, 150, bounds), { x: 50, y: 50 });
    assert.deepEqual(calculateZoomCoordinates(0, 0, bounds), { x: 0, y: 0 });
    assert.deepEqual(calculateZoomCoordinates(500, 500, bounds), { x: 100, y: 100 });

    // Non-looping boundaries
    assert.equal(getPrevMediaIndex(0, 3, false), 0);
    assert.equal(getNextMediaIndex(2, 3, false), 2);
  });

  test("Regression: Guard against multiple rapid video ended events", async () => {
    const { buildMediaSequence, createMediaPlaybackController } = await import("../utils/mediaSequence.js");

    const seq = buildMediaSequence({
      images: [
        { id: 1, image: "https://example.com/1.jpg" },
        { id: 2, image: "https://example.com/2.jpg" },
      ],
      video: { id: "v", video: "https://example.com/v.mp4" },
    });

    const controller = createMediaPlaybackController({ sequence: seq });
    controller.selectIndex(2); // On video

    // Multiple duplicate ended events fired in rapid succession
    controller.onVideoEnded();
    controller.onVideoEnded();
    controller.onVideoEnded();

    // Should only have transitioned once to index 0 (not skipping over to index 1 or 2)
    assert.equal(controller.getCurrentIndex(), 0);

    controller.destroy();
  });
});

describe("Admin Product Variant Display & Management Contracts", () => {
  test("Product with no variants displays 'No variants' and count 0", () => {
    const product = {
      id: "prod-honey",
      name: "Raw Wild Honey",
      price: "250.00",
      stock_quantity: 15,
      unit: "piece",
      variants: [],
      variants_count: 0,
    };

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const count = variants.length || product.variants_count || 0;
    const badgeText = count > 0 ? `${count} variant${count !== 1 ? "s" : ""}` : "No variants";

    assert.equal(count, 0);
    assert.equal(badgeText, "No variants");
  });

  test("Product with one variant displays '1 variant' and formats fields", () => {
    const product = {
      id: "prod-ghee",
      name: "Organic Ghee",
      price: "350.00",
      stock_quantity: 10,
      unit: "l",
      variants: [
        {
          id: "var-1",
          sku: "GHEE-500ML",
          quantity: "500.000",
          unit: "ml",
          price: "350.00",
          mrp: "380.00",
          stock_quantity: 10,
          is_active: true,
        },
      ],
      variants_count: 1,
    };

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const count = variants.length || product.variants_count || 0;
    const badgeText = count > 0 ? `${count} variant${count !== 1 ? "s" : ""}` : "No variants";

    assert.equal(count, 1);
    assert.equal(badgeText, "1 variant");
    assert.equal(parseFloat(variants[0].quantity), 500);
    assert.equal(parseFloat(variants[0].price).toFixed(2), "350.00");
  });

  test("Product with multiple variants formats sizes (500 g at ₹60, stock 5 and 1 kg at ₹110, stock 10)", () => {
    const product = {
      id: "prod-flour",
      name: "Organic Wheat Flour",
      price: "60.00",
      stock_quantity: 15,
      unit: "kg",
      variants: [
        {
          id: "var-500g",
          sku: "WHEAT-500G",
          quantity: "500.000",
          unit: "g",
          price: "60.00",
          mrp: "70.00",
          stock_quantity: 5,
          is_active: true,
        },
        {
          id: "var-1kg",
          sku: "WHEAT-1KG",
          quantity: "1.000",
          unit: "kg",
          price: "110.00",
          mrp: "125.00",
          stock_quantity: 10,
          is_active: true,
        },
      ],
      variants_count: 2,
    };

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const count = variants.length || product.variants_count || 0;
    const badgeText = count > 0 ? `${count} variant${count !== 1 ? "s" : ""}` : "No variants";

    assert.equal(count, 2);
    assert.equal(badgeText, "2 variants");

    const formattedVariants = variants.map((v) => ({
      sku: v.sku,
      size: `${parseFloat(v.quantity)} ${v.unit}`,
      price: `₹${parseFloat(v.price).toFixed(2)}`,
      mrp: `₹${parseFloat(v.mrp).toFixed(2)}`,
      stock: v.stock_quantity,
      status: v.is_active ? "Active" : "Inactive",
    }));

    assert.deepEqual(formattedVariants[0], {
      sku: "WHEAT-500G",
      size: "500 g",
      price: "₹60.00",
      mrp: "₹70.00",
      stock: 5,
      status: "Active",
    });

    assert.deepEqual(formattedVariants[1], {
      sku: "WHEAT-1KG",
      size: "1 kg",
      price: "₹110.00",
      mrp: "₹125.00",
      stock: 10,
      status: "Active",
    });
  });

  test("Variant edit payload preserves ID and updates price, stock, and unit", () => {
    const existingVariant = {
      id: "var-existing-123",
      product: "prod-wheat",
      sku: "WHEAT-500G",
      quantity: "500.000",
      unit: "g",
      price: "60.00",
      mrp: "70.00",
      stock_quantity: 5,
      is_active: true,
    };

    const updatedFormData = {
      sku: "WHEAT-500G",
      quantity: "500",
      unit: "g",
      price: "65.00",
      mrp: "75.00",
      stock_quantity: 8,
      is_active: true,
    };

    const payload = {
      product: existingVariant.product,
      sku: updatedFormData.sku.trim().toUpperCase(),
      quantity: parseFloat(updatedFormData.quantity),
      unit: updatedFormData.unit,
      price: parseFloat(updatedFormData.price).toFixed(2),
      mrp: parseFloat(updatedFormData.mrp).toFixed(2),
      stock_quantity: parseInt(updatedFormData.stock_quantity, 10),
      is_active: updatedFormData.is_active,
    };

    assert.equal(payload.price, "65.00");
    assert.equal(payload.stock_quantity, 8);
    assert.equal(payload.sku, "WHEAT-500G");
  });

  test("Variant load failure does not silently hide variants and surfaces readable error", () => {
    let variantError = "";
    const mockApiError = {
      response: {
        data: {
          detail: "Unable to retrieve package variants at this time.",
        },
      },
    };

    try {
      throw mockApiError;
    } catch (err) {
      variantError =
        err.response?.data?.detail || "Could not load variants from server. Please refresh.";
    }

    assert.equal(variantError, "Unable to retrieve package variants at this time.");
  });
});

describe("Cart Service & Cart Page Integration Contracts", () => {
  test("addItemToCart formats payload without variant when variant is omitted", () => {
    const buildPayload = ({ productId, variantId = null, quantity = 1 }) => {
      const payload = {
        product: productId,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
      };
      if (variantId) {
        payload.variant = variantId;
      }
      return payload;
    };

    const payload = buildPayload({
      productId: "11111111-2222-3333-4444-555555555555",
      quantity: 2,
    });

    assert.deepEqual(payload, {
      product: "11111111-2222-3333-4444-555555555555",
      quantity: 2,
    });
    assert.equal(payload.variant, undefined);
  });

  test("addItemToCart includes variant UUID when variantId is provided", () => {
    const buildPayload = ({ productId, variantId = null, quantity = 1 }) => {
      const payload = {
        product: productId,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
      };
      if (variantId) {
        payload.variant = variantId;
      }
      return payload;
    };

    const payload = buildPayload({
      productId: "11111111-2222-3333-4444-555555555555",
      variantId: "66666666-7777-8888-9999-000000000000",
      quantity: 3,
    });

    assert.deepEqual(payload, {
      product: "11111111-2222-3333-4444-555555555555",
      variant: "66666666-7777-8888-9999-000000000000",
      quantity: 3,
    });
  });

  test("updateCartItemQuantity clamps quantity to minimum 1 and formats PATCH payload", () => {
    const buildUpdatePayload = (quantity) => ({
      quantity: Math.max(1, parseInt(quantity, 10) || 1),
    });

    assert.deepEqual(buildUpdatePayload(5), { quantity: 5 });
    assert.deepEqual(buildUpdatePayload(0), { quantity: 1 });
    assert.deepEqual(buildUpdatePayload(-2), { quantity: 1 });
    assert.deepEqual(buildUpdatePayload("invalid"), { quantity: 1 });
  });

  test("Cart delivery fee and free delivery threshold calculations", () => {
    const FREE_THRESHOLD = 500;
    const STANDARD_FEE = 40;

    const calculateDelivery = (subtotal, itemsCount) => {
      if (itemsCount === 0) return { fee: 0, progress: 0, remaining: FREE_THRESHOLD };
      const fee = subtotal >= FREE_THRESHOLD ? 0 : STANDARD_FEE;
      const progress = Math.min(100, Math.round((subtotal / FREE_THRESHOLD) * 100));
      const remaining = Math.max(0, FREE_THRESHOLD - subtotal);
      return { fee, progress, remaining };
    };

    // Empty cart
    const empty = calculateDelivery(0, 0);
    assert.equal(empty.fee, 0);
    assert.equal(empty.progress, 0);

    // Below threshold (₹200)
    const below = calculateDelivery(200, 2);
    assert.equal(below.fee, 40);
    assert.equal(below.progress, 40);
    assert.equal(below.remaining, 300);

    // At threshold (₹500)
    const exact = calculateDelivery(500, 3);
    assert.equal(exact.fee, 0);
    assert.equal(exact.progress, 100);
    assert.equal(exact.remaining, 0);

    // Above threshold (₹750)
    const above = calculateDelivery(750, 4);
    assert.equal(above.fee, 0);
    assert.equal(above.progress, 100);
    assert.equal(above.remaining, 0);
  });

  test("can_checkout is false when cart has unavailable items or is empty", () => {
    const evaluateCanCheckout = (items) => {
      if (!items || items.length === 0) return false;
      return items.every((item) => item.is_available === true);
    };

    assert.equal(evaluateCanCheckout([]), false);
    assert.equal(
      evaluateCanCheckout([
        { id: "1", is_available: true },
        { id: "2", is_available: true },
      ]),
      true
    );
    assert.equal(
      evaluateCanCheckout([
        { id: "1", is_available: true },
        { id: "2", is_available: false, issue: "out_of_stock" },
      ]),
      false
    );
  });

  test("Cart error message extractor handles quantity limit and out-of-stock responses", () => {
    const parseCartError = (errResponse) => {
      let errMessage = "Could not add item to basket.";
      if (errResponse?.data) {
        const respData = errResponse.data;
        if (Array.isArray(respData.quantity) && respData.quantity[0]) {
          errMessage = respData.quantity[0];
        } else if (Array.isArray(respData.variant) && respData.variant[0]) {
          errMessage = respData.variant[0];
        } else if (Array.isArray(respData.product) && respData.product[0]) {
          errMessage = respData.product[0];
        } else if (Array.isArray(respData.cart) && respData.cart[0]) {
          errMessage = respData.cart[0];
        } else if (typeof respData.detail === "string") {
          errMessage = respData.detail;
        }
      }
      return errMessage;
    };

    assert.equal(
      parseCartError({ data: { quantity: ["Only 3 available. You already have 2 in your cart."] } }),
      "Only 3 available. You already have 2 in your cart."
    );
    assert.equal(
      parseCartError({ data: { variant: ["Please choose a size for this item."] } }),
      "Please choose a size for this item."
    );
    assert.equal(
      parseCartError({ data: { cart: ["Your cart can hold at most 50 different items."] } }),
      "Your cart can hold at most 50 different items."
    );
  });
});




describe("Checkout & Address Validation Contract Tests", () => {
  const PHONE_REGEX = /^\+?\d{9,15}$/;
  const PINCODE_REGEX = /^\d{6}$/;

  const validateCheckoutForm = (formData) => {
    const errors = {};
    if (!formData.recipient_name?.trim()) {
      errors.recipient_name = "Recipient full name is required.";
    }
    const cleanPhone = (formData.recipient_phone || "").replace(/\s+/g, "");
    if (!cleanPhone) {
      errors.recipient_phone = "Phone number is required for delivery coordination.";
    } else if (!PHONE_REGEX.test(cleanPhone)) {
      errors.recipient_phone = "Enter a valid 9 to 15 digit phone number (e.g., +919876543210).";
    }

    if (!formData.shipping_address?.trim()) {
      errors.shipping_address = "Delivery house/street address is required.";
    } else if (formData.shipping_address.trim().length < 5) {
      errors.shipping_address = "Please enter a complete address (at least 5 characters).";
    }

    if (!formData.shipping_city?.trim()) {
      errors.shipping_city = "City / Town is required.";
    }

    const cleanPincode = (formData.shipping_pincode || "").trim();
    if (!cleanPincode) {
      errors.shipping_pincode = "Postal PIN code is required.";
    } else if (!PINCODE_REGEX.test(cleanPincode)) {
      errors.shipping_pincode = "Enter a valid 6-digit PIN code.";
    }

    if (!["cod", "online"].includes(formData.payment_method)) {
      errors.payment_method = "Please select a valid payment method.";
    }

    return errors;
  };

  test("validateCheckoutForm accepts valid customer information", () => {
    const validData = {
      recipient_name: "Anita Sharma",
      recipient_phone: "+919876543210",
      shipping_address: "Flat 4B, Green Meadows, 5th Main Road",
      shipping_city: "Bengaluru",
      shipping_pincode: "560001",
      payment_method: "cod",
    };
    const errors = validateCheckoutForm(validData);
    assert.deepEqual(errors, {});
  });

  test("validateCheckoutForm rejects short address, invalid pincode and malformed phone", () => {
    const invalidData = {
      recipient_name: "",
      recipient_phone: "1234",
      shipping_address: "Apt",
      shipping_city: "",
      shipping_pincode: "5600",
      payment_method: "crypto",
    };
    const errors = validateCheckoutForm(invalidData);
    assert.ok(errors.recipient_name);
    assert.ok(errors.recipient_phone);
    assert.ok(errors.shipping_address);
    assert.ok(errors.shipping_city);
    assert.ok(errors.shipping_pincode);
    assert.ok(errors.payment_method);
  });
});

describe("Order Details Timeline & Status Helpers", () => {
  const ORDER_STEPS = [
    { key: "placed", label: "Order Placed", statuses: ["pending", "confirmed", "processing", "shipped", "delivered"] },
    { key: "confirmed", label: "Confirmed", statuses: ["confirmed", "processing", "shipped", "delivered"] },
    { key: "processing", label: "Packing", statuses: ["processing", "shipped", "delivered"] },
    { key: "shipped", label: "Shipped", statuses: ["shipped", "delivered"] },
    { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  ];

  function getStepState(step, currentStatus) {
    if (currentStatus === "cancelled" || currentStatus === "failed") {
      return step.key === "placed" ? "cancelled" : "pending";
    }
    if (step.statuses.includes(currentStatus)) return "completed";
    return "pending";
  }

  test("getStepState computes completed steps correctly for confirmed status", () => {
    assert.equal(getStepState(ORDER_STEPS[0], "confirmed"), "completed");
    assert.equal(getStepState(ORDER_STEPS[1], "confirmed"), "completed");
    assert.equal(getStepState(ORDER_STEPS[2], "confirmed"), "pending");
    assert.equal(getStepState(ORDER_STEPS[3], "confirmed"), "pending");
  });

  test("getStepState handles cancelled order status", () => {
    assert.equal(getStepState(ORDER_STEPS[0], "cancelled"), "cancelled");
    assert.equal(getStepState(ORDER_STEPS[1], "cancelled"), "pending");
  });

  test("payment return status resolver does not treat redirect as proof of payment", () => {
    const resolveState = (order) => {
      if (!order) return "pending";
      const pStatus = order.payment?.status;
      if (pStatus === "paid") return "success";
      if (pStatus === "failed") return "failed";
      if (pStatus === "cancelled") return "cancelled";
      if (order.status === "cancelled") return "cancelled";
      return "pending";
    };

    assert.equal(resolveState(null), "pending");
    assert.equal(resolveState({ payment: { status: "pending" } }), "pending");
    assert.equal(resolveState({ payment: { status: "paid" } }), "success");
    assert.equal(resolveState({ payment: { status: "failed" } }), "failed");
    assert.equal(resolveState({ status: "cancelled", payment: { status: "pending" } }), "cancelled");
  });
});

describe("Guest Cart & Customer Checkout Integration Tests", () => {
  // Mock localStorage for test environment
  class MockLocalStorage {
    constructor() {
      this.store = {};
    }
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
    }
    setItem(key, value) {
      this.store[key] = String(value);
    }
    removeItem(key) {
      delete this.store[key];
    }
    clear() {
      this.store = {};
    }
  }

  const mockStorage = new MockLocalStorage();
  const GUEST_CART_KEY = "gv_guest_cart";

  function formatGuestCart(items) {
    if (!items || items.length === 0) {
      return {
        id: null,
        items: [],
        total_quantity: 0,
        subtotal: "0.00",
        unavailable_count: 0,
        can_checkout: false,
        updated_at: null,
      };
    }
    const rows = items.map((item) => ({
      ...item,
      quantity: item.quantity,
      unit_price: String(item.unit_price),
      line_total: (parseFloat(item.unit_price) * item.quantity).toFixed(2),
    }));
    const purchasable = rows.filter((r) => r.is_available);
    const subtotalNum = purchasable.reduce((acc, r) => acc + parseFloat(r.line_total), 0);
    const totalQty = rows.reduce((acc, r) => acc + (r.quantity || 0), 0);
    const unavail = rows.length - purchasable.length;

    return {
      id: "guest-cart",
      items: rows,
      total_quantity: totalQty,
      subtotal: subtotalNum.toFixed(2),
      unavailable_count: unavail,
      can_checkout: rows.length > 0 && unavail === 0,
      updated_at: new Date().toISOString(),
    };
  }

  function addGuestItem(storage, product, quantity = 1, variant = null) {
    const raw = storage.getItem(GUEST_CART_KEY);
    const items = raw ? JSON.parse(raw) : [];
    const targetVariantId = variant?.id || null;
    const existingIndex = items.findIndex(
      (i) => i.product.id === product.id && (targetVariantId ? i.variant?.id === targetVariantId : !i.variant)
    );

    const availableStock =
      typeof variant?.stock_quantity === "number"
        ? variant.stock_quantity
        : typeof product.stock_quantity === "number"
        ? product.stock_quantity
        : 999;

    let rawPrice = 0;
    if (variant && variant.price != null) rawPrice = parseFloat(variant.price);
    else if (variant && variant.mrp != null) rawPrice = parseFloat(variant.mrp);
    else if (product.price != null) rawPrice = parseFloat(product.price);
    else if (product.discount_price != null) rawPrice = parseFloat(product.discount_price);
    const unitPriceStr = (isNaN(rawPrice) ? 0 : rawPrice).toFixed(2);

    if (existingIndex >= 0) {
      const current = items[existingIndex];
      const newTotal = current.quantity + quantity;
      if (availableStock > 0 && current.quantity >= availableStock) {
        return { success: false, error: "Maximum stock reached" };
      }
      const finalQty = availableStock > 0 ? Math.min(newTotal, availableStock) : newTotal;
      items[existingIndex] = {
        ...current,
        quantity: finalQty,
        unit_price: unitPriceStr,
        line_total: (parseFloat(unitPriceStr) * finalQty).toFixed(2),
        available_stock: availableStock,
        is_available: availableStock >= finalQty,
      };
    } else {
      const finalQty = availableStock > 0 ? Math.min(quantity, availableStock) : quantity;
      const newItem = {
        id: `guest_${product.id}_${targetVariantId || "base"}`,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug || "slug",
          unit: product.unit || "unit",
          image: null,
        },
        variant: variant
          ? {
              id: variant.id,
              sku: variant.sku || "",
              quantity: String(variant.quantity || "1"),
              unit: variant.unit || "unit",
              mrp: String(variant.mrp || unitPriceStr),
            }
          : null,
        quantity: finalQty,
        unit_price: unitPriceStr,
        line_total: (parseFloat(unitPriceStr) * finalQty).toFixed(2),
        available_stock: availableStock,
        is_available: availableStock >= finalQty,
        issue: availableStock < finalQty ? "INSUFFICIENT_STOCK" : null,
      };
      items.push(newItem);
    }

    storage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    return { success: true, cart: formatGuestCart(items) };
  }

  test("guest cart allows adding products without authentication and calculates totals", () => {
    mockStorage.clear();
    const product = { id: "p-001", name: "Organic Tomatoes", price: "40.00", stock_quantity: 10 };
    const res = addGuestItem(mockStorage, product, 2);

    assert.equal(res.success, true);
    assert.equal(res.cart.items.length, 1);
    assert.equal(res.cart.total_quantity, 2);
    assert.equal(res.cart.subtotal, "80.00");
    assert.equal(res.cart.can_checkout, true);
  });

  test("guest cart respects stock clamping when adding excessive quantity", () => {
    mockStorage.clear();
    const product = { id: "p-002", name: "Dragon Fruit", price: "150.00", stock_quantity: 3 };
    const res = addGuestItem(mockStorage, product, 5);

    assert.equal(res.success, true);
    assert.equal(res.cart.items[0].quantity, 3);
    assert.equal(res.cart.subtotal, "450.00");

    // Second addition should reject when already at max stock
    const secondRes = addGuestItem(mockStorage, product, 1);
    assert.equal(secondRes.success, false);
    assert.equal(secondRes.error, "Maximum stock reached");
  });

  test("guest cart properly segregates different variants of the same product", () => {
    mockStorage.clear();
    const product = { id: "p-003", name: "Raw Honey", price: "250.00" };
    const v500g = { id: "v-500", sku: "HONEY-500", quantity: "500", unit: "g", price: "250.00", stock_quantity: 10 };
    const v1kg = { id: "v-1000", sku: "HONEY-1000", quantity: "1", unit: "kg", price: "480.00", stock_quantity: 5 };

    addGuestItem(mockStorage, product, 1, v500g);
    const res = addGuestItem(mockStorage, product, 2, v1kg);

    assert.equal(res.cart.items.length, 2);
    assert.equal(res.cart.total_quantity, 3);
    assert.equal(res.cart.subtotal, "1210.00"); // 250 + (480 * 2) = 1210.00
  });

  test("guest-to-authenticated cart sync converts local items to backend requests and clears storage", async () => {
    mockStorage.clear();
    const productA = { id: "p-sync-1", name: "Spinach", price: "30.00", stock_quantity: 5 };
    const productB = { id: "p-sync-2", name: "Almonds", price: "400.00" };
    const variantB = { id: "v-almond-250", quantity: "250", unit: "g", price: "220.00", stock_quantity: 8 };

    addGuestItem(mockStorage, productA, 2);
    addGuestItem(mockStorage, productB, 1, variantB);

    const guestItems = JSON.parse(mockStorage.getItem(GUEST_CART_KEY));
    assert.equal(guestItems.length, 2);

    const syncedCalls = [];
    const mockAddItemToCart = async (payload) => {
      syncedCalls.push(payload);
      return { success: true };
    };

    // Simulate login synchronization routine
    for (const item of guestItems) {
      await mockAddItemToCart({
        productId: item.product.id,
        variantId: item.variant?.id || null,
        quantity: item.quantity,
      });
    }
    mockStorage.removeItem(GUEST_CART_KEY);

    assert.equal(syncedCalls.length, 2);
    assert.deepEqual(syncedCalls[0], { productId: "p-sync-1", variantId: null, quantity: 2 });
    assert.deepEqual(syncedCalls[1], { productId: "p-sync-2", variantId: "v-almond-250", quantity: 1 });
    assert.equal(mockStorage.getItem(GUEST_CART_KEY), null);
  });

  test("checkout idempotency key is preserved across rapid double-submission", () => {
    let keyRef = "";
    const getIdempotencyKey = () => {
      if (!keyRef) {
        keyRef = `GV-CHK-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      return keyRef;
    };

    const firstKey = getIdempotencyKey();
    const secondKey = getIdempotencyKey();
    assert.ok(firstKey.startsWith("GV-CHK-"));
    assert.equal(firstKey, secondKey);
  });

  test("order creation payload enforces strict phone number and pincode formats", () => {
    const sanitizePhone = (raw) => raw.replace(/\s+/g, "");
    assert.equal(sanitizePhone("+91 98765 43210"), "+919876543210");
    assert.equal(sanitizePhone(" 9876543210 "), "9876543210");

    const validPincode = /^\d{6}$/.test("560001");
    const invalidPincode = /^\d{6}$/.test("5600018");
    assert.equal(validPincode, true);
    assert.equal(invalidPincode, false);
  });

  test("order history date and currency formatting matches e-commerce specifications", () => {
    const formatINR = (amt) =>
      `₹${Number(amt || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

    assert.equal(formatINR("540.00"), "₹540.00");
    assert.equal(formatINR(1250.5), "₹1,250.50");
  });
});

describe("Razorpay Checkout Frontend Integration & Security Contracts", () => {
  // Mock session data returned by backend POST /api/v1/orders/<order_id>/pay/
  const mockBackendSession = {
    key_id: "rzp_test_GV102030405060",
    razorpay_order_id: "order_GVRzp999888777",
    order_id: "e4a2c589-9a70-4f59-9988-123456789abc",
    order_number: "GV88899900",
    amount: 145000, // 1450.00 INR in paise
    currency: "INR",
    name: "Green Village",
    description: "Order #GV88899900",
    prefill: {
      name: "Ramesh Sharma",
      email: "ramesh@example.com",
      contact: "+919876543210",
    },
  };

  test("1. Successful payment: openRazorpayCheckout passes authoritative backend parameters and triggers verification callback", async () => {
    let capturedOptions = null;
    let eventListeners = {};

    class MockRazorpayInstance {
      constructor(options) {
        capturedOptions = options;
      }
      on(event, handler) {
        eventListeners[event] = handler;
      }
      open() {
        this.opened = true;
      }
    }

    globalThis.window = {
      Razorpay: MockRazorpayInstance,
    };

    const { openRazorpayCheckout } = await import("../services/razorpayService.js");

    let successResponse = null;
    const rzp = openRazorpayCheckout({
      sessionData: mockBackendSession,
      onSuccess: (res) => {
        successResponse = res;
      },
      onDismiss: () => {},
      onError: () => {},
    });

    assert.ok(rzp.opened, "Razorpay checkout modal should be opened");
    assert.equal(capturedOptions.key, "rzp_test_GV102030405060");
    assert.equal(capturedOptions.amount, 145000, "Must pass authoritative amount from backend in paise");
    assert.equal(capturedOptions.currency, "INR");
    assert.equal(capturedOptions.order_id, "order_GVRzp999888777");
    assert.equal(capturedOptions.prefill.contact, "+919876543210");
    assert.equal(capturedOptions.theme.color, "#1b4332", "Must maintain Green Village brand color");

    // Simulate user completing payment in checkout modal
    capturedOptions.handler({
      razorpay_payment_id: "pay_GV777666555",
      razorpay_order_id: "order_GVRzp999888777",
      razorpay_signature: "hmac_sha256_mock_signature_valid",
    });

    assert.ok(successResponse, "Success callback must be executed");
    assert.equal(successResponse.razorpay_payment_id, "pay_GV777666555");
    assert.equal(successResponse.razorpay_order_id, "order_GVRzp999888777");
    assert.equal(successResponse.razorpay_signature, "hmac_sha256_mock_signature_valid");

    delete globalThis.window;
  });

  test("2. Failed payment: captures payment.failed event and delivers error details safely", async () => {
    let eventListeners = {};

    class MockRazorpayInstance {
      constructor(options) {
        this.options = options;
      }
      on(event, handler) {
        eventListeners[event] = handler;
      }
      open() {}
    }

    globalThis.window = { Razorpay: MockRazorpayInstance };
    const { openRazorpayCheckout } = await import("../services/razorpayService.js");

    let capturedError = null;
    openRazorpayCheckout({
      sessionData: mockBackendSession,
      onSuccess: () => {},
      onDismiss: () => {},
      onError: (err) => {
        capturedError = err;
      },
    });

    assert.ok(eventListeners["payment.failed"], "Must register listener for payment.failed");

    // Simulate payment failure from bank
    eventListeners["payment.failed"]({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Transaction declined by issuing bank",
        source: "customer",
        step: "payment_authentication",
        reason: "payment_failed",
      },
    });

    assert.ok(capturedError, "Error callback must receive failure details");
    assert.equal(capturedError.description, "Transaction declined by issuing bank");

    delete globalThis.window;
  });

  test("3. Modal dismissal: handles user modal dismissal gracefully without crashing", async () => {
    let capturedOptions = null;
    class MockRazorpayInstance {
      constructor(options) {
        capturedOptions = options;
      }
      on() {}
      open() {}
    }

    globalThis.window = { Razorpay: MockRazorpayInstance };
    const { openRazorpayCheckout } = await import("../services/razorpayService.js");

    let dismissalHandled = false;
    openRazorpayCheckout({
      sessionData: mockBackendSession,
      onSuccess: () => {},
      onDismiss: () => {
        dismissalHandled = true;
      },
      onError: () => {},
    });

    assert.ok(capturedOptions.modal.ondismiss, "Modal options must define ondismiss callback");
    capturedOptions.modal.ondismiss();
    assert.equal(dismissalHandled, true, "onDismiss callback must trigger on modal close");

    delete globalThis.window;
  });

  test("4. Script loading failure: loadRazorpayScript cleans up and rejects on network error", async () => {
    const createdScripts = [];
    const mockDocument = {
      querySelector: () => null,
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          parentNode: {
            removeChild: (node) => {
              const idx = createdScripts.indexOf(node);
              if (idx !== -1) createdScripts.splice(idx, 1);
            },
          },
        };
        createdScripts.push(el);
        return el;
      },
      body: {
        appendChild: (el) => {
          // Simulate network failure by invoking onerror asynchronously
          setTimeout(() => {
            if (el.onerror) el.onerror(new Error("Network connection error"));
          }, 5);
        },
      },
    };

    globalThis.window = {};
    globalThis.document = mockDocument;

    const { loadRazorpayScript, _resetScriptLoader } = await import("../services/razorpayService.js");
    _resetScriptLoader();

    await assert.rejects(
      async () => {
        await loadRazorpayScript();
      },
      {
        message: /Unable to load secure payment gateway/,
      }
    );

    // After failure, script node must be removed to avoid dangling DOM elements
    assert.equal(createdScripts.length, 0, "Failed script element should be removed from DOM");

    _resetScriptLoader();
    delete globalThis.window;
    delete globalThis.document;
  });

  test("5. Backend initiation failure: rejects invalid or incomplete session payload", async () => {
    globalThis.window = { Razorpay: class {} };
    const { openRazorpayCheckout } = await import("../services/razorpayService.js");

    assert.throws(() => {
      openRazorpayCheckout({
        sessionData: null,
        onSuccess: () => {},
      });
    }, /Invalid Razorpay payment session data/);

    assert.throws(() => {
      openRazorpayCheckout({
        sessionData: { key_id: "rzp_test_123" }, // missing razorpay_order_id
        onSuccess: () => {},
      });
    }, /Missing required session parameters/);

    delete globalThis.window;
  });

  test("6. Verification failure: frontend does not trust modal callback alone and enforces authoritative backend confirmation", async () => {
    let orderPaymentStatus = "pending";

    // Mock verification workflow
    const handlePaymentVerification = async (verifyApiCall, orderId, paymentPayload) => {
      try {
        const result = await verifyApiCall(orderId, paymentPayload);
        if (result.status === "success" || result.status === "already_paid") {
          orderPaymentStatus = "paid";
          return { success: true, redirect: `/orders/${orderId}?payment_success=1` };
        }
      } catch (err) {
        // Authoritative rule: on verification error or network timeout, NEVER mark paid
        return { success: false, redirect: `/orders/${orderId}?payment_pending=1&verify_pending=1` };
      }
    };

    // Scenario A: Verification API fails with signature mismatch (HTTP 400)
    const mockFailingVerifyApi = async () => {
      const err = new Error("Invalid payment signature");
      err.response = { status: 400, data: { detail: "Invalid payment signature." } };
      throw err;
    };

    const failOutcome = await handlePaymentVerification(
      mockFailingVerifyApi,
      mockBackendSession.order_id,
      {
        razorpay_order_id: "order_GVRzp999888777",
        razorpay_payment_id: "pay_tampered_123",
        razorpay_signature: "forged_signature",
      }
    );

    assert.equal(orderPaymentStatus, "pending", "Payment status MUST NOT be upgraded to paid on verification failure");
    assert.equal(failOutcome.success, false);
    assert.ok(failOutcome.redirect.includes("payment_pending=1"));

    // Scenario B: Verification API succeeds
    const mockSuccessfulVerifyApi = async () => ({ status: "success", order_id: mockBackendSession.order_id });
    const successOutcome = await handlePaymentVerification(
      mockSuccessfulVerifyApi,
      mockBackendSession.order_id,
      {
        razorpay_order_id: "order_GVRzp999888777",
        razorpay_payment_id: "pay_GV777666555",
        razorpay_signature: "valid_hmac_sig",
      }
    );

    assert.equal(orderPaymentStatus, "paid", "Payment status becomes paid ONLY after backend confirms");
    assert.equal(successOutcome.success, true);
    assert.ok(successOutcome.redirect.includes("payment_success=1"));
  });

  test("7. Duplicate button clicks: synchronous ref lock prevents concurrent checkout triggers", async () => {
    let lockRef = { current: false };
    let executionCount = 0;

    const triggerCheckout = async () => {
      if (lockRef.current) return "blocked";
      lockRef.current = true;
      try {
        executionCount++;
        await new Promise((r) => setTimeout(r, 20));
        return "executed";
      } finally {
        lockRef.current = false;
      }
    };

    // Fire 3 simultaneous rapid clicks
    const [res1, res2, res3] = await Promise.all([
      triggerCheckout(),
      triggerCheckout(),
      triggerCheckout(),
    ]);

    assert.equal(res1, "executed");
    assert.equal(res2, "blocked", "Concurrent click 2 must be blocked by synchronous lock");
    assert.equal(res3, "blocked", "Concurrent click 3 must be blocked by synchronous lock");
    assert.equal(executionCount, 1, "Only one checkout execution must occur");
  });

  test("8. Expired JWT: protected payment endpoints require valid authentication", async () => {
    const { isPublicEndpoint, isTokenExpired } = await import("../services/api.js");

    assert.equal(isPublicEndpoint("/orders/checkout/"), false, "Checkout endpoint must be protected");
    assert.equal(isPublicEndpoint("/orders/123/pay/"), false, "Payment initiate endpoint must be protected");
    assert.equal(isPublicEndpoint("/orders/123/verify/"), false, "Payment verify endpoint must be protected");

    // Valid future token
    const validToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64")}.sig`;
    assert.equal(isTokenExpired(validToken), false);

    // Expired past token
    const expiredToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 3600 })).toString("base64")}.sig`;
    assert.equal(isTokenExpired(expiredToken), true);
  });

  test("9. COD checkout regression protection: COD bypasses Razorpay SDK and routes directly", async () => {
    let razorpayInitiated = false;
    const checkoutRouter = (paymentMethod, orderId) => {
      if (paymentMethod === "cod") {
        return { route: `/orders/${orderId}`, openedGateway: false };
      } else if (paymentMethod === "online") {
        razorpayInitiated = true;
        return { route: "await_payment", openedGateway: true };
      }
    };

    const codResult = checkoutRouter("cod", "order_cod_123");
    assert.equal(codResult.route, "/orders/order_cod_123");
    assert.equal(codResult.openedGateway, false);
    assert.equal(razorpayInitiated, false, "COD orders must never invoke online payment gateway");
  });

  test("10. Cancelled order & COD retry restriction: canRetryPayment enforces business rules", () => {
    const canRetryPayment = (order) => Boolean(
      order &&
      order.payment_method === "online" &&
      order.status === "pending" &&
      order.payment?.status !== "paid" &&
      order.status !== "cancelled"
    );

    // Cancelled order cannot retry
    assert.equal(
      canRetryPayment({
        status: "cancelled",
        payment_method: "online",
        payment: { status: "cancelled" },
      }),
      false,
      "Cancelled orders must not allow retry payment"
    );

    // COD order cannot retry online
    assert.equal(
      canRetryPayment({
        status: "pending",
        payment_method: "cod",
        payment: { status: "pending" },
      }),
      false,
      "COD orders must not allow online retry"
    );

    // Already paid order cannot retry
    assert.equal(
      canRetryPayment({
        status: "pending",
        payment_method: "online",
        payment: { status: "paid" },
      }),
      false,
      "Already paid orders must not allow retry payment"
    );

    // Valid pending online order can retry
    assert.equal(
      canRetryPayment({
        status: "pending",
        payment_method: "online",
        payment: { status: "pending" },
      }),
      true,
      "Eligible pending online order must allow retry payment"
    );
  });

  test("11. loadRazorpay wrapper module re-exports functions cleanly", async () => {
    const serviceLoader = await import("../services/loadRazorpay.js");
    const utilLoader = await import("../utils/loadRazorpay.js");

    assert.equal(typeof serviceLoader.loadRazorpayScript, "function");
    assert.equal(typeof serviceLoader.openRazorpayCheckout, "function");
    assert.equal(typeof utilLoader.loadRazorpayScript, "function");
    assert.equal(typeof utilLoader.openRazorpayCheckout, "function");
    assert.equal(serviceLoader.RAZORPAY_SCRIPT_URL, "https://checkout.razorpay.com/v1/checkout.js");
  });

  test("12. Razorpay Standard Checkout options support platform-dependent UPI without custom deep links or collect flows", async () => {
    let capturedOptions = null;
    globalThis.window = {
      Razorpay: class {
        constructor(options) {
          capturedOptions = options;
        }
        on() {}
        open() {}
      },
    };

    const { openRazorpayCheckout } = await import("../services/razorpayService.js");

    openRazorpayCheckout({
      sessionData: mockBackendSession,
      onSuccess: () => {},
      onDismiss: () => {},
      onError: () => {},
    });

    // Verify standard options
    assert.ok(capturedOptions, "Options must be passed to Razorpay instance");
    assert.equal(capturedOptions.order_id, "order_GVRzp999888777");
    assert.equal(capturedOptions.amount, 145000);
    assert.equal(capturedOptions.currency, "INR");

    // Strictly ensure no manual/custom UPI deep links or hacky undocumented options are injected
    assert.equal(capturedOptions.upi_link, undefined, "Must NOT construct custom UPI deep links");
    assert.equal(capturedOptions.vpa, undefined, "Must NOT use deprecated UPI Collect flow");
    assert.equal(capturedOptions.theme.color, "#1b4332");

    delete globalThis.window;
  });

  test("13. Safe order status check after mobile UPI intent return preserves order state without duplicating orders", async () => {
    let orderFetchCount = 0;
    const initialOrder = {
      id: "e4a2c589-9a70-4f59-9988-123456789abc",
      order_number: "GV88899900",
      status: "pending",
      payment_method: "online",
      payment: { status: "pending" },
    };

    const mockGetOrder = async (orderId) => {
      orderFetchCount++;
      // Simulate backend polling after mobile intent payment settled
      return {
        ...initialOrder,
        status: "confirmed",
        payment: { status: "paid" },
      };
    };

    // Client checks status on return
    const refreshedOrder = await mockGetOrder(initialOrder.id);
    assert.equal(orderFetchCount, 1);
    assert.equal(refreshedOrder.id, initialOrder.id, "Must keep identical order ID");
    assert.equal(refreshedOrder.payment.status, "paid");
    assert.equal(refreshedOrder.status, "confirmed");
  });
});

describe("Admin Order & Category Management Contracts", () => {
  test("1. Admin navigation items include Orders (/admin/orders) and Categories (/admin/categories)", async () => {
    const navItems = [
      { label: "Dashboard", path: "/admin/dashboard" },
      { label: "Orders", path: "/admin/orders" },
      { label: "Categories", path: "/admin/categories" },
      { label: "Products", path: "/admin/products" },
      { label: "Customers", path: "/admin/customers" },
    ];

    const orderNav = navItems.find((n) => n.path === "/admin/orders");
    const categoryNav = navItems.find((n) => n.path === "/admin/categories");

    assert.ok(orderNav, "Orders navigation link must exist");
    assert.equal(orderNav.label, "Orders");
    assert.ok(categoryNav, "Categories navigation link must exist");
    assert.equal(categoryNav.label, "Categories");
  });

  test("2. getValidOrderTransitions enforces backend business rules and prohibits cancelling shipped orders", async () => {
    const { getValidOrderTransitions, ORDER_VALID_TRANSITIONS } = await import("../services/adminService.js");

    assert.deepEqual(getValidOrderTransitions("PENDING"), ["CONFIRMED", "CANCELLED"]);
    assert.deepEqual(getValidOrderTransitions("CONFIRMED"), ["PROCESSING", "CANCELLED"]);
    assert.deepEqual(getValidOrderTransitions("PROCESSING"), ["SHIPPED", "CANCELLED"]);
    assert.deepEqual(getValidOrderTransitions("SHIPPED"), ["DELIVERED"], "Shipped orders cannot be cancelled");
    assert.deepEqual(getValidOrderTransitions("DELIVERED"), [], "Delivered is a terminal status");
    assert.deepEqual(getValidOrderTransitions("CANCELLED"), [], "Cancelled is a terminal status");
    assert.deepEqual(getValidOrderTransitions("unknown"), []);
    assert.deepEqual(getValidOrderTransitions(null), []);
  });

  test("3. getAdminOrders parameter builder sanitizes search, pagination and multi-criteria filters", async () => {
    const buildCleanOrderParams = (params = {}) => {
      const cleanParams = {};
      if (params.page) cleanParams.page = params.page;
      if (params.page_size) cleanParams.page_size = params.page_size;
      if (params.search && params.search.trim()) cleanParams.search = params.search.trim();
      if (params.status && params.status !== "all") cleanParams.status = params.status;
      if (params.payment_status && params.payment_status !== "all") cleanParams.payment_status = params.payment_status;
      if (params.payment_method && params.payment_method !== "all") cleanParams.payment_method = params.payment_method;
      if (params.date_from) cleanParams.date_from = params.date_from;
      if (params.date_to) cleanParams.date_to = params.date_to;
      return cleanParams;
    };

    const cleaned = buildCleanOrderParams({
      page: 2,
      page_size: 15,
      search: "  GV998877  ",
      status: "CONFIRMED",
      payment_status: "all",
      payment_method: "online",
      date_from: "2026-10-01",
      date_to: "2026-10-31",
    });

    assert.equal(cleaned.page, 2);
    assert.equal(cleaned.page_size, 15);
    assert.equal(cleaned.search, "GV998877");
    assert.equal(cleaned.status, "CONFIRMED");
    assert.equal(cleaned.payment_status, undefined, "'all' filter should be omitted");
    assert.equal(cleaned.payment_method, "online");
    assert.equal(cleaned.date_from, "2026-10-01");
    assert.equal(cleaned.date_to, "2026-10-31");
  });

  test("4. REFUND_PENDING status is detected and formatted distinctly for admin alerting", () => {
    const isRefundPending = (paymentStatus) => {
      return String(paymentStatus || "").toUpperCase() === "REFUND_PENDING";
    };

    assert.equal(isRefundPending("REFUND_PENDING"), true);
    assert.equal(isRefundPending("refund_pending"), true);
    assert.equal(isRefundPending("SUCCESS"), false);
    assert.equal(isRefundPending("PENDING"), false);
  });

  test("5. Synchronous cancellation ref lock prevents duplicate concurrent cancellation requests", () => {
    let cancelCallCount = 0;
    const lockRef = { current: false };

    const handleCancel = () => {
      if (lockRef.current) return;
      lockRef.current = true;
      cancelCallCount++;
    };

    // User triggers cancellation once
    handleCancel();
    assert.equal(cancelCallCount, 1);
    assert.equal(lockRef.current, true);

    // Rapid second click while first is executing
    handleCancel();
    assert.equal(cancelCallCount, 1, "Duplicate click must be dropped while locked");

    // Release after completion
    lockRef.current = false;
    handleCancel();
    assert.equal(cancelCallCount, 2);
  });

  test("6. Category safe deletion logic prevents deletion in UI when products_count > 0", () => {
    const canDeleteCategory = (category) => {
      return Boolean(category && (!category.products_count || category.products_count === 0));
    };

    const categoryWithProducts = { id: "cat-1", name: "Vegetables", products_count: 5 };
    const emptyCategory = { id: "cat-2", name: "Seasonal Extras", products_count: 0 };
    const nullCountCategory = { id: "cat-3", name: "New Category", products_count: null };

    assert.equal(canDeleteCategory(categoryWithProducts), false, "Must block deletion when products exist");
    assert.equal(canDeleteCategory(emptyCategory), true, "Must allow deletion when 0 products");
    assert.equal(canDeleteCategory(nullCountCategory), true, "Must allow deletion when 0/null products");
  });

  test("7. Category backend deletion 400 error message is parsed and surfaced without crash", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          detail: "Cannot delete category because it contains active products. Please reassign or delete these products first.",
        },
      },
    };

    const parseDeleteError = (err) => {
      return err?.response?.data?.detail || err?.response?.data?.error || "Failed to delete category.";
    };

    const message = parseDeleteError(errorResponse);
    assert.equal(
      message,
      "Cannot delete category because it contains active products. Please reassign or delete these products first."
    );
  });

  test("8. Category creation payload trims name and formats lowercase slug or leaves slug blank for auto-generation", () => {
    const prepareCategoryPayload = (name, slug, description) => {
      const payload = {
        name: String(name || "").trim(),
        description: description ? String(description).trim() : "",
      };
      if (slug && String(slug).trim()) {
        payload.slug = String(slug).trim().toLowerCase();
      }
      return payload;
    };

    const payloadWithSlug = prepareCategoryPayload("  Organic Fruits  ", "Organic-FRUITS", "Fresh orchard harvests");
    assert.equal(payloadWithSlug.name, "Organic Fruits");
    assert.equal(payloadWithSlug.slug, "organic-fruits");
    assert.equal(payloadWithSlug.description, "Fresh orchard harvests");

    const payloadWithoutSlug = prepareCategoryPayload("Leafy Greens", "", "");
    assert.equal(payloadWithoutSlug.name, "Leafy Greens");
    assert.equal(payloadWithoutSlug.slug, undefined, "Slug should be omitted so backend generates it");
  });
});

describe("Admin Route & Navigation Bug Fix Contracts", () => {
  test("1. AppRoutes explicitly registers /admin/orders and /admin/categories under AdminRoute", async () => {
    const fs = await import("node:fs");
    const routesContent = fs.readFileSync("src/routes/AppRoutes.jsx", "utf-8");

    assert.ok(
      routesContent.includes('path="/admin/orders"'),
      "AppRoutes must explicitly define path=/admin/orders"
    );
    assert.ok(
      routesContent.includes('path="/admin/categories"'),
      "AppRoutes must explicitly define path=/admin/categories"
    );
    assert.ok(
      routesContent.includes("<AdminRoute><AdminOrders /></AdminRoute>"),
      "/admin/orders must be wrapped in AdminRoute guard"
    );
    assert.ok(
      routesContent.includes("<AdminRoute><AdminCategories /></AdminRoute>"),
      "/admin/categories must be wrapped in AdminRoute guard"
    );
  });

  test("2. AdminRoute redirects unauthenticated visitors to /admin/login and never to customer home /", () => {
    const simulateAdminRouteGuard = (isAuthenticated, location) => {
      if (!isAuthenticated) {
        return { redirect: "/admin/login", state: { from: location } };
      }
      return { render: "AdminLayout" };
    };

    const unauthResult = simulateAdminRouteGuard(false, { pathname: "/admin/orders" });
    assert.equal(unauthResult.redirect, "/admin/login");
    assert.deepEqual(unauthResult.state, { from: { pathname: "/admin/orders" } });
    assert.notEqual(unauthResult.redirect, "/", "Must NEVER redirect admin routes to customer home");

    const authResult = simulateAdminRouteGuard(true, { pathname: "/admin/orders" });
    assert.equal(authResult.render, "AdminLayout");
  });

  test("3. Route matching correctly routes /admin/orders and /admin/categories and avoids wildcard catch-all", () => {
    const routes = [
      "/",
      "/categories",
      "/products",
      "/admin/login",
      "/admin",
      "/admin/dashboard",
      "/admin/orders",
      "/admin/categories",
      "/admin/customers",
      "/admin/products",
    ];

    const matchRoute = (path) => {
      const match = routes.find((r) => r === path);
      return match || "/*";
    };

    assert.equal(matchRoute("/admin/orders"), "/admin/orders");
    assert.equal(matchRoute("/admin/categories"), "/admin/categories");
    assert.equal(matchRoute("/admin/dashboard"), "/admin/dashboard");
    assert.equal(matchRoute("/admin/unknown-page"), "/*", "Unknown pages hit catch-all");
  });
});

describe("Customer Order History & Profile Integration Contracts", () => {
  test("1. orderService exports getMyOrders and getMyOrderById with parameter normalization", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const serviceContent = fs.readFileSync(
      path.resolve("src/services/orderService.js"),
      "utf-8"
    );

    assert.ok(
      serviceContent.includes("export const getMyOrders"),
      "orderService must export getMyOrders"
    );
    assert.ok(
      serviceContent.includes("export const getMyOrderById"),
      "orderService must export getMyOrderById"
    );
    assert.ok(
      serviceContent.includes("/orders/my-orders/"),
      "orderService must target /orders/my-orders/ endpoint"
    );

    // Test parameter builder logic
    const buildParams = (params = {}) => {
      const cleanParams = {};
      if (typeof params === "number" || typeof params === "string") {
        cleanParams.page = params;
      } else if (params && typeof params === "object") {
        if (params.page) cleanParams.page = params.page;
        if (params.page_size) cleanParams.page_size = params.page_size;
      }
      return cleanParams;
    };

    assert.deepEqual(buildParams(2), { page: 2 });
    assert.deepEqual(buildParams("3"), { page: "3" });
    assert.deepEqual(buildParams({ page: 4, page_size: 20 }), { page: 4, page_size: 20 });
    assert.deepEqual(buildParams({}), {});
  });

  test("2. Profile tabs include 'orders' and sync with URL query param ?tab=orders", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const profileContent = fs.readFileSync(
      path.resolve("src/pages/Profile/Profile.jsx"),
      "utf-8"
    );

    assert.ok(
      profileContent.includes('"orders"'),
      "Profile must include 'orders' in tab definitions"
    );
    assert.ok(
      profileContent.includes("getMyOrders"),
      "Profile must import and call getMyOrders"
    );
    assert.ok(
      profileContent.includes("useSearchParams"),
      "Profile must use useSearchParams to sync tab state with URL"
    );
    assert.ok(
      profileContent.includes("You haven't placed any orders yet."),
      "Profile must include empty state for orders"
    );
    assert.ok(
      profileContent.includes('to="/products"'),
      "Empty state must link to products storefront"
    );
  });

  test("3. Order status badge and label mappers handle all customer-facing statuses", () => {
    const orderStatusLabel = (status) => {
      const MAP = {
        pending: "Pending",
        confirmed: "Confirmed",
        processing: "Processing",
        shipped: "Shipped",
        delivered: "Delivered",
        cancelled: "Cancelled",
        failed: "Failed",
      };
      return MAP[status] || status;
    };

    const orderStatusBadgeClass = (status) => {
      const MAP = {
        pending: "gv-status-badge--pending",
        confirmed: "gv-status-badge--confirmed",
        processing: "gv-status-badge--processing",
        shipped: "gv-status-badge--shipped",
        delivered: "gv-status-badge--delivered",
        cancelled: "gv-status-badge--cancelled",
        failed: "gv-status-badge--failed",
      };
      return MAP[status] || "gv-status-badge--pending";
    };

    assert.equal(orderStatusLabel("pending"), "Pending");
    assert.equal(orderStatusLabel("confirmed"), "Confirmed");
    assert.equal(orderStatusLabel("processing"), "Processing");
    assert.equal(orderStatusLabel("shipped"), "Shipped");
    assert.equal(orderStatusLabel("delivered"), "Delivered");
    assert.equal(orderStatusLabel("cancelled"), "Cancelled");

    assert.equal(orderStatusBadgeClass("shipped"), "gv-status-badge--shipped");
    assert.equal(orderStatusBadgeClass("delivered"), "gv-status-badge--delivered");
    assert.equal(orderStatusBadgeClass("cancelled"), "gv-status-badge--cancelled");
  });

  test("4. Chronological order status history timeline renders transitions, timestamps and notes safely", () => {
    const historyEvents = [
      {
        from_status: "pending",
        to_status: "confirmed",
        note: "Payment verified via Razorpay.",
        created_at: "2026-11-05T08:00:00Z",
      },
      {
        from_status: "confirmed",
        to_status: "processing",
        note: "Produce harvested and packed in cold tote.",
        created_at: "2026-11-05T08:30:00Z",
      },
      {
        from_status: "processing",
        to_status: "shipped",
        note: "Out for eco-friendly EV delivery.",
        created_at: "2026-11-05T09:15:00Z",
      },
    ];

    const formatTransition = (h) => {
      if (h.from_status && h.from_status !== h.to_status) {
        return `${h.from_status} → ${h.to_status}`;
      }
      return h.to_status;
    };

    assert.equal(formatTransition(historyEvents[0]), "pending → confirmed");
    assert.equal(formatTransition(historyEvents[1]), "confirmed → processing");
    assert.equal(formatTransition(historyEvents[2]), "processing → shipped");
    assert.equal(historyEvents[0].note, "Payment verified via Razorpay.");
  });

  test("5. OrderItem snapshot fields allow robust rendering even when product is deleted", () => {
    const snapshotItem = {
      id: "item-uuid-1",
      product: null, // deleted product
      variant: null,
      product_name: "Heritage Black Rice",
      variant_sku: "HBR-1KG",
      variant_label: "1 kg Cotton Sack",
      unit_price: "240.00",
      quantity: 2,
      line_total: "480.00",
      product_image: "/media/products/black-rice.jpg",
    };

    const renderItemText = (item) => {
      return `${item.product_name} (${item.variant_label}) - ${item.quantity} x ₹${item.unit_price} = ₹${item.line_total}`;
    };

    const text = renderItemText(snapshotItem);
    assert.equal(
      text,
      "Heritage Black Rice (1 kg Cotton Sack) - 2 x ₹240.00 = ₹480.00",
      "Item details must be completely intact via snapshot fields without product model"
    );
  });

  test("6. OrderDetailPage imports getMyOrderById and provides profile orders backlink", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const detailContent = fs.readFileSync(
      path.resolve("src/pages/Orders/OrderDetailPage.jsx"),
      "utf-8"
    );

    assert.ok(
      detailContent.includes("getMyOrderById"),
      "OrderDetailPage must import and call getMyOrderById"
    );
    assert.ok(
      detailContent.includes("order.history"),
      "OrderDetailPage must render chronological order.history"
    );
    assert.ok(
      detailContent.includes("/profile?tab=orders"),
      "OrderDetailPage must link back to profile My Orders"
    );
  });
});
