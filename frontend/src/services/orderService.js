import api from "./api";

/**
 * Service for Order and Payment operations
 */

export const checkout = async (data, idempotencyKey = "") => {
  const headers = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const payload = {
    ...data,
    idempotency_key: idempotencyKey || data.idempotency_key || "",
  };
  const response = await api.post("/orders/checkout/", payload, { headers });
  return response.data;
};

export const getOrder = async (orderId) => {
  const response = await api.get(`/orders/${orderId}/`);
  return response.data;
};

export const getOrders = async (page = 1) => {
  const response = await api.get(`/orders/?page=${page}`);
  return response.data;
};

export const getMyOrders = async (params = {}) => {
  const cleanParams = {};
  if (typeof params === "number" || typeof params === "string") {
    cleanParams.page = params;
  } else if (params && typeof params === "object") {
    if (params.page) cleanParams.page = params.page;
    if (params.page_size) cleanParams.page_size = params.page_size;
  }
  const response = await api.get("/orders/my-orders/", { params: cleanParams });
  return response.data;
};

export const getMyOrderById = async (orderId) => {
  const response = await api.get(`/orders/my-orders/${orderId}/`);
  return response.data;
};

export const cancelOrder = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/cancel/`);
  return response.data;
};

export const initiatePayment = async (orderId) => {
  const response = await api.post(`/orders/${orderId}/pay/`);
  return response.data;
};

export const verifyPayment = async (orderId, verificationData) => {
  const response = await api.post(`/orders/${orderId}/verify/`, verificationData);
  return response.data;
};

export default {
  checkout,
  getOrder,
  getOrders,
  getMyOrders,
  getMyOrderById,
  cancelOrder,
  initiatePayment,
  verifyPayment,
};

