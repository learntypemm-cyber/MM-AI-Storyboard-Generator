import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, Clapperboard, Download, Film, Image as ImageIcon,
  Link2, LoaderCircle, Play, Settings2, Square, Upload, Video,
} from "lucide-react";
import type { Scene, Storyboard } from "../types";

type ApiNode = {
  class_type?: string;
  inputs?: Record<string, unknown>;
  [key: string]: unknown;
};
type ApiWorkflow = Record<string, ApiNode>;
type Artifact = { url: string; filename: string; mediaType: "video" | "image"; nodeId: string };
type Job = { status: "queued" | "running" | "done" | "error"; promptId?: string; artifacts: Artifact[]; error?: string };
type SavedConfig = {
  endpoint: string;
  workflowName: string;
  workflow: ApiWorkflow | null;
  promptNodeId: string;
  promptInputName: string;
  negativeNodeId: string;
  negativeInputName: string;
};

const CONFIG_KEY = "mm-storyboard-comfyui-config";
const DEFAULT_ENDPOINT = "http://127.0.0.1:8188";

function readConfig(): SavedConfig {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (value) return { ...defaultConfig(), ...(JSON.parse(value) as Partial<SavedConfig>) };
  } catch { /* use defaults if browser storage has invalid data */ }
  return defaultConfig();
}
function defaultConfig(): SavedConfig {
  return {
    endpoint: DEFAULT_ENDPOINT, workflowName: "", workflow: null,
    promptNodeId: "", promptInputName: "text", negativeNodeId: "", negativeInputName: "text",
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normaliseEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your ComfyUI server URL.");
  let parsed: URL;
  try { parsed = new URL(trimmed); }
  catch { throw new Error("Enter a complete ComfyUI URL such as http://127.0.0.1:8188."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("ComfyUI URL must use http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not put a username or password in the ComfyUI URL.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Remove query parameters and fragments from the ComfyUI base URL.");
  }
  return trimmed;
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Generation cancelled.")); return; }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new Error("Generation cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
function apiError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  if (isRecord(payload) && typeof payload.detail === "string") return payload.detail;
  if (isRecord(payload) && typeof payload.message === "string") return payload.message;
  return fallback;
}
function workflowNodes(workflow: ApiWorkflow | null): Array<{ id: string; node: ApiNode }> {
  if (!workflow) return [];
  return Object.entries(workflow)
    .filter(([, node]) => isRecord(node) && typeof node.class_type === "string" && isRecord(node.inputs))
    .map(([id, node]) => ({ id, node }));
}
function artifactsFromHistory(endpoint: string, entry: Record<string, unknown>): Artifact[] {
  const outputs = isRecord(entry.outputs) ? entry.outputs : {};
  const result: Artifact[] = [];
  for (const [nodeId, rawOutput] of Object.entries(outputs)) {
    if (!isRecord(rawOutput)) continue;
    for (const kind of ["videos", "gifs", "images"]) {
      const files = rawOutput[kind];
      if (!Array.isArray(files)) continue;
      files.forEach((rawFile) => {
        if (!isRecord(rawFile) || typeof rawFile.filename !== "string") return;
        const filename = rawFile.filename;
        const subfolder = typeof rawFile.subfolder === "string" ? rawFile.subfolder : "";
        const type = typeof rawFile.type === "string" ? rawFile.type : "output";
        const query = new URLSearchParams({ filename, subfolder, type });
        const mediaType = /\.(mp4|webm|mov|m4v|mkv)$/i.test(filename) || kind === "videos" ? "video" : "image";
        result.push({ url: endpoint + "/view?" + query.toString(), filename, mediaType, nodeId });
      });
    }
  }
  return result;
}
function toErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach ComfyUI. Check the server URL, that ComfyUI is running, and its CORS settings.";
  return error instanceof Error ? error.message : "The ComfyUI request failed.";
}

export default function ComfyUIStudio({ scenes, storyboard }: { scenes: Scene[]; storyboard: Storyboard }) {
  const saved = useMemo(readConfig, []);
  const [endpoint, setEndpoint] = useState(saved.endpoint);
  const [workflowName, setWorkflowName] = useState(saved.workflowName);
  const [workflow, setWorkflow] = useState<ApiWorkflow | null>(saved.workflow);
  const [promptNodeId, setPromptNodeId] = useState(saved.promptNodeId);
  const [promptInputName, setPromptInputName] = useState(saved.promptInputName);
  const [negativeNodeId, setNegativeNodeId] = useState(saved.negativeNodeId);
  const [negativeInputName, setNegativeInputName] = useState(saved.negativeInputName);
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id ?? "");
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [busy, setBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"unknown" | "connected" | "failed">("unknown");
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedUrl, setMergedUrl] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const nodes = useMemo(() => workflowNodes(workflow), [workflow]);
  const currentScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const completedVideos = scenes.flatMap((scene) => {
    const job = jobs[scene.id];
    if (!job || job.status !== "done") return [];
    const video = job.artifacts.find((item) => item.mediaType === "video");
    return video ? [{ ...video, sceneTitle: scene.title, sceneNumber: scene.sceneNumber }] : [];
  });
  const isConfigured = Boolean(workflow && nodes.length && promptNodeId && promptInputName.trim());

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        endpoint, workflowName, workflow, promptNodeId, promptInputName, negativeNodeId, negativeInputName,
      } satisfies SavedConfig));
    } catch {
      setMessage("Workflow could not be saved to browser storage. Keep a local copy of the workflow JSON.");
    }
  }, [endpoint, workflowName, workflow, promptNodeId, promptInputName, negativeNodeId, negativeInputName]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (mergedUrl) URL.revokeObjectURL(mergedUrl);
  }, [mergedUrl]);

  const uploadWorkflow = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setMessage("");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRecord(parsed) || Array.isArray(parsed) || !Object.values(parsed).some((value) => isRecord(value) && typeof value.class_type === "string" && isRecord(value.inputs))) {
        throw new Error("This does not look like a ComfyUI API workflow. In ComfyUI, use Save (API Format), then upload that JSON file.");
      }
      const next = parsed as ApiWorkflow;
      const nextNodes = workflowNodes(next);
      const promptCandidate = nextNodes.find(({ node }) => {
        if (!node.inputs) return false;
        return Object.keys(node.inputs).some((key) => /^(text|prompt|positive)$/i.test(key) && typeof node.inputs?.[key] === "string");
      });
      const candidateInput = promptCandidate
        ? Object.keys(promptCandidate.node.inputs ?? {}).find((key) => /^(text|prompt|positive)$/i.test(key) && typeof promptCandidate.node.inputs?.[key] === "string")
        : undefined;
      setWorkflow(next);
      setWorkflowName(file.name);
      setPromptNodeId(promptCandidate?.id ?? nextNodes[0]?.id ?? "");
      setPromptInputName(candidateInput ?? "text");
      setNegativeNodeId("");
      setConnection("unknown");
      setJobs({});
      setMergedUrl((old) => { if (old) URL.revokeObjectURL(old); return ""; });
      setMessage("Workflow loaded. Confirm the positive prompt node and input field before running a generation.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this workflow.");
    }
  };

  const testConnection = async () => {
    setError(""); setMessage("");
    try {
      const base = normaliseEndpoint(endpoint);
      if (!base) throw new Error("Enter your ComfyUI server URL.");
      const response = await fetch(base + "/system_stats");
      if (!response.ok) throw new Error("ComfyUI responded with HTTP " + response.status + ".");
      await response.json();
      setConnection("connected");
      setMessage("Connected to ComfyUI. The server is ready to receive workflow jobs.");
    } catch (caught) {
      setConnection("failed");
      setError(toErrorMessage(caught));
    }
  };

  const queueAndWait = async (scene: Scene, signal: AbortSignal) => {
    const base = normaliseEndpoint(endpoint);
    if (!base) throw new Error("Enter your ComfyUI server URL.");
    if (!workflow) throw new Error("Upload a ComfyUI API workflow JSON file first.");
    const graph = JSON.parse(JSON.stringify(workflow)) as ApiWorkflow;
    const promptNode = graph[promptNodeId];
    if (!promptNode?.inputs || !(promptInputName in promptNode.inputs)) {
      throw new Error("The configured prompt node or input does not exist in the workflow. Check the node ID and input field.");
    }
    promptNode.inputs[promptInputName] = scene.flowPrompt;
    if (negativeNodeId) {
      const negativeNode = graph[negativeNodeId];
      if (!negativeNode?.inputs || !(negativeInputName in negativeNode.inputs)) {
        throw new Error("The negative prompt node or input does not exist in the workflow.");
      }
      negativeNode.inputs[negativeInputName] = scene.negativePrompt || storyboard.globalNegativePrompt;
    }
    for (const node of Object.values(graph)) {
      if (!node.inputs) continue;
      for (const key of Object.keys(node.inputs)) {
        if (key === "seed" || key === "noise_seed") node.inputs[key] = Math.floor(Math.random() * 2_147_483_646) + 1;
      }
    }

    setJobs((previous) => ({ ...previous, [scene.id]: { status: "queued", artifacts: [] } }));
    const response = await fetch(base + "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph }),
      signal,
    });
    const queuePayload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiError(queuePayload, "ComfyUI rejected the workflow (HTTP " + response.status + ")."));
    if (!isRecord(queuePayload) || typeof queuePayload.prompt_id !== "string") throw new Error(apiError(queuePayload, "ComfyUI did not return a prompt ID."));
    const promptId = queuePayload.prompt_id;
    setJobs((previous) => ({ ...previous, [scene.id]: { status: "running", promptId, artifacts: [] } }));

    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (signal.aborted) throw new Error("Generation cancelled.");
      const historyResponse = await fetch(base + "/history/" + encodeURIComponent(promptId), { signal });
      if (!historyResponse.ok) throw new Error("Could not read ComfyUI job history (HTTP " + historyResponse.status + ").");
      const historyPayload: unknown = await historyResponse.json();
      const historyEntry = isRecord(historyPayload) && isRecord(historyPayload[promptId])
        ? historyPayload[promptId] as Record<string, unknown>
        : isRecord(historyPayload) ? historyPayload : {};
      const artifacts = artifactsFromHistory(base, historyEntry);
      if (artifacts.length) {
        setJobs((previous) => ({ ...previous, [scene.id]: { status: "done", promptId, artifacts } }));
        return artifacts;
      }
      const status = isRecord(historyEntry.status) ? historyEntry.status : {};
      if (status.status_str === "error") {
        throw new Error("ComfyUI reports that this workflow failed. Check the ComfyUI server console for the failing node.");
      }
      await wait(2000, signal);
    }
    throw new Error("ComfyUI job timed out after 20 minutes. Check the server queue and workflow.");
  };

  const renderOne = async (scene: Scene) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage(""); setBatchProgress(null);
    setMergedUrl((old) => { if (old) URL.revokeObjectURL(old); return ""; });
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await queueAndWait(scene, controller.signal);
      setMessage("Scene " + scene.sceneNumber + " finished. Preview the output below or continue in Flow.");
    } catch (caught) {
      const text = toErrorMessage(caught);
      if (text !== "Generation cancelled.") setError(text);
      setJobs((previous) => ({ ...previous, [scene.id]: { status: "error", artifacts: [], error: text } }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const renderAll = async () => {
    if (busy || !scenes.length) return;
    setBusy(true); setError(""); setMessage(""); setMergedUrl((old) => { if (old) URL.revokeObjectURL(old); return ""; });
    const controller = new AbortController();
    controllerRef.current = controller;
    setBatchProgress({ completed: 0, total: scenes.length });
    let failed = 0;
    try {
      for (let index = 0; index < scenes.length; index += 1) {
        if (controller.signal.aborted) break;
        const scene = scenes[index];
        try { await queueAndWait(scene, controller.signal); }
        catch (caught) {
          const text = toErrorMessage(caught);
          if (text === "Generation cancelled.") break;
          failed += 1;
          setJobs((previous) => ({ ...previous, [scene.id]: { status: "error", artifacts: [], error: text } }));
        }
        setBatchProgress({ completed: index + 1, total: scenes.length });
      }
      if (controller.signal.aborted) setMessage("Batch cancelled. Completed clips remain available below.");
      else setMessage("Batch finished: " + (scenes.length - failed) + " succeeded, " + failed + " failed. Review outputs before merging.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const mergeClips = async () => {
    if (merging || completedVideos.length < 2) return;
    setMerging(true); setMergeProgress(0); setError(""); setMessage("");
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress }) => setMergeProgress(Math.max(0, Math.min(100, Math.round(progress * 100)))));
      const core = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      await ffmpeg.load({
        coreURL: await toBlobURL(core + "/ffmpeg-core.js", "text/javascript"),
        wasmURL: await toBlobURL(core + "/ffmpeg-core.wasm", "application/wasm"),
      });
      const fileLines: string[] = [];
      for (let index = 0; index < completedVideos.length; index += 1) {
        const item = completedVideos[index];
        setMessage("Downloading clip " + (index + 1) + " of " + completedVideos.length + "...");
        const response = await fetch(item.url);
        if (!response.ok) throw new Error("Could not download " + item.filename + " from ComfyUI. Check server CORS settings.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const filename = "clip-" + String(index + 1).padStart(3, "0") + ".mp4";
        await ffmpeg.writeFile(filename, bytes);
        fileLines.push("file '" + filename + "'");
      }
      await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(fileLines.join("\n")));
      setMessage("Combining clips in your browser...");
      const exitCode = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "merged.mp4"]);
      if (exitCode !== 0) throw new Error("FFmpeg could not join these clips without re-encoding. The source videos may use different codecs or settings.");
      const data = await ffmpeg.readFile("merged.mp4");
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      setMergedUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
      setMessage("Merged video is ready to preview and download.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setMerging(false);
    }
  };

  const downloadMerged = () => {
    if (!mergedUrl) return;
    const link = document.createElement("a");
    link.href = mergedUrl; link.download = "mm-storyboard-final-video.mp4";
    document.body.appendChild(link); link.click(); link.remove();
  };

  return (
    <section className="comfy-panel">
      <details>
        <summary className="comfy-summary">
          <span className="comfy-summary-icon"><Clapperboard size={18} /></span>
          <span className="comfy-summary-copy"><strong>Optional: Generate images or videos with ComfyUI</strong><small>Run your scenes on a local GPU workflow, then preview and merge video clips.</small></span>
          <span className="comfy-summary-tag">{workflow ? "Workflow loaded" : "Setup required"}</span>
        </summary>
        <div className="comfy-content">
          <div className="comfy-explainer">
            <AlertCircle size={16} />
            <span>This is an optional local generator, separate from Google Flow. You must run ComfyUI, have the required models installed, and load a workflow saved in API format. Prompts generated above remain ready for manual use in Google Flow.</span>
          </div>
          <div className="comfy-config-grid">
            <label className="field">
              <span className="field-label">ComfyUI server URL</span>
              <input className="input" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setConnection("unknown"); }} placeholder={DEFAULT_ENDPOINT} />
              <span className="field-hint">Usually http://127.0.0.1:8188 when the app is running on the same computer.</span>
            </label>
            <label className="field">
              <span className="field-label">Workflow JSON (API format)</span>
              <span className="comfy-file-input"><Upload size={15} /><span>{workflowName || "Choose a ComfyUI workflow"}</span><input type="file" accept=".json,application/json" onChange={(event) => void uploadWorkflow(event.target.files?.[0])} /></span>
              <span className="field-hint">In ComfyUI, save or export the workflow in API format first.</span>
            </label>
          </div>
          {nodes.length > 0 && <>
            <div className="comfy-map-heading"><Settings2 size={15} /><strong>Workflow input mapping</strong><span>Choose where each generated prompt should be inserted.</span></div>
            <div className="comfy-config-grid comfy-mapping-grid">
              <label className="field">
                <span className="field-label">Positive prompt node</span>
                <select className="input" value={promptNodeId} onChange={(event) => setPromptNodeId(event.target.value)}>
                  <option value="">Choose node...</option>
                  {nodes.map(({ id, node }) => <option value={id} key={id}>{id} · {node.class_type}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Positive prompt input name</span>
                <input className="input" value={promptInputName} onChange={(event) => setPromptInputName(event.target.value)} placeholder="text or prompt" />
              </label>
              <label className="field">
                <span className="field-label">Negative prompt node (optional)</span>
                <select className="input" value={negativeNodeId} onChange={(event) => setNegativeNodeId(event.target.value)}>
                  <option value="">Not configured</option>
                  {nodes.map(({ id, node }) => <option value={id} key={id}>{id} · {node.class_type}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Negative prompt input name</span>
                <input className="input" value={negativeInputName} onChange={(event) => setNegativeInputName(event.target.value)} placeholder="text" />
              </label>
            </div>
          </>}
          <div className="comfy-toolbar">
            <button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={busy || merging}><Link2 size={15} /> Test connection</button>
            <span className={"comfy-connection " + connection}><span />{connection === "connected" ? "Connected" : connection === "failed" ? "Connection failed" : "Not tested"}</span>
          </div>
          {!isConfigured && <p className="comfy-hint">Load an API-format workflow and select its text prompt node to enable generation.</p>}
          {error && <div className="alert error-alert"><AlertCircle size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {message && <div className="alert success-alert"><CheckCircle2 size={16} /><span>{message}</span></div>}
          {busy && <div className="comfy-progress"><LoaderCircle className="comfy-spin" size={16} /><span>{batchProgress ? "Rendering scenes " + batchProgress.completed + "/" + batchProgress.total : "Rendering scene " + (currentScene?.sceneNumber ?? "") + "..."}</span><button type="button" className="quiet-button" onClick={() => controllerRef.current?.abort()}><Square size={13} /> Cancel</button></div>}
          <div className="comfy-toolbar comfy-render-toolbar">
            <label className="comfy-scene-select"><span className="field-label">Scene to render</span><select className="input" value={currentScene?.id ?? ""} onChange={(event) => setSelectedSceneId(event.target.value)} disabled={busy || !scenes.length}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>Scene {scene.sceneNumber}: {scene.title}</option>)}</select></label>
            <button type="button" className="primary-button" onClick={() => currentScene && void renderOne(currentScene)} disabled={!isConfigured || busy || !currentScene}><Play size={15} /> Render scene</button>
            <button type="button" className="secondary-button" onClick={() => void renderAll()} disabled={!isConfigured || busy || !scenes.length}><Video size={15} /> Generate all scenes</button>
          </div>
          {Object.keys(jobs).length > 0 && <div className="comfy-results">
            <div className="comfy-results-heading"><div><h3>Generated outputs</h3><p>Jobs are ordered by storyboard scene. Failed jobs can be retried individually.</p></div>{completedVideos.length > 1 && <button className="primary-button" onClick={() => void mergeClips()} disabled={merging || busy}><Film size={15} /> {merging ? "Merging " + mergeProgress + "%" : "Merge video clips"}</button>}</div>
            {merging && <div className="comfy-merge-track"><span style={{ width: mergeProgress + "%" }} /></div>}
            {mergedUrl && <div className="comfy-merged-result"><div><strong>Final video</strong><span>Combined in your browser with FFmpeg.</span></div><video src={mergedUrl} controls preload="metadata" /><button className="primary-button" onClick={downloadMerged}><Download size={15} /> Download final MP4</button></div>}
            <div className="comfy-output-grid">
              {scenes.filter((scene) => jobs[scene.id]).map((scene) => {
                const job = jobs[scene.id];
                return <article className="comfy-output-card" key={scene.id}>
                  <div className="comfy-output-title"><span>Scene {scene.sceneNumber}</span><strong>{scene.title}</strong><span className={"comfy-job-state " + job.status}>{job.status}</span></div>
                  {job.status === "running" && <p className="comfy-output-note"><LoaderCircle className="comfy-spin" size={14} /> Waiting for ComfyUI output...</p>}
                  {job.status === "error" && <p className="comfy-output-error">{job.error || "Generation failed."}</p>}
                  {job.status === "done" && job.artifacts.length === 0 && <p className="comfy-output-note">Job completed, but no media output was found. Check your workflow's Save Image or Save Video node.</p>}
                  {job.artifacts.map((item, index) => <div className="comfy-artifact" key={item.nodeId + item.filename + index}>
                    {item.mediaType === "video" ? <video src={item.url} controls preload="metadata" /> : <img src={item.url} loading="lazy" alt={"ComfyUI output for scene " + scene.sceneNumber} />}
                    <a href={item.url} target="_blank" rel="noreferrer" download={item.filename}><Download size={13} /> {item.filename}</a>
                  </div>)}
                  <div className="comfy-output-foot"><span>{job.promptId ? "Job " + job.promptId.slice(0, 8) : "Not queued"}</span><button type="button" className="copy-prompt-link" onClick={() => void renderOne(scene)} disabled={busy || !isConfigured}>Retry scene</button></div>
                </article>;
              })}
            </div>
          </div>}
          <div className="comfy-footer-hint"><ImageIcon size={14} /><span>Images and videos are rendered by your ComfyUI workflow, not Google Flow. Some ComfyUI installations block browser requests by CORS; allow only your local app origin rather than enabling unrestricted access.</span></div>
        </div>
      </details>
    </section>
  );
}
