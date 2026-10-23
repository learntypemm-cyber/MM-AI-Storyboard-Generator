import { screenplayWorkflowSchema } from "./screenplayWorkflow";
import JSZip from "jszip";
import { z } from "zod";
import type { ImageAsset, ProductionPreset, ReferenceImage, SavedProject } from "../types";

const text = z.string().max(100_000);
const id = z.string().min(1).max(200);
const image = z.object({ name: text, mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i), data: z.string().max(30_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) });
const scene = z.object({
  fullImagePrompt: text.optional(), fullVideoPrompt: text.optional(), fullPromptSource: text.optional(),
  backgroundAngle: z.enum(["A", "B", "C", "D"]).optional(), sfx: text.optional(), backgroundMusic: text.optional(),
  shots: z.array(z.object({
    id, shotNumber: z.number().int().positive(), title: text, purpose: text, shotSize: text, cameraMovement: text,
    action: text, durationSeconds: z.number().positive().max(600), openingFrame: text, finalFrame: text, imagePrompt: text.optional(), imageApproved: z.boolean().optional(), flowPrompt: text,
    referenceAssets: z.array(text).max(20), negativePrompt: text, voiceover: text, audioNotes: text, sfx: text, backgroundMusic: text,
  })).max(4).optional(),
  preparationMode: z.enum(["text-to-video", "image-to-video"]).optional(),
  id, sceneNumber: z.number().int().positive(), title: text, durationSeconds: z.number().positive().max(600), objective: text,
  visualDescription: text, shotSize: text, cameraMovement: text, lighting: text, mood: text, action: text, flowPrompt: text,
  voiceover: text, onscreenText: text, audioNotes: text, transition: text, referenceAssets: z.array(text).max(100),
  negativePrompt: text, openingFrame: text, finalFrame: text, handoff: z.enum(["CUT", "CONTINUATION"]),
  locked: z.boolean().optional(), reviewStatus: z.enum(["draft", "review", "approved"]).optional(), reviewNotes: text.optional(), assetIds: z.array(id).max(4).optional(),
});
const board = z.object({ pipelineSource: z.string().max(3000000).optional(), promptLanguage: z.literal("my").optional(), englishSource: z.string().max(2000000).optional(), englishJson: z.string().max(2000000).optional(), referencePlan: z.array(z.object({ id, kind: z.enum(["character", "background", "prop"]), title: text, prompt: text, fullPrompt: text.optional(), fullPromptSource: text.optional(), sceneIds: z.array(id).max(200) })).max(12).optional(), projectTitle: text, logline: text, visualBible: text, continuityRules: z.array(text), globalNegativePrompt: text, productionNotes: z.array(text), scenes: z.array(scene).max(200) });
export const presetSettingsSchema = z.object({
  goal: text, platform: z.enum(["TikTok", "Facebook Reels", "YouTube Shorts", "YouTube"]), targetDuration: z.number().positive().max(7200),
  language: z.enum(["Burmese", "English", "Burmese + English"]), audience: text,
  visualStyle: z.enum(["Realistic tutorial", "Cinematic live action", "3D animation", "2D motion graphics", "Presenter-led", "Fast-paced social video"]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]), flowModel: z.enum(["Veo 3.1 Fast", "Veo 3.1 Lite", "Veo 3.1 Quality", "Gemini Omni Flash 1.1"]),
  generationMode: z.enum(["Text to Video", "First Frame", "First and Last Frame", "References to Video", "Video Edit", "Extend"]),
  clipDuration: z.number().positive().max(600), audioPolicy: text, textPolicy: text, referenceNotes: text,
});
export const presetSchema = z.object({ id, name: z.string().min(1).max(100), settings: presetSettingsSchema });
const conceptSchema = z.object({ id, title: text, style: text, hook: text, summary: text, visualDirection: text, whyItWorks: text, storyArc: z.array(text), estimatedDuration: z.number().positive() });
const projectSchema = z.object({
  screenplay: screenplayWorkflowSchema.optional(),
  id, title: text, savedAt: text, form: presetSettingsSchema.extend({ topic: text }),
  concepts: z.array(conceptSchema).max(20),
  selectedConceptId: text, storyboard: board.nullable(),
  history: z.array(z.object({ id, label: text, createdAt: text, storyboard: board, concept: conceptSchema.optional(), form: presetSettingsSchema.extend({ topic: text }).optional() })).max(30).optional(),
});
const assetSchema = z.object({
  handle: z.string().regex(/^@[A-Z][A-Za-z0-9]*$/).optional(),
  id, kind: z.enum(["character", "background", "prop", "scene"]), title: text, prompt: text, promptMy: text.optional(), promptEn: text.optional(), mimeType: image.shape.mimeType,
  data: image.shape.data, createdAt: text, useAsReference: z.boolean(), projectId: id.optional(), sceneId: id.optional(), sceneNumber: z.number().int().positive().optional(),
});
const archiveSchema = z.object({ format: z.literal("mm-storyboard"), version: z.literal(1), project: projectSchema, references: z.array(image).max(4), assets: z.array(assetSchema).max(500), presets: z.array(presetSchema).max(50) });
export type ProjectArchive = { format: "mm-storyboard"; version: 1; project: SavedProject; references: ReferenceImage[]; assets: ImageAsset[]; presets: ProductionPreset[] };

export async function createArchive(value: ProjectArchive): Promise<Blob> {
  const clean = archiveSchema.parse(value); // Strips unknown properties, including accidental credentials.
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(clean));
  zip.file("README.txt", "Restore this ZIP using Import ZIP in MM Storyboard. Includes project, versions, reference images, assets and presets. API keys and ComfyUI settings are excluded.\nImages are embedded in project.json for portable restoration.");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
export async function readArchive(file: File): Promise<ProjectArchive> {
  if (file.size > 200 * 1024 * 1024) throw new Error("Choose a backup smaller than 200 MB.");
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("project.json");
  if (!entry) throw new Error("This ZIP is missing project.json.");
  // Check the declared uncompressed size before inflating a potentially huge archive.
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof size !== "number" || size > 250 * 1024 * 1024) throw new Error("Backup contents exceed the 250 MB restore limit.");
  const value = archiveSchema.safeParse(JSON.parse(await entry.async("string")));
  if (!value.success) throw new Error("Invalid or unsupported storyboard backup. No project data was changed.");
  const result = value.data;
  const ids = result.assets.map((asset) => asset.id);
  if (new Set(ids).size !== ids.length) throw new Error("Backup contains duplicate asset IDs.");
  for (const board of [result.project.storyboard, ...(result.project.history || []).map((version) => version.storyboard)]) {
    if (!board) continue;
    if (new Set(board.scenes.map((scene) => scene.id)).size !== board.scenes.length) throw new Error("Backup contains duplicate scene IDs.");
    if (board.scenes.some((scene) => scene.assetIds?.some((assetId) => !ids.includes(assetId)))) throw new Error("Backup is missing a linked reference asset.");
  }
  return { ...result, references: result.references.map((ref) => ({ ...ref, previewUrl: `data:${ref.mimeType};base64,${ref.data}` })) };
}

export { board as storyboardSchema };
