/**
 * Summary Service
 * Generates comprehensive, multi-topic post-call summaries using Gemini with deterministic fallback.
 */

const { getOrderDetails } = require("./orderService");

function sanitizeOrderId(orderId) {
  if (!orderId || typeof orderId !== "string") return null;
  const match = orderId.trim().toUpperCase().match(/ORD-\d+/);
  return match ? match[0] : null;
}

function extractAllOrderIds(text = "", toolCalls = []) {
  const ids = new Set();

  if (Array.isArray(toolCalls)) {
    for (const tool of toolCalls) {
      const sanitized = sanitizeOrderId(tool.order_id);
      if (sanitized) ids.add(sanitized);
    }
  }

  if (typeof text === "string") {
    const matches = text.toUpperCase().match(/ORD-\d+/g);
    if (matches) {
      for (const m of matches) {
        ids.add(m);
      }
    }
  }

  return Array.from(ids);
}

/**
 * Deterministic fallback summary generator that thoroughly inspects
 * all transcript turns, verified order details, and policy discussions.
 */
function generateFallbackSummary(transcript = [], toolCalls = []) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return {
      customer_intents: ["NO_INQUIRY"],
      products_discussed: [],
      policies_discussed: [],
      actions_taken: [],
      unresolved_questions: ["Call ended before customer inquiry or conversation was recorded."],
      resolution_status: "UNRESOLVED",
      call_summary: "Call ended before any customer inquiry or spoken conversation took place.",
      // Legacy compatibility fields
      customer_intent: "NO_INQUIRY",
      order_id: null,
    };
  }

  const fullText = transcript
    .map((m) => `${m.speaker}: ${m.text}`)
    .join(" ")
    .toLowerCase();

  const customerText = transcript
    .filter((m) => m.speaker === "customer")
    .map((m) => m.text)
    .join(" ")
    .toLowerCase();

  const ariaText = transcript
    .filter((m) => m.speaker === "aria")
    .map((m) => m.text)
    .join(" ")
    .toLowerCase();

  // 1. Detect all Customer Intents (prioritizing specific customer actions)
  const intentsSet = new Set();
  if (customerText.includes("cancel") || (fullText.includes("cancel") && !fullText.includes("track"))) {
    intentsSet.add("ORDER_CANCELLATION");
  }
  if (customerText.includes("return") || customerText.includes("refund")) {
    intentsSet.add("RETURN_INQUIRY");
  }
  if (
    customerText.includes("track") ||
    customerText.includes("where is my order") ||
    customerText.includes("where is my") ||
    customerText.includes("status") ||
    (fullText.includes("track") && !intentsSet.has("ORDER_CANCELLATION")) ||
    (fullText.includes("where is my order") && !intentsSet.has("ORDER_CANCELLATION")) ||
    (fullText.includes("out for delivery") && !intentsSet.has("ORDER_CANCELLATION")) ||
    (fullText.includes("delivered") && !intentsSet.has("ORDER_CANCELLATION") && !intentsSet.has("RETURN_INQUIRY"))
  ) {
    intentsSet.add("ORDER_TRACKING");
  }
  if (fullText.includes("cancel") && !intentsSet.has("ORDER_CANCELLATION")) {
    intentsSet.add("ORDER_CANCELLATION");
  }
  if (fullText.includes("return") || fullText.includes("refund")) {
    intentsSet.add("RETURN_INQUIRY");
  }
  if (
    fullText.includes("shipping") ||
    fullText.includes("delivery fee") ||
    fullText.includes("free delivery") ||
    fullText.includes("shipping fee")
  ) {
    intentsSet.add("SHIPPING_POLICY");
  }
  if (fullText.includes("cod") || fullText.includes("cash on delivery")) {
    intentsSet.add("COD_INQUIRY");
  }
  if (
    fullText.includes("serum") ||
    fullText.includes("sunscreen") ||
    fullText.includes("face wash") ||
    fullText.includes("toner") ||
    fullText.includes("product") ||
    fullText.includes("ingredients") ||
    fullText.includes("spf")
  ) {
    intentsSet.add("PRODUCT_INFORMATION");
  }
  if (
    fullText.includes("flight") ||
    fullText.includes("ticket") ||
    fullText.includes("weather") ||
    fullText.includes("pizza") ||
    fullText.includes("hotel")
  ) {
    intentsSet.add("UNSUPPORTED_REQUEST");
  }
  if (intentsSet.size === 0) {
    intentsSet.add("GENERAL_INQUIRY");
  }
  const customerIntents = Array.from(intentsSet);

  // 2. Identify all Order IDs and build Products Discussed
  const orderIds = extractAllOrderIds(fullText, toolCalls);
  const productsDiscussed = [];
  const processedProducts = new Set();
  const actionsTaken = [];
  const unresolvedQuestions = [];
  let policyRejected = false;
  let hasUnsupported = customerIntents.includes("UNSUPPORTED_REQUEST");

  // Process order lookups from tool calls or extracted IDs
  for (const orderId of orderIds) {
    // Check if toolCalls already has resolved order
    let resolvedOrder = null;
    let toolResult = null;

    if (Array.isArray(toolCalls)) {
      const matchTool = toolCalls.find((t) => sanitizeOrderId(t.order_id) === orderId);
      if (matchTool && matchTool.result) {
        toolResult = matchTool.result;
        if (toolResult.found && toolResult.order) {
          resolvedOrder = toolResult.order;
        }
      }
    }

    // If not found in toolCalls, check local orderService
    if (!resolvedOrder) {
      const lookup = getOrderDetails(orderId);
      if (lookup.found && lookup.order) {
        resolvedOrder = lookup.order;
        toolResult = lookup;
      }
    }

    if (resolvedOrder) {
      const productName = resolvedOrder.product || "Aura Skincare Product";
      actionsTaken.push(`Retrieved order details for ${orderId} (${productName}).`);

      let resolution = `Customer provided with current status (${resolvedOrder.status}).`;

      if (resolvedOrder.status === "Out for Delivery") {
        if (fullText.includes("cancel")) {
          policyRejected = true;
          resolution = `Cancellation requested for ${orderId}, but declined as the order is Out for Delivery. Customer advised to refuse delivery at doorstep.`;
          actionsTaken.push(`Advised customer to refuse delivery at doorstep for ${orderId}.`);
        } else {
          resolution = `Customer informed that order is Out for Delivery with ${resolvedOrder.carrier || "courier"}, expected ${resolvedOrder.notes || "today"}.`;
        }
      } else if (resolvedOrder.status === "Delivered") {
        if (fullText.includes("return") || fullText.includes("refund")) {
          policyRejected = true;
          resolution = `Return discussed for ${orderId}. Order was delivered 14 days ago, which exceeds the 7-day return window.`;
        } else {
          resolution = `Customer informed that order was delivered via ${resolvedOrder.carrier || "courier"} (${resolvedOrder.notes || "14 days ago"}).`;
        }
      } else if (resolvedOrder.status === "Processing") {
        if (fullText.includes("cancel")) {
          resolution = `Cancellation requested for order ${orderId}. Order is in Processing status and eligible for cancellation; cancellation request noted.`;
          actionsTaken.push(`Noted cancellation request for Processing order ${orderId}.`);
        } else {
          resolution = `Customer informed that order is Processing and eligible for cancellation.`;
        }
      }

      productsDiscussed.push({
        product_name: productName,
        order_id: resolvedOrder.order_id,
        order_value: resolvedOrder.value || null,
        order_status: resolvedOrder.status,
        carrier: resolvedOrder.carrier || null,
        tracking_number: resolvedOrder.tracking_number || null,
        delivery_estimate: resolvedOrder.notes || null,
        resolution,
      });

      processedProducts.add(productName.toLowerCase());
    } else {
      // Order ID was not found in system (e.g. ORD-104)
      actionsTaken.push(`Looked up order ${orderId} in system; order was not found.`);
      unresolvedQuestions.push(`Order ID ${orderId} not found in system; verification pending customer clarification.`);
      productsDiscussed.push({
        product_name: "Unverified Product",
        order_id: orderId,
        order_value: null,
        order_status: "NOT_FOUND",
        carrier: null,
        tracking_number: null,
        delivery_estimate: null,
        resolution: `Order ID ${orderId} was not found in Aura Skincare records. Customer asked to check order number.`,
      });
    }
  }

  // Check for catalog products mentioned WITHOUT order lookups
  const catalogProducts = [
    { name: "Vitamin C Serum (30ml)", keys: ["vitamin c", "serum"], value: 699 },
    { name: "Hydrating Sunscreen SPF 50", keys: ["sunscreen", "spf"], value: 499 },
    { name: "Green Tea Face Wash + Toner", keys: ["green tea", "face wash", "toner"], value: 850 },
  ];

  for (const cat of catalogProducts) {
    if (!processedProducts.has(cat.name.toLowerCase())) {
      const mentioned = cat.keys.some((k) => fullText.includes(k));
      if (mentioned) {
        productsDiscussed.push({
          product_name: cat.name,
          order_id: null,
          order_value: cat.value,
          order_status: null,
          carrier: null,
          tracking_number: null,
          delivery_estimate: null,
          resolution: "Customer inquired about product information and pricing.",
        });
        processedProducts.add(cat.name.toLowerCase());
      }
    }
  }

  // 3. Policies Discussed
  const policiesDiscussed = [];
  if (customerIntents.includes("RETURN_INQUIRY")) {
    if (fullText.includes("20 days") || fullText.includes("opened")) {
      policyRejected = true;
      policiesDiscussed.push({
        policy_name: "RETURN_POLICY",
        policy_details: "Returns accepted within 7 days of delivery for unopened products in original packaging.",
        outcome: "Return request rejected: Product opened and/or purchased 20 days ago (exceeds 7-day limit).",
      });
      actionsTaken.push("Declined return request for opened product past 7-day policy window.");
    } else {
      policiesDiscussed.push({
        policy_name: "RETURN_POLICY",
        policy_details: "Returns accepted within 7 days of delivery for unopened, unused products in original packaging.",
        outcome: "Aura Skincare return terms explained to customer.",
      });
    }
  }

  if (customerIntents.includes("ORDER_CANCELLATION")) {
    policiesDiscussed.push({
      policy_name: "CANCELLATION_POLICY",
      policy_details: "Orders can only be cancelled while in Processing status. Dispatched and Out for Delivery orders cannot be cancelled in the system, but customers may refuse delivery at doorstep.",
      outcome: policyRejected
        ? "Cancellation declined for order already Out for Delivery; doorstep refusal advised."
        : "Cancellation policy explained; Processing orders eligible for cancellation.",
    });
  }

  if (customerIntents.includes("SHIPPING_POLICY")) {
    policiesDiscussed.push({
      policy_name: "SHIPPING_POLICY",
      policy_details: "Free delivery on orders above ₹499; ₹50 fee applies below ₹499. Standard delivery takes 3–5 business days.",
      outcome: "Shipping rates and estimated delivery window explained.",
    });
    actionsTaken.push("Explained shipping fee thresholds and delivery timelines.");
  }

  if (customerIntents.includes("COD_INQUIRY")) {
    policiesDiscussed.push({
      policy_name: "COD_POLICY",
      policy_details: "Cash on delivery available for orders up to ₹2,500; payable via cash or UPI at doorstep.",
      outcome: "Cash on Delivery limits and payment options explained.",
    });
    actionsTaken.push("Explained COD limit (₹2,500) and doorstep payment options.");
  }

  if (customerIntents.includes("UNSUPPORTED_REQUEST")) {
    unresolvedQuestions.push("Customer requested an unsupported service outside Aura Skincare.");
    actionsTaken.push("Politely redirected customer that non-skincare requests are out of scope.");
  }

  // 4. Resolution Status
  let resolutionStatus = "RESOLVED";
  const hasValidResolvedProducts = productsDiscussed.some(
    (p) => p.order_status && p.order_status !== "NOT_FOUND"
  );

  if (hasUnsupported && customerIntents.length === 1) {
    resolutionStatus = "UNSUPPORTED";
  } else if (policyRejected) {
    resolutionStatus = "POLICY_REJECTED";
  } else if (unresolvedQuestions.length > 0 && hasValidResolvedProducts) {
    resolutionStatus = "PARTIALLY_RESOLVED";
  } else if (unresolvedQuestions.length > 0) {
    resolutionStatus = "UNRESOLVED";
  }

  // 5. Rich Multi-Sentence Summary Narrative
  const summaryParts = [];
  summaryParts.push(`Customer contacted support regarding ${customerIntents.map((i) => i.replace(/_/g, " ").toLowerCase()).join(" and ")}.`);

  if (productsDiscussed.length > 0) {
    const productSummaries = productsDiscussed.map((p) => {
      if (p.order_id && p.order_status !== "NOT_FOUND") {
        return `${p.product_name} (${p.order_id}: ${p.order_status}${p.carrier ? `, via ${p.carrier}` : ""}${p.delivery_estimate ? `, ${p.delivery_estimate}` : ""})`;
      }
      if (p.order_id && p.order_status === "NOT_FOUND") {
        return `Order ID ${p.order_id} (not found in database)`;
      }
      return `${p.product_name}`;
    });
    summaryParts.push(`Products and orders covered: ${productSummaries.join("; ")}.`);
  }

  if (policiesDiscussed.length > 0) {
    const policyOutcomes = policiesDiscussed.map((pol) => pol.outcome).join(" ");
    summaryParts.push(policyOutcomes);
  }

  if (unresolvedQuestions.length > 0) {
    summaryParts.push(`Open items: ${unresolvedQuestions.join("; ")}.`);
  }

  const callSummary = summaryParts.join(" ");

  // Primary order ID for legacy compatibility
  const primaryOrderId = productsDiscussed.find((p) => p.order_id && p.order_status !== "NOT_FOUND")?.order_id || (orderIds[0] || null);

  return {
    customer_intents: customerIntents,
    products_discussed: productsDiscussed,
    policies_discussed: policiesDiscussed,
    actions_taken: actionsTaken,
    unresolved_questions: unresolvedQuestions,
    resolution_status: resolutionStatus,
    call_summary: callSummary,
    // Legacy compatibility fields
    customer_intent: customerIntents[0] || "GENERAL_INQUIRY",
    order_id: primaryOrderId,
  };
}

/**
 * Validates and normalizes structured outcome object
 */
function validateStructuredOutcome(parsed, fallback) {
  if (!parsed || typeof parsed !== "object") return fallback;

  // 1. Customer Intents
  let customerIntents = [];
  if (Array.isArray(parsed.customer_intents) && parsed.customer_intents.length > 0) {
    customerIntents = parsed.customer_intents.map((i) =>
      typeof i === "string" ? i.trim().toUpperCase().replace(/[^A-Z_]/g, "_") : "GENERAL_INQUIRY"
    );
  } else if (typeof parsed.customer_intent === "string") {
    customerIntents = [parsed.customer_intent.trim().toUpperCase().replace(/[^A-Z_]/g, "_")];
  } else {
    customerIntents = fallback.customer_intents || ["GENERAL_INQUIRY"];
  }

  // 2. Products Discussed
  let productsDiscussed = [];
  if (Array.isArray(parsed.products_discussed)) {
    productsDiscussed = parsed.products_discussed.map((p) => ({
      product_name: typeof p.product_name === "string" ? p.product_name.trim() : "Unknown Product",
      order_id: sanitizeOrderId(p.order_id) || (typeof p.order_id === "string" && p.order_id.trim() ? p.order_id.trim() : null),
      order_value: typeof p.order_value === "number" ? p.order_value : null,
      order_status: typeof p.order_status === "string" ? p.order_status.trim() : null,
      carrier: typeof p.carrier === "string" ? p.carrier.trim() : null,
      tracking_number: typeof p.tracking_number === "string" ? p.tracking_number.trim() : null,
      delivery_estimate: typeof p.delivery_estimate === "string" ? p.delivery_estimate.trim() : null,
      resolution: typeof p.resolution === "string" ? p.resolution.trim() : "Discussed with customer.",
    }));
  } else if (fallback.products_discussed && fallback.products_discussed.length > 0) {
    productsDiscussed = fallback.products_discussed;
  }

  // 3. Policies Discussed
  let policiesDiscussed = [];
  if (Array.isArray(parsed.policies_discussed)) {
    policiesDiscussed = parsed.policies_discussed.map((pol) => {
      if (typeof pol === "string") {
        return {
          policy_name: "GENERAL_POLICY",
          policy_details: pol,
          outcome: pol,
        };
      }
      return {
        policy_name: typeof pol.policy_name === "string" ? pol.policy_name.trim() : "AURA_POLICY",
        policy_details: typeof pol.policy_details === "string" ? pol.policy_details.trim() : "",
        outcome: typeof pol.outcome === "string" ? pol.outcome.trim() : "",
      };
    });
  } else {
    policiesDiscussed = fallback.policies_discussed || [];
  }

  // 4. Actions Taken
  let actionsTaken = [];
  if (Array.isArray(parsed.actions_taken)) {
    actionsTaken = parsed.actions_taken.filter((a) => typeof a === "string" && a.trim().length > 0);
  } else {
    actionsTaken = fallback.actions_taken || [];
  }

  // 5. Unresolved Questions
  let unresolvedQuestions = [];
  if (Array.isArray(parsed.unresolved_questions)) {
    unresolvedQuestions = parsed.unresolved_questions.filter((q) => typeof q === "string" && q.trim().length > 0);
  } else {
    unresolvedQuestions = fallback.unresolved_questions || [];
  }

  // 6. Resolution Status
  const validResolutions = [
    "RESOLVED",
    "PARTIALLY_RESOLVED",
    "UNRESOLVED",
    "POLICY_REJECTED",
    "CANCELLED_SUCCESSFULLY",
    "UNSUPPORTED",
  ];
  let resolutionStatus =
    typeof parsed.resolution_status === "string"
      ? parsed.resolution_status.trim().toUpperCase()
      : fallback.resolution_status;
  if (!validResolutions.includes(resolutionStatus)) {
    resolutionStatus = fallback.resolution_status;
  }

  // 7. Call Summary Narrative
  const callSummary =
    typeof parsed.call_summary === "string" && parsed.call_summary.trim().length > 15
      ? parsed.call_summary.trim()
      : fallback.call_summary;

  // Legacy primary fields
  const primaryOrderId =
    productsDiscussed.find((p) => p.order_id && p.order_status !== "NOT_FOUND")?.order_id ||
    fallback.order_id ||
    null;

  return {
    customer_intents: customerIntents,
    products_discussed: productsDiscussed,
    policies_discussed: policiesDiscussed,
    actions_taken: actionsTaken,
    unresolved_questions: unresolvedQuestions,
    resolution_status: resolutionStatus,
    call_summary: callSummary,
    // Legacy compatibility fields
    customer_intent: customerIntents[0] || "GENERAL_INQUIRY",
    order_id: primaryOrderId,
  };
}

/**
 * Generates structured call summary using Gemini with timeout race and fallback.
 */
async function generateCallSummary({ transcript = [], toolCalls = [], aiInstance = null }) {
  const fallback = generateFallbackSummary(transcript, toolCalls);

  if (!Array.isArray(transcript) || transcript.length === 0) {
    return fallback;
  }

  const conversationText = transcript
    .map((msg) => `${msg.speaker === "aria" ? "Aria (Agent)" : "Customer"}: ${msg.text}`)
    .join("\n");

  const toolDetails =
    Array.isArray(toolCalls) && toolCalls.length > 0
      ? `\nTools invoked during call:\n${JSON.stringify(toolCalls, null, 2)}`
      : "\nNo tools were invoked during call.";

  try {
    let ai = aiInstance;
    if (!ai) {
      const { GoogleGenAI } = await import("@google/genai");
      if (!process.env.GEMINI_API_KEY) {
        return fallback;
      }
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }

    const prompt = `You are a quality assurance auditor for Aura Skincare customer support calls.
Analyze the following entire phone conversation between a Customer and Aria (Aura Skincare customer support agent).

Conversation Transcript:
${conversationText}
${toolDetails}

AURA SKINCARE BUSINESS POLICIES:
- Shipping: Free delivery on orders above ₹499; ₹50 shipping fee below ₹499. Standard delivery takes 3–5 business days.
- Returns: Returns accepted within 7 days of delivery only. Products must be unopened, unused, and in original packaging. Damaged/defective items must be reported within 48 hours with photos.
- Cancellations: Allowed ONLY while an order is in 'Processing' status. Shipped or Out for Delivery orders CANNOT be cancelled in the system (customers may refuse delivery at doorstep).
- Cash on Delivery (COD): Available for orders up to ₹2,500; payable by cash or UPI at doorstep.

CRITICAL INSTRUCTIONS:
1. Cover EVERY product and EVERY order mentioned during the call, not just the final message or last order.
2. For each product discussed, capture its verified order status, price, courier, tracking number, and delivery estimate when available from the conversation or tool results.
3. If an order ID was not found in the database (e.g. ORD-104), mark order_status as "NOT_FOUND" and note in unresolved_questions that order verification is pending.
4. Distinguish between actions requested, actions eligible, and actions actually completed. Never mark a cancellation as completed merely because a customer requested it.
5. If an action violated policy (e.g. return for an opened product past 7 days, or cancellation of an Out for Delivery order) and was declined, set resolution_status to "POLICY_REJECTED".
6. If customer asked about out-of-scope tasks (e.g. flight booking, weather), set resolution_status to "UNSUPPORTED" (or "PARTIALLY_RESOLVED" if skincare questions were also addressed).
7. If all inquiries were successfully answered according to policy, set resolution_status to "RESOLVED".
8. Write a concise but comprehensive narrative 'call_summary' covering ALL important topics discussed.

Respond ONLY with a valid JSON object matching this schema:
{
  "customer_intents": ["ORDER_TRACKING", "ORDER_CANCELLATION", "RETURN_INQUIRY", "SHIPPING_POLICY", "COD_INQUIRY", "PRODUCT_INFORMATION", "UNSUPPORTED_REQUEST"],
  "products_discussed": [
    {
      "product_name": "Product Name",
      "order_id": "ORD-101" or null,
      "order_value": 699 or null,
      "order_status": "Out for Delivery" or null,
      "carrier": "BlueDart" or null,
      "tracking_number": "BD-982103" or null,
      "delivery_estimate": "Expected by 6 PM today" or null,
      "resolution": "Specific resolution or explanation provided for this product/order"
    }
  ],
  "policies_discussed": [
    {
      "policy_name": "CANCELLATION_POLICY" or "RETURN_POLICY" or "SHIPPING_POLICY" or "COD_POLICY",
      "policy_details": "Brief summary of the applicable policy rule",
      "outcome": "How the policy was applied in this conversation"
    }
  ],
  "actions_taken": [
    "Specific action taken or explanation provided"
  ],
  "unresolved_questions": [
    "Any question left unresolved or pending clarification (empty array if none)"
  ],
  "resolution_status": "RESOLVED" | "PARTIALLY_RESOLVED" | "POLICY_REJECTED" | "UNRESOLVED" | "UNSUPPORTED",
  "call_summary": "Comprehensive narrative summarizing all products, orders, policies, and resolutions discussed."
}`;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Gemini API call timed out after 15s")), 15000)
    );

    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      }),
      timeoutPromise,
    ]);

    const responseText = response?.text || "";
    const cleanJson = responseText.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return validateStructuredOutcome(parsed, fallback);
  } catch (error) {
    console.error("Gemini summary generation failed, using fallback:", error.message);
    return fallback;
  }
}

module.exports = {
  generateCallSummary,
  generateFallbackSummary,
  validateStructuredOutcome,
  sanitizeOrderId,
  extractAllOrderIds,
};
