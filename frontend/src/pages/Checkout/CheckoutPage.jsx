import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ShoppingBag,
  Truck,
  ShieldCheck,
  Leaf,
  AlertCircle,
  CheckCircle2,
  Edit2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  CreditCard,
  Banknote,
  MapPin,
  Phone,
  User,
  Building,
  Check,
  Sparkles,
} from "lucide-react";

import Navbar from "../../components/layout/Navbar";
import Footer from "../../components/layout/Footer";
import Breadcrumb from "../../components/common/Breadcrumb";
import CheckoutAuthModal from "../../components/checkout/CheckoutAuthModal";
import useCart from "../../context/CartContext";
import useAuth from "../../hooks/useAuth";
import { getProfile, updateProfile } from "../../services/profileService";
import { checkout, initiatePayment, verifyPayment } from "../../services/orderService";
import { loadRazorpayScript, openRazorpayCheckout } from "../../services/razorpayService";
import { resolveImageUrl, formatPrice } from "../../services/productService";

const PHONE_REGEX = /^\+?\d{9,15}$/;
const PINCODE_REGEX = /^\d{6}$/;

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isInitializing, user } = useAuth();
  const {
    cartItems,
    subtotal,
    totalCount,
    canCheckout,
    loading: cartLoading,
    refreshCart,
  } = useCart();

  // Profile & Address state
  const [profileLoading, setProfileLoading] = useState(true);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [saveToProfile, setSaveToProfile] = useState(true);

  const [formData, setFormData] = useState({
    recipient_name: "",
    recipient_phone: "",
    shipping_address: "",
    shipping_city: "",
    shipping_pincode: "",
    payment_method: "cod", // Default to Cash on Delivery
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Synchronous ref to prevent double submission during React state batching
  const isSubmittingRef = useRef(false);

  // Stable idempotency key for this checkout session
  const idempotencyKeyRef = useRef("");
  const getIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `GV-CHK-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    return idempotencyKeyRef.current;
  };

  // Delivery calculation matching business rules
  const deliveryFee = useMemo(() => {
    if (cartItems.length === 0) return 0;
    return subtotal >= 500 ? 0 : 40;
  }, [subtotal, cartItems.length]);

  const amountNeededForFreeDelivery = useMemo(() => {
    return Math.max(0, 500 - subtotal);
  }, [subtotal]);

  const estimatedTotal = useMemo(() => {
    return subtotal + deliveryFee;
  }, [subtotal, deliveryFee]);

  // Load customer profile on mount
  useEffect(() => {
    let isMounted = true;
    async function loadCustomerData() {
      if (!isAuthenticated) {
        setProfileLoading(false);
        return;
      }
      try {
        setProfileLoading(true);
        const res = await getProfile();
        if (!isMounted) return;
        const profile = res.data || res;
        const name = profile.full_name || user?.full_name || "";
        const phone = profile.phone || "";
        const address = profile.address || "";
        const city = profile.city || "";
        const pincode = profile.pincode || "";

        setFormData((prev) => ({
          ...prev,
          recipient_name: name,
          recipient_phone: phone,
          shipping_address: address,
          shipping_city: city,
          shipping_pincode: pincode,
        }));

        // If phone or address is missing, open editing mode immediately
        const hasCompleteAddress = Boolean(
          name.trim() &&
            phone.trim() &&
            address.trim().length >= 5 &&
            city.trim() &&
            PINCODE_REGEX.test(pincode.trim())
        );
        setIsEditingAddress(!hasCompleteAddress);
      } catch (err) {
        console.warn("Could not load customer profile for checkout:", err);
        if (isMounted) setIsEditingAddress(true);
      } finally {
        if (isMounted) setProfileLoading(false);
      }
    }

    if (!isInitializing) {
      loadCustomerData();
    }
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, isInitializing, user]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
    setGeneralError("");
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.recipient_name.trim()) {
      errors.recipient_name = "Recipient full name is required.";
    }
    const cleanPhone = formData.recipient_phone.replace(/\s+/g, "");
    if (!cleanPhone) {
      errors.recipient_phone = "Phone number is required for delivery coordination.";
    } else if (!PHONE_REGEX.test(cleanPhone)) {
      errors.recipient_phone =
        "Enter a valid 9 to 15 digit phone number (e.g., +919876543210).";
    }

    if (!formData.shipping_address.trim()) {
      errors.shipping_address = "Delivery house/street address is required.";
    } else if (formData.shipping_address.trim().length < 5) {
      errors.shipping_address = "Please enter a complete address (at least 5 characters).";
    }

    if (!formData.shipping_city.trim()) {
      errors.shipping_city = "City / Town is required.";
    }

    const cleanPincode = formData.shipping_pincode.trim();
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

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (isSubmitting || isSubmittingRef.current) return;

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!canCheckout || cartItems.length === 0) {
      setGeneralError("Please ensure your cart has available items before placing an order.");
      return;
    }

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setIsEditingAddress(true);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setProcessingStep("Creating your order...");
    setGeneralError("");

    try {
      // If customer chose to save delivery details and we edited them, update user profile
      if (saveToProfile) {
        try {
          await updateProfile({
            full_name: formData.recipient_name.trim(),
            phone: formData.recipient_phone.trim(),
            address: formData.shipping_address.trim(),
            city: formData.shipping_city.trim(),
            pincode: formData.shipping_pincode.trim(),
          });
        } catch (profileErr) {
          console.warn("Optional profile update during checkout skipped:", profileErr);
        }
      }

      const orderPayload = {
        payment_method: formData.payment_method,
        recipient_name: formData.recipient_name.trim(),
        recipient_phone: formData.recipient_phone.replace(/\s+/g, ""),
        shipping_address: formData.shipping_address.trim(),
        shipping_city: formData.shipping_city.trim(),
        shipping_pincode: formData.shipping_pincode.trim(),
      };

      const res = await checkout(orderPayload, getIdempotencyKey());
      const placedOrder = res.order;

      // Refresh cart context so shopping basket count resets
      if (refreshCart) refreshCart();

      // If Cash on Delivery, route directly to order confirmation
      if (formData.payment_method === "cod") {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setProcessingStep("");
        navigate(`/orders/${placedOrder.id}`);
        return;
      }

      // --- Online Payment via Razorpay ---
      setProcessingStep("Connecting to payment gateway...");
      try {
        await loadRazorpayScript();
      } catch (scriptErr) {
        console.error("Razorpay script loading failed:", scriptErr);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setProcessingStep("");
        navigate(`/orders/${placedOrder.id}?payment_pending=1&gateway_error=1`);
        return;
      }

      let sessionData;
      try {
        setProcessingStep("Initializing secure payment session...");
        sessionData = await initiatePayment(placedOrder.id);
      } catch (initErr) {
        console.error("Razorpay order initiation failed:", initErr);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setProcessingStep("");
        navigate(`/orders/${placedOrder.id}?payment_pending=1&init_error=1`);
        return;
      }

      setProcessingStep("Awaiting payment completion...");

      openRazorpayCheckout({
        sessionData,
        onSuccess: async (paymentResponse) => {
          try {
            setProcessingStep("Verifying payment with bank...");
            await verifyPayment(placedOrder.id, {
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature,
            });

            // Authoritative confirmation from backend
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            setProcessingStep("");
            navigate(`/orders/${placedOrder.id}?payment_success=1`, { replace: true });
          } catch (verifyErr) {
            console.error("Backend payment verification failed/pending:", verifyErr);
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            setProcessingStep("");
            // Never assume paid or unpaid when verification times out; send user safely to order page
            navigate(`/orders/${placedOrder.id}?payment_pending=1&verify_pending=1`, { replace: true });
          }
        },
        onDismiss: () => {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
          setProcessingStep("");
          navigate(`/orders/${placedOrder.id}?payment_pending=1`, { replace: true });
        },
        onError: (err) => {
          console.warn("Razorpay payment modal failure:", err);
          isSubmittingRef.current = false;
          setIsSubmitting(false);
          setProcessingStep("");
          navigate(`/orders/${placedOrder.id}?payment_error=1`, { replace: true });
        },
      });
    } catch (err) {
      console.error("Order placement failure:", err);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setProcessingStep("");
      const respData = err.response?.data;
      if (respData && typeof respData === "object") {
        const fieldMsgs = {};
        let topMsg = "";
        for (const [key, val] of Object.entries(respData)) {
          const msg = Array.isArray(val) ? val.join(" ") : String(val);
          if (
            [
              "recipient_name",
              "recipient_phone",
              "shipping_address",
              "shipping_city",
              "shipping_pincode",
              "payment_method",
            ].includes(key)
          ) {
            fieldMsgs[key] = msg;
          } else {
            topMsg = msg;
          }
        }
        setFieldErrors(fieldMsgs);
        setGeneralError(
          topMsg ||
            fieldMsgs.payment_method ||
            Object.values(fieldMsgs)[0] ||
            "Could not place your order. Please check the details and try again."
        );
      } else {
        setGeneralError("An unexpected error occurred while placing your order. Please try again.");
      }
    }
  };

  // If visitor is not authenticated, render welcoming auth gate
  if (!isInitializing && !isAuthenticated) {
    return (
      <div className="gv-page-wrapper">
        <Navbar />
        <main className="gv-main-content gv-checkout-page">
          <div className="gv-checkout-container" style={{ display: "flex", justifyContent: "center" }}>
            <div className="gv-checkout-section" style={{ maxWidth: "480px", textAlign: "center", padding: "2.5rem 2rem" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#eaf4ec",
                  color: "#1b4332",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1.25rem",
                }}
              >
                <ShoppingBag size={28} />
              </div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b3822", marginBottom: "0.5rem" }}>
                Sign In to Complete Checkout
              </h2>
              <p style={{ fontSize: "0.92rem", color: "#617166", lineHeight: 1.5, marginBottom: "1.75rem" }}>
                Please sign in to your Green Village account or register a new account so we can verify your fresh harvest delivery address. Your basket remains intact.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
                <Link to="/login?redirect=/checkout" className="gv-btn-place-order-modern" style={{ textDecoration: "none" }}>
                  Sign In to Account
                </Link>
                <Link
                  to="/register?redirect=/checkout"
                  className="gv-checkout-back-link"
                  style={{ justifyContent: "center", padding: "0.75rem", fontSize: "0.95rem" }}
                >
                  Create New Customer Account
                </Link>
              </div>
              <div>
                <Link to="/cart" className="gv-link-subtle" style={{ fontSize: "0.85rem", color: "#6c7870" }}>
                  <ArrowLeft size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
                  Return to Cart
                </Link>
              </div>
            </div>
          </div>
        </main>
        <Footer />
        <CheckoutAuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    );
  }

  return (
    <div className="gv-page-wrapper">
      <Navbar />

      <main className="gv-main-content gv-checkout-page">
        <div className="gv-checkout-container">
          <Breadcrumb
            items={[
              { label: "Home", to: "/" },
              { label: "Harvest Cart", to: "/cart" },
              { label: "Fresh Farm Checkout" },
            ]}
          />

          {/* Top navigation & Minimal Progress Stepper */}
          <div className="gv-checkout-top-nav">
            <Link to="/cart" className="gv-checkout-back-link">
              <ArrowLeft size={16} />
              <span>Back to Basket</span>
            </Link>

            <div className="gv-checkout-stepper">
              <div className="gv-stepper-step is-done">
                <span className="gv-stepper-num">✓</span>
                <span>Basket</span>
              </div>
              <div className="gv-stepper-divider" />
              <div className="gv-stepper-step is-active">
                <span className="gv-stepper-num">2</span>
                <span>Delivery & Payment</span>
              </div>
              <div className="gv-stepper-divider" />
              <div className="gv-stepper-step">
                <span className="gv-stepper-num">3</span>
                <span>Dispatch</span>
              </div>
            </div>
          </div>

          <div className="gv-checkout-heading-wrap">
            <h1 className="gv-checkout-main-title">Review & Complete Order</h1>
            <p className="gv-checkout-main-desc">
              Direct from verified organic growers • Temperature-controlled cold chain dispatch
            </p>
          </div>

          {generalError && (
            <div className="gv-alert gv-alert--error" role="alert" style={{ marginBottom: "1.5rem" }}>
              <AlertCircle size={20} className="gv-alert-icon" />
              <span>{generalError}</span>
            </div>
          )}

          {cartLoading || profileLoading ? (
            <div className="gv-loading-state">
              <Loader2 size={38} className="gv-spin" style={{ color: "#1b4332" }} />
              <p>Preparing your organic harvest checkout...</p>
            </div>
          ) : cartItems.length === 0 ? (
            <div className="gv-empty-state-card" style={{ maxWidth: "500px", margin: "2rem auto" }}>
              <ShoppingBag size={48} style={{ color: "#2d6a4f", margin: "0 auto 1rem" }} />
              <h2>Your basket is empty</h2>
              <p style={{ marginBottom: "1.5rem" }}>Add seasonal organic vegetables, fruits, or grains to place an order.</p>
              <Link to="/products" className="gv-btn-place-order-modern" style={{ textDecoration: "none", width: "auto", display: "inline-flex" }}>
                Browse Fresh Harvest
              </Link>
            </div>
          ) : (
            <form onSubmit={handlePlaceOrder} className="gv-checkout-grid">
              {/* Left Column: Delivery Details & Payment */}
              <div className="gv-checkout-col-main">
                {/* 1. Delivery Destination */}
                <section className="gv-checkout-section">
                  <div className="gv-section-header">
                    <div className="gv-section-header-left">
                      <div className="gv-section-icon-badge">
                        <MapPin size={18} />
                      </div>
                      <div>
                        <h2 className="gv-section-title">Delivery Destination</h2>
                        <p className="gv-section-desc">
                          Where our insulated refrigerated van will deliver your produce
                        </p>
                      </div>
                    </div>
                    {!isEditingAddress && (
                      <button
                        type="button"
                        className="gv-section-edit-action"
                        onClick={() => setIsEditingAddress(true)}
                      >
                        <Edit2 size={13} />
                        <span>Change</span>
                      </button>
                    )}
                  </div>

                  {!isEditingAddress ? (
                    <div className="gv-address-card-preview">
                      <div className="gv-address-preview-details">
                        <div className="gv-address-recipient-line">
                          <span className="gv-address-recipient-name">{formData.recipient_name}</span>
                          <span className="gv-address-badge-verified">
                            <CheckCircle2 size={12} /> Confirmed Address
                          </span>
                        </div>
                        <div className="gv-address-street">
                          {formData.shipping_address}, {formData.shipping_city} — {formData.shipping_pincode}
                        </div>
                        <div className="gv-address-phone-line">
                          <Phone size={13} />
                          <span>{formData.recipient_phone}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="gv-address-fields-grid">
                      <div className="gv-field-wrap">
                        <label className="gv-field-label" htmlFor="recipient_name">
                          <User size={14} /> Recipient Full Name *
                        </label>
                        <input
                          id="recipient_name"
                          name="recipient_name"
                          type="text"
                          value={formData.recipient_name}
                          onChange={handleInputChange}
                          placeholder="e.g. Asha Nair"
                          className={`gv-field-input ${fieldErrors.recipient_name ? "is-invalid" : ""}`}
                          required
                        />
                        {fieldErrors.recipient_name && (
                          <span className="gv-field-error-msg">{fieldErrors.recipient_name}</span>
                        )}
                      </div>

                      <div className="gv-field-wrap">
                        <label className="gv-field-label" htmlFor="recipient_phone">
                          <Phone size={14} /> Contact Phone Number *
                        </label>
                        <input
                          id="recipient_phone"
                          name="recipient_phone"
                          type="tel"
                          value={formData.recipient_phone}
                          onChange={handleInputChange}
                          placeholder="+91 9876543210"
                          className={`gv-field-input ${fieldErrors.recipient_phone ? "is-invalid" : ""}`}
                          required
                        />
                        {fieldErrors.recipient_phone && (
                          <span className="gv-field-error-msg">{fieldErrors.recipient_phone}</span>
                        )}
                        <span className="gv-field-subtext">Delivery driver will coordinate arrival via this number</span>
                      </div>

                      <div className="gv-field-wrap gv-field-wrap--full">
                        <label className="gv-field-label" htmlFor="shipping_address">
                          <Building size={14} /> House / Flat / Street / Landmark *
                        </label>
                        <textarea
                          id="shipping_address"
                          name="shipping_address"
                          rows={3}
                          value={formData.shipping_address}
                          onChange={handleInputChange}
                          placeholder="Apartment/Flat number, wing, building name, cross street, landmark"
                          className={`gv-field-textarea ${fieldErrors.shipping_address ? "is-invalid" : ""}`}
                          required
                        />
                        {fieldErrors.shipping_address && (
                          <span className="gv-field-error-msg">{fieldErrors.shipping_address}</span>
                        )}
                      </div>

                      <div className="gv-field-wrap">
                        <label className="gv-field-label" htmlFor="shipping_city">City or District *</label>
                        <input
                          id="shipping_city"
                          name="shipping_city"
                          type="text"
                          value={formData.shipping_city}
                          onChange={handleInputChange}
                          placeholder="e.g. Bengaluru"
                          className={`gv-field-input ${fieldErrors.shipping_city ? "is-invalid" : ""}`}
                          required
                        />
                        {fieldErrors.shipping_city && (
                          <span className="gv-field-error-msg">{fieldErrors.shipping_city}</span>
                        )}
                      </div>

                      <div className="gv-field-wrap">
                        <label className="gv-field-label" htmlFor="shipping_pincode">PIN / Postal Code *</label>
                        <input
                          id="shipping_pincode"
                          name="shipping_pincode"
                          type="text"
                          maxLength={6}
                          value={formData.shipping_pincode}
                          onChange={handleInputChange}
                          placeholder="6 digits (e.g. 560001)"
                          className={`gv-field-input ${fieldErrors.shipping_pincode ? "is-invalid" : ""}`}
                          required
                        />
                        {fieldErrors.shipping_pincode && (
                          <span className="gv-field-error-msg">{fieldErrors.shipping_pincode}</span>
                        )}
                      </div>

                      <label className="gv-save-profile-toggle">
                        <input
                          type="checkbox"
                          checked={saveToProfile}
                          onChange={(e) => setSaveToProfile(e.target.checked)}
                        />
                        <span>Save this address to my profile for future harvests</span>
                      </label>

                      {formData.recipient_name &&
                        formData.recipient_phone &&
                        formData.shipping_address && (
                          <div className="gv-confirm-address-row">
                            <button
                              type="button"
                              className="gv-btn-confirm-address"
                              onClick={() => {
                                const errs = validateForm();
                                if (
                                  !errs.recipient_name &&
                                  !errs.recipient_phone &&
                                  !errs.shipping_address &&
                                  !errs.shipping_city &&
                                  !errs.shipping_pincode
                                ) {
                                  setIsEditingAddress(false);
                                } else {
                                  setFieldErrors(errs);
                                }
                              }}
                            >
                              <Check size={14} /> Use This Address
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                </section>

                {/* 2. Payment Method */}
                <section className="gv-checkout-section">
                  <div className="gv-section-header">
                    <div className="gv-section-header-left">
                      <div className="gv-section-icon-badge">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <h2 className="gv-section-title">Payment Preference</h2>
                        <p className="gv-section-desc">
                          Choose how you would like to settle your farm produce order
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="gv-payment-tiles">
                    {/* Option 1: Cash on Delivery (COD) - Active & Primary */}
                    <div
                      className={`gv-payment-tile ${formData.payment_method === "cod" ? "is-active" : ""}`}
                      onClick={() => setFormData((p) => ({ ...p, payment_method: "cod" }))}
                      role="radio"
                      aria-checked={formData.payment_method === "cod"}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          setFormData((p) => ({ ...p, payment_method: "cod" }));
                        }
                      }}
                    >
                      <div className="gv-payment-tile-left">
                        <div className="gv-payment-tile-icon">
                          <Banknote size={22} />
                        </div>
                        <div className="gv-payment-tile-texts">
                          <div className="gv-payment-tile-title-row">
                            <span className="gv-payment-tile-title">Cash on Delivery (COD)</span>
                            <span className="gv-payment-tag-badge" style={{ background: "#e8f5e9", color: "#2e7d32" }}>
                              Recommended
                            </span>
                          </div>
                          <span className="gv-payment-tile-desc">
                            Pay in cash or scan delivery agent's UPI QR code upon doorstep delivery
                          </span>
                        </div>
                      </div>

                      <div className="gv-payment-radio-custom">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    </div>

                    {/* Option 2: Online Payment via Razorpay */}
                    <div
                      className={`gv-payment-tile ${formData.payment_method === "online" ? "is-active" : ""}`}
                      onClick={() => setFormData((p) => ({ ...p, payment_method: "online" }))}
                      role="radio"
                      aria-checked={formData.payment_method === "online"}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          setFormData((p) => ({ ...p, payment_method: "online" }));
                        }
                      }}
                    >
                      <div className="gv-payment-tile-left">
                        <div className="gv-payment-tile-icon">
                          <CreditCard size={22} />
                        </div>
                        <div className="gv-payment-tile-texts">
                          <div className="gv-payment-tile-title-row">
                            <span className="gv-payment-tile-title">Online Payment (UPI, Cards, Netbanking)</span>
                            <span className="gv-payment-tag-badge" style={{ background: "#e8f5e9", color: "#2e7d32" }}>
                              Razorpay Secure
                            </span>
                          </div>
                          <span className="gv-payment-tile-desc">
                            Instant online payment via UPI, Credit/Debit Cards, or Netbanking
                          </span>
                        </div>
                      </div>

                      <div className="gv-payment-radio-custom">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    </div>

                    {formData.payment_method === "online" && (
                      <div
                        style={{
                          marginTop: "0.5rem",
                          padding: "0.85rem 1rem",
                          background: "#f4f8f5",
                          border: "1px solid #d2e4d8",
                          borderRadius: "10px",
                          fontSize: "0.83rem",
                          color: "#183b28",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600, marginBottom: "0.25rem", color: "#166534" }}>
                          <Sparkles size={14} style={{ color: "#16a34a" }} />
                          <span>UPI Dynamic QR & Mobile Intent</span>
                        </div>
                        <p style={{ margin: 0, color: "#345541", lineHeight: 1.45 }}>
                          • <strong>Desktop:</strong> Razorpay displays a dynamic UPI QR to scan with your phone&apos;s UPI app.<br />
                          • <strong>Mobile:</strong> Tapping directly launches Google Pay, PhonePe, Paytm, or BHIM via UPI Intent.
                        </p>
                      </div>
                    )}
                  </div>

                  {fieldErrors.payment_method && (
                    <div className="gv-alert gv-alert--warning" role="alert" style={{ marginTop: "1rem" }}>
                      <AlertCircle size={16} className="gv-alert-icon" />
                      <span>{fieldErrors.payment_method}</span>
                    </div>
                  )}
                </section>

                {/* 3. Produce Review */}
                <section className="gv-checkout-section">
                  <div className="gv-section-header">
                    <div className="gv-section-header-left">
                      <div className="gv-section-icon-badge">
                        <ShoppingBag size={18} />
                      </div>
                      <div>
                        <h2 className="gv-section-title">Fresh Harvest Produce ({totalCount} items)</h2>
                        <p className="gv-section-desc">
                          Harvested on-demand from regional organic growers
                        </p>
                      </div>
                    </div>
                    <Link to="/cart" className="gv-section-edit-action" style={{ textDecoration: "none" }}>
                      <span>Edit Cart</span>
                    </Link>
                  </div>

                  <div className="gv-basket-items-wrap">
                    {cartItems.map((ci) => {
                      const prod = ci.product || {};
                      const variant = ci.variant;
                      const variantLabel = variant
                        ? `${Number(variant.quantity)} ${variant.unit}`
                        : "";
                      const unitPrice = Number(variant?.price || prod.price || 0);
                      const lineTotal = Number(ci.total_price || unitPrice * ci.quantity);
                      const imageSrc = resolveImageUrl(prod.product_img || prod.images?.[0]?.image);

                      return (
                        <div key={ci.id} className="gv-basket-item-row">
                          <div className="gv-basket-item-left">
                            <img
                              src={imageSrc}
                              alt={prod.name || "Produce"}
                              className="gv-basket-item-img"
                              onError={(e) => {
                                e.currentTarget.src = "/favicon.svg";
                              }}
                            />
                            <div className="gv-basket-item-meta">
                              <span className="gv-basket-item-name">{prod.name}</span>
                              <div className="gv-basket-item-submeta">
                                {variantLabel && (
                                  <span className="gv-variant-pill">{variantLabel}</span>
                                )}
                                <span>
                                  {ci.quantity} × {formatPrice(unitPrice)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="gv-basket-item-price">
                            {formatPrice(lineTotal)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Right Column: Order Summary (Sticky) */}
              <aside className="gv-checkout-col-summary">
                <div className="gv-summary-card-modern">
                  <h3 className="gv-summary-card-title">Order Summary</h3>

                  {deliveryFee > 0 && amountNeededForFreeDelivery > 0 ? (
                    <div className="gv-free-delivery-meter">
                      <Truck size={16} />
                      <span>Add <strong>{formatPrice(amountNeededForFreeDelivery)}</strong> more for free delivery</span>
                    </div>
                  ) : (
                    <div className="gv-free-delivery-meter" style={{ background: "#eaf4ec", borderColor: "#c2e0c9" }}>
                      <CheckCircle2 size={16} />
                      <span>You have unlocked <strong>Free Cold-Chain Delivery</strong>!</span>
                    </div>
                  )}

                  <div className="gv-summary-line-rows">
                    <div className="gv-summary-line">
                      <span>Produce Subtotal</span>
                      <strong>{formatPrice(subtotal)}</strong>
                    </div>

                    <div className="gv-summary-line">
                      <span>Eco Cold-Chain Delivery</span>
                      {deliveryFee === 0 ? (
                        <span className="gv-text-accent-free">FREE</span>
                      ) : (
                        <strong>{formatPrice(deliveryFee)}</strong>
                      )}
                    </div>

                    <div className="gv-summary-line">
                      <span>Agricultural Taxes (GST)</span>
                      <span style={{ fontSize: "0.82rem", color: "#6c7a71" }}>Included in price</span>
                    </div>

                    <div className="gv-summary-line-divider" />

                    <div className="gv-summary-grand-total">
                      <div>
                        <div className="gv-grand-total-label">Payable Total</div>
                        <div className="gv-grand-total-sub">Direct farm allocation</div>
                      </div>
                      <div className="gv-grand-total-num">
                        {formatPrice(estimatedTotal)}
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !canCheckout || cartItems.length === 0}
                    className="gv-btn-place-order-modern"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={18} className="gv-spin" />
                        <span>{processingStep || "Placing Your Order..."}</span>
                      </>
                    ) : formData.payment_method === "online" ? (
                      <>
                        <span>Proceed to Payment • {formatPrice(estimatedTotal)}</span>
                        <ArrowRight size={18} />
                      </>
                    ) : (
                      <>
                        <span>Place Farm Order • {formatPrice(estimatedTotal)}</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>

                  <div className="gv-order-trust-strip">
                    <div className="gv-trust-strip-item">
                      <Leaf size={15} />
                      <span>100% Organic, zero synthetic chemicals</span>
                    </div>
                    <div className="gv-trust-strip-item">
                      <Truck size={15} />
                      <span>Harvested & packed fresh within 24 hours</span>
                    </div>
                    <div className="gv-trust-strip-item">
                      <ShieldCheck size={15} />
                      <span>Fair prices paid directly to regional growers</span>
                    </div>
                  </div>
                </div>
              </aside>
            </form>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
