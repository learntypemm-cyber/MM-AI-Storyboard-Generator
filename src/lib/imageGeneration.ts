import type { ReferenceImage, VideoForm } from "../types";
export const IMAGE_MODEL = "gemini-nano-banana-2.1";
const MAX_REFERENCES = 4;
type ApiImage = { type?: string; data?: string; mime_type?: string; mimeType?: string };
type ApiResponse = {
  error?: { message?: string; status?: string };
  output_image?: ApiImage; outputImage?: ApiImage;
  interaction?: { output_image?: ApiImage; outputImage?: ApiImage };
  steps?: Array<{ type?: string; content?: ApiImage[]; output?: ApiImage[] }>;
  output?: ApiImage[];
};
function findOutputImage(payload: ApiResponse): ApiImage | undefined {
  const direct = payload.output_image || payload.outputImage || payload.interaction?.output_image || payload.interaction?.outputImage;
  if (direct?.data) return direct;
  for (const step of payload.steps || []) {
    for (const item of [...(step.content || []), ...(step.output || [])]) {
      if (item.data && (!item.type || item.type === "image")) return item;
    }
  }
  return (payload.output || []).find((item) => item.data && (!item.type || item.type === "image"));
}
export async function generateImage(apiKey: string, prompt: string, aspectRatio: VideoForm["aspectRatio"], references: ReferenceImage[]): Promise<{ data: string; mimeType: string }> {
  if (references.length > MAX_REFERENCES) throw new Error("Choose at most four reference images. Remove extra references before generating.");
  if (!apiKey.trim()) throw new Error("Add your Gemini API key in Settings first, then reopen Asset Studio.");
  const input: Array<Record<string, string>> = [{ type: "text", text: prompt }];
  references.slice(0, MAX_REFERENCES).forEach((image) => {
    if (image.data && image.mimeType.startsWith("image/")) input.push({ type: "image", mime_type: image.mimeType, data: image.data });
  });
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
    body: JSON.stringify({
      model: IMAGE_MODEL, input,
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: aspectRatio, image_size: "1K" }
    })
  });
  const payload = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok) {
    const message = payload.error?.message || ("Gemini image generation failed (" + response.status + ").");
    if (response.status === 401 || response.status === 403) throw new Error(message + " Check your Gemini API key and image-model access in Google AI Studio.");
    if (response.status === 404) throw new Error(message + " This image model may not be available to this key or region.");
    throw new Error(message);
  }
  const image = findOutputImage(payload);
  if (!image?.data) throw new Error("Gemini returned no image. Try a shorter prompt or a simpler reference image.");
  return { data: image.data, mimeType: image.mime_type || image.mimeType || "image/png" };
}
