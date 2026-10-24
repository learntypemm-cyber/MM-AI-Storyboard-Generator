import { afterEach, describe, expect, it, vi } from "vitest";
import { generateJson } from "./gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateJson", () => {
  it("requests the Gemini 3 model output limit and parses valid JSON", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify({ ok: true }) }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateJson<{ ok: boolean }>("test-key", "gemini-3.8-flash", "Return JSON."))
      .resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBeTruthy();
    const body = JSON.parse(String(request?.body));
    expect(body.generationConfig.maxOutputTokens).toBe(65536);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("reports the increased output limit when Gemini truncates JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"partial":' }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(generateJson("test-key", "gemini-3.8-flash", "Return a large JSON object."))
      .rejects.toThrow(/output token limit \(65,536 tokens\)/);
  });
});
