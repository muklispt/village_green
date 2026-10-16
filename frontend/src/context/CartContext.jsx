import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "gv_cart_items_v1";

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartItems));
    } catch (e) {
      console.warn("Failed to persist cart items to localStorage", e);
    }
  }, [cartItems]);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  const addToCart = useCallback((product, quantity = 1, variant = null) => {
    if (!product || !product.id) return;

    const maxStock =
      typeof variant?.stock_quantity === "number"
        ? variant.stock_quantity
        : typeof product.stock_quantity === "number"
        ? product.stock_quantity
        : 99;

    // Prevent adding out-of-stock items
    if (maxStock <= 0) return;

    const lineItemId = variant?.id ? `${product.id}_${variant.id}` : product.id;

    setCartItems((prevItems) => {
      const existingIndex = prevItems.findIndex(
        (item) => (item.id || item.product?.id) === lineItemId
      );

      if (existingIndex > -1) {
        const existingItem = prevItems[existingIndex];
        const newQuantity = Math.min(existingItem.quantity + quantity, maxStock);
        const updated = [...prevItems];
        updated[existingIndex] = {
          ...existingItem,
          id: lineItemId,
          variant: variant || existingItem.variant || null,
          quantity: newQuantity,
        };
        return updated;
      } else {
        const initialQuantity = Math.min(Math.max(1, quantity), maxStock);
        return [
          ...prevItems,
          {
            id: lineItemId,
            product,
            variant: variant || null,
            quantity: initialQuantity,
          },
        ];
      }
    });

    const variantLabel = variant
      ? ` (${parseFloat(variant.quantity) || variant.quantity} ${variant.unit || ""})`
      : "";
    showToast(`Added ${quantity} × "${product.name}${variantLabel}" to your basket`);
  }, [showToast]);

  const updateQuantity = useCallback((cartItemId, quantity) => {
    setCartItems((prevItems) => {
      if (quantity <= 0) {
        return prevItems.filter(
          (item) => (item.id || item.product?.id) !== cartItemId
        );
      }
      return prevItems.map((item) => {
        const currentId = item.id || item.product?.id;
        if (currentId === cartItemId) {
          const maxStock =
            typeof item.variant?.stock_quantity === "number"
              ? item.variant.stock_quantity
              : typeof item.product?.stock_quantity === "number"
              ? item.product.stock_quantity
              : 99;
          return {
            ...item,
            quantity: Math.min(quantity, maxStock),
          };
        }
        return item;
      });
    });
  }, []);

  const removeFromCart = useCallback((cartItemId) => {
    setCartItems((prevItems) =>
      prevItems.filter((item) => (item.id || item.product?.id) !== cartItemId)
    );
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const totalCount = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, [cartItems]);

  const subtotal = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      const price = item.variant?.price
        ? parseFloat(item.variant.price)
        : parseFloat(item.product?.price) || 0;
      return sum + price * (item.quantity || 0);
    }, 0);
  }, [cartItems]);

  const value = useMemo(
    () => ({
      cartItems,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      totalCount,
      subtotal,
      isCartOpen,
      setIsCartOpen,
      toastMessage,
    }),
    [
      cartItems,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      totalCount,
      subtotal,
      isCartOpen,
      toastMessage,
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
