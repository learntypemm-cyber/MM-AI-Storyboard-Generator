import type { ReferenceImage } from "../types";

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export function normalizeGeminiModelName(value: string): string {
  let model = value.trim();
  if (!model) model = "gemini-3.8-flash";

  // Accept an API model ID, models/<id>, or a full Gemini API URL.
  const cleanInput = model.split("?")[0].split("#")[0];
  const lowerInput = cleanInput.toLowerCase();
  const marker = "models/";
  const markerIndex = lowerInput.lastIndexOf(marker);
  if (markerIndex >= 0) {
    model = cleanInput.slice(markerIndex + marker.length);
  } else if (cleanInput.includes("/")) {
    throw new Error('Invalid Gemini model name. Enter an API model ID such as "gemini-3.8-flash" or a full Gemini models URL.');
  } else {
    model = cleanInput;
  }

  const suffix = ":generateContent";
  if (model.toLowerCase().endsWith(suffix)) model = model.slice(0, -suffix.length);
  model = model.trim().toLowerCase().replace(/\s+/g, "-");

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(model)) {
    throw new Error('Invalid Gemini model name. Enter an API model ID such as "gemini-3.8-flash" without a URL, "models/" prefix, or ":generateContent" suffix.');
  }
  return model;
}
type GeminiModelInfo = {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

export type GeminiModelOption = { id: string; displayName: string };

// Model metadata is discovery, not a guarantee of quota or JSON-generation access.
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<GeminiModelOption[]> {
  if (!apiKey.trim()) throw new Error("Add your Gemini API key to load models.");
  const models = new Map<string, GeminiModelOption>();
  const seen = new Set<string>();
  let token = "";
  do {
    const params = new URLSearchParams({ pageSize: "1000" });
    if (token) params.set("pageToken", token);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?" + params, {
      headers: { "x-goog-api-key": apiKey.trim() }, signal,
    });
    const data = await response.json() as { models?: GeminiModelInfo[]; nextPageToken?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || "Could not load models. Check your API key and try again.");
    for (const item of data.models || []) {
      const id = item.name?.replace(/^models\//, "");
      if (!id?.startsWith("gemini-") || !item.supportedGenerationMethods?.includes("generateContent")) continue;
      if (/(image|tts|audio|live|robotics|computer-use)/i.test(id)) continue;
      models.set(id, { id, displayName: item.displayName || id });
    }
    token = data.nextPageToken || "";
    if (token && seen.has(token)) throw new Error("Model list could not finish loading. Please refresh.");
    seen.add(token);
  } while (token);
  const result = [...models.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!result.length) throw new Error("No compatible Gemini text models were listed for this key.");
  return result;
}

export type GeminiModelCheckStatus = "ready" | "quota" | "unavailable" | "key-error" | "error";

export type GeminiModelCheck = {
  modelId: string;
  displayName: string;
  status: GeminiModelCheckStatus;
  message: string;
  durationMs: number;
};

// Model-list metadata does not prove that generation works right now.
// Probe with a deliberately tiny live generation request.
export async function probeGeminiModel(apiKey: string, modelInput: string): Promise<GeminiModelCheck> {
  const startedAt = Date.now();
  let modelId = modelInput;
  let displayName = modelInput;
  try {
    const key = apiKey.trim();
    if (!key) {
      return { modelId, displayName, status: "key-error", message: "Enter your Gemini API key first.", durationMs: Date.now() - startedAt };
    }
    modelId = normalizeGeminiModelName(modelInput);
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelId) + ":generateContent";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly OK." }] }],
        generationConfig: { maxOutputTokens: 8, temperature: 0 },
      }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string; status?: string; code?: number };
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawMessage = payload.error?.message || ("Gemini model test failed (" + response.status + ").");
    const lowerMessage = rawMessage.toLowerCase();
    const keyRejected = response.status === 401
      || /api[_ ]key.*(invalid|not valid|rejected)|invalid.*api[_ ]key|api_key_invalid/.test(lowerMessage);
    displayName = modelId;

    if (!response.ok) {
      if (keyRejected) {
        return { modelId, displayName, status: "key-error", message: rawMessage + " Check that the key is copied completely and is enabled for the Gemini API.", durationMs: Date.now() - startedAt };
      }
      if (response.status === 429 || payload.error?.status === "RESOURCE_EXHAUSTED" || /quota|rate.?limit|resource exhausted/i.test(rawMessage)) {
        return { modelId, displayName, status: "quota", message: "Quota or rate limit reached for this request. Try again later; this model cannot be confirmed as usable right now. " + rawMessage, durationMs: Date.now() - startedAt };
      }
      if ([400, 403, 404].includes(response.status)) {
        return { modelId, displayName, status: "unavailable", message: rawMessage + " This model may not be available to generate content with this key.", durationMs: Date.now() - startedAt };
      }
      return { modelId, displayName, status: "error", message: rawMessage, durationMs: Date.now() - startedAt };
    }

    const candidate = payload.candidates?.[0];
    const generatedText = candidate?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (generatedText) {
      return { modelId, displayName, status: "ready", message: "Live text-generation test succeeded.", durationMs: Date.now() - startedAt };
    }
    if (candidate?.finishReason === "SAFETY") {
      return { modelId, displayName, status: "error", message: "The test prompt was blocked by a safety filter. This does not necessarily mean the model is unavailable.", durationMs: Date.now() - startedAt };
    }
    return { modelId, displayName, status: "error", message: "The API responded, but returned no text for this test request.", durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      modelId,
      displayName,
      status: "error",
      message: error instanceof Error ? error.message : "Could not test this model.",
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function testGeminiModel(apiKey: string, modelInput: string): Promise<{ modelId: string; displayName: string }> {
  const result = await probeGeminiModel(apiKey, modelInput);
  if (result.status !== "ready") throw new Error(result.message);
  return { modelId: result.modelId, displayName: result.displayName };
}

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
  const modelId = normalizeGeminiModelName(model);
  const parts: GeminiPart[] = [{ text: prompt }];
  referenceImages.forEach((image) => {
    if (image.data && image.mimeType.startsWith("image/")) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  });
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelId) + ":generateContent";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 16384 },
    }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; status?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    const message = payload.error?.message || ("Gemini request failed (" + response.status + ").");
    if (response.status === 400 || response.status === 404) throw new Error(message + ' Requested model: "' + modelId + '". Open Settings and select another model from the refreshed list.');
    if (response.status === 401 || response.status === 403) throw new Error(message + " Check your Gemini API key and API access.");
    throw new Error(message);
  }
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini reached the output token limit before finishing the JSON. The app now allows up to 16,384 output tokens; try generating fewer scenes or choose a model with a larger output limit.");
  }
  const output = candidate?.content?.parts?.map((part) => part.text || "").join("\n");
  if (!output) {
    if (candidate?.finishReason === "SAFETY") throw new Error("Gemini blocked this response with its safety filter. Rephrase the topic or reference notes and try again.");
    throw new Error("Gemini returned no text. Try again with a shorter topic.");
  }
  try {
    return extractJson(output) as T;
  } catch (error) {
    if (error instanceof Error && /invalid JSON/i.test(error.message)) {
      throw new Error("Gemini returned incomplete JSON, so the prompt package was not accepted. Try again or choose a model with a larger output limit.");
    }
    throw error;
  }
}
