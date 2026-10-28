import { describe, expect, it } from "vitest";
import type { Scene, Storyboard } from "../types";
import { cinematicAnimationPrompt, existingTimedBeats } from "./animationPrompt";
import { sceneVideoPrompt } from "./promptPackage";

const scene = {
  id: "scene-1", sceneNumber: 1, title: "At the bus stop", durationSeconds: 8,
  openingFrame: "Bobo holds his wallet and Mohmoh waits beside the blue travel bag",
  action: "Bobo looks for money in the wallet while Mohmoh speaks",
  finalFrame: "Bobo holds the ticket and smiles at Mohmoh",
  flowPrompt: "Keep the ticket counter and bus in the shot",
  voiceover: 'Mohmoh: "ဘိုဘိုရေ မြန်မြန်လုပ်၊ ကားထွက်တော့မယ်။"',
  shotSize: "Medium", cameraMovement: "A gentle slow push-in",
  audioNotes: "Quiet bus engine", sfx: "Distant station chatter", backgroundMusic: "Subtle upbeat music",
  onscreenText: "", visualDescription: "Bus station ticket counter", lighting: "Warm daylight", mood: "Excited",
  negativePrompt: "No extra passengers", handoff: "CUT",
  referenceAssets: [], transition: "Cut", objective: "Get ticket",
} as Scene;
const board = {
  scenes: [scene], visualBible: "3D animation", continuityRules: ["Keep Bobo's wallet brown", "Keep Mohmoh's bag blue"],
  globalNegativePrompt: "No duplicate characters", referencePlan: [],
} as unknown as Storyboard;
const settings = { language: "en" as const, background: "Bus station", imageMode: true, references: "BOBO; MOHMOH" };

describe("cinematic animation prompts", () => {
  it("formats an 8-second one-clip animation with three timecoded action beats and exact dialogue", () => {
    const text = sceneVideoPrompt(scene, board);
    for (const label of ["0:00–0:02", "0:02–0:05", "0:05–0:08", "CAMERA:", "CHARACTER CONTINUITY:", "AUDIO:", "DIALOGUE:", "ENDING FRAME:"]) expect(text).toContain(label);
    expect(text).toContain(scene.voiceover);
    expect(text).toContain("No subtitles, on-screen text or watermarks.");
    expect(text).toContain(scene.openingFrame);
    expect(text).toContain(scene.action);
    expect(text).toContain(scene.finalFrame);
    expect(text).not.toContain("0:08–0:10");
    expect(text).not.toContain("00:00–00:08\n\n00:00");
  });

  it("uses contiguous authored beats without inventing extra actions", () => {
    const authored = [
      "00:00-00:02\nBobo looks toward the counter.",
      "00:02-00:05\nBobo searches inside the wallet.",
      "00:05-00:08\nBobo takes the ticket.",
    ].join("\n\n");
    expect(existingTimedBeats(authored, 8)).toHaveLength(3);
    const output = cinematicAnimationPrompt({ ...scene, flowPrompt: authored }, board, settings);
    expect(output).toContain("Bobo searches inside the wallet.");
    expect(output).toContain("Bobo takes the ticket.");
    expect(output).not.toContain("SCENE DIRECTION:");
    expect((output.match(/0:02–0:05/g) || [])).toHaveLength(1);
  });

  it("reads AI-generated inline action times rather than duplicating an invented competing timeline", () => {
    const inline = "00:00-00:03 Bobo walks toward the entrance. 00:03-00:06 Myamya turns and says hello. 00:06-00:08 Bobo raises his arms.";
    const parsed = existingTimedBeats(inline, 8);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].description).toBe("Bobo walks toward the entrance.");
    expect(parsed[1].description).toBe("Myamya turns and says hello.");
    const video = cinematicAnimationPrompt({ ...scene, flowPrompt: inline }, board, settings);
    for (const range of ["0:00–0:03", "0:03–0:06", "0:06–0:08"]) expect(video).toContain(range);
    expect(video).not.toContain("0:00–0:02");
    expect(video).not.toContain("SCENE DIRECTION:");
    expect(video).not.toContain("ADDITIONAL SCENE DETAIL:");
    expect((video.match(/Myamya turns and says hello\./g) || [])).toHaveLength(1);
  });

  it("rejects malformed timeline ranges and adapts legacy scenes to clip duration without new events", () => {
    expect(existingTimedBeats("00:00-00:02\nFirst\n00:04-00:08\nSecond", 8)).toHaveLength(0);
    const short = cinematicAnimationPrompt({ ...scene, durationSeconds: 4 }, board, settings);
    expect(short).toContain("0:00–0:01");
    expect(short).toContain("0:01–0:03");
    expect(short).toContain("0:03–0:04");
    expect(short).not.toContain("0:05–0:08");
    expect(short).not.toContain("a second ticket");
  });

  it("uses the previous final frame instead of contradicting the starting image", () => {
    const output = cinematicAnimationPrompt(scene, board, { ...settings, startFromPrevious: "Both standing at the bus door" });
    expect(output).toContain("Use the actual final frame of the preceding clip");
    expect(output).toContain("not a different opening still");
    expect(output).toContain("Both standing at the bus door");
  });

  it("preserves approved custom full video prompts", () => {
    const userPrompt = "User approved scene video prompt; preserve verbatim.";
    expect(sceneVideoPrompt({ ...scene, fullVideoPrompt: userPrompt }, board)).toBe(userPrompt);
  });
});
