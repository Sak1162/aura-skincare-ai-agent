/**
 * Transcript Accumulator Utility
 * Merges streaming speech fragments into coherent speaker turns.
 */

export function mergeTranscriptChunk(currentText, newChunk) {
  if (!newChunk) return currentText || "";
  const cur = (currentText || "").trim();
  const chunk = newChunk.trim();
  if (!chunk) return cur;
  if (!cur) return chunk;

  // Case 1: Cumulative replacement (chunk contains or extends cur from start)
  if (chunk.toLowerCase().startsWith(cur.toLowerCase())) {
    return chunk;
  }

  // Case 2: Substring or duplicate already included in cur
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

  // Case 4: Punctuation attachment without extra space
  if (/^[.,!?;:]/.test(chunk)) {
    return `${cur}${chunk}`;
  }

  return `${cur} ${chunk}`;
}

export function accumulateTranscript(messages, incoming) {
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

  const timestamp =
    incoming.timestamp ||
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return [
    ...messages,
    {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      speaker: incoming.speaker,
      text: cleanText,
      timestamp,
    },
  ];
}
