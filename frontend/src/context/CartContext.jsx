import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import useAuth from "../hooks/useAuth";
import * as cartService from "../services/cartService";

const CartContext = createContext(null);

const DEFAULT_EMPTY_CART = {
  id: null,
  items: [],
  total_quantity: 0,
  subtotal: "0.00",
  unavailable_count: 0,
  can_checkout: false,
  updated_at: null,
};

export function CartProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [cart, setCart] = useState(DEFAULT_EMPTY_CART);
  const [loading, setLoading] = useState(false);
  const [mutatingItemId, setMutatingItemId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  // Fetch cart when authenticated
  const refreshCart = useCallback(async () => {
    if (!isAuthenticated) {
      setCart(DEFAULT_EMPTY_CART);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await cartService.getCart();
      if (data && typeof data === "object") {
        setCart(data);
      }
    } catch (err) {
      console.warn("Unable to fetch cart from server:", err);
      // If 401, keep empty cart
      if (err?.response?.status === 401) {
        setCart(DEFAULT_EMPTY_CART);
      } else {
        const msg =
          err?.response?.data?.detail || "Could not load your shopping cart.";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Synchronize cart on authentication changes
  useEffect(() => {
    if (isAuthenticated) {
      refreshCart();
    } else {
      setCart(DEFAULT_EMPTY_CART);
      setError(null);
    }
  }, [isAuthenticated, refreshCart]);

  /**
   * Add a product or variant to cart
   * @param {Object} product
   * @param {number} [quantity=1]
   * @param {Object|null} [variant=null]
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  const addToCart = useCallback(
    async (product, quantity = 1, variant = null) => {
      if (!product || !product.id) {
        return { success: false, error: "Invalid product" };
      }

      if (!isAuthenticated) {
        showToast("Please sign in to add items to your harvest basket.");
        return { success: false, error: "Authentication required" };
      }

      if (isAdding) {
        return { success: false, error: "Request in progress" };
      }

      try {
        setIsAdding(true);
        setError(null);

        const data = await cartService.addItemToCart({
          productId: product.id,
          variantId: variant?.id || null,
          quantity,
        });

        if (data && typeof data === "object") {
          setCart(data);
        }

        const variantLabel = variant
          ? ` (${parseFloat(variant.quantity) || variant.quantity} ${
              variant.unit || ""
            })`
          : "";
        showToast(
          `Added ${quantity} × "${product.name}${variantLabel}" to your basket`
        );
        return { success: true };
      } catch (err) {
        let errMessage = "Could not add item to basket.";
        if (err?.response?.data) {
          const respData = err.response.data;
          if (Array.isArray(respData.quantity) && respData.quantity[0]) {
            errMessage = respData.quantity[0];
          } else if (Array.isArray(respData.variant) && respData.variant[0]) {
            errMessage = respData.variant[0];
          } else if (Array.isArray(respData.product) && respData.product[0]) {
            errMessage = respData.product[0];
          } else if (Array.isArray(respData.cart) && respData.cart[0]) {
            errMessage = respData.cart[0];
          } else if (typeof respData.detail === "string") {
            errMessage = respData.detail;
          }
        }
        showToast(errMessage);
        setError(errMessage);
        return { success: false, error: errMessage };
      } finally {
        setIsAdding(false);
      }
    },
    [isAuthenticated, isAdding, showToast]
  );

  /**
   * Update quantity of a line item
   * @param {string} cartItemId UUID of the cart line item
   * @param {number} newQuantity
   */
  const updateQuantity = useCallback(
    async (cartItemId, newQuantity) => {
      if (!cartItemId) return { success: false };

      if (!isAuthenticated) {
        showToast("Please sign in to update your basket.");
        return { success: false, error: "Authentication required" };
      }

      if (newQuantity <= 0) {
        // If reduced to 0, delegate to remove
        return removeFromCart(cartItemId);
      }

      if (mutatingItemId === cartItemId) {
        return { success: false, error: "Update in progress" };
      }

      try {
        setMutatingItemId(cartItemId);
        setError(null);

        const data = await cartService.updateCartItemQuantity(
          cartItemId,
          newQuantity
        );
        if (data && typeof data === "object") {
          setCart(data);
        }
        return { success: true };
      } catch (err) {
        let errMessage = "Could not update item quantity.";
        if (err?.response?.data) {
          const respData = err.response.data;
          if (Array.isArray(respData.quantity) && respData.quantity[0]) {
            errMessage = respData.quantity[0];
          } else if (typeof respData.detail === "string") {
            errMessage = respData.detail;
          }
        }
        showToast(errMessage);
        setError(errMessage);
        return { success: false, error: errMessage };
      } finally {
        setMutatingItemId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAuthenticated, mutatingItemId, showToast]
  );

  /**
   * Remove an individual item from cart
   * @param {string} cartItemId UUID of the cart line item
   */
  const removeFromCart = useCallback(
    async (cartItemId) => {
      if (!cartItemId) return { success: false };

      if (!isAuthenticated) {
        showToast("Please sign in to modify your basket.");
        return { success: false, error: "Authentication required" };
      }

      if (mutatingItemId === cartItemId) {
        return { success: false, error: "Deletion in progress" };
      }

      try {
        setMutatingItemId(cartItemId);
        setError(null);

        const data = await cartService.removeCartItem(cartItemId);
        if (data && typeof data === "object") {
          setCart(data);
        }
        showToast("Item removed from your harvest basket.");
        return { success: true };
      } catch (err) {
        const msg =
          err?.response?.data?.detail || "Could not remove item from basket.";
        showToast(msg);
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setMutatingItemId(null);
      }
    },
    [isAuthenticated, mutatingItemId, showToast]
  );

  /**
   * Clear all items from cart
   */
  const clearCart = useCallback(async () => {
    if (!isAuthenticated) {
      setCart(DEFAULT_EMPTY_CART);
      return { success: true };
    }

    try {
      setLoading(true);
      setError(null);
      const data = await cartService.clearCart();
      if (data && typeof data === "object") {
        setCart(data);
      } else {
        setCart(DEFAULT_EMPTY_CART);
      }
      showToast("Harvest basket cleared.");
      return { success: true };
    } catch (err) {
      const msg =
        err?.response?.data?.detail || "Could not clear shopping basket.";
      showToast(msg);
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, showToast]);

  const cartItems = useMemo(() => cart.items || [], [cart.items]);

  const totalCount = useMemo(
    () => cart.total_quantity || 0,
    [cart.total_quantity]
  );

  const subtotal = useMemo(
    () => parseFloat(cart.subtotal) || 0,
    [cart.subtotal]
  );

  const canCheckout = useMemo(
    () => Boolean(cart.can_checkout),
    [cart.can_checkout]
  );

  const unavailableCount = useMemo(
    () => cart.unavailable_count || 0,
    [cart.unavailable_count]
  );

  const value = useMemo(
    () => ({
      cart,
      cartItems,
      totalCount,
      subtotal,
      canCheckout,
      unavailableCount,
      loading,
      mutatingItemId,
      isAdding,
      error,
      refreshCart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      isCartOpen,
      setIsCartOpen,
      toastMessage,
      showToast,
    }),
    [
      cart,
      cartItems,
      totalCount,
      subtotal,
      canCheckout,
      unavailableCount,
      loading,
      mutatingItemId,
      isAdding,
      error,
      refreshCart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      isCartOpen,
      setIsCartOpen,
      toastMessage,
      showToast,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export default function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
