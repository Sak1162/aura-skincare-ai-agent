const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();

const { getOrderDetails } = require("../services/orderService");
const {
  generateFallbackSummary,
  validateStructuredOutcome,
  sanitizeOrderId,
  generateCallSummary,
} = require("../services/summaryService");

test("Order Service - Retrieves ORD-101 (Out for Delivery)", () => {
  const result = getOrderDetails("ORD-101");
  assert.equal(result.found, true);
  assert.equal(result.order.customer, "Priya Sharma");
  assert.equal(result.order.status, "Out for Delivery");
  assert.equal(result.order.carrier, "BlueDart");
  assert.equal(result.order.tracking_number, "BD-982103");
  assert.equal(result.order.value, 699);
});

test("Order Service - Case-insensitive and whitespace handling", () => {
  const result = getOrderDetails("  ord-102  ");
  assert.equal(result.found, true);
  assert.equal(result.order.customer, "Rahul Verma");
  assert.equal(result.order.status, "Delivered");
  assert.equal(result.order.tracking_number, "DL-441029");
});

test("Order Service - Retrieves ORD-103 (Processing / Cancellable)", () => {
  const result = getOrderDetails("ORD-103");
  assert.equal(result.found, true);
  assert.equal(result.order.status, "Processing");
  assert.equal(result.order.value, 850);
});

test("Order Service - Graceful handling of invalid or missing IDs", () => {
  const notFound = getOrderDetails("ORD-999");
  assert.equal(notFound.found, false);
  assert.match(notFound.message, /No order was found/);

  const empty = getOrderDetails("");
  assert.equal(empty.found, false);

  const nil = getOrderDetails(null);
  assert.equal(nil.found, false);
});

test("Summary Service - sanitizeOrderId extracts valid order IDs", () => {
  assert.equal(sanitizeOrderId("ORD-101"), "ORD-101");
  assert.equal(sanitizeOrderId("ord-102"), "ORD-102");
  assert.equal(sanitizeOrderId("Check ORD-103 please"), "ORD-103");
  assert.equal(sanitizeOrderId(null), null);
  assert.equal(sanitizeOrderId("INVALID"), null);
});

test("Summary Service - Fallback generator for ORD-101 tracking", () => {
  const transcript = [
    { speaker: "customer", text: "Where is my order ORD-101?" },
    { speaker: "aria", text: "It is out for delivery with BlueDart and expected by 6 PM today." },
  ];
  const summary = generateFallbackSummary(transcript, [{ tool: "get_order_details", order_id: "ORD-101" }]);
  assert.equal(summary.customer_intent, "ORDER_TRACKING");
  assert.equal(summary.order_id, "ORD-101");
  assert.equal(summary.resolution_status, "RESOLVED");
  assert.match(summary.call_summary, /BlueDart/);
});

test("Summary Service - Fallback generator for cancellation of out-of-delivery order", () => {
  const transcript = [
    { speaker: "customer", text: "I want to cancel order ORD-101." },
    { speaker: "aria", text: "I cannot cancel it because it is out for delivery, but you can refuse it at the door." },
  ];
  const summary = generateFallbackSummary(transcript, [{ tool: "get_order_details", order_id: "ORD-101" }]);
  assert.equal(summary.customer_intent, "ORDER_CANCELLATION");
  assert.equal(summary.order_id, "ORD-101");
  assert.equal(summary.resolution_status, "POLICY_REJECTED");
});

test("Summary Service - Fallback generator for 20-day return policy rejection", () => {
  const transcript = [
    { speaker: "customer", text: "Can I return an opened serum I bought 20 days ago?" },
    { speaker: "aria", text: "I'm sorry, returns are only accepted within 7 days and products must be unopened." },
  ];
  const summary = generateFallbackSummary(transcript, []);
  assert.equal(summary.customer_intent, "RETURN_INQUIRY");
  assert.equal(summary.order_id, null);
  assert.equal(summary.resolution_status, "POLICY_REJECTED");
});

test("Summary Service - Live Gemini call summary test", async (t) => {
  if (!process.env.GEMINI_API_KEY) {
    t.skip("GEMINI_API_KEY not set; skipping live model call");
    return;
  }

  const transcript = [
    { speaker: "customer", text: "Hi, can you tell me where my order ORD-101 is?" },
    { speaker: "aria", text: "Sure! I checked and it's out for delivery with BlueDart, arriving by 6 PM today." },
  ];
  const toolCalls = [
    {
      tool: "get_order_details",
      order_id: "ORD-101",
      result: {
        found: true,
        order: {
          customer: "Priya Sharma",
          status: "Out for Delivery",
          carrier: "BlueDart",
          tracking_number: "BD-982103",
          notes: "Expected by 6 PM today",
        },
      },
    },
  ];

  const summary = await generateCallSummary({ transcript, toolCalls });
  assert.ok(summary);
  assert.equal(summary.order_id, "ORD-101");
  assert.equal(summary.customer_intent, "ORDER_TRACKING");
  assert.equal(summary.resolution_status, "RESOLVED");
  assert.ok(summary.call_summary.length > 10);
});
