import type { ReferenceImage } from "../types";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

function extractJson(text: string): unknown {
  const fence = String.fromCharCode(96).repeat(3);
  const cleaned = text.trim().replace(/^\uFEFF/, "")
    .replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*" + fence + "$"), "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Gemini returned invalid JSON. Please try again.");
  }
}

export async function generateJson<T>(
  apiKey: string, model: string, prompt: string,
  referenceImages: ReferenceImage[] = [], signal?: AbortSignal,
): Promise<T> {
  const parts: GeminiPart[] = [{ text: prompt }];
  referenceImages.forEach((image) => {
    if (image.data && image.mimeType.startsWith("image/")) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  });
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.75 } }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; status?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    const message = payload.error?.message || ("Gemini request failed (" + response.status + ").");
    if (response.status === 400 || response.status === 404) throw new Error(message + " Check the model name in Settings and confirm that it is available to your API key.");
    if (response.status === 401 || response.status === 403) throw new Error(message + " Check your Gemini API key and API access.");
    throw new Error(message);
  }
  const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n");
  if (!output) throw new Error("Gemini returned no text. Try again with a shorter topic.");
  return extractJson(output) as T;
}
