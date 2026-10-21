import JSZip from "jszip";
import type { ReferencePlanItem, Scene, Storyboard, VideoForm } from "../types";
import { referenceImagePrompt } from "./automaticAssets";

export function referenceCode(item: ReferencePlanItem, board: Storyboard): string {
  const peers = (board.referencePlan || []).filter((entry) => entry.kind === item.kind);
  return ({ character: "C", background: "B", prop: "P" }[item.kind]) + String(peers.findIndex((entry) => entry.id === item.id) + 1).padStart(2, "0");
}
export const scenePlanReferences = (scene: Scene, board: Storyboard) => (board.referencePlan || []).filter((item) => item.sceneIds.includes(scene.id));
export const scenePreparationMode = (scene: Scene, board: Storyboard) => scene.preparationMode || (scenePlanReferences(scene, board).length || previousContinuousScene(scene, board) ? "image-to-video" : "text-to-video");
export const angleNames = { A: "front", B: "right side", C: "back / reverse", D: "left side" };
export function sceneBackground(scene: Scene, board: Storyboard): string {
  const angle = scene.backgroundAngle || "A";
  return scenePlanReferences(scene, board).filter((item) => item.kind === "background").map((item) => referenceCode(item, board) + " — " + item.title + " — " + angle + " / " + angleNames[angle]).join("; ") || "Use the scene's described environment; no separate background sheet.";
}
export function previousContinuousScene(scene: Scene, board: Storyboard): Scene | undefined {
  const index = board.scenes.findIndex((item) => item.id === scene.id);
  const previous = index > 0 ? board.scenes[index - 1] : undefined;
  return previous?.handoff === "CONTINUATION" ? previous : undefined;
}
export function workflowGuideMM(): string {
  return "Flow မှာလုပ်ရန် အစီအစဉ်\n\n၁။ references ထဲက Character / Background prompt များဖြင့် 16:9 reference sheet များထုတ်ပါ။ ဇာတ်ကောင်တူ၊ နေရာတူလျှင် ရှိပြီးသားပုံကို ပြန်သုံးပါ။\n၂။ Scene တစ်ခုချင်းစီမှာ ဖော်ပြထားတဲ့ C01 / B01 စတဲ့ reference ပုံများကို တွဲထည့်ပါ။ Background A = ရှေ့၊ B = ညာ၊ C = နောက်၊ D = ဘယ် ဖြစ်ပါတယ်။\n၃။ scene-image-prompt ဖြင့် တစ်ကွက်တည်း opening image ထုတ်ပါ။ Reference sheet ကို video start frame အဖြစ် တိုက်ရိုက်မသုံးပါနှင့်။\n၄။ Opening image ကို start frame အဖြစ်ထည့်ပြီး video-prompt ကိုသုံးပါ။ Flow မှာ ရနိုင်တဲ့ duration နှင့် aspect ratio ကိုရွေးပါ။\n၅။ ဆက်တိုက် scene ဖြစ်လျှင် အရင် clip နောက်ဆုံး frame ကို နောက် clip start frame အဖြစ် ပြန်သုံးပါ။ ဝတ်စုံ၊ ပစ္စည်း၊ နေရာ၊ လှုပ်ရှားမှု ဆက်စပ်မှုကိုစစ်ပါ။\n၆။ SFX / Music / Voiceover ကိုစစ်ပြီး caption များကို editing မှာထည့်ပါ။ App က prompt များသာထုတ်ပေးပြီး ပုံနှင့် video ကို Flow မှာ ကိုယ်တိုင်ထုတ်ရပါမယ်။";
}
export function sceneReferenceList(scene: Scene, board: Storyboard): string {
  return scenePlanReferences(scene, board).map((item) => referenceCode(item, board) + " — " + item.title).join("; ") || "No separate reference images required.";
}
function referenceSheetDirections(scene: Scene, board: Storyboard): string {
  const backgrounds = scenePlanReferences(scene, board).filter((item) => item.kind === "background");
  return ["Reference sheets are design guides only. Render ONE full-screen shot, never a turnaround, grid, name tag, panel label or border.",
    ...backgrounds.map((item) => referenceCode(item, board) + " (" + item.title + ") angle key: A = front, B = right side, C = back/reverse, D = left side. Use the named location and panel angle specified in the shot; all four panels show the same space."),
  ].join("\n");
}
function referenceDescriptions(scene: Scene, board: Storyboard): string {
  return scenePlanReferences(scene, board).map((item) => referenceCode(item, board) + " (" + item.title + "): " + item.prompt).join("\n");
}
export function sceneImagePrompt(scene: Scene, board: Storyboard, form: VideoForm): string {
  return ["GENERATE ONE FINISHED SCENE IMAGE NOW. NO TEXT IN THE IMAGE.",
    "Create a single opening-frame still, not a collage or written plan. Do not render reference codes as text.",
    "Opening frame: " + (scene.openingFrame || scene.visualDescription),
    "BACKGROUND / OPENING ANGLE: " + sceneBackground(scene, board),
    "Composition: " + scene.visualDescription, "Shot size: " + scene.shotSize,
    "Lighting: " + scene.lighting + ". Mood: " + scene.mood,
    "Visual style: " + form.visualStyle + ". Aspect ratio: " + form.aspectRatio,
    "Visual bible: " + board.visualBible,
    "Use the attached reference images to preserve character identity, wardrobe, location and product details. Reference descriptions:\n" + referenceDescriptions(scene, board),
    referenceSheetDirections(scene, board),
    "Depict only the opening moment, before the action develops. No extra people, duplicate subjects, captions or watermarks.",
    "Avoid: " + scene.negativePrompt,
  ].join("\n\n");
}
export function sceneVideoPrompt(scene: Scene, board: Storyboard): string {
  const previous = previousContinuousScene(scene, board);
  const time = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  const timedPrompt = /\d{2}:\d{2}/.test(scene.flowPrompt) ? scene.flowPrompt : scene.flowPrompt + "\n\n(00:00-" + time(scene.durationSeconds) + ")\n[Camera shot] " + scene.shotSize + "\n[Action] " + scene.action;
  return [timedPrompt,
    "[Background / opening angle] " + sceneBackground(scene, board),
    previous && scenePreparationMode(scene, board) === "image-to-video" ? "START FRAME: Use the actual final frame of the preceding clip. Preserve subject positions, wardrobe, props, lighting and camera direction. Expected incoming state: " + previous.finalFrame : "",
    referenceSheetDirections(scene, board),
    scenePreparationMode(scene, board) === "image-to-video" ? "Use the supplied scene opening image as the starting composition. Preserve its subjects and design while animating the action below." : "Generate this shot directly from the description; no starting image is required.",
    "ACTION: " + scene.action, "CAMERA: " + scene.cameraMovement,
    "FINAL FRAME: " + scene.finalFrame, "AUDIO DIRECTION: " + scene.audioNotes,
    "SFX: " + (scene.sfx ?? "Follow the audio direction; no additional effects specified."), "BACKGROUND MUSIC: " + (scene.backgroundMusic ?? "Follow the audio direction; no additional music specified."),
    scene.voiceover ? "VOICEOVER: " + scene.voiceover : "", "CONTINUITY REFERENCES:\n" + referenceDescriptions(scene, board),
  ].filter(Boolean).join("\n\n");
}
export function sceneInstructions(scene: Scene, board: Storyboard): string {
  const previous = previousContinuousScene(scene, board);
  const imageMode = scenePreparationMode(scene, board) === "image-to-video";
  return "Scene " + scene.sceneNumber + ": " + scene.title + "\nDuration target: " + scene.durationSeconds + " seconds\nReferences: " + sceneReferenceList(scene, board) + "\nBackground: " + sceneBackground(scene, board) + "\n" +
    (imageMode ? previous ? "၁။ Scene " + previous.sceneNumber + " clip ၏ နောက်ဆုံး frame ကို ထုတ်ယူပြီး ဒီ scene အတွက် start frame အဖြစ်သုံးပါ။\n၂။ video-prompt.txt ကိုသုံးပြီး လှုပ်ရှားမှုကို ဆက်ပါ။ Opening image prompt ကို အစားထိုးပုံလိုမှသုံးပါ။" : "၁။ အထက်ပါ reference sheet များကို Flow မှာ ထုတ်ပါ / ပြန်သုံးပါ။\n၂။ Reference ပုံများတွဲထည့်ပြီး scene-image-prompt.txt ဖြင့် တစ်ကွက်တည်း opening still ထုတ်ပါ။\n၃။ အဲဒီပုံကို start frame အဖြစ်သုံးပြီး video-prompt.txt ဖြင့် video ထုတ်ပါ။" : "video-prompt.txt ကို Flow text-to-video မှာသုံးပါ။ Scene image prompt သည် optional ဖြစ်ပါတယ်။" ) +
    (previous && !imageMode ? "\nဆက်တိုက် scene ဖြစ်ပါတယ်။ နောက်ဆုံး frame ပြန်သုံးရန် image-to-video ကိုရွေးပါ။" : "") +
    "\nဝတ်စုံ၊ ပစ္စည်း၊ နေရာ၊ အလင်းနှင့် လှုပ်ရှားမှုကို စစ်ပြီးမှ နောက် scene ဆက်ပါ။ Caption ကို editing မှာထည့်ပါ။ Flow မှာ ရနိုင်သော duration / aspect ratio ကိုရွေးပါ။";
}
export function completePromptText(board: Storyboard, form: VideoForm): string {
  return ["FLOW PROMPT PACKAGE", workflowGuideMM(), board.projectTitle, "STORY: " + board.logline, "VISUAL BIBLE: " + board.visualBible,
    "ORDER: Generate reusable references first, then follow each scene's instructions. Images and videos are created manually in Flow.",
    ...(board.referencePlan || []).map((item) => referenceCode(item, board) + " — " + item.title + "\nUse in scenes: " + board.scenes.filter((scene) => item.sceneIds.includes(scene.id)).map((scene) => scene.sceneNumber).join(", ") + "\n" + referenceImagePrompt(item, form)),
    ...board.scenes.map((scene) => sceneInstructions(scene, board) + "\n\nSCENE IMAGE PROMPT:\n" + sceneImagePrompt(scene, board, form) + "\n\nVIDEO PROMPT:\n" + sceneVideoPrompt(scene, board) + "\n\nCAPTION FOR EDITING:\n" + scene.onscreenText),
  ].join("\n\n--------------------\n\n");
}
export async function promptPackageZip(board: Storyboard, form: VideoForm): Promise<Blob> {
  const zip = new JSZip();
  zip.file("START-HERE-MM.txt", workflowGuideMM());
  zip.file("complete-prompts.txt", completePromptText(board, form));
  for (const item of board.referencePlan || []) zip.file("references/" + referenceCode(item, board) + ".txt", item.title + "\n\n" + referenceImagePrompt(item, form));
  for (const scene of board.scenes) {
    const folder = zip.folder("scene-" + String(scene.sceneNumber).padStart(2, "0"))!;
    folder.file("instructions.txt", sceneInstructions(scene, board));
    folder.file("scene-image-prompt.txt", sceneImagePrompt(scene, board, form));
    folder.file("video-prompt.txt", sceneVideoPrompt(scene, board));
    folder.file("voiceover.txt", scene.voiceover);
    folder.file("caption.txt", scene.onscreenText);
    folder.file("audio.txt", "SFX: " + (scene.sfx ?? scene.audioNotes) + "\nBackground Music: " + (scene.backgroundMusic ?? scene.audioNotes));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
