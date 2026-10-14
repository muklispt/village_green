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
];

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
    return token ? token.trim() : null;
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
    return token ? token.trim() : null;
  } catch {
    return null;
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

// Attach JWT access token to outgoing requests for protected endpoints only
api.interceptors.request.use(
  (config) => {
    if (!isPublicEndpoint(config.url)) {
      const token = getStoredAccessToken();
      if (token) {
        if (config.headers && typeof config.headers.set === "function") {
          config.headers.set("Authorization", `Bearer ${token}`);
        } else {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } else {
      // Ensure no Authorization header is attached to public requests
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

    // Reject immediately if error is not 401, or if request was to a public endpoint
    if (
      !error.response ||
      error.response.status !== 401 ||
      !originalRequest ||
      isPublicEndpoint(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    // Prevent infinite retry loops
    if (originalRequest._retry) {
      return Promise.reject(error);
    }

    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      clearStoredAuth();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
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
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
