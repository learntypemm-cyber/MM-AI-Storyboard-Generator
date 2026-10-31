import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBurmeseWav, recapSrt, translateRecap } from "./recap";
import { recapFileError, RECAP_MAX_FILE_BYTES } from "./recapLimits";
import { groupWhisperWords } from "./recapSegments";

afterEach(() => vi.unstubAllGlobals());

describe("Recap API and exports", () => {
  it("accepts a 300 MB recap and rejects larger or longer files", () => {
    expect(recapFileError("recap.mp4", RECAP_MAX_FILE_BYTES, 600)).toBeNull();
    expect(recapFileError("recap.mp4", RECAP_MAX_FILE_BYTES + 1, 60)).toContain("300 MB");
    expect(recapFileError("recap.mp4", 1000, 601)).toContain("10 မိနစ်");
  });

  it("turns word timestamps into short reviewable narration units", () => {
    const lines = groupWhisperWords([
      { text: " Hello", timestamp: [0, 0.5] },
      { text: " there.", timestamp: [0.5, 1.8] },
      { text: " A", timestamp: [2, 2.5] },
      { text: " story", timestamp: [2.5, 4] },
      { text: " begins.", timestamp: [4, 5.2] },
    ]);
    expect(lines.map((line) => line.source)).toEqual(["Hello there.", "A story begins."]);
    expect(lines.map((line) => [line.start, line.end])).toEqual([[0, 1.8], [2, 5.2]]);
  });
  it("keeps IDs and catches missing translation lines", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: "one", text: "မင်္ဂလာပါ" }] }) }] } }] }) }));
    const lines = [{ id: "one", start: 0, end: 2, source: "Hello", burmese: "" }];
    await expect(translateRecap("key", "gemini-test", lines)).resolves.toEqual([{ ...lines[0], burmese: "မင်္ဂလာပါ" }]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("gemini-test:generateContent"), expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledTimes(3); // whole-story memory, translation, audit
    expect(recapSrt([{ ...lines[0], burmese: "မင်္ဂလာပါ" }])).toContain("00:00:00,000 --> 00:00:02,000");
  });

  it("returns playable WAV bytes from the TTS response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: btoa("RIFF") } }] } }] }) }));
    const wav = await generateBurmeseWav("key", "မင်္ဂလာပါ", "Kore");
    expect(wav.type).toBe("audio/wav");
    expect(await wav.text()).toBe("RIFF");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("gemini-3.8-flash-tts"), expect.anything());
  });
});
