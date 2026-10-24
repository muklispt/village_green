import api from "./api.js";

/**
 * Green Village Cart API Service
 * Communicates with Django REST Framework backend at /api/v1/cart/
 */

/**
 * Fetch current user's cart
 * GET /api/v1/cart/
 * @returns {Promise<Object>} Serialized cart data
 */
export async function getCart() {
  const response = await api.get("/cart/");
  return response.data;
}

/**
 * Add a product or variant to cart
 * POST /api/v1/cart/items/
 * @param {Object} params
 * @param {string} params.productId UUID of product
 * @param {string|null} [params.variantId] UUID of variant (optional)
 * @param {number} [params.quantity=1] Quantity to add
 * @returns {Promise<Object>} Updated serialized cart data
 */
export async function addItemToCart({ productId, variantId = null, quantity = 1 }) {
  const payload = {
    product: productId,
    quantity: Math.max(1, parseInt(quantity, 10) || 1),
  };

  if (variantId) {
    payload.variant = variantId;
  }

  const response = await api.post("/cart/items/", payload);
  return response.data;
}

/**
 * Update quantity for an existing cart line item
 * PATCH /api/v1/cart/items/<uuid:pk>/
 * @param {string} itemId UUID of the cart item line
 * @param {number} quantity New quantity
 * @returns {Promise<Object>} Updated serialized cart data
 */
export async function updateCartItemQuantity(itemId, quantity) {
  const payload = {
    quantity: Math.max(1, parseInt(quantity, 10) || 1),
  };
  const response = await api.patch(`/cart/items/${itemId}/`, payload);
  return response.data;
}

/**
 * Remove an individual line item from cart
 * DELETE /api/v1/cart/items/<uuid:pk>/
 * @param {string} itemId UUID of the cart item line
 * @returns {Promise<Object>} Updated serialized cart data
 */
export async function removeCartItem(itemId) {
  const response = await api.delete(`/cart/items/${itemId}/`);
  return response.data;
}

/**
 * Clear all items from the current user's cart
 * DELETE /api/v1/cart/
 * @returns {Promise<Object>} Updated serialized cart data (empty items list)
 */
export async function clearCart() {
  const response = await api.delete("/cart/");
  return response.data;
}
