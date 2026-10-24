export type Platform = "TikTok" | "Facebook Reels" | "YouTube Shorts" | "YouTube";
export type Language = "Burmese" | "English" | "Burmese + English";
export type VisualStyle = "Realistic tutorial" | "Cinematic live action" | "3D animation" | "2D motion graphics" | "Presenter-led" | "Fast-paced social video";
export type FlowModel = "Veo 3.1 Fast" | "Veo 3.1 Lite" | "Veo 3.1 Quality" | "Gemini Omni Flash 1.1";
export type GenerationMode = "Text to Video" | "First Frame" | "First and Last Frame" | "References to Video" | "Video Edit" | "Extend";
export type ReferenceImage = { name: string; mimeType: string; data: string; previewUrl: string };
export type VideoForm = {
  topic: string; goal: string; platform: Platform; targetDuration: number; language: Language;
  audience: string; visualStyle: VisualStyle; aspectRatio: "9:16" | "16:9" | "1:1";
  flowModel: FlowModel; generationMode: GenerationMode; clipDuration: number;
  audioPolicy: string; textPolicy: string; referenceNotes: string; referenceImages: ReferenceImage[];
};
export type VideoConcept = {
  id: string; title: string; style: string; hook: string; summary: string; visualDirection: string;
  whyItWorks: string; storyArc: string[]; estimatedDuration: number;
};
export type ShotBreakdown = {
  sourceSnapshot?: string; promptLanguage?: "my"; englishJson?: string; englishSource?: string;
  id: string; shotNumber: number; title: string; purpose: string; shotSize: string; cameraMovement: string;
  action: string; durationSeconds: number; openingFrame: string; finalFrame: string; imagePrompt?: string; imageApproved?: boolean; flowPrompt: string;
  referenceAssets: string[]; negativePrompt: string; voiceover: string; audioNotes: string; sfx: string; backgroundMusic: string;
};
export type Scene = {
  backgroundAngle?: "A" | "B" | "C" | "D";
  sfx?: string; backgroundMusic?: string;
  preparationMode?: "text-to-video" | "image-to-video";
  locked?: boolean; reviewStatus?: "draft" | "review" | "approved"; reviewNotes?: string;
  assetIds?: string[]; shots?: ShotBreakdown[];
  id: string; sceneNumber: number; title: string; durationSeconds: number; objective: string;
  visualDescription: string; shotSize: string; cameraMovement: string; lighting: string; mood: string;
  fullImagePrompt?: string; fullVideoPrompt?: string; fullPromptSource?: string;
  action: string; flowPrompt: string; voiceover: string; onscreenText: string; audioNotes: string;
  transition: string; referenceAssets: string[]; negativePrompt: string; openingFrame: string;
  finalFrame: string; handoff: "CUT" | "CONTINUATION";
};
export type ReferencePlanItem = { fullPrompt?: string; fullPromptSource?: string; id: string; kind: "character" | "background" | "prop"; title: string; prompt: string; sceneIds: string[] };
export type ScreenplayChoice = { id: string; title: string; screenplay: string; versions: string[]; sourceType?: "generated" | "existing"; polishCandidate?: string; polishFor?: string };
export type ScriptReference = { fullPrompt?: string; fullPromptSource?: string; id: string; kind: "character" | "background" | "prop"; title: string; description: string; englishDescription?: string; englishSource?: string; imageRevision?: string };
export type ScriptScene = { id: string; title: string; location: string; action: string; dialogue: string; durationSeconds: number; referenceIds: string[] };
export type ScreenplayWorkflow = { choices: ScreenplayChoice[]; selectedId: string; approvedScript?: string; inventory?: { source: string; references: ScriptReference[]; scenes: ScriptScene[] }; approvedInventory?: string };
export type Storyboard = {
  pipelineSource?: string;
  promptLanguage?: "my";
  englishSource?: string;
  englishJson?: string;
  referencePlan?: ReferencePlanItem[];
  projectTitle: string; logline: string; visualBible: string; continuityRules: string[];
  globalNegativePrompt: string; productionNotes: string[]; scenes: Scene[];
};
export type SavedProject = {
  screenplay?: ScreenplayWorkflow;
  id: string; title: string; savedAt: string; form: Omit<VideoForm, "referenceImages">;
  concepts: VideoConcept[]; selectedConceptId: string; storyboard: Storyboard | null;
  history?: BoardVersion[];
};
export type BoardVersion = { id: string; label: string; createdAt: string; storyboard: Storyboard; concept?: VideoConcept; form?: Omit<VideoForm, "referenceImages"> };
export type ImageAsset = {
  handle?: string;
  id: string; kind: "character" | "background" | "prop" | "scene"; title: string; prompt: string;
  /** Optional bilingual prompt variants; `prompt` remains the default/English prompt for older callers. */
  promptMy?: string; promptEn?: string;
  mimeType: string; data: string; createdAt: string; useAsReference: boolean;
  projectId?: string; sceneId?: string; sceneNumber?: number;
};
export type ProductionPreset = { id: string; name: string; settings: Omit<VideoForm, "topic" | "referenceImages"> };
