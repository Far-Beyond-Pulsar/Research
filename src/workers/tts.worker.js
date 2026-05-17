import * as ort from 'onnxruntime-web';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from '../lib/supertonic.js';

let tts     = null;
let style   = null;
let backend = null;
let aborted = false;

const log    = (...a) => console.log('[tts-worker]', ...a);
const send   = (msg)  => { log('→ main:', msg.type, msg.cmd ?? ''); self.postMessage(msg); };
const status = (msg)  => send({ type: 'status', msg });

self.onmessage = async ({ data }) => {
  const { cmd } = data;
  log('← main:', cmd);

  if (cmd === 'abort') { aborted = true; log('abort set'); return; }
  aborted = false;

  try {
    switch (cmd) {
      case 'init': {
        const { wasmPath, basePath, skipWebGPU } = data;
        log('init wasmPath:', wasmPath, 'basePath:', basePath, 'skipWebGPU:', skipWebGPU);
        ort.env.wasm.wasmPaths = wasmPath;

        const loadWith = (providers) => {
          log('loading models with:', providers);
          return loadTextToSpeech(
            `${basePath}/assets/onnx`,
            { executionProviders: providers, graphOptimizationLevel: 'all' },
            (name, cur, tot) => status(`Loading ${name} (${cur}/${tot})…`)
          );
        };

        if (!skipWebGPU) {
          try {
            const r = await loadWith(['webgpu']);
            tts = r.textToSpeech; backend = 'webgpu';
            log('webgpu models loaded, sampleRate:', tts.sampleRate);
          } catch (e) {
            log('webgpu failed:', e.message, '— falling back to wasm');
            status('WebGPU unavailable — loading WASM…');
          }
        }
        if (!tts) {
          const r = await loadWith(['wasm']);
          tts = r.textToSpeech; backend = 'wasm';
          log('wasm models loaded, sampleRate:', tts.sampleRate);
        }

        send({ type: 'done', cmd, backend });
        break;
      }

      case 'loadVoice': {
        log('loading voice:', data.path);
        status('Loading voice…');
        style = await loadVoiceStyle([data.path], false);
        log('voice loaded');
        send({ type: 'done', cmd });
        break;
      }

      case 'synthesize': {
        const { text, lang, steps, speed } = data;
        log('synthesize lang:', lang, 'steps:', steps, 'speed:', speed, 'text len:', text.length);
        log('tts ready?', !!tts, 'style ready?', !!style);

        const { wav, duration } = await tts.call(
          text, lang, style, steps, speed, 0.3,
          (step, total) => {
            if (!aborted) {
              log(`denoise step ${step}/${total}`);
              send({ type: 'progress', step, total });
            }
          }
        );

        log('tts.call complete, duration:', duration, 'wav samples:', wav.length);

        if (aborted) { log('aborted after synthesis'); send({ type: 'aborted' }); return; }

        const wavLen = Math.floor(tts.sampleRate * duration[0]);
        log('trimming wav to', wavLen, 'samples');
        const buffer = writeWavFile(wav.slice(0, wavLen), tts.sampleRate);
        log('wav buffer byteLength:', buffer.byteLength);

        // Structured-clone (no Transferable) — avoids zero-byteLength in some webpack worker configs
        self.postMessage({ type: 'wav', buffer: buffer.slice(0), sampleRate: tts.sampleRate });
        log('wav posted to main thread');
        break;
      }

      default:
        log('unknown cmd:', cmd);
    }
  } catch (err) {
    log('ERROR in cmd', cmd, ':', err.message, err.stack);
    send({ type: 'error', cmd, error: err.message });
  }
};

log('worker script loaded');
