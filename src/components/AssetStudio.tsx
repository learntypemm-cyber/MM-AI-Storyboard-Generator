import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, CheckCircle2, Copy, ImagePlus, MapPin, Pause, Play, RotateCcw, Trash2, Upload, Users, Wand2, X, Images } from "lucide-react";
import { assetAsReference, putAsset, readAssets, removeAsset, sceneReferences } from "../lib/assetStore";
import type { ImageAsset, ReferenceImage, Scene, Storyboard, VideoForm, VisualStyle } from "../types";
import "./AssetStudio.css";
import { generateImage, IMAGE_MODEL } from "../lib/imageGeneration";
import { translateAssetDescriptionBilingual } from "../lib/automaticAssets";

type AssetKind = "character" | "background" | "scene";
type StudioTab = "character" | "background" | "scene";
type JobState = "idle" | "running" | "paused" | "done" | "cancelled";
type Props = {
  protectedAssetIds: string[]; projectId: string; onAssetsChanged: () => void;
  open: boolean; onClose: () => void; apiKey: string; model: string; projectTitle: string; topic: string;
  visualStyle: VisualStyle; aspectRatio: VideoForm["aspectRatio"];
  projectReferences: ReferenceImage[]; storyboard: Storyboard | null;
};

const MAX_REFERENCES = 4;

function makeId(): string { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9); }
function safeSlug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mm-storyboard-image";
}
function wait(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
async function fileToReference(file: File): Promise<ReferenceImage> {
  if (!file.type.startsWith("image/")) throw new Error(file.name + " is not an image file.");
  if (file.size > 15 * 1024 * 1024) throw new Error(file.name + " is larger than 15 MB. Choose a smaller image.");
  const originalDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read " + file.name + "."));
    reader.onerror = () => reject(new Error("Could not read " + file.name + "."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode " + file.name + "."));
    img.src = originalDataUrl;
  });
  const scale = Math.min(1, 1280 / image.naturalWidth, 1280 / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare " + file.name + ".");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const previewUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { name: file.name, mimeType: "image/jpeg", data: previewUrl.slice(previewUrl.indexOf(",") + 1), previewUrl };
}
function downloadAsset(asset: ImageAsset): void {
  const binary = atob(asset.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = safeSlug(asset.title) + (asset.sceneNumber ? "-scene-" + asset.sceneNumber : "") + (asset.mimeType === "image/jpeg" ? ".jpg" : ".png");
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CharacterPrompt(title: string, description: string, style: VisualStyle): string {
  return [
    "GENERATE ONE FINISHED CHARACTER REFERENCE SHEET. Aspect ratio: 16:9.",
    "Character: " + (title.trim() || "MAY") + ". " + (description.trim() || "A friendly, approachable, memorable character suitable for a Myanmar typing tutorial."),
    "Visual style: " + style + ". Cinematic soft lighting, clear silhouette, believable anatomy, polished detail and readable facial features.",
    "Character sheet layout: full-body turnaround showing front view, 3/4 view, side view, and back view. Separate head close-ups showing exactly four facial expressions: happy, surprised, thoughtful, and neutral.",
    "Keep the exact same face, hairstyle, outfit, body proportions, colors and accessories consistent across every angle and expression. These are multiple views of ONE character, not different characters. Show the complete body, shoes and accessories without cropping.",
    'Place exactly "Name: ' + (title.trim() || "MAY") + '" in the upper-right corner in bold black text on a yellow rectangular background, outside the character drawings. No other text, label or watermark.',
    "Clean neutral light-grey studio background, soft even studio lighting with no harsh shadows, professional model-sheet composition.",
    "If a reference image is attached in Google Flow, treat it as the identity source of truth. Preserve the exact face, age, skin tone, hair, body proportions, distinctive features, clothing and accessories; improve clarity and finish only."
  ].join("\n\n");
}
function BackgroundPrompt(name: string, description: string, time: string, style: VisualStyle, aspectRatio: string): string {
  return [
    "Generate one finished cinematic environment/background plate for a recurring video project.",
    "LOCATION: " + (name.trim() || "Typing tutorial environment"),
    "ENVIRONMENT DETAILS: " + (description.trim() || "A clean, welcoming workspace for a Myanmar typing lesson, desk, computer keyboard, natural materials and tidy composition."),
    "LIGHTING / TIME: " + time,
    "VISUAL STYLE: " + style + ". Aspect ratio: " + aspectRatio + ".",
    "Create a useful environment for compositing a character later: clear foreground, readable midground and background, realistic perspective, coherent shadows, and a deliberate focal area. No people, characters, silhouettes, readable text, logos, UI or watermark.",
    "Create one single full-frame location image. Do not make a collage, mood board, grid, multiple camera angles or storyboard sheet."
  ].join("\n\n");
}

const visualStyleMyanmar: Record<VisualStyle, string> = {
  "Realistic tutorial": "လက်တွေ့ဆန်သော သင်ခန်းစာဗီဒီယိုပုံစံ",
  "Cinematic live action": "ရုပ်ရှင်ဆန်သော လက်တွေ့ရိုက်ကူးမှုပုံစံ",
  "3D animation": "အရည်အသွေးမြင့် 3D ကာတွန်းပုံစံ",
  "2D motion graphics": "2D motion graphics ပုံစံ",
  "Presenter-led": "တင်ဆက်သူဦးဆောင်သော ဗီဒီယိုပုံစံ",
  "Fast-paced social video": "လျင်မြန်သွက်လက်သော လူမှုကွန်ရက်ဗီဒီယိုပုံစံ",
};
const backgroundTimeMyanmar: Record<string, string> = {
  "Soft daylight from a nearby window": "အနီးရှိ ပြတင်းပေါက်မှ နူးညံ့သော နေ့အလင်းရောင်",
  "Warm morning sunlight": "နွေးထွေးသော နံနက်ခင်း နေရောင်",
  "Bright neutral studio lighting": "တောက်ပပြီး အရောင်မ偏သော studio အလင်းရောင်",
  "Golden hour, late afternoon": "နေ့လယ်နောက်ပိုင်း ရွှေရောင်နေရောင်ချိန်",
  "Quiet evening with practical lamps": "အခန်းသုံးမီးများဖြင့် ငြိမ်သက်သော ညနေခင်း",
  "Blue-hour cinematic lighting": "နေဝင်ချိန်အပြာရောင် ရုပ်ရှင်ဆန်သောအလင်းရောင်",
};
function CharacterPromptMyanmar(title: string, description: string, style: VisualStyle, format: string): string {
  const formatInstruction = format === "Turnaround sheet"
    ? "ဇာတ်ကောင်တစ်ဦးတည်း၏ ကိုယ်လုံးအပြည့် ရှေ့တည့်တည့်၊ သုံးပုံတစ်ပုံလှည့်၊ ဘေးတိုက်နှင့် နောက်ကျောမြင်ကွင်းများပါသော reference sheet တစ်ခု ဖန်တီးပါ။ မျက်နှာ၊ ဆံပင်၊ အဝတ်အစား၊ အရပ်၊ ကိုယ်ခန္ဓာအချိုးအစားနှင့် ဆက်စပ်ပစ္စည်းများကို အားလုံးတွင် တူညီစွာ ထိန်းပါ။ ရိုးရှင်းသော နောက်ခံ၊ အကွာအဝေးညီညာစွာထားပြီး စာသားမပါစေရ။"
    : format === "Expression sheet"
      ? "ဇာတ်ကောင်တစ်ဦးတည်း၏ ခေါင်းနှင့်ပခုံးပုံ ၆ ပုံပါသော မျက်နှာအမူအရာ reference sheet တစ်ခု ဖန်တီးပါ။ မျက်နှာ၊ ဆံပင်၊ အသားအရောင်၊ အသက်အရွယ်၊ အဝတ်အစားကော်လာနှင့် အချိုးအစားကို တူညီစွာ ထိန်းပါ။ အမူအရာတစ်ခုစီကို သီးခြားရှင်းလင်းစွာ ပြပါ။ စာသားမပါစေရ။"
      : "ကိုယ်လုံးအပြည့် မြင်ရသော ဇာတ်ကောင် reference portrait တစ်ပုံကို အလယ်ဗဟိုတွင် ဖန်တီးပါ။ မျက်နှာ၊ ဆံပင်ပုံစံ၊ အဝတ်အစား၊ ဖိနပ်နှင့် ခွဲခြားသိသာစေသော ဆက်စပ်ပစ္စည်းများကို ရှင်းလင်းစွာ ပြပါ။ နောက်ခံကို ရိုးရှင်းသန့်ရှင်းစွာထားပါ။";
  return [
    "ပညာရေးဆိုင်ရာ ဗီဒီယိုစီးရီးတွင် ပြန်လည်အသုံးပြုမည့် ဇာတ်ကောင် reference ပုံကို အပြီးသတ်ဖန်တီးပါ။",
    "ဇာတ်ကောင်အမည်: " + (title.trim() || "အဓိကဇာတ်ကောင်"),
    "အသုံးပြုသူ၏ ဖော်ပြချက် သို့မဟုတ် ပြင်ဆင်လိုသည့်အရာ: " + (description.trim() || "မြန်မာစာရိုက်သင်ခန်းစာအတွက် ဖော်ရွေပြီး မှတ်မိလွယ်သော ဇာတ်ကောင်တစ်ဦး ဖန်တီးပါ။"),
    "ရုပ်ပုံပုံစံ: " + visualStyleMyanmar[style] + "။ ခန္ဓာကိုယ်ပုံစံ သဘာဝကျစေပြီး မျက်နှာအမူအရာ၊ အသေးစိတ်နှင့် အလင်းရောင်ကို သေသပ်စွာဖော်ပြပါ။",
    formatInstruction,
    "Reference ပုံများ ပေးထားပါက မူရင်းဇာတ်ကောင်၏ မျက်နှာ၊ ကိုယ်ပိုင်လက္ခဏာ၊ အသက်အရွယ်၊ အသားအရောင်၊ ဆံပင်၊ ကိုယ်ခန္ဓာအချိုးအစား၊ အဝတ်အစားနှင့် ဆက်စပ်ပစ္စည်းများကို မပြောင်းပါနှင့်။ အသုံးပြုသူက ပြောင်းရန် တိတိကျကျ မတောင်းဆိုလျှင် ဒီဇိုင်းအသစ် မပြုလုပ်ပါနှင့်။",
    "နောင် scene များတွင် အလွယ်တကူ ခွဲခြားမှတ်မိနိုင်အောင် ဖန်တီးပါ။ watermark၊ ထပ်နေသောဇာတ်ကောင်၊ ခန္ဓာကိုယ်အစိတ်အပိုင်းပိုများခြင်း၊ လက်ချောင်းပိုများခြင်း၊ မသက်ဆိုင်သောပစ္စည်းနှင့် ဖတ်လို့ရသောစာသားများ မပါစေရ။",
  ].join("\n\n");
}
function BackgroundPromptMyanmar(name: string, description: string, time: string, style: VisualStyle, aspectRatio: string): string {
  return [
    "ဗီဒီယိုပရောဂျက်တွင် ပြန်လည်အသုံးပြုနိုင်မည့် နေရာနောက်ခံပုံတစ်ပုံကို အပြီးသတ်ဖန်တီးပါ။",
    "နေရာအမည်: " + (name.trim() || "စာရိုက်သင်ခန်းစာနေရာ"),
    "ပတ်ဝန်းကျင်အသေးစိတ်: " + (description.trim() || "မြန်မာစာရိုက်သင်ခန်းစာအတွက် သန့်ရှင်းဖော်ရွေသော စားပွဲ၊ ကီးဘုတ်နှင့် ကွန်ပျူတာပါဝင်သည့် အလုပ်လုပ်ရာနေရာ။"),
    "အလင်းရောင် / အချိန်: " + (backgroundTimeMyanmar[time] || time),
    "ရုပ်ပုံပုံစံ: " + visualStyleMyanmar[style] + "။ ပုံအချိုး: " + aspectRatio + "။",
    "နောက်ပိုင်းတွင် ဇာတ်ကောင်ကို ထပ်တင်နိုင်စေရန် ရှေ့ပိုင်း၊ အလယ်ပိုင်းနှင့် နောက်ခံပိုင်းကို ခွဲခြားဖော်ပြပါ။ Perspective၊ အရိပ်နှင့် အာရုံစိုက်ရမည့်နေရာကို သဘာဝကျစွာ ဖန်တီးပါ။ လူ၊ ဇာတ်ကောင်၊ လူပုံအရိပ်၊ ဖတ်လို့ရသောစာသား၊ logo၊ UI သို့မဟုတ် watermark မပါစေရ။",
    "ပုံအပြည့် တစ်ပုံတည်းကိုသာ ဖန်တီးပါ။ Collage၊ mood board၊ grid၊ ကင်မရာထောင့်မျိုးစုံ သို့မဟုတ် storyboard sheet မဖန်တီးပါနှင့်။",
  ].join("\n\n");
}
function SceneImagePrompt(scene: Scene, storyboard: Storyboard, projectTitle: string, visualStyle: VisualStyle, aspectRatio: string, topic: string): string {
  return [
    "GENERATE ONE FINISHED IMAGE FOR THIS STORYBOARD SCENE NOW. Do not return a written plan.",
    "PROJECT: " + projectTitle, "TOPIC: " + topic,
    "SCENE " + scene.sceneNumber + ": " + scene.title,
    "PURPOSE: " + scene.objective, "SCENE ACTION: " + scene.action, "VISUAL DESCRIPTION: " + scene.visualDescription,
    "SHOT / CAMERA: " + scene.shotSize + " / " + scene.cameraMovement,
    "LIGHTING / MOOD: " + scene.lighting + " / " + scene.mood,
    "VISUAL BIBLE: " + storyboard.visualBible,
    "CONTINUITY RULES: " + (storyboard.continuityRules || []).join(" | "),
    "STYLE AND FORMAT: " + visualStyle + ", aspect ratio " + aspectRatio + ".",
    "Use selected character references as the identity source of truth for recurring people. Use selected environment references to keep location, props, materials, layout and light consistent. Adapt the reference to this scene's camera framing without changing a recurring character's identity or wardrobe.",
    "Compose one clear keyframe-like still image with a strong focal point, plausible hands and props, consistent perspective and production-ready visual quality. No unintended split panels.",
    "No visible text, captions, subtitles, watermarks, panel numbers, labels, fake product UI or added logos. Avoid extra fingers, malformed hands, duplicate characters, changed outfits, distorted keyboards and actions not in this scene brief.",
    "This is one separate image file for Scene " + scene.sceneNumber + ", not a contact sheet and not a video."
  ].join("\n\n");
}

export default function AssetStudio(props: Props) {
  const { protectedAssetIds, projectId, onAssetsChanged, open, onClose, apiKey, model, projectTitle, topic, visualStyle, aspectRatio, projectReferences, storyboard } = props;
  const [tab, setTab] = useState<StudioTab>("character");
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [refs, setRefs] = useState<ReferenceImage[]>([]);
  const [useProjectReferences, setUseProjectReferences] = useState(false);
  const [characterName, setCharacterName] = useState("MAY");
  const [characterDescription, setCharacterDescription] = useState("");
  const [backgroundName, setBackgroundName] = useState("LearnTypeMM typing workspace");
  const [backgroundDescription, setBackgroundDescription] = useState("A clean modern desk with a keyboard, monitor, comfortable chair, subtle blue accents, and enough open space for a presenter. Realistic, tidy, friendly and calm.");
  const [backgroundTime, setBackgroundTime] = useState("Soft daylight from a nearby window");
  const [busyId, setBusyId] = useState("");
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [jobState, setJobState] = useState<JobState>("idle");
  const [jobProgress, setJobProgress] = useState({ total: 0, complete: 0, failed: 0, current: "" });
  const controls = useRef({ paused: false, cancelled: false });
  const isBusy = Boolean(busyId) || jobState === "running" || jobState === "paused";

  useEffect(() => {
    if (!open) return;
    let live = true;
    readAssets().then((items) => { if (live) setAssets(items.filter((asset) => asset.kind !== "scene" || asset.projectId === projectId || !asset.projectId)); })
      .catch((caught: unknown) => { if (live) setStorageError(caught instanceof Error ? caught.message : "The asset library could not be loaded."); });
    return () => { live = false; };
  }, [open, projectId]);

  const selectedAssets = useMemo(() => assets.filter((asset) => asset.projectId === projectId && asset.useAsReference && asset.kind !== "scene"), [assets, projectId]);

  const visibleAssets = useMemo(() => assets.filter((asset) => tab === "scene" ? true : asset.kind === tab), [assets, tab]);

  function inputReferences(scene?: Scene): ReferenceImage[] {
    const chosen: ReferenceImage[] = [];
    if (useProjectReferences) chosen.push(...projectReferences);
    chosen.push(...refs);
    (scene ? sceneReferences(scene, assets.filter((asset) => asset.projectId === projectId)) : selectedAssets).forEach((asset) => chosen.push(assetAsReference(asset)));
    const unique = chosen.filter((image, index, list) => image.data && list.findIndex((other) => other.name === image.name && other.data === image.data) === index);
    return unique;
  }
  async function saveGenerated(kind: AssetKind, title: string, prompt: string, image: { data: string; mimeType: string }, sceneNumber?: number, sceneId?: string, promptMy = prompt, promptEn = prompt): Promise<ImageAsset> {
    const asset: ImageAsset = {
      id: makeId(), kind, title: title.trim() || (kind === "scene" ? "Scene " + sceneNumber : kind === "character" ? "Character reference" : "Background"),
      prompt: promptEn, promptMy, promptEn, mimeType: image.mimeType, data: image.data, createdAt: new Date().toISOString(), projectId, sceneId, sceneNumber, useAsReference: kind !== "scene" && selectedAssets.length < MAX_REFERENCES
    };
    await putAsset(asset);
    setAssets((current) => [asset, ...current]);
    onAssetsChanged();
    setNotice("Saved " + asset.title + " to your local Asset Library.");
    return asset;
  }
  async function generateBackground(): Promise<void> {
    setError(""); setNotice("");
    if (!apiKey.trim()) { setError("Add your Gemini API key in Settings first, then reopen Asset Studio."); return; }
    setBusyId("background");
    try {
      const source = backgroundDescription.trim() || "A clean, welcoming workspace for a Myanmar typing lesson, desk, computer keyboard, natural materials and tidy composition. Realistic, tidy, friendly and calm.";
      setNotice("မြန်မာနှင့် English prompt နှစ်မျိုး ပြင်ဆင်ပြီး background ပုံထုတ်နေပါတယ်…");
      const versions = await translateAssetDescriptionBilingual(apiKey, model, source);
      const promptEn = BackgroundPrompt(backgroundName, versions.english, backgroundTime, visualStyle, aspectRatio);
      const promptMy = BackgroundPromptMyanmar(backgroundName, versions.myanmar, backgroundTime, visualStyle, aspectRatio);
      const image = await generateImage(apiKey, promptEn, aspectRatio, inputReferences());
      await saveGenerated("background", backgroundName || "Background", promptEn, image, undefined, undefined, promptMy, promptEn);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not generate this background image."); }
    finally { setBusyId(""); }
  }
  async function copyText(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label); setNotice(label + " copied to clipboard.");
      window.setTimeout(() => setCopied(""), 1600);
    } catch { setError("Clipboard access was blocked. Select and copy the text manually."); }
  }
  async function runSceneQueue(sceneIds: string[]): Promise<void> {
    if (!apiKey.trim()) { setError("Add your Gemini API key in Settings first, then reopen Asset Studio."); return; }
    if (!storyboard) { setError("Build a storyboard before generating scene images."); return; }
    const queue = storyboard.scenes.filter((scene) => sceneIds.includes(scene.id) && !scene.locked);
    if (!queue.length) { setError("Choose at least one scene."); return; }
    controls.current = { paused: false, cancelled: false };
    setError(""); setNotice(""); setJobState("running");
    setJobProgress({ total: queue.length, complete: 0, failed: 0, current: "" }); setBusyId("");
    let completed = 0;
    let failed = 0;
    for (const scene of queue) {
      while (controls.current.paused && !controls.current.cancelled) await wait(180);
      if (controls.current.cancelled) break;
      setJobProgress((current) => ({ ...current, current: "Scene " + scene.sceneNumber + ": " + scene.title }));
      const prompt = SceneImagePrompt(scene, storyboard, projectTitle, visualStyle, aspectRatio, topic);
      try {
        const image = await generateImage(apiKey, prompt, aspectRatio, inputReferences(scene));
        await saveGenerated("scene", "Scene " + scene.sceneNumber + " - " + scene.title, prompt, image, scene.sceneNumber, scene.id);
      } catch (caught) {
        failed += 1;
        setError("Scene " + scene.sceneNumber + " failed: " + (caught instanceof Error ? caught.message : "Image generation failed.") + " The queue will continue with the next scene.");
      }
      completed += 1;
      setJobProgress({ total: queue.length, complete: completed, failed, current: completed < queue.length ? "Preparing next image..." : "" });
    }
    if (controls.current.cancelled) { setJobState("cancelled"); setNotice("Batch stopped after the current image. Completed images remain saved."); }
    else { setJobState("done"); setNotice("Batch finished: " + (completed - failed) + " images generated, " + failed + " failed. Each scene image is saved separately."); }
  }
  async function toggleReference(asset: ImageAsset): Promise<void> {
    if (isBusy) return;
    const selecting = asset.projectId !== projectId || !asset.useAsReference;
    if (selecting && selectedAssets.length >= MAX_REFERENCES) { setError("Choose at most four project references. Deselect one first."); return; }
    const updated = { ...asset, handle: asset.projectId === projectId ? asset.handle : undefined, id: asset.projectId === projectId ? asset.id : makeId(), projectId, useAsReference: selecting };
    try {
      await putAsset(updated);
      setAssets((current) => asset.projectId === projectId ? current.map((item) => item.id === asset.id ? updated : item) : [updated, ...current]);
      onAssetsChanged();
    } catch (caught) { setStorageError(caught instanceof Error ? caught.message : "Could not update reference selection."); }
  }
  async function deleteImage(asset: ImageAsset): Promise<void> {
    if (isBusy) return;
    if (asset.kind === "scene" && storyboard?.scenes.some((scene) => scene.id === asset.sceneId && scene.locked)) { setError("Unlock this scene before deleting its image."); return; }
    if (protectedAssetIds.includes(asset.id) || (asset.kind !== "scene" && asset.useAsReference)) { setError("This asset is used by a scene, version or project reference set. Keep it for continuity."); return; }
    try { await removeAsset(asset.id); setAssets((current) => current.filter((item) => item.id !== asset.id)); setNotice("Deleted " + asset.title + " from the local library."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this image."); }
  }
  async function addReferences(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    setError(""); setNotice("");
    const room = Math.max(0, MAX_REFERENCES - refs.length);
    if (room === 0) { setError("Up to four extra reference images can be attached. Remove one before adding another."); return; }
    const chosen = Array.from(files).slice(0, room);
    try {
      const loaded = await Promise.all(chosen.map(fileToReference));
      setRefs((current) => [...current, ...loaded].slice(0, MAX_REFERENCES));
      setNotice(loaded.length + " reference image(s) ready. Large images are resized locally before upload.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load the reference images."); }
  }
  function pauseResume(): void {
    if (jobState === "running") { controls.current.paused = true; setJobState("paused"); }
    else if (jobState === "paused") { controls.current.paused = false; setJobState("running"); }
  }
  function cancelBatch(): void { controls.current.cancelled = true; controls.current.paused = false; }
  function promptForDownload(): void {
    const promptLines = assets.map((asset) =>
      "TYPE: " + asset.kind.toUpperCase() + "\nTITLE: " + asset.title + "\nCREATED: " + asset.createdAt +
      (asset.sceneNumber ? "\nSCENE: " + asset.sceneNumber : "") +
      "\n\nBURMESE PROMPT / မြန်မာဗားရှင်း:\n" + (asset.promptMy || asset.prompt) +
      "\n\nENGLISH PROMPT / အင်္ဂလိပ်ဗားရှင်း:\n" + (asset.promptEn || asset.prompt)
    ).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([promptLines], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "mm-storyboard-asset-prompts.txt"; link.click(); URL.revokeObjectURL(url);
  }
  if (!open) return null;

  const refsCount = inputReferences().length;
  const characterNameValid = /^[A-Za-z][A-Za-z0-9 _'-]{0,79}$/.test(characterName.trim());
  const characterSheetPrompt = CharacterPrompt(characterName, characterDescription, visualStyle);
  const allScenes = storyboard?.scenes || [];
  const missingScenes = allScenes.filter((scene) => !scene.locked && !assets.some((asset) => asset.kind === "scene" && asset.sceneId === scene.id && asset.projectId === projectId));

  return (
    <div className="asset-studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBusy) onClose(); }}>
      <section className="asset-studio" role="dialog" aria-modal="true" aria-labelledby="asset-studio-title">
        <header className="asset-studio-header">
          <div className="asset-studio-brand"><div className="asset-studio-mark"><Images size={20} /></div><div><h2 id="asset-studio-title">AI Asset Studio</h2><p>Characters · Backgrounds · Scene-by-scene images</p></div></div>
          <div className="asset-studio-header-right"><span className={apiKey ? "asset-api-status good" : "asset-api-status"}>{apiKey ? "Gemini image API ready" : "API key required"}</span><button className="asset-icon-button" onClick={onClose} disabled={isBusy} aria-label="Close Asset Studio"><X size={19} /></button></div>
        </header>
        <div className="asset-studio-projectbar">
          <div><span>PROJECT</span><strong>{projectTitle || topic || "Untitled project"}</strong></div>
          <div><span>IMAGE MODEL</span><strong>{IMAGE_MODEL}</strong></div>
          <div><span>OUTPUT</span><strong>{aspectRatio} · 1K PNG</strong></div>
        </div>
        <div className="asset-studio-layout">
          <aside className="asset-studio-sidebar">
            <div className="asset-sidebar-label">PRODUCTION ASSETS</div>
            <button className={tab === "character" ? "asset-tab active" : "asset-tab"} onClick={() => setTab("character")}><Users size={17} /><span><strong>Character Studio</strong><small>Create or refine a character</small></span><b>{assets.filter((asset) => asset.kind === "character").length}</b></button>
            <button className={tab === "background" ? "asset-tab active" : "asset-tab"} onClick={() => setTab("background")}><MapPin size={17} /><span><strong>Background Studio</strong><small>Reusable locations and sets</small></span><b>{assets.filter((asset) => asset.kind === "background").length}</b></button>
            <button className={tab === "scene" ? "asset-tab active" : "asset-tab"} onClick={() => setTab("scene")}><ImagePlus size={17} /><span><strong>Scene images</strong><small>One separate image per scene</small></span><b>{assets.filter((asset) => asset.kind === "scene").length}</b></button>
            <div className="asset-sidebar-tip"><CheckCircle2 size={16} /><div><strong>Keep continuity</strong><p>Mark a character or background image as a reference. Later generations can reuse it to help maintain the same look.</p></div></div>
            <div className="asset-sidebar-bottom"><span>{assets.length} saved images</span><button onClick={promptForDownload} disabled={!assets.length}><ArrowDownToLine size={14} /> Export prompts</button></div>
          </aside>
          <main className="asset-studio-main">
            {(error || storageError) && <div className="asset-alert error"><AlertCircle size={16} /><span>{error || storageError}</span><button onClick={() => { setError(""); setStorageError(""); }} aria-label="Dismiss error"><X size={14} /></button></div>}
            {notice && <div className="asset-alert success"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={14} /></button></div>}
            <section className="asset-reference-panel">
              <div className="asset-reference-heading"><div><strong>Visual reference inputs</strong><p>Upload your own character or environment. Images are resized locally and sent only when generation is requested.</p></div><label className="asset-upload-button"><Upload size={14} /> Add reference images<input type="file" accept="image/*" multiple onChange={(event) => { void addReferences(event.target.files); event.currentTarget.value = ""; }} /></label></div>
              {projectReferences.length > 0 && <label className="asset-project-reference-toggle"><input type="checkbox" checked={useProjectReferences} onChange={(event) => setUseProjectReferences(event.target.checked)} /> Include the {projectReferences.length} reference image(s) from the main video brief</label>}
              {refs.length > 0 && <div className="asset-reference-thumbs">{refs.map((image, index) => <div className="asset-reference-thumb" key={image.name + "-" + index}><img src={image.previewUrl} alt={image.name} /><span title={image.name}>{image.name}</span><button onClick={() => setRefs((current) => current.filter((_, i) => i !== index))} aria-label={"Remove " + image.name}><X size={12} /></button></div>)}</div>}
              <div className="asset-reference-count">{refsCount} of {MAX_REFERENCES} image references will be sent with the next generation.</div>
            </section>

            {tab === "character" && <section className="asset-workspace">
              <div className="asset-workspace-head"><div className="asset-section-icon purple"><Users size={20} /></div><div><h3>Character sheet prompt</h3><p>Flow မှာပုံထုတ်ရန် 16:9 turnaround + expression sheet prompt ကိုပြင်ပြီး copy လုပ်ပါ။</p></div></div>
              <div className="asset-form-grid">
                <label className="asset-field"><span>Character English name</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="e.g. LEO, LILI, MAY" /></label>
              </div>
              {!characterNameValid && <div className="asset-guidance"><AlertCircle size={16} /><p><strong>English name လိုအပ်ပါတယ်:</strong> Name label နဲ့ video prompts တွေမှာ အတိအကျပြန်သုံးရန် LEO, LILI, MAY လို English / Latin letters ဖြင့်သာရေးပါ။</p></div>}
              <label className="asset-field"><span>Character description</span><textarea rows={4} value={characterDescription} onChange={(event) => setCharacterDescription(event.target.value)} placeholder="Describe face, hairstyle, age, body build, complete outfit, colors, shoes, accessories and details that must stay consistent." /></label>
              <div className="asset-guidance"><CheckCircle2 size={16} /><p><strong>Fixed sheet layout:</strong> front, 3/4, side and back turnaround views plus happy, surprised, thoughtful and neutral expressions. Flow မှာ reference ပုံထည့်ထားလျှင် identity နှင့် wardrobe ကိုမပြောင်းဘဲ ထုတ်ခိုင်းထားပါတယ်။</p></div>
              <label className="asset-field"><span>Google Flow character-sheet prompt</span><textarea rows={14} readOnly value={characterSheetPrompt} /></label>
              <div className="asset-action-row"><div><span className="asset-cost-label">GOOGLE FLOW · MANUAL STEP</span><small>ဒီ app က prompt ပဲပြင်ပေးပါတယ်။ Flow မှာ prompt paste လုပ်ပြီး reference ပုံရှိလျှင် ကိုယ်တိုင်တွဲပါ။</small></div><button className="asset-primary-button" onClick={() => void copyText(characterSheetPrompt, "Character sheet prompt")} disabled={!characterNameValid}><Copy size={16} /> {copied === "Character sheet prompt" ? "Copied" : "Copy Flow prompt"}</button></div>
            </section>}

            {tab === "background" && <section className="asset-workspace">
              <div className="asset-workspace-head"><div className="asset-section-icon teal"><MapPin size={20} /></div><div><h3>Background Studio</h3><p>Create reusable environment plates separately from characters, so one location can be reused across scenes.</p></div></div>
              <div className="asset-form-grid">
                <label className="asset-field"><span>Location / set name</span><input value={backgroundName} onChange={(event) => setBackgroundName(event.target.value)} placeholder="e.g. Home typing desk" /></label>
                <label className="asset-field"><span>Lighting / time</span><select value={backgroundTime} onChange={(event) => setBackgroundTime(event.target.value)}><option>Soft daylight from a nearby window</option><option>Warm morning sunlight</option><option>Bright neutral studio lighting</option><option>Golden hour, late afternoon</option><option>Quiet evening with practical lamps</option><option>Blue-hour cinematic lighting</option></select></label>
              </div>
              <label className="asset-field"><span>Environment details</span><textarea rows={4} value={backgroundDescription} onChange={(event) => setBackgroundDescription(event.target.value)} placeholder="Describe the room, props, architecture, colors, surface materials, depth and mood..." /></label>
              <div className="asset-guidance"><CheckCircle2 size={16} /><p><strong>Clean plate:</strong> backgrounds are generated without people, readable text, logos, or fake website UI. Reuse an approved background as a reference to create matching lighting or camera-angle variants.</p></div>
              <div className="asset-action-row"><div><span className="asset-cost-label">IMAGE GENERATION</span><small>Output follows the project's {aspectRatio} aspect ratio.</small></div><button className="asset-primary-button" onClick={() => void generateBackground()} disabled={isBusy}><Wand2 size={16} /> {busyId === "background" ? "Generating background..." : "Generate background"}</button></div>
            </section>}

            {tab === "scene" && <section className="asset-workspace">
              <div className="asset-workspace-head"><div className="asset-section-icon blue"><ImagePlus size={20} /></div><div><h3>Scene Image Generator</h3><p>Generate one standalone image for every storyboard scene. Each result is saved as an individual image file, not as one combined sheet.</p></div></div>
              {!storyboard ? <div className="asset-empty-scenes"><Images size={29} /><strong>Build a storyboard first</strong><span>Return to the main studio and create the scene list, then generate its images here.</span></div> : <>
                <div className="asset-batch-summary"><div><strong>{allScenes.length} storyboard scenes</strong><span>{assets.filter((asset) => asset.kind === "scene").length} saved scene images · {missingScenes.length} scenes without an image</span></div><div className="asset-batch-actions"><button className="asset-secondary-button" onClick={() => void runSceneQueue(selectedSceneIds)} disabled={isBusy || !allScenes.some((scene) => selectedSceneIds.includes(scene.id) && !scene.locked)}>Generate selected</button><button className="asset-secondary-button" onClick={() => void runSceneQueue(missingScenes.map((scene) => scene.id))} disabled={isBusy || missingScenes.length === 0}><ImagePlus size={14} /> Generate missing</button><button className="asset-primary-button" onClick={() => void runSceneQueue(allScenes.map((scene) => scene.id))} disabled={isBusy || allScenes.length === 0}><Wand2 size={14} /> Generate all scene images</button></div></div>
                {(jobState === "running" || jobState === "paused") && <div className="asset-progress-panel"><div className="asset-progress-top"><strong>{jobState === "paused" ? "Batch paused" : "Generating images"} · {jobProgress.complete}/{jobProgress.total}</strong><span>{jobProgress.failed} failed</span></div><div className="asset-progress-track"><span style={{ width: (jobProgress.total ? (jobProgress.complete / jobProgress.total) * 100 : 0) + "%" }} /></div><div className="asset-progress-bottom"><small>{jobProgress.current || "Preparing queue..."}</small><div><button onClick={pauseResume}>{jobState === "paused" ? <Play size={13} /> : <Pause size={13} />} {jobState === "paused" ? "Resume" : "Pause"}</button><button onClick={cancelBatch}><X size={13} /> Stop after current</button></div></div></div>}
                {jobState === "done" && <div className="asset-batch-finished"><CheckCircle2 size={15} /> Last batch finished. Generate again to create new variations for these scenes.</div>}
                {jobState === "cancelled" && <div className="asset-batch-finished muted"><AlertCircle size={15} /> Batch stopped. Already-generated images remain saved in the library.</div>}
                <div className="asset-scene-list">{allScenes.map((scene) => {
                  const sceneAssets = assets.filter((asset) => asset.kind === "scene" && asset.sceneId === scene.id && asset.projectId === projectId);
                  return <article className="asset-scene-row" key={scene.id}>
                    <input type="checkbox" aria-label={"Select scene image " + scene.sceneNumber} checked={selectedSceneIds.includes(scene.id)} disabled={isBusy || scene.locked} onChange={(event) => setSelectedSceneIds((ids) => event.target.checked ? [...ids, scene.id] : ids.filter((id) => id !== scene.id))} /><div className="asset-scene-number">{String(scene.sceneNumber).padStart(2, "0")}</div>
                    <div className="asset-scene-text"><strong>{scene.title}</strong><span>{scene.objective || scene.visualDescription}</span>{sceneAssets[0] && <small><CheckCircle2 size={12} /> {sceneAssets.length} image version(s) saved</small>}</div>
                    {sceneAssets[0] && <img className="asset-scene-preview" src={"data:" + sceneAssets[0].mimeType + ";base64," + sceneAssets[0].data} alt={sceneAssets[0].title} />}
                    <button className="asset-icon-button compact" onClick={() => void runSceneQueue([scene.id])} disabled={isBusy || scene.locked} title={scene.locked ? "Unlock this scene to generate a new image" : "Generate or regenerate this scene image"}><RotateCcw size={15} /></button>
                  </article>;
                })}</div>
              </>}
            </section>}

            <section className="asset-library-panel">
              <div className="asset-library-heading"><div><h3>{tab === "scene" ? "All saved assets" : tab === "character" ? "Character library" : "Background library"}</h3><p>Images are stored in this browser's IndexedDB. Selected character and location assets can guide later scene generations.</p></div><span>{visibleAssets.length} ASSETS</span></div>
              {!visibleAssets.length ? <div className="asset-library-empty"><Images size={22} /><span>No generated assets here yet.</span></div> : <div className="asset-library-grid">{visibleAssets.map((asset) => <article className="asset-card" key={asset.id}>
                <div className="asset-card-image"><img src={"data:" + asset.mimeType + ";base64," + asset.data} alt={asset.title} loading="lazy" /><span className={"asset-kind-badge " + asset.kind}>{asset.kind === "scene" ? "SCENE " + (storyboard?.scenes.find((scene) => scene.id === asset.sceneId)?.sceneNumber ?? asset.sceneNumber ?? "Legacy") : asset.kind.toUpperCase()}</span></div>
                <div className="asset-card-body"><strong title={asset.title}>{asset.title}</strong><small>{new Date(asset.createdAt).toLocaleString()}</small>
                  <div className="asset-card-actions"><button onClick={() => downloadAsset(asset)} title="Download image"><ArrowDownToLine size={14} /></button><button onClick={() => void copyText(asset.prompt, asset.title)} title="Copy image prompt">{copied === asset.title ? <Check size={14} /> : <Copy size={14} />}</button>{asset.kind !== "scene" && <button className={asset.projectId === projectId && asset.useAsReference ? "reference-selected" : ""} disabled={isBusy} onClick={() => void toggleReference(asset)} title={asset.projectId === projectId && asset.useAsReference ? "Remove from project reference set" : "Add a reusable copy to this project"}><CheckCircle2 size={14} /></button>}<button className="delete" onClick={() => void deleteImage(asset)} disabled={isBusy} title="Delete image"><Trash2 size={14} /></button></div>
                  {asset.kind !== "scene" && <label className="asset-use-reference"><input type="checkbox" checked={asset.projectId === projectId && asset.useAsReference} disabled={isBusy} onChange={() => void toggleReference(asset)} /> Use for consistency</label>}
                  <details className="asset-prompt-versions">
                    <summary>မြန်မာ / English prompt ကြည့်ရန်</summary>
                    <label className="asset-field"><span>မြန်မာ Prompt</span><textarea rows={5} readOnly value={asset.promptMy || asset.prompt} /></label>
                    <label className="asset-field"><span>English Prompt</span><textarea rows={5} readOnly value={asset.promptEn || asset.prompt} /></label>
                  </details>
                </div>
              </article>)}</div>}
            </section>
            <p className="asset-footer-note"><AlertCircle size={13} /> Image generation may incur API charges. Generated images stay in this browser until downloaded or until site data is cleared. Google processes image inputs to provide this service. Review model availability and usage terms in Google AI Studio.</p>
          </main>
        </div>
      </section>
    </div>
  );
}
