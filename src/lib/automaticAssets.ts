import JSZip from "jszip";
import { z } from "zod";
import type { ImageAsset, ReferencePlanItem, Storyboard, VideoForm } from "../types";
import { generateJson } from "./gemini";
import { generateImage } from "./imageGeneration";
import { assetHandle, promptWithReferences, putAsset, readAssets, sceneReferences } from "./assetStore";

const planSchema = z.object({ assets: z.array(z.object({
  kind: z.enum(["character", "background"]), title: z.string().min(1).max(200),
  prompt: z.string().min(20).max(10000), sceneIds: z.array(z.string()).min(1),
})).min(1).max(12) });

export function validateReferencePlan(value: unknown, board: Storyboard): ReferencePlanItem[] {
  const plan = planSchema.parse(value).assets;
  const scenes = board.scenes.filter((scene) => !scene.locked && !scene.assetIds?.length);
  if (plan.some((item) => item.sceneIds.some((id) => !scenes.some((scene) => scene.id === id)))) throw new Error("Reference plan contains an unknown or protected scene.");
  for (const scene of scenes) {
    const linked = plan.filter((item) => item.sceneIds.includes(scene.id));
    if (!linked.some((item) => item.kind === "background") || linked.length > 3) throw new Error("Each scene needs a background and at most three reference images.");
  }
  return plan.map((item) => ({ ...item, id: crypto.randomUUID(), sceneIds: [...new Set(item.sceneIds)] }));
}

export async function prepareAutomaticAssets(board: Storyboard, form: VideoForm, projectId: string, apiKey: string, model: string,
  onBoard: (board: Storyboard) => void, onProgress: (message: string) => void, stopped: () => boolean): Promise<{ board: Storyboard; failed: string[] }> {
  let current = structuredClone(board);
  let plan = current.referencePlan;
  const scenes = current.scenes.filter((scene) => !scene.locked && !scene.assetIds?.length && !plan?.some((item) => item.sceneIds.includes(scene.id)));
  if (scenes.length) {
    onProgress("Planning recurring characters and locations…");
    const raw = await generateJson<unknown>(apiKey, model, [
      "Plan reusable character portraits and background plates for this storyboard. Return JSON only: {assets:[{kind:'character'|'background',title,prompt,sceneIds:[exact scene ID]}]}.",
      "Use at most 12 assets total and at most 3 per scene. Every scene needs a background. Include character references for visible recurring people; do not invent people for product-only or landscape shots. Reuse one asset across scenes for the same person/outfit or location. Describe face, hair, clothing, proportions for characters and geography, lighting and fixed props for backgrounds. Image prompts must be standalone English. Character portraits: full body, neutral backdrop. Backgrounds: no people. No text, labels, grids or watermark.",
      "Preserve the user's reference identities and constraints: " + form.referenceNotes,
      JSON.stringify({ topic: form.topic, style: form.visualStyle, visualBible: board.visualBible, scenes }),
    ].join("\n"), form.referenceImages);
    plan = [...(plan || []), ...validateReferencePlan(raw, { ...current, scenes })];
    if (plan.length > 12) throw new Error("This board already has twelve planned references. Reuse existing assets for additional scenes in Asset Studio.");
    current = { ...current, referencePlan: plan }; onBoard(current);
  }
  plan = plan || [];
  const stored = await readAssets();
  const ready = new Set(stored.filter((asset) => asset.projectId === projectId && asset.data).map((asset) => asset.id));
  const failed: string[] = [];
  for (const item of plan) {
    if (stopped()) break;
    if (!current.scenes.some((scene) => !scene.locked && item.sceneIds.includes(scene.id))) continue;
    if (!ready.has(item.id)) {
      onProgress("Creating " + item.kind + ": " + item.title);
      try {
        const prompt = "GENERATE ONE REFERENCE IMAGE NOW. NO TEXT IN THE IMAGE.\n" + item.prompt + "\nVisual style: " + form.visualStyle;
        const image = await generateImage(apiKey, prompt, item.kind === "character" ? "9:16" : form.aspectRatio, form.referenceImages);
        await putAsset({ ...image, id: item.id, kind: item.kind, title: item.title, prompt, projectId, createdAt: new Date().toISOString(), useAsReference: false });
        ready.add(item.id);
      } catch (error) { failed.push(item.title + ": " + (error instanceof Error ? error.message : "Image generation failed")); }
    }
    current = { ...current, scenes: current.scenes.map((scene) => {
      if (scene.locked || !item.sceneIds.includes(scene.id) || !ready.has(item.id)) return scene;
      const ids = [...new Set([...(scene.assetIds || []), item.id])];
      return ids.length <= 4 ? { ...scene, assetIds: ids } : scene;
    }) };
    onBoard(current);
  }
  return { board: current, failed };
}

export async function flowSceneBundle(board: Storyboard, assets: ImageAsset[]): Promise<Blob> {
  const zip = new JSZip();
  for (const scene of board.scenes) {
    const refs = sceneReferences(scene, assets);
    if (scene.assetIds?.some((id) => !refs.some((asset) => asset.id === id))) throw new Error("Scene " + scene.sceneNumber + " has a missing reference image.");
    if (board.referencePlan?.some((item) => item.sceneIds.includes(scene.id) && !refs.some((asset) => asset.id === item.id))) throw new Error("Finish or retry reference images for scene " + scene.sceneNumber + " before downloading.");
    const folder = zip.folder("scene-" + String(scene.sceneNumber).padStart(2, "0"))!;
    folder.file("prompt.txt", promptWithReferences(scene, assets));
    folder.file("voiceover.txt", scene.voiceover);
    for (const asset of refs) folder.file(assetHandle(asset).slice(1) + (asset.mimeType === "image/jpeg" ? ".jpg" : asset.mimeType === "image/webp" ? ".webp" : ".png"), asset.data, { base64: true });
  }
  zip.file("README.txt", "Each scene folder contains its Flow prompt and bound reference images. Upload those images in Google Flow, paste the prompt, choose compatible settings, and generate the video manually. Voiceover text is separate. This ZIP does not contain generated videos.");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
