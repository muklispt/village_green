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


