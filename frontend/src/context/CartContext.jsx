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

const GUEST_CART_KEY = "gv_guest_cart";

const DEFAULT_EMPTY_CART = {
  id: null,
  items: [],
  total_quantity: 0,
  subtotal: "0.00",
  unavailable_count: 0,
  can_checkout: false,
  updated_at: null,
};

function getStoredGuestCart() {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setStoredGuestCart(items) {
  try {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn("Could not save guest cart to storage:", err);
  }
}

function clearStoredGuestCart() {
  try {
    localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    // ignore
  }
}

function formatGuestCart(items) {
  if (!items || items.length === 0) {
    return DEFAULT_EMPTY_CART;
  }
  const rows = items.map((item) => ({
    ...item,
    quantity: item.quantity,
    unit_price: String(item.unit_price),
    line_total: (parseFloat(item.unit_price) * item.quantity).toFixed(2),
  }));
  const purchasable = rows.filter((r) => r.is_available);
  const subtotalNum = purchasable.reduce(
    (acc, r) => acc + parseFloat(r.line_total),
    0
  );
  const totalQty = rows.reduce((acc, r) => acc + (r.quantity || 0), 0);
  const unavail = rows.length - purchasable.length;

  return {
    id: "guest-cart",
    items: rows,
    total_quantity: totalQty,
    subtotal: subtotalNum.toFixed(2),
    unavailable_count: unavail,
    can_checkout: rows.length > 0 && unavail === 0,
    updated_at: new Date().toISOString(),
  };
}

export function CartProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [cart, setCart] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = getStoredGuestCart();
      if (stored.length > 0) return formatGuestCart(stored);
    }
    return DEFAULT_EMPTY_CART;
  });

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
      const guestItems = getStoredGuestCart();
      setCart(
        guestItems.length > 0
          ? formatGuestCart(guestItems)
          : DEFAULT_EMPTY_CART
      );
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
      // If 401, fallback to guest cart or empty cart
      if (err?.response?.status === 401) {
        const guestItems = getStoredGuestCart();
        setCart(
          guestItems.length > 0
            ? formatGuestCart(guestItems)
            : DEFAULT_EMPTY_CART
        );
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
    let isCancelled = false;

    async function syncOrRefresh() {
      if (isAuthenticated) {
        const guestItems = getStoredGuestCart();
        if (guestItems.length > 0) {
          setLoading(true);
          for (const item of guestItems) {
            try {
              await cartService.addItemToCart({
                productId: item.product.id,
                variantId: item.variant?.id || null,
                quantity: item.quantity,
              });
            } catch (err) {
              console.warn("Could not sync guest item to server cart:", err);
            }
          }
          clearStoredGuestCart();
        }
        if (!isCancelled) {
          await refreshCart();
        }
      } else {
        const guestItems = getStoredGuestCart();
        if (guestItems.length > 0) {
          setCart(formatGuestCart(guestItems));
        } else {
          setCart(DEFAULT_EMPTY_CART);
        }
        setError(null);
      }
    }

    syncOrRefresh();

    return () => {
      isCancelled = true;
    };
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

      const qty = Math.max(1, parseInt(quantity, 10) || 1);

      if (!isAuthenticated) {
        try {
          setIsAdding(true);
          setError(null);

          const items = getStoredGuestCart();
          const targetVariantId = variant?.id || null;
          const existingIndex = items.findIndex(
            (i) =>
              i.product.id === product.id &&
              (targetVariantId ? i.variant?.id === targetVariantId : !i.variant)
          );

          const availableStock =
            typeof variant?.stock_quantity === "number"
              ? variant.stock_quantity
              : typeof product.stock_quantity === "number"
              ? product.stock_quantity
              : 999;

          let rawPrice = 0;
          if (variant && variant.price != null) rawPrice = parseFloat(variant.price);
          else if (variant && variant.mrp != null) rawPrice = parseFloat(variant.mrp);
          else if (product.price != null) rawPrice = parseFloat(product.price);
          else if (product.discount_price != null) rawPrice = parseFloat(product.discount_price);
          const unitPriceStr = (isNaN(rawPrice) ? 0 : rawPrice).toFixed(2);

          if (existingIndex >= 0) {
            const currentItem = items[existingIndex];
            const newTotalQty = currentItem.quantity + qty;
            if (availableStock > 0 && currentItem.quantity >= availableStock) {
              const msg = `Maximum stock reached (${availableStock} available).`;
              showToast(msg);
              return { success: false, error: msg };
            }
            const finalQty =
              availableStock > 0 ? Math.min(newTotalQty, availableStock) : newTotalQty;
            items[existingIndex] = {
              ...currentItem,
              quantity: finalQty,
              unit_price: unitPriceStr,
              line_total: (parseFloat(unitPriceStr) * finalQty).toFixed(2),
              available_stock: availableStock,
              is_available: availableStock >= finalQty,
            };
          } else {
            const finalQty =
              availableStock > 0 ? Math.min(qty, availableStock) : qty;
            const newItem = {
              id: `guest_${product.id}_${targetVariantId || "base"}`,
              product: {
                id: product.id,
                name: product.name,
                slug:
                  product.slug ||
                  product.name.toLowerCase().replace(/\s+/g, "-"),
                unit: product.unit || "unit",
                image:
                  (Array.isArray(product.images) && product.images[0]?.image) ||
                  product.product_img ||
                  product.image ||
                  null,
              },
              variant: variant
                ? {
                    id: variant.id,
                    sku: variant.sku || "",
                    quantity: variant.quantity
                      ? String(variant.quantity)
                      : "1",
                    unit: variant.unit || product.unit || "",
                    mrp: variant.mrp ? String(variant.mrp) : unitPriceStr,
                  }
                : null,
              quantity: finalQty,
              unit_price: unitPriceStr,
              line_total: (parseFloat(unitPriceStr) * finalQty).toFixed(2),
              available_stock: availableStock,
              is_available: availableStock >= finalQty,
              issue:
                availableStock < finalQty ? "INSUFFICIENT_STOCK" : null,
              issue_message:
                availableStock < finalQty
                  ? "Requested quantity exceeds available stock"
                  : null,
              added_at: new Date().toISOString(),
            };
            items.push(newItem);
          }

          setStoredGuestCart(items);
          setCart(formatGuestCart(items));

          const variantLabel = variant
            ? ` (${parseFloat(variant.quantity) || variant.quantity} ${
                variant.unit || ""
              })`
            : "";
          showToast(
            `Added ${qty} × "${product.name}${variantLabel}" to your basket`
          );
          return { success: true };
        } catch (guestErr) {
          console.warn("Guest add to cart failed:", guestErr);
          const errMessage = "Could not add item to basket.";
          showToast(errMessage);
          setError(errMessage);
          return { success: false, error: errMessage };
        } finally {
          setIsAdding(false);
        }
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
          quantity: qty,
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
          `Added ${qty} × "${product.name}${variantLabel}" to your basket`
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
   * Remove an individual item from cart
   * @param {string} cartItemId UUID or guest ID of the cart line item
   */
  const removeFromCart = useCallback(
    async (cartItemId) => {
      if (!cartItemId) return { success: false };

      if (!isAuthenticated) {
        try {
          const items = getStoredGuestCart();
          const filtered = items.filter((i) => i.id !== cartItemId);
          setStoredGuestCart(filtered);
          setCart(formatGuestCart(filtered));
          showToast("Item removed from your harvest basket.");
          return { success: true };
        } catch (err) {
          console.warn("Guest removeFromCart failed:", err);
          return { success: false, error: "Could not remove item." };
        }
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
   * Update quantity of a line item
   * @param {string} cartItemId UUID or guest ID of the cart line item
   * @param {number} newQuantity
   */
  const updateQuantity = useCallback(
    async (cartItemId, newQuantity) => {
      if (!cartItemId) return { success: false };

      if (newQuantity <= 0) {
        return removeFromCart(cartItemId);
      }

      if (!isAuthenticated) {
        try {
          const items = getStoredGuestCart();
          const targetIndex = items.findIndex((i) => i.id === cartItemId);
          if (targetIndex >= 0) {
            const item = items[targetIndex];
            const stock = item.available_stock || 999;
            const finalQty = stock > 0 ? Math.min(newQuantity, stock) : newQuantity;
            items[targetIndex] = {
              ...item,
              quantity: finalQty,
              line_total: (parseFloat(item.unit_price) * finalQty).toFixed(2),
              is_available: stock >= finalQty,
            };
            setStoredGuestCart(items);
            setCart(formatGuestCart(items));
          }
          return { success: true };
        } catch (err) {
          console.warn("Guest updateQuantity failed:", err);
          return { success: false, error: "Could not update item quantity." };
        }
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
    [isAuthenticated, mutatingItemId, showToast, removeFromCart]
  );

  /**
   * Clear all items from cart
   */
  const clearCart = useCallback(async () => {
    if (!isAuthenticated) {
      clearStoredGuestCart();
      setCart(DEFAULT_EMPTY_CART);
      showToast("Harvest basket cleared.");
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
