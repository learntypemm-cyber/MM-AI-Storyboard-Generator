import { pipeline } from "@huggingface/transformers";

// Word timestamps require decoder cross-attention outputs in the ONNX export.
const WHISPER_TIMESTAMP_MODEL = "onnx-community/whisper-base_timestamped";

self.onmessage = async (event: MessageEvent<Float32Array>) => {
  try {
    let transcriber: any;
    try {
      self.postMessage({ type: "progress", message: "Whisper WebGPU model ကို ဖွင့်နေသည်…" });
      transcriber = await pipeline("automatic-speech-recognition", WHISPER_TIMESTAMP_MODEL, { device: "webgpu" });
    } catch {
      self.postMessage({ type: "progress", message: "WebGPU မရသဖြင့် CPU ဖြင့် စမ်းနေသည်…" });
      transcriber = await pipeline("automatic-speech-recognition", WHISPER_TIMESTAMP_MODEL);
    }
    self.postMessage({ type: "progress", message: "စကားသံကို စာသားပြောင်းနေသည်…" });
    const result = await transcriber(event.data, { return_timestamps: "word", chunk_length_s: 20, stride_length_s: 4, task: "transcribe" });
    self.postMessage({ type: "result", result });
  } catch (caught) {
    self.postMessage({ type: "error", message: caught instanceof Error ? caught.message : "Whisper failed." });
  }
};
