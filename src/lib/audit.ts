import type { Scene, Storyboard, VideoForm } from "../types";

export type AuditItem = { label: string; ok: boolean; detail: string };
const backwardReference = /\b(as before|same as before|previous scene|previously|from the previous|continuing from|as established|like earlier|returns to|the same character|the same location|same person as earlier|same setup as before|continue from the last clip)\b/i;
const textBleed = /\b(?:scene\s*\d+|shot\s*\d+|\d{2}:\d{2}|#(?:[0-9a-f]{3}|[0-9a-f]{6})\b|\d{3,4}\s*K)\b/i;
const invalidReferenceHandle = /@[A-Za-z0-9][A-Za-z0-9 _-]*/g;

function hasOnlyCanonicalHandles(prompt: string): boolean {
  const candidates = prompt.match(invalidReferenceHandle) ?? [];
  return candidates.every((handle) => /^@[A-Z][A-Za-z0-9]*$/.test(handle.trim()));
}

export function auditScene(scene: Scene): AuditItem[] {
  const prompt = scene.flowPrompt || "";
  return [
    { label: "Text policy", ok: /NO TEXT IN THE IMAGE|NO VISIBLE TEXT|INTENTIONAL TEXT IN THE IMAGE/i.test(prompt), detail: "Declare whether text may appear in the generated frame." },
    { label: "Self-contained prompt", ok: !backwardReference.test(prompt), detail: "Avoid references that require the model to remember another generation." },
    { label: "Opening and final frame", ok: Boolean(scene.openingFrame.trim() && scene.finalFrame.trim()) && /opening frame|first frame/i.test(prompt) && /final frame|last frame/i.test(prompt), detail: "Include complete opening and final-frame descriptions." },
    { label: "Text-bleed check", ok: !textBleed.test(prompt), detail: "Remove timestamps, color codes, and labels that might appear in-frame." },\n    { label: "Reference handles", ok: hasOnlyCanonicalHandles(prompt), detail: "Any @reference must use one canonical PascalCase name without spaces or hyphens." },\n    { label: "Punctuation compatibility", ok: !prompt.includes("—"), detail: "Avoid em dashes in production prompts for predictable cross-tool parsing." },
    { label: "Audio direction", ok: Boolean(scene.audioNotes.trim()), detail: "Specify voice, ambience, music, or intentional silence." },
    { label: "Duration", ok: scene.durationSeconds > 0 && Number.isFinite(scene.durationSeconds), detail: "Every clip needs a positive duration." },
  ];
}

export function auditStoryboard(storyboard: Storyboard | null, form: VideoForm): AuditItem[] {
  if (!storyboard || !storyboard.scenes.length) return [];
  const audits = storyboard.scenes.map(auditScene);
  const total = storyboard.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const negative = storyboard.globalNegativePrompt.toLowerCase();
  return [
    { label: "Scene prompts", ok: audits.every((items) => items.every((item) => item.ok)), detail: audits.filter((items) => items.every((item) => item.ok)).length + " of " + audits.length + " scenes pass every automated check." },
    { label: "Runtime plan", ok: Math.abs(total - form.targetDuration) <= Math.max(form.clipDuration, 4), detail: "Planned clips total " + total + "s against a " + form.targetDuration + "s target. Adjust scenes if needed." },
    { label: "Reference accuracy", ok: /invent|fabricat|fake|unreadable|watermark/i.test(negative), detail: "Use real LearnTypeMM screenshots for exact website UI; do not rely on invented interface details." },
  ];
}
