/* Speechform: Whisper, on this device, in a worker of its own. The model (whisper-tiny.en, about 40 MB) is fetched
   once from Hugging Face and kept by the browser's cache; the voice itself never leaves the device. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = 'onnx-community/whisper-tiny.en';
env.allowLocalModels = false;
let asr = null, device = 'wasm';
const progress = p => postMessage({ t: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } });
async function load() {
  let gpu = false;
  try { gpu = !!(self.navigator && navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { gpu = false; }
  if (gpu) {
    try {
      asr = await pipeline('automatic-speech-recognition', MODEL, { device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q8' }, progress_callback: progress });
      device = 'webgpu'; return;
    } catch (e) { asr = null; }
  }
  asr = await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: progress });
  device = 'wasm';
}
onmessage = async ({ data }) => {
  try {
    if (data.t === 'load') { if (!asr) await load(); postMessage({ t: 'ready', device }); }
    if (data.t === 'run') {
      if (!asr) await load();
      const out = await asr(data.audio, { chunk_length_s: 30 });
      postMessage({ t: 'text', id: data.id, text: (out && out.text) || '' });
    }
  } catch (e) { postMessage({ t: 'error', id: data.id, error: String(e && e.message || e) }); }
};
