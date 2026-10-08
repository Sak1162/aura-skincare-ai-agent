const orders = require("../data/orders.json");

function getOrderDetails(orderId) {
  const normalizedId = orderId?.trim().toUpperCase();

  const order = orders.find(
    (order) => order.order_id === normalizedId
  );

  if (!order) {
    return {
      found: false,
      message: `No order was found with ID ${normalizedId}.`
    };
  }

  return {
    found: true,
    order
  };
}

module.exports = {
  getOrderDetails
};