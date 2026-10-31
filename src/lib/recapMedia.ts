import type { RecapLine } from "./recap";
import { groupWhisperWords } from "./recapSegments";

let ffmpegPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

async function getFFmpeg() {
  if (!ffmpegPromise) ffmpegPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);
    const ffmpeg = new FFmpeg();
    const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm") });
    return ffmpeg;
  })().catch((error) => { ffmpegPromise = null; throw error; });
  return ffmpegPromise;
}

export async function extractSpeechSamples(video: File): Promise<Float32Array> {
  const ffmpeg = await getFFmpeg();
  await ffmpeg.writeFile("recap-input.mp4", new Uint8Array(await video.arrayBuffer()));
  try {
    const exit = await ffmpeg.exec(["-y", "-i", "recap-input.mp4", "-vn", "-ac", "1", "-ar", "16000", "recap-speech.wav"]);
    if (exit !== 0) throw new Error("Could not extract audio from this video.");
    const wav = await ffmpeg.readFile("recap-speech.wav");
    const bytes = wav instanceof Uint8Array ? wav : new TextEncoder().encode(wav);
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      return decoded.getChannelData(0).slice();
    } finally { await context.close(); }
  } finally {
    await ffmpeg.deleteFile("recap-input.mp4").catch(() => undefined);
    await ffmpeg.deleteFile("recap-speech.wav").catch(() => undefined);
  }
}

export async function transcribeVideo(video: File, onProgress: (message: string) => void): Promise<RecapLine[]> {
  onProgress("Video မှ အသံခွဲထုတ်နေသည်…");
  const audio = await extractSpeechSamples(video);
  const result = await new Promise<any>((resolve, reject) => {
    const worker = new Worker(new URL("./recapWhisper.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; result?: any }>) => {
      if (event.data.type === "progress") onProgress(event.data.message || "Whisper processing…");
      if (event.data.type === "result") { resolve(event.data.result); worker.terminate(); }
      if (event.data.type === "error") { reject(new Error(event.data.message || "Whisper failed.")); worker.terminate(); }
    };
    worker.onerror = (event) => { reject(new Error(event.message || "Whisper worker failed.")); worker.terminate(); };
    worker.postMessage(audio, [audio.buffer]);
  });
  const chunks = Array.isArray(result.chunks) ? result.chunks : [];
  const lines = groupWhisperWords(chunks);
  if (lines.length) return lines;
  const text = String(result.text || "").trim();
  if (!text) throw new Error("Whisper did not detect speech in this video.");
  return [{ id: "line-1", start: 0, end: 0, source: text, burmese: "" }];
}

export type NarrationClip = { line: RecapLine; blob: Blob };

export async function composeNarration(clips: NarrationClip[], videoDuration: number): Promise<{ wav: Blob; timedLines: RecapLine[]; duration: number }> {
  const context = new AudioContext();
  try {
    const decoded = await Promise.all(clips.map(async ({ blob }) => context.decodeAudioData(await blob.arrayBuffer())));
    const sampleRate = 24000;
    const positions: { start: number; end: number }[] = [];
    let cursor = 0;
    for (let index = 0; index < clips.length; index++) {
      const start = Math.max(clips[index].line.start, cursor);
      const end = start + decoded[index].duration;
      positions.push({ start, end });
      cursor = end + 0.1;
    }
    const duration = Math.max(videoDuration, cursor);
    const output = new Float32Array(Math.ceil(duration * sampleRate));
    decoded.forEach((buffer, index) => {
      const source = buffer.getChannelData(0);
      const offset = Math.floor(positions[index].start * sampleRate);
      for (let sample = 0; sample < source.length && offset + sample < output.length; sample++) output[offset + sample] += source[sample];
    });
    const bytes = new ArrayBuffer(44 + output.length * 2);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
    write(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, output.length * 2, true);
    output.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true));
    return { wav: new Blob([bytes], { type: "audio/wav" }), timedLines: clips.map(({ line }, index) => ({ ...line, ...positions[index] })), duration };
  } finally { await context.close(); }
}

export async function renderRecap(video: File, narration: Blob, videoDuration: number, audioDuration: number, fitNarration: boolean): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  await ffmpeg.writeFile("recap-video.mp4", new Uint8Array(await video.arrayBuffer()));
  await ffmpeg.writeFile("recap-voice.wav", new Uint8Array(await narration.arrayBuffer()));
  try {
    const videoOptions = fitNarration
      ? ["-vf", `setpts=${(audioDuration / videoDuration).toFixed(6)}*(PTS-STARTPTS)`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
      : ["-c:v", "copy"];
    const exit = await ffmpeg.exec(["-y", "-i", "recap-video.mp4", "-i", "recap-voice.wav", "-map", "0:v:0", "-map", "1:a:0", ...videoOptions, "-c:a", "aac", "-af", "apad", "-t", String(fitNarration ? audioDuration : videoDuration), "recap-final.mp4"]);
    if (exit !== 0) throw new Error("Browser video render failed. Download the WAV and SRT, then try a shorter MP4.");
    const data = await ffmpeg.readFile("recap-final.mp4");
    return new Blob([data instanceof Uint8Array ? new Uint8Array(data) : data], { type: "video/mp4" });
  } finally {
    for (const name of ["recap-video.mp4", "recap-voice.wav", "recap-final.mp4"]) await ffmpeg.deleteFile(name).catch(() => undefined);
  }
}
