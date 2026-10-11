const test = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config();

const {
  generateCallSummary,
  generateFallbackSummary,
  validateStructuredOutcome,
} = require("../services/summaryService");

// Test 1: Call involving ORD-101 only
test("Scenario 1: Call involving ORD-101 only (Out for Delivery)", () => {
  const transcript = [
    { speaker: "customer", text: "Hi, where is my order ORD-101 right now?" },
    { speaker: "aria", text: "I checked it for you. It's out for delivery with BlueDart and expected by 6 PM today." },
    { speaker: "customer", text: "Great, thanks a lot!" },
    { speaker: "aria", text: "You're welcome! Have a great day." },
  ];
  const toolCalls = [
    {
      tool: "get_order_details",
      order_id: "ORD-101",
      result: {
        found: true,
        order: {
          order_id: "ORD-101",
          customer: "Priya Sharma",
          product: "Vitamin C Serum (30ml)",
          value: 699,
          status: "Out for Delivery",
          carrier: "BlueDart",
          tracking_number: "BD-982103",
          notes: "Expected by 6 PM today",
        },
      },
    },
  ];

  const summary = generateFallbackSummary(transcript, toolCalls);
  assert.ok(summary.customer_intents.includes("ORDER_TRACKING"));
  assert.equal(summary.products_discussed.length, 1);
  const p = summary.products_discussed[0];
  assert.equal(p.order_id, "ORD-101");
  assert.equal(p.product_name, "Vitamin C Serum (30ml)");
  assert.equal(p.order_value, 699);
  assert.equal(p.order_status, "Out for Delivery");
  assert.equal(p.carrier, "BlueDart");
  assert.equal(p.tracking_number, "BD-982103");
  assert.equal(summary.resolution_status, "RESOLVED");
  assert.match(summary.call_summary, /Vitamin C Serum/);
  assert.match(summary.call_summary, /BlueDart/);
});

// Test 2: Call involving ORD-101 and ORD-102
test("Scenario 2: Call involving ORD-101 and ORD-102 (Multiple orders in one call)", () => {
  const transcript = [
    { speaker: "customer", text: "Can you track two orders for me? First is ORD-101." },
    { speaker: "aria", text: "Sure! ORD-101 is out for delivery with BlueDart today." },
    { speaker: "customer", text: "And what about ORD-102?" },
    { speaker: "aria", text: "ORD-102 for the Hydrating Sunscreen was delivered 14 days ago via Delhivery." },
  ];
  const toolCalls = [
    {
      tool: "get_order_details",
      order_id: "ORD-101",
      result: {
        found: true,
        order: {
          order_id: "ORD-101",
          product: "Vitamin C Serum (30ml)",
          value: 699,
          status: "Out for Delivery",
          carrier: "BlueDart",
          tracking_number: "BD-982103",
          notes: "Expected by 6 PM today",
        },
      },
    },
    {
      tool: "get_order_details",
      order_id: "ORD-102",
      result: {
        found: true,
        order: {
          order_id: "ORD-102",
          product: "Hydrating Sunscreen SPF 50",
          value: 499,
          status: "Delivered",
          carrier: "Delhivery",
          tracking_number: "DL-441029",
          notes: "Delivered 14 days ago",
        },
      },
    },
  ];

  const summary = generateFallbackSummary(transcript, toolCalls);
  assert.ok(summary.customer_intents.includes("ORDER_TRACKING"));
  assert.equal(summary.products_discussed.length, 2);
  const ids = summary.products_discussed.map((p) => p.order_id);
  assert.ok(ids.includes("ORD-101"));
  assert.ok(ids.includes("ORD-102"));
  assert.equal(summary.resolution_status, "RESOLVED");
  assert.match(summary.call_summary, /ORD-101/);
  assert.match(summary.call_summary, /ORD-102/);
});

// Test 3: Call involving all three assessment orders (ORD-101, ORD-102, ORD-103)
test("Scenario 3: Call involving all three assessment orders", () => {
  const transcript = [
    { speaker: "customer", text: "I have 3 orders: ORD-101, ORD-102, and ORD-103. What is their status?" },
    { speaker: "aria", text: "ORD-101 is out for delivery, ORD-102 was delivered, and ORD-103 is still processing." },
  ];
  const toolCalls = [
    { tool: "get_order_details", order_id: "ORD-101" },
    { tool: "get_order_details", order_id: "ORD-102" },
    { tool: "get_order_details", order_id: "ORD-103" },
  ];

  const summary = generateFallbackSummary(transcript, toolCalls);
  assert.equal(summary.products_discussed.length, 3);
  const names = summary.products_discussed.map((p) => p.product_name);
  assert.ok(names.some((n) => n.includes("Vitamin C")));
  assert.ok(names.some((n) => n.includes("Sunscreen")));
  assert.ok(names.some((n) => n.includes("Green Tea")));
  assert.equal(summary.resolution_status, "RESOLVED");
});

// Test 4: Call discussing multiple products without an order lookup
test("Scenario 4: Call discussing multiple products without an order lookup", () => {
  const transcript = [
    { speaker: "customer", text: "Tell me about your Vitamin C Serum and the Hydrating Sunscreen." },
    { speaker: "aria", text: "Our Vitamin C Serum is ₹699 and the Hydrating Sunscreen SPF 50 is ₹499." },
  ];
  const summary = generateFallbackSummary(transcript, []);
  assert.ok(summary.customer_intents.includes("PRODUCT_INFORMATION"));
  assert.equal(summary.products_discussed.length, 2);
  for (const p of summary.products_discussed) {
    assert.equal(p.order_id, null);
    assert.ok(p.order_value > 0);
  }
  assert.equal(summary.resolution_status, "RESOLVED");
});

// Test 5: Return-policy rejection involving an opened product purchased 20 days ago
test("Scenario 5: Return policy rejection for opened product purchased 20 days ago", () => {
  const transcript = [
    { speaker: "customer", text: "I bought a serum 20 days ago and opened it. Can I return it for a refund?" },
    { speaker: "aria", text: "I'm sorry, returns are only accepted within 7 days of delivery and products must be unopened." },
  ];
  const summary = generateFallbackSummary(transcript, []);
  assert.ok(summary.customer_intents.includes("RETURN_INQUIRY"));
  assert.equal(summary.resolution_status, "POLICY_REJECTED");
  assert.ok(summary.policies_discussed.some((pol) => pol.policy_name === "RETURN_POLICY"));
  assert.match(summary.call_summary, /rejected/i);
});

// Test 6: Invalid order ID such as ORD-104
test("Scenario 6: Invalid order ID such as ORD-104", () => {
  const transcript = [
    { speaker: "customer", text: "Please track my order ORD-104." },
    { speaker: "aria", text: "I checked our system, but no order was found with ID ORD-104. Could you double-check your order number?" },
  ];
  const toolCalls = [
    {
      tool: "get_order_details",
      order_id: "ORD-104",
      result: { found: false, message: "No order was found with ID ORD-104." },
    },
  ];

  const summary = generateFallbackSummary(transcript, toolCalls);
  assert.ok(summary.products_discussed.some((p) => p.order_id === "ORD-104" && p.order_status === "NOT_FOUND"));
  assert.ok(summary.unresolved_questions.length > 0);
  assert.ok(summary.actions_taken.some((a) => a.includes("ORD-104")));
  assert.equal(summary.resolution_status, "UNRESOLVED");
});

// Test 7: Conversation where cancellation was requested but not actually executed
test("Scenario 7: Cancellation requested for Processing order ORD-103 but pending execution", () => {
  const transcript = [
    { speaker: "customer", text: "I want to cancel order ORD-103." },
    { speaker: "aria", text: "Your order ORD-103 is currently processing, so it is eligible for cancellation. I have noted your cancellation request." },
  ];
  const toolCalls = [
    {
      tool: "get_order_details",
      order_id: "ORD-103",
      result: {
        found: true,
        order: {
          order_id: "ORD-103",
          product: "Green Tea Face Wash + Toner",
          status: "Processing",
          value: 850,
          notes: "Ordered 3 hours ago. Eligible for cancellation",
        },
      },
    },
  ];

  const summary = generateFallbackSummary(transcript, toolCalls);
  assert.ok(summary.customer_intents.includes("ORDER_CANCELLATION"));
  const p = summary.products_discussed.find((item) => item.order_id === "ORD-103");
  assert.ok(p);
  // Verify action notes it was requested / eligible rather than claiming executed
  assert.ok(summary.actions_taken.some((a) => a.toLowerCase().includes("cancellation request")));
  assert.notEqual(summary.resolution_status, "CANCELLED_SUCCESSFULLY");
});

// Test 8: Empty or interrupted call
test("Scenario 8: Empty or interrupted call", () => {
  const summaryEmpty = generateFallbackSummary([], []);
  assert.equal(summaryEmpty.customer_intents[0], "NO_INQUIRY");
  assert.equal(summaryEmpty.resolution_status, "UNRESOLVED");
  assert.equal(summaryEmpty.products_discussed.length, 0);

  const summaryInterrupted = generateFallbackSummary(
    [{ speaker: "customer", text: "Hello?" }],
    []
  );
  assert.ok(summaryInterrupted.call_summary.length > 10);
});

// Test 9: Gemini summary failure and fallback behavior
test("Scenario 9: Gemini summary failure triggers fallback seamlessly", async () => {
  const transcript = [
    { speaker: "customer", text: "Where is my order ORD-101?" },
    { speaker: "aria", text: "It is out for delivery with BlueDart." },
  ];
  const toolCalls = [{ tool: "get_order_details", order_id: "ORD-101" }];

  // Mock aiInstance that throws an error
  const mockAiFailing = {
    models: {
      generateContent: async () => {
        throw new Error("Simulated 503 Service Unavailable");
      },
    },
  };

  const summary = await generateCallSummary({
    transcript,
    toolCalls,
    aiInstance: mockAiFailing,
  });

  assert.ok(summary);
  assert.ok(summary.customer_intents.includes("ORDER_TRACKING"));
  assert.ok(summary.products_discussed.some((p) => p.order_id === "ORD-101"));
  assert.equal(summary.resolution_status, "RESOLVED");
  assert.match(summary.call_summary, /ORD-101/);
});

// Test 10: Correct transcript retention and JSON validation
test("Scenario 10: Correct transcript retention and JSON validation", () => {
  const rawModelJson = {
    customer_intents: ["ORDER_TRACKING", "SHIPPING_POLICY"],
    products_discussed: [
      {
        product_name: "Vitamin C Serum (30ml)",
        order_id: "ORD-101",
        order_value: 699,
        order_status: "Out for Delivery",
        carrier: "BlueDart",
        tracking_number: "BD-982103",
        delivery_estimate: "Expected by 6 PM today",
        resolution: "Customer informed of delivery window",
      },
    ],
    policies_discussed: [
      {
        policy_name: "SHIPPING_POLICY",
        policy_details: "Free shipping over ₹499",
        outcome: "Explained free shipping threshold",
      },
    ],
    actions_taken: ["Retrieved tracking information for ORD-101"],
    unresolved_questions: [],
    resolution_status: "RESOLVED",
    call_summary: "Customer tracked order ORD-101 and confirmed shipping details.",
  };

  const fallback = generateFallbackSummary([], []);
  const validated = validateStructuredOutcome(rawModelJson, fallback);

  assert.deepEqual(validated.customer_intents, ["ORDER_TRACKING", "SHIPPING_POLICY"]);
  assert.equal(validated.products_discussed.length, 1);
  assert.equal(validated.products_discussed[0].order_id, "ORD-101");
  assert.equal(validated.policies_discussed.length, 1);
  assert.equal(validated.actions_taken.length, 1);
  assert.equal(validated.unresolved_questions.length, 0);
  assert.equal(validated.resolution_status, "RESOLVED");
  assert.equal(validated.order_id, "ORD-101");
  assert.equal(validated.customer_intent, "ORDER_TRACKING");
});
