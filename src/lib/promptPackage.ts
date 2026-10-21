import JSZip from "jszip";
import type { ReferencePlanItem, Scene, Storyboard, VideoForm } from "../types";
import { referenceImagePrompt } from "./automaticAssets";

export function referenceCode(item: ReferencePlanItem, board: Storyboard): string {
  const peers = (board.referencePlan || []).filter((entry) => entry.kind === item.kind);
  return ({ character: "C", background: "B", prop: "P" }[item.kind]) + String(peers.findIndex((entry) => entry.id === item.id) + 1).padStart(2, "0");
}
export const scenePlanReferences = (scene: Scene, board: Storyboard) => (board.referencePlan || []).filter((item) => item.sceneIds.includes(scene.id));
export const scenePreparationMode = (scene: Scene, board: Storyboard) => scene.preparationMode || (scenePlanReferences(scene, board).length ? "image-to-video" : "text-to-video");
export function sceneReferenceList(scene: Scene, board: Storyboard): string {
  return scenePlanReferences(scene, board).map((item) => referenceCode(item, board) + " — " + item.title).join("; ") || "No separate reference images required.";
}
function referenceDescriptions(scene: Scene, board: Storyboard): string {
  return scenePlanReferences(scene, board).map((item) => referenceCode(item, board) + " (" + item.title + "): " + item.prompt).join("\n");
}
export function sceneImagePrompt(scene: Scene, board: Storyboard, form: VideoForm): string {
  return ["GENERATE ONE FINISHED SCENE IMAGE NOW. NO TEXT IN THE IMAGE.",
    "Create a single opening-frame still, not a collage or written plan. Do not render reference codes as text.",
    "Opening frame: " + (scene.openingFrame || scene.visualDescription),
    "Composition: " + scene.visualDescription, "Shot size: " + scene.shotSize,
    "Lighting: " + scene.lighting + ". Mood: " + scene.mood,
    "Visual style: " + form.visualStyle + ". Aspect ratio: " + form.aspectRatio,
    "Visual bible: " + board.visualBible,
    "Use the attached reference images to preserve character identity, wardrobe, location and product details. Reference descriptions:\n" + referenceDescriptions(scene, board),
    "Depict only the opening moment, before the action develops. No extra people, duplicate subjects, captions or watermarks.",
    "Avoid: " + scene.negativePrompt,
  ].join("\n\n");
}
export function sceneVideoPrompt(scene: Scene, board: Storyboard): string {
  return [scene.flowPrompt,
    scenePreparationMode(scene, board) === "image-to-video" ? "Use the supplied scene opening image as the starting composition. Preserve its subjects and design while animating the action below." : "Generate this shot directly from the description; no starting image is required.",
    "ACTION: " + scene.action, "CAMERA: " + scene.cameraMovement,
    "FINAL FRAME: " + scene.finalFrame, "AUDIO: " + scene.audioNotes,
    scene.voiceover ? "VOICEOVER: " + scene.voiceover : "", "CONTINUITY REFERENCES:\n" + referenceDescriptions(scene, board),
  ].filter(Boolean).join("\n\n");
}
export function sceneInstructions(scene: Scene, board: Storyboard): string {
  return "Scene " + scene.sceneNumber + ": " + scene.title + "\nDuration target: " + scene.durationSeconds + " seconds\nReferences: " + sceneReferenceList(scene, board) + "\n" +
    (scenePreparationMode(scene, board) === "image-to-video" ? "1. Create/reuse the listed reference images in Flow.\n2. Attach those images and use scene-image-prompt.txt to make the opening still.\n3. Use that still as the start frame, then paste video-prompt.txt to animate it." : "Paste video-prompt.txt into Flow's text-to-video mode. The scene image prompt is optional.") +
    "\nChoose compatible model, duration and aspect ratio in Flow. Review the result before moving to the next scene. Add exact captions in editing; the app does not generate media.";
}
export function completePromptText(board: Storyboard, form: VideoForm): string {
  return ["FLOW PROMPT PACKAGE", board.projectTitle, "STORY: " + board.logline, "VISUAL BIBLE: " + board.visualBible,
    "ORDER: Generate reusable references first, then follow each scene's instructions. Images and videos are created manually in Flow.",
    ...(board.referencePlan || []).map((item) => referenceCode(item, board) + " — " + item.title + "\nUse in scenes: " + board.scenes.filter((scene) => item.sceneIds.includes(scene.id)).map((scene) => scene.sceneNumber).join(", ") + "\n" + referenceImagePrompt(item, form)),
    ...board.scenes.map((scene) => sceneInstructions(scene, board) + "\n\nSCENE IMAGE PROMPT:\n" + sceneImagePrompt(scene, board, form) + "\n\nVIDEO PROMPT:\n" + sceneVideoPrompt(scene, board) + "\n\nCAPTION FOR EDITING:\n" + scene.onscreenText),
  ].join("\n\n--------------------\n\n");
}
export async function promptPackageZip(board: Storyboard, form: VideoForm): Promise<Blob> {
  const zip = new JSZip();
  zip.file("complete-prompts.txt", completePromptText(board, form));
  for (const item of board.referencePlan || []) zip.file("references/" + referenceCode(item, board) + ".txt", item.title + "\n\n" + referenceImagePrompt(item, form));
  for (const scene of board.scenes) {
    const folder = zip.folder("scene-" + String(scene.sceneNumber).padStart(2, "0"))!;
    folder.file("instructions.txt", sceneInstructions(scene, board));
    folder.file("scene-image-prompt.txt", sceneImagePrompt(scene, board, form));
    folder.file("video-prompt.txt", sceneVideoPrompt(scene, board));
    folder.file("voiceover.txt", scene.voiceover);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
