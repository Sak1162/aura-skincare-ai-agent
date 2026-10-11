# Aura Skincare AI Voice Agent

**DataStraw Technologies | AI + Tech Intern Assessment**

- **Live Application:** https://aura-skincare-ai-agent.vercel.app/
- **GitHub Repository:** https://github.com/Sak1162/aura-skincare-ai-agent
- **Backend:** https://aura-skincare-ai-agent.onrender.com/

## 1. Project Overview

Aura Skincare AI Voice Agent is a browser-based customer support assistant featuring **Aria**, an AI support specialist. It supports real-time voice conversations, order lookup, skincare support policies, interruption handling, and structured post-call summaries.

### Key Features

- Real-time, two-way voice interaction using Google Gemini Live and WebSockets.
- Order lookup through the `get_order_details` function.
- Support for shipping, returns, cancellation, and Cash on Delivery policies.
- Readable chronological transcripts.
- Interruption handling that stops Aria's audio when the customer speaks.
- Structured post-call summaries covering customer intents, products, orders, policies, actions, unresolved questions, and resolution status.
- Sample order previews for assessment scenarios.

## 2. Architecture

The application uses a React frontend and a Node.js backend. The browser captures microphone audio and sends it to the backend over a WebSocket connection. The backend communicates with Gemini Live, handles order lookup function calls, and streams audio and conversation events back to the browser.

When a call ends, the frontend sends the transcript and tool history to the backend summary endpoint. The backend generates a structured post-call outcome and provides a fallback if summary generation fails.

### Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, CSS |
| Audio processing | Web Audio API, PCM audio |
| Backend | Node.js, Express, WebSockets |
| AI integration | Google Gemini API, `@google/genai` |
| Testing | Node.js native test runner |

## 3. Setup and Run Locally

### Prerequisites

- Node.js and npm
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### Configure environment variables

Create `server/.env` using `server/.env.example` and set:

```env
GEMINI_API_KEY=your_gemini_api_key
PORT=5000
CLIENT_URL=http://localhost:5173
```

If needed, create `client/.env` using `client/.env.example`:

```env
VITE_WS_URL=ws://localhost:5000/ws
VITE_API_URL=http://localhost:5000
```

Never commit real API keys or `.env` files.

### Install dependencies

From the repository root, run:

```bash
cd server
npm install

cd ../client
npm install
```

### Run automated tests

```bash
cd server
npm test
```

### Start the application

Start the backend in one terminal:

```bash
cd server
npm start
```

Start the frontend in another terminal:

```bash
cd client
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## 4. Sample Orders and Assessment Scenarios

The application includes these sample orders:

| Order ID | Customer | Product | Value | Status | Carrier / Tracking |
|---|---|---|---:|---|---|
| `ORD-101` | Priya Sharma | Vitamin C Serum (30ml) | ₹699 | Out for Delivery | BlueDart, `BD-982103` |
| `ORD-102` | Rahul Verma | Hydrating Sunscreen SPF 50 | ₹499 | Delivered | Delhivery, `DL-441029` |
| `ORD-103` | Ananya Patel | Green Tea Face Wash + Toner | ₹850 | Processing | Not applicable |

### Manual Test Scenarios

| Scenario | Expected behavior |
|---|---|
| Track `ORD-101` | Retrieve the order and explain its status, carrier, and delivery estimate. |
| Cancel `ORD-101` | Explain that cancellation is unavailable at the Out for Delivery stage and that the customer may refuse delivery at the doorstep. |
| Cancel `ORD-103` | Explain that the order is eligible for cancellation while Processing. Claim completion only if the backend executes and verifies the cancellation. |
| Return an opened product purchased 20 days ago | Explain the 7-day return window and unopened/original-packaging requirements. |
| Ask about an invalid order such as `ORD-999` | Explain that the order was not found and ask the customer to verify the order ID. |
| Ask for an unrelated task | Politely redirect the customer to Aura Skincare support topics. |
| Interrupt Aria while speaking | Stop queued audio and allow the customer to speak. |
| End a call | Display the transcript and structured post-call summary. |

## 5. Mandatory Assessment Questions

### Question 1: Why did you choose this architecture and technology stack?

The project requires a real-time voice agent that can retrieve order information and produce a structured outcome.

- **WebSockets** provide a persistent, bidirectional connection suitable for streaming audio.
- **Node.js and Express** handle the Gemini session, order lookup, and summary endpoint. Keeping Gemini credentials on the server avoids exposing the API key in the browser.
- **Gemini Live** supports real-time voice interaction and function calling. A separate summary step generates structured post-call results without interrupting the live conversation.
- **React and CSS** provide control over the call interface, live transcript, status indicators, and responsive design.

### Question 2: What was the most difficult part of the assignment, and how did you solve it?

The main challenge was keeping the live transcript readable while handling streamed audio and interruptions.

Speech transcription can arrive in small fragments, cumulative updates, or overlapping text. Appending every event separately can split one spoken sentence into many bubbles or duplicate words. I implemented a transcript accumulator that combines fragments from the same speaker, handles cumulative updates and word overlap, and preserves speaker-turn order.

For interruptions, the application tracks scheduled audio playback. When an interruption event arrives, it stops active audio sources and clears the playback queue so Aria can listen to the customer.

### Question 3: If you had one more week, what would you improve first and why?

I would prioritize the following improvements:

1. **Audio processing:** Migrate from `ScriptProcessorNode` to `AudioWorkletNode` to reduce the risk of audio glitches during heavy UI activity.
2. **Conversation persistence and analytics:** Store transcripts and summaries and measure latency, interruptions, tool execution time, and failures.
3. **Order updates:** Persist cancellation changes and send confirmations only after the backend successfully updates an order.
4. **End-to-end testing:** Automate browser tests for microphone access, voice interactions, function calls, and post-call results.

### Question 4: What would need to change to support 1,000 customer conversations a day?

I would prepare the system for variable traffic and concurrent voice sessions through these changes:

1. **Horizontal scaling:** Deploy multiple backend instances behind a load balancer and ensure active WebSocket sessions remain connected to the appropriate instance.
2. **Gemini quotas and failures:** Monitor rate and concurrency limits, use retry/backoff where appropriate, and provide a fallback when the live service is unavailable.
3. **Audio optimization:** Evaluate compressed audio transport, such as Opus over WebRTC, to reduce bandwidth and improve performance on weaker networks.
4. **Monitoring:** Track connection failures, response latency, tool execution time, audio playback issues, and error rates.

Actual capacity should be validated through load testing and the applicable Gemini API quotas before making production capacity claims.

## 6. Deployment

- **Frontend:** https://aura-skincare-ai-agent.vercel.app/
- **Backend:** https://aura-skincare-ai-agent.onrender.com/

The deployed frontend connects to the backend through its configured HTTP API and secure WebSocket endpoint.
