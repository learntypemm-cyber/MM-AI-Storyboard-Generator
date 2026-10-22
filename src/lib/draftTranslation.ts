import type { Storyboard, VideoForm } from "../types";
import { storyboardSchema } from "./projectArchive";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function draftSource(board: Storyboard, form: VideoForm): string {
  const { englishJson: _json, englishSource: _source, ...draft } = board;
  const { referenceImages: _images, ...settings } = form;
  return JSON.stringify(canonical({ draft, settings }));
}
export function translatedBoard(board: Storyboard, form: VideoForm): Storyboard | null {
  if (!board.englishJson || board.englishSource !== draftSource(board, form)) return null;
  try { return storyboardSchema.parse(JSON.parse(board.englishJson)); } catch { return null; }
}
export function validateTranslation(raw: unknown, original: Storyboard): Storyboard {
  const translated = storyboardSchema.parse(raw);
  if (translated.scenes.length !== original.scenes.length || new Set(translated.scenes.map(s => s.id)).size !== original.scenes.length || original.scenes.some(s => !translated.scenes.some(t => t.id === s.id))) throw new Error("Translation omitted or changed scene IDs. Your Burmese draft is preserved; retry translation.");
  const refs = original.referencePlan || [];
  if ((translated.referencePlan || []).length !== refs.length || new Set(translated.referencePlan?.map(r => r.id)).size !== refs.length || refs.some(r => !translated.referencePlan?.some(t => t.id === r.id))) throw new Error("Translation omitted reference prompts. Your draft is preserved.");
  const fields = ["title", "objective", "visualDescription", "shotSize", "cameraMovement", "lighting", "mood", "action", "flowPrompt", "audioNotes", "transition", "negativePrompt", "openingFrame", "finalFrame", "sfx", "backgroundMusic"] as const;
  return { ...original, promptLanguage: undefined, englishJson: undefined, englishSource: undefined,
    projectTitle: translated.projectTitle, logline: translated.logline, visualBible: translated.visualBible,
    continuityRules: translated.continuityRules, globalNegativePrompt: translated.globalNegativePrompt, productionNotes: translated.productionNotes,
    scenes: original.scenes.map(scene => {
      const next = translated.scenes.find(s => s.id === scene.id)!;
      if (fields.some(field => scene[field]?.trim() && !next[field]?.trim())) throw new Error("Translation left scene details blank. Your draft is preserved.");
      const text = Object.fromEntries(fields.map(field => [field, next[field] ?? scene[field]]));
      // IDs, timing, angles, locks, links and exact spoken words remain user-owned.
      return { ...scene, ...text, voiceover: scene.voiceover, onscreenText: scene.onscreenText };
    }),
    referencePlan: refs.map(ref => { const next = translated.referencePlan!.find(r => r.id === ref.id)!; if (!next.title.trim() || !next.prompt.trim()) throw new Error("Translation left a reference blank."); return { ...ref, title: next.title, prompt: next.prompt }; }),
  };
}
export function translationPrompt(board: Storyboard): string {
  const { englishJson: _json, englishSource: _source, ...draft } = board;
  return "Translate this approved Burmese storyboard and ALL reference design prompts into precise English for Google Flow. Return the complete identical JSON structure, not a summary. Do not add ideas, actions, camera moves, characters or objects. Preserve scene/reference IDs, scene order, duration, angle, handoff, reference links, technical fields, and the exact voiceover/dialogue and caption text in their original language. Translate only descriptive text, including timed flowPrompt beats, sfx and music. English flowPrompt begins NO TEXT IN THE IMAGE. (unless the draft explicitly requests visible text). Preserve all detail and timing. Omit promptLanguage, englishSource and englishJson.\n" + JSON.stringify(draft);
}
