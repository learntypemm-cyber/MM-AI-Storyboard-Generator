import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clapperboard, Copy, Download, FileText, Film, FolderOpen, KeyRound,
  LayoutDashboard, Lightbulb, MonitorPlay, Plus, RefreshCw, Save, Settings,
  Sparkles, Trash2, Upload, Volume2, Wand2, X, Zap, Clock3, ArrowUp, ArrowDown, Lock, Unlock, History,
} from "lucide-react";
import type { GeminiModelOption } from "./lib/gemini";
import { generateJson, listGeminiModels, testGeminiModel } from "./lib/gemini";
import { assetAsReference, assetHandle, promptWithReferences, readAssets, sceneReferences, writeAssets } from "./lib/assetStore";
import { loadReferences, saveReferences } from "./lib/projectMedia";
import { checkpoint, patchScene, reorderScene, sceneRepairPatch } from "./lib/boardEditing";
import { createArchive, readArchive, presetSchema } from "./lib/projectArchive";
import ComfyUIStudio from "./components/ComfyUIStudio";
import AssetStudio from "./components/AssetStudio";
import { buildContactSheetPrompt } from "./lib/flowProduction";
import { auditScene, auditStoryboard } from "./lib/audit";
import { downloadText, fileSlug, flowPromptPack, storyboardMarkdown } from "./lib/export";
import type {
  BoardVersion, ImageAsset, ProductionPreset, FlowModel, GenerationMode, Language, Platform, ReferenceImage, SavedProject,
  Scene, Storyboard, VideoConcept, VideoForm, VisualStyle,
} from "./types";

const STORAGE = {
  key: "mm-storyboard-gemini-key", model: "mm-storyboard-gemini-model",
  saved: "mm-storyboard-saved-projects", current: "mm-storyboard-current",
};
const DEFAULT_FORM: VideoForm = {
  topic: "",
  goal: "Turn the topic into a clear, engaging short video",
  platform: "Facebook Reels", targetDuration: 30, language: "Burmese",
  audience: "Myanmar-speaking viewers", visualStyle: "Cinematic live action",
  aspectRatio: "9:16", flowModel: "Veo 3.1 Fast", generationMode: "Text to Video",
  clipDuration: 8,
  audioPolicy: "Natural Burmese voiceover, subtle upbeat background music, scene-appropriate sound effects",
  textPolicy: "No readable text generated inside AI video. Add Burmese captions and exact website UI in the video editor.",
  referenceNotes: "",
  referenceImages: [],
};
const GEMINI_DEFAULT = "gemini-3.8-flash";
const FLOW_MODELS: FlowModel[] = ["Veo 3.1 Fast", "Veo 3.1 Lite", "Veo 3.1 Quality", "Gemini Omni Flash 1.1"];
const MODES: GenerationMode[] = ["Text to Video", "First Frame", "First and Last Frame", "References to Video", "Video Edit", "Extend"];
const STYLES: VisualStyle[] = ["Realistic tutorial", "Cinematic live action", "3D animation", "2D motion graphics", "Presenter-led", "Fast-paced social video"];
const PLATFORMS: Platform[] = ["TikTok", "Facebook Reels", "YouTube Shorts", "YouTube"];
const LANGUAGES: Language[] = ["Burmese", "English", "Burmese + English"];

const makeId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
const stripImages = (form: VideoForm): SavedProject["form"] => {
  const { referenceImages: _ignored, ...rest } = form;
  return rest;
};
function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

function flowCompatibility(form: VideoForm): string | null {
  if (form.aspectRatio === "1:1") return "Current Flow video output options list portrait and landscape ratios, not square. Switch to 9:16 or 16:9, or verify the active Flow UI.";
  const durationSupported = form.flowModel === "Gemini Omni Flash 1.1" ? [4, 6, 8, 10] : [4, 6, 8];
  if (!durationSupported.includes(form.clipDuration)) return form.flowModel + " is listed with " + durationSupported.join(", ") + " second clips in the current Flow guide. Pick a supported length or verify the active Flow UI.";
  if (form.generationMode === "References to Video" && form.flowModel === "Veo 3.1 Quality") return "References to Video is not listed as supported for Veo 3.1 Quality. Choose Veo 3.1 Fast/Lite or Gemini Omni Flash, then verify the active Flow UI.";
  if (form.generationMode === "References to Video" && form.flowModel !== "Gemini Omni Flash 1.1" && form.clipDuration !== 8) return "Veo 3.1 reference/ingredients mode is listed as 8 seconds only. Select 8 seconds or use Gemini Omni Flash.";
  if (form.generationMode === "Video Edit" && form.flowModel !== "Gemini Omni Flash 1.1") return "Video Edit is currently listed for Gemini Omni Flash. Verify support or change the selected model.";
  if (form.generationMode === "Extend" && form.flowModel !== "Veo 3.1 Lite") return "Extend is limited in the current model guide. Veo 3.1 Lite is the safest choice to try; confirm in Flow before generation.";
  return null;
}

function buildConceptPrompt(form: VideoForm): string {
  return [
    "You are a senior creative director who builds practical Google Flow / Veo video plans. Return valid JSON only.",
    "",
    "Create exactly 3 DIFFERENT video concepts for this brief:",
    "TOPIC: " + form.topic,
    "GOAL: " + form.goal,
    "PLATFORM: " + form.platform,
    "TOTAL TARGET RUNTIME: " + form.targetDuration + " seconds",
    "LANGUAGE: " + form.language,
    "AUDIENCE: " + form.audience,
    "VISUAL PREFERENCE: " + form.visualStyle,
    "ASPECT RATIO: " + form.aspectRatio,
    "GOOGLE FLOW MODEL: " + form.flowModel,
    "GENERATION MODE: " + form.generationMode,
    "CLIP LENGTH TARGET: " + form.clipDuration + " seconds",
    "AUDIO POLICY: " + form.audioPolicy,
    "TEXT POLICY: " + form.textPolicy,
    "REFERENCE NOTES: " + form.referenceNotes,
    "",
    "For a product or website tutorial, never invent website buttons, page layout, statistics, features, or navigation. Use provided reference images as evidence, not as a license to fabricate details. If images are provided, study them and recommend where real screen recordings should be inserted. Voiceover must be in the selected language. Put exact Burmese captions in a separate field for editing, never ask a video model to render complex Burmese text.",
    "The three concepts must have distinct creative approaches: (1) accurate, clean tutorial demonstration; (2) fast hook and social-first visual storytelling; (3) memorable cinematic or animated visual metaphor.",
    "For each concept include id (short unique slug), title, style, hook (first 1-3 seconds), summary, visualDirection, whyItWorks, storyArc (array of 4-6 short beats), and estimatedDuration (number of seconds near the target).",
    "Make each concept specific to this brief and practical to generate as short clips. Return JSON matching this shape:",
    '{"concepts":[{"id":"string","title":"string","style":"string","hook":"string","summary":"string","visualDirection":"string","whyItWorks":"string","storyArc":["string"],"estimatedDuration":30}]}'
  ].join("\n");
}

function buildStoryboardPrompt(form: VideoForm, concept: VideoConcept): string {
  return [
    "You are a storyboard director and Google Flow prompt engineer. Return valid JSON only. Create a production-ready storyboard from the selected concept.",
    "",
    "BRIEF",
    "Topic: " + form.topic, "Goal: " + form.goal, "Platform: " + form.platform,
    "Target finished runtime: " + form.targetDuration + " seconds", "Language: " + form.language,
    "Audience: " + form.audience, "Visual style: " + form.visualStyle,
    "Aspect ratio: " + form.aspectRatio, "Google Flow model: " + form.flowModel,
    "Generation mode: " + form.generationMode, "Desired per-clip length: " + form.clipDuration + " seconds",
    "Audio policy: " + form.audioPolicy, "Text policy: " + form.textPolicy,
    "Reference notes: " + form.referenceNotes, "",
    "SELECTED CONCEPT",
    "Title: " + concept.title, "Style: " + concept.style, "Hook: " + concept.hook,
    "Summary: " + concept.summary, "Visual direction: " + concept.visualDirection,
    "Story arc: " + concept.storyArc.join(" -> "), "",
    "REQUIREMENTS",
    "- Create a complete scene-by-scene plan for generating each clip separately in Google Flow. Target 4-8 scenes for short-form content, choosing the number that fits the target runtime. Each scene durationSeconds should match the desired clip length when practical; explain runtime difference in productionNotes. Never guarantee a model feature; tell the user to verify the active Flow UI.",
    "- Every scene prompt must stand alone: describe subject, action, environment, wardrobe/props, framing, camera motion, lighting, mood, audio, opening frame, and final frame. Never say 'same as before', 'as in previous scene', 'continuing from scene 1', or assume model memory.",
    "- Maintain continuity using a visualBible and continuityRules. Use canonical @PascalCase handles for recurring named people or locations, such as @Presenter or @TypingDesk. Avoid unnecessary characters.",
    "- Each flowPrompt starts with exactly one policy: 'NO TEXT IN THE IMAGE.' or 'INTENTIONAL TEXT IN THE IMAGE: [exact short text]'. For accurate product UI and Burmese captions, use 'NO TEXT IN THE IMAGE.' and add real screen recordings/subtitles in post.",
    "- Each flowPrompt is detailed copy-paste English, ideally 100-180 words. Include a complete opening frame and final frame, plus audio direction. No markdown fences.",
    "- Use physically possible camera movement. Avoid conflicting actions. Do not put labels, timestamps, hex colors, scene numbers, prompt annotations or technical UI text inside the visual prompt.",
    "- Don't ask the model to draw website UI unless the user supplied a relevant screenshot. For website tutorials, use authentic screen recordings for any actual click-through.",
    "- Voiceover must be in " + form.language + ". On-screen text is exact caption copy for editing, not for the video model. Use empty string if no caption is needed.",
    "- Negative prompts should prevent malformed hands, unstable keyboards, illegible text, layout drift, flicker, extra fingers, artificial logos, fake website UI, duplicate objects, and watermarks where relevant.",
    "- Avoid copyrighted characters, celebrity likenesses, and misleading claims. JSON only, no prose outside it.",
    "",
    "Return this JSON structure:",
    '{"projectTitle":"string","logline":"string","visualBible":"string","continuityRules":["string"],"globalNegativePrompt":"string","productionNotes":["string"],"scenes":[{"sceneNumber":1,"title":"string","durationSeconds":8,"objective":"string","visualDescription":"string","shotSize":"string","cameraMovement":"string","lighting":"string","mood":"string","action":"string","flowPrompt":"string","voiceover":"string","onscreenText":"string","audioNotes":"string","transition":"string","referenceAssets":["string"],"negativePrompt":"string","openingFrame":"string","finalFrame":"string","handoff":"CUT"}]}',
    "Total planned runtime should be as close as possible to " + form.targetDuration + " seconds. If the clip length prevents an exact match, explain the arithmetic in productionNotes. These are prompts for manual use in Flow, not direct video generation."
  ].join("\n");
}

function buildSceneRepairPrompt(form: VideoForm, concept: VideoConcept, scene: Scene, storyboard: Storyboard): string {
  return [
    'Return valid JSON only with one object under the key "scene". Improve the scene prompt to be self-contained, visually precise, practical for Google Flow, and consistent with the project.',
    "Topic: " + form.topic, "Visual bible: " + storyboard.visualBible,
    "Continuity rules: " + storyboard.continuityRules.join(" | "),
    "Selected concept: " + concept.title + " - " + concept.summary,
    "Target language: " + form.language, "Aspect ratio: " + form.aspectRatio,
    "Flow model/mode/clip length: " + form.flowModel + " / " + form.generationMode + " / " + form.clipDuration + "s",
    "Reference notes: " + form.referenceNotes,
    "Current scene JSON: " + JSON.stringify(scene),
    'Retain the same scene number and core story purpose, but fix ambiguity and generic actions. Create an English standalone flowPrompt starting exactly with "NO TEXT IN THE IMAGE." unless specific short intentional text is essential. Include full opening and final frames. Never refer to other scenes, never tell Flow to draw captions, and never invent website UI. Voiceover stays in ' + form.language + '.',
    'Return the full Scene fields: sceneNumber,title,durationSeconds,objective,visualDescription,shotSize,cameraMovement,lighting,mood,action,flowPrompt,voiceover,onscreenText,audioNotes,transition,referenceAssets,negativePrompt,openingFrame,finalFrame,handoff. Shape: {"scene":{...}}.'
  ].join("\n");
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function App() {
  const [projectId, setProjectId] = useState(() => readLocal<{ projectId?: string }>(STORAGE.current, {}).projectId || makeId());
  const [history, setHistory] = useState<BoardVersion[]>(() => readLocal<{ history?: BoardVersion[] }>(STORAGE.current, {}).history || []);
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [versionId, setVersionId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<ProductionPreset[]>(() => readLocal<ProductionPreset[]>("mm-storyboard-presets", []).filter((item) => presetSchema.safeParse(item).success));
  const [hydrated, setHydrated] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const lastEdit = useRef({ label: "", time: 0 });
  const [form, setForm] = useState<VideoForm>(DEFAULT_FORM);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE.key) ?? "");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem(STORAGE.model) ?? GEMINI_DEFAULT);
  const [modelDraft, setModelDraft] = useState(geminiModel);
  const [modelOptions, setModelOptions] = useState<GeminiModelOption[]>([]);
  const [modelListKey, setModelListKey] = useState("");
  const [modelListError, setModelListError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelRefresh, setModelRefresh] = useState(0);
  const [concepts, setConcepts] = useState<VideoConcept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState("");
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(() => readLocal(STORAGE.saved, []));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assetStudioOpen, setAssetStudioOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const onComfyBusy = useCallback((running: boolean) => setBusy((current) => running ? "comfy" : current === "comfy" ? null : current), []);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [step, setStep] = useState<"brief" | "concepts" | "storyboard">("brief");

  useEffect(() => {
    if (!settingsOpen) return;
    setModelDraft(geminiModel);
  }, [settingsOpen]);
  useEffect(() => {
    if (!settingsOpen) return;
    const controller = new AbortController();
    const key = apiKeyDraft.trim();
    setModelOptions([]); setModelListKey(""); setModelListError(""); setLoadingModels(Boolean(key));
    if (!key) return;
    const timer = window.setTimeout(() => {
      void listGeminiModels(key, controller.signal).then((options) => {
        if (controller.signal.aborted) return;
        setModelOptions(options); setModelListKey(key);
        setModelDraft((current) => options.some((item) => item.id === current) ? current : options.find((item) => /flash/i.test(item.id) && !/preview|exp/i.test(item.id))?.id || options[0].id);
      }).catch((caught) => {
        if (!controller.signal.aborted) setModelListError(caught instanceof Error ? caught.message : "Could not load models.");
      }).finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [settingsOpen, apiKeyDraft, modelRefresh]);
  const validModelSelection = Boolean(apiKeyDraft.trim() && modelListKey === apiKeyDraft.trim() && modelOptions.some((item) => item.id === modelDraft) && !loadingModels);

  const refreshAssets = () => { void readAssets().then(setAssets).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load assets.")); };
  useEffect(() => { refreshAssets(); window.addEventListener("assets-changed", refreshAssets); return () => window.removeEventListener("assets-changed", refreshAssets); }, []);
  useEffect(() => { try { localStorage.setItem("mm-storyboard-presets", JSON.stringify(presets)); } catch { setError("Could not save presets. Export a ZIP backup before closing."); } }, [presets]);
  const projectAssets = assets.filter((asset) => asset.projectId === projectId);
  const castAssets = projectAssets.filter((asset) => asset.kind !== "scene");
  const selectedConcept = concepts.find((concept) => concept.id === selectedConceptId);
  const compatibility = flowCompatibility(form);
  const allAudits = useMemo(() => auditStoryboard(storyboard, form), [storyboard, form]);
  const auditCount = useMemo(() => storyboard?.scenes.reduce((sum, scene) => sum + auditScene(scene).filter((item) => !item.ok).length, 0) ?? 0, [storyboard]);

  useEffect(() => { try { localStorage.setItem(STORAGE.saved, JSON.stringify(savedProjects)); } catch { setError("Browser storage is full. Export a ZIP backup to keep your work."); } }, [savedProjects]);

  useEffect(() => {
    const current = readLocal<{ form?: SavedProject["form"]; concepts?: VideoConcept[]; selectedConceptId?: string; storyboard?: Storyboard | null } | null>(STORAGE.current, null);
    if (current?.form) {
      setForm({ ...DEFAULT_FORM, ...current.form, referenceImages: [] });
      setConcepts(current.concepts ?? []);
      setSelectedConceptId(current.selectedConceptId ?? "");
      setStoryboard(current.storyboard ?? null);
      if (current.storyboard) setStep("storyboard");
      else if (current.concepts?.length) setStep("concepts");
    }
    loadReferences(projectId).then((references) => { setForm((current) => ({ ...current, referenceImages: references })); setMediaReady(true); })
      .catch(() => setError("Could not restore project reference images."))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const current = { projectId, history, form: stripImages(form), concepts, selectedConceptId, storyboard };
    try { localStorage.setItem(STORAGE.current, JSON.stringify(current)); } catch { setError("Autosave storage is full. Export a ZIP backup before closing."); }
  }, [form, concepts, selectedConceptId, storyboard, projectId, history, hydrated]);

  useEffect(() => {
    if (!hydrated || !mediaReady) return;
    void saveReferences(projectId, form.referenceImages).catch(() => setError("Could not save reference images. Export a ZIP backup."));
  }, [projectId, form.referenceImages, hydrated, mediaReady]);

  const updateForm = <K extends keyof VideoForm,>(key: K, value: VideoForm[K]) => {
    if (!hydrated || busy) return;
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const requireKey = () => {
    if (!apiKey.trim()) {
      setError("Add your Gemini API key in Settings before generating.");
      setApiKeyDraft("");
      setSettingsOpen(true);
      return false;
    }
    return true;
  };

  const generateConcepts = async (autoBuild = false) => {
    setError(""); setNotice("");
    if (storyboard?.scenes.some((scene) => scene.locked)) { setError("Unlock approved scenes before replacing the project concepts."); return; }
    remember("Before replacing concepts");
    if (!hydrated || busy) return;
    if (!form.topic.trim()) { setError("Enter a topic first."); return; }
    if (!requireKey()) return;
    setBusy("concepts");
    try {
      const result = await generateJson<{ concepts: VideoConcept[]; recommendedConceptIndex?: number }>(apiKey.trim(), geminiModel.trim() || GEMINI_DEFAULT, buildConceptPrompt(form) + (autoBuild ? "\nEvaluate all three concepts for topic relevance, a strong opening, visual clarity, achievable runtime and reference continuity. Include recommendedConceptIndex (0, 1 or 2) for the strongest concept." : ""), form.referenceImages);
      if (!Array.isArray(result.concepts) || result.concepts.length < 2) throw new Error("The response did not contain three video concepts. Try generating again.");
      const next = result.concepts.slice(0, 3).map((concept, index) => ({
        ...concept, id: concept.id || "concept-" + (index + 1), title: concept.title || "Concept " + (index + 1),
        storyArc: Array.isArray(concept.storyArc) ? concept.storyArc : [],
      }));
      setConcepts(next); setSelectedConceptId(next[0].id); setStoryboard(null); setStep("concepts");
      if (autoBuild) {
        const index = result.recommendedConceptIndex;
        if (!Number.isInteger(index) || index! < 0 || index! >= next.length) throw new Error("Concepts were saved, but AI did not return a valid recommendation. Choose a concept below to continue.");
        setNotice("AI selected: " + next[index!].title + ". Building the storyboard…");
        await generateStoryboard(next[index!], true);
      } else setNotice("Three concepts are ready. Choose one to build the full storyboard.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't generate concepts. Please try again."); }
    finally { setBusy(null); }
  };

  const generateStoryboard = async (concept: VideoConcept, fromConcepts = false) => {
    if (!hydrated || (busy && !fromConcepts)) return;
    if (storyboard?.scenes.some((scene) => scene.locked)) { setError("Unlock approved scenes before rebuilding the storyboard."); return; }
    if (!fromConcepts) remember("Before rebuilding storyboard");
    setError(""); setNotice("");
    if (!requireKey()) return;
    setBusy("storyboard"); setSelectedConceptId(concept.id);
    try {
      const result = await generateJson<Storyboard>(apiKey.trim(), geminiModel.trim() || GEMINI_DEFAULT, buildStoryboardPrompt(form, concept), form.referenceImages);
      if (!Array.isArray(result.scenes) || !result.scenes.length) throw new Error("The response didn't include scenes. Try again or shorten your brief.");
      const scenes: Scene[] = result.scenes.map((scene, index) => ({
        ...scene, id: makeId(), sceneNumber: Number(scene.sceneNumber) || index + 1,
        title: scene.title || "Scene " + (index + 1), durationSeconds: Number(scene.durationSeconds) || form.clipDuration,
        objective: scene.objective || "", visualDescription: scene.visualDescription || "",
        shotSize: scene.shotSize || "", cameraMovement: scene.cameraMovement || "",
        lighting: scene.lighting || "", mood: scene.mood || "", action: scene.action || "",
        flowPrompt: scene.flowPrompt || "", voiceover: scene.voiceover || "",
        onscreenText: scene.onscreenText || "", audioNotes: scene.audioNotes || form.audioPolicy,
        transition: scene.transition || "Cut", referenceAssets: Array.isArray(scene.referenceAssets) ? scene.referenceAssets : [],
        negativePrompt: scene.negativePrompt || "", openingFrame: scene.openingFrame || "",
        finalFrame: scene.finalFrame || "", handoff: scene.handoff === "CONTINUATION" ? "CONTINUATION" : "CUT",
      }));
      setStoryboard({
        ...result, scenes,
        continuityRules: Array.isArray(result.continuityRules) ? result.continuityRules : [],
        productionNotes: Array.isArray(result.productionNotes) ? result.productionNotes : [],
      });
      setStep("storyboard");
      setNotice("Storyboard created. Review the prompts and audit warnings before generating clips in Flow.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't build the storyboard. Please try again."); }
    finally { setBusy(null); }
  };

  const remember = (label: string, coalesce = false) => {
    if (!storyboard) return;
    if (coalesce && lastEdit.current.label === label && Date.now() - lastEdit.current.time < 15000) return;
    setHistory((items) => {
      const next = checkpoint(items, { ...storyboard, scenes: storyboard.scenes.map((scene) => ({ ...scene, assetIds: scene.assetIds ?? sceneReferences(scene, projectAssets).map((asset) => asset.id) })) }, label);
      next[0].concept = selectedConcept ? structuredClone(selectedConcept) : undefined;
      next[0].form = structuredClone(stripImages(form));
      return next;
    });
    lastEdit.current = { label, time: Date.now() };
  };
  const updateScene = (id: string, patch: Partial<Scene>) => {
    if (busy || !hydrated || storyboard?.scenes.find((scene) => scene.id === id)?.locked) return;
    remember("Before editing scene " + (storyboard?.scenes.find((scene) => scene.id === id)?.sceneNumber || ""), true);
    const original = storyboard?.scenes.find((scene) => scene.id === id);
    if (patch.locked && original) patch.assetIds = sceneReferences(original, projectAssets).map((asset) => asset.id);
    setStoryboard((current) => current ? patchScene(current, id, patch) : current);
  };
  const regenerateScenes = async (ids: string[]) => {
    if (!storyboard || !selectedConcept || busy || !requireKey()) return;
    const queue = storyboard.scenes.filter((scene) => ids.includes(scene.id) && !scene.locked);
    if (!queue.length) { setNotice("Select an unlocked scene first."); return; }
    remember("Before regenerating " + queue.length + " scene(s)");
    setBusy("scene-batch"); setError(""); let failed = 0;
    for (const scene of queue) {
      try {
        const linked = sceneReferences(scene, projectAssets);
        const refs = [...linked.map(assetAsReference), ...form.referenceImages];
        if (refs.length > 4) throw new Error("Choose at most four references for this scene.");
        const result = await generateJson<{ scene: Partial<Scene> }>(apiKey.trim(), geminiModel.trim() || GEMINI_DEFAULT,
          buildSceneRepairPrompt(form, selectedConcept, scene, storyboard) + "\nReference registry: " + linked.map((asset) => assetHandle(asset) + " = " + asset.title).join("; "), refs);
        if (!result.scene || typeof result.scene.flowPrompt !== "string" || !result.scene.flowPrompt.trim()) throw new Error("No updated scene prompt returned.");
        const content = sceneRepairPatch(result.scene);
        setStoryboard((current) => current ? patchScene(current, scene.id, { ...content, reviewStatus: "draft" }) : current);
      } catch (caught) { failed++; setError("Scene " + scene.sceneNumber + ": " + (caught instanceof Error ? caught.message : "Generation failed.")); }
    }
    setBusy(null); setNotice((queue.length - failed) + " scene(s) updated; " + failed + " failed. Locked scenes were preserved.");
  };
  const toggleLock = (scene: Scene) => {
    if (busy || !hydrated) return;
    remember(scene.locked ? "Before unlocking scene" : "Before locking scene");
    setStoryboard((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, locked: !item.locked, reviewStatus: item.locked && item.reviewStatus === "approved" ? "review" : item.reviewStatus, assetIds: item.assetIds ?? sceneReferences(item, projectAssets).map((asset) => asset.id) } : item) } : current);
  };
  const moveScene = (scene: Scene, direction: number) => {
    if (!storyboard || busy || !hydrated) return;
    remember("Before moving scene " + scene.sceneNumber);
    setStoryboard(reorderScene(storyboard, scene.id, direction));
  };
  const addScene = () => {
    if (!storyboard || busy || !hydrated) return;
    remember("Before adding a scene");
    const scene: Scene = { id: makeId(), sceneNumber: storyboard.scenes.length + 1, title: "New scene", durationSeconds: form.clipDuration, objective: "", visualDescription: "", shotSize: "", cameraMovement: "", lighting: "", mood: "", action: "", flowPrompt: "", voiceover: "", onscreenText: "", audioNotes: form.audioPolicy, transition: "Cut", referenceAssets: [], negativePrompt: storyboard.globalNegativePrompt, openingFrame: "", finalFrame: "", handoff: "CUT" };
    setStoryboard({ ...storyboard, scenes: [...storyboard.scenes, scene] });
  };
  const removeScene = (scene: Scene) => {
    if (!storyboard || scene.locked || busy) return;
    remember("Before deleting scene " + scene.sceneNumber);
    setStoryboard({ ...storyboard, scenes: storyboard.scenes.filter((item) => item.id !== scene.id).map((item, i) => ({ ...item, sceneNumber: i + 1 })) });
  };
  const restoreVersion = () => {
    const version = history.find((item) => item.id === versionId);
    if (!version || busy) return;
    if (storyboard?.scenes.some((scene) => scene.locked)) { setError("Unlock scenes before restoring an earlier storyboard."); return; }
    remember("Before restoring version"); setStoryboard(structuredClone(version.storyboard)); setSelectedSceneIds([]); setStep("storyboard");
    if (version.concept) { const concept = structuredClone(version.concept); setConcepts((items) => [concept, ...items.filter((item) => item.id !== concept.id)]); setSelectedConceptId(concept.id); }
    if (version.form) setForm((current) => ({ ...current, ...version.form })); setNotice("Version restored. The replaced storyboard is saved in history.");
  };
  const snapshotProject = (): SavedProject => ({ id: projectId, title: storyboard?.projectTitle || form.topic, savedAt: new Date().toISOString(), form: stripImages(form), concepts, selectedConceptId, storyboard, history });
  const savePreset = () => {
    if (!presetName.trim()) { setError("Enter a preset name first."); return; }
    const { topic: _topic, referenceImages: _refs, ...settings } = form;
    setPresets((items) => [{ id: makeId(), name: presetName.trim().slice(0, 100), settings }, ...items.filter((item) => item.name !== presetName.trim())].slice(0, 50)); setPresetName(""); setNotice("Preset saved. Topic and images are kept separate.");
  };
  const exportZip = async () => {
    if (busy || !hydrated) return;
    if (!mediaReady) { setError("Reference images could not be loaded. Reopen this project before creating a complete backup."); return; }
    setBusy("backup"); setError("");
    try {
      const allAssets = await readAssets();
      const linkedIds = new Set([storyboard, ...history.map((item) => item.storyboard)].flatMap((board) => board?.scenes.flatMap((scene) => scene.assetIds || []) || []));
      const blob = await createArchive({ format: "mm-storyboard", version: 1, project: snapshotProject(), references: form.referenceImages, assets: allAssets.filter((asset) => asset.projectId === projectId || linkedIds.has(asset.id)), presets });
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileSlug(form.topic) + "-backup.zip"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("ZIP backup downloaded with images, versions and presets.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Backup failed."); } finally { setBusy(null); }
  };
  const importZip = async (file?: File) => {
    if (!file || busy || !hydrated) return; setBusy("restore"); setError("");
    try {
      const archive = await readArchive(file);
      const newId = makeId();
      const assetIds = new Map(archive.assets.map((asset) => [asset.id, makeId()]));
      const remapBoard = (board: Storyboard | null): Storyboard | null => board ? { ...board, scenes: board.scenes.map((scene) => ({ ...scene, assetIds: scene.assetIds?.map((id) => assetIds.get(id)!) })) } : null;
      const project = { ...archive.project, id: newId, storyboard: remapBoard(archive.project.storyboard), history: archive.project.history?.map((version) => ({ ...version, storyboard: remapBoard(version.storyboard)! })) };
      await writeAssets(archive.assets.map((asset) => ({ ...asset, handle: assetHandle(asset), id: assetIds.get(asset.id)!, projectId: newId })));
      if (!await loadProject(project, archive.references)) return;
      setSavedProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      setPresets((items) => [...items, ...archive.presets.filter((preset) => !items.some((item) => item.name === preset.name)).map((preset) => ({ ...preset, id: makeId() }))].slice(0, 50));
      setNotice("ZIP restored as a new project. Existing projects are preserved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not restore backup."); } finally { setBusy(null); }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label); setNotice(label + " copied to clipboard.");
      window.setTimeout(() => setCopied(""), 1800);
    } catch { setError("Clipboard access was blocked. Select the text and copy it manually."); }
  };

  const saveProject = async () => {
    if (!form.topic.trim()) { setError("Add a topic before saving."); return; }
    if (!hydrated || !mediaReady) { setError("Reference images are not loaded yet. Please reopen this project before saving."); return; }
    try { await saveReferences(projectId, form.referenceImages); } catch { setError("Could not save reference images. Export a ZIP backup."); return; }
    const saved = snapshotProject();
    setSavedProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setNotice("Project saved with reference images, scene locks and version history in this browser.");
  };

  // Persist before switching so the single current-project slot never destroys a draft.
  const preserveCurrentProject = async () => {
    if (!form.topic.trim() && !concepts.length && !storyboard && !history.length && !form.referenceImages.length) return;
    if (!mediaReady) throw new Error("Reference images are not loaded. Reopen this project before switching.");
    await saveReferences(projectId, form.referenceImages);
    const saved = snapshotProject();
    const next = [saved, ...savedProjects.filter((item) => item.id !== saved.id)];
    // Write first: a quota error must leave the current editor intact.
    localStorage.setItem(STORAGE.saved, JSON.stringify(next));
    setSavedProjects(next);
  };

  const loadProject = async (project: SavedProject, references?: ReferenceImage[]) => {
    if ((busy && busy !== "restore") || !hydrated) return false;
    if (project.id === projectId && references === undefined) { setLibraryOpen(false); return true; }
    setHydrated(false); setError("");
    try {
      await preserveCurrentProject();
      const images = references ?? await loadReferences(project.id);
      if (references !== undefined) await saveReferences(project.id, references);
      lastEdit.current = { label: "", time: 0 };
      setProjectId(project.id); setHistory(project.history || []); setSelectedSceneIds([]); setVersionId("");
      setForm({ ...DEFAULT_FORM, ...project.form, referenceImages: images }); setMediaReady(true);
      setConcepts(project.concepts); setSelectedConceptId(project.selectedConceptId); setStoryboard(project.storyboard);
      setStep(project.storyboard ? "storyboard" : project.concepts.length ? "concepts" : "brief");
      setLibraryOpen(false); setNotice("Opened " + project.title + ". Your previous draft is saved in My projects.");
      return true;
    } catch (caught) {
      setError("Could not switch projects. Your current work is still open. " + (caught instanceof Error ? caught.message : "Check browser storage."));
      return false;
    } finally { setHydrated(true); }
  };

  const newProject = async () => {
    if (busy || !hydrated) return;
    setHydrated(false); setError("");
    try {
      await preserveCurrentProject();
      setMediaReady(true); lastEdit.current = { label: "", time: 0 };
      setProjectId(makeId()); setHistory([]); setSelectedSceneIds([]); setVersionId("");
      setForm(DEFAULT_FORM); setConcepts([]); setSelectedConceptId(""); setStoryboard(null);
      setStep("brief"); setNotice("Ready for a new topic. Your previous draft is saved in My projects."); setShowAdvanced(false);
    } catch (caught) {
      setError("Could not save your draft. Your current work is still open. " + (caught instanceof Error ? caught.message : "Export a ZIP backup."));
    } finally { setHydrated(true); }
  };

  const boardForExport = (): Storyboard => ({ ...storyboard!, scenes: storyboard!.scenes.map((scene) => ({ ...scene, flowPrompt: promptWithReferences(scene, projectAssets), referenceAssets: [...scene.referenceAssets, ...sceneReferences(scene, projectAssets).map((asset) => assetHandle(asset) + " = " + asset.title)] })) });
  const exportMarkdown = () => {
    if (!storyboard) { setError("Generate a storyboard before exporting."); return; }
    downloadText(fileSlug(storyboard.projectTitle) + ".md", storyboardMarkdown(form, selectedConcept, boardForExport()), "text/markdown;charset=utf-8");
    setNotice("Markdown storyboard downloaded.");
  };
  const exportPromptPack = () => {
    if (!storyboard) { setError("Generate a storyboard before exporting."); return; }
    const pack = flowPromptPack(form, selectedConcept, boardForExport());
    downloadText(fileSlug(storyboard.projectTitle || form.topic) + "-google-flow-prompts.txt", pack, "text/plain;charset=utf-8");
    setNotice("Google Flow prompt pack downloaded.");
  };

  const exportJson = () => {
    if (!storyboard) { setError("Generate a storyboard before exporting."); return; }
    downloadText(fileSlug(storyboard.projectTitle) + ".json", JSON.stringify({ form: stripImages(form), selectedConcept, storyboard: boardForExport() }, null, 2), "application/json;charset=utf-8");
    setNotice("Storyboard JSON downloaded.");
  };

  const onImageUpload = async (files: FileList | null) => {
    if (!files?.length || !hydrated) return;
    setError("");
    const available = Math.max(0, 4 - form.referenceImages.length);
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, available);
    if (!selected.length) { setError("Choose image files. Up to four images can be attached per generation."); return; }
    const converted = await Promise.all(selected.map((file) => new Promise<ReferenceImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        resolve({ name: file.name, mimeType: file.type, data: dataUrl.split(",")[1] ?? "", previewUrl: dataUrl });
      };
      reader.onerror = () => reject(new Error("Could not read " + file.name + "."));
      reader.readAsDataURL(file);
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Couldn't read an image.");
      return null;
    })));
    setMediaReady(true);
    setForm((current) => ({ ...current, referenceImages: [...current.referenceImages, ...converted.filter((item): item is ReferenceImage => item !== null)] }));
  };

  const testGeminiSettings = async () => {
    const key = apiKeyDraft.trim();
    if (!validModelSelection) return;
    if (!key) {
      setGeminiTestResult({ ok: false, message: "Enter a Gemini API key before testing." });
      return;
    }
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const result = await testGeminiModel(key, modelDraft);
      setModelDraft(result.modelId);
      setGeminiTestResult({ ok: true, message: "Connected: " + result.displayName + " (" + result.modelId + ") supports text generation." });
    } catch (caught) {
      setGeminiTestResult({ ok: false, message: caught instanceof Error ? caught.message : "Could not test Gemini. Check the key and model." });
    } finally {
      setTestingGemini(false);
    }
  };

  const saveApiSettings = () => {
    const nextKey = apiKeyDraft.trim();
    if (!validModelSelection) return;
    const model = modelDraft;
    if (nextKey) { localStorage.setItem(STORAGE.key, nextKey); setApiKey(nextKey); }
    else { localStorage.removeItem(STORAGE.key); setApiKey(""); }
    localStorage.setItem(STORAGE.model, model);
    setGeminiModel(model);
    setSettingsOpen(false);
    setGeminiTestResult(null);
    setNotice(nextKey ? "Gemini settings saved in this browser." : "API key removed from this browser.");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Clapperboard size={22} strokeWidth={2.2} /></div>
          <div><div className="brand-name">MM Storyboard</div><div className="brand-subtitle">FLOW PROMPT STUDIO</div></div>
        </div>
        <button className="new-project-button" disabled={Boolean(busy) || !hydrated} onClick={newProject}><Plus size={17} /> New project <span>⌘ K</span></button>
        <div className="sidebar-label">WORKSPACE</div>
        <button className={step === "brief" ? "side-link active" : "side-link"} onClick={() => setStep("brief")}><LayoutDashboard size={17} /> Video brief</button>
        <button className={step === "concepts" ? "side-link active" : "side-link"} onClick={() => concepts.length ? setStep("concepts") : setNotice("Generate concepts first to use this step.")}><Lightbulb size={17} /> Concepts <span className="side-count">{concepts.length || "–"}</span></button>
        <button className={step === "storyboard" ? "side-link active" : "side-link"} onClick={() => storyboard ? setStep("storyboard") : setNotice("Build a storyboard first to use this step.")}><Film size={17} /> Storyboard <span className="side-count">{storyboard?.scenes.length || "–"}</span></button>
        <button className={assetStudioOpen ? "side-link active" : "side-link"} disabled={Boolean(busy) || !hydrated} onClick={() => setAssetStudioOpen(true)}><Wand2 size={17} /> Asset Studio <span className="side-count">NEW</span></button>
        <div className="sidebar-label saved-label"><span>YOUR LIBRARY</span><button onClick={() => setLibraryOpen(true)} aria-label="Open library"><ChevronRight size={14} /></button></div>
        <div className="saved-list">
          {savedProjects.slice(0, 4).map((project) => <button className="saved-item" key={project.id} disabled={Boolean(busy) || !hydrated} onClick={() => loadProject(project)} title={project.title}><FolderOpen size={15} /><span>{project.title}</span></button>)}
          {!savedProjects.length && <div className="empty-library">Your saved projects will appear here.</div>}
          {savedProjects.length > 4 && <button className="view-all" onClick={() => setLibraryOpen(true)}>View all projects</button>}
        </div>
        <div className="sidebar-bottom">
          <div className={apiKey ? "api-status connected" : "api-status"}><span className="status-dot" /><span>{apiKey ? "Gemini connected" : "API key required"}</span></div>
          <button className="side-link" onClick={() => { setApiKeyDraft(apiKey); setSettingsOpen(true); }}><Settings size={17} /> Settings <span className="side-shortcut">⌘ ,</span></button>
          <div className="sidebar-footer"><span className="mini-logo">MM</span><span>Built for LearnTypeMM</span><span className="version">v1.0</span></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{step === "brief" ? "Video brief" : step === "concepts" ? "Concept selection" : "Storyboard editor"}</strong></div>
          <div className="topbar-actions">
            <button className="quiet-button" disabled={Boolean(busy) || !hydrated} onClick={() => void exportZip()}><Download size={15} /> Backup ZIP</button>
            <label className="quiet-button archive-upload">Import ZIP<input type="file" accept=".zip" disabled={Boolean(busy) || !hydrated} onChange={(event) => { void importZip(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <button className="quiet-button" onClick={() => setLibraryOpen(true)}><FolderOpen size={16} /> My projects</button>
            <button className="settings-button" onClick={() => { setApiKeyDraft(apiKey); setSettingsOpen(true); }}><Settings size={16} /> Settings</button>
            <div className={apiKey ? "avatar-dot online" : "avatar-dot"}>M</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-mark"><Sparkles size={12} /></span> AI VIDEO WORKFLOW <span className="eyebrow-dot">•</span> GOOGLE FLOW READY</div>
              <h1>Turn ideas into <span className="gradient-text">storyboards.</span></h1>
              <p className="page-description">One brief in. Three creative directions, scene-by-scene Flow prompts, Burmese narration, and a production-ready plan out.</p>
            </div>
            <div className="welcome-stat"><div className="welcome-stat-icon"><Zap size={19} /></div><div><strong>One brief</strong><span>Complete video plan</span></div></div>
          </section>

          <div className="stepper">
            {[
              { id: "brief", number: "01", label: "Brief", icon: FileText },
              { id: "concepts", number: "02", label: "Concepts", icon: Lightbulb },
              { id: "storyboard", number: "03", label: "Storyboard", icon: Clapperboard },
            ].map((item, index) => {
              const Icon = item.icon;
              const active = step === item.id;
              const complete = (item.id === "brief" && (concepts.length > 0 || Boolean(form.topic.trim()))) || (item.id === "concepts" && concepts.length > 0) || (item.id === "storyboard" && Boolean(storyboard));
              return <div className={active ? "step-item active" : complete ? "step-item complete" : "step-item"} key={item.id}>
                <div className="step-num">{complete && !active ? <Check size={14} /> : <Icon size={14} />}</div><div className="step-copy"><span>{item.number}</span><strong>{item.label}</strong></div>{index < 2 && <div className="step-connector" />}
              </div>;
            })}
          </div>

          {error && <div className="alert error-alert" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
          {notice && <div className="alert success-alert" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

          <section className="panel brief-panel">
            <div className="section-heading">
              <div className="section-icon blue"><FileText size={18} /></div>
              <div><h2>Tell us about your video</h2><p>A clear topic helps the AI create better scenes and more useful prompts.</p></div>
              <div className="panel-kicker">VIDEO BRIEF</div>
            </div>
            <div className="form-content">
              <Field label="What video do you want to make?" hint="Add one sentence or a short paragraph. Example: A warm coffee advertisement with a surprising opening and a memorable ending.">
                <textarea className="input topic-input" value={form.topic} onChange={(event) => updateForm("topic", event.target.value)} placeholder="Describe your video topic..." rows={3} />
              </Field>
              <Field label="Main goal"><input className="input" value={form.goal} onChange={(event) => updateForm("goal", event.target.value)} placeholder="Teach, explain, promote, entertain..." /></Field>
              <div className="form-grid four-columns">
                <Field label="Platform"><select className="input select-input" value={form.platform} onChange={(event) => updateForm("platform", event.target.value as Platform)}>{PLATFORMS.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Video runtime"><select className="input select-input" value={form.targetDuration} onChange={(event) => updateForm("targetDuration", Number(event.target.value))}>{Array.from(new Set([15, 30, 45, 60, 90, 120, form.targetDuration])).sort((a, b) => a - b).map((item) => <option key={item} value={item}>{item} seconds</option>)}</select></Field>
                <Field label="Output language"><select className="input select-input" value={form.language} onChange={(event) => updateForm("language", event.target.value as Language)}>{LANGUAGES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Target audience"><input className="input" value={form.audience} onChange={(event) => updateForm("audience", event.target.value)} placeholder="Who is it for?" /></Field>
              </div>

              <div className="subsection-label"><span>VISUAL DIRECTION</span><span className="subsection-line" /></div>
              <div className="style-grid">
                {STYLES.map((style, index) => <button key={style} className={form.visualStyle === style ? "style-option chosen" : "style-option"} onClick={() => updateForm("visualStyle", style)}>
                  <div className={"style-art style-art-" + (index + 1)}>{index === 0 ? <MonitorPlay size={20} /> : index === 1 ? <Film size={20} /> : index === 2 ? <Sparkles size={20} /> : index === 3 ? <Zap size={20} /> : index === 4 ? <Volume2 size={20} /> : <Wand2 size={20} />}</div>
                  <span>{style}</span>{form.visualStyle === style && <span className="selected-check"><Check size={11} /></span>}
                </button>)}
              </div>

              <button className="advanced-toggle" onClick={() => setShowAdvanced((current) => !current)}><Settings size={15} /> Production settings <span>Presets, Google Flow model, clip length, audio & references</span>{showAdvanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
              {showAdvanced && <div className="advanced-content">
              <div className="workflow-toolbar"><label className="field"><span className="field-label">Production preset</span><select className="input" defaultValue="" disabled={Boolean(busy) || !hydrated} onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value); if (preset) { setForm((current) => ({ ...current, ...preset.settings })); setNotice("Applied " + preset.name); } event.currentTarget.value = ""; }}><option value="">Apply saved settings…</option>{presets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><input className="input" aria-label="Preset name" placeholder="Name these settings" maxLength={100} value={presetName} onChange={(event) => setPresetName(event.target.value)} /><button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={savePreset}>Save preset</button><select className="input" aria-label="Delete preset" defaultValue="" onChange={(event) => { setPresets((items) => items.filter((item) => item.id !== event.target.value)); event.currentTarget.value = ""; }}><option value="">Delete a preset…</option>{presets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>

                <div className="form-grid three-columns">
                  <Field label="Flow model"><select className="input select-input" value={form.flowModel} onChange={(event) => updateForm("flowModel", event.target.value as FlowModel)}>{FLOW_MODELS.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Generation mode"><select className="input select-input" value={form.generationMode} onChange={(event) => updateForm("generationMode", event.target.value as GenerationMode)}>{MODES.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Clip length"><select className="input select-input" value={form.clipDuration} onChange={(event) => updateForm("clipDuration", Number(event.target.value))}>{Array.from(new Set([4, 6, 8, 10, form.clipDuration])).sort((a, b) => a - b).map((item) => <option key={item} value={item}>{item} seconds</option>)}</select></Field>
                  <Field label="Aspect ratio"><select className="input select-input" value={form.aspectRatio} onChange={(event) => updateForm("aspectRatio", event.target.value as VideoForm["aspectRatio"])}><option value="9:16">9:16 · Vertical</option><option value="16:9">16:9 · Landscape</option><option value="1:1">1:1 · Square</option></select></Field>
                  <Field label="Audio policy"><input className="input" value={form.audioPolicy} onChange={(event) => updateForm("audioPolicy", event.target.value)} /></Field>
                  <Field label="Text policy"><input className="input" value={form.textPolicy} onChange={(event) => updateForm("textPolicy", event.target.value)} /></Field>
                </div>
            {compatibility && <div className="compatibility-note"><AlertCircle size={16} /><span>{compatibility}</span></div>}
                <Field label="Reference notes" hint="Describe brand rules, real UI, people, clothing, locations, or anything the AI must not invent."><textarea className="input" value={form.referenceNotes} onChange={(event) => updateForm("referenceNotes", event.target.value)} rows={3} /></Field>
                <div className="upload-box">
                  <div className="upload-copy"><div className="upload-icon"><Upload size={18} /></div><div><strong>Reference images <span>Optional</span></strong><p>Upload character photos, product images, logos, or visual references. Up to 4 images.</p></div></div>
                  <label className="upload-button"><Upload size={15} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => { void onImageUpload(event.target.files); event.currentTarget.value = ""; }} /></label>
                  {form.referenceImages.length > 0 && <div className="reference-list">{form.referenceImages.map((image, index) => <div className="reference-chip" key={image.name + "-" + index}><img src={image.previewUrl} alt={image.name} /><span>{image.name}</span><button onClick={() => updateForm("referenceImages", form.referenceImages.filter((_, i) => i !== index))} aria-label={"Remove " + image.name}><X size={13} /></button></div>)}</div>}
                </div>
              </div>}
              <div className="brief-footer">
                <div className="footer-info"><span className="secure-icon"><KeyRound size={14} /></span><span>{apiKey ? "Gemini API is configured" : "Set up a Gemini API key to start"} <button className="inline-link" onClick={() => { setApiKeyDraft(apiKey); setSettingsOpen(true); }}>{apiKey ? "Manage key" : "Set up API key"}</button></span></div>
                <button className="primary-button generate-button" onClick={() => void generateConcepts(true)} disabled={Boolean(busy) || !hydrated}><Sparkles size={17} />{busy === "concepts" ? "Choosing the best concept…" : busy === "storyboard" ? "Building storyboard…" : "Auto: topic to storyboard"}</button>
                <button className="secondary-button" onClick={() => void generateConcepts()} disabled={Boolean(busy) || !hydrated}>{busy === "concepts" ? <span className="spinner" /> : <Sparkles size={17} />}{busy === "concepts" ? "Generating concepts..." : "Generate 3 concepts"}<ChevronRight size={17} /></button>
              </div>
            </div>
          </section>

          {concepts.length > 0 && (step === "concepts" || step === "storyboard") && <section className="results-section">
            <div className="section-heading results-heading">
              <div className="section-icon purple"><Lightbulb size={18} /></div>
              <div><h2>Choose your creative direction</h2><p>Three ways to tell the same story. Select one to build its storyboard.</p></div>
              <span className="count-pill">{concepts.length} CONCEPTS</span>
            </div>
            <div className="concept-grid">
              {concepts.map((concept, index) => <article className={selectedConceptId === concept.id ? "concept-card selected" : "concept-card"} key={concept.id}>
                <div className={"concept-visual concept-visual-" + (index + 1)}><div className="concept-visual-label">CONCEPT 0{index + 1}</div><div className="concept-visual-orb"><Film size={31} /></div><div className="concept-visual-bottom"><span>{concept.style}</span><span><span className="small-dot" /> {concept.estimatedDuration || form.targetDuration}s</span></div></div>
                <div className="concept-body">
                  <div className="concept-title-row"><h3>{concept.title}</h3>{selectedConceptId === concept.id && <span className="chosen-badge"><Check size={11} /> SELECTED</span>}</div>
                  <div className="hook-label">THE HOOK</div><p className="concept-hook">“{concept.hook}”</p>
                  <p className="concept-summary">{concept.summary}</p>
                  <div className="concept-direction"><span>VISUAL DIRECTION</span><p>{concept.visualDirection}</p></div>
                  {concept.storyArc.length > 0 && <div className="story-arc">{concept.storyArc.slice(0, 5).map((beat, i) => <div className="arc-beat" key={i + "-" + beat}><span>{String(i + 1).padStart(2, "0")}</span><p>{beat}</p></div>)}</div>}
                  <div className="concept-reason"><Lightbulb size={14} /><span>{concept.whyItWorks}</span></div>
                  <button className={selectedConceptId === concept.id && storyboard ? "secondary-button full-width" : "primary-button full-width"} onClick={() => { void generateStoryboard(concept); }} disabled={Boolean(busy) || !hydrated}>
                    {busy === "storyboard" && selectedConceptId === concept.id ? <span className="spinner" /> : <Wand2 size={16} />}{busy === "storyboard" && selectedConceptId === concept.id ? "Building storyboard..." : "Build this storyboard"}<ChevronRight size={16} />
                  </button>
                </div>
              </article>)}
            </div>
          </section>}

          {!storyboard && history.length > 0 && <div className="workflow-toolbar"><label className="field"><span className="field-label">Previous storyboard versions</span><select className="input" value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">Choose a version…</option>{history.map((version) => <option key={version.id} value={version.id}>{version.label} · {new Date(version.createdAt).toLocaleString()}</option>)}</select></label><button className="secondary-button" disabled={!versionId || Boolean(busy)} onClick={restoreVersion}>Restore version</button></div>}
          {storyboard && step === "storyboard" && <section className="storyboard-section">
            <div className="section-heading results-heading">
              <div className="section-icon green"><Clapperboard size={18} /></div>
              <div><h2>Your storyboard</h2><p>Edit the prompts and narration before moving each clip into Google Flow.</p></div>
              <div className="storyboard-actions"><button className="quiet-button" onClick={saveProject}><Save size={15} /> Save</button><button className="quiet-button" onClick={exportPromptPack}><Download size={15} /> Flow .txt</button><button className="quiet-button" onClick={exportJson}><Download size={15} /> JSON</button><button className="primary-button small-primary" onClick={exportMarkdown}><Download size={15} /> Export .md</button></div>
            </div>
            <div className="storyboard-overview">
              <div className="overview-main"><div className="overview-eyebrow">SELECTED CONCEPT</div><h3>{storyboard.projectTitle || selectedConcept?.title || form.topic}</h3><p>{storyboard.logline}</p><div className="overview-meta"><span><Film size={14} /> {storyboard.scenes.length} scenes</span><span><Clock3 size={14} /> {storyboard.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)}s planned</span><span><MonitorPlay size={14} /> {form.aspectRatio}</span></div></div>
              <div className="visual-bible"><span><Sparkles size={14} /> VISUAL BIBLE</span><p>{storyboard.visualBible}</p></div>
            </div>
            <div className="contact-sheet-action">
              <div className="contact-sheet-copy">
                <span className="contact-sheet-icon"><Film size={17} /></span>
                <div><strong>Visual storyboard contact sheet</strong><span>Generate a reference image prompt with one panel per scene and consistent visual direction.</span></div>
              </div>
              <button className="secondary-button" onClick={() => void copyText(buildContactSheetPrompt(form, storyboard), "Storyboard contact sheet prompt")}><Copy size={15} /> {copied === "Storyboard contact sheet prompt" ? "Copied" : "Copy contact-sheet prompt"}</button>
            </div>
            {storyboard.productionNotes.length > 0 && <div className="production-notes"><Lightbulb size={16} /><div><strong>Production notes</strong>{storyboard.productionNotes.map((note, index) => <p key={index}>{note}</p>)}</div></div>}
            <ComfyUIStudio key={projectId} onBusyChange={onComfyBusy} scenes={boardForExport().scenes} storyboard={storyboard} />
            {compatibility && <div className="compatibility-note"><AlertCircle size={16} /><span>{compatibility}</span></div>}
            <div className="audit-panel">
              <div className="audit-heading"><div><strong><CheckCircle2 size={16} /> Pre-generation check</strong><span>Quick automated checks before you spend Flow credits.</span></div><span className={auditCount === 0 && allAudits.every((item) => item.ok) ? "audit-status pass" : "audit-status warn"}>{auditCount === 0 && allAudits.every((item) => item.ok) ? "LOOKS GOOD" : auditCount + " SCENE FLAGS"}</span></div>
              <div className="audit-grid">{allAudits.map((item) => <div className="audit-item" key={item.label}><span className={item.ok ? "audit-check ok" : "audit-check issue"}>{item.ok ? <Check size={12} /> : <AlertCircle size={12} />}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div>
              <p className="audit-disclaimer">Automated checks cannot guarantee visual continuity or that Flow will support every selected setting. Review each scene and the active model options.</p>
            </div>
            <div className="workflow-toolbar">
              <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={() => { remember("Saved version"); setNotice("Version saved in history."); }}><History size={15} /> Save version</button>
              <select className="input" aria-label="Storyboard version" value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">Choose an earlier version…</option>{history.map((version) => <option value={version.id} key={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.label}</option>)}</select>
              <button className="secondary-button" disabled={!versionId || Boolean(busy)} onClick={restoreVersion}>Restore version</button>
              <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={addScene}><Plus size={14} /> Add scene</button>
              <button className="quiet-button" onClick={() => setSelectedSceneIds(storyboard.scenes.filter((scene) => !scene.locked).map((scene) => scene.id))}>Select unlocked</button>
              <button className="quiet-button" onClick={() => setSelectedSceneIds([])}>Clear</button>
              <button className="secondary-button" disabled={Boolean(busy) || !selectedSceneIds.length} onClick={() => void regenerateScenes(selectedSceneIds)}>Regenerate selected prompts</button>
              <button className="secondary-button" disabled={Boolean(busy) || !storyboard.scenes.some((scene) => !scene.locked && !scene.flowPrompt.trim())} onClick={() => void regenerateScenes(storyboard.scenes.filter((scene) => !scene.flowPrompt.trim()).map((scene) => scene.id))}>Generate missing prompts</button>
            </div>
            <div className="scene-list">
              {storyboard.scenes.map((scene) => {
                const sceneAudit = auditScene(scene);
                const flags = sceneAudit.filter((item) => !item.ok).length;
                return <article className="scene-card" key={scene.id}>
                  <div className="scene-card-head">
                    <input type="checkbox" aria-label={"Select scene " + scene.sceneNumber} disabled={scene.locked || Boolean(busy) || !hydrated} checked={selectedSceneIds.includes(scene.id)} onChange={(event) => setSelectedSceneIds((ids) => event.target.checked ? [...ids, scene.id] : ids.filter((id) => id !== scene.id))} /><div className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</div>
                    <div className="scene-title-area"><input className="scene-title-input" disabled={scene.locked || Boolean(busy) || !hydrated} value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} aria-label="Scene title" /><div className="scene-tags"><span><Clock3 size={12} /> {scene.durationSeconds}s clip</span><span><Film size={12} /> {scene.shotSize || "Shot plan"}</span><span className={flags ? "quality-tag warn" : "quality-tag"}>{flags ? flags + " checks to review" : "Prompt checked"}</span></div></div>
                    <button className="icon-button" onClick={() => void copyText(promptWithReferences(scene, projectAssets), "Scene " + scene.sceneNumber + " prompt")} title="Copy Flow prompt">{copied === "Scene " + scene.sceneNumber + " prompt" ? <Check size={16} /> : <Copy size={16} />}</button>
                    <button className="icon-button" onClick={() => void regenerateScenes([scene.id])} disabled={Boolean(busy) || scene.locked} title="Regenerate scene"><RefreshCw className={busy === scene.id ? "spinning" : ""} size={16} /></button>
                  </div>
                  <div className="scene-controls">
                    <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={() => toggleLock(scene)}>{scene.locked ? <Lock size={14} /> : <Unlock size={14} />}{scene.locked ? "Locked · unlock" : "Lock scene"}</button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.sceneNumber === 1} aria-label={"Move scene " + scene.sceneNumber + " up"} onClick={() => moveScene(scene, -1)}><ArrowUp size={15} /></button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.sceneNumber === storyboard.scenes.length} aria-label={"Move scene " + scene.sceneNumber + " down"} onClick={() => moveScene(scene, 1)}><ArrowDown size={15} /></button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.locked} aria-label={"Delete scene " + scene.sceneNumber} onClick={() => removeScene(scene)}><Trash2 size={15} /></button>
                    <select className="input" aria-label={"Review status scene " + scene.sceneNumber} disabled={scene.locked || Boolean(busy) || !hydrated} value={scene.reviewStatus || "draft"} onChange={(event) => updateScene(scene.id, { reviewStatus: event.target.value as Scene["reviewStatus"], locked: event.target.value === "approved" })}><option value="draft">Draft</option><option value="review">Needs review</option><option value="approved">Approved · lock</option></select>
                  </div>
                  <fieldset className="scene-content scene-fieldset" disabled={scene.locked || Boolean(busy) || !hydrated}>
                    <Field label="Review notes"><input className="input" value={scene.reviewNotes || ""} onChange={(event) => updateScene(scene.id, { reviewNotes: event.target.value })} placeholder="Keep feedback with this scene…" /></Field>
                    <div className="scene-reference-picker"><strong>Character & location references</strong><label><input type="checkbox" checked={scene.assetIds === undefined} onChange={(event) => updateScene(scene.id, { assetIds: event.target.checked ? undefined : [] })} /> Use project reference set</label>{castAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={sceneReferences(scene, projectAssets).some((item) => item.id === asset.id)} onChange={(event) => { const ids = sceneReferences(scene, projectAssets).map((item) => item.id); if (event.target.checked && ids.length >= 4) { setError("A scene can use up to four reference assets."); return; } updateScene(scene.id, { assetIds: event.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id) }); }} /><img src={assetAsReference(asset).previewUrl} alt="" />{asset.title}</label>)}{!castAssets.length && <span>Add a character or location in Asset Studio to reuse it here.</span>}</div>
                    <div className="scene-visual-details"><div className="scene-detail"><span>SCENE PURPOSE</span><p>{scene.objective}</p></div><div className="scene-detail"><span>VISUAL ACTION</span><p>{scene.visualDescription}</p></div><div className="scene-detail two-detail"><div><span>CAMERA</span><p>{scene.cameraMovement}</p></div><div><span>LIGHT / MOOD</span><p>{scene.lighting} · {scene.mood}</p></div></div><div className="scene-detail"><span>ACTION BEAT</span><p>{scene.action}</p></div></div>
                    <Field label="Google Flow prompt" hint="English prompt for the selected model. Copy this into Flow, then review its active settings."><textarea className="input prompt-editor" value={scene.flowPrompt} onChange={(event) => updateScene(scene.id, { flowPrompt: event.target.value })} rows={8} /></Field>
                    <div className="scene-edit-grid">
                      <Field label="Voiceover"><textarea className="input" value={scene.voiceover} onChange={(event) => updateScene(scene.id, { voiceover: event.target.value })} rows={3} /></Field>
                      <Field label="On-screen caption (add in editor)"><textarea className="input" value={scene.onscreenText} onChange={(event) => updateScene(scene.id, { onscreenText: event.target.value })} rows={3} placeholder="No caption needed..." /></Field>
                    </div>
                    <details className="scene-extra"><summary>Scene details, frames & audit <ChevronDown size={14} /></summary>
                      <div className="scene-extra-grid">
                        <Field label="Opening frame"><textarea className="input" value={scene.openingFrame} onChange={(event) => updateScene(scene.id, { openingFrame: event.target.value })} rows={3} /></Field>
                        <Field label="Final frame"><textarea className="input" value={scene.finalFrame} onChange={(event) => updateScene(scene.id, { finalFrame: event.target.value })} rows={3} /></Field>
                        <Field label="Audio direction"><textarea className="input" value={scene.audioNotes} onChange={(event) => updateScene(scene.id, { audioNotes: event.target.value })} rows={2} /></Field>
                        <Field label="Transition"><input className="input" value={scene.transition} onChange={(event) => updateScene(scene.id, { transition: event.target.value })} /></Field>
                        <Field label="Negative prompt"><textarea className="input" value={scene.negativePrompt} onChange={(event) => updateScene(scene.id, { negativePrompt: event.target.value })} rows={3} /></Field>
                        <Field label="Duration (seconds)"><input className="input" type="number" min={1} max={20} value={scene.durationSeconds} onChange={(event) => updateScene(scene.id, { durationSeconds: Number(event.target.value) || 1 })} /></Field>
                      </div>
                      <div className="scene-audit-list">{sceneAudit.map((item) => <div className={item.ok ? "scene-audit-line" : "scene-audit-line flagged"} key={item.label}><span>{item.ok ? <Check size={12} /> : <AlertCircle size={12} />}</span><strong>{item.label}</strong><small>{item.detail}</small></div>)}</div>
                    </details>
                    <div className="scene-card-foot"><span><Volume2 size={14} /> {scene.audioNotes || form.audioPolicy}</span><button className="copy-prompt-link" onClick={() => void copyText(promptWithReferences(scene, projectAssets), "Scene " + scene.sceneNumber + " prompt")}>{copied === "Scene " + scene.sceneNumber + " prompt" ? <Check size={14} /> : <Copy size={14} />} {copied === "Scene " + scene.sceneNumber + " prompt" ? "Copied" : "Copy Flow prompt"}</button></div>
                  </fieldset>
                </article>;
              })}
            </div>
            <div className="end-actions"><button className="secondary-button" onClick={() => setStep("concepts")}><ArrowLeft size={16} /> Change concept</button><button className="quiet-button" onClick={() => void copyText(storyboard.scenes.map((scene) => "SCENE " + scene.sceneNumber + "\n" + promptWithReferences(scene, projectAssets)).join("\n\n---\n\n"), "All scene prompts")}><Copy size={15} /> Copy all prompts</button><button className="primary-button" onClick={exportMarkdown}><Download size={16} /> Export complete storyboard <ChevronRight size={16} /></button></div>
          </section>}

          <footer className="page-footer"><span>MM Storyboard Studio</span><span>Prompt generation only · Videos are created separately in Google Flow</span><button onClick={() => { setApiKeyDraft(apiKey); setSettingsOpen(true); }}>API & privacy settings</button></footer>
        </div>
      </main>

      {assetStudioOpen && <AssetStudio protectedAssetIds={Array.from(new Set([storyboard, ...history.map((item) => item.storyboard), ...savedProjects.flatMap((project) => [project.storyboard, ...(project.history || []).map((item) => item.storyboard)])].flatMap((board) => board?.scenes.flatMap((scene) => scene.assetIds || []) || [])))} projectId={projectId} onAssetsChanged={refreshAssets} open={assetStudioOpen} onClose={() => setAssetStudioOpen(false)} apiKey={apiKey} projectTitle={storyboard?.projectTitle || selectedConcept?.title || form.topic} topic={form.topic} visualStyle={form.visualStyle} aspectRatio={form.aspectRatio} projectReferences={form.referenceImages} storyboard={storyboard} />}

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="modal-top"><div className="modal-icon"><KeyRound size={20} /></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18} /></button></div>
          <h2 id="settings-title">Connect Gemini</h2><p className="modal-description">Your API key powers concept generation, storyboard creation, and scene improvements.</p>
          <Field label="Gemini API key" hint="Stored in this browser's localStorage. Never paste a production server key into a public website."><input className="input api-key-input" type="password" value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setGeminiTestResult(null); }} placeholder="Paste your Gemini API key" autoComplete="off" /></Field>
          <Field label="Gemini API model" hint="Choose a text model listed by Google for your key. Quota and generation access depend on your account."><select className="input" value={modelOptions.some((item) => item.id === modelDraft) ? modelDraft : ""} disabled={!modelOptions.length || loadingModels} onChange={(event) => { setModelDraft(event.target.value); setGeminiTestResult(null); }}><option value="" disabled>{loadingModels ? "Loading models…" : "Add a key to load models"}</option>{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.id}</option>)}</select></Field>
          {modelListError && <div role="alert" className="gemini-test-result error">{modelListError}</div>}
          <button className="quiet-button" disabled={!apiKeyDraft.trim() || loadingModels} onClick={() => setModelRefresh((value) => value + 1)}><RefreshCw size={15} /> {loadingModels ? "Loading models…" : "Refresh models"}</button>
          {geminiTestResult && <div className={"gemini-test-result " + (geminiTestResult.ok ? "success" : "error")} role="status"><span>{geminiTestResult.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span><span>{geminiTestResult.message}</span></div>}
          <div className="privacy-note"><AlertCircle size={16} /><span>This is a browser-only development app. The key is sent to Google's Gemini API from your browser and stored locally. For a public deployment, proxy requests through a secured backend.</span></div>
          <div className="modal-actions"><button className="quiet-button" onClick={() => { setApiKeyDraft(""); localStorage.removeItem(STORAGE.key); setApiKey(""); setGeminiTestResult(null); setSettingsOpen(false); }}>Remove key</button><button className="secondary-button" onClick={() => void testGeminiSettings()} disabled={testingGemini || !validModelSelection}><Zap size={15} /> {testingGemini ? "Testing..." : "Test model"}</button><button className="primary-button" onClick={saveApiSettings} disabled={!validModelSelection}><Check size={16} /> Save settings</button></div>
          <div className="modal-help">Get or manage your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio <ChevronRight size={12} /></a></div>
        </section>
      </div>}

      {libraryOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLibraryOpen(false); }}>
        <section className="modal-card library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title">
          <div className="modal-top"><div className="modal-icon"><FolderOpen size={20} /></div><button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="Close library"><X size={18} /></button></div>
          <h2 id="library-title">Your project library</h2><p className="modal-description">Saved projects, reference images and assets stay in this browser. Use Backup ZIP to move a complete project to another browser.</p>
          {!savedProjects.length ? <div className="empty-library-modal"><FolderOpen size={28} /><strong>No saved projects yet</strong><span>Build a storyboard, then click Save.</span></div> : <div className="library-projects">{savedProjects.map((project) => <div className="library-project" key={project.id}><div className="library-project-icon"><Clapperboard size={18} /></div><button className="library-project-main" disabled={Boolean(busy) || !hydrated} onClick={() => loadProject(project)}><strong>{project.title}</strong><span>{project.storyboard ? project.storyboard.scenes.length + " scenes" : project.concepts.length + " concepts"} · {new Date(project.savedAt).toLocaleString()}</span></button><button className="icon-button danger-icon" onClick={() => setSavedProjects((current) => current.filter((item) => item.id !== project.id))} title="Delete saved project" aria-label="Delete saved project"><Trash2 size={16} /></button></div>)}</div>}
          <div className="modal-actions"><button className="quiet-button" onClick={() => setLibraryOpen(false)}>Close</button><button className="primary-button" onClick={() => { newProject(); setLibraryOpen(false); }}><Plus size={16} /> New project</button></div>
        </section>
      </div>}
    </div>
  );
}
export default App;
