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
export type Scene = {
  id: string; sceneNumber: number; title: string; durationSeconds: number; objective: string;
  visualDescription: string; shotSize: string; cameraMovement: string; lighting: string; mood: string;
  action: string; flowPrompt: string; voiceover: string; onscreenText: string; audioNotes: string;
  transition: string; referenceAssets: string[]; negativePrompt: string; openingFrame: string;
  finalFrame: string; handoff: "CUT" | "CONTINUATION";
};
export type Storyboard = {
  projectTitle: string; logline: string; visualBible: string; continuityRules: string[];
  globalNegativePrompt: string; productionNotes: string[]; scenes: Scene[];
};
export type SavedProject = {
  id: string; title: string; savedAt: string; form: Omit<VideoForm, "referenceImages">;
  concepts: VideoConcept[]; selectedConceptId: string; storyboard: Storyboard | null;
};
