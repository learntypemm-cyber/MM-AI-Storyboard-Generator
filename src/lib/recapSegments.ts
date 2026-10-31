import type { RecapLine } from "./recap";

export type WhisperChunk = { text?: string; timestamp?: [number, number | null] };

/** Keep short narration units so translation, TTS and timing can be reviewed line by line. */
export function groupWhisperWords(chunks: WhisperChunk[]): RecapLine[] {
  const words = chunks.filter((chunk) => {
    const [start, end] = chunk.timestamp || [];
    return Boolean(chunk.text?.trim()) && Number.isFinite(start) && Number.isFinite(end) && Number(end) > Number(start);
  });
  const lines: RecapLine[] = [];
  let first = 0;
  let text = "";
  let lastEnd = 0;
  function flush() {
    const source = text.trim();
    if (source) lines.push({ id: `line-${lines.length + 1}`, start: first, end: lastEnd, source, burmese: "" });
    text = "";
  }
  for (const word of words) {
    const start = Number(word.timestamp![0]);
    const end = Number(word.timestamp![1]);
    if (text && start - lastEnd >= 0.8) flush();
    if (!text) first = start;
    text += word.text;
    lastEnd = end;
    const span = end - first;
    if (span >= 5.6 || (span >= 1.5 && /[.!?。！？]$/.test(text.trim())) || span >= 4.2) flush();
  }
  flush();
  return lines;
}
