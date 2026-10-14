/**
 * Password strength calculation
 * @param {string} password 
 * @returns {{ score: number, label: string }}
 */
export const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: "Enter password" };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  let label = "Weak";
  if (score === 2) label = "Fair";
  if (score === 3) label = "Good";
  if (score === 4) label = "Strong Password";

  return { score, label };
};

/**
 * Client-side validation for the registration form
 * @param {{ full_name: string, email: string, password: string, confirm_password: string }} form 
 * @returns {Object} map of field to error message
 */
export const validateRegistrationForm = (form) => {
  const errors = {};

  // Full Name validation
  const trimmedName = (form.full_name || "").trim();
  if (!trimmedName) {
    errors.full_name = "Full name is required.";
  } else if (trimmedName.length < 3) {
    errors.full_name = "Full name must be at least 3 characters.";
  } else if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(trimmedName)) {
    errors.full_name = "Full name can contain only letters and spaces.";
  }

  // Email validation
  const trimmedEmail = (form.email || "").trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = "Email address is required.";
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = "Please enter a valid email address.";
  } else if (/^\d/.test(trimmedEmail.split("@")[0])) {
    errors.email = "Email address cannot start with a number.";
  }

  // Password validation
  if (!form.password) {
    errors.password = "Password is required.";
  } else if (form.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  // Confirm Password validation
  if (!form.confirm_password) {
    errors.confirm_password = "Confirm password is required.";
  } else if (form.password !== form.confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  return errors;
};

/**
 * Parse and normalize Django DRF / Axios errors
 * @param {Error} error 
 * @returns {{ fieldErrors: Object, generalError: string }}
 */
export const parseApiError = (error) => {
  const fieldErrors = {};
  let generalError = "";

  if (error.response) {
    const data = error.response.data;
    const status = error.response.status;

    if (typeof data === "object" && data !== null) {
      Object.keys(data).forEach((key) => {
        const val = data[key];
        const errorText = Array.isArray(val) ? val.join(" ") : String(val);

        if (key === "detail" || key === "non_field_errors" || key === "error" || key === "message") {
          generalError = errorText;
        } else if (key === "uid" || key === "token") {
          fieldErrors[key] = errorText;
          if (!generalError) {
            generalError = errorText.toLowerCase().includes("invalid") || errorText.toLowerCase().includes("expired")
              ? errorText
              : "Invalid or expired password reset link.";
          }
        } else if (key === "password") {
          fieldErrors.password = errorText;
          // Map backend 'password' validation message to 'new_password' for reset form
          fieldErrors.new_password = errorText;
        } else if (key === "code" || key === "messages") {
          // Skip internal JWT status codes and messages array
        } else {
          fieldErrors[key] = errorText;
        }
      });
    }

    if (status === 401) {
      if (!generalError || generalError.toLowerCase().includes("token") || generalError.toLowerCase().includes("credential") || generalError.toLowerCase().includes("not valid")) {
        generalError = "Unauthorized request. Please try again.";
      }
    } else if (!generalError && Object.keys(fieldErrors).length > 0) {
      // If UID or token has errors, show that prominently
      if (fieldErrors.uid || fieldErrors.token) {
        generalError = fieldErrors.uid || fieldErrors.token || "Invalid or expired password reset link.";
      } else {
        generalError = "Please correct the highlighted fields.";
      }
    } else if (!generalError) {
      if (status === 429) {
        generalError = "Too many requests. Please wait a moment before trying again.";
      } else if (status >= 500) {
        generalError = "A server error occurred. Please try again later.";
      } else {
        generalError = `Request failed with status ${status}.`;
      }
    }
  } else if (error.request) {
    generalError = "Could not connect to the server. Please ensure the backend is running.";
  } else {
    generalError = error.message || "An unexpected error occurred.";
  }

  return { fieldErrors, generalError };
};

/**
 * Extract cooldown seconds from a cooldown or rate limit error message
 * e.g., "Please wait 60 seconds before requesting a new code." -> 60
 * "Request was throttled. Expected available in 58 seconds." -> 58
 * @param {string} message
 * @returns {number|null}
 */
export const extractCooldownSeconds = (message) => {
  if (!message || typeof message !== "string") return null;
  const match = message.match(/(?:wait|in|available in)\s+(\d+)\s+second/i);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Client-side validation for the forgot password form
 * @param {{ email: string }} form 
 * @returns {Object} map of field to error message
 */
export const validateForgotPasswordForm = (form) => {
  const errors = {};

  const trimmedEmail = (form?.email || "").trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = "Email address is required.";
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = "Please enter a valid email address.";
  }

  return errors;
};

/**
 * Client-side validation for the reset password form
 * @param {{ new_password: string, confirm_password: string }} form 
 * @returns {Object} map of field to error message
 */
export const validateResetPasswordForm = (form) => {
  const errors = {};

  if (!form?.new_password) {
    errors.new_password = "New password is required.";
  } else if (form.new_password.length < 8) {
    errors.new_password = "Password must be at least 8 characters.";
  }

  if (!form?.confirm_password) {
    errors.confirm_password = "Confirm password is required.";
  } else if (form.new_password !== form.confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  return errors;
};

/**
 * Client-side validation for the login form
 * @param {{ email: string, password: string }} form 
 * @returns {Object} map of field to error message
 */
export const validateLoginForm = (form) => {
  const errors = {};

  // Email validation
  const trimmedEmail = (form.email || "").trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = "Email address is required.";
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = "Please enter a valid email address.";
  }

  // Password validation
  if (!form.password) {
    errors.password = "Password is required.";
  }

  return errors;
};

/**
 * Parse and normalize Django DRF / Axios errors specifically for Login
 * Handles:
 * - Invalid email/password -> "Invalid email or password."
 * - Account not verified -> Backend error message (e.g. "Verify your email")
 * - Validation errors -> Field-specific errors
 * - Network / Server errors -> "Something went wrong. Please try again."
 * @param {Error} error 
 * @returns {{ fieldErrors: Object, generalError: string }}
 */
export const parseLoginApiError = (error) => {
  const fieldErrors = {};
  let generalError = "";

  // 1. Network error (no response) or 5xx server error
  if (!error.response || (error.response.status && error.response.status >= 500)) {
    generalError = "Something went wrong. Please try again.";
    return { fieldErrors, generalError };
  }

  const { status, data } = error.response;

  // 2. Parse payload from response
  if (data && typeof data === "object") {
    // Check field-level validation errors
    if (data.email) {
      fieldErrors.email = Array.isArray(data.email) ? data.email.join(" ") : String(data.email);
    }
    if (data.password) {
      fieldErrors.password = Array.isArray(data.password) ? data.password.join(" ") : String(data.password);
    }

    // Extract any general error string (e.g. 'error', 'detail', 'non_field_errors')
    const rawError =
      data.error ||
      data.detail ||
      (Array.isArray(data.non_field_errors) ? data.non_field_errors.join(" ") : data.non_field_errors) ||
      data.message;

    if (rawError) {
      const errorText = String(rawError).trim();
      const lower = errorText.toLowerCase();

      // Account not verified: Show the backend error message
      if (
        lower.includes("verify") ||
        lower.includes("verification") ||
        lower.includes("not active") ||
        lower.includes("inactive")
      ) {
        generalError = errorText;
      }
      // Invalid email / password
      else if (
        lower.includes("check email and password") ||
        lower.includes("invalid") ||
        lower.includes("credential") ||
        lower.includes("password") ||
        lower.includes("no active account") ||
        status === 401
      ) {
        generalError = "Invalid email or password.";
      } else {
        generalError = errorText;
      }
    }
  }

  // 3. Fallbacks
  if (!generalError && status === 401) {
    generalError = "Invalid email or password.";
  }

  if (!generalError && Object.keys(fieldErrors).length === 0) {
    generalError = "Something went wrong. Please try again.";
  }

  return { fieldErrors, generalError };
};

