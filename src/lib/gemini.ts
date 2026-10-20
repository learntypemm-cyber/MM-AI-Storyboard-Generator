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

export async function testGeminiModel(apiKey: string, modelInput: string): Promise<{ modelId: string; displayName: string }> {
  const key = apiKey.trim();
  if (!key) throw new Error("Enter your Gemini API key first.");
  const modelId = normalizeGeminiModelName(modelInput);
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelId);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { "x-goog-api-key": key }
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; status?: string };
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  };

  if (!response.ok) {
    const message = payload.error?.message || ("Gemini model check failed (" + response.status + ").");
    if (response.status === 400 || response.status === 404) {
      throw new Error('Model "' + modelId + '" was not found for this API key. Open Settings and refresh the model list.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(message + " Check the key was copied completely and that it is a current Gemini API auth key with access to the Generative Language API.");
    }
    throw new Error(message);
  }

  const methods = payload.supportedGenerationMethods;
  if (Array.isArray(methods) && !methods.includes("generateContent")) {
    throw new Error('Model "' + modelId + '" is available but does not support generateContent.');
  }
  return { modelId, displayName: payload.displayName || payload.name || modelId };
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
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; status?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    const message = payload.error?.message || ("Gemini request failed (" + response.status + ").");
    if (response.status === 400 || response.status === 404) throw new Error(message + ' Requested model: "' + modelId + '". Open Settings and select another model from the refreshed list.');
    if (response.status === 401 || response.status === 403) throw new Error(message + " Check your Gemini API key and API access.");
    throw new Error(message);
  }
  const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n");
  if (!output) throw new Error("Gemini returned no text. Try again with a shorter topic.");
  return extractJson(output) as T;
}
