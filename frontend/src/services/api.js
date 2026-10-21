import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || "http://localhost:8000/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
});

// Public endpoints that should not receive an Authorization header
const PUBLIC_ENDPOINTS = [
  "/account/register/",
  "/account/login/",
  "/account/google/",
  "/account/google-login/",
  "/account/verify-otp/",
  "/account/otp_veryfication/",
  "/account/forgot-password/",
  "/account/forget-password/",
  "/account/reset-password/",
  "/account/resend-otp/",
  "/account/logout/",
  "/admin-auth/login/",
  "/admin-auth/refresh/",
];

/**
 * Check if the given URL is a public storefront browsing endpoint
 * @param {string} url
 * @returns {boolean}
 */
export const isStorefrontEndpoint = (url) => {
  if (!url) return false;
  const cleanUrl = url.split("?")[0].split("#")[0];
  return (
    cleanUrl.startsWith("/product/") ||
    cleanUrl.includes("/product/") ||
    cleanUrl.startsWith("/categories/") ||
    cleanUrl.includes("/categories/")
  );
};

/**
 * Check if the given URL is a public endpoint
 * @param {string} url
 * @returns {boolean}
 */
export const isPublicEndpoint = (url) => {
  if (!url) return false;
  const cleanUrl = url.split("?")[0].split("#")[0];

  return PUBLIC_ENDPOINTS.some((endpoint) => {
    const trimmed = endpoint.replace(/\/$/, "");
    return (
      cleanUrl.endsWith(endpoint) ||
      cleanUrl.endsWith(trimmed) ||
      cleanUrl.includes(endpoint) ||
      cleanUrl.includes(trimmed + "/")
    );
  });
};

/**
 * Retrieve the active access token from persistent storage
 * @returns {string|null}
 */
export const getStoredAccessToken = () => {
  try {
    const token = localStorage.getItem("access_token");
    if (!token || token === "undefined" || token === "null") return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * Retrieve the active admin access token from persistent storage
 * @returns {string|null}
 */
export const getStoredAdminToken = () => {
  try {
    const token = localStorage.getItem("admin_token");
    if (!token || token === "undefined" || token === "null") return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * Retrieve the active refresh token from persistent storage
 * @returns {string|null}
 */
export const getStoredRefreshToken = () => {
  try {
    const token = localStorage.getItem("refresh_token");
    if (!token || token === "undefined" || token === "null") return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * Retrieve active admin refresh token
 * @returns {string|null}
 */
export const getStoredAdminRefreshToken = () => {
  try {
    const token = localStorage.getItem("admin_refresh");
    if (!token || token === "undefined" || token === "null") return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * Clear stored admin authentication
 */
export const clearStoredAdminAuth = () => {
  try {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_refresh");
    localStorage.removeItem("admin_user");
  } catch {
    // Ignore
  }
};

/**
 * Clear all authentication tokens and session data from storage
 */
export const clearStoredAuth = () => {
  try {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
  } catch {
    // Ignore storage clearing exceptions
  }
};

/**
 * Safely parse a JWT payload and check if it is expired.
 * @param {string|null} token
 * @returns {boolean} true if token is missing or expired, false if valid
 */
export const isTokenExpired = (token) => {
  if (!token || typeof token !== "string") return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const decoded = JSON.parse(jsonPayload);
    if (!decoded.exp) return false;
    // Buffer by 5 seconds to prevent race conditions at expiry boundary
    return decoded.exp * 1000 <= Date.now() + 5000;
  } catch {
    return true;
  }
};

// Attach JWT access token to outgoing requests for protected endpoints only
api.interceptors.request.use(
  (config) => {
    const method = (config.method || "get").toLowerCase();
    const isAdminEndpoint =
      config.url &&
      (config.url.includes("/admin-auth/") || config.url.includes("/admin/"));
    const isMutatingProduct =
      config.url &&
      isStorefrontEndpoint(config.url) &&
      ["post", "put", "patch", "delete"].includes(method);

    const hasAdminHeader = Boolean(
      config.headers &&
      (config.headers["X-Admin-panel"] ||
        config.headers["x-admin-panel"] ||
        (typeof config.headers.get === "function" && (config.headers.get("X-Admin-panel") || config.headers.get("x-admin-panel"))))
    );

    const useAdminScope = isAdminEndpoint || isMutatingProduct || hasAdminHeader;
    const skipAuth = Boolean(config._skipAuth || config._storefrontFallbackTried);
    const isStorefront = config.url && isStorefrontEndpoint(config.url);

    if (useAdminScope) {
      if (config.headers && typeof config.headers.set === "function") {
        config.headers.set("X-Admin-panel", "1");
      } else {
        config.headers = config.headers || {};
        config.headers["X-Admin-panel"] = "1";
      }
    }

    if (!skipAuth && !isPublicEndpoint(config.url)) {
      const adminToken = getStoredAdminToken();
      const patronToken = getStoredAccessToken();
      const token = useAdminScope && adminToken ? adminToken : (patronToken || adminToken);

      // For public storefront browsing (GET), omit expired or invalid tokens
      // so visitors and customers can always load products without encountering a 401
      const isSafeStorefront = isStorefront && method === "get" && !useAdminScope;
      const shouldAttach = token && (!isSafeStorefront || !isTokenExpired(token));

      if (shouldAttach) {
        if (config.headers && typeof config.headers.set === "function") {
          config.headers.set("Authorization", `Bearer ${token}`);
        } else {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
        }
      } else {
        if (config.headers) {
          if (typeof config.headers.delete === "function") {
            config.headers.delete("Authorization");
            config.headers.delete("authorization");
          }
          delete config.headers.Authorization;
          delete config.headers.authorization;
        }
      }
    } else {
      // Ensure no Authorization header is attached to public requests or fallback retries
      if (config.headers) {
        if (typeof config.headers.delete === "function") {
          config.headers.delete("Authorization");
          config.headers.delete("authorization");
        }
        delete config.headers.Authorization;
        delete config.headers.authorization;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token expiration and automatic refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Reject immediately if not an HTTP 401 Unauthorized
    if (!error.response || error.response.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    const isStorefront = isStorefrontEndpoint(originalRequest.url);
    const isPublic = isPublicEndpoint(originalRequest.url);
    const method = (originalRequest.method || "get").toLowerCase();

    // If it was an intentionally public endpoint (e.g. login/register), don't attempt refresh or redirect
    if (isPublic) {
      return Promise.reject(error);
    }

    // For public storefront GET browsing requests:
    // If the request had an invalid or expired token, gracefully retry without the Authorization header
    // so the visitor/customer can always view products.
    if (isStorefront && method === "get" && !originalRequest._storefrontFallbackTried) {
      originalRequest._storefrontFallbackTried = true;
      originalRequest._skipAuth = true;
      if (originalRequest.headers) {
        if (typeof originalRequest.headers.delete === "function") {
          originalRequest.headers.delete("Authorization");
          originalRequest.headers.delete("authorization");
        }
        delete originalRequest.headers.Authorization;
        delete originalRequest.headers.authorization;
      }
      return api(originalRequest);
    }

    // Prevent infinite retry loops
    if (originalRequest._retry) {
      return Promise.reject(error);
    }

    const isAdminRequest = Boolean(
      originalRequest.headers?.["X-Admin-panel"] === "1" ||
      originalRequest.headers?.["x-admin-panel"] === "1" ||
      (originalRequest.url && (originalRequest.url.includes("/admin-auth/") || originalRequest.url.includes("/admin/")))
    );

    // If an admin operation or mutating product operation failed with 401, handle admin token refresh
    if (isAdminRequest) {
      const adminRefresh = getStoredAdminRefreshToken();
      if (!adminRefresh) {
        clearStoredAdminAuth();
        if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin") && window.location.pathname !== "/admin/login") {
          window.location.href = "/admin/login";
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers && typeof originalRequest.headers.set === "function") {
              originalRequest.headers.set("Authorization", `Bearer ${token}`);
              originalRequest.headers.set("X-Admin-panel", "1");
            } else {
              originalRequest.headers = originalRequest.headers || {};
              originalRequest.headers.Authorization = `Bearer ${token}`;
              originalRequest.headers["X-Admin-panel"] = "1";
            }
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const baseURL = api.defaults.baseURL || "";
        const refreshResponse = await axios.post(
          `${baseURL}/admin-auth/refresh/`,
          { refresh: adminRefresh },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Admin-panel": "1",
            },
            withCredentials: true,
          }
        );

        const newAccessToken = refreshResponse?.data?.access;
        if (newAccessToken) {
          localStorage.setItem("admin_token", newAccessToken);
          if (refreshResponse.data?.refresh) {
            localStorage.setItem("admin_refresh", refreshResponse.data.refresh);
          }

          if (originalRequest.headers && typeof originalRequest.headers.set === "function") {
            originalRequest.headers.set("Authorization", `Bearer ${newAccessToken}`);
            originalRequest.headers.set("X-Admin-panel", "1");
          } else {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            originalRequest.headers["X-Admin-panel"] = "1";
          }

          processQueue(null, newAccessToken);
          return api(originalRequest);
        } else {
          throw new Error("No access token received from admin refresh.");
        }
      } catch (adminRefreshErr) {
        processQueue(adminRefreshErr, null);
        clearStoredAdminAuth();
        if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin") && window.location.pathname !== "/admin/login") {
          window.location.href = "/admin/login";
        }
        return Promise.reject(adminRefreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    // Customer refresh flow
    const bypassRedirect = Boolean(originalRequest._skipAuthRedirect || isStorefront);

    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      clearStoredAuth();
      if (!bypassRedirect && typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          if (originalRequest.headers && typeof originalRequest.headers.set === "function") {
            originalRequest.headers.set("Authorization", `Bearer ${token}`);
          } else {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return api(originalRequest);
        })
        .catch((err) => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const baseURL = api.defaults.baseURL || "";
      let refreshResponse;

      try {
        refreshResponse = await axios.post(
          `${baseURL}/account/token/refresh/`,
          { refresh: refreshToken },
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (firstErr) {
        if (firstErr.response && firstErr.response.status === 404) {
          refreshResponse = await axios.post(
            `${baseURL}/account/refresh/`,
            { refresh: refreshToken },
            { headers: { "Content-Type": "application/json" } }
          );
        } else {
          throw firstErr;
        }
      }

      const newAccessToken = refreshResponse?.data?.access;
      if (newAccessToken) {
        localStorage.setItem("access_token", newAccessToken);
        if (refreshResponse.data?.refresh) {
          localStorage.setItem("refresh_token", refreshResponse.data.refresh);
        }

        if (originalRequest.headers && typeof originalRequest.headers.set === "function") {
          originalRequest.headers.set("Authorization", `Bearer ${newAccessToken}`);
        } else {
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }

        processQueue(null, newAccessToken);
        return api(originalRequest);
      } else {
        throw new Error("No access token received from refresh attempt.");
      }
    } catch (refreshError) {
      processQueue(refreshError, null);
      clearStoredAuth();
      if (!bypassRedirect && typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
