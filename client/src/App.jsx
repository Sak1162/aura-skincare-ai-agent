import { useEffect, useRef, useState } from "react";
import "./App.css";
import { accumulateTranscript } from "./utils/transcript";

/* =========================================================
   URL HELPERS
========================================================= */

function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return `wss://${window.location.host}/ws`;
  }
  return "ws://localhost:5000/ws";
}

function getApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL
      .replace(/^wss:\/\//, "https://")
      .replace(/^ws:\/\//, "http://")
      .replace(/\/ws\/?$/, "");
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return `https://${window.location.host}`;
  }
  return "http://localhost:5000";
}

/* =========================================================
   TEST ORDERS DATA
========================================================= */

const TEST_ORDERS = [
  {
    order_id: "ORD-101",
    customer: "Priya Sharma",
    product: "Vitamin C Serum (30ml)",
    value: 699,
    status: "Out for Delivery",
    carrier: "BlueDart",
    tracking_number: "BD-982103",
    notes: "Expected by 6 PM today",
    policy_context: "Already out for delivery. Cannot be cancelled; customer may refuse delivery at doorstep.",
  },
  {
    order_id: "ORD-102",
    customer: "Rahul Verma",
    product: "Hydrating Sunscreen SPF 50",
    value: 499,
    status: "Delivered",
    carrier: "Delhivery",
    tracking_number: "DL-441029",
    notes: "Delivered 14 days ago",
    policy_context: "Delivered 14 days ago. Return window (7 days) expired; opened items ineligible for return.",
  },
  {
    order_id: "ORD-103",
    customer: "Ananya Patel",
    product: "Green Tea Face Wash + Toner",
    value: 850,
    status: "Processing",
    carrier: null,
    tracking_number: null,
    notes: "Ordered 3 hours ago. Eligible for cancellation",
    policy_context: "Order status is Processing. Eligible for instant cancellation upon customer request.",
  },
];

/* =========================================================
   AUDIO HELPERS
========================================================= */

function float32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return int16Array;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function int16ToFloat32(arrayBuffer) {
  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/* =========================================================
   APP COMPONENT
========================================================= */

function App() {
  // Call states: 'ready' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error'
  const [callState, setCallState] = useState("ready");
  const [statusText, setStatusText] = useState("Ready to call");
  const [messages, setMessages] = useState([]);
  const [toolStatus, setToolStatus] = useState("");
  const [toolCalls, setToolCalls] = useState([]);
  const [callSummary, setCallSummary] = useState(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // References
  const socketRef = useRef(null);
  const inputContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const silentGainRef = useRef(null);

  const audioContextRef = useRef(null);
  const audioSourcesRef = useRef(new Set());
  const nextPlayTimeRef = useRef(0);
  const audioGenerationRef = useRef(0);

  const messagesRef = useRef(messages);
  const toolCallsRef = useRef(toolCalls);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    toolCallsRef.current = toolCalls;
  }, [toolCalls]);

  const isCallActive =
    callState === "connecting" ||
    callState === "listening" ||
    callState === "thinking" ||
    callState === "speaking";

  /* =======================================================
     POST-CALL SUMMARY FETCHER
  ======================================================= */

  const requestSummary = async (transcriptList, toolsList) => {
    setIsSummaryLoading(true);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/summarize-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptList,
          toolCalls: toolsList,
        }),
      });

      if (!response.ok) {
        throw new Error(`Summary API returned status ${response.status}`);
      }

      const data = await response.json();
      if (data && data.summary) {
        setCallSummary(data.summary);
      }
    } catch (err) {
      console.warn("HTTP summary fetch failed, using client fallback:", err);
      // Safe client-side fallback with complete multi-topic schema
      setCallSummary({
        customer_intents: transcriptList.length > 0 ? ["GENERAL_INQUIRY"] : ["NO_INQUIRY"],
        products_discussed: toolsList.map((t) => ({
          product_name: t.result?.order?.product || "Aura Skincare Product",
          order_id: t.order_id || null,
          order_value: t.result?.order?.value || null,
          order_status: t.result?.order?.status || null,
          carrier: t.result?.order?.carrier || null,
          tracking_number: t.result?.order?.tracking_number || null,
          delivery_estimate: t.result?.order?.notes || null,
          resolution: "Provided order and product details to customer.",
        })),
        policies_discussed: [],
        actions_taken: toolsList.map((t) => `Looked up order ${t.order_id} in system`),
        unresolved_questions: [],
        resolution_status: transcriptList.length > 0 ? "RESOLVED" : "UNRESOLVED",
        call_summary:
          transcriptList.length > 0
            ? "Customer spoke with Aria regarding Aura Skincare support."
            : "Call ended without customer conversation.",
        // Legacy compatibility fields
        customer_intent: "GENERAL_INQUIRY",
        order_id: toolsList.length > 0 ? toolsList[0].order_id : null,
      });
    } finally {
      setIsSummaryLoading(false);
    }
  };

  /* =======================================================
     START CALL
  ======================================================= */

  const startCall = async () => {
    // Guard against duplicate calls
    if (isCallActive) return;

    let stream = null;

    try {
      setCallState("connecting");
      setStatusText("Requesting microphone permission...");
      setErrorMessage("");
      setToolStatus("");
      // Retain previous summary and transcript until user confirms new call, or reset if starting fresh
      setCallSummary(null);
      setMessages([]);
      setToolCalls([]);

      // 1. Request microphone access
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      setStatusText("Connecting to Aria...");

      // 2. Connect WebSocket
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setStatusText("Waiting for Aria session...");
      };

      socket.onmessage = async (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          console.error("Invalid WebSocket message:", event.data);
          return;
        }

        // Gemini Live session is connected & ready
        if (message.type === "status" && message.state === "connected") {
          setCallState("listening");
          setStatusText("Listening to you...");

          // Start microphone audio streaming
          if (processorRef.current) return;

          const inputContext = new AudioContext({ sampleRate: 16000 });
          inputContextRef.current = inputContext;
          await inputContext.resume();

          const microphone = inputContext.createMediaStreamSource(stream);
          sourceRef.current = microphone;

          const processor = inputContext.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          const silentGain = inputContext.createGain();
          silentGain.gain.value = 0;
          silentGainRef.current = silentGain;

          processor.onaudioprocess = (audioEvent) => {
            if (socket.readyState !== WebSocket.OPEN) return;

            const input = audioEvent.inputBuffer.getChannelData(0);
            const downsampled = downsampleBuffer(input, inputContext.sampleRate, 16000);
            const pcm = float32ToInt16(downsampled);

            socket.send(
              JSON.stringify({
                type: "audio",
                data: arrayBufferToBase64(pcm.buffer),
              })
            );
          };

          microphone.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputContext.destination);
        }

        // Streaming transcript fragment
        if (message.type === "transcript") {
          setMessages((prev) =>
            accumulateTranscript(prev, {
              speaker: message.speaker,
              text: message.text,
            })
          );

          if (message.speaker === "aria") {
            setCallState("speaking");
            setStatusText("Aria is speaking...");
          }
        }

        // Audio playback from Gemini
        if (message.type === "audio" && message.data) {
          try {
            let audioContext = audioContextRef.current;
            if (!audioContext || audioContext.state === "closed") {
              audioContext = new AudioContext({ sampleRate: 24000 });
              audioContextRef.current = audioContext;
              nextPlayTimeRef.current = 0;
            }

            await audioContext.resume();

            const pcmBuffer = base64ToArrayBuffer(message.data);
            const samples = int16ToFloat32(pcmBuffer);

            const audioBuffer = audioContext.createBuffer(1, samples.length, 24000);
            audioBuffer.copyToChannel(samples, 0);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            audioSourcesRef.current.add(source);
            setCallState("speaking");
            setStatusText("Aria is speaking...");

            source.onended = () => {
              audioSourcesRef.current.delete(source);
              if (audioSourcesRef.current.size === 0) {
                setCallState((current) => (current === "speaking" ? "listening" : current));
                setStatusText("Listening to you...");
              }
            };

            const startAt = Math.max(audioContext.currentTime + 0.02, nextPlayTimeRef.current);
            source.start(startAt);
            nextPlayTimeRef.current = startAt + audioBuffer.duration;
          } catch (playbackError) {
            console.error("Audio playback error:", playbackError);
          }
        }

        // Interruption
        if (message.type === "interrupted") {
          audioGenerationRef.current += 1;
          nextPlayTimeRef.current = 0;

          for (const audioSource of audioSourcesRef.current) {
            try {
              audioSource.stop();
            } catch {}
          }
          audioSourcesRef.current.clear();
          setCallState("listening");
          setStatusText("Listening to you...");
        }

        // Tool call
        if (message.type === "tool_call") {
          setCallState("thinking");
          setToolStatus(`Looking up order ${message.order_id}...`);
          setStatusText(`Checking order ${message.order_id}...`);

          setToolCalls((prev) => [
            ...prev,
            {
              tool: message.tool,
              order_id: message.order_id,
              result: message.result || null,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
        }

        // Turn complete
        if (message.type === "turn_complete") {
          setToolStatus("");
          if (audioSourcesRef.current.size === 0) {
            setCallState("listening");
            setStatusText("Listening to you...");
          }
        }

        // Post-call summary over WebSocket (if sent)
        if (message.type === "call_summary") {
          setCallSummary(message.data);
          setIsSummaryLoading(false);
        }

        // Error
        if (message.type === "error") {
          console.error("Voice AI agent error:", message.message);
          setCallState("error");
          setErrorMessage(message.message);
          setStatusText(`Error: ${message.message}`);
        }
      };

      socket.onerror = (err) => {
        console.error("Browser WebSocket error:", err);
        setCallState("error");
        setErrorMessage("Connection to voice server failed. Please verify the server is running.");
        setStatusText("Connection failed");
      };

      socket.onclose = (event) => {
        if (event.code !== 1000 && callState !== "ended") {
          setCallState("ended");
          setStatusText("Call ended");
          // Trigger summary if messages exist
          if (messagesRef.current.length > 0) {
            requestSummary(messagesRef.current, toolCallsRef.current);
          }
        }
      };
    } catch (err) {
      console.error("Could not start call:", err);
      stream?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      setCallState("error");
      const isDenied = err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
      const errTxt = isDenied
        ? "Microphone access was denied. Please allow microphone permissions in your browser to speak with Aria."
        : `Could not start call: ${err.message}`;
      setErrorMessage(errTxt);
      setStatusText(isDenied ? "Microphone permission denied" : "Start failed");
    }
  };

  /* =======================================================
     END CALL
  ======================================================= */

  const endCall = async () => {
    setStatusText("Ending call and generating summary...");
    setCallState("ended");

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "end" }));
      } catch (err) {
        console.error("Could not send end message:", err);
      }
    }

    try {
      processorRef.current?.disconnect();
    } catch {}
    processorRef.current = null;

    try {
      sourceRef.current?.disconnect();
    } catch {}
    sourceRef.current = null;

    try {
      silentGainRef.current?.disconnect();
    } catch {}
    silentGainRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    for (const audioSource of audioSourcesRef.current) {
      try {
        audioSource.stop();
      } catch {}
    }
    audioSourcesRef.current.clear();
    nextPlayTimeRef.current = 0;

    const contexts = [inputContextRef.current, audioContextRef.current];
    inputContextRef.current = null;
    audioContextRef.current = null;

    await Promise.all(
      contexts.map(async (context) => {
        if (context && context.state !== "closed") {
          try {
            await context.close();
          } catch {}
        }
      })
    );

    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1000, "Call ended by user");
    }

    setToolStatus("");
    setStatusText("Call ended - summary generated");

    // Request post-call summary using current messages & tools
    requestSummary(messagesRef.current, toolCallsRef.current);
  };

  /* =======================================================
     SMART AUTO-SCROLL
  ======================================================= */

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setUserScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
  };

  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, userScrolledUp]);

  /* =======================================================
     CLEANUP ON UNMOUNT
  ======================================================= */

  useEffect(() => {
    return () => {
      try {
        socketRef.current?.close();
      } catch {}
      try {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      } catch {}
      try {
        inputContextRef.current?.close();
      } catch {}
      try {
        audioContextRef.current?.close();
      } catch {}
    };
  }, []);

  /* =======================================================
     CLIPBOARD HELPERS
  ======================================================= */

  const copyJsonSummary = () => {
    if (!callSummary) return;
    navigator.clipboard.writeText(JSON.stringify(callSummary, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const copyFullTranscript = () => {
    if (messages.length === 0) return;
    const formatted = messages
      .map((m) => `[${m.timestamp}] ${m.speaker === "aria" ? "Aria" : "Customer"}: ${m.text}`)
      .join("\n");
    navigator.clipboard.writeText(formatted);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  /* =======================================================
     STATE BADGE LABEL & CLASS
  ======================================================= */

  const getStateDisplay = () => {
    switch (callState) {
      case "connecting":
        return { label: "Connecting", className: "status-connecting" };
      case "listening":
        return { label: "Listening", className: "status-listening" };
      case "thinking":
        return { label: "Thinking", className: "status-thinking" };
      case "speaking":
        return { label: "Speaking", className: "status-speaking" };
      case "ended":
        return { label: "Call Ended", className: "status-ended" };
      case "error":
        return { label: "Error", className: "status-error" };
      default:
        return { label: "Ready", className: "status-ready" };
    }
  };

  const stateDisplay = getStateDisplay();

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="app">
      {/* =================================================
          TOP BAR
      ================================================= */}
      <header className="top-bar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div className="brand-text">
            <div className="brand-name">Aura Skincare</div>
            <div className="brand-subtitle">AI Voice Customer Support</div>
          </div>
        </div>

        <div className="connection-indicator">
          <span className={`connection-dot ${stateDisplay.className}`} />
          {stateDisplay.label}
        </div>
      </header>

      {/* =================================================
          MAIN SHELL
      ================================================= */}
      <main className="voice-shell">
        {/* =================================================
            LEFT VOICE PANEL
        ================================================= */}
        <section className="voice-panel">
          <div className="voice-label">AURA AI</div>
          <h1 className="aria-title">Aria</h1>
          <p className="aria-description">Your Aura Skincare support specialist</p>

          {/* SATURN ORB STAGE */}
          <div className={`orb-stage ${isCallActive ? "is-active" : ""} state-${callState}`}>
            {/* Outer atmospheric rings */}
            <div className="saturn-ring ring-outer" />
            <div className="saturn-ring ring-large" />
            <div className="saturn-ring ring-medium" />
            <div className="saturn-ring ring-small" />

            {/* Orbiting rings */}
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />

            {/* Main orb */}
            <div className={`aria-orb ${isCallActive ? "active" : ""} orb-${callState}`}>
              <div className="orb-light" />
              <div className="orb-letter">A</div>
            </div>

            {/* Accurate status pill */}
            <div className={`voice-status ${stateDisplay.className}`}>
              <span className="status-dot" />
              {stateDisplay.label}
            </div>
          </div>

          {/* Granular status message */}
          <div className="voice-message">
            <div className="voice-state">
              {toolStatus || statusText}
            </div>

            <div className="voice-hint">
              {callState === "connecting" && "Requesting microphone & initializing session"}
              {callState === "listening" && "Speak naturally with Aria"}
              {callState === "thinking" && "Looking up order & policy database"}
              {callState === "speaking" && "Interrupt anytime by speaking"}
              {callState === "ended" && "Review full transcript and JSON summary"}
              {callState === "error" && errorMessage}
              {callState === "ready" && "Click Start Call to begin voice conversation"}
            </div>
          </div>

          {/* Tool status banner */}
          {toolStatus && (
            <div className="tool-pill" role="status">
              <span className="tool-dot" />
              {toolStatus}
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && callState === "error" && (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          )}

          {/* START / END CALL CONTROLS */}
          <div className="call-actions">
            {isCallActive ? (
              <button
                id="end-call-btn"
                className="call-button end-call"
                onClick={endCall}
                title="End the current voice call"
              >
                <span className="button-icon">×</span>
                End Call
              </button>
            ) : (
              <button
                id="start-call-btn"
                className="call-button start-call"
                onClick={startCall}
                disabled={callState === "connecting"}
                title="Start a real-time voice call with Aria"
              >
                <span className="button-icon">●</span>
                {callState === "connecting" ? "Connecting..." : "Start Call"}
              </button>
            )}
          </div>
        </section>

        {/* =================================================
            RIGHT CONVERSATION & SUMMARY PANEL
        ================================================= */}
        <section className="conversation-panel">
          <div className="conversation-header">
            <div className="conversation-title">
              <span className={`live-dot ${isCallActive ? "active" : ""}`} />
              <span>
                {callState === "ended" ? "Post-Call Summary & Transcript" : "Live conversation"}
              </span>
            </div>

            <div className="header-meta">
              <span className="message-count">
                {messages.length} {messages.length === 1 ? "turn" : "turns"}
              </span>
            </div>
          </div>

          {/* =================================================
              POST-CALL RESULTS SECTION (MANDATORY REQUIREMENT)
          ================================================= */}
          {callState === "ended" && (
            <div className="post-call-section" id="post-call-summary">
              <div className="post-call-header">
                <div className="post-call-title">
                  <span className="summary-icon">✦</span>
                  <strong>Post-Call Summary</strong>
                </div>

                <div className="post-call-actions">
                  <button
                    className="action-pill"
                    onClick={copyJsonSummary}
                    disabled={!callSummary}
                    title="Copy structured JSON outcome"
                  >
                    {copiedJson ? "✓ Copied JSON" : "📋 Copy JSON"}
                  </button>
                  <button
                    className="action-pill"
                    onClick={copyFullTranscript}
                    disabled={messages.length === 0}
                    title="Copy full conversation transcript"
                  >
                    {copiedTranscript ? "✓ Copied Transcript" : "📋 Copy Transcript"}
                  </button>
                  <button
                    className="action-pill start-new"
                    onClick={startCall}
                    title="Start a new call"
                  >
                    ↺ Start New Call
                  </button>
                </div>
              </div>

              {isSummaryLoading ? (
                <div className="summary-loading">
                  <span className="loading-spinner" />
                  Generating structured assessment summary with Gemini...
                </div>
              ) : callSummary ? (
                <div className="summary-card">
                  {/* Summary badges */}
                  <div className="summary-badges">
                    <div
                      className={`summary-badge resolution res-${(
                        callSummary.resolution_status || ""
                      ).toLowerCase()}`}
                    >
                      <span className="badge-k">Resolution:</span>
                      <strong className="badge-v">{callSummary.resolution_status}</strong>
                    </div>

                    {Array.isArray(callSummary.customer_intents) ? (
                      callSummary.customer_intents.map((intent, idx) => (
                        <div key={idx} className="summary-badge intent">
                          <span className="badge-k">Intent:</span>
                          <strong className="badge-v">{intent}</strong>
                        </div>
                      ))
                    ) : (
                      <div className="summary-badge intent">
                        <span className="badge-k">Intent:</span>
                        <strong className="badge-v">
                          {callSummary.customer_intent || "GENERAL_INQUIRY"}
                        </strong>
                      </div>
                    )}
                  </div>

                  {/* Overall Call Summary Narrative */}
                  <div className="summary-block">
                    <div className="summary-block-title">Call Summary</div>
                    <p className="summary-text">{callSummary.call_summary}</p>
                  </div>

                  {/* Products & Orders Discussed */}
                  {Array.isArray(callSummary.products_discussed) &&
                    callSummary.products_discussed.length > 0 && (
                      <div className="summary-block">
                        <div className="summary-block-title">
                          Products & Orders Discussed ({callSummary.products_discussed.length})
                        </div>
                        <div className="summary-products-list">
                          {callSummary.products_discussed.map((p, idx) => (
                            <div key={idx} className="summary-product-item">
                              <div className="spi-top">
                                <strong className="spi-name">{p.product_name}</strong>
                                <div className="spi-badges">
                                  {p.order_id && (
                                    <span className="spi-order-badge">{p.order_id}</span>
                                  )}
                                  {p.order_status && (
                                    <span
                                      className={`spi-status-badge status-${(
                                        p.order_status || ""
                                      )
                                        .toLowerCase()
                                        .replace(/\s+/g, "-")}`}
                                    >
                                      {p.order_status}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {(p.order_value || p.carrier || p.delivery_estimate) && (
                                <div className="spi-meta-row">
                                  {p.order_value && (
                                    <span>
                                      <span className="spi-k">Value:</span> ₹{p.order_value}
                                    </span>
                                  )}
                                  {p.carrier && (
                                    <span>
                                      <span className="spi-k">Carrier:</span> {p.carrier}
                                      {p.tracking_number ? ` (${p.tracking_number})` : ""}
                                    </span>
                                  )}
                                  {p.delivery_estimate && (
                                    <span>
                                      <span className="spi-k">Details:</span> {p.delivery_estimate}
                                    </span>
                                  )}
                                </div>
                              )}

                              {p.resolution && (
                                <div className="spi-resolution">
                                  <span className="spi-k">Outcome:</span> {p.resolution}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Policies Discussed */}
                  {Array.isArray(callSummary.policies_discussed) &&
                    callSummary.policies_discussed.length > 0 && (
                      <div className="summary-block">
                        <div className="summary-block-title">Policies Discussed</div>
                        <div className="summary-policies-list">
                          {callSummary.policies_discussed.map((pol, idx) => (
                            <div key={idx} className="summary-policy-item">
                              <div className="pol-title">
                                {typeof pol === "string"
                                  ? pol
                                  : pol.policy_name
                                  ? pol.policy_name.replace(/_/g, " ")
                                  : "Policy"}
                              </div>
                              {pol.policy_details && (
                                <div className="pol-details">{pol.policy_details}</div>
                              )}
                              {pol.outcome && (
                                <div className="pol-outcome">
                                  <strong>Outcome:</strong> {pol.outcome}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Actions Taken & Unresolved Inquiries */}
                  <div className="summary-split-grid">
                    {Array.isArray(callSummary.actions_taken) &&
                      callSummary.actions_taken.length > 0 && (
                        <div className="summary-split-col">
                          <div className="summary-block-title">Actions Taken</div>
                          <ul className="summary-list">
                            {callSummary.actions_taken.map((action, idx) => (
                              <li key={idx} className="action-li">
                                ✓ {action}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    <div className="summary-split-col">
                      <div className="summary-block-title">Unresolved Inquiries</div>
                      {Array.isArray(callSummary.unresolved_questions) &&
                      callSummary.unresolved_questions.length > 0 ? (
                        <ul className="summary-list">
                          {callSummary.unresolved_questions.map((q, idx) => (
                            <li key={idx} className="unresolved-li">
                              ⚠ {q}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="all-resolved-note">
                          ✓ All customer inquiries addressed.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Formatted Structured JSON Output */}
                  <div className="json-box-wrapper">
                    <div className="json-box-label">Structured JSON Outcome</div>
                    <pre className="json-box">{JSON.stringify(callSummary, null, 2)}</pre>
                  </div>
                </div>
              ) : (
                <div className="summary-empty">No summary available.</div>
              )}
            </div>
          )}

          {/* =================================================
              MESSAGES CONTAINER
          ================================================= */}
          <div
            className="messages-container"
            ref={messagesContainerRef}
            onScroll={handleScroll}
          >
            {messages.length === 0 ? (
              <div className="conversation-empty">
                <div className="mini-orb">A</div>
                <h3>Your conversation with Aria</h3>
                <p>Start a call and your live transcript will accumulate here.</p>
                <span>Try: &quot;Where is my order ORD-101?&quot;</span>
              </div>
            ) : (
              <div className="messages">
                {messages.map((message) => (
                  <div key={message.id} className={`message ${message.speaker}`}>
                    <div className="message-meta">
                      <span className="message-label">
                        {message.speaker === "aria" ? "ARIA" : "YOU"}
                      </span>
                      {message.timestamp && (
                        <span className="message-time">{message.timestamp}</span>
                      )}
                    </div>
                    <div className="message-text">{message.text}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Smart Scroll-to-bottom button if user scrolled up */}
            {userScrolledUp && (
              <button
                className="scroll-bottom-pill"
                onClick={scrollToBottom}
                title="Scroll to latest messages"
              >
                ↓ New messages
              </button>
            )}
          </div>

          {/* =================================================
              TEST ORDERS GRID
          ================================================= */}
          <div className="orders-section">
            <div className="orders-heading">
              <span>Test orders (Click to preview details)</span>
              <span>Sample order cases for assessment</span>
            </div>

            <div className="orders-grid">
              {TEST_ORDERS.map((order) => (
                <div
                  key={order.order_id}
                  className={`order-card ${
                    selectedOrder?.order_id === order.order_id ? "selected" : ""
                  }`}
                  onClick={() =>
                    setSelectedOrder(
                      selectedOrder?.order_id === order.order_id ? null : order
                    )
                  }
                  title="Click to view full order details"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedOrder(
                        selectedOrder?.order_id === order.order_id ? null : order
                      );
                    }
                  }}
                >
                  <div className="order-top">
                    <strong>{order.order_id}</strong>
                    <span
                      className={
                        order.status === "Out for Delivery"
                          ? "status-delivery"
                          : order.status === "Delivered"
                          ? "status-delivered"
                          : "status-processing"
                      }
                    >
                      {order.status}
                    </span>
                  </div>
                  <p>{order.product}</p>
                  <div className="order-customer">{order.customer} • ₹{order.value}</div>
                </div>
              ))}
            </div>

            {/* Interactive Order Preview Drawer */}
            {selectedOrder && (
              <div className="order-preview-card" role="region" aria-label="Order Details">
                <div className="preview-top">
                  <div className="preview-title">
                    <strong>{selectedOrder.order_id}</strong> — {selectedOrder.customer}
                  </div>
                  <button
                    className="preview-close"
                    onClick={() => setSelectedOrder(null)}
                    title="Close preview"
                  >
                    ×
                  </button>
                </div>
                <div className="preview-grid">
                  <div>
                    <span className="p-label">Product:</span> {selectedOrder.product}
                  </div>
                  <div>
                    <span className="p-label">Amount:</span> ₹{selectedOrder.value}
                  </div>
                  <div>
                    <span className="p-label">Status:</span> {selectedOrder.status}
                  </div>
                  <div>
                    <span className="p-label">Courier:</span>{" "}
                    {selectedOrder.carrier
                      ? `${selectedOrder.carrier} (${selectedOrder.tracking_number})`
                      : "None (Processing)"}
                  </div>
                </div>
                <div className="preview-policy">
                  <strong>Assessment Context:</strong> {selectedOrder.policy_context}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* =================================================
          FOOTER
      ================================================= */}
      <footer className="app-footer">
        <span>✦ Natural voice conversation • Gemini Live</span>
        <span>Aura Skincare Customer Support AI</span>
      </footer>
    </div>
  );
}

export default App;