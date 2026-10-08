const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");
require("dotenv").config();

const { getOrderDetails } = require("./services/orderService");

const PORT = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());

/* -----------------------------
   Basic API
----------------------------- */

app.get("/", (req, res) => {
  res.json({
    message: "Aura Skincare AI Voice Agent API",
    status: "running",
  });
});

/* -----------------------------
   Order Lookup API
----------------------------- */

app.get("/api/orders/:orderId", (req, res) => {
  const result = getOrderDetails(req.params.orderId);

  if (!result.found) {
    return res.status(404).json(result);
  }

  res.json(result);
});

/* -----------------------------
   Start Server
----------------------------- */

async function startServer() {
  const {
    GoogleGenAI,
    Modality,
    Type,
  } = await import("@google/genai");

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing from .env");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const httpServer = http.createServer(app);

  /* -----------------------------
     Browser WebSocket
  ----------------------------- */

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
  });

  wss.on("connection", async (browserSocket) => {
    console.log("Browser connected to voice agent");

    let geminiSession = null;

    try {
      /* -----------------------------
         Tools
      ----------------------------- */

      const tools = [
        {
          functionDeclarations: [
            {
              name: "get_order_details",

              description:
                "Retrieve Aura Skincare order information using the customer's order ID.",

              parameters: {
                type: Type.OBJECT,

                properties: {
                  order_id: {
                    type: Type.STRING,

                    description:
                      "The Aura Skincare order ID, for example ORD-101.",
                  },
                },

                required: ["order_id"],
              },
            },
          ],
        },
      ];

      /* -----------------------------
         Aria System Instruction
      ----------------------------- */

  const systemInstruction = `
You are Aria.

You work as a customer support representative for Aura Skincare.

Talk to the customer the way a real young woman would talk to
someone on a normal phone call.

You are calm, friendly, warm and easygoing.

You are NOT an announcer, narrator, receptionist or voice assistant.

You are simply having a conversation with another person.

CONVERSATION STYLE:

Talk normally.

Use short sentences.

Use simple everyday English.

Do not sound formal.

Do not sound scripted.

Do not give long explanations unless the customer asks.

Do not use corporate phrases.

Do not say things like:
"I'd be delighted to assist you."
"Thank you for reaching out."
"I sincerely apologize for the inconvenience."
"How may I assist you today?"

Instead, talk naturally.

For example:

"Yeah, sure."
"Okay, give me a second."
"Got it."
"Yep, I found it."
"Let me check."
"Right."
"Okay, I see what happened."
"Yeah, that's fine."
"One sec."

Use these only when they naturally fit the conversation.

Do not repeat the same phrase again and again.

Do not start every response with "Sure."

Do not force friendliness.

Do not force enthusiasm.

Do not sound cheerful when there is no reason to be cheerful.

Do not over-apologize.

Do not narrate what you are doing.

Do not explain that you are an AI.

Keep the conversation relaxed and natural.

VOICE:

Use one consistent female voice.

Keep the delivery soft, calm and conversational.

Use a comfortable medium pitch.

Keep the energy low to moderate.

Speak clearly.

Use simple pronunciation.

Keep the same pronunciation and vocal character throughout
the conversation.

Do not deliberately imitate an American, British or Indian accent.

Use natural, neutral English pronunciation.

Do not switch accents.

Do not suddenly change pitch or speaking style.

Do not exaggerate emotions.

Do not sound like a commercial.

Do not sound like a customer-service recording.

Do not sound like a TTS demonstration.

INTERRUPTIONS:

If the customer starts speaking while you are speaking,
stop your response and listen.

Do not continue your previous sentence.

Respond naturally to what the customer just said.

Do not mention that you were interrupted.

If the customer pauses, give them a moment.

Do not immediately fill every small silence.

CUSTOMER BEHAVIOUR:

If the customer is casual, be casual.

If the customer is frustrated, become calmer and more reassuring.

If the customer is confused, explain simply.

If the customer is happy, respond naturally without becoming
overly excited.

ORDER INFORMATION:

You have access to Aura Skincare order information through
the get_order_details tool.

When the customer asks about an order:

Ask for the order ID if they have not provided it.

Use get_order_details to look it up.

Only use information returned by the tool.

Never invent order information.

Once you have the result, explain it naturally.

Do NOT read database fields aloud.

For example:

Database:
"status: OUT_FOR_DELIVERY"
"courier: BlueDart"

Say:

"Yep, I found it. It's out for delivery with BlueDart."

POLICIES:

Shipping:
Free delivery above ₹499.
Orders below ₹499 have a ₹50 shipping fee.
Standard delivery takes 3–5 business days.

Returns:
Returns are accepted within 7 days of delivery.
Products must be unopened and unused.
Products must be in their original packaging.
Damaged or defective products must be reported within 48 hours
with photos.

Cancellation:
Orders can only be cancelled while Processing.
Shipped and Out for Delivery orders cannot be cancelled.
Customers may refuse delivery at the doorstep.

COD:
COD is available for orders up to ₹2,500.
Customers can pay by cash or UPI at the doorstep.

Do not promise something that the policy does not allow.

If you don't know something, say you don't know.
Never make something up.

MOST IMPORTANT:

Have a conversation.

Do not perform a customer-support script.

Do not try to sound like an AI assistant.

Talk normally.
`;
      /* -----------------------------
         Gemini Live Session
      ----------------------------- */

      geminiSession = await ai.live.connect({
        model: "gemini-3.8-live",

        config: {
          responseModalities: [Modality.AUDIO],

          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Achernar",
              },
            },
          },

          inputAudioTranscription: {},

          outputAudioTranscription: {},

          systemInstruction,

          tools,
        },

        callbacks: {
          /* -------------------------
             Gemini connected
          ------------------------- */

          onopen: () => {
            console.log("Gemini Live session opened");

            if (browserSocket.readyState === 1) {
              browserSocket.send(
                JSON.stringify({
                  type: "status",
                  state: "connected",
                })
              );
            }
          },

          /* -------------------------
             Gemini messages
          ------------------------- */

          onmessage: async (message) => {
            if (message.serverContent) {
              const serverContent = message.serverContent;

              /* -------------------------
                 Customer transcript
              ------------------------- */

              if (
                serverContent.inputTranscription &&
                serverContent.inputTranscription.text
              ) {
                browserSocket.send(
                  JSON.stringify({
                    type: "transcript",
                    speaker: "customer",
                    text: serverContent.inputTranscription.text,
                  })
                );
              }

              /* -------------------------
                 Aria transcript
              ------------------------- */

              if (
                serverContent.outputTranscription &&
                serverContent.outputTranscription.text
              ) {
                browserSocket.send(
                  JSON.stringify({
                    type: "transcript",
                    speaker: "aria",
                    text: serverContent.outputTranscription.text,
                  })
                );
              }

              /* -------------------------
                 Interruption
              ------------------------- */

              if (serverContent.interrupted) {
                browserSocket.send(
                  JSON.stringify({
                    type: "interrupted",
                  })
                );
              }

              /* -------------------------
                 Model audio
              ------------------------- */

              if (
                serverContent.modelTurn &&
                serverContent.modelTurn.parts
              ) {
                for (const part of serverContent.modelTurn.parts) {
                  if (
                    part.inlineData &&
                    part.inlineData.data
                  ) {
                    browserSocket.send(
                      JSON.stringify({
                        type: "audio",
                        data: part.inlineData.data,
                      })
                    );
                  }
                }
              }

              /* -------------------------
                 Turn completed
              ------------------------- */

              if (serverContent.turnComplete) {
                browserSocket.send(
                  JSON.stringify({
                    type: "turn_complete",
                  })
                );
              }
            }

            /* -----------------------------
               Function Calling
            ----------------------------- */

            if (message.toolCall) {
              const functionResponses = [];

              for (const functionCall of message.toolCall.functionCalls) {
                console.log(
                  "Tool requested:",
                  functionCall.name,
                  functionCall.args
                );

                if (functionCall.name === "get_order_details") {
                  const orderId =
                    functionCall.args?.order_id;

                  const result =
                    getOrderDetails(orderId);

                  functionResponses.push({
                    id: functionCall.id,

                    name: functionCall.name,

                    response: {
                      result,
                    },
                  });

                  browserSocket.send(
                    JSON.stringify({
                      type: "tool_call",
                      tool: "get_order_details",
                      order_id: orderId,
                    })
                  );
                }
              }

              if (functionResponses.length > 0) {
                geminiSession.sendToolResponse({
                  functionResponses,
                });
              }
            }
          },

          /* -------------------------
             Gemini error
          ------------------------- */

          onerror: (error) => {
            console.error(
              "Gemini Live error:",
              error
            );

            if (browserSocket.readyState === 1) {
              browserSocket.send(
                JSON.stringify({
                  type: "error",
                  message: "Voice AI connection error.",
                })
              );
            }
          },

          /* -------------------------
             Gemini closed
          ------------------------- */

          onclose: (event) => {
            console.log(
              "Gemini Live session closed:",
              event?.reason || "No reason"
            );
          },
        },
      });
    } catch (error) {
      console.error(
        "Failed to start Gemini session:",
        error
      );

      if (browserSocket.readyState === 1) {
        browserSocket.send(
          JSON.stringify({
            type: "error",
            message: error.message,
          })
        );

        browserSocket.close();
      }

      return;
    }

    /* -----------------------------
       Browser → Gemini
    ----------------------------- */

    browserSocket.on("message", async (rawMessage) => {
      try {
        const message =
          JSON.parse(rawMessage.toString());

        if (!geminiSession) {
          return;
        }

        /* -------------------------
           Microphone audio
        ------------------------- */

        if (message.type === "audio") {
          geminiSession.sendRealtimeInput({
            audio: {
              data: message.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        }

        /* -------------------------
           Optional text
        ------------------------- */

        if (message.type === "text") {
          geminiSession.sendRealtimeInput({
            text: message.text,
          });
        }

        /* -------------------------
           End call
        ------------------------- */

        if (message.type === "end") {
          try {
            geminiSession.close();
          } catch (error) {
            console.error(
              "Error closing Gemini session:",
              error
            );
          }

          if (browserSocket.readyState === 1) {
            browserSocket.close();
          }
        }
      } catch (error) {
        console.error(
          "Browser message error:",
          error
        );
      }
    });

    /* -----------------------------
       Browser disconnected
    ----------------------------- */

    browserSocket.on("close", () => {
      console.log("Browser disconnected");

      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (error) {
          console.error(
            "Error closing Gemini session:",
            error
          );
        }
      }
    });
  });

  /* -----------------------------
     Start HTTP server
  ----------------------------- */

  httpServer.listen(PORT, () => {
    console.log(
      `Aura backend running on http://localhost:${PORT}`
    );

    console.log(
      `Voice WebSocket running on ws://localhost:${PORT}/ws`
    );
  });
}

/* -----------------------------
   Server startup
----------------------------- */

startServer().catch((error) => {
  console.error(
    "Server startup failed:",
    error
  );

  process.exit(1);
});