import { createContext, useState, useEffect, useCallback } from "react";
import {
  registerUser,
  verifyOtp as verifyOtpApi,
  resendOtp as resendOtpApi,
  loginUser as loginUserApi,
  googleLogin as googleLoginApi,
} from "../services/authService";
import api from "../services/api";
import { parseApiError, parseLoginApiError } from "../utils/validation";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem("access_token") || null;
    } catch {
      return null;
    }
  });

  const [isInitializing, setIsInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const clearFieldError = useCallback((fieldName) => {
    setFieldErrors((prev) => {
      if (!prev[fieldName]) return prev;
      const updated = { ...prev };
      delete updated[fieldName];
      return updated;
    });
    setGeneralError("");
  }, []);

  const clearAllErrors = useCallback(() => {
    setFieldErrors({});
    setGeneralError("");
  }, []);

  // Synchronize state with storage changes (e.g. token refresh or multi-tab logout)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "access_token") {
        setToken(e.newValue);
        if (!e.newValue) {
          setUser(null);
        }
      }
      if (e.key === "user") {
        try {
          setUser(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {
          // ignore parsing error
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Initialize session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("access_token");
    if (savedToken) {
      setToken(savedToken);
      if (!user) {
        api
          .get("/account/user/")
          .then((res) => {
            if (res?.data) {
              setUser(res.data);
              localStorage.setItem("user", JSON.stringify(res.data));
            }
          })
          .catch(() => {
            // Token expired or invalid; handled by interceptor or next guard
          })
          .finally(() => {
            setIsInitializing(false);
          });
      } else {
        setIsInitializing(false);
      }
    } else {
      setIsInitializing(false);
    }
  }, []);

  const saveAuthSession = (data) => {
    const accessToken = data?.access;
    const refreshToken = data?.refresh;
    const userData = data?.user;

    if (accessToken) {
      localStorage.setItem("access_token", accessToken);
      setToken(accessToken);
    }
    if (refreshToken) {
      localStorage.setItem("refresh_token", refreshToken);
    }
    if (userData && typeof userData === "object") {
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
    } else if (userData && typeof userData === "string") {
      const fallbackUser = { full_name: userData };
      setUser(fallbackUser);
      localStorage.setItem("user", JSON.stringify(fallbackUser));
    }
  };

  const login = useCallback(async (credentials) => {
    setLoading(true);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");

    try {
      const response = await loginUserApi(credentials);
      const data = response.data;
      saveAuthSession(data);

      // Load full user details if available
      try {
        const tokenVal = data?.access;
        if (tokenVal) {
          const profileRes = await api.get("/account/user/", {
            headers: { Authorization: `Bearer ${tokenVal}` },
          });
          if (profileRes?.data) {
            setUser(profileRes.data);
            localStorage.setItem("user", JSON.stringify(profileRes.data));
            data.user = profileRes.data;
          }
        }
      } catch {
        // Fallback user if backend /account/user/ is not yet available
        if (!data.user) {
          const fallbackUser = {
            email: credentials.email,
            full_name: credentials.email.split("@")[0],
          };
          setUser(fallbackUser);
          localStorage.setItem("user", JSON.stringify(fallbackUser));
          data.user = fallbackUser;
        }
      }

      const successMsg = data?.message || "Login successful";
      setSuccessMessage(successMsg);
      return { success: true, data, response, user: data?.user };
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } =
        parseLoginApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(parsedGeneral);
      return { success: false, error: parsedGeneral, fieldErrors: parsedFields };
    } finally {
      setLoading(false);
    }
  }, []);

  const googleLogin = useCallback(async (credential) => {
    setLoading(true);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");

    try {
      const response = await googleLoginApi(credential);
      const data = response.data;
      saveAuthSession(data);

      try {
        const tokenVal = data?.access;
        if (tokenVal) {
          const profileRes = await api.get("/account/user/", {
            headers: { Authorization: `Bearer ${tokenVal}` },
          });
          if (profileRes?.data) {
            setUser(profileRes.data);
            localStorage.setItem("user", JSON.stringify(profileRes.data));
            data.user = profileRes.data;
          }
        }
      } catch {
        // Non-blocking fallback
      }

      const successMsg = data?.message || "Google sign-in successful";
      setSuccessMessage(successMsg);
      return { success: true, data, response, user: data?.user };
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } =
        parseLoginApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(parsedGeneral || "Google sign-in failed. Please try again.");
      return {
        success: false,
        error: parsedGeneral || "Google sign-in failed.",
        fieldErrors: parsedFields,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (formData) => {
    setLoading(true);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");

    try {
      const response = await registerUser(formData);
      const data = response.data;
      const successMsg =
        data?.message || "Registration successful! Welcome to Green Village.";
      setSuccessMessage(successMsg);
      return { success: true, data, response };
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } =
        parseApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(parsedGeneral);
      return { success: false, error: parsedGeneral, fieldErrors: parsedFields };
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyOtp = useCallback(async (otpData) => {
    setLoading(true);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");

    try {
      const response = await verifyOtpApi(otpData);
      const data = response.data;
      const successMsg =
        data?.message || data?.massage || "Email verified successfully!";
      setSuccessMessage(successMsg);
      return { success: true, data, response };
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } =
        parseApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(parsedGeneral);
      return { success: false, error: parsedGeneral, fieldErrors: parsedFields };
    } finally {
      setLoading(false);
    }
  }, []);

  const resendOtp = useCallback(async (emailOrData) => {
    setLoading(true);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");

    try {
      const response = await resendOtpApi(emailOrData);
      const data = response.data;
      const successMsg =
        data?.detail ||
        data?.message ||
        "A new verification code has been sent to your email.";
      setSuccessMessage(successMsg);
      return { success: true, data, response };
    } catch (error) {
      const { fieldErrors: parsedFields, generalError: parsedGeneral } =
        parseApiError(error);
      setFieldErrors(parsedFields);
      setGeneralError(parsedGeneral || parsedFields.email || "Failed to resend verification code.");
      return {
        success: false,
        error: parsedGeneral || parsedFields.email,
        fieldErrors: parsedFields,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUser = useCallback((updatedUserData) => {
    if (!updatedUserData) return;
    setUser((prev) => {
      const merged = { ...(prev || {}), ...updatedUserData };
      try {
        localStorage.setItem("user", JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }
      return merged;
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    setUser(null);
    setToken(null);
    setFieldErrors({});
    setGeneralError("");
    setSuccessMessage("");
  }, []);

  const value = {
    user,
    token,
    accessToken: token,
    isAuthenticated: Boolean(token || localStorage.getItem("access_token")),
    isInitializing,
    role: user?.role || "Customer",
    loading,
    fieldErrors,
    setFieldErrors,
    generalError,
    setGeneralError,
    successMessage,
    setSuccessMessage,
    clearFieldError,
    clearAllErrors,
    login,
    googleLogin,
    register,
    verifyOtp,
    resendOtp,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
