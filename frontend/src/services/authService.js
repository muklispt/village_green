import api from "./api";

/**
 * Register a new user patron account
 * @param {Object} data - { full_name, email, password, confirm_password }
 * @returns {Promise} Axios response
 */
export const registerUser = (data) => {
  return api.post("/account/register/", data);
};

/**
 * Verify OTP for user account
 * @param {Object} data - { email, otp }
 * @returns {Promise} Axios response
 */
export const verifyOtp = (data) => {
  return api.post("/account/otp_veryfication/", data);
};

export const verifyOTP = verifyOtp;

/**
 * Authenticate user credentials and obtain JWT tokens
 * @param {Object} data - { email, password }
 * @returns {Promise} Axios response
 */
export const loginUser = (data) => {
  return api.post("/account/login/", data);
};

/**
 * Send password reset link to user's registered email
 * @param {string|Object} emailOrData - email string or { email } object
 * @returns {Promise} Axios response
 */
export const forgotPassword = async (emailOrData) => {
  const email =
    typeof emailOrData === "object" && emailOrData !== null
      ? emailOrData.email
      : emailOrData;

  try {
    return await api.post("/account/forgot-password/", { email });
  } catch (err) {
    // Graceful fallback if backend route is configured as /account/forget-password/
    if (err.response && err.response.status === 404) {
      return await api.post("/account/forget-password/", { email });
    }
    throw err;
  }
};

/**
 * Reset password using uid, token, and new password
 * @param {Object} data - { uid, token, new_password, confirm_password }
 * @returns {Promise} Axios response
 */
export const resetPassword = (data) => {
  return api.post("/account/reset-password/", data);
};

/**
 * Authenticate with Google ID token credential
 * Sends credential / id_token to backend Google verification endpoint
 * @param {string} credential - Google ID token JWT
 * @returns {Promise} Axios response
 */
export const googleLogin = async (credential) => {
  const payload = {
    credential,
    id_token: credential,
  };

  try {
    return await api.post("/account/google-login/", payload);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return await api.post("/account/google/", payload);
    }
    throw err;
  }
};


/**
 * Resend verification OTP to user's registered email
 * @param {string|Object} emailOrData - email string or { email } object
 * @returns {Promise} Axios response
 */
export const resendOtp = (emailOrData) => {
  const email =
    typeof emailOrData === "object" && emailOrData !== null
      ? emailOrData.email
      : emailOrData;
  return api.post("/account/resend-otp/", { email });
};

export const resendOTP = resendOtp;

export default {
  registerUser,
  verifyOtp,
  verifyOTP,
  resendOtp,
  resendOTP,
  loginUser,
  googleLogin,
  forgotPassword,
  resetPassword,
};



