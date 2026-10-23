import { referencePromptMM, sceneImagePromptMM, sceneVideoPromptMM } from "./fullPrompts";
import JSZip from "jszip";
import type { ReferencePlanItem, Scene, Storyboard, VideoForm } from "../types";
import { referenceImagePrompt, referenceImagePromptMyanmar } from "./automaticAssets";

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
  if (scene.fullImagePrompt !== undefined) return scene.fullImagePrompt;
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
  if (scene.fullVideoPrompt !== undefined) return scene.fullVideoPrompt;
  const previous = previousContinuousScene(scene, board);
  const time = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  const timedPrompt = /\d{2}:\d{2}/.test(scene.flowPrompt) ? scene.flowPrompt : scene.flowPrompt + "\n\n(00:00-" + time(scene.durationSeconds) + ")\n[Camera shot] " + scene.shotSize + "\n[Action] " + scene.action;
  return [timedPrompt,
    "[Background / opening angle] " + sceneBackground(scene, board),
    previous && scenePreparationMode(scene, board) === "image-to-video" ? "START FRAME: Use the actual final frame of the preceding clip. Preserve subject positions, wardrobe, props, lighting and camera direction. Expected incoming state: " + previous.finalFrame : "",
    referenceSheetDirections(scene, board),
    scenePreparationMode(scene, board) === "image-to-video" ? "Use the supplied scene opening image as the starting composition. Preserve its subjects and design while animating the action below." : "Generate this shot directly from the description; no starting image is required.",
    "DURATION: " + scene.durationSeconds + " seconds",
    "VISUAL DESIGN: " + board.visualBible,
    "OPENING FRAME: " + scene.openingFrame,
    "COMPOSITION / ENVIRONMENT: " + scene.visualDescription,
    "SHOT SIZE: " + scene.shotSize,
    "ACTION: " + scene.action, "CAMERA: " + scene.cameraMovement,
    "LIGHTING: " + scene.lighting, "MOOD: " + scene.mood,
    "CONTINUITY RULES: " + board.continuityRules.join("; "),
    "AVOID: " + [board.globalNegativePrompt, scene.negativePrompt].filter(Boolean).join("; "),
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

const angleNamesMyanmar: Record<"A" | "B" | "C" | "D", string> = {
  A: "ရှေ့ဘက်", B: "ညာဘက်", C: "နောက်ဘက် / ပြောင်းပြန်", D: "ဘယ်ဘက်",
};
const visualStyleNamesMyanmar: Record<VideoForm["visualStyle"], string> = {
  "Realistic tutorial": "လက်တွေ့ဆန်သော သင်ခန်းစာပုံစံ",
  "Cinematic live action": "ရုပ်ရှင်ဆန်သော လက်တွေ့ရိုက်ကူးမှု",
  "3D animation": "3D ကာတွန်းပုံစံ",
  "2D motion graphics": "2D motion graphics ပုံစံ",
  "Presenter-led": "တင်ဆက်သူဦးဆောင်သည့် ပုံစံ",
  "Fast-paced social video": "လျင်မြန်သွက်လက်သော လူမှုကွန်ရက်ဗီဒီယိုပုံစံ",
};
function sceneBackgroundMyanmar(scene: Scene, board: Storyboard): string {
  const angle = scene.backgroundAngle || "A";
  const rows = scenePlanReferences(scene, board).filter((item) => item.kind === "background")
    .map((item) => referenceCode(item, board) + " — " + item.title + " — " + angle + " / " + angleNamesMyanmar[angle]);
  return rows.join("၊ ") || "သီးခြား background reference sheet မလိုပါ။ Scene ထဲမှာ ဖော်ပြထားသော နေရာကိုသာ သုံးပါ။";
}
function referenceDescriptionsMyanmar(scene: Scene, board: Storyboard): string {
  return scenePlanReferences(scene, board).map((item) => referenceCode(item, board) + " (" + item.title + "): " + item.prompt).join("\n");
}
export function sceneImagePromptMyanmar(scene: Scene, board: Storyboard, form: VideoForm): string {
  if (scene.fullImagePrompt !== undefined) return scene.fullImagePrompt;
  return [
    "ဤဇာတ်ကွက်အတွက် အပြီးသတ်အဖွင့်ပုံတစ်ပုံတည်းကို ဖန်တီးပါ။ ပုံထဲတွင် မလိုအပ်သောစာသား မပါစေရ။",
    "Collage သို့မဟုတ် စာဖြင့်ရှင်းပြထားသော plan မဟုတ်ဘဲ ဗီဒီယိုစတင်ချိန်၏ တစ်ကွက်တည်း still image ဖြစ်ရမည်။ Reference code များကို ပုံထဲတွင် မရေးပါနှင့်။",
    "အဖွင့်ပုံ: " + (scene.openingFrame || scene.visualDescription),
    "နောက်ခံ / အဖွင့်ကင်မရာထောင့်: " + sceneBackgroundMyanmar(scene, board),
    "ဖွဲ့စည်းပုံနှင့် မြင်ကွင်း: " + scene.visualDescription,
    "ရိုက်ကွက်အရွယ်အစား: " + scene.shotSize,
    "အလင်းရောင်: " + scene.lighting + "။ ခံစားချက်: " + scene.mood,
    "ရုပ်ပုံပုံစံ: " + visualStyleNamesMyanmar[form.visualStyle] + "။ ပုံအချိုး: " + form.aspectRatio,
    "အဓိကရုပ်ပုံလမ်းညွှန်: " + board.visualBible,
    "ပေးထားသော reference ပုံများကို အသုံးပြုပြီး ဇာတ်ကောင်၏ မျက်နှာ၊ အဝတ်အစား၊ နေရာနှင့် ပစ္စည်းများကို တူညီစွာ ထိန်းပါ။ Reference ဖော်ပြချက်များ:\n" + referenceDescriptionsMyanmar(scene, board),
    ...scenePlanReferences(scene, board).filter((item) => item.kind === "background").map((item) =>
      referenceCode(item, board) + " (" + item.title + ") အတွက် A = ရှေ့၊ B = ညာ၊ C = နောက်၊ D = ဘယ် ဖြစ်သည်။ နောက်ခံ reference sheet သည် တစ်နေရာတည်း၏ ထောင့်လေးခုဖြစ်ကြောင်း ထိန်းထားပါ။"),
    "ဖြစ်နိုင်သည့် အဖွင့်အခိုက်အတန့်ကိုသာ ပြပါ။ လူထပ်တိုးခြင်း၊ ဇာတ်ကောင်နှစ်ထပ်ဖြစ်ခြင်း၊ caption သို့မဟုတ် watermark မပါစေရ။",
    "မပါစေလိုသည့်အရာများ: " + scene.negativePrompt,
  ].filter(Boolean).join("\n\n");
}
export function sceneVideoPromptMyanmar(scene: Scene, board: Storyboard): string {
  if (scene.fullVideoPrompt !== undefined) return scene.fullVideoPrompt;
  const previous = previousContinuousScene(scene, board);
  const time = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
  const timedPrompt = /\d{2}:\d{2}/.test(scene.flowPrompt) ? scene.flowPrompt : scene.flowPrompt + "\n\n(00:00-" + time(scene.durationSeconds) + ")\n[ကင်မရာရိုက်ကွက်] " + scene.shotSize + "\n[လုပ်ဆောင်ချက်] " + scene.action;
  return [
    timedPrompt,
    "နောက်ခံ / အဖွင့်ထောင့်: " + sceneBackgroundMyanmar(scene, board),
    previous && scenePreparationMode(scene, board) === "image-to-video" ? "အစပုံ: ယခင်ဇာတ်ကွက်၏ အမှန်တကယ်နောက်ဆုံး frame ကို အသုံးပြုပါ။ ဇာတ်ကောင်တည်နေရာ၊ အဝတ်အစား၊ ပစ္စည်း၊ အလင်းနှင့် ကင်မရာဦးတည်ချက်ကို မပြောင်းပါနှင့်။ ဆက်ဝင်လာမည့်အခြေအနေ: " + previous.finalFrame : "",
    ...scenePlanReferences(scene, board).filter((item) => item.kind === "background").map((item) =>
      referenceCode(item, board) + " (" + item.title + "): A = ရှေ့၊ B = ညာ၊ C = နောက်/ပြောင်းပြန်၊ D = ဘယ်။ သတ်မှတ်ထားသော ထောင့်နှင့် နေရာကိုသာ သုံးပါ။"),
    scenePreparationMode(scene, board) === "image-to-video" ? "ပေးထားသော scene အဖွင့်ပုံကို စတင်ဖွဲ့စည်းပုံအဖြစ် အသုံးပြုပြီး ဇာတ်ကွက်လုပ်ဆောင်ချက်အတိုင်း လှုပ်ရှားစေပါ။" : "အဖွင့်ပုံ မလိုအပ်ဘဲ ဖော်ပြချက်အတိုင်း ဤမြင်ကွင်းကို တိုက်ရိုက်ဖန်တီးပါ။",
    "ဇာတ်ကွက်ကြာချိန်: " + scene.durationSeconds + " စက္ကန့်",
    "ရုပ်ပုံပုံစံလမ်းညွှန်: " + board.visualBible,
    "အဖွင့် frame: " + scene.openingFrame,
    "ဖွဲ့စည်းပုံ / ပတ်ဝန်းကျင်: " + scene.visualDescription,
    "ရိုက်ကွက်အရွယ်အစား: " + scene.shotSize,
    "လုပ်ဆောင်ချက်: " + scene.action,
    "ကင်မရာလှုပ်ရှားမှု: " + scene.cameraMovement,
    "အလင်းရောင်: " + scene.lighting,
    "ခံစားချက်: " + scene.mood,
    "ဇာတ်ကွက်ဆက်စပ်မှုစည်းမျဉ်းများ: " + board.continuityRules.join("၊ "),
    "ရှောင်ရန်: " + [board.globalNegativePrompt, scene.negativePrompt].filter(Boolean).join("၊ "),
    "နောက်ဆုံး frame: " + scene.finalFrame,
    "အသံညွှန်ကြားချက်: " + scene.audioNotes,
    "အသံအကျိုးသက်ရောက်မှု (SFX): " + (scene.sfx ?? "အသံညွှန်ကြားချက်နှင့် လိုက်ဖက်စွာ ထည့်ပါ။"),
    "နောက်ခံတေးဂီတ: " + (scene.backgroundMusic ?? "အသံညွှန်ကြားချက်နှင့် လိုက်ဖက်စွာ ထည့်ပါ။"),
    scene.voiceover ? "ပြောစကား / Voiceover: " + scene.voiceover : "",
    "ဆက်စပ် reference များ:\n" + referenceDescriptionsMyanmar(scene, board),
  ].filter(Boolean).join("\n\n");
}
export function completePromptTextMyanmar(board: Storyboard, form: VideoForm): string {
  board = { ...board, referencePlan: board.referencePlan?.map(r => ({ ...r, fullPrompt: r.fullPrompt ?? referencePromptMM(r, form) })), scenes: board.scenes.map(s => ({ ...s, fullImagePrompt: s.fullImagePrompt ?? sceneImagePromptMM(s, board, form), fullVideoPrompt: s.fullVideoPrompt ?? sceneVideoPromptMM(s, board, form) })) };
  return [
    "မြန်မာဗားရှင်း — ပြည့်စုံသော Flow Prompt Package",
    workflowGuideMM(),
    "ပရောဂျက်: " + board.projectTitle,
    "ဇာတ်လမ်းအကျဉ်း: " + board.logline,
    "ရုပ်ပုံပုံစံလမ်းညွှန်: " + board.visualBible,
    "လုပ်ဆောင်ရန်အစီအစဉ်: ပထမဦးစွာ ပြန်သုံးနိုင်သော Character / Background reference ပုံများကို ထုတ်ပါ။ ထို့နောက် ဇာတ်ကွက်တစ်ခုချင်းစီအတွက် အဖွင့်ပုံနှင့် video prompt များကို အသုံးပြုပါ။ ပုံနှင့် video ကို Google Flow တွင် ကိုယ်တိုင်ထုတ်ရပါမည်။",
    ...(board.referencePlan || []).map((item) => referenceCode(item, board) + " — " + item.title + "\nအသုံးပြုမည့် ဇာတ်ကွက်များ: " + board.scenes.filter((scene) => item.sceneIds.includes(scene.id)).map((scene) => scene.sceneNumber).join(", ") + "\n\n" + referenceImagePromptMyanmar(item, form)),
    ...board.scenes.map((scene) => {
      const previous = previousContinuousScene(scene, board);
      const mode = scenePreparationMode(scene, board) === "image-to-video";
      const instructions = "ဇာတ်ကွက် " + scene.sceneNumber + ": " + scene.title +
        "\nကြာချိန်: " + scene.durationSeconds + " စက္ကန့်" +
        "\nအသုံးပြုမည့် reference: " + (sceneReferenceList(scene, board)) +
        "\nနောက်ခံ: " + sceneBackgroundMyanmar(scene, board) +
        "\n" + (mode ? previous
          ? "၁။ ယခင်ဇာတ်ကွက်၏ နောက်ဆုံး frame ကို သိမ်းယူပြီး ဒီဇာတ်ကွက်၏ အစပုံအဖြစ်သုံးပါ။\n၂။ အောက်ပါ မြန်မာ video prompt ဖြင့် လှုပ်ရှားမှုကို ဆက်ပါ။"
          : "၁။ သက်ဆိုင်ရာ Character / Background reference ပုံများကို Flow ထဲသို့ ထည့်ပါ။\n၂။ အောက်ပါ အဖွင့်ပုံ prompt ဖြင့် still image တစ်ပုံ ထုတ်ပါ။\n၃။ အဲဒီပုံကို start frame အဖြစ်သုံးပြီး အောက်ပါ video prompt ဖြင့် clip ထုတ်ပါ။"
          : "အောက်ပါ video prompt ကို text-to-video အဖြစ်သုံးပါ။ အဖွင့်ပုံသည် ရွေးချယ်နိုင်သော အပိုအဆင့်ဖြစ်သည်။") +
        "\nအဝတ်အစား၊ ပစ္စည်း၊ နေရာ၊ အလင်းရောင်နှင့် လှုပ်ရှားမှု ဆက်စပ်မှုကို စစ်ပါ။ Caption ကို editing မှာ ထည့်ပါ။";
      return instructions + "\n\nအဖွင့်ပုံ prompt (မြန်မာ):\n" + sceneImagePromptMyanmar(scene, board, form) +
        "\n\nVideo prompt (မြန်မာ):\n" + sceneVideoPromptMyanmar(scene, board) +
        "\n\nEditing တွင် ထည့်ရန် caption:\n" + scene.onscreenText;
    }),
  ].join("\n\n--------------------\n\n");
}
export function completePromptTextBilingual(burmeseBoard: Storyboard, form: VideoForm, englishBoard: Storyboard): string {
  return [
    "==================== MYANMAR VERSION / မြန်မာဗားရှင်း ====================",
    completePromptTextMyanmar(burmeseBoard, form),
    "",
    "==================== ENGLISH VERSION / အင်္ဂလိပ်ဗားရှင်း ====================",
    completePromptText(englishBoard, form),
  ].join("\n\n");
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
