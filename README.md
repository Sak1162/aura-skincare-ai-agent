# Aura Skincare AI Voice Agent

> **DataStraw Technologies AI + Tech Intern Assessment**  
> Developed for **Aura Skincare** Customer Support  
> **Live Application:** [https://aura-skincare-ai-agent.vercel.app/](https://aura-skincare-ai-agent.vercel.app/)  
> **GitHub Repository:** [https://github.com/Sak1162/aura-skincare-ai-agent](https://github.com/Sak1162/aura-skincare-ai-agent)

---

## 1. Project Overview & Main Features

**Aura Skincare AI Voice Agent** is a production-ready, real-time voice customer support application featuring **Aria**, an AI support specialist. Aria communicates naturally with customers over two-way real-time voice, retrieves real order details, strictly enforces business policies, handles interruptions gracefully, and produces a structured post-call assessment summary.

### Key Features
- **Real-Time Voice Streaming:** Powered by Google Gemini Live (`gemini-3.8-live`), streaming low-latency raw PCM audio bi-directionally over WebSockets.
- **Natural Conversation Persona:** Aria speaks warmly, casually, and concisely, avoiding robotic corporate scripts.
- **Tool Calling (`get_order_details`):** Automatically invokes order lookup functions during the live voice conversation to retrieve customer order data.
- **Intelligent Transcript Accumulator:** Smoothly merges streaming partial, delta, and cumulative speech-to-text fragments into clean chronological speaker turns without duplicating text or breaking into tiny speech bubbles.
- **Mandatory Post-Call Summary:** Upon call completion, generates an extensive, structured JSON outcome (`customer_intents`, `products_discussed`, `policies_discussed`, `actions_taken`, `unresolved_questions`, `resolution_status`, `call_summary`) powered by `gemini-3.8-flash` with deterministic offline fallback capable of handling multiple products, multiple orders, policies, and unresolved inquiries.
- **Accurate Call State Management:** Real-time visual states (`Ready`, `Connecting`, `Listening`, `Thinking`, `Speaking`, `Error`, `Call Ended`) guaranteed never to display false "Connected" or "Listening" states prior to session readiness.
- **Interruption / Barge-In Handling:** When the customer interrupts while Aria is speaking, active scheduled audio playback sources are cancelled instantly without audio artifacts.
- **Strict Aura Policy Enforcement:** Consistently adheres to business policies for Shipping, 7-day Returns, Processing-only Cancellations, Cash on Delivery, and politely redirects out-of-scope inquiries.
- **Interactive Test Order Preview:** Evaluators can inspect sample orders (`ORD-101`, `ORD-102`, `ORD-103`) and verify assessment context in a dedicated preview panel.
- **Premium Aesthetics:** Dark luxury skincare visual design with an animated blue Saturn orb, rotating orbital rings, glassmorphism cards, and responsive layout for mobile and desktop.

---

## 2. Architecture & Audio / Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               CLIENT BROWSER                                │
│                                                                             │
│  [Microphone] ──> AudioContext (16kHz) ──> ScriptProcessor (PCM Int16)      │
│                         │                                                   │
│                         ▼                                                   │
│             WebSocket Client (ws / wss)                                     │
│                         │                                                   │
│                         ▲ (Incoming PCM 24kHz)                              │
│                         │                                                   │
│  [Speakers]   <── AudioContext (24kHz) <── AudioBufferSource Queue          │
└─────────────────────────┼───────────────────────────────────────────────────┘
                          │
                          │ WebSocket Frame (Binary PCM / JSON)
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             NODE.JS BACKEND                                 │
│                                                                             │
│   Express 5 HTTP & 'ws' WebSocket Relay Server                              │
│   ├── Order Service (/server/services/orderService.js)                      │
│   └── Summary Service (/server/services/summaryService.js)                  │
│                         │                                                   │
│                         ├──> Live Bi-directional Session                    │
│                         │    (@google/genai SDK)                            │
│                         ▼                                                   │
│             Google Gemini 3.8 Live API                                      │
│             (Audio In/Out, Speech-to-Text, Tool Calling)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### End-to-End Sequence

1. **Call Initialization:**
   - User clicks **Start Call** (`startCall()`).
   - Browser requests microphone permission via `navigator.mediaDevices.getUserMedia()`.
   - Browser opens WebSocket connection to `/ws`.
   - Backend establishes session with Gemini Live (`gemini-3.8-live`) with `Achernar` female conversational voice and `get_order_details` tool declarations.
   - Backend notifies browser `{ type: "status", state: "connected" }`.
   - Browser transitions to `Listening` and begins streaming 16kHz PCM audio frames.
2. **Conversation & Tool Calling:**
   - Gemini Live streams customer transcription deltas and output audio (24kHz PCM).
   - When customer asks about an order, Gemini triggers a function call `get_order_details({ order_id })`.
   - Server resolves order from `orderService.js`, returns tool response to Gemini, and notifies client `{ type: "tool_call", order_id, result }`.
   - Client UI displays `Thinking...` and `Looking up order ORD-101...`.
   - Aria speaks the answer naturally.
3. **Interruption:**
   - If the customer speaks while Aria is speaking, Gemini sends `{ interrupted: true }`.
   - Server relays `{ type: "interrupted" }` to client.
   - Client immediately stops all active `AudioBufferSourceNode` instances and clears playback queues.
4. **Post-Call Summary Generation:**
   - User clicks **End Call** or disconnects.
   - Microphone tracks and AudioContexts are closed cleanly.
   - Client sends full turn transcript and tool history to `POST /api/summarize-call`.
   - Backend invokes `gemini-3.8-flash` with structured JSON schema.
   - If API quota or network issues arise, deterministic `generateFallbackSummary` produces the validated outcome.
   - Post-Call Summary and JSON block are displayed persistently with **Copy JSON** and **Copy Transcript** buttons.

---

## 3. Technology Stack & Rationale

| Layer | Technologies | Rationale |
|---|---|---|
| **Frontend** | React 19, Vite, Vanilla CSS | Rapid build times, zero CSS framework bloat, precise control over glassmorphism and keyframe animations. |
| **Audio Processing** | Web Audio API (`AudioContext`, `ScriptProcessorNode`, `Float32Array` downsampling) | Native browser audio handling with low-latency PCM encoding and sequenced buffer scheduling. |
| **Backend** | Node.js (v24), Express 5, `ws` | Asynchronous event-driven architecture optimal for real-time WebSocket traffic and minimal overhead. |
| **AI Models** | Google Gemini Live (`gemini-3.8-live`), Gemini Flash (`gemini-3.8-flash`), `@google/genai` (2.27.0) | State-of-the-art native audio-to-audio multimodal streaming with sub-second response times and tool calling. |
| **Testing** | Node.js native test runner (`node:test`, `node:assert/strict`) | Built-in zero-dependency testing providing instant execution across unit and integration suites. |

---

## 4. Local Installation & Setup

### Prerequisites
- **Node.js:** v18.0.0 or later (v20+ or v24 recommended)
- **npm:** v9.0.0 or later
- **Google Gemini API Key:** An active key from [Google AI Studio](https://aistudio.google.com/)

### Step 1: Clone Repository
```bash
git clone https://github.com/Sak1162/aura-skincare-ai-agent.git
cd aura-skincare-ai-agent
```

### Step 2: Configure Environment Variables
Create `.env` inside `/server`:
```bash
cp server/.env.example server/.env
```
Edit `server/.env`:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
PORT=5000
CLIENT_URL=http://localhost:5173
```

*(Optional)* Create `.env` inside `/client` if running client on a custom host/port:
```bash
cp client/.env.example client/.env
```
Default values:
```env
VITE_WS_URL=ws://localhost:5000/ws
VITE_API_URL=http://localhost:5000
```

### Step 3: Install Dependencies
```bash
# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install
cd ..
```

### Step 4: Run Automated Tests
```bash
cd server
npm test
```
*Executes all 24 unit and integration tests across order services, fallback rules, transcript accumulation, multi-product/multi-order summaries, policy rejections, cancellation checks, and Gemini structured output validation.*

### Step 5: Start the Development Servers

**Terminal 1 (Backend Server):**
```bash
cd server
npm start
# Server listens on http://localhost:5000 and ws://localhost:5000/ws
```

**Terminal 2 (Frontend Client):**
```bash
cd client
npm run dev
# Vite runs at http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## 5. Required Environment Variables

### Backend (`server/.env`)
| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** | — | Secret API key from Google AI Studio. Never exposed to frontend. |
| `PORT` | No | `5000` | HTTP and WebSocket port for the backend server. |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed CORS origin for web clients. |

### Frontend (`client/.env`)
| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_WS_URL` | No | `ws://localhost:5000/ws` | Production WebSocket endpoint (e.g. `wss://aura-backend.onrender.com/ws`). |
| `VITE_API_URL` | No | `http://localhost:5000` | HTTP API base URL (derived from `VITE_WS_URL` if omitted). |

> **Security Note:** All `.env` files are ignored by `.gitignore`. Real credentials are never committed to Git or exposed in public client bundles.

---

## 6. Sample Orders & Assessment Test Scenarios

The backend order service (`/server/data/orders.json`) provides three standardized assessment test orders:

| Order ID | Customer | Product | Value | Status | Carrier / Tracking | Policy Notes |
|---|---|---|---|---|---|---|
| **ORD-101** | Priya Sharma | Vitamin C Serum (30ml) | ₹699 | Out for Delivery | BlueDart (`BD-982103`) | Expected by 6 PM today. **Cannot be cancelled**; customer can refuse at doorstep. |
| **ORD-102** | Rahul Verma | Hydrating Sunscreen SPF 50 | ₹499 | Delivered | Delhivery (`DL-441029`) | Delivered 14 days ago. **Return window expired** (7-day policy limit). |
| **ORD-103** | Ananya Patel | Green Tea Face Wash + Toner | ₹850 | Processing | None | Ordered 3 hours ago. **Eligible for instant cancellation**. |

### Manual Test Verification Checklist

| # | Test Scenario | Expected Agent Behavior | Expected Post-Call Outcome |
|---|---|---|---|
| 1 | **Track ORD-101** ("Where is my order ORD-101?") | Calls `get_order_details`. Informs customer it is Out for Delivery with BlueDart, expected by 6 PM today. | `intent`: `ORDER_TRACKING`<br>`order_id`: `ORD-101`<br>`status`: `RESOLVED` |
| 2 | **Cancel ORD-101** ("I want to cancel ORD-101") | Informs customer that orders already Out for Delivery cannot be cancelled in the system, but they may refuse delivery at the doorstep. | `intent`: `ORDER_CANCELLATION`<br>`order_id`: `ORD-101`<br>`status`: `POLICY_REJECTED` |
| 3 | **Cancel ORD-103** ("Please cancel ORD-103") | Checks status (`Processing`). Confirms cancellation is eligible and accepted. | `intent`: `ORDER_CANCELLATION`<br>`order_id`: `ORD-103`<br>`status`: `RESOLVED` |
| 4 | **20-Day Old Opened Return** ("Can I return an opened cream bought 20 days ago?") | Politely declines: returns must be unopened, in original packaging, and reported within 7 days of delivery. | `intent`: `RETURN_INQUIRY`<br>`order_id`: `null`<br>`status`: `POLICY_REJECTED` |
| 5 | **Invalid Order ID** ("Check order ORD-999") | Gracefully reports that no order was found with ID ORD-999 and asks customer to verify the number. | `intent`: `ORDER_TRACKING`<br>`order_id`: `null`<br>`status`: `UNRESOLVED` |
| 6 | **Unrelated Task** ("Book me a flight to Mumbai") | Politely clarifies: "I'm Aria from Aura Skincare support, so I can only help with Aura Skincare orders, products, and policies." | `intent`: `UNSUPPORTED_REQUEST`<br>`order_id`: `null`<br>`status`: `UNSUPPORTED` |
| 7 | **Barge-in / Interruption** | Customer begins speaking while Aria is answering. Aria immediately cuts off audio playback and listens. | Smooth turn transition without audio overlaps. |

---

## 7. Mandatory Assessment Questions

### Question 1: Why did you choose this architecture and technology stack?

> **Answer:**  
> The core requirement of this project was a low-latency, two-way conversational voice agent capable of tool calling and structured outcome evaluation.
>
> 1. **WebSocket Relay Architecture over HTTP Polling:** Real-time audio cannot tolerate the latency or connection teardown overhead of periodic HTTP polling. Using a persistent bidirectional WebSocket (`ws`) connection allows raw PCM 16kHz audio chunks to stream with sub-100ms transport overhead.
> 2. **Thin Node.js Backend as a Secure Gateway:** Direct browser-to-Gemini connections would leak the `GEMINI_API_KEY` into client network traffic. The Node.js relay protects API keys on the server, verifies origin headers, and centrally coordinates function calling with backend databases.
> 3. **Separation of Real-Time Voice and Post-Call Evaluation:** We chose `gemini-3.8-live` for native audio streaming, where speech-to-speech latency is paramount, and decoupled the post-call evaluation to `gemini-3.8-flash` via a structured JSON schema endpoint. This prevents conversation lags while guaranteeing that post-call summaries adhere to strict validation rules with deterministic fallback handling.
> 4. **React 19 & Vanilla CSS:** Using Vanilla CSS ensured 100% control over the custom Saturn orb animation, orbital keyframe mathematics, and dark glassmorphism palette without fighting bulky third-party component styles.

---

### Question 2: What was the most difficult part of the assignment, and how did you solve it?

> **Answer:**  
> The most difficult challenge was **transcript streaming coherence and real-time audio synchronization**.
>
> 1. **The "Fragmented Bubble" Problem:** The Gemini Live speech-to-text engine streams partial fragments asynchronously. In a naive implementation, every chunk appends a new state entry, turning a single spoken sentence into 15 to 20 fragmented visual bubbles. Furthermore, fragments can arrive as incremental deltas, cumulative strings, or overlapping tokens depending on acoustic re-segmentation.
>    - *Solution:* We built a specialized accumulator (`client/src/utils/transcript.js` and `server/services/summaryService.js`). It checks speaker continuity, detects cumulative replacements (`startsWith`), finds boundary word overlaps (longest common suffix/prefix), and attaches punctuation cleanly. This maintains a live single bubble during speech and finalizes clean turn boundaries upon speaker alternation.
> 2. **Audio Scheduling & Barge-In Artifacts:** When Gemini outputs audio in chunks, scheduling them into browser `AudioBufferSourceNode` objects requires tracking absolute playback offsets (`nextPlayTimeRef`). If the user interrupts, simply muting is insufficient—previously queued buffers will continue to fire.
>    - *Solution:* We track active `AudioBufferSourceNode` instances in an `audioSourcesRef` Set. When an `interrupted` event arrives from the server, we immediately loop through all active sources, invoke `.stop()`, clear the collection, reset the playhead to `0`, and revert the UI state to `Listening`.

---

### Question 3: If you had one more week, what would you improve first and why?

> **Answer:**  
> If given one more week, I would prioritize:
>
> 1. **Migrate from `ScriptProcessorNode` to `AudioWorkletNode`:**  
>    `ScriptProcessorNode` runs on the browser's main thread and is technically deprecated. While highly reliable for cross-browser mockups, it can drop audio frames during heavy DOM operations. Implementing an `AudioWorkletProcessor` on an isolated audio rendering thread would eliminate any micro-stutters during heavy animations.
> 2. **Persistent Conversation Database & Call Analytics:**  
>    Currently, call transcripts and summaries live in application memory and UI state. I would integrate PostgreSQL with Prisma or Redis to persist every call session, along with latency telemetry (Time to First Byte, interruption count, tool execution duration) to create a QA analytics dashboard.
> 3. **Write-Back Mutations & Multi-Channel Notifications:**  
>    Add real order cancellation state persistence (updating `orders.json` or database) and integrate Twilio/WhatsApp webhooks to instantly send tracking links or cancellation confirmations to the customer's phone number after the call ends.
> 4. **Automated End-to-End Audio Regression Tests:**  
>    Use Playwright with mock virtual audio input streams (`--use-fake-device-for-media-stream`) to run automated end-to-end regression tests verifying that the full voice pipeline, tool calls, and UI state changes pass in CI/CD without manual browser testing.

---

### Question 4: What would need to change to support 1,000 customer conversations a day?

> **Answer:**  
> Supporting 1,000 calls/day translates to ~42 calls/hour average, but customer traffic typically peaks during business hours (e.g., 10 AM to 6 PM), generating **20 to 50 concurrent active voice connections**.
>
> To support this production scale reliably, the following changes would be necessary:
>
> 1. **Stateless Horizontal Scaling with Sticky Sessions:**  
>    A single Node.js process cannot safely hold hundreds of concurrent uncompressed Web Audio WebSocket streams. We would deploy containerized instances (on AWS ECS or GCP Cloud Run) behind a load balancer with sticky WebSocket sessions or use a Redis Pub/Sub adapter to manage cross-instance signaling.
> 2. **Gemini Live Quota & Rate Limit Pooling:**  
>    The Gemini Live API imposes concurrent session limits and Requests Per Minute (RPM) quotas. In production, we would implement:
>    - Connection pooling and backoff queues.
>    - Multi-key rotation or an enterprise Vertex AI endpoint with reserved provisioned throughput.
>    - Graceful fallback to text-to-speech + standard Gemini chat if Live streaming quotas saturate.
> 3. **Audio Bandwidth Optimization:**  
>    Switching from uncompressed PCM over WebSocket to an Opus-encoded WebRTC audio stream would reduce audio bandwidth by ~80%, significantly decreasing network egress costs and eliminating packet loss over cellular connections.
> 4. **Centralized Observability & Error Budgets:**  
>    Instrument OpenTelemetry, Datadog, or Sentry to track WebSocket disconnections, audio buffer under-runs, Gemini tool execution latency, and error rates in real time.

---

## 8. Deployment Overview

- **Frontend:** Deployed on **Vercel** ([https://aura-skincare-ai-agent.vercel.app/](https://aura-skincare-ai-agent.vercel.app/)). Configured to read `VITE_WS_URL` and `VITE_API_URL` from production environment variables.
- **Backend:** Node.js Express & WebSocket server configured for zero-downtime hosting on platforms such as Render, Railway, or Google Cloud Run with TLS/HTTPS (`wss://`).

---

## 9. Submission Git Checklist

To review and commit these changes to your repository:

```bash
# 1. Review modified and untracked files
git status

# 2. Add all completed changes
git add .

# 3. Commit changes with a clean message
git commit -m "feat: complete assessment readiness audit, real-time voice policies, post-call summary, and test suite"

# 4. Push to clean-main branch
git push origin clean-main
```
*(Do not force-push; do not expose `.env` secrets).*
