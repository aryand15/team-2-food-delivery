export const validateOrderPayload = (payload = {}) => {
  const { clientOrderId, item, quantity } = payload;

  const missingQuantity = quantity === undefined || quantity === null;
  if (!clientOrderId || !item || missingQuantity) {
    return {
      valid: false,
      error: "Missing required fields: clientOrderId, item, quantity"
    };
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return {
      valid: false,
      error: "Quantity must be a positive number"
    };
  }

  return { valid: true };
};

export const buildOrderData = (payload, createdAt = new Date().toISOString()) => {
  const { clientOrderId, item, quantity, customer } = payload;
  return {
    clientOrderId,
    item,
    quantity,
    customer: customer || null,
    status: "queued",
    createdAt,
    attemptCount: 0
  };
};
