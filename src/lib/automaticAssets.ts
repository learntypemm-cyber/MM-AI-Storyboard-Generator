import JSZip from "jszip";
import { z } from "zod";
import type { ImageAsset, ReferencePlanItem, Storyboard, VideoForm } from "../types";
import { generateJson } from "./gemini";
import { generateImage } from "./imageGeneration";
import { assetHandle, promptWithReferences, putAsset, readAssets, sceneReferences } from "./assetStore";

const planSchema = z.object({ assets: z.array(z.object({
  kind: z.enum(["character", "background", "prop"]), title: z.string().min(1).max(200),
  prompt: z.string().min(20).max(10000), sceneIds: z.array(z.string()).min(1),
})).max(12) });

export function validateReferencePlan(value: unknown, board: Storyboard): ReferencePlanItem[] {
  const plan = planSchema.parse(value).assets;
  const scenes = board.scenes.filter((scene) => !scene.locked && !scene.assetIds?.length);
  if (plan.some((item) => item.sceneIds.some((id) => !scenes.some((scene) => scene.id === id)))) throw new Error("Reference plan contains an unknown or protected scene.");
  for (const scene of scenes) {
    const linked = plan.filter((item) => item.sceneIds.includes(scene.id));
    if (linked.length > 3) throw new Error("Each scene can use at most three reference images.");
  }
  return plan.map((item) => ({ ...item, id: crypto.randomUUID(), sceneIds: [...new Set(item.sceneIds)] }));
}

export function referenceImagePrompt(item: ReferencePlanItem, form: VideoForm): string {
  return [
    "GENERATE ONE FINISHED REFERENCE IMAGE NOW. NO TEXT IN THE IMAGE.",
    "Create a single image, not a written plan, collage, grid or storyboard.",
    "Reference: " + item.title + ". Type: " + item.kind + ".",
    item.prompt,
    item.kind === "character" ? "Full-body character portrait on a neutral backdrop. Clearly show the face, hair, outfit, shoes and accessories. Preserve identity and wardrobe from any supplied reference image." : item.kind === "prop" ? "Single product or prop reference on a neutral backdrop. Preserve exact shape, material, color and defining details. No people or invented branding." : "Single full-frame environment plate. Preserve layout, materials, props, perspective and lighting. No people, characters or silhouettes.",
    "Visual style: " + form.visualStyle + ". Aspect ratio: " + (item.kind === "character" ? "9:16" : form.aspectRatio) + ".",
    "No captions, labels, watermarks, duplicate subjects or unrelated objects.",
    form.referenceNotes ? "User reference requirements: " + form.referenceNotes : "",
  ].filter(Boolean).join("\n\n");
}

export function referencePromptPack(board: Storyboard, form: VideoForm): string {
  if (!board.referencePlan?.length) throw new Error("Prepare reference prompts first.");
  return "FLOW REFERENCE IMAGE PROMPTS\nGenerate these images in Flow, then reuse each image in the scenes listed below.\n\n" + board.referencePlan.map((item) =>
    ({ character: "C", background: "B", prop: "P" }[item.kind]) + String(board.referencePlan!.filter((entry) => entry.kind === item.kind).findIndex((entry) => entry.id === item.id) + 1).padStart(2, "0") + ": " + item.title + " (" + item.kind + ")\nUse in scenes: " + board.scenes.filter((scene) => item.sceneIds.includes(scene.id)).map((scene) => scene.sceneNumber + " - " + scene.title).join(", ") + "\n\n" + referenceImagePrompt(item, form)
  ).join("\n\n--------------------\n\n");
}

export async function prepareAutomaticAssets(board: Storyboard, form: VideoForm, projectId: string, apiKey: string, model: string,
  onBoard: (board: Storyboard) => void, onProgress: (message: string) => void, stopped: () => boolean, promptsOnly = false): Promise<{ board: Storyboard; failed: string[] }> {
  let current = structuredClone(board);
  let plan = current.referencePlan;
  // Prompt planning does not change scene text, locks, or bound images.
  const scenes = promptsOnly ? current.scenes.map((scene) => ({ ...scene, locked: false, assetIds: [] })) : current.scenes.filter((scene) => !scene.locked && !scene.assetIds?.length && !plan?.some((item) => item.sceneIds.includes(scene.id)));
  if (scenes.length) {
    onProgress("Planning recurring characters and locations…");
    const raw = await generateJson<unknown>(apiKey, model, [
      "Plan reusable character portraits, important product/prop images and background plates for this storyboard. Return JSON only: {assets:[{kind:'character'|'background'|'prop',title,prompt,sceneIds:[exact scene ID]}]}.",
      "Use at most 12 assets total and at most 3 per scene. Only create reusable references that are necessary for consistency. A simple standalone landscape or abstract shot can have no references. Use kind prop for important recurring products/objects; do not create a separate prop for every incidental object. Inspect every scene visualDescription, action and flowPrompt for visible characters, including people, animals and fictional characters. Include a character reference for each distinct visible character even if they appear in only one scene; do not invent people for product-only or landscape shots. Reuse one asset across scenes for the same person/outfit or location. Describe face, hair, clothing, proportions for characters and geography, lighting and fixed props for backgrounds. Image prompts must be standalone English. Character portraits: full body, neutral backdrop. Backgrounds: no people. No text, labels, grids or watermark.",
      "Preserve the user's reference identities and constraints: " + form.referenceNotes,
      "Existing references must be preserved. Return only missing references or additional scene links for an existing reference, using its exact kind, title and identity. Do not rename or duplicate an existing character. Existing references: " + JSON.stringify(plan || []),
      JSON.stringify({ topic: form.topic, style: form.visualStyle, visualBible: board.visualBible, scenes }),
    ].join("\n"), form.referenceImages);
    const additions = validateReferencePlan(raw, { ...current, scenes });
    plan = structuredClone(plan || []);
    for (const item of additions) {
      const existing = plan.find((entry) => entry.kind === item.kind && entry.title.trim().toLowerCase() === item.title.trim().toLowerCase());
      if (existing) existing.sceneIds = [...new Set([...existing.sceneIds, ...item.sceneIds])];
      else plan.push(item);
    }
    for (const scene of scenes) {
      if (plan.filter((item) => item.sceneIds.includes(scene.id)).length > 3) throw new Error("Each scene can use at most three reference images. Existing prompts were preserved; reduce references before retrying.");
    }
    if (plan.length > 12) throw new Error("This board already has twelve planned references. Reuse existing assets for additional scenes in Asset Studio.");
    current = { ...current, referencePlan: plan }; onBoard(current);
  }
  if (promptsOnly) return { board: current, failed: [] };
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
        const prompt = referenceImagePrompt(item, form);
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
