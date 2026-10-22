import { screenplayChoicesSchema, scriptSource, inventorySource, inventoryApproved, pipelineCurrent, bindApprovedBoard, scriptInventorySchema, screenplayWorkflowSchema } from "./lib/screenplayWorkflow";
import { draftSource, translatedBoard, validateTranslation } from "./lib/draftTranslation";
import BurmeseDraftEditor from "./components/BurmeseDraftEditor";
import { sceneInstructions, sceneBackground, completePromptText, promptPackageZip, referenceCode, sceneImagePrompt, scenePreparationMode, sceneVideoPrompt } from "./lib/promptPackage";
// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "fake-indexeddb/auto";
import JSZip from "jszip";
import App from "./App";
import { prepareAutomaticAssets, validateReferencePlan, flowSceneBundle, referenceImagePrompt, referencePromptPack } from "./lib/automaticAssets";
import { generateJson, listGeminiModels } from "./lib/gemini";
import { checkpoint, patchScene, reorderScene, sceneRepairPatch } from "./lib/boardEditing";
import { assetHandle, promptWithReferences, readAssets, sceneReferences, writeAssets } from "./lib/assetStore";
import { createArchive, readArchive } from "./lib/projectArchive";
import { loadReferences, saveReferences } from "./lib/projectMedia";
import type { ImageAsset, Scene, Storyboard, VideoForm, ScreenplayWorkflow } from "./types";

const scene = (id: string, locked = false): Scene => ({ id, locked, sceneNumber: id === "one" ? 1 : 2, title: id, durationSeconds: 8, objective: "Show the product", visualDescription: "A table", shotSize: "Close up", cameraMovement: "Static", lighting: "Daylight", mood: "Warm", action: "Lift cup", flowPrompt: "NO TEXT IN THE IMAGE. Opening frame: a cup. Final frame: a cup raised.", voiceover: "Hello", onscreenText: "", audioNotes: "Quiet", transition: "Cut", referenceAssets: [], negativePrompt: "No text", openingFrame: "A cup", finalFrame: "A cup raised", handoff: "CUT" });
const board = (): Storyboard => ({ projectTitle: "Coffee", logline: "A coffee story", visualBible: "Warm", continuityRules: [], globalNegativePrompt: "No fake UI", productionNotes: [], scenes: [scene("one"), scene("two", true)] });
const form: VideoForm = { topic: "Coffee", goal: "Promote", platform: "TikTok", targetDuration: 16, language: "Burmese", audience: "Coffee fans", visualStyle: "Cinematic live action", aspectRatio: "9:16", flowModel: "Veo 3.1 Fast", generationMode: "Text to Video", clipDuration: 8, audioPolicy: "Quiet", textPolicy: "No text", referenceNotes: "", referenceImages: [] };
const completeRegeneratedFlowPrompt = [
  "NO TEXT IN THE IMAGE.",
  "(00:00-00:04) [Camera shot] Medium close-up at the wooden table. [Action] May reaches for the ceramic cup with a relaxed, deliberate movement, keeping both hands natural and the cup shape stable. [Background] Cafe A / front view. The warm window light, table grain and muted cafe details stay consistent.",
  "(00:04-00:08) [Camera shot] Gentle slow push-in with no jump cut. [Action] May lifts the cup naturally, pauses, and brings it toward her face while keeping the same grip, wardrobe and position. [Background] Cafe A / front view, unchanged.",
  "Opening frame: the cup rests on the table in front of May. Final frame: May holds the cup steadily at chest height. Preserve realistic hand anatomy, stable props, consistent clothing, natural motion, warm daylight and a clean cinematic composition. Audio direction: quiet cafe ambience. SFX: subtle ceramic movement. Background music: soft understated instrumental music. Do not add logos, extra characters, captions, timestamps or production labels."
].join("\n");
const asset: ImageAsset = { id: "character1", kind: "character", title: "May", prompt: "A woman", mimeType: "image/png", data: "aGVsbG8=", createdAt: "2026-10-15", useAsReference: true, projectId: "test-project" };
const concept = { id: "concept", title: "Coffee time", style: "Cinema", hook: "Wake up", summary: "Morning coffee", visualDirection: "Warm", whyItWorks: "Simple", storyArc: ["Wake", "Drink"], estimatedDuration: 16 };

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); });

describe("scene protection and identity", () => {
  it("accepts only valid creative fields from model repairs", () => {
    const patch = sceneRepairPatch({ title: "New shot", durationSeconds: 6, id: "wrong", locked: false, reviewNotes: "erase feedback", assetIds: ["wrong"], handoff: "CONTINUATION" });
    expect(patch).toEqual({ title: "New shot", durationSeconds: 6, handoff: "CONTINUATION" });
    expect(sceneRepairPatch({ durationSeconds: NaN })).toEqual({});
  });
  it("creates canonical reference handles for Burmese and numeric names", () => {
    for (const title of ["မေ", "123 presenter", "", "May tutor"]) expect(assetHandle({ ...asset, title })).toMatch(/^@[A-Z][A-Za-z0-9]*$/);
  });
  it("preserves locked scenes when edits are attempted", () => {
    expect(patchScene(board(), "two", { title: "Changed" }).scenes[1].title).toBe("two");
    expect(patchScene(board(), "one", { title: "Changed", id: "wrong", sceneNumber: 99 }).scenes[0]).toMatchObject({ id: "one", title: "Changed", sceneNumber: 1 });
  });
  it("reorders by stable scene ID and renumbers without changing reference links", () => {
    const current = board(); current.scenes[0].assetIds = [asset.id];
    const moved = reorderScene(current, "one", 1);
    expect(moved.scenes.map((item) => item.id)).toEqual(["two", "one"]);
    expect(moved.scenes[1]).toMatchObject({ sceneNumber: 2, assetIds: [asset.id] });
    expect(current.scenes[0].sceneNumber).toBe(1);
    expect(reorderScene(current, "one", -1)).toBe(current);
  });
  it("keeps independent snapshots and bounds history", () => {
    const current = board(); let history = checkpoint([], current, "First");
    current.scenes[0].title = "Edited";
    expect(history[0].storyboard.scenes[0].title).toBe("one");
    for (let i = 0; i < 40; i++) history = checkpoint(history, current, String(i));
    expect(history).toHaveLength(30);
  });
  it("uses explicit scene cast, including an intentionally empty set", () => {
    expect(sceneReferences(scene("one"), [asset])).toHaveLength(1);
    expect(sceneReferences({ ...scene("one"), assetIds: [] }, [asset])).toEqual([]);
    expect(promptWithReferences({ ...scene("one"), assetIds: [asset.id] }, [asset])).toContain(assetHandle(asset));
  });
  it("stores references and project-scoped images without confusing reordered scenes", async () => {
    const ref = { name: "May", mimeType: "image/png", data: "aGVsbG8=", previewUrl: "data:image/png;base64,aGVsbG8=" };
    await saveReferences("media-test", [ref]);
    expect(await loadReferences("media-test")).toEqual([ref]);
    expect(await loadReferences("another-project")).toEqual([]);
    await writeAssets([{ ...asset, id: "image", kind: "scene", sceneId: "one" }]);
    expect((await readAssets()).find((item) => item.id === "image")).toMatchObject({ sceneId: "one", projectId: "test-project" });
  });
});

describe("portable archives", () => {
  const value = () => ({ format: "mm-storyboard" as const, version: 1 as const, project: { id: "test-project", title: "Coffee", savedAt: "2026-10-15", form, concepts: [concept], selectedConceptId: concept.id, storyboard: board(), history: checkpoint([], board(), "Original") }, references: [{ name: "May", mimeType: "image/png", data: "aGVsbG8=", previewUrl: "data:image/png;base64,aGVsbG8=" }], assets: [asset], presets: [{ id: "preset", name: "Coffee settings", settings: form }] });
  it("round-trips images, scene locks, history and presets while excluding credentials", async () => {
    const source = { ...value(), apiKey: "SECRET", endpoint: "private-host" };
    const blob = await createArchive(source);
    const result = await readArchive(new File([blob], "backup.zip"));
    expect(result.project.storyboard?.scenes[1].locked).toBe(true);
    expect(result.project.history).toHaveLength(1);
    expect(result.references[0].previewUrl).toContain("base64,aGVsbG8=");
    expect(result.assets[0].data).toBe(asset.data);
    expect(result.presets[0].name).toBe("Coffee settings");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("private-host");
  });
  it("restores Burmese drafts and valid English snapshots after archive serialization", async () => {
    const data = value(); const draft = data.project.storyboard;
    draft.promptLanguage = "my";
    draft.englishJson = JSON.stringify(board());
    draft.englishSource = draftSource(draft, form);
    const result = await readArchive(new File([await createArchive(data)], "draft.zip"));
    expect(result.project.storyboard?.promptLanguage).toBe("my");
    expect(translatedBoard(result.project.storyboard!, form)).not.toBeNull();
  });
  it("retains the creative brief and concept with a historical storyboard", async () => {
    const data = value();
    data.project.storyboard.referencePlan = [{ id: "pending", kind: "background", title: "Cafe", prompt: "Warm cafe", sceneIds: ["one"] }];
    data.project.history[0].concept = concept;
    data.project.history[0].form = form;
    const result = await readArchive(new File([await createArchive(data)], "history.zip"));
    expect(result.project.storyboard?.referencePlan?.[0].id).toBe("pending");
    expect(result.project.history?.[0].concept?.id).toBe(concept.id);
    expect(result.project.history?.[0].form?.topic).toBe("Coffee");
  });
  it("rejects a malformed archive before it can replace the project", async () => {
    const zip = new JSZip(); zip.file("project.json", JSON.stringify({ ...value(), version: 9 }));
    await expect(readArchive(new File([await zip.generateAsync({ type: "blob" })], "bad.zip"))).rejects.toThrow("unsupported");
  });
  it("rejects missing linked assets and duplicate scene IDs", async () => {
    for (const broken of ["missing asset", "duplicate scene"]) {
      const data = value();
      if (broken === "missing asset") data.project.storyboard.scenes[0].assetIds = ["nonexistent"];
      else data.project.storyboard.scenes[1].id = "one";
      const blob = await createArchive(data);
      await expect(readArchive(new File([blob], "bad.zip"))).rejects.toThrow(broken === "missing asset" ? "missing a linked" : "duplicate scene");
    }
  });
});

describe("editor workflow", () => {
  async function openEditor() {
    localStorage.setItem("mm-storyboard-current", JSON.stringify({ projectId: "editor-test", form, concepts: [concept], selectedConceptId: concept.id, storyboard: board(), history: [] }));
    render(<App />);
    await waitFor(() => expect(screen.getAllByLabelText("Scene title")).toHaveLength(2));
    await waitFor(() => expect((screen.getByText("New project", { exact: false }).closest("button") as HTMLButtonElement).disabled).toBe(false));
  }
  it("disables locked fields, approves a scene, and keeps feedback with the frame", async () => {
    await openEditor();
    const titles = screen.getAllByLabelText("Scene title") as HTMLInputElement[];
    expect(titles[1].disabled).toBe(true);
    fireEvent.change(titles[0], { target: { value: "Better hook" } });
    fireEvent.change(screen.getByLabelText("Review status scene 1"), { target: { value: "approved" } });
    expect(titles[0].value).toBe("Better hook"); expect(titles[0].disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /Locked · unlock/ })).toHaveLength(2);
  });
  it("saves an unsaved draft and its images before starting a clean topic", async () => {
    const ref = { name: "Draft reference", mimeType: "image/png", data: "aGVsbG8=", previewUrl: "data:image/png;base64,aGVsbG8=" };
    await saveReferences("editor-test", [ref]);
    await openEditor();
    fireEvent.change(screen.getAllByLabelText("Scene title")[0], { target: { value: "Unsaved change" } });
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    await waitFor(() => expect((screen.getByLabelText(/What video do you want to make/) as HTMLTextAreaElement).value).toBe(""));
    const saved = JSON.parse(localStorage.getItem("mm-storyboard-saved-projects")!)[0];
    expect(saved.storyboard.scenes[0].title).toBe("Unsaved change");
    expect(await loadReferences(saved.id)).toEqual([ref]);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    await waitFor(() => expect((screen.getAllByLabelText("Scene title")[0] as HTMLInputElement).value).toBe("Unsaved change"));
    expect(JSON.parse(localStorage.getItem("mm-storyboard-current")!).form.referenceNotes).toBe("");
  });
  it("keeps the current draft open when saving before a switch fails", async () => {
    await openEditor();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "mm-storyboard-saved-projects") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, key, value);
    });
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    await waitFor(() => expect(screen.getByText(/Could not save your draft/)).toBeTruthy());
    expect((screen.getAllByLabelText("Scene title")[0] as HTMLInputElement).value).toBe("one");
    expect(JSON.parse(localStorage.getItem("mm-storyboard-current")!).projectId).toBe("editor-test");
  });
  it("marks an unlocked approved scene as needing review", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Review status scene 1"), { target: { value: "approved" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Locked · unlock/ })[0]);
    expect((screen.getByLabelText("Review status scene 1") as HTMLSelectElement).value).toBe("review");
  });
  it("restores a version after editing and keeps the replaced board in history", async () => {
    await openEditor();
    fireEvent.click(screen.getAllByRole("button", { name: /Locked · unlock/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    const title = screen.getAllByLabelText("Scene title")[0] as HTMLInputElement;
    fireEvent.change(title, { target: { value: "New title" } });
    const versions = screen.getByLabelText("Storyboard version") as HTMLSelectElement;
    const saved = Array.from(versions.options).find((option) => option.text.includes("Saved version"))!;
    fireEvent.change(versions, { target: { value: saved.value } });
    fireEvent.click(screen.getByRole("button", { name: "Restore version" }));
    expect((screen.getAllByLabelText("Scene title")[0] as HTMLInputElement).value).toBe("one");
    expect(Array.from(versions.options).some((option) => option.text.includes("Before restoring"))).toBe(true);
  });
  it("regenerates only selected unlocked prompts and preserves locked content", async () => {
    localStorage.setItem("mm-storyboard-gemini-key", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ scene: { title: "Repaired", flowPrompt: completeRegeneratedFlowPrompt, sfx: "Quiet ceramic cup movement", backgroundMusic: "Soft understated instrumental music", locked: false, id: "bad-id" } }) }] } }] }), { status: 200 }));
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Select unlocked" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate selected prompts" }));
    await waitFor(() => expect((screen.getAllByLabelText("Scene title")[0] as HTMLInputElement).value).toBe("Repaired"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getAllByLabelText("Scene title")[1] as HTMLInputElement).value).toBe("two");
    expect((screen.getAllByLabelText("Scene title")[1] as HTMLInputElement).disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem("mm-storyboard-current")!).storyboard.scenes[0].id).toBe("one");
  });
  it("generates only missing prompts without rebuilding completed scenes", async () => {
    localStorage.setItem("mm-storyboard-gemini-key", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ scene: { title: "Completed scene", objective: "Show May lifting the cup", visualDescription: "May sits at a wooden table in a sunlit cafe", shotSize: "Medium close-up", cameraMovement: "Slow push-in", lighting: "Warm daylight", mood: "Calm and welcoming", action: "May lifts a ceramic cup", flowPrompt: completeRegeneratedFlowPrompt, audioNotes: "Quiet cafe ambience", negativePrompt: "No text, logos, flicker or extra hands", openingFrame: "The cup rests on the table", finalFrame: "May holds the cup at chest height", sfx: "Quiet ceramic cup movement", backgroundMusic: "Soft understated instrumental music" } }) }] } }] }), { status: 200 }));
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate missing prompts" }));
    await waitFor(() => expect(screen.getByText("1 scene(s) updated; 0 failed. Locked scenes were preserved.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getAllByLabelText(/Google Flow prompt/)[0] as HTMLTextAreaElement).value).toBe(scene("one").flowPrompt);
  });
  it("adds a blank scene, moves and deletes it, and applies presets without replacing the topic", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    expect(screen.getAllByLabelText("Scene title")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Move scene 3 up" }));
    expect((screen.getAllByLabelText("Scene title")[1] as HTMLInputElement).value).toBe("New scene");
    fireEvent.click(screen.getByRole("button", { name: "Delete scene 2" }));
    expect(screen.getAllByLabelText("Scene title")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Production settings/ }));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "My preset" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    const preset = JSON.parse(localStorage.getItem("mm-storyboard-presets")!)[0];
    expect(preset.settings.topic).toBeUndefined(); expect(preset.settings.referenceImages).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/What video do you want to make/), { target: { value: "Tea" } });
    fireEvent.change(screen.getByLabelText("Production preset"), { target: { value: preset.id } });
    expect((screen.getByLabelText(/What video do you want to make/) as HTMLTextAreaElement).value).toBe("Tea");
  });
});


describe("Gemini JSON generation", () => {
  it("allows larger storyboard responses and rejects token-truncated JSON clearly", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"scenes":[' }] } }],
      })),
    );
    await expect(generateJson("key", "gemini-test-flash", "Return a complete storyboard JSON object")).rejects.toThrow(/output token limit/i);
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.generationConfig.maxOutputTokens).toBe(16384);
  });

  it("does not accept malformed partial JSON as a generated prompt package", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"scenes":[' }] } }] })),
    );
    await expect(generateJson("key", "gemini-test-flash", "Return JSON")).rejects.toThrow(/incomplete JSON/i);
  });
});

describe("Gemini model discovery", () => {
  const model = (id: string) => ({ name: "models/" + id, displayName: id, supportedGenerationMethods: ["generateContent"] });
  it("loads every page and excludes image/audio/embedding models", async () => {
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [model("gemini-test-flash"), model("gemini-test-tts"), model("gemini-test-image"), { name: "models/embedding", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "page 2" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [model("gemini-test-pro"), model("gemini-test-flash")] })));
    expect((await listGeminiModels("key")).map((item) => item.id)).toEqual(["gemini-test-flash", "gemini-test-pro"]);
    expect(String(request.mock.calls[1][0])).toContain("pageToken=page+2");
    expect(request.mock.calls[0][1]?.headers).toEqual({ "x-goog-api-key": "key" });
  });
  it("surfaces rejected keys and empty compatible lists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 403 })).mockResolvedValueOnce(new Response(JSON.stringify({ models: [] })));
    await expect(listGeminiModels("bad")).rejects.toThrow("Invalid key");
    await expect(listGeminiModels("empty")).rejects.toThrow("No compatible");
  });
  it("lets users choose a discovered model and saves it without typing an ID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ models: [model("gemini-test-flash"), model("gemini-test-pro")] })));
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
    fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "test-key" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /gemini-test-pro/ })).toBeTruthy(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText(/Gemini API model/), { target: { value: "gemini-test-pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(localStorage.getItem("mm-storyboard-gemini-model")).toBe("gemini-test-pro");
    fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
    await waitFor(() => expect(screen.getByRole("option", { name: /gemini-test-flash/ })).toBeTruthy(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText(/Gemini API model/), { target: { value: "gemini-test-flash" } });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(localStorage.getItem("mm-storyboard-gemini-model")).toBe("gemini-test-pro");
  });
});



describe("screenplay approval workflow", () => {
  const reply = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }));
  it("waits for screenplay and reference approval, preserves edits and invalidates old prompts", async () => {
    localStorage.setItem("mm-storyboard-gemini-key", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply({ choices: [1, 2, 3].map(n => ({ title: "ဇာတ်လမ်း " + n, screenplay: "အတွင်း။ ကော်ဖီဆိုင် — နေ့\nမေသည် ကော်ဖီသောက်သည်။ မေ: မင်္ဂလာပါ။" })) }))
      .mockResolvedValueOnce(reply({ screenplay: "ချောရေးမူ။ မေသည် ကော်ဖီခွက်ကို မလိုက်သည်။ မေ: မင်္ဂလာပါ။" }))
      .mockResolvedValueOnce(reply({ references: [{ id: "may", kind: "character", title: "မေ", description: "ဆံပင်တို၊ အပြာရောင်ဝတ်စုံ" }, { id: "cafe", kind: "background", title: "ကော်ဖီဆိုင်", description: "သစ်သားစားပွဲနှင့် ပြတင်းပေါက်" }], scenes: [{ id: "shot", title: "ကော်ဖီသောက်ချိန်", location: "ကော်ဖီဆိုင်", action: "မေသည်ခွက်ကိုမလိုက်သည်", dialogue: "မင်္ဂလာပါ", durationSeconds: 8, referenceIds: ["may", "cafe"] }] }))
      .mockImplementationOnce(async (_url, init) => {
        const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
        const approved = JSON.parse(prompt.split("\n").at(-1)!);
        expect(prompt).toContain("အနီရောင်ဝတ်စုံ");
        return reply({ ...board(), scenes: approved.scenes.map((s: { id: string }) => ({ ...scene(s.id), action: "model changed action", voiceover: "model changed dialogue", durationSeconds: 99 })) });
      });
    const app = render(<App />);
    await waitFor(() => expect((screen.getByRole("button", { name: "မြန်မာဇာတ်ညွှန်း ၃ မျိုးရေးပေး" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/What video do you want to make/), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "မြန်မာဇာတ်ညွှန်း ၃ မျိုးရေးပေး" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /ဇာတ်ညွှန်း [123] ရွေးမယ်/ })).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "English prompt ပြောင်းမယ်" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ဇာတ်ညွှန်း 2 ရွေးမယ်" }));
    fireEvent.change(screen.getByLabelText("မြန်မာဇာတ်ညွှန်း"), { target: { value: "မေကော်ဖီသောက်သည်။ User edit" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "ဇာတ်ညွှန်း ချောရေးပေး" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ချောရေးမူကို လက်ခံမယ်" })).toBeTruthy());
    expect((screen.getByLabelText("မြန်မာဇာတ်ညွှန်း") as HTMLTextAreaElement).value).toBe("မေကော်ဖီသောက်သည်။ User edit");
    fireEvent.click(screen.getByRole("button", { name: "ချောရေးမူကို လက်ခံမယ်" }));
    fireEvent.click(screen.getByRole("button", { name: "ဇာတ်ညွှန်းအတည်ပြုပြီး Character / Background စာရင်းထုတ်မယ်" }));
    await waitFor(() => expect(screen.getByLabelText("Reference 1 ဖော်ပြချက်")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const generate = () => screen.getByRole("button", { name: "အတည်ပြုထားသောစာရင်းဖြင့် Scene prompts ထုတ်မယ်" }) as HTMLButtonElement;
    expect(generate().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reference 1 ဖော်ပြချက်"), { target: { value: "ဆံပင်တို၊ အနီရောင်ဝတ်စုံ" } });
    fireEvent.click(screen.getByRole("button", { name: "Character / Background / Scene စာရင်း အတည်ပြုမယ်" }));
    expect(generate().disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.click(generate());
    await waitFor(() => expect(screen.getByRole("button", { name: "English prompt ပြောင်းမယ်" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const saved = JSON.parse(localStorage.getItem("mm-storyboard-current")!);
    expect(saved.storyboard.scenes[0]).toMatchObject({ durationSeconds: 8, voiceover: "မင်္ဂလာပါ", action: "မေသည်ခွက်ကိုမလိုက်သည်" });
    expect(saved.storyboard.referencePlan[0].prompt).toContain("အနီရောင်");
    expect(saved.screenplay.choices[1].versions[0]).toContain("User edit");
    fireEvent.change(screen.getByLabelText("Reference 1 ဖော်ပြချက်"), { target: { value: "အဝါရောင်ဝတ်စုံ" } });
    expect(generate().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "English prompt ပြောင်းမယ်" })).toBeNull();
    fireEvent.change(screen.getByLabelText("မြန်မာဇာတ်ညွှန်း"), { target: { value: "အသစ်ပြင်ထားသောဇာတ်လမ်း" } });
    expect(screen.queryByLabelText("Reference 1 ဖော်ပြချက်")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    app.unmount(); render(<App />);
    await waitFor(() => expect((screen.getByLabelText("မြန်မာဇာတ်ညွှန်း") as HTMLTextAreaElement).value).toBe("အသစ်ပြင်ထားသောဇာတ်လမ်း"));
    expect(screen.queryByRole("button", { name: "English prompt ပြောင်းမယ်" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("requires exactly three complete screenplay choices", () => {
    expect(() => screenplayWorkflowSchema.parse({ choices: [], selectedId: "" })).toThrow();
    expect(() => screenplayChoicesSchema.parse({ choices: [1, 2].map(n => ({ title: String(n), screenplay: "Draft" })) })).toThrow();
    expect(() => scriptInventorySchema.parse({ references: [], scenes: [{ id: "s", title: "Shot", location: "Park", action: "Walk", dialogue: "", durationSeconds: 8, referenceIds: ["unknown"] }] })).toThrow();
  });
});

describe("automatic character and background production", () => {
  const planning = { assets: [
    { kind: "character", title: "May", prompt: "One full-body character portrait, consistent clothes, plain backdrop", sceneIds: ["one"] },
    { kind: "background", title: "Cafe", prompt: "A warm cafe background plate, no people or text", sceneIds: ["one"] },
  ] };
  const textReply = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
  it("rejects unknown scenes, missing backgrounds, and reference overload", () => {
    expect(() => validateReferencePlan({ assets: [{ ...planning.assets[1], sceneIds: ["wrong"] }] }, board())).toThrow("protected scene");
    expect(validateReferencePlan({ assets: [] }, board())).toEqual([]);
    expect(() => validateReferencePlan({ assets: [...planning.assets, ...planning.assets] }, board())).toThrow("at most three");
  });
  it("saves successes, retries only missing images, preserves locks, and packages scene files", async () => {
    let current = board();
    const project = "auto-assets-" + crypto.randomUUID();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(textReply(planning))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_image: { data: "aGVsbG8=", mime_type: "image/png" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Quota" } }), { status: 429 }));
    const first = await prepareAutomaticAssets(current, form, project, "key", "model", (value) => { current = value; }, () => {}, () => false);
    expect(first.failed).toHaveLength(1);
    expect(current.scenes[0].assetIds).toHaveLength(1);
    expect(current.scenes[1]).toEqual(board().scenes[1]);
    expect(current.referencePlan).toHaveLength(2);
    await expect(flowSceneBundle(current, (await readAssets()).filter((asset) => asset.projectId === project))).rejects.toThrow("Finish or retry");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ output_image: { data: "aGVsbG8=", mime_type: "image/png" } })));
    await prepareAutomaticAssets(current, form, project, "key", "model", (value) => { current = value; }, () => {}, () => false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(current.scenes[0].assetIds).toHaveLength(2);
    const images = (await readAssets()).filter((asset) => asset.projectId === project);
    const zip = await JSZip.loadAsync(await flowSceneBundle(current, images));
    expect(await zip.file("scene-01/prompt.txt")!.async("string")).toContain("Visual references");
    expect(Object.keys(zip.files).filter((path) => path.endsWith(".png"))).toHaveLength(2);
    expect(await zip.file("scene-01/voiceover.txt")!.async("string")).toBe("Hello");
  });
});


it("prepares reusable Flow image prompts without calling the image API", async () => {
  const current = board();
  const value = { assets: [{ kind: "background", title: "Cafe", prompt: "Sunlit cafe with wooden tables, no people", sceneIds: ["one"] }] };
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] })));
  const result = await prepareAutomaticAssets(current, form, "flow-only", "key", "model", () => {}, () => {}, () => false, true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0][0])).not.toContain("interactions");
  expect(result.board.scenes[0].assetIds).toBeUndefined();
  expect(referenceImagePrompt(result.board.referencePlan![0], form)).toContain("No people, characters or silhouettes");
  expect(referencePromptPack(result.board, form)).toContain("Use in scenes: 1 - one");
});


describe("complete manual Flow prompt package", () => {
  it("exports reference, opening image and video prompts without generated pictures", async () => {
    const current = board();
    current.referencePlan = [
      { id: "cast", kind: "character", title: "May", prompt: "Woman with short hair and a blue dress", sceneIds: ["one"] },
      { id: "product", kind: "prop", title: "Cup", prompt: "One red ceramic coffee cup with a round handle", sceneIds: ["one"] },
    ];
    expect(referenceCode(current.referencePlan[0], current)).toBe("C01");
    expect(referenceCode(current.referencePlan[1], current)).toBe("P01");
    expect(scenePreparationMode(current.scenes[0], current)).toBe("image-to-video");
    expect(scenePreparationMode(current.scenes[1], current)).toBe("text-to-video");
    expect(sceneImagePrompt(current.scenes[0], current, form)).toContain("blue dress");
    expect(sceneVideoPrompt(current.scenes[0], current)).toContain("red ceramic");
    expect(completePromptText(current, form)).toContain("SCENE IMAGE PROMPT:");
    const zip = await JSZip.loadAsync(await promptPackageZip(current, form));
    expect(zip.file("references/C01.txt")).toBeTruthy();
    expect(zip.file("references/P01.txt")).toBeTruthy();
    expect(await zip.file("scene-01/instructions.txt")!.async("string")).toContain("C01");
    expect(await zip.file("scene-02/instructions.txt")!.async("string")).toContain("optional");
    expect(zip.file("scene-01/scene-image-prompt.txt")).toBeTruthy();
    expect(zip.file("scene-01/video-prompt.txt")).toBeTruthy();
    expect(scenePreparationMode({ ...current.scenes[0], preparationMode: "text-to-video" }, current)).toBe("text-to-video");
  });
});


it("rechecks characters in scenes already covered by backgrounds without changing locks or images", async () => {
  const current = board();
  current.scenes[0].assetIds = ["saved-image"];
  current.referencePlan = [{ id: "location", kind: "background", title: "Cafe", prompt: "Sunlit cafe with wooden tables, no people", sceneIds: ["one", "two"] }];
  const assets = [
    { kind: "character", title: "May", prompt: "Woman with short hair and a blue dress, neutral backdrop", sceneIds: ["one", "two"] },
    { kind: "background", title: "Cafe", prompt: "A replacement description must not overwrite saved prompts", sceneIds: ["one"] },
  ];
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ assets }) }] } }] })));
  const first = await prepareAutomaticAssets(current, form, "recheck", "key", "model", () => {}, () => {}, () => false, true);
  expect(first.board.referencePlan).toHaveLength(2);
  expect(first.board.referencePlan![0]).toEqual(current.referencePlan[0]);
  expect(first.board.scenes).toEqual(current.scenes);
  const second = await prepareAutomaticAssets(first.board, form, "recheck", "key", "model", () => {}, () => {}, () => false, true);
  expect(second.board.referencePlan).toEqual(first.board.referencePlan);
  expect(request).toHaveBeenCalledTimes(2);
});


describe("multi-view Flow reference sheets", () => {
  it("creates labeled 16:9 character turnarounds and four-angle backgrounds", async () => {
    const current = board();
    current.referencePlan = [
      { id: "leo", kind: "character", title: "Leo", prompt: "Boy with curly brown hair, blue shirt and red shoes", sceneIds: ["one"] },
      { id: "park", kind: "background", title: "Park", prompt: "A park with an oak tree beside a wooden bench", sceneIds: ["one"] },
    ];
    const animated = { ...form, visualStyle: "3D animation" as const };
    const character = referenceImagePrompt(current.referencePlan[0], animated);
    expect(character).toContain("3D Pixar/Disney animation style");
    expect(character).toContain("Aspect ratio: 16:9");
    expect(character).toContain("front view, 3/4 view, side view, and back view");
    expect(character).toContain("happy, surprised, thoughtful, and neutral");
    expect(character).toContain('"Name: Leo"');
    expect(character).toContain("bold black text on a yellow");
    expect(character).not.toContain("NO TEXT IN THE IMAGE");
    const background = referenceImagePrompt(current.referencePlan[1], animated);
    expect(background).toContain("2x2 grid");
    expect(background).toContain("D / LEFT VIEW");
    expect(background).toContain("No people, characters or silhouettes");
    expect(background).not.toContain("--ar");
    expect(sceneVideoPrompt(current.scenes[0], current)).toContain("B01 (Park) angle key");
    expect(sceneImagePrompt(current.scenes[0], current, animated)).toContain("never a turnaround, grid, name tag");
    const zip = await JSZip.loadAsync(await promptPackageZip(current, animated));
    expect(await zip.file("references/C01.txt")!.async("string")).toContain(character);
    expect(await zip.file("references/B01.txt")!.async("string")).toContain(background);
    expect(referenceImagePrompt(current.referencePlan[0], form)).toContain("Cinematic live action");
  });
});


it("packages Burmese steps, named angles, audio and continuation start frames", async () => {
  const current = board();
  current.scenes[0].handoff = "CONTINUATION";
  current.scenes[1].backgroundAngle = "C";
  current.scenes[1].sfx = "Footsteps";
  current.scenes[1].backgroundMusic = "Soft piano";
  current.referencePlan = [{ id: "park", kind: "background", title: "Park", prompt: "A green park with one bench and a stone path", sceneIds: ["two"] }];
  expect(sceneBackground(current.scenes[1], current)).toContain("B01 — Park — C / back");
  expect(sceneVideoPrompt(current.scenes[1], current)).toContain("actual final frame of the preceding clip");
  expect(sceneVideoPrompt(current.scenes[1], current)).toContain("(00:00-00:08)");
  expect(sceneInstructions(current.scenes[1], current)).toContain("Scene 1 clip");
  expect(sceneVideoPrompt(current.scenes[0], current)).not.toContain("actual final frame of the preceding clip");
  const zip = await JSZip.loadAsync(await promptPackageZip(current, form));
  expect(await zip.file("START-HERE-MM.txt")!.async("string")).toContain("Flow မှာလုပ်ရန်");
  expect(await zip.file("scene-02/audio.txt")!.async("string")).toBe("SFX: Footsteps\nBackground Music: Soft piano");
  expect(zip.file("scene-02/caption.txt")).toBeTruthy();
  current.scenes[0].handoff = "CUT";
  expect(sceneVideoPrompt(current.scenes[1], current)).not.toContain("actual final frame of the preceding clip");
});


it("includes existing visual details and constraints in the copied/exported video prompt", async () => {
  const current = board();
  current.visualBible = "Warm hand-painted ceramic textures";
  current.continuityRules = ["Keep the cup in the right hand"];
  const shot = current.scenes[0];
  shot.lighting = "Soft window key from camera left";
  shot.negativePrompt = "No duplicate cup";
  const prompt = sceneVideoPrompt(shot, current);
  for (const detail of [shot.openingFrame, shot.visualDescription, shot.shotSize, shot.lighting, current.visualBible, current.continuityRules[0], shot.negativePrompt]) expect(prompt).toContain(detail);
  expect(prompt).toContain("DURATION: 8 seconds");
  const zip = await JSZip.loadAsync(await promptPackageZip(current, form));
  expect(await zip.file("scene-01/video-prompt.txt")!.async("string")).toBe(prompt);
});


it("persists a pasted key immediately and restores it after remount without model discovery", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
  const app = render(<App />);
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "  persisted-test-key  " } });
  expect(localStorage.getItem("mm-storyboard-gemini-key")).toBe("persisted-test-key");
  expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  app.unmount();
  render(<App />);
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  expect((screen.getByLabelText(/Gemini API key/) as HTMLInputElement).value).toBe("persisted-test-key");
  fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "" } });
  expect(localStorage.getItem("mm-storyboard-gemini-key")).toBe("persisted-test-key");
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  expect(localStorage.getItem("mm-storyboard-gemini-key")).toBeNull();
});

it("reports blocked key storage instead of claiming that the key was saved", () => {
  render(<App />);
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "mm-storyboard-gemini-key") throw new Error("Blocked");
    return original.call(this, key, value);
  });
  fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "unsaved-test-key" } });
  expect(screen.getByText(/API key could not be saved/)).toBeTruthy();
  expect(localStorage.getItem("mm-storyboard-gemini-key")).toBeNull();
});


it("keeps Burmese drafts and translated English separate, invalidates exports after editing", () => {
  const draft = board(); draft.promptLanguage = "my";
  draft.scenes[0].flowPrompt = "မေသည် ကော်ဖီခွက်ကို ကိုင်လိုက်သည်";
  const raw = structuredClone(draft); raw.scenes[0].flowPrompt = "May picks up her coffee cup";
  raw.scenes[0].durationSeconds = 99; raw.scenes[0].voiceover = "Changed speech";
  const english = validateTranslation(raw, draft);
  expect(english.scenes[0].durationSeconds).toBe(8);
  expect(english.scenes[0].voiceover).toBe(draft.scenes[0].voiceover);
  draft.englishSource = draftSource(draft, form); draft.englishJson = JSON.stringify(english);
  expect(translatedBoard(draft, form)?.scenes[0].flowPrompt).toBe("May picks up her coffee cup");
  expect(draft.scenes[0].flowPrompt).toContain("မေသည်");
  const onTranslate = vi.fn(); const onChange = vi.fn();
  const ui = render(<BurmeseDraftEditor board={draft} form={form} busy={false} onChange={onChange} onTranslate={onTranslate} onSave={() => {}} onRetryReferences={() => {}} />);
  expect((screen.getByRole("button", { name: "Download English ZIP" }) as HTMLButtonElement).disabled).toBe(false);
  draft.scenes[0].action = "New edited action";
  expect(translatedBoard(draft, form)).toBeNull();
  ui.rerender(<BurmeseDraftEditor board={draft} form={form} busy={false} onChange={onChange} onTranslate={onTranslate} onSave={() => {}} onRetryReferences={() => {}} />);
  expect(screen.getByText(/English ပြန်ပြောင်းရန်လိုသည်/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Download English ZIP" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onTranslate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "English prompt ပြောင်းမယ်" }));
  expect(onTranslate).toHaveBeenCalledOnce();
  raw.scenes.pop(); expect(() => validateTranslation(raw, draft)).toThrow(/scene IDs/);
});


it("persists screenplay approvals through ZIP and rejects unapproved scene generation", async () => {
  const workflow: ScreenplayWorkflow = { choices: [{ id: "choice", title: "Coffee", screenplay: "မေကော်ဖီသောက်သည်", versions: ["မူဟောင်း"] }], selectedId: "choice" };
  workflow.approvedScript = scriptSource(workflow, form);
  workflow.inventory = { source: scriptSource(workflow, form), references: [], scenes: [{ id: "one", title: "Coffee", location: "Cafe", action: "Drink", dialogue: "Hello", durationSeconds: 8, referenceIds: [] }] };
  expect(() => bindApprovedBoard(board(), workflow, form)).toThrow("Approve");
  workflow.approvedInventory = inventorySource(workflow, form);
  const output = bindApprovedBoard({ ...board(), scenes: [scene("one")] }, workflow, form);
  const project = { id: "screenplay-project", title: "Coffee", savedAt: "2026-10-22", form, concepts: [], selectedConceptId: "", storyboard: output, screenplay: workflow };
  const archive = await readArchive(new File([await createArchive({ format: "mm-storyboard", version: 1, project, references: [], assets: [], presets: [] })], "screenplay.zip"));
  expect(inventoryApproved(archive.project.screenplay!, form)).toBe(true);
  expect(pipelineCurrent(archive.project.screenplay, form, archive.project.storyboard)).toBe(true);
  expect(archive.project.screenplay?.choices[0].versions).toEqual(["မူဟောင်း"]);
  expect(pipelineCurrent(workflow, { ...form, targetDuration: 30 }, output)).toBe(false);
  expect(() => bindApprovedBoard({ ...board(), scenes: [scene("wrong")] }, workflow, form)).toThrow("changed");
});
