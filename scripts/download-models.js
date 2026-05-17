#!/usr/bin/env node
/**
 * Downloads Supertonic ONNX models + voice styles from Hugging Face.
 * Copies onnxruntime-web WASM files to public/.
 * On any failure, writes .tts-unavailable so the UI disables TTS gracefully.
 */

import { createWriteStream, existsSync, mkdirSync, copyFileSync,
         readdirSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const ONNX_DIR   = join(ROOT, 'public/assets/onnx');
const VOICES_DIR = join(ROOT, 'public/assets/voice_styles');
const PUBLIC_DIR = join(ROOT, 'public');
const FLAG       = join(ONNX_DIR, '.tts-unavailable');
const HF         = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';

const ONNX_FILES  = ['tts.json','unicode_indexer.json','duration_predictor.onnx',
                     'text_encoder.onnx','vector_estimator.onnx','vocoder.onnx'];
const VOICE_FILES = ['M1','M2','M3','M4','M5','F1','F2','F3','F4','F5'].map(v=>`${v}.json`);

function dl(url, dest) {
  return new Promise((resolve, reject) => {
    const label = dest.replace(ROOT + '/', '');
    if (existsSync(dest)) { console.log(`  skip  ${label}`); resolve(); return; }

    const tmp = dest + '.tmp';
    const out = createWriteStream(tmp);
    let settled = false;
    const done = (err) => { if (!settled) { settled = true; err ? reject(err) : resolve(); } };

    const follow = (u) => {
      get(u, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) {
          const loc = res.headers.location;
          // Resolve relative redirects against the current request's origin
          const next = loc.startsWith('http') ? loc : (() => {
            const parsed = new URL(u);
            return `${parsed.protocol}//${parsed.host}${loc}`;
          })();
          follow(next); return;
        }
        if (res.statusCode !== 200) { out.destroy(); done(new Error(`HTTP ${res.statusCode}: ${u}`)); return; }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let rx = 0;
        res.on('data', c => {
          rx += c.length;
          if (total) process.stdout.write(`\r  ${String(Math.round(rx/total*100)).padStart(3)}%  ${label}   `);
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          try { renameSync(tmp, dest); } catch {}
          process.stdout.write(`\r  done  ${label}                    \n`);
          done();
        }));
        out.on('error', done);
      }).on('error', done);
    };
    follow(url);
  });
}

async function main() {
  mkdirSync(ONNX_DIR,   { recursive: true });
  mkdirSync(VOICES_DIR, { recursive: true });
  if (existsSync(FLAG)) unlinkSync(FLAG);

  console.log('\n📦 Supertonic model setup');
  console.log('─'.repeat(50));

  try {
    console.log('\nONNX models:');
    for (const f of ONNX_FILES)
      await dl(`${HF}/onnx/${f}`, join(ONNX_DIR, f));

    console.log('\nVoice styles:');
    await Promise.all(VOICE_FILES.map(f => dl(`${HF}/voice_styles/${f}`, join(VOICES_DIR, f))));

    console.log('\nWASM runtime:');
    const ortDist = join(ROOT, 'node_modules/onnxruntime-web/dist');
    if (existsSync(ortDist)) {
      // Copy WASM binaries and their ESM worker shims (.mjs) — both needed by ort v1.26+
      const needed = readdirSync(ortDist).filter(f =>
        f.endsWith('.wasm') || (f.startsWith('ort-wasm') && f.endsWith('.mjs'))
      );
      for (const w of needed) {
        const dest = join(PUBLIC_DIR, w);
        if (!existsSync(dest)) { copyFileSync(join(ortDist, w), dest); console.log(`  copy  ${w}`); }
        else console.log(`  skip  ${w}`);
      }
    }

    console.log('\n✅ All Supertonic assets ready\n');
  } catch (err) {
    console.error(`\n⚠️  Model download failed: ${err.message}`);
    console.error('   TTS will be disabled.\n');
    writeFileSync(FLAG, err.message);
  }
}

main();
