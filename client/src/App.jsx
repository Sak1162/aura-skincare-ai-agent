import { useEffect, useRef, useState } from "react";
import "./App.css";

const WS_URL =
  import.meta.env.VITE_WS_URL || "ws://localhost:5000/ws";

/* =========================================================
   AUDIO HELPERS
========================================================= */

function float32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));

    int16Array[i] =
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;
  }

  return int16Array;
}

function downsampleBuffer(
  buffer,
  inputSampleRate,
  outputSampleRate
) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);

  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round(
      (offsetResult + 1) * ratio
    );

    let accum = 0;
    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i++
    ) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] =
      count > 0 ? accum / count : 0;

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

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length)
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/* =========================================================
   APP
========================================================= */

function App() {
  const [connected, setConnected] = useState(false);
  const [calling, setCalling] = useState(false);
  const [status, setStatus] = useState("Ready to call");
  const [messages, setMessages] = useState([]);
  const [toolStatus, setToolStatus] = useState("");

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

  /* =======================================================
     KEEP YOUR EXISTING START / END / WEBSOCKET LOGIC HERE
     
     These functions should remain exactly as they are in
     your current working version.
  ======================================================= */

 
  const startCall = async () => {
    if (calling) return;

    let stream;

    try {
      setCalling(true);
      setConnected(false);
      setStatus("Connecting to Aria...");

      // Request microphone permission from the user.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Create the browser-to-backend WebSocket.
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("Browser WebSocket opened");
        setStatus("Waiting for Aria...");
      };

      socket.onmessage = async (event) => {
        let message;

        try {
          message = JSON.parse(event.data);
        } catch {
          console.error("Invalid WebSocket message:", event.data);
          return;
        }

        if (message.type === "status" && message.state === "connected") {
          console.log("Aria's Gemini session is ready");
          setConnected(true);
          setStatus("Listening");

          // Do not send microphone audio until Gemini is ready.
          if (processorRef.current) return;

          const inputContext = new AudioContext({
            sampleRate: 16000,
          });
          inputContextRef.current = inputContext;
          await inputContext.resume();

          const microphone = inputContext.createMediaStreamSource(stream);
          sourceRef.current = microphone;

          const processor = inputContext.createScriptProcessor(
            4096,
            1,
            1
          );
          processorRef.current = processor;

          // Prevent microphone audio from playing back through the speakers.
          const silentGain = inputContext.createGain();
          silentGain.gain.value = 0;
          silentGainRef.current = silentGain;

          processor.onaudioprocess = (audioEvent) => {
            if (socket.readyState !== WebSocket.OPEN) return;

            const input = audioEvent.inputBuffer.getChannelData(0);

            const downsampled = downsampleBuffer(
              input,
              inputContext.sampleRate,
              16000
            );

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

        if (message.type === "transcript") {
          setMessages((previous) => [
            ...previous,
            {
              speaker: message.speaker,
              text: message.text,
            },
          ]);
        }

        if (message.type === "audio" && message.data) {
          try {
            let audioContext = audioContextRef.current;

            if (!audioContext || audioContext.state === "closed") {
              audioContext = new AudioContext({
                sampleRate: 24000,
              });
              audioContextRef.current = audioContext;
              nextPlayTimeRef.current = 0;
            }

            await audioContext.resume();

            const generation = audioGenerationRef.current;
            const pcmBuffer = base64ToArrayBuffer(message.data);
            const samples = int16ToFloat32(pcmBuffer);

            const audioBuffer = audioContext.createBuffer(
              1,
              samples.length,
              24000
            );

            audioBuffer.copyToChannel(samples, 0);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            audioSourcesRef.current.add(source);

            source.onended = () => {
              audioSourcesRef.current.delete(source);
            };

            const startAt = Math.max(
              audioContext.currentTime + 0.02,
              nextPlayTimeRef.current
            );

            source.start(startAt);
            nextPlayTimeRef.current =
              startAt + audioBuffer.duration;
          } catch (error) {
            console.error("Audio playback failed:", error);
          }
        }

        if (message.type === "interrupted") {
          audioGenerationRef.current += 1;
          nextPlayTimeRef.current = 0;

          for (const source of audioSourcesRef.current) {
            try {
              source.stop();
            } catch {}
          }

          audioSourcesRef.current.clear();
        }

        if (message.type === "tool_call") {
          setToolStatus(`Looking up order ${message.order_id}...`);
        }

        if (message.type === "turn_complete") {
          setToolStatus("");
        }

        if (message.type === "error") {
          console.error("Voice agent error:", message.message);
          setStatus(`Voice error: ${message.message}`);
        }
      };

      socket.onerror = (event) => {
        console.error("Browser WebSocket error:", event);
        setStatus("Connection failed. Check the backend logs.");
      };

      socket.onclose = (event) => {
        console.log("Browser WebSocket closed:", event.code, event.reason);
        setConnected(false);
        setCalling(false);

        if (event.code !== 1000) {
          setStatus("Connection closed. Please try again.");
        } else {
          setStatus("Ready to call");
        }
      };
    } catch (error) {
      console.error("Could not start voice call:", error);

      stream?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      setCalling(false);
      setConnected(false);
      setStatus(
        error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : `Could not start call: ${error.message}`
      );
    }
  };

  const endCall = async () => {
    setStatus("Ending call...");

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "end" }));
      } catch (error) {
        console.error("Could not send end-call message:", error);
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

    audioGenerationRef.current += 1;
    nextPlayTimeRef.current = 0;

    const contexts = [
      inputContextRef.current,
      audioContextRef.current,
    ];

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
      socket.close(1000, "Call ended");
    }

    setCalling(false);
    setConnected(false);
    setToolStatus("");
    setStatus("Ready to call");
  };

  /* =======================================================
     AUTO SCROLL CONVERSATION
  ======================================================= */

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  /* =======================================================
     CLEANUP
  ======================================================= */

  useEffect(() => {
    return () => {
      try {
        socketRef.current?.close();
      } catch {}

      try {
        mediaStreamRef.current?.getTracks().forEach(
          (track) => track.stop()
        );
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
     UI
  ======================================================= */

  return (
    <div className="app">

      {/* =================================================
          TOP HEADER
      ================================================= */}

      <header className="top-bar">

        <div className="brand-block">

          <div className="brand-mark">
            A
          </div>

          <div className="brand-text">

            <div className="brand-name">
              Aura Skincare
            </div>

            <div className="brand-subtitle">
              AI Voice Customer Support
            </div>

          </div>

        </div>

        <div className="connection-indicator">

          <span
            className={
              connected
                ? "connection-dot active"
                : "connection-dot"
            }
          />

          {connected ? "Live" : "Ready"}

        </div>

      </header>


      {/* =================================================
          MAIN APPLICATION
      ================================================= */}

      <main className="voice-shell">

        {/* =================================================
            LEFT VOICE AREA
        ================================================= */}

        <section className="voice-panel">

          <div className="voice-label">
            AURA AI
          </div>

          <h1 className="aria-title">
            Aria
          </h1>

          <p className="aria-description">
            Your Aura Skincare support specialist
          </p>


          {/* =================================================
              SATURN ORB
          ================================================= */}

          <div
            className={`orb-stage ${
              calling ? "is-active" : ""
            }`}
          >

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

            <div
              className={`aria-orb ${
                calling ? "active" : ""
              }`}
            >

              <div className="orb-light" />

              <div className="orb-letter">
                A
              </div>

            </div>


            {/* Status pill intentionally separated */}

            <div
              className={`voice-status ${
                calling ? "active" : ""
              }`}
            >

              <span className="status-dot" />

              {calling ? "Listening" : "Ready"}

            </div>

          </div>


          {/* =================================================
              STATUS TEXT
          ================================================= */}

          <div className="voice-message">

            <div className="voice-state">

              {calling
                ? "I'm listening..."
                : "Ready when you are"}

            </div>

            <div className="voice-hint">

              {calling
                ? "Speak naturally with Aria"
                : "Start a voice conversation"}

            </div>

          </div>


          {/* =================================================
              START / END BUTTON
          ================================================= */}

          <button
            className={
              calling
                ? "call-button end-call"
                : "call-button"
            }
            onClick={
              calling
                ? endCall
                : startCall
            }
          >

            <span className="button-icon">

              {calling ? "×" : "●"}

            </span>

            {calling
              ? "End Call"
              : "Start Call"}

          </button>

        </section>


        {/* =================================================
            RIGHT CONVERSATION PANEL
        ================================================= */}

        <section className="conversation-panel">

          <div className="conversation-header">

            <div className="conversation-title">

              <span
                className={
                  calling
                    ? "live-dot active"
                    : "live-dot"
                }
              />

              <span>
                Live conversation
              </span>

            </div>

            <div className="message-count">

              {messages.length}{" "}
              {messages.length === 1
                ? "message"
                : "messages"}

            </div>

          </div>


          {/* =================================================
              MESSAGES
          ================================================= */}

          <div className="messages-container">

            {messages.length === 0 ? (

              <div className="conversation-empty">

                <div className="mini-orb">
                  A
                </div>

                <h3>
                  Your conversation with Aria
                </h3>

                <p>
                  Start a call and your conversation
                  will appear here.
                </p>

                <span>
                  Try: "Where is my order ORD-101?"
                </span>

              </div>

            ) : (

              <div className="messages">

                {messages.map(
                  (message, index) => (

                    <div
                      key={index}
                      className={`message ${
                        message.speaker
                      }`}
                    >

                      <div className="message-label">

                        {message.speaker === "aria"
                          ? "ARIA"
                          : "YOU"}

                      </div>

                      <div className="message-text">
                        {message.text}
                      </div>

                    </div>

                  )
                )}

                <div ref={messagesEndRef} />

              </div>

            )}

          </div>


          {/* =================================================
              TEST ORDERS
          ================================================= */}

          <div className="orders-section">

            <div className="orders-heading">

              <span>
                Test orders
              </span>

              <span>
                Click an ID to preview
              </span>

            </div>

            <div className="orders-grid">

              <div className="order-card">

                <div className="order-top">

                  <strong>
                    ORD-101
                  </strong>

                  <span className="status-delivery">
                    Out for Delivery
                  </span>

                </div>

                <p>
                  Vitamin C Serum (30ml)
                </p>

              </div>


              <div className="order-card">

                <div className="order-top">

                  <strong>
                    ORD-102
                  </strong>

                  <span className="status-delivered">
                    Delivered
                  </span>

                </div>

                <p>
                  Hydrating Sunscreen SPF 50
                </p>

              </div>


              <div className="order-card">

                <div className="order-top">

                  <strong>
                    ORD-103
                  </strong>

                  <span className="status-processing">
                    Processing
                  </span>

                </div>

                <p>
                  Green Tea Face Wash + Toner
                </p>

              </div>

            </div>

          </div>

        </section>

      </main>


      {/* =================================================
          FOOTER
      ================================================= */}

      <footer className="app-footer">

        <span>
          ✦ Natural voice conversation
        </span>


      </footer>

    </div>
  );
}

export default App;