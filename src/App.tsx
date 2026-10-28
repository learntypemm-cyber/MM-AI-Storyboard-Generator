import { materializeFullPrompts } from "./lib/fullPrompts";
import ScreenplayStudio from "./components/ScreenplayStudio";
import { screenplayChoicesSchema, screenplayRepairSchema, screenplayRequest, screenplayRepairRequest, screenplayCompletenessIssues, requiredScreenplaySceneCount, normalizeExistingScreenplay, screenplaySceneCount, pipelineCurrent, inventorySource, inventoryApproved } from "./lib/screenplayWorkflow";
import BurmeseDraftEditor from "./components/BurmeseDraftEditor";
import { draftSource, translationPrompt, validateTranslation } from "./lib/draftTranslation";
import { sceneDetailRequirements } from "./lib/promptGuidance";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronRight, MoreHorizontal,
  Clapperboard, Copy, Download, FileText, Film, FolderOpen, KeyRound,
  LayoutDashboard, Lightbulb, MonitorPlay, Plus, RefreshCw, Save, Settings,
  Sparkles, Trash2, Upload, Volume2, Wand2, X, Zap, Clock3, ArrowUp, ArrowDown, Lock, Unlock, History,
} from "lucide-react";
import type { GeminiModelCheck, GeminiModelOption } from "./lib/gemini";
import { generateJson, listGeminiModels, probeGeminiModel, testGeminiModel } from "./lib/gemini";
import { assetAsReference, assetHandle, promptWithReferences, readAssets, sceneReferences, writeAssets } from "./lib/assetStore";
import { prepareAutomaticAssets, referenceImagePrompt, referencePromptPack } from "./lib/automaticAssets";
import { workflowGuideMM, sceneBackground, referenceCode, sceneReferenceList, scenePreparationMode, sceneImagePrompt, sceneVideoPrompt, sceneInstructions, completePromptText, promptPackageZip } from "./lib/promptPackage";
import { loadReferences, saveReferences } from "./lib/projectMedia";
import { checkpoint, patchScene, reorderScene, sceneRepairPatch } from "./lib/boardEditing";
import { createArchive, readArchive, presetSchema } from "./lib/projectArchive";
import ComfyUIStudio from "./components/ComfyUIStudio";
import AssetStudio from "./components/AssetStudio";
import ShotBreakdownStudio from "./components/ShotBreakdownStudio";
import { buildContactSheetPrompt } from "./lib/flowProduction";
import { auditScene, auditStoryboard } from "./lib/audit";
import { downloadText, fileSlug, storyboardMarkdown } from "./lib/export";
import type {
  BoardVersion, ImageAsset, ProductionPreset, FlowModel, GenerationMode, Language, Platform, ReferenceImage, SavedProject,
  Scene, Storyboard, ScreenplayWorkflow, VideoConcept, VideoForm, VisualStyle,
} from "./types";

const STORAGE = {
  key: "mm-storyboard-gemini-key", model: "mm-storyboard-gemini-model",
  saved: "mm-storyboard-saved-projects", current: "mm-storyboard-current",
};
const DEFAULT_FORM: VideoForm = {
  topic: "",
  goal: "Turn the topic into a clear, engaging short video",
  platform: "Facebook Reels", targetDuration: 30, language: "Burmese",
  audience: "Myanmar-speaking viewers", visualStyle: "3D animation",
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
    "- Include backgroundAngle (A/B/C/D) for the opening shot, sfx and backgroundMusic as separate strings. The first timed beat must use backgroundAngle. handoff describes the transition TO THE NEXT scene: CONTINUATION only for uninterrupted action in the same space; otherwise CUT. Make each next openingFrame match the preceding finalFrame for continuation. Do not force cuts every two seconds.",
    "- Keep character, wardrobe, location and recurring product descriptions precise and mutually consistent. Do not introduce new identities between scenes.",
    "- Each flowPrompt starts with exactly one policy: 'NO TEXT IN THE IMAGE.' or 'INTENTIONAL TEXT IN THE IMAGE: [exact short text]'. For accurate product UI and Burmese captions, use 'NO TEXT IN THE IMAGE.' and add real screen recordings/subtitles in post.",
    sceneDetailRequirements,
    "Each flowPrompt is copy-paste English with no markdown fences. Keep metadata fields equally specific.",
    "- Structure each flowPrompt into chronological time ranges from 00:00 to its durationSeconds, usually 2-second beats with a shorter final beat if needed. Each beat specifies [Camera shot], named character action, and [Background] location name plus A (front), B (right), C (back/reverse), or D (left). These letters refer to the four views of ONE location reference sheet. Reuse an angle when appropriate; do not force cuts or a new camera position for every beat. Never refer to an unmentioned location. Close with separate SFX and Background Music directions based on the audio policy.",
    "- Use physically possible camera movement and clear cuts when positions change. Avoid conflicting actions. Timestamps, panel letters and field labels are production directions only: never render them, reference-sheet grids, name tags or borders in the video. Each video frame is a single full-screen shot.",
    "- Don't ask the model to draw website UI unless the user supplied a relevant screenshot. For website tutorials, use authentic screen recordings for any actual click-through.",
    "- Voiceover must be in " + form.language + ". On-screen text is exact caption copy for editing, not for the video model. Use empty string if no caption is needed.",
    "- Negative prompts should prevent malformed hands, unstable keyboards, illegible text, layout drift, flicker, extra fingers, artificial logos, fake website UI, duplicate objects, and watermarks where relevant.",
    "- Avoid copyrighted characters, celebrity likenesses, and misleading claims. JSON only, no prose outside it.",
    "",
    "Return this JSON structure:",
    '{"projectTitle":"string","logline":"string","visualBible":"string","continuityRules":["string"],"globalNegativePrompt":"string","productionNotes":["string"],"scenes":[{"sceneNumber":1,"title":"string","durationSeconds":8,"objective":"string","visualDescription":"string","shotSize":"string","cameraMovement":"string","lighting":"string","mood":"string","action":"string","flowPrompt":"string","voiceover":"string","onscreenText":"string","audioNotes":"string","transition":"string","referenceAssets":["string"],"negativePrompt":"string","openingFrame":"string","finalFrame":"string","handoff":"CUT","backgroundAngle":"A","sfx":"string","backgroundMusic":"string"}]}',
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
    "Visual style: " + form.visualStyle + ". Audio policy: " + form.audioPolicy + ". Text policy: " + form.textPolicy,
    sceneDetailRequirements,
    'Retain the same scene number and core story purpose, but fix ambiguity and generic actions. Create an English standalone flowPrompt starting exactly with "NO TEXT IN THE IMAGE." unless specific short intentional text is essential. Include full opening and final frames. Never refer to other scenes, never tell Flow to draw captions, and never invent website UI. Voiceover stays in ' + form.language + '.',
    "Keep flowPrompt time-coded from 00:00 to durationSeconds with camera, named action and named background / A-D angle per beat. Include backgroundAngle for the first beat, sfx, backgroundMusic and an outgoing handoff to the next scene. Keep timing feasible; no forced cuts. Labels and timestamps must not appear in the rendered video.",
    'Return the full Scene fields: sceneNumber,title,durationSeconds,objective,visualDescription,shotSize,cameraMovement,lighting,mood,action,flowPrompt,voiceover,onscreenText,audioNotes,transition,referenceAssets,negativePrompt,openingFrame,finalFrame,handoff,backgroundAngle,sfx,backgroundMusic. Shape: {"scene":{...}}.'
  ].join("\n");
}

function promptCompletenessIssues(scene: Scene): string[] {
  const prompt = (scene.flowPrompt || "").trim();
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const ranges = prompt.match(/\b\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\b/g) || [];
  const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const issues: string[] = [];
  if (words < 80) issues.push("Flow prompt is too short");
  if (!/^(NO TEXT IN THE IMAGE\.|NO VISIBLE TEXT\.|INTENTIONAL TEXT IN THE IMAGE:\s*\S)/i.test(firstLine)) issues.push("Missing first-line text policy");
  if (!/opening frame|first frame/i.test(prompt)) issues.push("Missing opening-frame direction");
  if (!/final frame|last frame/i.test(prompt)) issues.push("Missing final-frame direction");
  if (ranges.length < 2 || !/00:00\s*[-–]/.test(prompt)) issues.push("Missing chronological time-coded action beats");
  const endTime = String(Math.floor(scene.durationSeconds / 60)).padStart(2, "0") + ":" + String(Math.floor(scene.durationSeconds % 60)).padStart(2, "0");
  if (!prompt.includes(endTime)) issues.push("Time-coded action does not reach the clip end");
  const required: Array<[string, string | undefined]> = [
    ["title", scene.title], ["objective", scene.objective], ["visual description", scene.visualDescription],
    ["shot size", scene.shotSize], ["camera movement", scene.cameraMovement], ["lighting", scene.lighting],
    ["mood", scene.mood], ["action", scene.action], ["audio direction", scene.audioNotes],
    ["opening frame", scene.openingFrame], ["final frame", scene.finalFrame], ["negative prompt", scene.negativePrompt],
    ["sound effects direction", scene.sfx], ["background music direction", scene.backgroundMusic],
  ];
  for (const [label, value] of required) if (!value?.trim()) issues.push("Missing " + label);
  return issues;
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
  const stopAssets = useRef(false);
  const [assetProgress, setAssetProgress] = useState("");
  const lastEdit = useRef({ label: "", time: 0 });
  const [form, setForm] = useState<VideoForm>(DEFAULT_FORM);
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem(STORAGE.key) ?? ""; } catch { return ""; } });
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [geminiModel, setGeminiModel] = useState(() => { try { return localStorage.getItem(STORAGE.model) ?? GEMINI_DEFAULT; } catch { return GEMINI_DEFAULT; } });
  const [modelDraft, setModelDraft] = useState(geminiModel);
  const [modelOptions, setModelOptions] = useState<GeminiModelOption[]>([]);
  const [modelListKey, setModelListKey] = useState("");
  const [modelListError, setModelListError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelRefresh, setModelRefresh] = useState(0);
  const [modelChecks, setModelChecks] = useState<GeminiModelCheck[]>([]);
  const [checkingModels, setCheckingModels] = useState(false);
  const [modelCheckProgress, setModelCheckProgress] = useState(0);
  const [concepts, setConcepts] = useState<VideoConcept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState("");
  const [screenplay, setScreenplay] = useState<ScreenplayWorkflow | undefined>();
  const [existingScreenplayDraft, setExistingScreenplayDraft] = useState("");
  const [existingScreenplayTitle, setExistingScreenplayTitle] = useState("");
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
  const [step, setStep] = useState<"brief" | "concepts" | "storyboard" | "shots">("brief");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [inspectorSceneId, setInspectorSceneId] = useState<string | null>(null);
  const inspectorScene = storyboard?.scenes.find((scene) => scene.id === inspectorSceneId) || storyboard?.scenes[0] || null;
  const navigateStudio = (next: "brief" | "concepts" | "storyboard" | "shots") => { setStep(next); setMobileNavOpen(false); };

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
  const boardCurrent = Boolean(storyboard && pipelineCurrent(screenplay, form, storyboard));
  const allAudits = useMemo(() => auditStoryboard(storyboard, form), [storyboard, form]);
  const auditCount = useMemo(() => storyboard?.scenes.reduce((sum, scene) => sum + auditScene(scene).filter((item) => !item.ok).length, 0) ?? 0, [storyboard]);

  useEffect(() => { try { localStorage.setItem(STORAGE.saved, JSON.stringify(savedProjects)); } catch { setError("Browser storage is full. Export a ZIP backup to keep your work."); } }, [savedProjects]);

  useEffect(() => {
    const current = readLocal<{ form?: SavedProject["form"]; concepts?: VideoConcept[]; selectedConceptId?: string; storyboard?: Storyboard | null; screenplay?: ScreenplayWorkflow } | null>(STORAGE.current, null);
    if (current?.form) {
      setForm({ ...DEFAULT_FORM, ...current.form, referenceImages: [] });
      setConcepts(current.concepts ?? []);
      setSelectedConceptId(current.selectedConceptId ?? "");
      setStoryboard(current.storyboard ?? null); setScreenplay(current.screenplay);
      if (current.storyboard) setStep("storyboard");
      else if (current.screenplay || current.concepts?.length) setStep("concepts");
    }
    loadReferences(projectId).then((references) => { setForm((current) => ({ ...current, referenceImages: references })); setMediaReady(true); })
      .catch(() => setError("Could not restore project reference images."))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const current = { projectId, history, form: stripImages(form), concepts, selectedConceptId, storyboard, screenplay };
    try { localStorage.setItem(STORAGE.current, JSON.stringify(current)); } catch { setError("Autosave storage is full. Export a ZIP backup before closing."); }
  }, [form, concepts, selectedConceptId, storyboard, screenplay, projectId, history, hydrated]);

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

  const generateScreenplays = async () => {
    if (busy || !hydrated || !requireKey()) return;
    if (!form.topic.trim()) { setError("ခေါင်းစဉ် အရင်ထည့်ပါ။"); return; }
    setBusy("screenplays"); setError(""); setNotice("");
    try {
      const raw = await generateJson<unknown>(apiKey.trim(), geminiModel, screenplayRequest(form), form.referenceImages);
      let choices = screenplayChoicesSchema.parse(raw).choices;
      const invalidIndexes = choices.map((choice, index) => screenplayCompletenessIssues(choice.screenplay, form).length ? index : -1).filter(index => index >= 0);
      if (invalidIndexes.length) {
        setNotice("ဇာတ်ညွှန်းအရှည်နဲ့ scene အရေအတွက်ကို ပြန်ညှိနေပါတယ်…");
        const repairRaw = await generateJson<unknown>(
          apiKey.trim(),
          geminiModel,
          screenplayRepairRequest(form, choices, invalidIndexes),
          form.referenceImages,
        );
        const repairs = screenplayRepairSchema.parse(repairRaw).repairs;
        const repairedByIndex = new Map<number, (typeof repairs)[number]>();
        for (const repair of repairs) {
          if (repairedByIndex.has(repair.index)) throw new Error("Gemini returned duplicate screenplay repairs. Please retry.");
          repairedByIndex.set(repair.index, repair);
        }
        for (const index of invalidIndexes) {
          if (!repairedByIndex.has(index)) throw new Error("Gemini did not return every incomplete screenplay repair. Please retry.");
        }
        choices = choices.map((choice, index) => {
          const repair = repairedByIndex.get(index);
          if (!repair) return choice;
          return { title: choice.title, screenplay: repair.screenplay };
        });
      }
      const remainingIssues = choices.map((choice, index) => ({ index, title: choice.title, issues: screenplayCompletenessIssues(choice.screenplay, form) })).filter(item => item.issues.length);
      if (remainingIssues.length) {
        const expected = requiredScreenplaySceneCount(form);
        throw new Error("Gemini still returned incomplete scripts after an automatic repair. For " + form.targetDuration + "s at " + form.clipDuration + "s per clip, each screenplay needs exactly " + expected + " numbered scenes. No incomplete screenplay was saved. Please try again or select a model that can generate longer text.");
      }
      await preserveCurrentProject();
      remember("Before new screenplay choices");
      setScreenplay({ choices: choices.map(c => ({ ...c, id: makeId(), versions: [] })), selectedId: "" });
      setConcepts([]); setSelectedConceptId(""); setStep("concepts");
      setNotice("ဇာတ်ညွှန်း ၃ မျိုးရပါပြီ။ တစ်မျိုးရွေးပြီး ဖတ်၊ ပြင်၊ အတည်ပြုပါ။ နောက်အဆင့်ကို အလိုအလျောက် မသွားပါ။");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not write screenplays."); }
    finally { setBusy(null); }
  };
  const startFromExistingScreenplay = async () => {
    if (busy || !hydrated) return;
    const normalized = normalizeExistingScreenplay(existingScreenplayDraft.trim());
    if (!normalized) { setError("ရှိပြီးသား screenplay စာသားကို အရင်ထည့်ပါ။"); return; }
    if (normalized.length > 100000) { setError("Screenplay က စာလုံး 100,000 ထက်ကျော်နေပါတယ်။ ဖိုင်/စာသားကို အပိုင်းလိုက်တိုအောင် ပြင်ပါ။"); return; }
    const sceneCount = screenplaySceneCount(normalized);
    if (!sceneCount) { setError("Scene heading မတွေ့ပါ။ အခန်းတစ်ခုစီကို INT. / EXT. နဲ့စပါ၊ သို့မဟုတ် ၁။ / 1. နံပါတ်ထည့်ပါ။"); return; }
    try {
      await preserveCurrentProject();
      const id = makeId();
      const title = existingScreenplayTitle.trim().slice(0, 120) || form.topic.trim() || "ကိုယ်ပိုင်ဇာတ်ညွှန်း";
      const choice = { id, title, screenplay: normalized, versions: [], sourceType: "existing" as const };
      if (!form.topic.trim()) setForm((current) => ({ ...current, topic: title }));
      setScreenplay({ choices: [choice], selectedId: id });
      setConcepts([]); setSelectedConceptId(""); setStoryboard(null); setStep("concepts");
      setNotice("ရှိပြီးသား screenplay ကို အသုံးပြုလိုက်ပါပြီ။ မူရင်းဇာတ်ညွှန်းကို ပြန်ရေးမထားပါ။ " + sceneCount + " scenes ကို တိုက်ရိုက် inventory ထုတ်နိုင်ပါပြီ။");
      setError("");
    } catch (caught) {
      setError("Screenplay အသစ်မဖွင့်နိုင်ပါ။ လက်ရှိ project ကို မပျက်စေရန် မပြောင်းထားပါ။ " + (caught instanceof Error ? caught.message : "Please retry."));
    }
  };

  const generateStoryboard = async (concept: VideoConcept) => {
    if (!hydrated || busy) return;
    if (storyboard?.scenes.some((scene) => scene.locked)) { setError("Unlock approved scenes before rebuilding the storyboard."); return; }
    remember("Before rebuilding storyboard");
    setError(""); setNotice("");
    if (!requireKey()) return;
    setBusy("storyboard"); setSelectedConceptId(concept.id);
    try {
      const result = await generateJson<Storyboard>(apiKey.trim(), geminiModel.trim() || GEMINI_DEFAULT, buildStoryboardPrompt(form, concept) + "\nDRAFT REVIEW MODE: Override English-output instructions above. Write ALL descriptive scene fields and flowPrompt in Burmese so the user can edit them first. Keep JSON keys, IDs, enum values and timestamps unchanged. Keep voiceover in the requested spoken language. Do not translate to English yet.", form.referenceImages);
      if (!Array.isArray(result.scenes) || !result.scenes.length) throw new Error("The response didn't include scenes. Try again or shorten your brief.");
      let scenes: Scene[] = result.scenes.map((scene, index) => ({
        ...scene, backgroundAngle: ["A", "B", "C", "D"].includes(scene.backgroundAngle || "") ? scene.backgroundAngle : "A", id: makeId(), sceneNumber: Number(scene.sceneNumber) || index + 1,
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
      const built: Storyboard = {
        ...result, scenes, referencePlan: undefined, promptLanguage: "my", englishJson: undefined, englishSource: undefined,
        continuityRules: Array.isArray(result.continuityRules) ? result.continuityRules : [],
        productionNotes: Array.isArray(result.productionNotes) ? result.productionNotes : [],
      };
      setStoryboard(built);
      setStep("storyboard");
      await createReferences(built);
    } catch (caught) { setNotice(""); setError(caught instanceof Error ? caught.message : "Couldn't build the storyboard. Please try again."); }
    finally { setBusy(null); }
  };

  const makeBurmeseDraft = async () => {
    if (!storyboard || busy || !requireKey()) return;
    setBusy("translation"); setError("");
    try {
      const raw = await generateJson<unknown>(apiKey.trim(), geminiModel, "Translate all descriptive fields of this storyboard and reference prompts into Burmese for editing. Return the entire same JSON structure. Preserve IDs, scene order, timing, technical enum values, exact dialogue/voiceover/captions and reference links. Do not add or remove content.\n" + JSON.stringify(storyboard));
      const draft = validateTranslation(raw, storyboard);
      remember("Before Burmese draft conversion");
      setStoryboard({ ...draft, promptLanguage: "my" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create Burmese draft."); }
    finally { setBusy(null); }
  };
  const translateDraft = async () => {
    if (!storyboard || busy || !hydrated || !requireKey()) return;
    setBusy("translation"); setError("");
    try {
      const draft = materializeFullPrompts(storyboard, form);
      const raw = await generateJson<unknown>(apiKey.trim(), geminiModel, translationPrompt(draft));
      const english = validateTranslation(raw, draft);
      setStoryboard({ ...draft, englishJson: JSON.stringify(english), englishSource: draftSource(draft, form) });
      setNotice("English prompt ပြောင်းပြီးပါပြီ။ Copy / ZIP download လုပ်နိုင်ပါပြီ။");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Translation failed. Your Burmese draft is preserved."); }
    finally { setBusy(null); }
  };
  const createReferences = async (board: Storyboard) => {
    stopAssets.current = false; setBusy("assets"); setError("");
    try {
      const result = await prepareAutomaticAssets(board, form, projectId, apiKey.trim(), geminiModel, setStoryboard, setAssetProgress, () => stopAssets.current, true);
      refreshAssets();
      if (result.failed.length) setError(result.failed.join("\n"));
      setNotice(board.promptLanguage === "my" ? "မြန်မာမူကြမ်းရပါပြီ။ စစ်ပြီးပြင်ပါ။ စိတ်ကြိုက်ဖြစ်မှ English ပြောင်းပါ။" : "Prompt package ready: create the reference images first, then follow the scene image and video instructions in Flow.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare references."); }
    finally { setBusy(null); setAssetProgress(""); }
  };
  const retryReferences = async () => {
    if (!storyboard || busy || !hydrated || !requireKey()) return;
    remember("Before preparing reference prompts");
    await createReferences(storyboard);
  };
  const downloadFlowScenes = async () => {
    if (!storyboard || busy) return;
    setBusy("flow-download");
    try {
      const blob = await promptPackageZip(storyboard, form, projectAssets);
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = fileSlug(storyboard.projectTitle) + "-flow-scenes.zip"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Flow prompt package downloaded: references, scene images, video prompts and instructions.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Download failed."); }
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
        let candidate = scene;
        let remaining: string[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const prompt = buildSceneRepairPrompt(form, selectedConcept, candidate, storyboard) +
            "\nCompleteness requirements: Return a standalone English Flow prompt with 100-180 words, the required first-line text policy, at least two chronological time ranges beginning at 00:00 and reaching the full clip duration, clear opening and final frames, complete camera/action/background instructions, audio direction, SFX and background music. Fill all scene fields. Do not return a partial object." +
            "\nIssues identified after the previous attempt: " + (remaining.length ? remaining.join(", ") : "None identified yet; follow every requirement carefully.") +
            "\nReference registry: " + linked.map((asset) => assetHandle(asset) + " = " + asset.title).join("; ");
          const result = await generateJson<{ scene: Partial<Scene> }>(
            apiKey.trim(), geminiModel.trim() || GEMINI_DEFAULT, prompt, refs,
          );
          if (!result.scene || typeof result.scene.flowPrompt !== "string" || !result.scene.flowPrompt.trim()) {
            throw new Error("No updated scene prompt returned.");
          }
          candidate = {
            ...candidate, ...sceneRepairPatch(result.scene),
            id: scene.id, sceneNumber: scene.sceneNumber,
          };
          remaining = promptCompletenessIssues(candidate);
          if (!remaining.length) break;
        }
        if (remaining.length) {
          throw new Error("Prompt remains incomplete after two attempts: " + remaining.join(", "));
        }
        setStoryboard((current) => current ? patchScene(current, scene.id, { ...candidate, reviewStatus: "draft" }) : current);
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
  const snapshotProject = (): SavedProject => ({ id: projectId, title: storyboard?.projectTitle || form.topic, savedAt: new Date().toISOString(), form: stripImages(form), concepts, selectedConceptId, storyboard, screenplay, history });
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
      for (const board of [archive.project.storyboard, ...(archive.project.history || []).map((item) => item.storyboard)]) for (const item of board?.referencePlan || []) if (!assetIds.has(item.id)) assetIds.set(item.id, makeId());
      for (const ref of archive.project.screenplay?.inventory?.references || []) if (!assetIds.has(ref.id)) assetIds.set(ref.id, makeId());
      const importedForm = { ...DEFAULT_FORM, ...archive.project.form, referenceImages: [] };
      const previousWorkflow = archive.project.screenplay;
      const importedWorkflow = previousWorkflow ? structuredClone(previousWorkflow) : undefined;
      if (importedWorkflow?.inventory) {
        importedWorkflow.inventory.references = importedWorkflow.inventory.references.map(ref => ({ ...ref, id: assetIds.get(ref.id)! }));
        importedWorkflow.inventory.scenes = importedWorkflow.inventory.scenes.map(scene => ({ ...scene, referenceIds: scene.referenceIds.map(id => assetIds.get(id)!) }));
        if (previousWorkflow && inventoryApproved(previousWorkflow, importedForm)) importedWorkflow.approvedInventory = inventorySource(importedWorkflow, importedForm);
      }
      const remapBoard = (board: Storyboard | null): Storyboard | null => board ? { ...board, referencePlan: board.referencePlan?.map((item) => ({ ...item, id: assetIds.get(item.id)! })), scenes: board.scenes.map((scene) => ({ ...scene, assetIds: scene.assetIds?.map((id) => assetIds.get(id)!) })) } : null;
      const remappedStoryboard = remapBoard(archive.project.storyboard);
      if (remappedStoryboard && importedWorkflow && pipelineCurrent(previousWorkflow, importedForm, archive.project.storyboard)) {
        remappedStoryboard.pipelineSource = inventorySource(importedWorkflow, importedForm);
        remappedStoryboard.englishJson = undefined; remappedStoryboard.englishSource = undefined;
      }
      const project = { ...archive.project, screenplay: importedWorkflow, id: newId, storyboard: remappedStoryboard, history: archive.project.history?.map((version) => ({ ...version, storyboard: remapBoard(version.storyboard)! })) };
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
    if (!form.topic.trim() && !screenplay && !concepts.length && !storyboard && !history.length && !form.referenceImages.length) return;
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
      setConcepts(project.concepts); setSelectedConceptId(project.selectedConceptId); setStoryboard(project.storyboard); setScreenplay(project.screenplay);
      setStep(project.storyboard ? "storyboard" : (project.screenplay || project.concepts.length) ? "concepts" : "brief");
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
      setForm(DEFAULT_FORM); setScreenplay(undefined); setExistingScreenplayDraft(""); setExistingScreenplayTitle(""); setConcepts([]); setSelectedConceptId(""); setStoryboard(null);
      setStep("brief"); setNotice("Ready for a new topic. Your previous draft is saved in My projects."); setShowAdvanced(false);
    } catch (caught) {
      setError("Could not save your draft. Your current work is still open. " + (caught instanceof Error ? caught.message : "Export a ZIP backup."));
    } finally { setHydrated(true); }
  };

  const boardForExport = (): Storyboard => ({ ...storyboard!, scenes: storyboard!.scenes.map((scene) => ({ ...scene, flowPrompt: promptWithReferences({ ...scene, flowPrompt: sceneVideoPrompt(scene, storyboard!) }, projectAssets), referenceAssets: [...scene.referenceAssets, ...sceneReferences(scene, projectAssets).map((asset) => assetHandle(asset) + " = " + asset.title)] })) });
  const exportMarkdown = () => {
    if (!storyboard) { setError("Generate a storyboard before exporting."); return; }
    downloadText(fileSlug(storyboard.projectTitle) + ".md", storyboardMarkdown(form, selectedConcept, boardForExport()), "text/markdown;charset=utf-8");
    setNotice("Markdown storyboard downloaded.");
  };
  const exportPromptPack = () => {
    if (!storyboard) { setError("Generate a storyboard before exporting."); return; }
    const pack = completePromptText(storyboard, form);
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

  const checkGeminiModelAvailability = async () => {
    const key = apiKeyDraft.trim();
    if (!key || modelListKey !== key || !modelOptions.length || loadingModels || checkingModels) return;
    setCheckingModels(true);
    setModelChecks([]);
    setModelCheckProgress(0);
    setGeminiTestResult(null);
    const results: GeminiModelCheck[] = [];
    try {
      // Test one model at a time to reduce burst requests on Free-tier accounts.
      for (const option of modelOptions) {
        const probe = await probeGeminiModel(key, option.id);
        const result = { ...probe, displayName: option.displayName };
        results.push(result);
        setModelChecks([...results]);
        setModelCheckProgress(results.length);
        // Stop making requests when the supplied key is rejected.
        if (result.status === "key-error") {
          for (const remaining of modelOptions.slice(results.length)) {
            results.push({
              modelId: remaining.id,
              displayName: remaining.displayName,
              status: "error",
              message: "Skipped because the API key was rejected during an earlier test.",
              durationMs: 0,
            });
          }
          setModelChecks([...results]);
          setModelCheckProgress(results.length);
          break;
        }
      }

      const selectedWorks = results.some((item) => item.modelId === modelDraft && item.status === "ready");
      const recommended = results.find((item) => item.status === "ready" && /flash/i.test(item.modelId) && !/(preview|experimental|exp)/i.test(item.modelId))
        || results.find((item) => item.status === "ready" && /flash/i.test(item.modelId))
        || results.find((item) => item.status === "ready");

      if (!selectedWorks && recommended) {
        setModelDraft(recommended.modelId);
        setGeminiTestResult({ ok: true, message: "Best working model selected: " + recommended.displayName + ". Press Save settings to apply it." });
      } else if (selectedWorks) {
        setGeminiTestResult({ ok: true, message: "Your selected model passed the live generation test." });
      } else {
        setGeminiTestResult({ ok: false, message: "No model passed the live test. Check the key, quota and model access, then try again later." });
      }
    } catch (caught) {
      setGeminiTestResult({ ok: false, message: caught instanceof Error ? caught.message : "Could not check Gemini models." });
    } finally {
      setCheckingModels(false);
    }
  };

  const persistApiKey = (value: string): boolean => {
    const key = value.trim();
    if (!key) return false; // Clearing the input is not a request to remove the saved key.
    try {
      localStorage.setItem(STORAGE.key, key);
      setApiKey(key);
      return true;
    } catch {
      setGeminiTestResult({ ok: false, message: "API key could not be saved in this browser. Browser storage may be full or blocked. Keep this window open and enable browser storage before retrying." });
      return false;
    }
  };
  const removeApiKey = () => {
    try {
      localStorage.removeItem(STORAGE.key);
      setApiKeyDraft(""); setApiKey(""); setGeminiTestResult(null); setSettingsOpen(false);
      setNotice("API key removed from this browser.");
    } catch { setGeminiTestResult({ ok: false, message: "Could not remove the saved key. Check browser storage settings and retry." }); }
  };
  const saveApiSettings = () => {
    if (!persistApiKey(apiKeyDraft)) return;
    try {
      // Model discovery must not prevent saving a key, including when offline.
      if (validModelSelection) {
        localStorage.setItem(STORAGE.model, modelDraft);
        setGeminiModel(modelDraft);
      }
      setSettingsOpen(false); setGeminiTestResult(null);
      setNotice("API key saved in this browser. Use the same website address and browser to keep it after refresh.");
    } catch { setGeminiTestResult({ ok: false, message: "API key saved, but the model setting could not be saved. Please retry." }); }
  };

  return (
    <div className="atelier-app">
      <main className="atelier-stage">
        <header className="atelier-topbar">
          <div className="atelier-brand"><span className="atelier-brand-symbol"><Clapperboard size={22}/></span><span><strong>MM STORYBOARD</strong><small>CREATIVE STUDIO</small></span></div>
          <div className="atelier-top-tools">
            <span className={apiKey ? "atelier-status online" : "atelier-status"}><span className="atelier-status-light"/>{apiKey ? "GEMINI READY" : "AI NOT CONNECTED"}</span>
            <button className="atelier-save" disabled={Boolean(busy) || !hydrated || !mediaReady} onClick={() => void saveProject()}><Save size={15}/> Save project</button>
            <details className="topbar-more"><summary className="atelier-more-trigger" aria-label="More options"><MoreHorizontal size={20}/></summary>
              <div className="topbar-more-menu">
                <button className="quiet-button" disabled={Boolean(busy) || !hydrated} onClick={() => void exportZip()}><Download size={15}/> Backup ZIP</button>
                <label className="quiet-button archive-upload"><Upload size={15}/> Import ZIP<input type="file" accept=".zip" disabled={Boolean(busy) || !hydrated} onChange={(event) => {void importZip(event.target.files?.[0]);event.currentTarget.value = "";}}/></label>
                <button className="secondary-button" onClick={() => setLibraryOpen(true)}><FolderOpen size={15}/> My projects</button>
                <button className="settings-button" onClick={() => {setApiKeyDraft(apiKey);setSettingsOpen(true);}}><Settings size={15}/> Settings</button>
                {showAdvanced && <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={() => setAssetStudioOpen(true)}><Wand2 size={15}/> Asset studio</button>}
              </div>
            </details>
          </div>
        </header>
        <div className="atelier-shell">
          <div className="atelier-overview">
            <div className="atelier-overview-main"><span className="atelier-eyebrow"><span/> YOUR FILMMAKING WORKSPACE</span>
              <h1>{storyboard?.projectTitle || form.topic || "Create something cinematic."}</h1>
              <p>{step === "brief" ? "Plan your film and set its visual direction." : step === "concepts" ? "Choose a concept. Refine the script. Approve the references." : step === "storyboard" ? "See the story, one frame at a time." : "Prepare your shots for Google Flow."}</p>
            </div>
            <div className="atelier-project-metrics"><span><Film size={14}/>{storyboard?.scenes.length || 0} scenes</span><span><Clock3 size={14}/>{form.targetDuration}s</span><span><MonitorPlay size={14}/>{form.aspectRatio}</span></div>
          </div>
          <nav className="atelier-workspace-tabs" aria-label="Production stages">
            <button type="button" className={step==="brief"?"active":""} onClick={()=>navigateStudio("brief")}><FileText size={16}/> Video brief</button>
            <button type="button" className={step==="concepts"?"active":""} disabled={!screenplay && !concepts.length} onClick={()=>navigateStudio("concepts")}><Lightbulb size={16}/> Screenplay / refs</button>
            <button type="button" className={step==="storyboard"?"active":""} disabled={!storyboard} onClick={()=>navigateStudio("storyboard")}><Clapperboard size={16}/> Storyboard</button>
            <button type="button" className={step==="shots"?"active":""} disabled={!storyboard} onClick={()=>navigateStudio("shots")}><Film size={16}/> Flow shots</button>
          </nav>
          <div className="atelier-utility-bar">
            <div className="atelier-utility-stage"><span className="atelier-utility-index">{step === "brief" ? "01" : step === "concepts" ? "02" : step === "storyboard" ? "03" : "04"}</span>
              <span>{step === "brief" ? "Video planning" : step === "concepts" ? "Script & characters" : step === "storyboard" ? "Visual storyboard" : "Shot production"}</span>
            </div>
            <div className="atelier-utility-actions">
              <button onClick={()=>{setAssetStudioOpen(true);setMobileNavOpen(false);}}><Wand2 size={15}/> Asset library</button>
              <button onClick={()=>{setLibraryOpen(true);setMobileNavOpen(false);}}><FolderOpen size={15}/> My projects</button>
              <button disabled={!storyboard} onClick={()=>exportPromptPack()}><Download size={15}/> Export</button>
              <button onClick={()=>{setApiKeyDraft(apiKey);setSettingsOpen(true);}}><Settings size={15}/> Settings</button>
              <button onClick={newProject} disabled={Boolean(busy)||!hydrated}><Plus size={15}/> New project</button>
            </div>
          </div>
          <div className="atelier-workspace-content">
          {error && <div className="alert error-alert" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
          {notice && <div className="alert success-alert" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

          {step === "brief" && <section className="panel brief-panel">
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
                <button className="primary-button generate-button" onClick={() => void generateScreenplays()} disabled={Boolean(busy) || !hydrated}><Sparkles size={17} />{busy === "screenplays" ? "ဇာတ်ညွှန်းရေးနေပါတယ်…" : "မြန်မာဇာတ်ညွှန်း ၃ မျိုးရေးပေး"}</button>
              </div>
            </div>
          </section>}

          {step === "brief" && <details className="panel existing-screenplay-panel">
            <summary className="section-heading existing-screenplay-summary">
              <div className="section-icon purple"><FileText size={18} /></div>
              <div><h2>Screenplay ရေးပြီးသားရှိလား?</h2><p>ရှိပြီးသားစာသားကို အသုံးပြုချင်ရင် ဒီနေရာကိုဖွင့်ပါ။</p></div>
              <div className="panel-kicker">OPTIONAL · EXPAND</div>
            </summary>
            <div className="form-content">
              <Field label="Screenplay ခေါင်းစဉ် (optional)"><input className="input" maxLength={120} value={existingScreenplayTitle} onChange={(event) => setExistingScreenplayTitle(event.target.value)} placeholder="ဥပမာ — ကိုမင်းမင်း၏ ဇာတ်လမ်း" /></Field>
              <Field label="ရှိပြီးသား screenplay ကို ဒီမှာ paste လုပ်ပါ" hint="Scene heading ဥပမာ — ၁။ INT. GAMING ROOM - DAY သို့မဟုတ် INT. GAMING ROOM - DAY။ Scene အရေအတွက်ကို မူရင်းအတိုင်း ထိန်းထားပါမယ်။">
                <textarea className="input topic-input" aria-label="ရှိပြီးသား screenplay ကို ဒီမှာ paste လုပ်ပါ" rows={12} maxLength={100000} value={existingScreenplayDraft} onChange={(event) => setExistingScreenplayDraft(event.target.value)} placeholder={"၁။ INT. ROOM - DAY\nဇာတ်ကောင်က ...\n\n၂။ EXT. STREET - DAY\nဇာတ်ကောင်က ..."} />
              </Field>
              <div className="workflow-toolbar">
                <label className="upload-button"><Upload size={15} /> TXT / MD ဖိုင်တင်မယ်<input type="file" accept=".txt,.md,.fountain,text/plain,text/markdown" disabled={Boolean(busy) || !hydrated} onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  if (file.size > 500000) { setError("Screenplay ဖိုင်က 500 KB ထက်ကြီးနေပါတယ်။ ပိုတိုသော TXT / MD ဖိုင်ကို သုံးပါ။"); return; }
                  void file.text().then((content) => {
                    if (content.length > 100000) throw new Error("Screenplay စာသားက 100,000 characters ထက်ကျော်နေပါတယ်။");
                    setExistingScreenplayDraft(normalizeExistingScreenplay(content));
                    setExistingScreenplayTitle((current) => current.trim() ? current : file.name.replace(/\.[^.]+$/, ""));
                    setError(""); setNotice("Screenplay ဖိုင်ကို ဖတ်ပြီးပါပြီ။ Scene များကို စစ်ပြီး ဆက်လုပ်ပါ။");
                  }).catch((caught) => setError(caught instanceof Error ? caught.message : "Screenplay ဖိုင်ကို ဖတ်မရပါ။"));
                }} /></label>
                <span className="field-hint">{screenplaySceneCount(normalizeExistingScreenplay(existingScreenplayDraft))} scenes တွေ့ထားသည်။ Text ဖိုင်သည် သင့် browser ထဲမှာပဲ ဖတ်ပြီးသိမ်းဆည်းပါမယ်။</span>
                <button className="primary-button" disabled={Boolean(busy) || !hydrated || !existingScreenplayDraft.trim()} onClick={() => void startFromExistingScreenplay()}><ChevronRight size={16} />ရှိပြီးသား Screenplay မှ ဆက်လုပ်မယ်</button>
              </div>
            </div>
          </details>}

          {!screenplay && concepts.length > 0 && (step === "concepts" || step === "storyboard") && <section className="results-section">
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

          {screenplay && step === "concepts" && <ScreenplayStudio value={screenplay} form={form} board={storyboard} projectId={projectId} assets={projectAssets} busy={Boolean(busy) || !hydrated} apiKey={apiKey.trim()} model={geminiModel} requireKey={requireKey} onChange={setScreenplay} onBoard={(next) => { remember("Before approved scene generation"); setStoryboard(next); setStep("storyboard"); }} onBusy={setBusy} onError={setError} />}
          {!storyboard && history.length > 0 && <div className="workflow-toolbar"><label className="field"><span className="field-label">Previous storyboard versions</span><select className="input" value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">Choose a version…</option>{history.map((version) => <option key={version.id} value={version.id}>{version.label} · {new Date(version.createdAt).toLocaleString()}</option>)}</select></label><button className="secondary-button" disabled={!versionId || Boolean(busy)} onClick={restoreVersion}>Restore version</button></div>}
          {pipelineCurrent(screenplay, form, storyboard) && storyboard?.promptLanguage === "my" && step === "storyboard" && <BurmeseDraftEditor referencesLocked={Boolean(screenplay)} board={storyboard} form={form} busy={Boolean(busy) || !hydrated} onChange={setStoryboard} onTranslate={() => void translateDraft()} onSave={() => void saveProject()} onRetryReferences={() => void retryReferences()} />}
          {pipelineCurrent(screenplay, form, storyboard) && storyboard && storyboard.promptLanguage !== "my" && step === "storyboard" && <section className="storyboard-section">
            <div className="section-heading results-heading">
              <div className="section-icon green"><Clapperboard size={18} /></div>
              <div><h2>Your storyboard</h2><p>Edit the prompts and narration before moving each clip into Google Flow.</p></div>
              <div className="storyboard-actions"><button className="quiet-button" onClick={() => setStep("shots")}><Film size={15} /> Shot breakdown</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void makeBurmeseDraft()}>မြန်မာမူကြမ်းအဖြစ်ပြောင်းရန်</button><button className="quiet-button" onClick={saveProject}><Save size={15} /> Save</button><button className="quiet-button" onClick={exportPromptPack}><Download size={15} /> Flow .txt</button><button className="quiet-button" onClick={exportJson}><Download size={15} /> JSON</button><button className="primary-button small-primary" onClick={exportMarkdown}><Download size={15} /> Export .md</button></div>
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
            <details className="workspace-advanced optional-integration"><summary>Optional integration · ComfyUI workflow</summary><ComfyUIStudio key={projectId} onBusyChange={onComfyBusy} scenes={boardForExport().scenes} storyboard={storyboard} /></details>
            {compatibility && <div className="compatibility-note"><AlertCircle size={16} /><span>{compatibility}</span></div>}
            <div className="audit-panel">
              <div className="audit-heading"><div><strong><CheckCircle2 size={16} /> Pre-generation check</strong><span>Quick automated checks before you spend Flow credits.</span></div><span className={auditCount === 0 && allAudits.every((item) => item.ok) ? "audit-status pass" : "audit-status warn"}>{auditCount === 0 && allAudits.every((item) => item.ok) ? "LOOKS GOOD" : auditCount + " SCENE FLAGS"}</span></div>
              <div className="audit-grid">{allAudits.map((item) => <div className="audit-item" key={item.label}><span className={item.ok ? "audit-check ok" : "audit-check issue"}>{item.ok ? <Check size={12} /> : <AlertCircle size={12} />}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div>
              <p className="audit-disclaimer">Automated checks cannot guarantee visual continuity or that Flow will support every selected setting. Review each scene and the active model options.</p>
            </div>
            <details className="field"><summary>Flow လုပ်ဆောင်ရန် လမ်းညွှန် · ၆ ဆင့်</summary><p style={{ whiteSpace: "pre-line" }}>{workflowGuideMM()}</p></details>
            <details className="workspace-advanced">
              <summary>Advanced tools, reusable references & version history</summary>
            <div className="workflow-toolbar">
              <button className="primary-button" disabled={Boolean(busy) || !hydrated} onClick={() => void retryReferences()}>Prepare / recheck character & background prompts</button>
              <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void downloadFlowScenes()}>Download complete prompt ZIP</button>
              <span className="field-hint">1. Create reusable references in Flow. 2. Follow each scene card to create its opening image if needed. 3. Use its video prompt. No images are required to download this package.</span>
              {Boolean(storyboard.referencePlan?.length) && <button className="secondary-button" onClick={() => { downloadText(fileSlug(storyboard.projectTitle) + "-reference-prompts.txt", referencePromptPack(storyboard, form), "text/plain;charset=utf-8"); }}>Download reference prompts</button>}
              {(["character", "background", "prop"] as const).map((kind) => <section key={kind} style={{ width: "100%" }} aria-label={kind + " prompts"}>
                <h3>{kind === "character" ? "Character prompts · ဇာတ်ကောင်ပုံထုတ်ရန်" : kind === "background" ? "Background prompts" : "Prop / product prompts"} ({storyboard.referencePlan?.filter((item) => item.kind === kind).length || 0})</h3>
                {kind !== "prop" && <p className="field-hint">{kind === "character" ? "16:9 reference sheet · 4 body views + 4 expressions · name label" : "16:9 reference sheet · A front / B right / C back / D left"}. Style: {form.visualStyle}. Copy this prompt into Flow to create the sheet.</p>}
                {!storyboard.referencePlan?.some((item) => item.kind === kind) && <p className="field-hint">{busy === "assets" ? "Preparing reference prompts…" : kind === "character" ? "Character prompt မရှိသေးပါ။ Scene ထဲမှာ ဇာတ်ကောင်ပါလျှင် အပေါ်က Prepare / recheck ခလုတ်ကိုနှိပ်ပါ။ ဇာတ်ကောင်မပါတဲ့ video အတွက် မလိုပါ။" : "No prompts prepared for this reference type."}</p>}
                {storyboard.referencePlan?.filter((item) => item.kind === kind).map((item) => <details key={item.id} className="field" open={item.kind === "character"}><summary>{referenceCode(item, storyboard)} · {item.kind}: {item.title} · {projectAssets.some((asset) => asset.id === item.id) ? "Image ready" : "Prompt ready"}</summary><span>Use in scenes: {storyboard.scenes.filter((scene) => item.sceneIds.includes(scene.id)).map((scene) => scene.sceneNumber).join(", ")}</span><textarea className="input" aria-label={"Reference image prompt: " + item.title} readOnly rows={6} value={referenceImagePrompt(item, form)} /><button className="secondary-button" onClick={() => void copyText(referenceImagePrompt(item, form), item.title + " image prompt")}><Copy size={14} /> Copy image prompt</button></details>)}
              </section>)}
              {assetProgress && <span role="status">{assetProgress}</span>}
              <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={() => { remember("Saved version"); setNotice("Version saved in history."); }}><History size={15} /> Save version</button>
              <select className="input" aria-label="Storyboard version" value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">Choose an earlier version…</option>{history.map((version) => <option value={version.id} key={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.label}</option>)}</select>
              <button className="secondary-button" disabled={!versionId || Boolean(busy)} onClick={restoreVersion}>Restore version</button>
              <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={addScene}><Plus size={14} /> Add scene</button>
              <button className="secondary-button" disabled={Boolean(busy) || !storyboard.scenes.some((scene) => !scene.locked)} onClick={() => void regenerateScenes(storyboard.scenes.filter((scene) => !scene.locked).map((scene) => scene.id))}>Improve all unlocked prompts</button>
              <button className="quiet-button" onClick={() => setSelectedSceneIds(storyboard.scenes.filter((scene) => !scene.locked).map((scene) => scene.id))}>Select unlocked</button>
              <button className="quiet-button" onClick={() => setSelectedSceneIds([])}>Clear</button>
              <button className="secondary-button" disabled={Boolean(busy) || !selectedSceneIds.length} onClick={() => void regenerateScenes(selectedSceneIds)}>Regenerate selected prompts</button>
              <button className="secondary-button" disabled={Boolean(busy) || !storyboard.scenes.some((scene) => !scene.locked && !scene.flowPrompt.trim())} onClick={() => void regenerateScenes(storyboard.scenes.filter((scene) => !scene.flowPrompt.trim()).map((scene) => scene.id))}>Generate missing prompts</button>
            </div>
            </details>
            <div className="studio-sequence-header">
              <div><span className="studio-sequence-kicker">VISUAL STORYBOARD</span><h3>Scene sequence</h3><p>Select a frame to inspect its creative direction. Edit prompts only when you need to.</p></div>
              <button className="primary-button" onClick={() => setAssetStudioOpen(true)}><Wand2 size={16}/> Generate scene images</button>
            </div>
            <div className="studio-sequence-strip" aria-label="Storyboard scene timeline">
              {storyboard.scenes.map((scene) => {
                const preview = projectAssets.find((asset) => asset.kind === "scene" && asset.sceneId === scene.id);
                return <button type="button" key={scene.id} aria-label={"Select storyboard scene " + scene.sceneNumber} className={inspectorScene?.id === scene.id ? "studio-sequence-item selected" : "studio-sequence-item"} onClick={() => setInspectorSceneId(scene.id)}>
                  <span className="studio-sequence-thumb">{preview ? <img src={"data:" + preview.mimeType + ";base64," + preview.data} alt="" loading="lazy"/> : <Clapperboard size={19}/>}</span>
                  <span className="studio-sequence-item-label">{String(scene.sceneNumber).padStart(2,"0")} · {scene.durationSeconds}s</span>
                </button>;
              })}
            </div>
            <div className="studio-storyboard-workspace v2-storyboard-workspace"><div className="scene-list">
              {storyboard.scenes.filter((scene) => scene.id === (inspectorScene?.id || storyboard.scenes[0]?.id)).map((scene) => {
                const sceneAudit = auditScene(scene);
                const flags = sceneAudit.filter((item) => !item.ok).length;
                const preview = projectAssets.find((asset) => asset.kind === "scene" && asset.sceneId === scene.id);
                return <article id={"studio-scene-" + scene.id} className={inspectorScene?.id === scene.id ? "scene-card studio-scene-selected" : "scene-card"} key={scene.id}>
                  <div className="studio-scene-cover" onClick={() => setInspectorSceneId(scene.id)}>
                    {preview ? <img src={"data:" + preview.mimeType + ";base64," + preview.data} alt={"Generated scene " + scene.sceneNumber} loading="lazy" /> : <div className="studio-scene-placeholder"><Clapperboard size={29}/><strong>Scene {String(scene.sceneNumber).padStart(2,"0")} · Visual not generated</strong><span>Generate this scene's opening frame in Asset Studio.</span></div>}
                    <span className="studio-scene-cover-count">SCENE {String(scene.sceneNumber).padStart(2,"0")}</span>
                  </div>
                  <div className="scene-card-head"><button type="button" className="studio-inspect-trigger" onClick={() => setInspectorSceneId(scene.id)} aria-label={"Inspect scene " + scene.sceneNumber}>Inspect <ChevronRight size={13}/></button>
                    <input type="checkbox" aria-label={"Select scene " + scene.sceneNumber} disabled={scene.locked || Boolean(busy) || !hydrated} checked={selectedSceneIds.includes(scene.id)} onChange={(event) => setSelectedSceneIds((ids) => event.target.checked ? [...ids, scene.id] : ids.filter((id) => id !== scene.id))} /><div className="scene-number">{String(scene.sceneNumber).padStart(2, "0")}</div>
                    <div className="scene-title-area"><input className="scene-title-input" disabled={scene.locked || Boolean(busy) || !hydrated} value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} aria-label="Scene title" /><div className="scene-tags"><span><Clock3 size={12} /> {scene.durationSeconds}s clip</span><span><Film size={12} /> {scene.shotSize || "Shot plan"}</span><span className={flags ? "quality-tag warn" : "quality-tag"}>{flags ? flags + " checks to review" : "Prompt checked"}</span></div></div>
                    <button className="icon-button" onClick={() => void copyText(promptWithReferences({ ...scene, flowPrompt: sceneVideoPrompt(scene, storyboard!) }, projectAssets), "Scene " + scene.sceneNumber + " prompt")} title="Copy Flow prompt">{copied === "Scene " + scene.sceneNumber + " prompt" ? <Check size={16} /> : <Copy size={16} />}</button>
                    <button className="icon-button" onClick={() => void regenerateScenes([scene.id])} disabled={Boolean(busy) || scene.locked} title="Regenerate scene"><RefreshCw className={busy === scene.id ? "spinning" : ""} size={16} /></button>
                  </div>
                  <div className="scene-controls">
                    <button className="secondary-button" disabled={Boolean(busy) || !hydrated} onClick={() => toggleLock(scene)}>{scene.locked ? <Lock size={14} /> : <Unlock size={14} />}{scene.locked ? "Locked · unlock" : "Lock scene"}</button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.sceneNumber === 1} aria-label={"Move scene " + scene.sceneNumber + " up"} onClick={() => moveScene(scene, -1)}><ArrowUp size={15} /></button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.sceneNumber === storyboard.scenes.length} aria-label={"Move scene " + scene.sceneNumber + " down"} onClick={() => moveScene(scene, 1)}><ArrowDown size={15} /></button>
                    <button className="quiet-button" disabled={Boolean(busy) || scene.locked} aria-label={"Delete scene " + scene.sceneNumber} onClick={() => removeScene(scene)}><Trash2 size={15} /></button>
                    <select className="input" aria-label={"Review status scene " + scene.sceneNumber} disabled={scene.locked || Boolean(busy) || !hydrated} value={scene.reviewStatus || "draft"} onChange={(event) => updateScene(scene.id, { reviewStatus: event.target.value as Scene["reviewStatus"], locked: event.target.value === "approved" })}><option value="draft">Draft</option><option value="review">Needs review</option><option value="approved">Approved · lock</option></select>
                  </div>
                  <details className="scene-editor-details"><summary>Advanced scene editor · References, audio & Flow prompts</summary><fieldset className="scene-content scene-fieldset" disabled={scene.locked || Boolean(busy) || !hydrated}>
                    <Field label="Review notes"><input className="input" value={scene.reviewNotes || ""} onChange={(event) => updateScene(scene.id, { reviewNotes: event.target.value })} placeholder="Keep feedback with this scene…" /></Field>
                    <div className="scene-reference-picker"><strong>Character & location references</strong><label><input type="checkbox" checked={scene.assetIds === undefined} onChange={(event) => updateScene(scene.id, { assetIds: event.target.checked ? undefined : [] })} /> Use project reference set</label>{castAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={sceneReferences(scene, projectAssets).some((item) => item.id === asset.id)} onChange={(event) => { const ids = sceneReferences(scene, projectAssets).map((item) => item.id); if (event.target.checked && ids.length >= 4) { setError("A scene can use up to four reference assets."); return; } updateScene(scene.id, { assetIds: event.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id) }); }} /><img src={assetAsReference(asset).previewUrl} alt="" />{asset.title}</label>)}{!castAssets.length && <span>Add a character or location in Asset Studio to reuse it here.</span>}</div>
                    <div className="scene-visual-details"><div className="scene-detail"><span>SCENE PURPOSE</span><p>{scene.objective}</p></div><div className="scene-detail"><span>VISUAL ACTION</span><p>{scene.visualDescription}</p></div><div className="scene-detail two-detail"><div><span>CAMERA</span><p>{scene.cameraMovement}</p></div><div><span>LIGHT / MOOD</span><p>{scene.lighting} · {scene.mood}</p></div></div><div className="scene-detail"><span>ACTION BEAT</span><p>{scene.action}</p></div></div>
                    <div className="field"><strong>Flow steps · References: {sceneReferenceList(scene, storyboard)}</strong><p style={{ whiteSpace: "pre-line" }}>{sceneInstructions(scene, storyboard)}</p></div>
                    <Field label={"Generation route scene " + scene.sceneNumber}><select className="input" value={scenePreparationMode(scene, storyboard)} onChange={(event) => updateScene(scene.id, { preparationMode: event.target.value as Scene["preparationMode"] })}><option value="image-to-video">Create opening image, then animate</option><option value="text-to-video">Direct text to video (image optional)</option></select></Field>
                    <Field label={"Background angle scene " + scene.sceneNumber}><select className="input" value={scene.backgroundAngle || "A"} onChange={(event) => updateScene(scene.id, { backgroundAngle: event.target.value as Scene["backgroundAngle"] })}><option value="A">A · ရှေ့</option><option value="B">B · ညာဘက်</option><option value="C">C · နောက်ဘက်</option><option value="D">D · ဘယ်ဘက်</option></select><span>{sceneBackground(scene, storyboard)}</span><span className="field-hint">Angle ပြောင်းပြီးလျှင် video prompt ထဲက ပထမ camera angle ကိုလည်း ကိုက်ညီအောင် ပြင်ပါ။</span></Field>
                    <Field label={"Next scene connection " + scene.sceneNumber}><select className="input" value={scene.handoff} onChange={(event) => updateScene(scene.id, { handoff: event.target.value as Scene["handoff"] })}><option value="CUT">Cut · နောက် scene သီးသန့်စမယ်</option><option value="CONTINUATION">Continue · နောက်ဆုံး frame မှ ဆက်မယ်</option></select></Field>
                    <Field label={"Scene image prompt " + scene.sceneNumber} hint="Use for the opening still in Flow. Attach the reference images listed above."><textarea className="input" readOnly rows={6} value={sceneImagePrompt(scene, storyboard, form)} /></Field>
                    <button className="secondary-button" onClick={() => void copyText(sceneImagePrompt(scene, storyboard, form), "Scene " + scene.sceneNumber + " image prompt")}>Copy scene image prompt</button>
                    <Field label="Google Flow prompt" hint="English prompt for the selected model. Copy this into Flow, then review its active settings."><textarea className="input prompt-editor" value={scene.flowPrompt} onChange={(event) => updateScene(scene.id, { flowPrompt: event.target.value })} rows={8} /></Field>
                    <details className="field"><summary>Complete Flow prompt · Copy လုပ်လျှင်ရမည့် prompt အပြည့်အစုံ</summary><textarea className="input" readOnly rows={14} aria-label={"Complete Flow prompt " + scene.sceneNumber} value={promptWithReferences({ ...scene, flowPrompt: sceneVideoPrompt(scene, storyboard) }, projectAssets)} /></details>
                    <div className="scene-edit-grid">
                      <Field label="SFX"><textarea className="input" value={scene.sfx ?? ""} onChange={(event) => updateScene(scene.id, { sfx: event.target.value })} rows={2} placeholder="အသံအကျိုးသက်ရောက်မှု" /></Field>
                      <Field label="Background music"><textarea className="input" value={scene.backgroundMusic ?? ""} onChange={(event) => updateScene(scene.id, { backgroundMusic: event.target.value })} rows={2} placeholder="နောက်ခံတေးဂီတ" /></Field>
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
                    <div className="scene-card-foot"><span><Volume2 size={14} /> {scene.audioNotes || form.audioPolicy}</span><button className="copy-prompt-link" onClick={() => void copyText(promptWithReferences({ ...scene, flowPrompt: sceneVideoPrompt(scene, storyboard!) }, projectAssets), "Scene " + scene.sceneNumber + " prompt")}>{copied === "Scene " + scene.sceneNumber + " prompt" ? <Check size={14} /> : <Copy size={14} />} {copied === "Scene " + scene.sceneNumber + " prompt" ? "Copied" : "Copy Flow prompt"}</button></div>
                  </fieldset></details>
                </article>;
              })}
            </div>
            <aside className="studio-inspector" aria-label="Scene inspector">
              <div className="studio-inspector-heading"><span>SCENE INSPECTOR</span><span className="studio-inspector-dot" /></div>
              {inspectorScene && storyboard && <>
                <div className="studio-inspector-title"><span>SCENE {String(inspectorScene.sceneNumber).padStart(2,"0")}</span><h3>{inspectorScene.title}</h3></div>
                <div className="studio-inspector-statgrid"><span><Clock3 size={13}/> {inspectorScene.durationSeconds}s</span><span><Film size={13}/> {inspectorScene.shotSize || "Shot"}</span></div>
                <div className="studio-inspector-section"><strong>OPENING FRAME</strong><p>{inspectorScene.openingFrame}</p></div>
                <div className="studio-inspector-section"><strong>ACTION</strong><p>{inspectorScene.action}</p></div>
                <div className="studio-inspector-section"><strong>CAMERA / LIGHT</strong><p>{inspectorScene.cameraMovement} · {inspectorScene.lighting}</p></div>
                <div className="studio-inspector-section"><strong>REFERENCES</strong><p>{sceneReferenceList(inspectorScene,storyboard)}</p></div>
                <div className="studio-inspector-section"><strong>QUALITY</strong><p>{auditScene(inspectorScene).filter(item=>!item.ok).length} flagged checks</p></div>
                <button className="primary-button full-width" onClick={() => void copyText(sceneVideoPrompt(inspectorScene,storyboard), "Inspector prompt")}><Copy size={15}/> {copied === "Inspector prompt" ? "Copied" : "Copy Flow prompt"}</button>
                <button className="secondary-button full-width" onClick={() => setAssetStudioOpen(true)}><Wand2 size={15}/> Asset studio</button>
              </>}
            </aside></div>
            <div className="studio-next-step">
              <div><span className="studio-sequence-kicker">NEXT PRODUCTION STEP</span><strong>Review your frames before generating video</strong><p>Make sure characters and props look consistent, then prepare the Flow shot prompts.</p></div>
              <button className="primary-button" onClick={() => setStep("shots")}><Film size={16}/> Go to Flow shots <ChevronRight size={15}/></button>
            </div>
            <div className="end-actions"><button className="secondary-button" onClick={() => setStep("concepts")}><ArrowLeft size={16} /> Change concept</button><button className="quiet-button" onClick={() => void copyText(completePromptText(storyboard, form), "Complete prompt package")}><Copy size={15} /> Copy all prompts</button><button className="primary-button" onClick={exportMarkdown}><Download size={16} /> Export complete storyboard <ChevronRight size={16} /></button></div>
          </section>}

          {storyboard && step === "shots" && pipelineCurrent(screenplay, form, storyboard) && <ShotBreakdownStudio board={storyboard} form={form} assets={projectAssets} apiKey={apiKey.trim()} model={geminiModel.trim() || GEMINI_DEFAULT} busy={Boolean(busy) || !hydrated} requireKey={requireKey} onChange={setStoryboard} onBusy={setBusy} onError={setError} onDownloadZip={() => void downloadFlowScenes()} onSave={() => void saveProject()} />}

          <footer className="page-footer"><span>MM Storyboard Studio</span><span>Prompt generation only · Videos are created separately in Google Flow</span><button onClick={() => { setApiKeyDraft(apiKey); setSettingsOpen(true); }}>API & privacy settings</button></footer>
        </div>
      </main>

      {assetStudioOpen && <AssetStudio protectedAssetIds={Array.from(new Set([storyboard, ...history.map((item) => item.storyboard), ...savedProjects.flatMap((project) => [project.storyboard, ...(project.history || []).map((item) => item.storyboard)])].flatMap((board) => board?.scenes.flatMap((scene) => scene.assetIds || []) || [])))} projectId={projectId} onAssetsChanged={refreshAssets} open={assetStudioOpen} onClose={() => setAssetStudioOpen(false)} apiKey={apiKey} projectTitle={storyboard?.projectTitle || selectedConcept?.title || form.topic} topic={form.topic} visualStyle={form.visualStyle} aspectRatio={form.aspectRatio} projectReferences={form.referenceImages} storyboard={storyboard} model={geminiModel} />}

      {settingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="modal-top"><div className="modal-icon"><KeyRound size={20} /></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18} /></button></div>
          <h2 id="settings-title">Connect Gemini</h2><p className="modal-description">Your API key writes screenplay choices, polishes your edits, prepares approved scenes and translates prompts only when you request each step.</p>
          <Field label="Gemini API key" hint="Key ထည့်တာနဲ့ ဒီ browser ထဲ အလိုအလျောက်သိမ်းပါတယ်။ Website address သို့မဟုတ် browser ပြောင်းရင် ပြန်ထည့်ရန်လိုပါတယ်။"><input className="input api-key-input" type="password" value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setGeminiTestResult(null); setModelChecks([]); setModelCheckProgress(0); persistApiKey(event.target.value); }} placeholder="Paste your Gemini API key" autoComplete="off" /></Field>
          <Field label="Gemini API model" hint="Choose a text model listed by Google for your key. Quota and generation access depend on your account."><select className="input" value={modelOptions.some((item) => item.id === modelDraft) ? modelDraft : ""} disabled={!modelOptions.length || loadingModels} onChange={(event) => { setModelDraft(event.target.value); setGeminiTestResult(null); }}><option value="" disabled>{loadingModels ? "Loading models…" : "Add a key to load models"}</option>{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.id}</option>)}</select></Field>
          {modelListError && <div role="alert" className="gemini-test-result error">{modelListError}</div>}
          {apiKeyDraft.trim() && apiKeyDraft.trim() === apiKey && <p role="status">API key saved in this browser · Refresh လုပ်ပြီးလည်း ပြန်သုံးနိုင်ပါတယ်။</p>}
          <button className="quiet-button" disabled={!apiKeyDraft.trim() || loadingModels} onClick={() => { setModelChecks([]); setModelCheckProgress(0); setModelRefresh((value) => value + 1); }}><RefreshCw size={15} /> {loadingModels ? "Loading models…" : "Refresh models"}</button>
          <button className="secondary-button model-scan-button" disabled={!apiKeyDraft.trim() || loadingModels || checkingModels || !modelOptions.length || modelListKey !== apiKeyDraft.trim()} onClick={() => void checkGeminiModelAvailability()}><Zap size={15} /> {checkingModels ? "Testing models " + modelCheckProgress + "/" + modelOptions.length + "…" : "Check which models work"}</button>
          <p className="field-hint">Runs one small live generation request per listed model. This may use some Free-tier quota. Results reflect access at the time of the test, not future quota availability.</p>
          {checkingModels && <div className="model-scan-progress" role="status">Testing {modelCheckProgress} of {modelOptions.length} models sequentially to reduce burst requests.</div>}
          {modelChecks.length > 0 && <div className="gemini-model-check-list" aria-label="Gemini model test results">
            {modelChecks.map((item) => <div className={"gemini-model-check-item " + item.status} key={item.modelId}>
              <span className="model-check-icon">{item.status === "ready" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span>
              <div className="model-check-copy"><strong>{item.displayName}</strong><small>{item.modelId}</small><p>{item.message}</p></div>
              <span className="model-check-badge">{item.status === "ready" ? "READY" : item.status === "quota" ? "QUOTA" : item.status === "unavailable" ? "UNAVAILABLE" : item.status === "key-error" ? "KEY ERROR" : "CHECK"}</span>
            </div>)}
          </div>}
          {geminiTestResult && <div className={"gemini-test-result " + (geminiTestResult.ok ? "success" : "error")} role="status"><span>{geminiTestResult.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span><span>{geminiTestResult.message}</span></div>}
          <div className="privacy-note"><AlertCircle size={16} /><span>This is a browser-only development app. The key is sent to Google's Gemini API from your browser and stored locally. For a public deployment, proxy requests through a secured backend.</span></div>
          <div className="modal-actions"><button className="quiet-button" onClick={removeApiKey}>Remove key</button><button className="secondary-button" onClick={() => void testGeminiSettings()} disabled={testingGemini || !validModelSelection}><Zap size={15} /> {testingGemini ? "Testing..." : "Test model"}</button><button className="primary-button" onClick={saveApiSettings} disabled={!apiKeyDraft.trim()}><Check size={16} /> Save settings</button></div>
          <div className="modal-help">Get or manage your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio <ChevronRight size={12} /></a></div>
        </section>
      </div>}

      {libraryOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLibraryOpen(false); }}>
        <section className="modal-card library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title">
          <div className="modal-top"><div className="modal-icon"><FolderOpen size={20} /></div><button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="Close library"><X size={18} /></button></div>
          <h2 id="library-title">Your project library</h2><p className="modal-description">Saved projects, reference images and assets stay in this browser. Use Backup ZIP to move a complete project to another browser.</p>
          {!savedProjects.length ? <div className="empty-library-modal"><FolderOpen size={28} /><strong>No saved projects yet</strong><span>Save your screenplay, reference preparation or storyboard at any step.</span></div> : <div className="library-projects">{savedProjects.map((project) => <div className="library-project" key={project.id}><div className="library-project-icon"><Clapperboard size={18} /></div><button className="library-project-main" disabled={Boolean(busy) || !hydrated} onClick={() => loadProject(project)}><strong>{project.title}</strong><span>{project.storyboard ? project.storyboard.scenes.length + " scenes" : project.screenplay ? project.screenplay.choices.length + " screenplays" : project.concepts.length + " concepts"} · {new Date(project.savedAt).toLocaleString()}</span></button><button className="icon-button danger-icon" onClick={() => setSavedProjects((current) => current.filter((item) => item.id !== project.id))} title="Delete saved project" aria-label="Delete saved project"><Trash2 size={16} /></button></div>)}</div>}
          <div className="modal-actions"><button className="quiet-button" onClick={() => setLibraryOpen(false)}>Close</button><button className="primary-button" onClick={() => { newProject(); setLibraryOpen(false); }}><Plus size={16} /> New project</button></div>
        </section>
      </div>}
    </div>
  );
}
export default App;
