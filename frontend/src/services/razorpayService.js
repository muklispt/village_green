/**
 * Green Village - Razorpay Checkout Service & Script Loader
 * 
 * Provides safe, idempotent loading of the Razorpay Checkout SDK,
 * options configuration, and unified checkout launching with comprehensive
 * error handling, modal dismissal hooks, and verification callback orchestration.
 */

export const RAZORPAY_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let scriptPromise = null;

/**
 * Loads the official Razorpay checkout.js script asynchronously.
 * Ensures the script is only injected once into the DOM and handles network/loading failures.
 * 
 * @returns {Promise<boolean>} Resolves to true when window.Razorpay is available.
 */
export const loadRazorpayScript = () => {
  if (typeof window !== "undefined" && window.Razorpay) {
    return Promise.resolve(true);
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return reject(new Error("Razorpay script can only be loaded in a browser environment."));
    }

    const existingScript = document.querySelector(`script[src="${RAZORPAY_SCRIPT_URL}"]`);
    if (existingScript) {
      if (window.Razorpay) {
        return resolve(true);
      }
      existingScript.addEventListener("load", () => resolve(true), { once: true });
      existingScript.addEventListener(
        "error",
        () => {
          scriptPromise = null;
          reject(new Error("Failed to load Razorpay payment SDK."));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;

    script.onload = () => {
      resolve(true);
    };

    script.onerror = () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      scriptPromise = null;
      reject(new Error("Unable to load secure payment gateway. Please check your network connection and try again."));
    };

    document.body.appendChild(script);
  });

  return scriptPromise;
};

/**
 * Internal helper to reset the cached script promise (useful for testing script failures).
 */
export const _resetScriptLoader = () => {
  scriptPromise = null;
};

/**
 * Opens the Razorpay Checkout modal with backend-provided parameters.
 * Never calculates or overrides the payment amount on the client side.
 * 
 * @param {Object} params
 * @param {Object} params.sessionData Backend response from POST /orders/<id>/pay/
 * @param {Function} params.onSuccess Callback when payment succeeds in the modal (receives response)
 * @param {Function} params.onDismiss Callback when user closes or dismisses the modal
 * @param {Function} params.onError Callback when payment fails or error occurs
 * @returns {Object} Razorpay instance
 */
export const openRazorpayCheckout = ({
  sessionData,
  onSuccess,
  onDismiss,
  onError,
}) => {
  if (!sessionData || !sessionData.key_id || !sessionData.razorpay_order_id) {
    throw new Error("Invalid Razorpay payment session data. Missing required session parameters.");
  }

  if (typeof window === "undefined" || !window.Razorpay) {
    throw new Error("Razorpay checkout SDK is not loaded. Call loadRazorpayScript() first.");
  }

  const options = {
    key: sessionData.key_id,
    amount: sessionData.amount, // Authoritative paise provided by backend
    currency: sessionData.currency || "INR",
    name: sessionData.name || "Green Village",
    description: sessionData.description || `Order #${sessionData.order_number || ""}`.trim(),
    order_id: sessionData.razorpay_order_id,
    prefill: {
      name: sessionData.prefill?.name || "",
      email: sessionData.prefill?.email || "",
      contact: sessionData.prefill?.contact || "",
    },
    notes: {
      order_id: sessionData.order_id || "",
      order_number: sessionData.order_number || "",
    },
    theme: {
      color: "#1b4332", // Green Village brand forest green
    },
    modal: {
      ondismiss: () => {
        if (typeof onDismiss === "function") {
          onDismiss();
        }
      },
      escape: true,
      backdropclose: false,
    },
    handler: (response) => {
      // response: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
      if (typeof onSuccess === "function") {
        onSuccess(response);
      }
    },
  };

  const instance = new window.Razorpay(options);

  if (typeof onError === "function") {
    instance.on("payment.failed", (response) => {
      onError(response?.error || response);
    });
  }

  instance.open();
  return instance;
};

export default {
  RAZORPAY_SCRIPT_URL,
  loadRazorpayScript,
  openRazorpayCheckout,
  _resetScriptLoader,
};
