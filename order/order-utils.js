export const validateOrderPayload = (payload = {}) => {
  const { 
    clientOrderId, 
    restaurantId,
    items
  } = payload;

  if (!clientOrderId || !restaurantId || !items) {
    return {
      valid: false,
      error: "Missing required fields: clientOrderId, restaurantId, items"
    };
  }

  if (typeof clientOrderId !== "string" || typeof restaurantId !== "string") {
    return {
      valid: false,
      error: "clientOrderId and restaurantId must be strings"
    };
  }

  if (!Array.isArray(items) || items.length == 0) {
    return {
      valid: false,
      error: "Items must be a non-empty array"
    };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        valid: false,
        error: `Item ${i}: each item must be an object with menuItemId and quantity`
      };
    }

    const { menuItemId, quantity } = item;

    if (!menuItemId || typeof menuItemId != "string") {
      return {
        valid: false,
        error: `Item ${i}: menuItemId is required and must be a string`
      };
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        valid: false,
        error: `Item ${i}: quantity must be a positive integer`
      };
    }
  }

  return { valid: true };
};
