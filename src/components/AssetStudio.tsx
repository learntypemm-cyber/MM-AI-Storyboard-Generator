import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, CheckCircle2, Copy, ImagePlus, MapPin, Pause, Play, RotateCcw, Trash2, Upload, Users, Wand2, X, Images } from "lucide-react";
import type { ReferenceImage, Scene, Storyboard, VideoForm, VisualStyle } from "../types";
import "./AssetStudio.css";

type AssetKind = "character" | "background" | "scene";
type StudioTab = "character" | "background" | "scene";
type JobState = "idle" | "running" | "paused" | "done" | "cancelled";
type ImageAsset = {
  id: string; kind: AssetKind; title: string; prompt: string; mimeType: string; data: string;
  createdAt: string; sceneNumber?: number; useAsReference: boolean;
};
type Props = {
  open: boolean; onClose: () => void; apiKey: string; projectTitle: string; topic: string;
  visualStyle: VisualStyle; aspectRatio: VideoForm["aspectRatio"];
  projectReferences: ReferenceImage[]; storyboard: Storyboard | null;
};
const DB_NAME = "mm-storyboard-asset-library";
const STORE_NAME = "assets";
const IMAGE_MODEL = "gemini-nano-banana-2.1";
const MAX_REFERENCES = 4;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("This browser does not support local image storage. Try recent Chrome or Edge.")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the asset library."));
  });
}
async function readAssets(): Promise<ImageAsset[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as ImageAsset[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      request.onerror = () => reject(request.error || new Error("Could not read saved images."));
    });
  } finally { db.close(); }
}
async function putAsset(asset: ImageAsset): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(asset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save the generated image."));
      tx.onabort = () => reject(tx.error || new Error("Saving the generated image was cancelled."));
    });
  } finally { db.close(); }
}
async function removeAsset(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete the saved image."));
      tx.onabort = () => reject(tx.error || new Error("Deleting the saved image was cancelled."));
    });
  } finally { db.close(); }
}
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
type ApiImage = { type?: string; data?: string; mime_type?: string; mimeType?: string };
type ApiResponse = {
  error?: { message?: string; status?: string };
  output_image?: ApiImage; outputImage?: ApiImage;
  interaction?: { output_image?: ApiImage; outputImage?: ApiImage };
  steps?: Array<{ type?: string; content?: ApiImage[]; output?: ApiImage[] }>;
  output?: ApiImage[];
};
function findOutputImage(payload: ApiResponse): ApiImage | undefined {
  const direct = payload.output_image || payload.outputImage || payload.interaction?.output_image || payload.interaction?.outputImage;
  if (direct?.data) return direct;
  for (const step of payload.steps || []) {
    for (const item of [...(step.content || []), ...(step.output || [])]) {
      if (item.data && (!item.type || item.type === "image")) return item;
    }
  }
  return (payload.output || []).find((item) => item.data && (!item.type || item.type === "image"));
}
async function generateImage(apiKey: string, prompt: string, aspectRatio: VideoForm["aspectRatio"], references: ReferenceImage[]): Promise<{ data: string; mimeType: string }> {
  if (!apiKey.trim()) throw new Error("Add your Gemini API key in Settings first, then reopen Asset Studio.");
  const input: Array<Record<string, string>> = [{ type: "text", text: prompt }];
  references.slice(0, MAX_REFERENCES).forEach((image) => {
    if (image.data && image.mimeType.startsWith("image/")) input.push({ type: "image", mime_type: image.mimeType, data: image.data });
  });
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
    body: JSON.stringify({
      model: IMAGE_MODEL, input,
      response_format: { type: "image", mime_type: "image/png", aspect_ratio: aspectRatio, image_size: "1K" }
    })
  });
  const payload = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok) {
    const message = payload.error?.message || ("Gemini image generation failed (" + response.status + ").");
    if (response.status === 401 || response.status === 403) throw new Error(message + " Check your Gemini API key and image-model access in Google AI Studio.");
    if (response.status === 404) throw new Error(message + " This image model may not be available to this key or region.");
    throw new Error(message);
  }
  const image = findOutputImage(payload);
  if (!image?.data) throw new Error("Gemini returned no image. Try a shorter prompt or a simpler reference image.");
  return { data: image.data, mimeType: image.mime_type || image.mimeType || "image/png" };
}
function assetAsReference(asset: ImageAsset): ReferenceImage {
  return { name: asset.title, mimeType: asset.mimeType, data: asset.data, previewUrl: "data:" + asset.mimeType + ";base64," + asset.data };
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
function CharacterPrompt(title: string, description: string, style: VisualStyle, format: string): string {
  const formatInstruction = format === "Turnaround sheet"
    ? "Create one professional character turnaround reference SHEET with full-body front, three-quarter, side-profile, and back views of the exact same character. Keep face, hair, clothing, height, proportions, and accessories identical. Plain neutral background, even spacing, no labels or text."
    : format === "Expression sheet"
      ? "Create one clean character expression reference SHEET with six head-and-shoulders expressions of the exact same character. Keep face, hair, skin tone, age, outfit collar, and proportions identical. Clearly separate each expression. No labels or text."
      : "Create one polished full-body character reference portrait, centered against a clean neutral background. Show face, hairstyle, outfit, shoes, and defining accessories clearly.";
  return [
    "Create a production-ready character reference image for a recurring educational video series.",
    "CHARACTER NAME: " + (title.trim() || "Main character"),
    "USER DESCRIPTION OR REQUESTED IMPROVEMENT: " + (description.trim() || "Create a friendly, approachable, memorable character suitable for a Myanmar typing tutorial."),
    "VISUAL STYLE: " + style + ". Use clear silhouette, believable anatomy, clean detail, polished lighting and readable facial features.",
    formatInstruction,
    "IF REFERENCE IMAGES ARE PROVIDED: treat the supplied character image as the identity source of truth. Preserve identity, facial structure, age, skin tone, hair, body proportions, distinctive features, clothing and accessories unless the request explicitly asks for a change. Improve clarity, composition, lighting and finish only; do not redesign the character.",
    "Keep the character easy to recognize in future scenes. No watermarks, duplicate characters, extra limbs, extra fingers, unrelated props or readable text. This is a reusable visual reference asset, not a storyboard collage."
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
  const { open, onClose, apiKey, projectTitle, topic, visualStyle, aspectRatio, projectReferences, storyboard } = props;
  const [tab, setTab] = useState<StudioTab>("character");
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [refs, setRefs] = useState<ReferenceImage[]>([]);
  const [useProjectReferences, setUseProjectReferences] = useState(false);
  const [characterName, setCharacterName] = useState("Main character");
  const [characterDescription, setCharacterDescription] = useState("");
  const [characterFormat, setCharacterFormat] = useState("Full-body reference");
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
    readAssets().then((items) => { if (live) setAssets(items); })
      .catch((caught: unknown) => { if (live) setStorageError(caught instanceof Error ? caught.message : "The asset library could not be loaded."); });
    return () => { live = false; };
  }, [open]);

  const selectedAssets = useMemo(() => assets.filter((asset) => asset.useAsReference && asset.kind !== "scene"), [assets]);
  const sceneImageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    assets.forEach((asset) => { if (asset.kind === "scene" && asset.sceneNumber) counts.set(asset.sceneNumber, (counts.get(asset.sceneNumber) || 0) + 1); });
    return counts;
  }, [assets]);
  const visibleAssets = useMemo(() => assets.filter((asset) => tab === "scene" ? true : asset.kind === tab), [assets, tab]);

  function inputReferences(): ReferenceImage[] {
    const chosen: ReferenceImage[] = [];
    if (useProjectReferences) chosen.push(...projectReferences);
    chosen.push(...refs);
    selectedAssets.forEach((asset) => chosen.push(assetAsReference(asset)));
    const unique = chosen.filter((image, index, list) => image.data && list.findIndex((other) => other.name === image.name && other.data === image.data) === index);
    return unique.slice(0, MAX_REFERENCES);
  }
  async function saveGenerated(kind: AssetKind, title: string, prompt: string, image: { data: string; mimeType: string }, sceneNumber?: number): Promise<ImageAsset> {
    const asset: ImageAsset = {
      id: makeId(), kind, title: title.trim() || (kind === "scene" ? "Scene " + sceneNumber : kind === "character" ? "Character reference" : "Background"),
      prompt, mimeType: image.mimeType, data: image.data, createdAt: new Date().toISOString(), sceneNumber, useAsReference: kind !== "scene"
    };
    await putAsset(asset);
    setAssets((current) => [asset, ...current]);
    setNotice("Saved " + asset.title + " to your local Asset Library.");
    return asset;
  }
  async function generateCharacter(): Promise<void> {
    setError(""); setNotice("");
    if (!apiKey.trim()) { setError("Add your Gemini API key in Settings first, then reopen Asset Studio."); return; }
    const prompt = CharacterPrompt(characterName, characterDescription, visualStyle, characterFormat);
    setBusyId("character");
    try { await saveGenerated("character", characterName || "Character reference", prompt, await generateImage(apiKey, prompt, "1:1", inputReferences())); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not generate this character image."); }
    finally { setBusyId(""); }
  }
  async function generateBackground(): Promise<void> {
    setError(""); setNotice("");
    if (!apiKey.trim()) { setError("Add your Gemini API key in Settings first, then reopen Asset Studio."); return; }
    const prompt = BackgroundPrompt(backgroundName, backgroundDescription, backgroundTime, visualStyle, aspectRatio);
    setBusyId("background");
    try { await saveGenerated("background", backgroundName || "Background", prompt, await generateImage(apiKey, prompt, aspectRatio, inputReferences())); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not generate this background image."); }
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
    const queue = storyboard.scenes.filter((scene) => sceneIds.includes(scene.id));
    if (!queue.length) { setError("Choose at least one scene."); return; }
    controls.current = { paused: false, cancelled: false };
    setError(""); setNotice(""); setJobState("running");
    setJobProgress({ total: queue.length, complete: 0, failed: 0, current: "" }); setBusyId("");
    const references = inputReferences();
    let completed = 0;
    let failed = 0;
    for (const scene of queue) {
      while (controls.current.paused && !controls.current.cancelled) await wait(180);
      if (controls.current.cancelled) break;
      setJobProgress((current) => ({ ...current, current: "Scene " + scene.sceneNumber + ": " + scene.title }));
      const prompt = SceneImagePrompt(scene, storyboard, projectTitle, visualStyle, aspectRatio, topic);
      try {
        const image = await generateImage(apiKey, prompt, aspectRatio, references);
        await saveGenerated("scene", "Scene " + scene.sceneNumber + " - " + scene.title, prompt, image, scene.sceneNumber);
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
  function toggleReference(asset: ImageAsset): void {
    const updated = { ...asset, useAsReference: !asset.useAsReference };
    setAssets((current) => current.map((item) => item.id === asset.id ? updated : item));
    void putAsset(updated).catch((caught: unknown) => setStorageError(caught instanceof Error ? caught.message : "Could not update reference selection."));
  }
  async function deleteImage(asset: ImageAsset): Promise<void> {
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
      (asset.sceneNumber ? "\nSCENE: " + asset.sceneNumber : "") + "\nPROMPT:\n" + asset.prompt
    ).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([promptLines], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "mm-storyboard-asset-prompts.txt"; link.click(); URL.revokeObjectURL(url);
  }
  if (!open) return null;

  const refsCount = inputReferences().length;
  const allScenes = storyboard?.scenes || [];
  const missingScenes = allScenes.filter((scene) => !(sceneImageCounts.get(scene.sceneNumber) || 0));

  return (
    <div className="asset-studio-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isBusy) onClose(); }}>
      <section className="asset-studio" role="dialog" aria-modal="true" aria-labelledby="asset-studio-title">
        <header className="asset-studio-header">
          <div className="asset-studio-brand"><div className="asset-studio-mark"><Images size={20} /></div><div><h2 id="asset-studio-title">AI Asset Studio</h2><p>Characters · Backgrounds · Scene-by-scene images</p></div></div>
          <div className="asset-studio-header-right"><span className={apiKey ? "asset-api-status good" : "asset-api-status"}>{apiKey ? "Gemini image API ready" : "API key required"}</span><button className="asset-icon-button" onClick={onClose} aria-label="Close Asset Studio"><X size={19} /></button></div>
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
              <div className="asset-workspace-head"><div className="asset-section-icon purple"><Users size={20} /></div><div><h3>Character Studio</h3><p>Use your own character as the source of truth, or create a new recurring character from a description.</p></div></div>
              <div className="asset-form-grid">
                <label className="asset-field"><span>Character name</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="e.g. May, the typing tutor" /></label>
                <label className="asset-field"><span>Reference image format</span><select value={characterFormat} onChange={(event) => setCharacterFormat(event.target.value)}><option>Full-body reference</option><option>Turnaround sheet</option><option>Expression sheet</option></select></label>
              </div>
              <label className="asset-field"><span>Character description or improvement request</span><textarea rows={4} value={characterDescription} onChange={(event) => setCharacterDescription(event.target.value)} placeholder="Describe the character or ask to improve lighting, clarity, clothing detail, proportions, or style. If using your own character, say what must stay unchanged." /></label>
              <div className="asset-guidance"><CheckCircle2 size={16} /><p><strong>Identity protection:</strong> when a character image is attached, the prompt tells the model to preserve the original face, hair, skin tone, age, body proportions, wardrobe and distinct features while refining quality and lighting.</p></div>
              <div className="asset-action-row"><div><span className="asset-cost-label">IMAGE GENERATION</span><small>Uses your Gemini API key; Google API usage charges may apply.</small></div><button className="asset-primary-button" onClick={() => void generateCharacter()} disabled={isBusy}><Wand2 size={16} /> {busyId === "character" ? "Generating character..." : "Generate / improve character"}</button></div>
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
                <div className="asset-batch-summary"><div><strong>{allScenes.length} storyboard scenes</strong><span>{assets.filter((asset) => asset.kind === "scene").length} saved scene images · {missingScenes.length} scenes without an image</span></div><div className="asset-batch-actions"><button className="asset-secondary-button" onClick={() => void runSceneQueue(missingScenes.map((scene) => scene.id))} disabled={isBusy || missingScenes.length === 0}><ImagePlus size={14} /> Generate missing</button><button className="asset-primary-button" onClick={() => void runSceneQueue(allScenes.map((scene) => scene.id))} disabled={isBusy || allScenes.length === 0}><Wand2 size={14} /> Generate all scene images</button></div></div>
                {(jobState === "running" || jobState === "paused") && <div className="asset-progress-panel"><div className="asset-progress-top"><strong>{jobState === "paused" ? "Batch paused" : "Generating images"} · {jobProgress.complete}/{jobProgress.total}</strong><span>{jobProgress.failed} failed</span></div><div className="asset-progress-track"><span style={{ width: (jobProgress.total ? (jobProgress.complete / jobProgress.total) * 100 : 0) + "%" }} /></div><div className="asset-progress-bottom"><small>{jobProgress.current || "Preparing queue..."}</small><div><button onClick={pauseResume}>{jobState === "paused" ? <Play size={13} /> : <Pause size={13} />} {jobState === "paused" ? "Resume" : "Pause"}</button><button onClick={cancelBatch}><X size={13} /> Stop after current</button></div></div></div>}
                {jobState === "done" && <div className="asset-batch-finished"><CheckCircle2 size={15} /> Last batch finished. Generate again to create new variations for these scenes.</div>}
                {jobState === "cancelled" && <div className="asset-batch-finished muted"><AlertCircle size={15} /> Batch stopped. Already-generated images remain saved in the library.</div>}
                <div className="asset-scene-list">{allScenes.map((scene) => {
                  const sceneAssets = assets.filter((asset) => asset.kind === "scene" && asset.sceneNumber === scene.sceneNumber);
                  return <article className="asset-scene-row" key={scene.id}>
                    <div className="asset-scene-number">{String(scene.sceneNumber).padStart(2, "0")}</div>
                    <div className="asset-scene-text"><strong>{scene.title}</strong><span>{scene.objective || scene.visualDescription}</span>{sceneAssets[0] && <small><CheckCircle2 size={12} /> {sceneAssets.length} image version(s) saved</small>}</div>
                    {sceneAssets[0] && <img className="asset-scene-preview" src={"data:" + sceneAssets[0].mimeType + ";base64," + sceneAssets[0].data} alt={sceneAssets[0].title} />}
                    <button className="asset-icon-button compact" onClick={() => void runSceneQueue([scene.id])} disabled={isBusy} title="Generate or regenerate this scene image"><RotateCcw size={15} /></button>
                  </article>;
                })}</div>
              </>}
            </section>}

            <section className="asset-library-panel">
              <div className="asset-library-heading"><div><h3>{tab === "scene" ? "All saved assets" : tab === "character" ? "Character library" : "Background library"}</h3><p>Images are stored in this browser's IndexedDB. Selected character and location assets can guide later scene generations.</p></div><span>{visibleAssets.length} ASSETS</span></div>
              {!visibleAssets.length ? <div className="asset-library-empty"><Images size={22} /><span>No generated assets here yet.</span></div> : <div className="asset-library-grid">{visibleAssets.map((asset) => <article className="asset-card" key={asset.id}>
                <div className="asset-card-image"><img src={"data:" + asset.mimeType + ";base64," + asset.data} alt={asset.title} loading="lazy" /><span className={"asset-kind-badge " + asset.kind}>{asset.kind === "scene" ? "SCENE " + (asset.sceneNumber || "") : asset.kind.toUpperCase()}</span></div>
                <div className="asset-card-body"><strong title={asset.title}>{asset.title}</strong><small>{new Date(asset.createdAt).toLocaleString()}</small>
                  <div className="asset-card-actions"><button onClick={() => downloadAsset(asset)} title="Download image"><ArrowDownToLine size={14} /></button><button onClick={() => void copyText(asset.prompt, asset.title)} title="Copy image prompt">{copied === asset.title ? <Check size={14} /> : <Copy size={14} />}</button>{asset.kind !== "scene" && <button className={asset.useAsReference ? "reference-selected" : ""} onClick={() => toggleReference(asset)} title={asset.useAsReference ? "Remove from reference set" : "Use as future reference"}><CheckCircle2 size={14} /></button>}<button className="delete" onClick={() => void deleteImage(asset)} title="Delete image"><Trash2 size={14} /></button></div>
                  {asset.kind !== "scene" && <label className="asset-use-reference"><input type="checkbox" checked={asset.useAsReference} onChange={() => toggleReference(asset)} /> Use for consistency</label>}
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
