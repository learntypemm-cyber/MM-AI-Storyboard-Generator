import type { ReferencePlanItem, Scene, Storyboard, VideoForm } from "../types";
import { cinematicAnimationPrompt } from "./animationPrompt";

type Design = Pick<ReferencePlanItem, "kind" | "title" | "prompt">;
export function referencePromptSource(ref: Design, form: VideoForm): string {
  return JSON.stringify([ref.kind, ref.title, ref.prompt, form.visualStyle, form.referenceNotes]);
}
export function referencePromptMM(ref: Design, form: VideoForm): string {
  const shared = `ပုံစံ: ${form.visualStyle}\nအသုံးပြုသူညွှန်ကြားချက်: ${form.referenceNotes || "မရှိ"}\nအမည်: ${ref.title}\nအသေးစိတ်ပုံသဏ္ဍာန်: ${ref.prompt}`;
  if (ref.kind === "character") return `${shared}\n\n16:9 ဇာတ်ကောင် reference sheet တစ်ပုံ ထုတ်ပါ။ ကိုယ်လုံးပြည့် ရှေ့၊ သုံးပုံလေးပုံစောင်း၊ ဘေး၊ နောက် မြင်ကွင်းလေးခုနှင့် မျက်နှာအနီးကပ် ပျော်ရွှင်၊ အံ့ဩ၊ စဉ်းစား၊ ပုံမှန် အမူအရာလေးမျိုး ပါစေ။ အကွက်တိုင်းတွင် မျက်နှာ၊ ဆံပင်၊ ဝတ်စုံ၊ ကိုယ်ခန္ဓာအချိုးအစားနှင့် အရောင်များ အတိအကျတူညီပါစေ။ မြင်ကွင်းနှင့် expression အားလုံးသည် လူတစ်ဦးတည်း၏ ပုံစံသာဖြစ်ရမည်။\nညာဘက်အပေါ်ထောင့်တွင် ဇာတ်ကောင်ပုံများ၏အပြင်ဘက်၊ အဝါရောင်နောက်ခံပေါ် အနက်ရောင်စာလုံးထူဖြင့် “Name: ${ref.title}” ဟုရေးပါ။ Character name သည် Flow prompt နှင့် နောင် scene များတွင်ပြန်သုံးရန် English / Latin letters ဖြင့်သာဖြစ်ရမည်။\nသန့်ရှင်းသော မီးခိုးဖျော့ studio နောက်ခံ၊ ညီညာနူးညံ့သောအလင်း၊ ပြင်းထန်သည့်အရိပ်မပါ၊ အသေးစိတ်ရှင်းလင်းသော professional model sheet ဖွဲ့စည်းပုံဖြစ်ပါစေ။ ကိုယ်လုံး၊ ဖိနပ်နှင့် accessories မဖြတ်ထွက်စေပါနှင့်။ ရွေးထားသောပုံစံကိုထိန်းပါ။ 3D animation ဖြစ်လျှင် နွေးထွေးသောအရောင်နှင့် ချောမွေ့သည့် 3D အသားအရေ/ဆံပင်ဖြစ်ပါစေ။ အခြားစာ၊ logo၊ watermark မထည့်ပါနှင့်။`;
  if (ref.kind === "background") return `${shared}\n\n16:9 နေရာ reference sheet တစ်ပုံတွင် 2×2 အကွက်လေးကွက် ထည့်ပါ။ နေရာတစ်နေရာတည်းကို ရှုထောင့်လေးမျိုးမှပြပါ။ လူနှင့် ဇာတ်ကောင်များမပါသော ပတ်ဝန်းကျင်သာဖြစ်ပါစေ။\nA: ရှေ့မှကျယ်ကျယ်မြင်ကွင်း၊ B: ညာဘက်မြင်ကွင်း၊ C: နောက်/ပြောင်းပြန်မြင်ကွင်း၊ D: ဘယ်ဘက်မြင်ကွင်း။\nအခန်းဖွဲ့စည်းပုံ၊ ပရိဘောဂ၊ ပစ္စည်း၊ အရောင်၊ မျက်နှာပြင်နှင့် အလင်းဦးတည်ချက် တူညီပါစေ။ တူညီသောပစ္စည်းသည် ရှုထောင့်ပြောင်းလဲမှုနှင့်အညီ သဘာဝကျစွာပြန်မြင်ရပါမည်။ အကွက်တစ်ခုစီကို သီးခြားနေရာအဖြစ် မဖန်တီးပါနှင့်။\nအကွက်တိုင်းကို ဘောင်ခတ်ပါ။ စာတန်းကို ပုံ၏အပြင်ဘက် အောက်ခြေရှိ သီးခြားအရောင်ပြားပေါ်တွင်သာထည့်ပါ: A / FRONT VIEW, B / RIGHT VIEW, C / BACK VIEW, D / LEFT VIEW။ အခြားစာနှင့် watermark မထည့်ပါနှင့်။`;
  return `${shared}\n\nပစ္စည်းတစ်ခုတည်း၏ သန့်ရှင်းရှင်း reference ပုံကိုထုတ်ပါ။ အချိုးအစား၊ အရောင်၊ ပစ္စည်းသားနှင့် ခွဲခြားသိနိုင်သည့်အသေးစိတ်ကို တိကျစွာပြပါ။ ရိုးရှင်းသော studio နောက်ခံ၊ ညီညာသောအလင်းကိုသုံးပါ။ လူ၊ ထပ်တူပစ္စည်း၊ စာတန်းနှင့် watermark မထည့်ပါနှင့်။`;
}
const refsFor = (scene: Scene, board: Storyboard) => (board.referencePlan || []).filter(r => r.sceneIds.includes(scene.id));
const previousFor = (scene: Scene, board: Storyboard) => {
  const previous = board.scenes[board.scenes.findIndex(s => s.id === scene.id) - 1];
  return previous?.handoff === "CONTINUATION" ? previous : undefined;
};
export function scenePromptSource(scene: Scene, board: Storyboard, form: VideoForm): string {
  // Use a fixed field order so saving/loading JSON cannot invalidate an unchanged draft.
  return JSON.stringify([scene.id, scene.durationSeconds, scene.visualDescription, scene.shotSize, scene.cameraMovement, scene.lighting, scene.mood, scene.action, scene.flowPrompt, scene.openingFrame, scene.finalFrame, scene.audioNotes, scene.sfx, scene.backgroundMusic, scene.voiceover, scene.negativePrompt, scene.backgroundAngle, scene.preparationMode, board.visualBible, board.continuityRules, board.globalNegativePrompt, refsFor(scene, board).map(r => [r.id, r.title, r.prompt]), previousFor(scene, board)?.finalFrame, form.visualStyle, form.aspectRatio]);
}
function sceneContext(scene: Scene, board: Storyboard): string {
  const angle = scene.backgroundAngle || "A";
  return `နောက်ခံရှုထောင့်: ${angle} / ${{ A: "ရှေ့", B: "ညာ", C: "နောက်/ပြောင်းပြန်", D: "ဘယ်" }[angle]}\nReference ပုံများ၏ အမည်နှင့်အသေးစိတ်:\n${refsFor(scene, board).map(r => `${r.title}: ${r.prompt}`).join("\n") || "သီးခြား reference မရှိပါ။ ဖော်ပြထားသောနေရာကိုသုံးပါ။"}\nReference sheet များသည် ပုံစံအတွက်သာဖြစ်သည်။ ဇာတ်ကောင်မျက်နှာ၊ ဝတ်စုံ၊ နေရာဖွဲ့စည်းပုံနှင့် ပစ္စည်းများကို တူညီစွာထိန်းပါ။ နောက်ခံ A/B/C/D သည် နေရာတစ်ခုတည်း၏ ရှုထောင့်များဖြစ်သည်။ နောက်ဆုံးပုံတွင် ကွက်ခွဲ၊ ဘောင်၊ နာမည်စာတန်း၊ reference အမှတ်နှင့် အချိန်စာတန်း မပါစေရ။`;
}
export function sceneImagePromptMM(scene: Scene, board: Storyboard, form: VideoForm): string {
  return [`ပြီးစီးသော opening image တစ်ပုံတည်းထုတ်ပါ။ စာသားနှင့် watermark မပါစေရ။ collage နှင့် ရှင်းလင်းချက်စာ မထုတ်ပါနှင့်။`,
    `ပထမဆုံးအခိုက်အတန့်: ${scene.openingFrame || scene.visualDescription}`, `ဖွဲ့စည်းပုံနှင့်ပတ်ဝန်းကျင်: ${scene.visualDescription}`, `ရိုက်ကွက်: ${scene.shotSize}`, `အလင်း: ${scene.lighting}\nခံစားချက်: ${scene.mood}`, `ပုံစံ: ${form.visualStyle}\nအချိုး: ${form.aspectRatio}\nတစ်ခုလုံး၏အမြင်ပုံစံ: ${board.visualBible}`, sceneContext(scene, board), `လှုပ်ရှားမှုမဖြစ်ပွားမီ အစအနေအထားကိုသာပြပါ။ အပိုလူ၊ ထပ်တူဇာတ်ကောင်နှင့် caption မထည့်ပါနှင့်။`, `ရှောင်ရန်: ${board.globalNegativePrompt}; ${scene.negativePrompt}`].join("\n\n");
}
export function sceneVideoPromptMM(scene: Scene, board: Storyboard, _form: VideoForm): string {
  const previous = previousFor(scene, board);
  const imageMode = scene.preparationMode ? scene.preparationMode === "image-to-video" : Boolean(refsFor(scene, board).length || previous);
  return cinematicAnimationPrompt(scene, board, {
    language: "my",
    background: sceneContext(scene, board),
    startFromPrevious: imageMode && previous ? previous.finalFrame : undefined,
    references: refsFor(scene, board).map(ref => ref.title + ": " + ref.prompt).join("\n") || "သီးခြား reference မရှိပါ။",
    imageMode,
  });
}
export function fullPromptsReady(board: Storyboard, form: VideoForm): boolean {
  return !(board.referencePlan || []).some(r => r.fullPrompt !== undefined && (!r.fullPrompt.trim() || r.fullPromptSource !== referencePromptSource(r, form))) && !board.scenes.some(s => (s.fullImagePrompt !== undefined || s.fullVideoPrompt !== undefined) && (!s.fullImagePrompt?.trim() || !s.fullVideoPrompt?.trim() || s.fullPromptSource !== scenePromptSource(s, board, form)));
}
export function materializeFullPrompts(board: Storyboard, form: VideoForm): Storyboard {
  if (!fullPromptsReady(board, form)) throw new Error("ပြင်ထားသော prompt အပြည့်အစုံများကို ပြန်စစ်ပြီး အတည်ပြုပါ။");
  return { ...board, referencePlan: board.referencePlan?.map(r => ({ ...r, fullPrompt: r.fullPrompt ?? referencePromptMM(r, form), fullPromptSource: referencePromptSource(r, form) })), scenes: board.scenes.map(s => ({ ...s, fullImagePrompt: s.fullImagePrompt ?? sceneImagePromptMM(s, board, form), fullVideoPrompt: s.fullVideoPrompt ?? sceneVideoPromptMM(s, board, form), fullPromptSource: scenePromptSource(s, board, form) })) };
}
