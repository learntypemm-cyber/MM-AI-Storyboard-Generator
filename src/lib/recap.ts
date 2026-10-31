export type RecapLine = {
  id: string;
  start: number;
  end: number;
  source: string;
  burmese: string;
};

export type RecapDraft = {
  name: string;
  fileSize: number;
  duration: number;
  lines: RecapLine[];
  voice: string;
  updatedAt: string;
};

const DRAFT_KEY = "mm-recap-draft-v1";

export function readRecapDraft(): RecapDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) as RecapDraft : null;
  } catch { return null; }
}

export function saveRecapDraft(draft: RecapDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearRecapDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function srtTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const millis = Math.round((seconds - whole) * 1000);
  return `${String(Math.floor(whole / 3600)).padStart(2, "0")}:${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function recapSrt(lines: RecapLine[]): string {
  return lines.map((line, index) => `${index + 1}\n${srtTime(line.start)} --> ${srtTime(line.end)}\n${line.burmese.trim()}\n`).join("\n");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function geminiRequest(key: string, model: string, body: object): Promise<any> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Gemini request failed (${response.status}).`);
  return payload;
}

async function geminiJson(key: string, model: string, text: string): Promise<any> {
  const payload = await geminiRequest(key, model, {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });
  const raw = payload.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;
  if (!raw) throw new Error("Gemini did not return JSON.");
  return JSON.parse(raw);
}

export async function translateRecap(key: string, model: string, lines: RecapLine[], onBatch?: (current: RecapLine[], done: number) => void): Promise<RecapLine[]> {
  const result = [...lines];
  const memory = await geminiJson(key, model, [
    "Read the full recap transcript and return JSON {\"names\":[\"...\"],\"places\":[\"...\"],\"relationships\":[\"...\"],\"summary\":\"...\"}. Record only facts actually present. This memory will keep Burmese narration consistent.",
    JSON.stringify(lines.map(({ id, source }) => ({ id, source }))),
  ].join("\n"));
  for (let offset = 0; offset < lines.length; offset += 12) {
    const batch = lines.slice(offset, offset + 12);
    const parsed = await geminiJson(key, model, [
      "Translate every numbered narration line into natural spoken Burmese. Preserve names, facts, and order. Do not summarize or omit. Return JSON only as {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}]}. Keep IDs unchanged.",
      "STORY MEMORY: " + JSON.stringify(memory),
      JSON.stringify(batch.map(({ id, source }) => ({ id, source }))),
    ].join("\n")) as { translations?: { id: string; text: string }[] };
    const audit = await geminiJson(key, model, [
      "Audit these source and Burmese translation pairs. Correct any omission, invented fact, duplicate, shifted line or inconsistent name. Return EVERY line, even if already correct, as JSON {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}]}. Preserve IDs and order.",
      "STORY MEMORY: " + JSON.stringify(memory),
      JSON.stringify(batch.map((line) => ({ id: line.id, source: line.source, burmese: parsed.translations?.find((item) => item.id === line.id)?.text || "" }))),
    ].join("\n")) as { translations?: { id: string; text: string }[] };
    for (let index = 0; index < batch.length; index++) {
      const translated = audit.translations?.find((item) => item.id === batch[index].id)?.text?.trim();
      if (!translated) throw new Error(`Translation missing for line ${offset + index + 1}.`);
      result[offset + index] = { ...batch[index], burmese: translated };
    }
    onBatch?.([...result], Math.min(offset + batch.length, lines.length));
  }
  return result;
}

export async function generateBurmeseWav(key: string, text: string, voice: string): Promise<Blob> {
  const payload = await geminiRequest(key, "gemini-3.8-flash-tts", {
    contents: [{ role: "user", parts: [{ text: text.trim(), speech_metadata: { style: "Clear natural Burmese narration" } }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice } } },
  });
  const audio = payload.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData?.data)?.inlineData;
  if (!audio?.data) throw new Error("TTS returned no audio. Check that gemini-3.8-flash-tts is available for your API key.");
  const decoded = decodeBase64(audio.data);
  const bytes = new ArrayBuffer(decoded.length);
  new Uint8Array(bytes).set(decoded);
  return new Blob([bytes], { type: audio.mimeType || "audio/wav" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
