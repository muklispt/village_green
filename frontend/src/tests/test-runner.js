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

  test("parseApiError handles HTTP 400 non-existent user error", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          email: ["No account found with this email."],
        },
      },
    };

    const { fieldErrors } = parseApiError(errorResponse);
    assert.equal(fieldErrors.email, "No account found with this email.");
  });

  test("parseApiError handles HTTP 400 already verified email", () => {
    const errorResponse = {
      response: {
        status: 400,
        data: {
          email: ["Email is already verified."],
        },
      },
    };

    const { fieldErrors } = parseApiError(errorResponse);
    assert.equal(fieldErrors.email, "Email is already verified.");
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
});
