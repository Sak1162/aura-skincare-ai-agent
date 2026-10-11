const test = require("node:test");
const assert = require("node:assert/strict");

function mergeTranscriptChunk(currentText, newChunk) {
  if (!newChunk) return currentText || "";
  const cur = (currentText || "").trim();
  const chunk = newChunk.trim();
  if (!chunk) return cur;
  if (!cur) return chunk;

  // Case 1: Cumulative replacement
  if (chunk.toLowerCase().startsWith(cur.toLowerCase())) {
    return chunk;
  }

  // Case 2: Substring or duplicate already included
  if (cur.toLowerCase().includes(chunk.toLowerCase())) {
    return cur;
  }

  // Case 3: Overlapping words at boundary
  const curWords = cur.split(/\s+/);
  const chunkWords = chunk.split(/\s+/);

  let maxOverlap = 0;
  const maxCheck = Math.min(curWords.length, chunkWords.length);
  for (let i = 1; i <= maxCheck; i++) {
    const curEnd = curWords.slice(-i).join(" ").toLowerCase();
    const chunkStart = chunkWords.slice(0, i).join(" ").toLowerCase();
    if (curEnd === chunkStart) {
      maxOverlap = i;
    }
  }

  if (maxOverlap > 0) {
    const remainingChunkWords = chunkWords.slice(maxOverlap);
    if (remainingChunkWords.length === 0) return cur;
    return `${cur} ${remainingChunkWords.join(" ")}`;
  }

  // Case 4: Punctuation attachment
  if (/^[.,!?;:]/.test(chunk)) {
    return `${cur}${chunk}`;
  }

  return `${cur} ${chunk}`;
}

function accumulateTranscript(messages, incoming) {
  if (!incoming || !incoming.text || !incoming.text.trim()) {
    return messages;
  }

  const cleanText = incoming.text.trim();
  const lastIndex = messages.length - 1;

  if (lastIndex >= 0 && messages[lastIndex].speaker === incoming.speaker) {
    const updatedMessages = [...messages];
    const merged = mergeTranscriptChunk(updatedMessages[lastIndex].text, cleanText);
    updatedMessages[lastIndex] = {
      ...updatedMessages[lastIndex],
      text: merged,
    };
    return updatedMessages;
  }

  return [
    ...messages,
    {
      id: `msg-${messages.length + 1}`,
      speaker: incoming.speaker,
      text: cleanText,
      timestamp: incoming.timestamp || "12:00 PM",
    },
  ];
}

test("Transcript accumulator - Combines small fragments of same speaker into one coherent bubble", () => {
  let msgs = [];
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "Where" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "is" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "my order" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "ORD-101?" });

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, "Where is my order ORD-101?");
  assert.equal(msgs[0].speaker, "customer");
});

test("Transcript accumulator - Handles speaker turn alternation cleanly", () => {
  let msgs = [];
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "Hi Aria" });
  msgs = accumulateTranscript(msgs, { speaker: "aria", text: "Hey there" });
  msgs = accumulateTranscript(msgs, { speaker: "aria", text: "how can I help?" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "I need to check ORD-101" });

  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].speaker, "customer");
  assert.equal(msgs[0].text, "Hi Aria");
  assert.equal(msgs[1].speaker, "aria");
  assert.equal(msgs[1].text, "Hey there how can I help?");
  assert.equal(msgs[2].speaker, "customer");
  assert.equal(msgs[2].text, "I need to check ORD-101");
});

test("Transcript accumulator - Handles cumulative replacements without duplication", () => {
  let msgs = [];
  msgs = accumulateTranscript(msgs, { speaker: "aria", text: "Let me check" });
  msgs = accumulateTranscript(msgs, { speaker: "aria", text: "Let me check your order details" });

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, "Let me check your order details");
});

test("Transcript accumulator - Handles word overlaps without stuttering", () => {
  let msgs = [];
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "I want to track" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "track my parcel" });

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, "I want to track my parcel");
});

test("Transcript accumulator - Ignores empty or whitespace events", () => {
  let msgs = [];
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "Hello" });
  msgs = accumulateTranscript(msgs, { speaker: "customer", text: "   " });
  msgs = accumulateTranscript(msgs, null);

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, "Hello");
});
