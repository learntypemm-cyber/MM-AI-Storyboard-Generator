import type { BoardVersion, Scene, Storyboard } from "../types";

// A model response may update creative content, never identity, locks or reference bindings.
export function sceneRepairPatch(value: Partial<Scene>): Partial<Scene> {
  const fields = ["sfx", "backgroundMusic", "title", "objective", "visualDescription", "shotSize", "cameraMovement", "lighting", "mood", "action", "flowPrompt", "voiceover", "onscreenText", "audioNotes", "transition", "negativePrompt", "openingFrame", "finalFrame"] as const;
  const patch: Partial<Scene> = {};
  for (const field of fields) if (typeof value[field] === "string") patch[field] = value[field];
  if (typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0 && value.durationSeconds <= 600) patch.durationSeconds = value.durationSeconds;
  if (value.backgroundAngle && ["A", "B", "C", "D"].includes(value.backgroundAngle)) patch.backgroundAngle = value.backgroundAngle;
  if (value.handoff === "CUT" || value.handoff === "CONTINUATION") patch.handoff = value.handoff;
  if (Array.isArray(value.referenceAssets) && value.referenceAssets.every((item) => typeof item === "string")) patch.referenceAssets = value.referenceAssets;
  return patch;
}

export function checkpoint(history: BoardVersion[], storyboard: Storyboard, label: string): BoardVersion[] {
  return [{ id: crypto.randomUUID(), label, createdAt: new Date().toISOString(), storyboard: structuredClone(storyboard) }, ...history].slice(0, 30);
}
export function patchScene(board: Storyboard, id: string, patch: Partial<Scene>): Storyboard {
  return { ...board, scenes: board.scenes.map((scene) => scene.id === id && !scene.locked ? { ...scene, ...patch, id: scene.id, sceneNumber: scene.sceneNumber } : scene) };
}
export function reorderScene(board: Storyboard, id: string, direction: number): Storyboard {
  const scenes = [...board.scenes];
  const from = scenes.findIndex((scene) => scene.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= scenes.length) return board;
  [scenes[from], scenes[to]] = [scenes[to], scenes[from]];
  return { ...board, scenes: scenes.map((scene, index) => ({ ...scene, sceneNumber: index + 1 })) };
}
