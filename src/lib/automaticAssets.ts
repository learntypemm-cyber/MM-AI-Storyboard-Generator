import { referenceDetailRequirements } from "./promptGuidance";
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
  if (item.fullPrompt !== undefined) return item.fullPrompt;
  const style = form.visualStyle === "3D animation" ? "3D Pixar/Disney animation style, warm color palette, high-detail smooth glossy 3D render, expressive skin and hair" : form.visualStyle;
  const requirements = form.referenceNotes ? "User reference requirements: " + form.referenceNotes : "";
  const description = "Subject design: " + item.prompt + "\nUse the description for identity and appearance only; the sheet layout and label rules below take precedence over any older layout or no-label instructions in that description.";
  if (item.kind === "character") return [
    "GENERATE ONE FINISHED CHARACTER REFERENCE SHEET. Aspect ratio: 16:9.",
    "Visual style: " + style + ". Cinematic soft lighting.",
    "Character: " + item.title + ". " + description,
    "Character sheet layout: full-body turnaround showing front view, 3/4 view, side view, and back view. Separate head close-ups showing four facial expressions: happy, surprised, thoughtful, and neutral.",
    "Keep the exact same face, hairstyle, outfit, body proportions and colors consistent across every angle and expression. These are multiple views of ONE character, not different characters. Preserve identity and wardrobe from supplied references.",
    'Place exactly "Name: ' + item.title + '" in the upper-right corner in bold black text on a yellow rectangular background, outside the character drawings. No other text or watermark.',
    "Clean neutral light-grey studio background, soft even studio lighting with no harsh shadows. Character centered within each view, professional model-sheet composition. Show the complete body, shoes and accessories without cropping.",
    requirements,
  ].filter(Boolean).join("\n\n");
  if (item.kind === "background") return [
    "GENERATE ONE FINISHED ENVIRONMENT REFERENCE SHEET. Aspect ratio: 16:9. A 2x2 grid of four framed panels showing ONE consistent location.",
    "Visual style: " + style + ". Warm cinematic lighting.",
    "LOCATION: " + item.title + ". " + description,
    "No people, characters or silhouettes. Empty environment only.",
    "Show the exact same location from four camera angles. Keep the same space, furniture, props, colors, materials and lighting direction across all four panels. Objects naturally reappear between panels. Do not invent a different place in any panel.",
    "Panel A (top left): wide front view. Panel B (top right): right-side view. Panel C (bottom left): back / reverse view. Panel D (bottom right): left-side view.",
    "Put each panel in its own framed box. Place each label on a clean solid bar directly below its panel, OUTSIDE the artwork: A / FRONT VIEW, B / RIGHT VIEW, C / BACK VIEW, D / LEFT VIEW. No other text or watermark.",
    requirements,
  ].filter(Boolean).join("\n\n");
  return [
    "GENERATE ONE FINISHED PRODUCT OR PROP REFERENCE IMAGE. NO TEXT IN THE IMAGE.",
    "Reference: " + item.title + ". " + item.prompt,
    "Single product or prop on a neutral backdrop. Preserve exact shape, material, color and defining details. No people, invented branding, collage, labels or watermark.",
    "Visual style: " + style + ". Aspect ratio: " + form.aspectRatio + ".", requirements,
  ].filter(Boolean).join("\n\n");
}


export async function translateAssetDescriptionBilingual(apiKey: string, model: string, source: string): Promise<{ myanmar: string; english: string }> {
  const input = source.trim();
  if (!input) return { myanmar: "အသေးစိတ်ဖော်ပြချက် မပေးထားပါ။", english: "No additional description provided." };
  const raw = await generateJson<unknown>(apiKey, model, [
    "Translate this visual asset description into two equivalent, complete versions. Return JSON only with keys {myanmar:string, english:string}.",
    "myanmar must be fluent natural Burmese written in Myanmar script, not romanized. english must be natural, precise English suitable for an AI image-generation prompt.",
    "Preserve all visual details, colors, clothing, relationships, constraints, and proper names. Do not add, omit, reinterpret, or summarize details. If the source is already in one requested language, keep its meaning unchanged in that language.",
    "SOURCE DESCRIPTION:",
    JSON.stringify({ source: input }),
  ].join("\n"));
  return z.object({ myanmar: z.string().trim().min(1).max(10000), english: z.string().trim().min(1).max(10000) }).parse(raw);
}

const visualStyleMyanmar: Record<VideoForm["visualStyle"], string> = {
  "Realistic tutorial": "လက်တွေ့ဆန်သော သင်ခန်းစာဗီဒီယိုပုံစံ",
  "Cinematic live action": "ရုပ်ရှင်ဆန်သော လက်တွေ့ရိုက်ကူးမှုပုံစံ",
  "3D animation": "အရည်အသွေးမြင့် 3D ကာတွန်းပုံစံ",
  "2D motion graphics": "2D motion graphics ပုံစံ",
  "Presenter-led": "တင်ဆက်သူဦးဆောင်သော ဗီဒီယိုပုံစံ",
  "Fast-paced social video": "လျင်မြန်သွက်လက်သော လူမှုကွန်ရက်ဗီဒီယိုပုံစံ",
};

export function referenceImagePromptMyanmar(item: ReferencePlanItem, form: VideoForm): string {
  if (item.fullPrompt !== undefined) return item.fullPrompt;
  const style = visualStyleMyanmar[form.visualStyle];
  const requirements = form.referenceNotes ? "အသုံးပြုသူ၏ ထပ်ဆောင်းလိုအပ်ချက်များ: " + form.referenceNotes : "";
  if (item.kind === "character") return [
    "ပညာရေးဆိုင်ရာ ဗီဒီယိုစီးရီးတွင် ထပ်ခါထပ်ခါအသုံးပြုမည့် ဇာတ်ကောင် reference sheet တစ်ခုကို အပြီးသတ်ဖန်တီးပါ။ ပုံအချိုး 16:9 ဖြစ်ရမည်။",
    "ဇာတ်ကောင်အမည်: " + item.title,
    "ဇာတ်ကောင်၏ ရုပ်သွင်ဖော်ပြချက်: " + item.prompt,
    "ရုပ်ပုံပုံစံ: " + style + "။ နူးညံ့သဘာဝကျသော ရုပ်ရှင်အလင်းရောင်ကို အသုံးပြုပါ။",
    "ဇာတ်ကောင်တစ်ဦးတည်း၏ ကိုယ်လုံးအပြည့် မြင်ကွင်းများကို ရှေ့တည့်တည့်၊ သုံးပုံတစ်ပုံလှည့်၊ ဘေးတိုက်နှင့် နောက်ကျော မြင်ကွင်းများအဖြစ် ပြပါ။ ထို့အပြင် ပျော်ရွှင်၊ အံ့အားသင့်၊ စဉ်းစားနေပြီး ပုံမှန်မျက်နှာထားဟူသော မျက်နှာအမူအရာ ၄ မျိုးကို အနီးကပ်ပြပါ။",
    "မြင်ကွင်းနှင့် မျက်နှာအမူအရာအားလုံးတွင် မျက်နှာ၊ ဆံပင်၊ အဝတ်အစား၊ ကိုယ်ခန္ဓာအချိုးအစားနှင့် အရောင်များကို အတိအကျတူညီစွာ ထိန်းထားပါ။ လူတစ်ဦးတည်းကိုသာ ဖော်ပြပါ။ ပေးထားသော reference ပုံရှိပါက သူ၏အမှတ်အသားနှင့် အဝတ်အစားကို မပြောင်းပါနှင့်။",
    'ပုံ၏ အပေါ်ညာဘက်၊ ဇာတ်ကောင်ပုံများ၏ အပြင်ဘက်တွင် အဝါရောင်နောက်ခံနှင့် အနက်ရောင်စာလုံးဖြင့် "အမည်: ' + item.title + '" ဟု တစ်နေရာတည်းတွင်သာ ရေးပါ။ အခြားစာသားနှင့် watermark မပါစေရ။',
    "အလင်းမီးခိုးရောင် ရိုးရှင်းသန့်ရှင်းသော studio နောက်ခံကို အသုံးပြုပါ။ ကိုယ်လုံး၊ ဖိနပ်နှင့် ဆက်စပ်ပစ္စည်းအားလုံးကို ဖြတ်မထွက်စေဘဲ အပြည့်ပြပါ။ မြင်ကွင်းတစ်ခုစီကို သေသပ်ညီညာသော model sheet အဖြစ် စီစဉ်ပါ။",
    requirements,
  ].filter(Boolean).join("\n\n");
  if (item.kind === "background") return [
    "ဗီဒီယိုစီးရီးတွင် ပြန်လည်အသုံးပြုနိုင်မည့် နေရာနောက်ခံ reference sheet တစ်ခုကို အပြီးသတ်ဖန်တီးပါ။ ပုံအချိုး 16:9 ဖြစ်ပြီး တစ်နေရာတည်းကို ပြသသော 2x2 အကွက်လေးကွက် ပါရမည်။",
    "နေရာအမည်: " + item.title,
    "နေရာဖော်ပြချက်: " + item.prompt,
    "ရုပ်ပုံပုံစံ: " + style + "။ နွေးထွေးသော ရုပ်ရှင်ဆန်သည့် အလင်းရောင်ကို သုံးပါ။",
    "လူ၊ ဇာတ်ကောင်၊ လူပုံရိပ်အရိပ် မပါစေရ။ နေရာဗလာကိုသာ ပြပါ။",
    "အကွက်လေးခုလုံးသည် တစ်နေရာတည်း၏ မတူညီသော ကင်မရာထောင့်များ ဖြစ်ရမည်။ အခန်းဖွဲ့စည်းပုံ၊ ပရိဘောဂ၊ ပစ္စည်းများ၊ အရောင်၊ ပစ္စည်းမျက်နှာပြင်နှင့် အလင်းရောင်ဦးတည်ချက်တို့ မပြောင်းပါနှင့်။ အကွက်တစ်ခုစီတွင် ယခင်အကွက်ရှိ ပစ္စည်းများကို သဘာဝကျစွာ ပြန်တွေ့ရပါမည်။",
    "အကွက် A (ဘယ်အပေါ်): ရှေ့တည့်တည့် မြင်ကွင်း။ အကွက် B (ညာအပေါ်): ညာဘက်မှ မြင်ကွင်း။ အကွက် C (ဘယ်အောက်): နောက်ကျော/ပြောင်းပြန်မြင်ကွင်း။ အကွက် D (ညာအောက်): ဘယ်ဘက်မှ မြင်ကွင်း။",
    "အကွက်တစ်ခုစီကို သီးခြားဘောင်ထဲတွင် ထားပါ။ အကွက်ပုံ၏ အပြင်ဘက်၊ အောက်ဘက်ရှိ သီးခြားအရောင်တစ်တန်းပေါ်တွင် A / ရှေ့မြင်ကွင်း၊ B / ညာမြင်ကွင်း၊ C / နောက်မြင်ကွင်း၊ D / ဘယ်မြင်ကွင်း ဟု တစ်ခုစီရေးပါ။ အခြားစာသားနှင့် watermark မပါစေရ။",
    requirements,
  ].filter(Boolean).join("\n\n");
  return [
    "ထုတ်ကုန် သို့မဟုတ် အသုံးအဆောင်တစ်ခု၏ အပြီးသတ် reference ပုံတစ်ပုံကို ဖန်တီးပါ။ ပုံထဲတွင် စာသားမပါစေရ။",
    "ပစ္စည်းအမည်: " + item.title + "။ ဖော်ပြချက်: " + item.prompt,
    "ရိုးရှင်းသော နောက်ခံပေါ်တွင် ပစ္စည်းတစ်ခုတည်းကိုသာ ပြပါ။ ပုံသဏ္ဌာန်၊ ပစ္စည်းအသား၊ အရောင်နှင့် ခွဲခြားသိသာစေသော အသေးစိတ်များကို မပြောင်းပါနှင့်။ လူ၊ အတုအမှတ်တံဆိပ်၊ collage၊ label သို့မဟုတ် watermark မပါစေရ။",
    "ရုပ်ပုံပုံစံ: " + style + "။ ပုံအချိုး: " + form.aspectRatio + "။",
    requirements,
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
      "Use at most 12 assets total and at most 3 per scene. Only create reusable references that are necessary for consistency. A simple standalone landscape or abstract shot can have no references. Use kind prop for important recurring products/objects; do not create a separate prop for every incidental object. Inspect every scene visualDescription, action and flowPrompt for visible characters, including people, animals and fictional characters. Include a character reference for each distinct visible character even if they appear in only one scene; do not invent people for product-only or landscape shots. Reuse one asset across scenes for the same person/outfit or location. Describe face, hair, clothing, proportions for characters and geography, lighting and fixed props for backgrounds. Image prompts must be standalone English. Return subject design descriptions only, without layout commands or prohibitions on text/grids; the app adds the reference-sheet layout. Give each character a short recognizable name as title. Characters will use a 16:9 turnaround with four expressions and a name label; backgrounds will use a 16:9 four-angle A/B/C/D sheet. Backgrounds: no people.",
      referenceDetailRequirements,
      board.promptLanguage === "my" ? "DRAFT MODE: Override English-output instructions. Write all asset titles and design prompts in Burmese for user review. Keep kind and exact sceneIds unchanged. Do not translate to English yet." : "Write design prompts in English.",
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
        const image = await generateImage(apiKey, prompt, item.kind === "prop" ? form.aspectRatio : "16:9", form.referenceImages);
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
