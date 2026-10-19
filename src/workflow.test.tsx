// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "fake-indexeddb/auto";
import JSZip from "jszip";
import App from "./App";
import { checkpoint, patchScene, reorderScene, sceneRepairPatch } from "./lib/boardEditing";
import { assetHandle, promptWithReferences, readAssets, sceneReferences, writeAssets } from "./lib/assetStore";
import { createArchive, readArchive } from "./lib/projectArchive";
import { loadReferences, saveReferences } from "./lib/projectMedia";
import type { ImageAsset, Scene, Storyboard, VideoForm } from "./types";

const scene = (id: string, locked = false): Scene => ({ id, locked, sceneNumber: id === "one" ? 1 : 2, title: id, durationSeconds: 8, objective: "Show the product", visualDescription: "A table", shotSize: "Close up", cameraMovement: "Static", lighting: "Daylight", mood: "Warm", action: "Lift cup", flowPrompt: "NO TEXT IN THE IMAGE. Opening frame: a cup. Final frame: a cup raised.", voiceover: "Hello", onscreenText: "", audioNotes: "Quiet", transition: "Cut", referenceAssets: [], negativePrompt: "No text", openingFrame: "A cup", finalFrame: "A cup raised", handoff: "CUT" });
const board = (): Storyboard => ({ projectTitle: "Coffee", logline: "A coffee story", visualBible: "Warm", continuityRules: [], globalNegativePrompt: "No fake UI", productionNotes: [], scenes: [scene("one"), scene("two", true)] });
const form: VideoForm = { topic: "Coffee", goal: "Promote", platform: "TikTok", targetDuration: 16, language: "Burmese", audience: "Coffee fans", visualStyle: "Cinematic live action", aspectRatio: "9:16", flowModel: "Veo 3.1 Fast", generationMode: "Text to Video", clipDuration: 8, audioPolicy: "Quiet", textPolicy: "No text", referenceNotes: "", referenceImages: [] };
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
  it("retains the creative brief and concept with a historical storyboard", async () => {
    const data = value();
    data.project.history[0].concept = concept;
    data.project.history[0].form = form;
    const result = await readArchive(new File([await createArchive(data)], "history.zip"));
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ scene: { title: "Repaired", flowPrompt: "NO TEXT IN THE IMAGE. Repaired prompt", locked: false, id: "bad-id" } }) }] } }] }), { status: 200 }));
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ scene: { flowPrompt: "NO TEXT IN THE IMAGE. Newly generated." } }) }] } }] }), { status: 200 }));
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
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "My preset" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    const preset = JSON.parse(localStorage.getItem("mm-storyboard-presets")!)[0];
    expect(preset.settings.topic).toBeUndefined(); expect(preset.settings.referenceImages).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/What video do you want to make/), { target: { value: "Tea" } });
    fireEvent.change(screen.getByLabelText("Production preset"), { target: { value: preset.id } });
    expect((screen.getByLabelText(/What video do you want to make/) as HTMLTextAreaElement).value).toBe("Tea");
  });
});
