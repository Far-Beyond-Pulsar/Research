import * as ort from 'onnxruntime-web';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from '../lib/supertonic.js';

let tts    = null;
let style  = null;
let backend = null;
let aborted = false;

const send  = (msg, xfer) => self.postMessage(msg, xfer ? [xfer] : []);
const status = (msg)       => send({ type: 'status', msg });

self.onmessage = async ({ data }) => {
  const { cmd } = data;

  if (cmd === 'abort') { aborted = true; return; }
  aborted = false;

  try {
    switch (cmd) {
      case 'init': {
        const { wasmPath, basePath, skipWebGPU } = data;
        ort.env.wasm.wasmPaths = wasmPath;

        const loadWith = (providers) =>
          loadTextToSpeech(
            `${basePath}/assets/onnx`,
            { executionProviders: providers, graphOptimizationLevel: 'all' },
            (name, cur, tot) => status(`Loading ${name} (${cur}/${tot})…`)
          );

        if (!skipWebGPU) {
          try {
            const r = await loadWith(['webgpu']);
            tts = r.textToSpeech; backend = 'webgpu';
          } catch {
            status('WebGPU unavailable — loading WASM…');
          }
        }
        if (!tts) {
          const r = await loadWith(['wasm']);
          tts = r.textToSpeech; backend = 'wasm';
        }

        send({ type: 'done', cmd, backend });
        break;
      }

      case 'loadVoice': {
        status('Loading voice…');
        style = await loadVoiceStyle([data.path], false);
        send({ type: 'done', cmd });
        break;
      }

      case 'synthesize': {
        const { text, lang, steps, speed } = data;

        const { wav, duration } = await tts.call(
          text, lang, style, steps, speed, 0.3,
          (step, total) => { if (!aborted) send({ type: 'progress', step, total }); }
        );

        if (aborted) { send({ type: 'aborted' }); return; }

        const wavLen = Math.floor(tts.sampleRate * duration[0]);
        const buffer = writeWavFile(wav.slice(0, wavLen), tts.sampleRate);
        send({ type: 'wav', buffer, sampleRate: tts.sampleRate }, buffer);
        break;
      }
    }
  } catch (err) {
    send({ type: 'error', cmd, error: err.message });
  }
};
