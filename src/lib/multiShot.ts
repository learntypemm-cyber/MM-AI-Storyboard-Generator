import { z } from "zod";
import type { Scene, ShotBreakdown, Storyboard, VideoForm } from "../types";

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

export function shotBreakdownRequest(scene: Scene, board: Storyboard, form: VideoForm): string {
  const references = (board.referencePlan || [])
    .filter((reference) => !reference.sceneIds.length || reference.sceneIds.includes(scene.id))
    .map((reference) => ({ id: reference.id, kind: reference.kind, title: reference.title, description: reference.prompt }));
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
    "Preserve the original scene's story, character identities, wardrobe, props, location, dialogue and outcome. Do not invent characters, plot events, products or locations. Vary framing intentionally (for example establishing wide, medium action, close-up insert, reaction), but only when each angle adds a clear storytelling purpose. Avoid redundant coverage.",
    "Each shot must stand alone as a complete copy-paste English prompt. Start flowPrompt with exactly 'NO TEXT IN THE IMAGE.' Include subject appearance, exact environment, a single clear primary action, composition, shot size, camera movement, lighting, mood, temporal movement, and an explicit opening and final frame. Never say 'same as the previous shot', 'as before', or rely on hidden model memory. Do not ask the model to render camera labels, shot numbers, subtitles, readable UI, grids, reference labels or watermarks.",
    "Each shot durationSeconds must equal " + form.clipDuration + " seconds, matching the chosen Flow clip setting. Shots are generated as separate clips; the user will manually trim and assemble them to keep the final scene at approximately " + scene.durationSeconds + " seconds. Use the requested aspect ratio " + form.aspectRatio + ". Do not put multiple hard cuts or multiple different camera setups inside one shot prompt.",
    "Keep voiceover/dialogue in " + form.language + " and include it only if the supplied scene needs it. Technical fields and flowPrompt should be in precise natural English. Keep references limited to the provided reference registry and list their exact titles in referenceAssets. Include useful negativePrompt, audioNotes, sfx and backgroundMusic fields.",
    "Return exactly this structure. shotNumber must start at 1 and increase by one. Return every field, with strings for text fields and a number for durationSeconds:",
    '{"shots":[{"shotNumber":1,"title":"string","purpose":"string","shotSize":"string","cameraMovement":"string","action":"string","durationSeconds":' + form.clipDuration + ',"openingFrame":"string","finalFrame":"string","flowPrompt":"NO TEXT IN THE IMAGE. ...","referenceAssets":["exact reference title"],"negativePrompt":"string","voiceover":"string","audioNotes":"string","sfx":"string","backgroundMusic":"string"}]}',
    "SOURCE DATA (use only this information):",
    JSON.stringify(source),
  ].join("\n");
}

export function shotPromptText(shot: ShotBreakdown, scene: Scene): string {
  return [
    "SCENE " + String(scene.sceneNumber).padStart(2, "0") + " — " + scene.title,
    "SHOT " + String(shot.shotNumber).padStart(2, "0") + " — " + shot.title,
    "Purpose: " + shot.purpose,
    "Duration: " + shot.durationSeconds + " seconds",
    "Shot size: " + shot.shotSize,
    "Camera: " + shot.cameraMovement,
    "Opening frame: " + shot.openingFrame,
    "Final frame: " + shot.finalFrame,
    "References: " + (shot.referenceAssets.join("; ") || "Use the approved scene reference list."),
    "GOOGLE FLOW PROMPT",
    shot.flowPrompt,
    "Negative prompt: " + shot.negativePrompt,
    "Voiceover: " + shot.voiceover,
    "Audio: " + shot.audioNotes,
    "SFX: " + shot.sfx,
    "Background music: " + shot.backgroundMusic,
  ].join("\n\n");
}

export function sceneShotsText(scene: Scene): string {
  const shots = scene.shots || [];
  if (!shots.length) return "Scene " + scene.sceneNumber + " — " + scene.title + "\nNo shot breakdown has been generated yet.";
  return shots.map((shot) => shotPromptText(shot, scene)).join("\n\n----------------------------------------\n\n");
}

export function shotPackageText(board: Storyboard): string {
  return [
    "MULTI-SHOT GOOGLE FLOW PROMPT PACKAGE",
    "Each shot is an independent prompt for manual generation in Google Flow. Assemble and trim the resulting clips yourself in your video editor. Check the active Flow model settings before generation.",
    "Project: " + board.projectTitle,
    "Story: " + board.logline,
    ...(board.scenes.filter((scene) => scene.shots?.length).map((scene) => sceneShotsText(scene))),
  ].join("\n\n========================================\n\n");
}
