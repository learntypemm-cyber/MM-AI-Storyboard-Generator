import { describe, expect, it } from "vitest";
import type { ImageAsset, Scene, ShotBreakdown, Storyboard, VideoForm } from "../types";
import { shotBreakdownOutputSchema, shotBreakdownRequest, shotImagePromptText, shotPackageText, validateShotPrompt } from "./multiShot";
import { shotSourceSnapshot, shotNeedsReview, shotReferences, shotTranslationSource, validateShotTranslation, translatedShot } from "./multiShot";
import { storyboardSchema } from "./projectArchive";

const form: VideoForm = {
  topic: "A coffee shop story", goal: "Tell a warm story", platform: "YouTube Shorts",
  targetDuration: 16, language: "Burmese", audience: "Myanmar viewers",
  visualStyle: "Cinematic live action", aspectRatio: "9:16", flowModel: "Veo 3.1 Fast",
  generationMode: "First Frame", clipDuration: 8, audioPolicy: "Soft cafe ambience",
  textPolicy: "No visible text", referenceNotes: "", referenceImages: [],
};

const scene: Scene = {
  id: "scene-1", sceneNumber: 1, title: "Morning coffee", durationSeconds: 8,
  objective: "Introduce the character and coffee", visualDescription: "A quiet cafe beside a window",
  shotSize: "Medium close-up", cameraMovement: "Slow push-in", lighting: "Warm morning light", mood: "Calm",
  action: "A woman reaches for her cup", flowPrompt: "NO TEXT IN THE IMAGE. Show the woman reaching for a cup.",
  voiceover: "", onscreenText: "", audioNotes: "Soft cafe ambience", transition: "Cut",
  referenceAssets: ["Cafe"], negativePrompt: "No extra fingers", openingFrame: "Cup on a wooden table",
  finalFrame: "The woman holds the cup", handoff: "CUT",
};
const board: Storyboard = {
  projectTitle: "Coffee", logline: "A quiet morning moment", visualBible: "Warm natural cinematic realism",
  continuityRules: ["Keep the same wardrobe and cup"], globalNegativePrompt: "No text or watermarks",
  productionNotes: [], scenes: [scene],
  referencePlan: [{ id: "bg1", kind: "background", title: "Cafe", prompt: "A small cafe with a large window", sceneIds: ["scene-1"] }],
};
const longFlowPrompt = [
  "NO TEXT IN THE IMAGE.",
  "(00:00-00:03) [Camera shot] Medium close-up at the wooden table. [Action] The woman reaches toward the ceramic cup with her hand fully visible.",
  "(00:03-00:08) [Camera shot] Maintain the same continuous medium close-up and framing. [Action] She lifts the cup carefully and pauses at chest height.",
  "Opening frame: a ceramic cup rests near the edge of a wooden cafe table in warm morning light.",
  "A young woman with a cream cardigan reaches slowly toward the cup, her face calm and focused.",
  "Medium close-up composition with a gentle camera push-in, keeping the cup and her hand fully visible.",
  "Preserve realistic fingers, consistent wardrobe, natural body mechanics and stable object shape.",
  "The background remains a quiet cafe with a large window and soft daylight.",
  "Final frame: she holds the cup steadily at chest height and pauses, ready to take a sip.",
  "Audio direction: quiet room tone and gentle ceramic contact; no speech is added.",
].join(" ");

const shot: ShotBreakdown = {
  id: "shot-1", shotNumber: 1, title: "Hand reaches for cup", purpose: "Establish the coffee ritual",
  shotSize: "Medium close-up", cameraMovement: "Gentle push-in", action: "She reaches for the cup",
  durationSeconds: 8, openingFrame: "Cup rests on the table", finalFrame: "She holds the cup",
  imagePrompt: "GENERATE THE STORYBOARD IMAGE NOW. Create exactly one opening still. NO TEXT IN THE IMAGE. Show the cup and woman's hand.",
  flowPrompt: longFlowPrompt, referenceAssets: ["Cafe"], negativePrompt: "No extra fingers",
  voiceover: "", audioNotes: "Quiet cafe ambience", sfx: "Soft ceramic contact", backgroundMusic: "Quiet piano",
};

describe("multi-shot breakdown", () => {
  it("allows a single shot and prepares Burmese drafts before translation", () => {
    expect(shotBreakdownOutputSchema.parse({ shots: [shot] }).shots).toHaveLength(1);
    expect(shotBreakdownRequest(scene, board, form, [], 1)).toContain("into 1 distinct");
    expect(shotBreakdownRequest(scene, board, form)).toContain("IN BURMESE IN FULL");
  });

  it("tracks source changes but ignores review notes and unrelated references", () => {
    const tracked = { ...shot, sourceSnapshot: shotSourceSnapshot(shot, scene, board, form) };
    expect(shotNeedsReview(tracked, scene, board, form)).toBe(false);
    expect(shotNeedsReview(tracked, { ...scene, reviewNotes: "Keep", locked: true }, board, form)).toBe(false);
    expect(shotNeedsReview(tracked, { ...scene, action: "Put the cup down" }, board, form)).toBe(true);
    expect(shotNeedsReview(tracked, scene, { ...board, referencePlan: board.referencePlan!.map(ref => ({ ...ref, prompt: "A dark cafe" })) }, form)).toBe(true);
    expect(shotNeedsReview(tracked, scene, { ...board, referencePlan: [...board.referencePlan!, { id: "elsewhere", kind: "background", title: "Beach", prompt: "Beach", sceneIds: ["scene-2"] }] }, form)).toBe(false);
    expect(shotNeedsReview(tracked, scene, board, { ...form, audioPolicy: "No speech" })).toBe(true);
    expect(shotNeedsReview(shot, scene, board, form)).toBe(true);
  });

  it("flags replacement images with unchanged IDs and resolves only shot references", () => {
    const asset: ImageAsset = { id: "bg1", kind: "background", title: "Cafe", prompt: "Cafe", data: "AAAA", mimeType: "image/png", createdAt: "today", useAsReference: false };
    const tracked = { ...shot, sourceSnapshot: shotSourceSnapshot(shot, scene, board, form, [asset]) };
    expect(shotNeedsReview(tracked, scene, board, form, [{ ...asset, data: "BBBB" }])).toBe(true);
    expect(shotReferences({ ...shot, referenceAssets: [] }, scene, board, [asset])).toEqual([]);
  });

  it("rejects timing gaps despite valid first and last timecodes", () => {
    expect(validateShotPrompt({ ...shot, flowPrompt: longFlowPrompt.replace("00:03-00:08", "00:04-00:08") }, form, board, scene).some(issue => issue.includes("gap, overlap"))).toBe(true);
  });

  it("keeps Burmese and invalidates English after creative edits", () => {
    const draft: ShotBreakdown = { ...shot, promptLanguage: "my", action: "ခွက်ယူသည်" };
    const translated = validateShotTranslation(shot, draft);
    expect(translated.action).toBe(draft.action);
    expect(translatedShot(translated)?.action).toBe(shot.action);
    expect(translatedShot({ ...translated, action: "ခွက်ချသည်" })).toBeNull();
    expect(shotTranslationSource({ ...draft, imageApproved: true })).toBe(shotTranslationSource(draft));
    expect(() => validateShotTranslation({ ...shot, voiceover: "Invented speech" }, draft)).toThrow();
    expect(translatedShot({ ...translated, englishJson: "not JSON" })).toBeNull();
  });

  it("preserves snapshots and bilingual drafts through save schema and exports", () => {
    const draft = validateShotTranslation(shot, { ...shot, promptLanguage: "my", sourceSnapshot: shotSourceSnapshot(shot, scene, board, form) });
    const saved = storyboardSchema.parse({ ...board, scenes: [{ ...scene, shots: [draft] }] });
    expect(saved.scenes[0].shots?.[0]).toEqual(draft);
    expect(shotPackageText(saved, form)).toContain("Prompt language: ENGLISH");
    expect(shotPackageText(saved, form)).toContain("does not upload or bind an image");
  });
  it("requires an image prompt and a self-contained video prompt for each generated shot", () => {
    const parsed = shotBreakdownOutputSchema.parse({ shots: [{ ...shot }, { ...shot, shotNumber: 2 }] });
    expect(parsed.shots[0].imagePrompt).toContain("GENERATE THE STORYBOARD IMAGE NOW.");
    expect(() => shotBreakdownOutputSchema.parse({ shots: [{ ...shot, imagePrompt: "" }, { ...shot, shotNumber: 2 }] })).toThrow();
  });

  it("asks for a small, chronological shot list without changing the source scene", () => {
    const request = shotBreakdownRequest(scene, board, form);
    expect(request).toContain("1 to 4 distinct, chronological");
    expect(request).toContain("GENERATE THE STORYBOARD IMAGE NOW.");
    expect(request).toContain('"sceneNumber":' + scene.sceneNumber);
    expect(request).toContain('"clipDurationSeconds":8');
    const linkedAsset: ImageAsset = { id: "bg1", kind: "background", title: "Cafe", prompt: "A small cafe", mimeType: "image/png", data: "aGVsbG8=", createdAt: "2026-10-23", useAsReference: false, projectId: "coffee" };
    expect(shotBreakdownRequest(scene, board, form, [linkedAsset])).toContain('"handle":"@Cafebg1"');
  });

  it("honors intentional visible-text policy and continuity in the shot request", () => {
    const intentionalForm = { ...form, textPolicy: "Display exactly OPEN 24/7 on the shop sign. No other readable text." };
    const request = shotBreakdownRequest(scene, board, intentionalForm);
    expect(request).toContain("Follow the user text policy in settings.textPolicy.");
    expect(request).toContain("INTENTIONAL TEXT IN THE IMAGE");
    expect(request).toContain("Display exactly OPEN 24/7 on the shop sign");
    expect(request).toContain("each later shot's opening state must plausibly follow the preceding shot's final state");
  });

  it("builds a one-frame still prompt from the approved scene references", () => {
    const generated = shotImagePromptText({ ...shot, imagePrompt: "" }, scene, board, form);
    expect(generated.startsWith("GENERATE THE STORYBOARD IMAGE NOW.")).toBe(true);
    expect(generated).toContain("Create exactly ONE finished still image");
    expect(generated).toContain("NO TEXT IN THE IMAGE.");
    expect(generated).toContain("Cafe: A small cafe with a large window");
    expect(generated).toContain("9:16");
  });

  it("passes a shot with complete, contiguous timing and frame directions", () => {
    expect(validateShotPrompt(shot, form, board, scene)).toEqual([]);
  });

  it("flags vague or incomplete prompts and warns about unsupported duration mismatch", () => {
    const issues = validateShotPrompt({ ...shot, flowPrompt: "NO TEXT IN THE IMAGE. Same as the previous shot." }, form, board, scene);
    expect(issues.some((issue) => issue.includes("short"))).toBe(true);
    expect(issues.some((issue) => issue.includes("previous-shot"))).toBe(true);
    expect(issues.some((issue) => issue.includes("Opening-frame"))).toBe(true);
    expect(issues.some((issue) => issue.includes("Final-frame"))).toBe(true);
    expect(validateShotPrompt({ ...shot, durationSeconds: 6 }, form, board, scene).some((issue) => issue.includes("Duration differs"))).toBe(true);
  });

  it("exports both still and video prompt sections for each shot", () => {
    const withShots: Storyboard = { ...board, scenes: [{ ...scene, shots: [shot] }] };
    const packaged = shotPackageText(withShots, form);
    expect(packaged).toContain("OPENING STILL PROMPT");
    expect(packaged).toContain("GENERATE THE STORYBOARD IMAGE NOW.");
    expect(packaged).toContain("GOOGLE FLOW VIDEO PROMPT");
    expect(packaged).toContain("NO TEXT IN THE IMAGE.");
    expect(packaged).toContain("NOT APPROVED - review the opening still in Google Flow before using the video prompt.");
  });
});
