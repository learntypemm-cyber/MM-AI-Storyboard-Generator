import { z } from "zod";
import type { ScreenplayWorkflow, Storyboard, VideoForm } from "../types";
import { sceneDetailRequirements } from "./promptGuidance";
const text = z.string().max(100000);
const required = text.refine(v => v.trim().length > 0, "Required text is empty");
const id = z.string().min(1).max(200);
export const screenplayChoicesSchema = z.object({ choices: z.array(z.object({ title: required, screenplay: required })).length(3) });
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
  return "You are a Burmese screenwriter. Return JSON {choices:[{title,screenplay}]} with EXACTLY THREE distinct ORIGINAL complete screenplays, not concept summaries. Each is a feasible finished video for the target duration. Write in Burmese with screenplay formatting: interior/exterior location/time headings, present-tense visible action, character names, dialogue lines, brief parentheticals and relevant sound cues. Give beginning, development and ending; keep speech/actions performable in the runtime. No prompts, shot grids or English translation yet. Respect all user reference evidence and audio policy. Do not invent real brand claims. Each approach should be meaningfully different.\n" + JSON.stringify(brief);
}
export function inventoryRequest(w: ScreenplayWorkflow, form: VideoForm): string {
  return "Extract a production inventory ONLY from this approved Burmese screenplay. JSON {references:[{id,kind:'character'|'background'|'prop',title,description}],scenes:[{id,title,location,action,dialogue,durationSeconds,referenceIds:[]} ]}. Write descriptions in Burmese. Use unique short IDs; reuse one reference for each identity/outfit and location. Include visible single-scene characters, important props and environments, no invented extra cast. Character description: face/hair/build, complete wardrobe, palette and identifying details; location: spatial layout, fixed objects, materials, light direction. List screenplay events in their original order; divide long events into achievable clips near the desired clip length, without changing dialogue/actions. Copy exact dialogue into dialogue; do not paraphrase or omit it. Each shot links at most 3 needed reference IDs; at most 12 references total. An empty landscape can have no character. No video prompts yet.\n" + scriptSource(w, form);
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
