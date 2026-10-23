import { z } from "zod";
import type { ImageAsset, Scene, ShotBreakdown, Storyboard, VideoForm } from "../types";
import { assetHandle } from "./assetStore";

const promptText = z.string().trim().min(1).max(30000);
const generatedShotSchema = z.object({
  shotNumber: z.number().int().positive(),
  title: promptText,
  purpose: promptText,
  shotSize: promptText,
  cameraMovement: promptText,
  action: promptText,
  durationSeconds: z.number().positive().max(600),
  openingFrame: promptText,
  finalFrame: promptText,
  imagePrompt: promptText,
  flowPrompt: promptText,
  referenceAssets: z.array(z.string().trim().min(1).max(500)).max(20),
  negativePrompt: promptText,
  voiceover: z.string().max(30000),
  audioNotes: promptText,
  sfx: promptText,
  backgroundMusic: promptText,
});

export const shotBreakdownOutputSchema = z.object({
  shots: z.array(generatedShotSchema).min(2).max(4),
}).superRefine((value, context) => {
  const numbers = value.shots.map((shot) => shot.shotNumber);
  if (new Set(numbers).size !== numbers.length) {
    context.addIssue({ code: "custom", message: "Shot numbers must be unique." });
  }
});

export function shotBreakdownRequest(scene: Scene, board: Storyboard, form: VideoForm, assets: ImageAsset[] = []): string {
  const references = (board.referencePlan || [])
    .filter((reference) => !reference.sceneIds.length || reference.sceneIds.includes(scene.id))
    .map((reference) => {
      const asset = assets.find((item) => item.id === reference.id);
      return { id: reference.id, kind: reference.kind, title: reference.title, description: reference.prompt, handle: asset ? assetHandle(asset) : undefined };
    });
  const source = {
    projectTitle: board.projectTitle,
    visualBible: board.visualBible,
    continuityRules: board.continuityRules,
    globalNegativePrompt: board.globalNegativePrompt,
    scene: {
      sceneNumber: scene.sceneNumber, title: scene.title, durationSeconds: scene.durationSeconds,
      objective: scene.objective, visualDescription: scene.visualDescription, shotSize: scene.shotSize,
      cameraMovement: scene.cameraMovement, lighting: scene.lighting, mood: scene.mood, action: scene.action,
      flowPrompt: scene.flowPrompt, voiceover: scene.voiceover, audioNotes: scene.audioNotes,
      openingFrame: scene.openingFrame, finalFrame: scene.finalFrame, referenceAssets: scene.referenceAssets,
    },
    availableReferences: references,
    settings: {
      visualStyle: form.visualStyle, aspectRatio: form.aspectRatio, language: form.language,
      selectedFlowModel: form.flowModel, generationMode: form.generationMode, clipDurationSeconds: form.clipDuration,
      audioPolicy: form.audioPolicy, textPolicy: form.textPolicy,
    },
  };
  return [
    "You are a professional film director and Google Flow prompt engineer. Return valid JSON only: {shots:[...]}.",
    "Break the ONE supplied screenplay scene into 2 to 4 distinct, chronological, filmable shots. These shot cards are individual clip prompts the user will manually generate in Google Flow and assemble in an external video editor. Do not create images or videos.",
    "Preserve the original scene's story, character identities, wardrobe, props, location, dialogue and outcome. Do not invent characters, plot events, products or locations. Vary framing intentionally (establishing wide, medium action, close-up insert, or reaction) only when each angle adds a clear storytelling purpose. Avoid redundant coverage.",
    "Each shot must stand alone as a complete copy-paste English video prompt. Start flowPrompt with exactly 'NO TEXT IN THE IMAGE.' Include subject appearance, exact environment, one clear primary action, composition, shot size, camera movement, lighting, mood, temporal movement, and explicit opening and final frames. Never say 'same as the previous shot' or 'as before', and never rely on hidden model memory. Do not ask Flow to render camera labels, shot numbers, subtitles, readable UI, grids, reference labels or watermarks.",
    "Use 2 to 4 contiguous timed action ranges inside each flowPrompt, beginning at 00:00 and ending at 00:" + String(form.clipDuration).padStart(2, "0") + ". These are directions within one continuous setup, not a sequence of cuts; avoid camera resets. No gaps, overlaps or invented action. Time labels must never appear as visible text.",
    "When a provided reference has a handle, repeat that exact canonical @Handle in every applicable imagePrompt and flowPrompt; never invent, rename or alter a provided handle. Keep exact asset titles in referenceAssets. These prompts will be used with the matching reference image attachments.",
    "Also return imagePrompt for a pre-generation still QA gate. It must begin exactly with 'GENERATE THE STORYBOARD IMAGE NOW.' then direct the model to create exactly ONE opening-frame still, not a contact sheet, collage or video. Include 'NO TEXT IN THE IMAGE.' and preserve the provided identities, wardrobe, environment, props, lighting, composition, aspect ratio and attached reference images. The still should be reviewed before the user generates the video.",
    "Each shot durationSeconds must equal " + form.clipDuration + " seconds, matching the chosen Flow clip setting. Shots are separate clips; the user will manually trim and assemble them to keep the scene at approximately " + scene.durationSeconds + " seconds. Use aspect ratio " + form.aspectRatio + ". Do not put multiple hard cuts or different camera setups inside one shot prompt.",
    "Keep voiceover/dialogue in " + form.language + " and include it only if the supplied scene needs it. Technical fields and flowPrompt should be in precise natural English. Only use the supplied reference registry; list exact reference titles in referenceAssets. Include useful negativePrompt, audioNotes, sfx and backgroundMusic fields.",
    "Return exactly this structure. shotNumber starts at 1 and increases by one. Return every field:",
    '{"shots":[{"shotNumber":1,"title":"string","purpose":"string","shotSize":"string","cameraMovement":"string","action":"string","durationSeconds":' + form.clipDuration + ',"openingFrame":"string","finalFrame":"string","imagePrompt":"GENERATE THE STORYBOARD IMAGE NOW. Create one opening still. NO TEXT IN THE IMAGE. ...","flowPrompt":"NO TEXT IN THE IMAGE. ...","referenceAssets":["exact reference title"],"negativePrompt":"string","voiceover":"string","audioNotes":"string","sfx":"string","backgroundMusic":"string"}]}',
    "SOURCE DATA (use only this information):",
    JSON.stringify(source),
  ].join("\n");
}

export function shotImagePromptText(shot: ShotBreakdown, scene: Scene, board: Storyboard, form: VideoForm, assets: ImageAsset[] = []): string {
  if (shot.imagePrompt?.trim()) return shot.imagePrompt;
  const references = (board.referencePlan || [])
    .filter((reference) => !reference.sceneIds.length || reference.sceneIds.includes(scene.id))
    .map((reference) => {
      const asset = assets.find((item) => item.id === reference.id);
      return (asset ? assetHandle(asset) + " - " : "") + reference.kind + " " + reference.title + ": " + reference.prompt;
    });
  return [
    "GENERATE THE STORYBOARD IMAGE NOW.",
    "Create exactly ONE finished still image for the opening frame of Scene " + scene.sceneNumber + ", Shot " + shot.shotNumber + ". Do not create a contact sheet, collage, grid, storyboard layout or video.",
    "NO TEXT IN THE IMAGE. No captions, labels, watermarks, panel borders or generated typography.",
    "Shot title: " + shot.title,
    "Purpose: " + shot.purpose,
    "Opening frame: " + shot.openingFrame,
    "Subject action/state: " + shot.action,
    "Composition: " + shot.shotSize + ". Camera: " + shot.cameraMovement,
    "Project visual bible: " + board.visualBible,
    "Scene environment: " + scene.visualDescription,
    "Visual style: " + form.visualStyle + ". Aspect ratio: " + form.aspectRatio,
    "Approved reference descriptions (use attached images to preserve identity and design):\n" + references.join("\n"),
    "Avoid: " + [board.globalNegativePrompt, shot.negativePrompt, "extra people, duplicate subjects, text, logos, contact sheets, split panels"].filter(Boolean).join("; "),
  ].join("\n\n");
}

export function validateShotPrompt(shot: ShotBreakdown, form: VideoForm, board: Storyboard, scene: Scene, assets: ImageAsset[] = []): string[] {
  const prompt = (shot.flowPrompt || "").trim();
  const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const ranges = prompt.match(/\b\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\b/g) || [];
  const endTime = String(Math.floor(form.clipDuration / 60)).padStart(2, "0") + ":" + String(Math.floor(form.clipDuration % 60)).padStart(2, "0");
  const imagePrompt = shotImagePromptText(shot, scene, board, form, assets).trim();
  const issues: string[] = [];
  if (!/^NO TEXT IN THE IMAGE\./i.test(firstLine) && !/^INTENTIONAL TEXT IN THE IMAGE:\s*\S/i.test(firstLine)) issues.push("Add a text policy on the first line.");
  if (words < 80) issues.push("Video prompt is short; add subject, action, camera, lighting and continuity details.");
  if (!/opening frame|first frame/i.test(prompt)) issues.push("Opening-frame direction is missing.");
  if (!/final frame|last frame/i.test(prompt)) issues.push("Final-frame direction is missing.");
  if (ranges.length < 2 || !/00:00\s*[-–]/.test(prompt) || !ranges.some((range) => range.endsWith(endTime))) issues.push("Use contiguous time-coded action ranges from 00:00 through " + endTime + ".");
  if (/as before|same as (?:the )?previous|same person as|continue from previous shot/i.test(prompt)) issues.push("Replace vague previous-shot references with explicit details and attached references.");
  if (/(?:#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})\b|\b\d{3,4}\s?K\b)/i.test(prompt)) issues.push("Replace hex colours and Kelvin values with plain visual descriptions.");
  if (prompt.includes("—")) issues.push("Replace em dashes with a full stop, comma or regular hyphen.");
  const promptHandles = prompt.match(/@[A-Za-z0-9_-]+/g) || [];
  if (promptHandles.some((handle) => !/^@[A-Z][A-Za-z0-9]*$/.test(handle))) issues.push("Use canonical @PascalCase reference handles without spaces or hyphens.");
  if (!shot.title.trim() || !shot.action.trim()) issues.push("Shot title and action are required.");
  if (!/^GENERATE THE STORYBOARD IMAGE NOW\./i.test(imagePrompt)) issues.push("Opening still prompt must start with GENERATE THE STORYBOARD IMAGE NOW.");
  const requiredHandles = (board.referencePlan || [])
    .filter((reference) => !reference.sceneIds.length || reference.sceneIds.includes(scene.id))
    .filter((reference) => ["character", "background"].includes(reference.kind))
    .map((reference) => assets.find((asset) => asset.id === reference.id))
    .filter((asset): asset is ImageAsset => Boolean(asset))
    .map(assetHandle);
  for (const handle of requiredHandles) {
    if (!prompt.includes(handle)) issues.push("Video prompt should include the attached reference handle " + handle + ".");
    if (!imagePrompt.includes(handle)) issues.push("Opening still prompt should include the attached reference handle " + handle + ".");
  }
  const supportedDurations = form.flowModel === "Veo 3.1 Quality" ? [8] : form.flowModel === "Gemini Omni Flash 1.1" ? [4, 6, 8, 10] : [4, 6, 8];
  if (!supportedDurations.includes(form.clipDuration)) issues.push(form.flowModel + " is not listed with " + form.clipDuration + "s clips for this Flow workflow. Verify the active model options.");
  if (form.generationMode === "References to Video" && form.flowModel === "Veo 3.1 Quality") issues.push("References to Video is not listed for Veo 3.1 Quality.");
  if (form.generationMode === "References to Video" && form.flowModel !== "Gemini Omni Flash 1.1" && form.clipDuration !== 8) issues.push("Veo reference mode is listed as 8 seconds only.");
  if (form.generationMode === "Video Edit" && form.flowModel !== "Gemini Omni Flash 1.1") issues.push("Video Edit is currently listed for Gemini Omni Flash only; verify Flow.");
  if (form.generationMode === "Extend" && form.flowModel !== "Veo 3.1 Lite") issues.push("Extend should be checked with Veo 3.1 Lite in the active Flow UI.");
  if (shot.durationSeconds !== form.clipDuration) issues.push("Duration differs from the selected Flow clip length (" + form.clipDuration + "s). Check the active model's supported duration.");
  return issues;
}

export function shotPromptText(shot: ShotBreakdown, scene: Scene, board?: Storyboard, form?: VideoForm, assets: ImageAsset[] = []): string {
  const stillPrompt = board && form ? shotImagePromptText(shot, scene, board, form, assets) : (shot.imagePrompt || "GENERATE THE STORYBOARD IMAGE NOW. Create one opening still. NO TEXT IN THE IMAGE.");
  return [
    "SCENE " + String(scene.sceneNumber).padStart(2, "0") + " - " + scene.title,
    "SHOT " + String(shot.shotNumber).padStart(2, "0") + " - " + shot.title,
    "Purpose: " + shot.purpose,
    "Duration: " + shot.durationSeconds + " seconds",
    "Shot size: " + shot.shotSize,
    "Camera: " + shot.cameraMovement,
    "Opening frame: " + shot.openingFrame,
    "Final frame: " + shot.finalFrame,
    "OPENING STILL PROMPT",
    stillPrompt,
    "Still review status: " + (shot.imageApproved ? "APPROVED" : "NOT APPROVED - review the opening still in Google Flow before using the video prompt."),
    "References: " + (shot.referenceAssets.join("; ") || "Use the approved scene reference list."),
    "GOOGLE FLOW VIDEO PROMPT",
    shot.flowPrompt,
    "Negative prompt: " + shot.negativePrompt,
    "Voiceover: " + shot.voiceover,
    "Audio: " + shot.audioNotes,
    "SFX: " + shot.sfx,
    "Background music: " + shot.backgroundMusic,
  ].join("\n\n");
}

export function sceneShotsText(scene: Scene, board?: Storyboard, form?: VideoForm, assets: ImageAsset[] = []): string {
  const shots = scene.shots || [];
  if (!shots.length) return "Scene " + scene.sceneNumber + " - " + scene.title + "\nNo shot breakdown has been generated yet.";
  return shots.map((shot) => shotPromptText(shot, scene, board, form, assets)).join("\n\n----------------------------------------\n\n");
}

export function shotPackageText(board: Storyboard, form?: VideoForm, assets: ImageAsset[] = []): string {
  return [
    "MULTI-SHOT GOOGLE FLOW PROMPT PACKAGE",
    "Each shot is an independent prompt for manual generation in Google Flow. Review and approve its opening still first. Then generate video manually and assemble/trim clips in your video editor. Confirm the active Flow model settings.",
    "Project: " + board.projectTitle,
    "Story: " + board.logline,
    ...(board.scenes.filter((scene) => scene.shots?.length).map((scene) => sceneShotsText(scene, board, form, assets))),
  ].join("\n\n========================================\n\n");
}
