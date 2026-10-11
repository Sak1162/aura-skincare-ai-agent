const orders = require("../data/orders.json");

function getOrderDetails(orderId) {
  if (!orderId || typeof orderId !== "string" || !orderId.trim()) {
    return {
      found: false,
      message: "Order ID is missing or invalid. Please provide a valid order ID like ORD-101, ORD-102, or ORD-103.",
    };
  }

  const normalizedId = orderId.trim().toUpperCase();

  const order = orders.find(
    (order) => order.order_id === normalizedId
  );

  if (!order) {
    return {
      found: false,
      message: `No order was found with ID ${normalizedId}. Please check the order number and try again.`,
    };
  }

  return {
    found: true,
    order,
  };
}

function getAllOrders() {
  return orders;
}

module.exports = {
  getOrderDetails,
  getAllOrders,
};