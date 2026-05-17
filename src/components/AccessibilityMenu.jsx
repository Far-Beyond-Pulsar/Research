'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Preferences ─────────────────────────────────────────────────────────────
const LS_KEY   = 'a11y-prefs';
const DEFAULTS = { dyslexia: false, highContrast: false, textScale: 100 };

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function savePrefs(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {} }
function applyPrefs(p) {
  const h = document.documentElement;
  h.classList.toggle('a11y-dyslexia',      p.dyslexia);
  h.classList.toggle('a11y-high-contrast', p.highContrast);
  h.style.setProperty('--a11y-text-scale', String(p.textScale / 100));
}

// ── OpenDyslexic font (loaded once) ─────────────────────────────────────────
let dyslexicFontInjected = false;
function injectDyslexicFont() {
  if (dyslexicFontInjected) return;
  dyslexicFontInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    @font-face {
      font-family: 'OpenDyslexic';
      src: url('https://cdn.jsdelivr.net/gh/antijingoist/opendyslexic@master/compiled/OpenDyslexic-Regular.woff2') format('woff2');
      font-weight: 400; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: 'OpenDyslexic';
      src: url('https://cdn.jsdelivr.net/gh/antijingoist/opendyslexic@master/compiled/OpenDyslexic-Bold.woff2') format('woff2');
      font-weight: 700; font-style: normal; font-display: swap;
    }
  `;
  document.head.appendChild(s);
}

// ── Section extraction ───────────────────────────────────────────────────────
function extractSections() {
  const prose = document.querySelector('.doc-prose') || document.querySelector('main');
  if (!prose) return [];

  const clone = prose.cloneNode(true);
  clone.querySelectorAll(
    'pre, .katex, .mermaid-diagram-container, .code-block-container, script, style'
  ).forEach(el => el.remove());

  // .doc-prose wraps a single .markdown-content div — walk into it
  const root = clone.querySelector('.markdown-content') || clone;

  const sections = [];
  let cur = null;

  for (const child of root.children) {
    if (/^H[1-4]$/.test(child.tagName)) {
      // Flush previous section, start a new one at this heading
      if (cur?.text.trim()) sections.push(cur);
      cur = { label: child.textContent.trim(), text: child.textContent.trim() + '. ' };
    } else {
      if (!cur) cur = { label: 'Introduction', text: '' };
      cur.text += (child.textContent || '').replace(/\s+/g, ' ').trim() + ' ';
    }
  }
  if (cur?.text.trim()) sections.push(cur);

  return sections.filter(s => s.text.trim().length > 20);
}

// ── Worker pool ───────────────────────────────────────────────────────────────
const WEBGPU_BROKEN_KEY = 'supertonic-webgpu-broken';
function webgpuKnownBroken() { try { return localStorage.getItem(WEBGPU_BROKEN_KEY) === '1'; } catch { return false; } }
function markWebgpuBroken()   { try { localStorage.setItem(WEBGPU_BROKEN_KEY, '1'); } catch {} }

const mlog = (...a) => console.log('[tts-main]', ...a);

// Each slot: { worker, ready, busy, voice, pending, onStatus }
const _pool = [];

function absoluteBase() {
  const bp = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
  return window.location.origin + bp;
}

function makeSlot(idx) {
  if (_pool[idx]) return _pool[idx];
  mlog(`creating worker[${idx}]`);
  const slot = { worker: null, ready: false, busy: false, voice: null, pending: null, onStatus: null };

  slot.worker = new Worker(new URL('../workers/tts.worker.js', import.meta.url), { type: 'module' });
  slot.worker.onmessage = ({ data }) => {
    mlog(`[w${idx}] ←`, data.type, data.cmd ?? '', data.type === 'wav' ? `${data.buffer?.byteLength}B` : '');
    switch (data.type) {
      case 'status':   slot.onStatus?.(data.msg); break;
      case 'progress': slot.onStatus?.(`Denoising ${data.step}/${data.total}…`); break;
      case 'done':
      case 'wav':
        slot.pending?.resolve(data); slot.pending = null; break;
      case 'aborted':
        slot.pending?.reject(new Error('aborted')); slot.pending = null; break;
      case 'error':
        mlog(`[w${idx}] error:`, data.error);
        slot.pending?.reject(new Error(data.error)); slot.pending = null; break;
    }
  };
  slot.worker.onerror = (e) => {
    mlog(`[w${idx}] onerror:`, e.message);
    slot.pending?.reject(new Error(e.message || 'Worker error')); slot.pending = null;
  };

  _pool[idx] = slot;
  return slot;
}

function slotSend(idx, msg) {
  const slot = makeSlot(idx);
  return new Promise((resolve, reject) => {
    slot.pending = { resolve, reject };
    mlog(`[w${idx}] →`, msg.cmd);
    slot.worker.postMessage(msg);
  });
}

async function initSlot(idx, onStatus) {
  const slot = makeSlot(idx);
  if (slot.ready) return true;
  if (slot.busy)  return false;
  slot.busy = true;
  slot.onStatus = onStatus;
  try {
    const base = absoluteBase();
    onStatus(`Initialising worker ${idx + 1}…`);
    await slotSend(idx, { cmd: 'init', wasmPath: base + '/', basePath: base, skipWebGPU: webgpuKnownBroken() });
    slot.ready = true; slot.busy = false;
    return true;
  } catch (err) {
    mlog(`[w${idx}] init failed:`, err.message);
    slot.busy = false; return false;
  }
}

async function ensurePoolReady(size, onStatus) {
  const results = await Promise.all(
    Array.from({ length: size }, (_, i) => initSlot(i, onStatus))
  );
  return results.every(Boolean);
}

async function loadVoiceOnSlot(idx, name) {
  const slot = makeSlot(idx);
  if (slot.voice === name) return;
  const base = absoluteBase();
  await slotSend(idx, { cmd: 'loadVoice', path: `${base}/assets/voice_styles/${name}.json` });
  slot.voice = name;
}

async function ensureVoiceOnPool(size, name) {
  await Promise.all(Array.from({ length: size }, (_, i) => loadVoiceOnSlot(i, name)));
}

function synthOnSlot(idx, text, lang, steps, speed, onStatus) {
  const slot = makeSlot(idx);
  slot.onStatus = onStatus;
  return slotSend(idx, { cmd: 'synthesize', text, lang, steps, speed });
}

function abortPool() {
  _pool.forEach((slot, i) => {
    if (!slot) return;
    slot.pending?.reject(new Error('aborted')); slot.pending = null;
    slot.worker?.postMessage({ cmd: 'abort' });
  });
}

function terminatePool() {
  _pool.forEach((slot, i) => {
    if (!slot) return;
    slot.pending?.reject(new Error('aborted')); slot.pending = null;
    slot.worker?.terminate();
    _pool[i] = null;
  });
  _pool.length = 0;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function AccessibilityMenu() {
  const [open,     setOpen]     = useState(false);
  const [prefs,    setPrefs]    = useState(DEFAULTS);
  const [mounted,  setMounted]  = useState(false);

  // TTS UI state
  const [ttsStatus,   setTtsStatus]   = useState('idle'); // idle | loading | ready | reading | paused | unavailable
  const [ttsMsg,      setTtsMsg]      = useState('');
  const [voice,       setVoice]       = useState('M1');
  const [lang,        setLang]        = useState('en');
  const [speed,       setSpeed]       = useState(1.05);
  const [steps,       setSteps]       = useState(8);
  const [batchSize,   setBatchSize]   = useState(2);
  const [debugWavs,   setDebugWavs]   = useState([]); // [{ label, url }]

  const audioCtxRef = useRef(null);
  const sourceRef   = useRef(null);
  const abortRef    = useRef(false);

  // Mount + restore prefs
  useEffect(() => {
    setMounted(true);
    injectDyslexicFont();
    const p = loadPrefs();
    setPrefs(p);
    applyPrefs(p);
  }, []);

  const update = useCallback((patch) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      applyPrefs(next);
      return next;
    });
  }, []);

  // ── TTS ─────────────────────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    abortRef.current = true;
    abortPool();
    try { sourceRef.current?.stop(); } catch {}
    try { audioCtxRef.current?.close(); } catch {}
    sourceRef.current = null;
    audioCtxRef.current = null;
    setTtsStatus(s => s === 'unavailable' ? s : 'ready');
    setTtsMsg('');
  }, []);

  const startReading = useCallback(async () => {
    abortRef.current = false;

    // ↓ Create + resume AudioContext SYNCHRONOUSLY while the click gesture is still live.
    //   Chrome suspends any AudioContext created after an await boundary.
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    ctx.resume().catch(() => {});   // no-op if already running; non-blocking

    setTtsStatus('loading');
    setTtsMsg('');

    const ok = await ensurePoolReady(batchSize, (msg) => setTtsMsg(msg));
    if (!ok) { setTtsStatus('unavailable'); setTtsMsg('TTS engine failed to load'); return; }

    try {
      setTtsMsg(`Loading voice ${voice} on ${batchSize} worker${batchSize > 1 ? 's' : ''}…`);
      await ensureVoiceOnPool(batchSize, voice);
    } catch {
      setTtsStatus('unavailable'); setTtsMsg('Voice failed to load'); return;
    }

    const sections = extractSections();
    if (!sections.length) { setTtsStatus('ready'); return; }

    mlog('sections:', sections.map(s => `"${s.label}" (${s.text.length}ch)`));

    setTtsStatus('reading');
    setDebugWavs([]);

    // Helper: synthesise one section on a specific worker slot, with WebGPU→WASM fallback
    const synth = async (sec, slotIdx) => {
      mlog(`synth start [w${slotIdx}]:`, sec.label);
      const onStatus = (msg) => setTtsMsg(`[w${slotIdx}] ${msg}`);
      try {
        return await synthOnSlot(slotIdx, sec.text, lang, steps, speed, onStatus);
      } catch (err) {
        if (err.message === 'aborted') throw err;
        if (!webgpuKnownBroken()) {
          markWebgpuBroken();
          setTtsMsg('WebGPU failed — restarting pool with WASM…');
          terminatePool();
          const ok2 = await ensurePoolReady(batchSize, (m) => setTtsMsg(m));
          if (!ok2) throw err;
          await ensureVoiceOnPool(batchSize, voice);
          return await synthOnSlot(slotIdx, sec.text, lang, steps, speed, onStatus);
        }
        throw err;
      }
    };

    const playWav = async (wav, sec, i) => {
      mlog('wav received:', sec.label, 'byteLength:', wav?.buffer?.byteLength);

      try {
        const blob = new Blob([wav.buffer], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob);
        mlog('debug blob size:', blob.size);
        setDebugWavs(prev => [...prev, { label: sec.label, url }]);
      } catch (e) { mlog('blob failed:', e.message); }

      let decoded;
      try {
        decoded = await ctx.decodeAudioData(wav.buffer.slice(0));
        mlog('decoded duration:', decoded.duration);
      } catch (e) {
        mlog('decodeAudioData failed:', e.message);
        setTtsMsg(`Decode error for "${sec.label}": ${e.message}`);
        return;
      }

      setTtsMsg(`▶  "${sec.label}" (${i + 1}/${sections.length})`);
      await ctx.resume();
      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(ctx.destination);
        sourceRef.current = src;
        src.onended = () => { mlog('ended:', sec.label); resolve(); };
        mlog('playing:', sec.label);
        src.start(0);
      });
      sourceRef.current = null;
    };

    try {
      // ── Pipeline: batchSize workers synthesise ahead while audio plays ────
      // pending[i] holds the synthesis promise for section i
      const pending = new Array(sections.length);

      // Pre-fill the first batchSize slots
      for (let j = 0; j < Math.min(batchSize, sections.length); j++) {
        mlog(`pipeline pre-fill [w${j}]:`, sections[j].label);
        pending[j] = synth(sections[j], j);
      }

      for (let i = 0; i < sections.length; i++) {
        if (abortRef.current) break;

        // Wait for section i's WAV (synthesised on worker i % batchSize)
        let wav;
        try {
          wav = await pending[i];
        } catch (err) {
          mlog('synth error for', sections[i].label, ':', err.message);
          if (err.message === 'aborted' || abortRef.current) break;
          setTtsMsg(`Skipping "${sections[i].label}": ${err.message}`);
          // Keep pipeline moving: kick off i+batchSize on the freed slot
          const next = i + batchSize;
          if (next < sections.length) {
            mlog(`pipeline recover [w${i % batchSize}] →`, sections[next].label);
            pending[next] = synth(sections[next], i % batchSize);
          }
          continue;
        }

        if (abortRef.current) break;

        // WAV ready — immediately start synthesising section i+batchSize on the freed slot
        const next = i + batchSize;
        if (next < sections.length) {
          mlog(`pipeline ahead [w${i % batchSize}]:`, sections[next].label, `(playing ${sections[i].label})`);
          pending[next] = synth(sections[next], i % batchSize);
        }

        // Play section i — the freed slot is already working on next
        await playWav(wav, sections[i], i);
      }
    } catch (err) {
      console.error('TTS pipeline error:', err);
      setTtsMsg(`Error: ${err.message}`);
    } finally {
      if (!abortRef.current) { setTtsStatus('ready'); setTtsMsg(''); }
    }
  }, [voice, lang, speed, steps]);

  const pauseResume = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'running') { ctx.suspend(); setTtsStatus('paused'); }
    else { ctx.resume(); setTtsStatus('reading'); }
  }, []);

  if (!mounted) return null;

  const isReading  = ttsStatus === 'reading';
  const isPaused   = ttsStatus === 'paused';
  const isLoading  = ttsStatus === 'loading';
  const isUnavail  = ttsStatus === 'unavailable';
  const canStart   = !isReading && !isPaused && !isLoading;

  const VOICES = ['M1','M2','M3','M4','M5','F1','F2','F3','F4','F5'];
  const LANGS  = ['en','ko','ja','de','fr','es','pt','it','ru','zh','ar','hi','nl','pl','sv','da','fi','nb','tr','uk','cs','sk','hr','ro','bg','et','lv','lt','sl','hu','id','vi','na'];

  return (
    <div className="a11y-widget">
      <button
        className={`a11y-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Accessibility options"
        aria-expanded={open}
        title="Accessibility"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="5" r="1.5"/>
          <path d="M4 7h16M12 7v5l-3 5M12 12l3 5"/>
          <path d="M9 10H5M19 10h-4"/>
        </svg>
      </button>

      {open && (
        <div className="a11y-panel" role="dialog" aria-label="Accessibility settings">
          <p className="a11y-panel-title">Accessibility</p>

          {/* Dyslexia font */}
          <div className="a11y-row">
            <span>Dyslexia-friendly font</span>
            <button
              role="switch"
              aria-checked={prefs.dyslexia}
              className={`a11y-switch${prefs.dyslexia ? ' on' : ''}`}
              onClick={() => update({ dyslexia: !prefs.dyslexia })}
            >
              <span className="a11y-switch-thumb" />
            </button>
          </div>

          {/* High contrast */}
          <div className="a11y-row">
            <span>High contrast</span>
            <button
              role="switch"
              aria-checked={prefs.highContrast}
              className={`a11y-switch${prefs.highContrast ? ' on' : ''}`}
              onClick={() => update({ highContrast: !prefs.highContrast })}
            >
              <span className="a11y-switch-thumb" />
            </button>
          </div>

          {/* Text size */}
          <div className="a11y-row col">
            <div className="a11y-row-label">
              <span>Text size</span>
              <span className="a11y-value">{prefs.textScale}%</span>
            </div>
            <div className="a11y-size-controls">
              <button className="a11y-size-btn" onClick={() => update({ textScale: Math.max(75, prefs.textScale - 5) })} aria-label="Decrease text size">A−</button>
              <input
                type="range" min={75} max={200} step={5}
                value={prefs.textScale}
                onChange={e => update({ textScale: Number(e.target.value) })}
                className="a11y-slider"
                aria-label="Text size"
              />
              <button className="a11y-size-btn" onClick={() => update({ textScale: Math.min(200, prefs.textScale + 5) })} aria-label="Increase text size">A+</button>
            </div>
          </div>

          <div className="a11y-divider" />

          {/* Screen reader */}
          <p className="a11y-section-label">Screen Reader <span className="a11y-badge">Supertonic</span></p>

          <div className="a11y-row">
            <label htmlFor="a11y-voice">Voice</label>
            <select id="a11y-voice" value={voice} onChange={e => setVoice(e.target.value)} className="a11y-select" disabled={isLoading || isReading || isPaused}>
              {VOICES.map(v => <option key={v} value={v}>{v.startsWith('M') ? '♂' : '♀'} {v}</option>)}
            </select>
          </div>

          <div className="a11y-row">
            <label htmlFor="a11y-lang">Language</label>
            <select id="a11y-lang" value={lang} onChange={e => setLang(e.target.value)} className="a11y-select" disabled={isLoading || isReading || isPaused}>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="pt">Português</option>
              <option value="it">Italiano</option>
              <option value="nl">Dutch</option>
              <option value="pl">Polish</option>
              <option value="ru">Russian</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="zh">中文</option>
              <option value="ar">العربية</option>
              <option value="hi">Hindi</option>
              <option value="tr">Turkish</option>
              <option value="uk">Ukrainian</option>
              <option value="sv">Swedish</option>
              <option value="da">Danish</option>
              <option value="fi">Finnish</option>
              <option value="na">Auto-detect</option>
            </select>
          </div>

          <div className="a11y-row">
            <label htmlFor="a11y-speed">Speed</label>
            <div className="a11y-speed-wrap">
              <input
                id="a11y-speed"
                type="range" min={0.7} max={2.0} step={0.05}
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                className="a11y-slider"
                disabled={isLoading || isReading || isPaused}
              />
              <span className="a11y-value">{speed.toFixed(2)}×</span>
            </div>
          </div>

          <div className="a11y-row">
            <label htmlFor="a11y-steps">Quality</label>
            <div className="a11y-speed-wrap">
              <input
                id="a11y-steps"
                type="range" min={3} max={20} step={1}
                value={steps}
                onChange={e => setSteps(Number(e.target.value))}
                className="a11y-slider"
                disabled={isLoading || isReading || isPaused}
              />
              <span className="a11y-value">{steps}</span>
            </div>
          </div>

          <div className="a11y-row">
            <label htmlFor="a11y-batch">Workers</label>
            <div className="a11y-speed-wrap">
              <input
                id="a11y-batch"
                type="range" min={1} max={4} step={1}
                value={batchSize}
                onChange={e => setBatchSize(Number(e.target.value))}
                className="a11y-slider"
                disabled={isLoading || isReading || isPaused}
              />
              <span className="a11y-value">{batchSize}×</span>
            </div>
          </div>

          {ttsMsg && <p className="a11y-tts-msg">{ttsMsg}</p>}

          <div className="a11y-tts-controls">
            {canStart && !isUnavail && (
              <button className="a11y-tts-btn primary" onClick={startReading}>
                ▶ Read page
              </button>
            )}
            {isLoading && (
              <button className="a11y-tts-btn" disabled>
                <span className="a11y-spinner" /> Loading…
              </button>
            )}
            {(isReading || isPaused) && (
              <>
                <button className="a11y-tts-btn" onClick={pauseResume}>
                  {isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button className="a11y-tts-btn" onClick={stopAudio}>
                  ■ Stop
                </button>
              </>
            )}
            {isUnavail && (
              <p className="a11y-unavail">TTS unavailable — run <code>npm run download-models</code></p>
            )}
          </div>

          {debugWavs.length > 0 && (
            <div className="a11y-debug">
              <p className="a11y-debug-title">
                Debug WAVs
                <button className="a11y-debug-clear" onClick={() => setDebugWavs([])}>clear</button>
              </p>
              {debugWavs.map(({ label, url }, i) => (
                <div key={i} className="a11y-debug-item">
                  <span className="a11y-debug-label" title={label}>{label}</span>
                  <audio src={url} controls preload="none" className="a11y-debug-audio" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
