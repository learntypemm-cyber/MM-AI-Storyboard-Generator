import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Film, Mic2, Play, RefreshCw, Upload } from "lucide-react";
import { clearRecapDraft, downloadBlob, formatTime, generateBurmeseWav, readRecapDraft, recapSrt, saveRecapDraft, translateRecap } from "../lib/recap";
import type { RecapLine } from "../lib/recap";
import { composeNarration, renderRecap, transcribeVideo } from "../lib/recapMedia";
import { listGeminiModels } from "../lib/gemini";
import type { GeminiModelOption } from "../lib/gemini";
import { RECAP_MAX_DURATION_SECONDS, RECAP_MAX_FILE_BYTES, recapFileError } from "../lib/recapLimits";

const VOICES = [{ id: "Kore", label: "Kore" }, { id: "Puck", label: "Puck" }, { id: "Aoede", label: "Aoede" }];

export default function RecapStudio({ onBack }: { onBack: () => void }) {
  const saved = useMemo(readRecapDraft, []);
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [duration, setDuration] = useState(saved?.duration || 0);
  const [lines, setLines] = useState<RecapLine[]>(saved?.lines || []);
  const [voice, setVoice] = useState(saved?.voice || VOICES[0].id);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(saved ? "ယခင် Recap စာသားကို ပြန်ဖွင့်ထားသည်။ Video ဖိုင်ကို ပြန်ရွေးပါ။" : "");
  const [clips, setClips] = useState<Map<string, Blob>>(new Map());
  const [narration, setNarration] = useState<Blob | null>(null);
  const [timedLines, setTimedLines] = useState<RecapLine[]>([]);
  const [finalVideo, setFinalVideo] = useState<Blob | null>(null);
  const [fitNarration, setFitNarration] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState(() => localStorage.getItem("mm-storyboard-gemini-key") || "");
  const [model, setModel] = useState(() => localStorage.getItem("mm-storyboard-gemini-model") || "gemini-3.8-flash");
  const [models, setModels] = useState<GeminiModelOption[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const isTranscribing = busy === "transcribe";
  const isTranslating = busy === "translate";

  useEffect(() => {
    if (!lines.length) return;
    try { saveRecapDraft({ name: video?.name || saved?.name || "Recap", fileSize: video?.size || saved?.fileSize || 0, duration, lines, voice, updatedAt: new Date().toISOString() }); }
    catch { setError("Browser storage မလုံလောက်ပါ။ စာသားကို copy လုပ်ပြီး သိမ်းထားပါ။"); }
  }, [lines, voice, duration, video]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function resetAudio() { setNarration(null); setTimedLines([]); setFinalVideo(null); }
  function changeLine(index: number, field: "source" | "burmese", value: string) {
    setLines((current) => current.map((line, position) => position === index ? { ...line, [field]: value, ...(field === "source" ? { burmese: "" } : {}) } : line));
    resetAudio();
  }

  function addLine(index: number) {
    setLines((current) => {
      const anchor = current[index];
      const nextStart = anchor.end;
      const nextEnd = current[index + 1]?.start || duration;
      const line = { id: `line-${crypto.randomUUID()}`, start: nextStart, end: Math.max(nextStart, nextEnd), source: "", burmese: "" };
      return [...current.slice(0, index + 1), line, ...current.slice(index + 1)];
    });
    resetAudio();
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, position) => position !== index));
    resetAudio();
  }

  async function chooseVideo(file?: File) {
    if (!file) return;
    setError(""); setNotice("");
    const selectionError = recapFileError(file.name, file.size);
    if (selectionError) { setError(selectionError); return; }
    const url = URL.createObjectURL(file);
    try {
      const media = document.createElement("video");
      media.preload = "metadata"; media.src = url;
      const length = await new Promise<number>((resolve, reject) => { media.onloadedmetadata = () => resolve(media.duration); media.onerror = () => reject(new Error("Video metadata ဖတ်မရပါ။")); });
      const durationError = recapFileError(file.name, file.size, length);
      if (durationError) throw new Error(durationError);
      const matchesDraft = saved && saved.name === file.name && saved.fileSize === file.size;
      setVideo(file); setVideoUrl(url); setDuration(length); resetAudio(); setClips(new Map());
      if (!matchesDraft) { setLines([]); clearRecapDraft(); }
      else setNotice("Video နဲ့ သိမ်းထားတဲ့စာသားကို ပြန်ချိတ်ပြီးပါပြီ။");
      if (file.size > 200 * 1024 * 1024) setNotice("ဖိုင်ကြီးဖြစ်လို့ browser memory များများသုံးနိုင်ပါတယ်။ Transcript နဲ့ render ကြာနိုင်ပါတယ်။");
    } catch (caught) { URL.revokeObjectURL(url); setError(caught instanceof Error ? caught.message : "Video ဖတ်မရပါ။"); }
  }

  async function runTranscription() {
    if (!video) return;
    setBusy("transcribe"); setError(""); setNotice(""); resetAudio();
    try {
      const result = await transcribeVideo(video, setProgress);
      setLines(result.map((line) => ({ ...line, end: line.end || duration })));
      setNotice(`${result.length} စာကြောင်းထုတ်ပြီးပါပြီ။ မူရင်းစာသားကို စစ်ပြီးမှ ဘာသာပြန်ပါ။`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Transcript မထုတ်နိုင်ပါ။"); }
    finally { setBusy(""); setProgress(""); }
  }

  async function runTranslation() {
    if (!lines.length || lines.some((line) => !line.source.trim()) || !apiKeyDraft.trim()) { setError("Gemini API key နဲ့ transcript အပြည့်အစုံ လိုပါသည်။"); return; }
    setBusy("translate"); setError(""); resetAudio();
    try {
      localStorage.setItem("mm-storyboard-gemini-key", apiKeyDraft.trim());
      localStorage.setItem("mm-storyboard-gemini-model", model);
      setProgress("ဇာတ်လမ်းတစ်ခုလုံး၏ နာမည်နှင့်နေရာများ စစ်နေသည်…");
      setLines(await translateRecap(apiKeyDraft.trim(), model, lines, (current, done) => { setLines(current); setProgress(`မြန်မာဘာသာပြန်နှင့် audit ${done}/${lines.length} စာကြောင်း…`); }));
      setNotice("မြန်မာစာသားကို စစ်ပြီး လိုအပ်သလို ပြင်ပါ။ အသံကို ပြီးမှထုတ်ပါ။");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ဘာသာပြန်မရပါ။"); }
    finally { setBusy(""); setProgress(""); }
  }

  async function loadModels() {
    if (!apiKeyDraft.trim()) { setError("Gemini API key ထည့်ပါ။"); return; }
    setBusy("models"); setError("");
    try { setModels(await listGeminiModels(apiKeyDraft.trim())); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Model list မရပါ။"); }
    finally { setBusy(""); }
  }

  async function runNarration() {
    if (!video || !apiKeyDraft.trim() || !lines.length || lines.some((line) => !line.burmese.trim())) { setError("Video၊ API key နဲ့ မြန်မာစာသားအပြည့်အစုံ လိုပါသည်။"); return; }
    setBusy("voice"); setError(""); setFinalVideo(null);
    try {
      const next = new Map(clips);
      const generated = [];
      for (let index = 0; index < lines.length; index++) {
        setProgress(`မြန်မာအသံ ${index + 1}/${lines.length} ထုတ်နေသည်…`);
        const line = lines[index];
        const cacheKey = `${voice}:${line.id}:${line.burmese}`;
        let blob = next.get(cacheKey);
        if (!blob) { blob = await generateBurmeseWav(apiKeyDraft.trim(), line.burmese, voice); next.set(cacheKey, blob); setClips(new Map(next)); }
        generated.push({ line, blob });
      }
      const combined = await composeNarration(generated, duration);
      setNarration(combined.wav); setTimedLines(combined.timedLines);
      const url = URL.createObjectURL(combined.wav);
      setPreviewUrl(url);
      setNotice(combined.duration > duration + 0.25 ? "အသံက video ထက်ရှည်နေသည်။ ရုပ်အချိန်ညှိ mode ရွေးနိုင်သလို စာသားကို တိုအောင်လည်း ပြင်နိုင်ပါတယ်။" : "အသံ preview ကို နားထောင်ပြီး MP4 ထုတ်နိုင်ပါပြီ။");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "မြန်မာအသံ မထုတ်နိုင်ပါ။"); }
    finally { setBusy(""); setProgress(""); }
  }

  async function runRender() {
    if (!video || !narration) return;
    const maxSpeechEnd = timedLines.at(-1)?.end || 0;
    if (maxSpeechEnd > duration + 0.25 && !fitNarration) { setError("အသံက video ထက်ရှည်နေသည်။ ရုပ်အချိန်ညှိ mode ရွေးပါ သို့မဟုတ် စာသားကို တိုအောင်ပြင်ပါ။"); return; }
    if (fitNarration && maxSpeechEnd / duration > 1.5) { setError("အသံက video ထက် 50% ကျော်ရှည်နေသည်။ ရုပ်လှုပ်ရှားမှု မပျက်စေရန် စာသားကို အရင်တိုအောင်ပြင်ပါ။"); return; }
    setBusy("render"); setError(""); setProgress("Video ထဲ မြန်မာအသံ ထည့်နေသည်…");
    try { setFinalVideo(await renderRecap(video, narration, duration, maxSpeechEnd, fitNarration && maxSpeechEnd > duration + 0.25)); setNotice("Final MP4 ပြီးပါပြီ။ Video နဲ့ subtitle ကို download လုပ်ပါ။"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Video မထုတ်နိုင်ပါ။"); }
    finally { setBusy(""); setProgress(""); }
  }

  const translated = lines.length > 0 && lines.every((line) => line.burmese.trim());
  return <div className="recap-page">
    <header className="recap-header"><button onClick={onBack} className="recap-back"><ArrowLeft size={17} /> Studios</button><span>MM STORYBOARD</span><strong>Recap Studio</strong></header>
    <main className="recap-main">
      <div className="recap-hero"><div className="recap-eyebrow"><Film size={16} /> သီးခြား VIDEO WORKFLOW</div><h1>Video ကို မြန်မာလို ပြန်ထုတ်ပါ</h1><p>Video က user စက်ထဲမှာပဲ ရှိမယ်။ စာသားဘာသာပြန်နဲ့ အသံအတွက် Gemini API ကို သုံးမယ်။</p></div>
      <div className="recap-steps"><span>01 Video</span><span>02 Transcript</span><span>03 မြန်မာစာ</span><span>04 အသံ</span><span>05 Export</span></div>
      {error && <div className="recap-alert" role="alert">{error}</div>}{notice && <div className="recap-notice" role="status">{notice}</div>}
      <section className="recap-card"><h2>1. Video ရွေးပါ</h2><p>စမ်းသပ် version: MP4 {(RECAP_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB / {RECAP_MAX_DURATION_SECONDS / 60} မိနစ်အထိ။ Video ကို server ပေါ် မတင်ပါ။ အရွယ်ကြီးဖိုင်တွေမှာ browser memory များများလိုနိုင်ပြီး မအောင်မြင်ရင် ဖိုင်ကို ပိုတို/ပိုသေးအောင်ချုံ့ပြီး ပြန်တင်ပါ။</p>
        <input ref={fileInput} type="file" accept="video/mp4,.mp4" hidden onChange={(event) => { void chooseVideo(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <button className="recap-primary" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><Upload size={16} /> Video ရွေးမယ်</button>
        {video && <div className="recap-video"><video src={videoUrl} controls preload="metadata" /><div><strong>{video.name}</strong><span>{formatTime(duration)} · {(video.size / 1024 / 1024).toFixed(1)} MB</span></div></div>}
      </section>
      <section className="recap-card"><h2>2. မူရင်းစာသား</h2><p>Whisper ကို browser မှာ run မယ်။ ပထမတစ်ကြိမ် model download ကြာနိုင်ပါတယ်။</p>
        <div className="recap-actions"><button className="recap-secondary" disabled={!video || Boolean(busy)} onClick={() => void runTranscription()}><RefreshCw size={15} />{isTranscribing ? "Transcript ပြန်ထုတ်နေသည်…" : lines.length ? "Transcript ပြန်ထုတ်မယ်" : "Transcript ထုတ်မယ်"}</button><button className="recap-secondary" disabled={!video || Boolean(busy)} onClick={() => { setLines([{ id: "line-1", start: 0, end: duration, source: "", burmese: "" }]); resetAudio(); }}>စာသားကိုယ်တိုင်ထည့်မယ်</button>{isTranscribing && <p className="recap-inline-status" role="status">{progress || "လုပ်ဆောင်နေသည်…"} · လက်ရှိစာသားကို ပြီးမှသာ အစားထိုးပါမည်။</p>}</div>
        {lines.length > 0 && <div className="recap-lines">{lines.map((line, index) => <div className="recap-line" key={line.id}><div className="recap-line-toolbar"><small>မူရင်း · စာကြောင်း {index + 1}</small><div><label>စချိန် <input aria-label={`Source line ${index + 1} start time`} type="number" min={0} max={duration} step={0.1} value={line.start} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, start: Math.max(0, Number(event.target.value) || 0) } : item))} /></label><label>ဆုံးချိန် <input aria-label={`Source line ${index + 1} end time`} type="number" min={0} max={duration} step={0.1} value={line.end} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, end: Math.min(duration, Math.max(item.start, Number(event.target.value) || 0)) } : item))} /></label><button className="recap-line-action" disabled={Boolean(busy)} onClick={() => addLine(index)}>အောက်မှာထည့်</button><button className="recap-line-action danger" disabled={Boolean(busy) || lines.length === 1} onClick={() => removeLine(index)}>ဖျက်မယ်</button></div></div><textarea aria-label={`Source line ${index + 1}`} value={line.source} onChange={(event) => changeLine(index, "source", event.target.value)} /></div>)}</div>}
      </section>
      <section className="recap-card"><h2>3. မြန်မာဘာသာပြန်စာသား</h2><p>ဘာသာပြန်ပြီး အသံမထုတ်ခင် စာကြောင်းတိုင်းကို ပြင်နိုင်ပါတယ်။</p>
        <label className="recap-key">Gemini API key <input type="password" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} autoComplete="off" placeholder="API key" /></label>
        <label>ဘာသာပြန် Model <select value={model} onChange={(event) => setModel(event.target.value)}><option value={model}>{model}</option>{models.filter((item) => item.id !== model).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <button className="recap-secondary" disabled={!apiKeyDraft.trim() || Boolean(busy)} onClick={() => void loadModels()}>သုံးလို့ရတဲ့ Models ရွေးမယ်</button>{" "}
        <button className="recap-secondary" disabled={!lines.length || lines.some((line) => !line.source.trim()) || !apiKeyDraft.trim() || Boolean(busy)} onClick={() => void runTranslation()}>{isTranslating ? "မြန်မာလို ပြန်စစ်နေသည်…" : lines.some((line) => line.burmese) ? "ဘာသာပြန်ကို ပြန်ထုတ်မယ်" : "မြန်မာလိုပြန်မယ်"}</button>
        {isTranslating && <p className="recap-inline-status" role="status">{progress || "လုပ်ဆောင်နေသည်…"} · ပြီးသွားတဲ့စာကြောင်းတွေကို စစ်ပြီးမှ အသံထုတ်ပါ။</p>}
        {lines.some((line) => line.burmese) && <div className="recap-lines">{lines.map((line, index) => <div className="recap-line" key={line.id}><div className="recap-line-toolbar"><small>မြန်မာ · စာကြောင်း {index + 1}</small><small>{formatTime(line.start)}–{formatTime(line.end)}</small></div><p>{line.source}</p><textarea aria-label={`Burmese line ${index + 1}`} value={line.burmese} onChange={(event) => changeLine(index, "burmese", event.target.value)} /></div>)}</div>}
      </section>
      <section className="recap-card"><h2>4. မြန်မာအသံ</h2><p>အသံကို တကယ်ဖိုင်အဖြစ် ထုတ်ပြီး preview နားထောင်နိုင်မယ်။ ပြင်ထားတဲ့စာကြောင်းတွေကို ပြန်ထုတ်နိုင်မယ်။</p>
        <label>Voice <select value={voice} onChange={(event) => { setVoice(event.target.value); resetAudio(); }}>{VOICES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button className="recap-secondary" disabled={!video || !translated || Boolean(busy)} onClick={() => void runNarration()}><Mic2 size={15} /> အသံထုတ်မယ်</button>
        {narration && <div className="recap-audio"><audio src={previewUrl} controls /><button onClick={() => downloadBlob(narration, "recap-narration-mm.wav")}><Download size={15} /> WAV</button></div>}
      </section>
      <section className="recap-card"><h2>5. Export</h2><p>Fast mode မှာ ရုပ်ကို မပြောင်းဘူး။ အသံပိုရှည်ရင် ရုပ်တစ်ကားလုံးကို အနည်းငယ်နှေးပေးတဲ့ mode ရွေးနိုင်ပါတယ်။ Subtitle ကို SRT သီးခြား download လုပ်နိုင်ပါတယ်။</p>
        <label className="recap-fit"><input type="checkbox" checked={fitNarration} onChange={(event) => { setFitNarration(event.target.checked); setFinalVideo(null); }} /> အသံအရှည်နှင့် ရုပ်အချိန်ညှိမယ် (render ပိုကြာမည်)</label>
        <div className="recap-actions"><button className="recap-primary" disabled={!narration || Boolean(busy)} onClick={() => void runRender()}><Play size={15} /> Final MP4 ထုတ်မယ်</button><button className="recap-secondary" disabled={!timedLines.length} onClick={() => downloadBlob(new Blob([recapSrt(timedLines)], { type: "text/plain;charset=utf-8" }), "recap-subtitles-mm.srt")}><Download size={15} /> SRT</button></div>
        {finalVideo && <button className="recap-primary" onClick={() => downloadBlob(finalVideo, "recap-mm.mp4")}><Download size={15} /> Final MP4 Download</button>}
      </section>
      {busy && <div className="recap-progress" role="status"><span className="recap-spinner" />{progress || "လုပ်ဆောင်နေသည်…"} <small>Tab ကိုဖွင့်ထားပြီး တခြား app သုံးနိုင်ပါတယ်။</small></div>}
    </main>
  </div>;
}
