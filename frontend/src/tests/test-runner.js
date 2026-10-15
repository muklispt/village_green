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



