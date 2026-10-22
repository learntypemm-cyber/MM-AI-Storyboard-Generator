import { z } from "zod";
import type { ScreenplayWorkflow, Storyboard, VideoForm } from "../types";
import { sceneDetailRequirements } from "./promptGuidance";
const text = z.string().max(100000);
const required = text.refine(v => v.trim().length > 0, "Required text is empty");
const id = z.string().min(1).max(200);
function objectValue(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate)) {
      const joined = candidate.map((item) => normalizeScreenplayValue(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("\n");
      if (joined) return joined;
    }
  }
  return "";
}

function normalizeDialogue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => normalizeDialogue(item)).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  const speaker = objectValue(item, ["speaker", "character", "characterName", "character_name", "name"]);
  const words = objectValue(item, ["line", "text", "content", "dialogue", "words", "speech"]);
  if (speaker && words) return speaker + ": " + words;
  return words || objectValue(item, ["voiceover", "narration", "action", "description"]);
}

function isSceneRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).map((key) => key.toLowerCase());
  const has = (...names: string[]) => names.some((name) => keys.includes(name.toLowerCase()));
  return has("sceneNumber", "scene_number", "sceneTitle", "scene_title", "sceneHeading", "scene_heading", "slugline", "heading")
    || (has("location") && has("action", "visibleAction", "visualAction", "dialogue"))
    || (has("title") && has("action") && has("dialogue"));
}

function renderSceneRecord(item: Record<string, unknown>, index: number): string {
  const numberValue = item.sceneNumber ?? item.scene_number ?? item.number ?? item.sceneIndex ?? item.scene_index;
  const sceneNumber = typeof numberValue === "number" && Number.isFinite(numberValue) ? numberValue : index + 1;
  const heading = objectValue(item, ["sceneHeading", "scene_heading", "slugline", "heading", "sceneTitle", "scene_title", "location", "title"]);
  const headingText = heading && /^\s*(?:[၀-၉0-9]{1,3}\s*[။.)]|(?:SCENE|SHOT)\s+\d+)/i.test(heading)
    ? heading
    : String(sceneNumber) + ". " + (heading || ("Scene " + sceneNumber));
  const fields: string[] = [headingText];
  const action = objectValue(item, ["visibleAction", "visible_action", "visualAction", "visual_action", "action", "visualDescription", "visual_description", "description", "stageDirection", "stage_direction", "directions", "beat"]);
  if (action) fields.push(action);
  const parenthetical = objectValue(item, ["parenthetical", "direction", "performanceNote", "performance_note"]);
  if (parenthetical) fields.push("(" + parenthetical + ")");
  const dialogue = normalizeDialogue(item.dialogue);
  if (dialogue) fields.push(dialogue);
  const voiceover = objectValue(item, ["voiceover", "narration", "voiceOver", "voice_over"]);
  if (voiceover) fields.push(voiceover.startsWith("V.O.") || voiceover.startsWith("V.O:") ? voiceover : "V.O.: " + voiceover);
  const sound = objectValue(item, ["sfx", "soundEffects", "sound_effects", "ambientSound", "ambient_sound", "audio"]);
  if (sound) fields.push("SFX: " + sound);
  const transition = objectValue(item, ["transition", "handoff", "cut"]);
  if (transition) fields.push("TRANSITION: " + transition);
  return fields.filter(Boolean).join("\n");
}

export function normalizeScreenplayValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return value.map((item) => item.trim()).filter(Boolean).join("\n");
    if (value.length > 0 && value.every(isSceneRecord)) {
      return value.map((item, index) => renderSceneRecord(item, index)).filter(Boolean).join("\n\n");
    }
    return value.map((item) => normalizeScreenplayValue(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("\n");
  }
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  if (item.screenplay !== undefined) return normalizeScreenplayValue(item.screenplay);
  if (item.script !== undefined) return normalizeScreenplayValue(item.script);
  if (Array.isArray(item.scenes)) return normalizeScreenplayValue(item.scenes);
  if (isSceneRecord(item)) return renderSceneRecord(item, 0);
  const text = objectValue(item, ["text", "content", "line", "script", "draft", "action", "description", "voiceover", "narration", "dialogue"]);
  return text || value;
}

const screenplayText = z.preprocess(normalizeScreenplayValue, required);
export const screenplayChoicesSchema = z.object({ choices: z.array(z.object({ title: required, screenplay: screenplayText })).length(3) });
export const screenplayRepairSchema = z.object({
  repairs: z.array(z.object({ index: z.number().int().min(0).max(2), title: required, screenplay: screenplayText })).min(1).max(3),
});

export function requiredScreenplaySceneCount(form: Pick<VideoForm, "targetDuration" | "clipDuration">): number {
  const runtime = Math.max(1, Number(form.targetDuration) || 1);
  const clipLength = Math.max(1, Number(form.clipDuration) || 1);
  return Math.max(1, Math.ceil(runtime / clipLength));
}

const SCREENPLAY_HEADING = /^[ \t]*(?:(?:[၀-၉0-9]{1,3}[ \t]*[။.)])|(?:SCENE|SHOT)[ \t]+\d+[ \t]*[:.)-])[ \t]*\S.*$/gim;

export function screenplaySceneCount(screenplay: string): number {
  return [...screenplay.matchAll(SCREENPLAY_HEADING)].length;
}

function screenplaySceneBodies(screenplay: string): string[] {
  const matches = [...screenplay.matchAll(SCREENPLAY_HEADING)];
  return matches.map((match, index) => {
    const headingEnd = screenplay.indexOf("\n", (match.index ?? 0) + match[0].length);
    if (headingEnd < 0) return "";
    const bodyStart = headingEnd + 1;
    const nextHeading = matches[index + 1]?.index ?? screenplay.length;
    return screenplay.slice(bodyStart, nextHeading).trim();
  });
}

export function screenplayCompletenessIssues(screenplay: string, form: Pick<VideoForm, "targetDuration" | "clipDuration">): string[] {
  const expected = requiredScreenplaySceneCount(form);
  const actual = screenplaySceneCount(screenplay);
  const issues: string[] = [];
  if (actual !== expected) issues.push("Expected exactly " + expected + " numbered clip-scenes for " + form.targetDuration + "s at " + form.clipDuration + "s per clip, but found " + actual + ".");
  if (actual > 0) {
    const shortScenes = screenplaySceneBodies(screenplay)
      .filter(body => Array.from(body.replace(/\s/g, "")).length < 100).length;
    if (shortScenes) issues.push(shortScenes + " scene(s) have less than 100 non-space characters of action/dialogue.");
  }
  return issues;
}
const reference = z.object({ id, kind: z.enum(["character", "background", "prop"]), title: required, description: required, englishDescription: text.optional(), englishSource: text.optional(), imageRevision: text.optional() });
const shot = z.object({ id, title: required, location: required, action: required, dialogue: text, durationSeconds: z.number().positive().max(600), referenceIds: z.array(id).max(3) });
export const scriptInventorySchema = z.object({ references: z.array(reference).max(12), scenes: z.array(shot).min(1).max(200) }).superRefine((v, ctx) => {
  if (new Set(v.references.map(r => r.id)).size !== v.references.length || new Set(v.scenes.map(s => s.id)).size !== v.scenes.length) ctx.addIssue({ code: "custom", message: "Duplicate reference or scene IDs" });
  for (const s of v.scenes) if (s.referenceIds.some(id => !v.references.some(r => r.id === id))) ctx.addIssue({ code: "custom", message: "Scene contains an unknown reference" });
});
export const screenplayWorkflowSchema = z.object({ choices: z.array(z.object({ id, title: required, screenplay: text, versions: z.array(text).max(20), polishCandidate: text.optional(), polishFor: text.optional() })).min(1).max(3), selectedId: text, approvedScript: z.string().max(2000000).optional(), approvedInventory: z.string().max(3000000).optional(), inventory: scriptInventorySchema.safeExtend({ source: z.string().max(2000000) }).optional() });
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])); return value; }
export function scriptSource(w: ScreenplayWorkflow, form: VideoForm): string {
  const choice = w.choices.find(c => c.id === w.selectedId);
  const { referenceImages: _images, ...settings } = form;
  return JSON.stringify(stable({ choice: choice && { id: choice.id, title: choice.title, screenplay: choice.screenplay }, settings }));
}
export function scriptApproved(w: ScreenplayWorkflow, form: VideoForm): boolean { return Boolean(w.choices.find(c => c.id === w.selectedId)?.screenplay.trim() && w.approvedScript === scriptSource(w, form)); }
export function inventorySource(w: ScreenplayWorkflow, form: VideoForm): string {
  return JSON.stringify(stable({ script: scriptSource(w, form), references: w.inventory?.references.map(({ englishDescription: _en, englishSource: _src, ...ref }) => ref), scenes: w.inventory?.scenes }));
}
export function inventoryCurrent(w: ScreenplayWorkflow, form: VideoForm): boolean { return scriptApproved(w, form) && w.inventory?.source === scriptSource(w, form); }
export function inventoryApproved(w: ScreenplayWorkflow, form: VideoForm): boolean { return inventoryCurrent(w, form) && w.approvedInventory === inventorySource(w, form); }
export function pipelineCurrent(w: ScreenplayWorkflow | undefined, form: VideoForm, board: Storyboard | null): boolean { return !w || Boolean(inventoryApproved(w, form) && board?.pipelineSource === inventorySource(w, form)); }
export function screenplayRequest(form: VideoForm): string {
  const { referenceImages: _images, ...brief } = form;
  const count = requiredScreenplaySceneCount(form);
  const approximateSecondsPerScene = (form.targetDuration / count).toFixed(1);
  return [
    "You are a professional Burmese screenwriter for short-form video. Return valid JSON only: {choices:[{title,screenplay}]} with EXACTLY THREE meaningfully different, original, complete screenplays.",
    "These must be FULL FILMABLE SCREENPLAYS, not summaries, concepts, outlines or three-act synopses. Write all spoken dialogue and visible actions in Burmese, using proper screenplay formatting, scene headings, present-tense visual action, character names, dialogue, useful brief parentheticals, and relevant sound cues.",
    "",
    "RUNTIME AND CLIP COUNT — NON-NEGOTIABLE",
    "Target finished runtime: " + form.targetDuration + " seconds.",
    "Requested Google Flow clip length: " + form.clipDuration + " seconds.",
    "Each screenplay MUST contain EXACTLY " + count + " numbered scene headings. Each numbered scene is one separate video clip; never combine multiple clips into one scene and never summarize several clips in one paragraph.",
    "Use sequential headings on separate lines, for example '၁။ INT. BEDROOM - DAY' or '1. INT. BEDROOM - DAY'. The final screenplay must have headings numbered 1 through " + count + " (Burmese or Arabic numerals are fine).",
    "Plan approximately " + approximateSecondsPerScene + " seconds of story action per scene so the scenes together cover the " + form.targetDuration + "-second story. The Flow clip setting may create clips of " + form.clipDuration + " seconds; mention the small edit trims needed to reach the exact target runtime only when necessary.",
    "",
    "DETAIL REQUIRED IN EVERY SCENE",
    "- Start with an interior/exterior location and time slugline, including INT./EXT. where useful.",
    "- Include several concrete, filmable visual actions with the character's expression, movement, props and meaningful changes during this clip.",
    "- Include natural Burmese dialogue or voiceover when appropriate; do not rely on narration to explain every visual. Every scene does not need dialogue if the story truly works visually.",
    "- Add a relevant SFX / ambient audio cue where useful. Actions, reactions and dialogue must fit the allocated seconds.",
    "- Give each scene a beginning action, a meaningful development or reaction, and a clear visual endpoint/handoff. Keep continuity of the same people, wardrobe, props and location where intended.",
    "- Each scene body must be substantive: at least 3 concise screenplay lines and approximately 100–180 non-heading characters of visible action/dialogue on average. Do not use a single generic sentence to stand in for a whole clip. Avoid repeating the same action just to reach the count.",
    "",
    "STORY QUALITY",
    "The full screenplay must have a strong hook, setup, clear step-by-step development, a meaningful climax/payoff and a satisfying ending / call to action appropriate to the goal. Spread these beats across all " + count + " scenes instead of rushing straight to the conclusion.",
    "Keep the story practical to produce in the requested visual style. Use distinct locations only when the story needs them. Do not introduce unsupported factual claims, real brand promises or unnecessary extra characters.",
    "The three screenplays must use different narrative approaches, but EVERY option must meet the full scene-count and detail requirements. No explanation before or after the JSON.",
    "",
    "USER BRIEF (preserve these settings):",
    JSON.stringify(brief),
  ].join("\n");
}

export function screenplayRepairRequest(
  form: VideoForm,
  choices: Array<{ title: string; screenplay: string }>,
  invalidIndexes: number[],
): string {
  const count = requiredScreenplaySceneCount(form);
  const drafts = invalidIndexes.map(index => ({
    index,
    title: choices[index]?.title,
    screenplay: choices[index]?.screenplay,
    issues: screenplayCompletenessIssues(choices[index]?.screenplay || "", form),
  }));
  return [
    "You are repairing incomplete Burmese screenplays. Return valid JSON ONLY in this shape: {repairs:[{index,title,screenplay}]}",
    "Rewrite only the listed screenplay options and keep each original title and core story idea. Do not return the already-complete options.",
    "Each repaired screenplay MUST contain exactly " + count + " numbered scene headings, one scene per " + form.clipDuration + "-second video clip, covering a target runtime of " + form.targetDuration + " seconds. Number headings sequentially on separate lines (for example ၁။ or 1.).",
    "Do not summarize or compress the story into 3-4 scenes. Every scene needs at least 3 concise screenplay lines with visual action/reaction, dialogue or voiceover when appropriate, and useful sound cues. Keep each scene body at least 100 non-space characters, with a concrete beginning, development and endpoint.",
    "Spread the hook, story development, payoff and ending across all " + count + " scenes. Preserve character identities and story logic. Write natural Burmese screenplay prose.",
    "For every repair, copy its original zero-based index and title exactly. Include every requested index exactly once.",
    "BRIEF: " + JSON.stringify({ topic: form.topic, goal: form.goal, targetDuration: form.targetDuration, clipDuration: form.clipDuration, language: form.language, audience: form.audience, visualStyle: form.visualStyle, platform: form.platform, audioPolicy: form.audioPolicy, referenceNotes: form.referenceNotes }),
    "DRAFTS TO REPAIR: " + JSON.stringify(drafts),
  ].join("\n");
}

export function inventoryRequest(w: ScreenplayWorkflow, form: VideoForm): string {
  const count = requiredScreenplaySceneCount(form);
  return "Extract a production inventory ONLY from this approved Burmese screenplay. JSON {references:[{id,kind:'character'|'background'|'prop',title,description}],scenes:[{id,title,location,action,dialogue,durationSeconds,referenceIds:[]} ]}. Write descriptions in Burmese. Use unique short IDs; reuse one reference for each identity/outfit and location. Include visible single-scene characters, important props and environments, no invented extra cast. Character description: face/hair/build, complete wardrobe, palette and identifying details; location: spatial layout, fixed objects, materials, light direction. IMPORTANT: produce EXACTLY " + count + " inventory scenes, one for each numbered screenplay scene in the same order. Never merge two numbered scenes into one inventory scene, never split one numbered scene into multiple scenes, and never omit a numbered scene. Set each durationSeconds to " + form.clipDuration + " to match the requested Google Flow clip length; final editing can trim the combined clips to the target " + form.targetDuration + " seconds. Copy exact dialogue into dialogue; do not paraphrase or omit it. Each shot links at most 3 needed reference IDs; at most 12 references total. No video prompts yet.\n" + scriptSource(w, form);
}
export function approvedSceneRequest(w: ScreenplayWorkflow, form: VideoForm): string {
  return "Generate a Burmese storyboard ONLY from the approved screenplay AND edited inventory below. Return JSON {projectTitle,logline,visualBible,continuityRules:[],globalNegativePrompt,productionNotes:[],scenes:[{id,sceneNumber,title,durationSeconds,objective,visualDescription,shotSize,cameraMovement,lighting,mood,action,flowPrompt,voiceover,onscreenText,audioNotes,transition,referenceAssets:[],negativePrompt,openingFrame,finalFrame,handoff:'CUT'|'CONTINUATION',backgroundAngle:'A'|'B'|'C'|'D',sfx,backgroundMusic}]}. One scene per inventory scene, same IDs, order, duration and exact dialogue. Do not invent characters, wardrobe, locations, props, dialogue or events. Refer to approved reference IDs/names; full identity descriptions must match the registry. Technical keys/enums stay English. Override English-output language in the guidance: ALL descriptions and flowPrompt must be Burmese for review.\n" + sceneDetailRequirements + "\nAPPROVED SOURCE:\n" + inventorySource(w, form);
}
export function bindApprovedBoard(raw: Storyboard, w: ScreenplayWorkflow, form: VideoForm): Storyboard {
  if (!inventoryApproved(w, form) || !w.inventory) throw new Error("Approve the current screenplay and reference inventory first.");
  const source = w.inventory;
  if (!Array.isArray(raw.scenes) || raw.scenes.length !== source.scenes.length || new Set(raw.scenes.map(s => s.id)).size !== source.scenes.length || source.scenes.some(s => !raw.scenes.some(t => t.id === s.id))) throw new Error("Scene generation changed the approved scene list. Your approvals are preserved; retry.");
  return { ...raw, promptLanguage: "my", englishJson: undefined, englishSource: undefined, pipelineSource: inventorySource(w, form),
    referencePlan: source.references.map(r => ({ id: r.id, kind: r.kind, title: r.title, prompt: r.description, sceneIds: source.scenes.filter(s => s.referenceIds.includes(r.id)).map(s => s.id) })),
    scenes: source.scenes.map((s, i) => ({ ...raw.scenes.find(t => t.id === s.id)!, id: s.id, sceneNumber: i + 1, title: s.title, durationSeconds: s.durationSeconds, action: s.action, voiceover: s.dialogue, assetIds: [...s.referenceIds], referenceAssets: s.referenceIds.map(id => source.references.find(r => r.id === id)!.title), locked: false, reviewStatus: "draft" })),
  };
}
