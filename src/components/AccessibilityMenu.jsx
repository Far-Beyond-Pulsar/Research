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

  const sections = [];
  let cur = null;

  for (const child of clone.children) {
    if (/^H[1-4]$/.test(child.tagName)) {
      if (cur?.text.trim()) sections.push(cur);
      cur = { label: child.textContent.trim(), text: child.textContent.trim() + '. ' };
    } else {
      if (!cur) cur = { label: 'Introduction', text: '' };
      cur.text += (child.textContent || '').replace(/\s+/g, ' ') + ' ';
    }
  }
  if (cur?.text.trim()) sections.push(cur);

  // Drop trivially short sections (headings with no body)
  return sections.filter(s => s.text.trim().length > 40);
}

// ── Worker singleton ─────────────────────────────────────────────────────────
const WEBGPU_BROKEN_KEY = 'supertonic-webgpu-broken';
function webgpuKnownBroken() { try { return localStorage.getItem(WEBGPU_BROKEN_KEY) === '1'; } catch { return false; } }
function markWebgpuBroken()   { try { localStorage.setItem(WEBGPU_BROKEN_KEY, '1'); } catch {} }

let _worker       = null;  // Worker instance
let _workerReady  = false; // models loaded
let _workerBusy   = false; // currently initialising
let _workerVoice  = null;  // last loaded voice name
let _pendingMsg   = null;  // { resolve, reject }
let _onStatusCb   = null;

function getWorker() {
  if (_worker) return _worker;
  _worker = new Worker(new URL('../workers/tts.worker.js', import.meta.url), { type: 'module' });
  _worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'status':
        _onStatusCb?.(data.msg);
        break;
      case 'progress':
        _onStatusCb?.(`Denoising ${data.step}/${data.total}…`);
        break;
      case 'done':
      case 'wav':
        _pendingMsg?.resolve(data);
        _pendingMsg = null;
        break;
      case 'aborted':
        _pendingMsg?.reject(new Error('aborted'));
        _pendingMsg = null;
        break;
      case 'error':
        _pendingMsg?.reject(new Error(data.error));
        _pendingMsg = null;
        break;
    }
  };
  _worker.onerror = (e) => {
    _pendingMsg?.reject(new Error(e.message || 'Worker error'));
    _pendingMsg = null;
  };
  return _worker;
}

function workerSend(msg, transfer) {
  return new Promise((resolve, reject) => {
    _pendingMsg = { resolve, reject };
    getWorker().postMessage(msg, transfer ? [transfer] : []);
  });
}

function absoluteBase() {
  // Must be called from the main thread where window.location is available.
  // Returns e.g. "https://pulsar.farbeyond.dev/Research"
  const bp = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
  return window.location.origin + bp;
}

async function ensureWorkerReady(onStatus) {
  _onStatusCb = onStatus;
  if (_workerReady) return true;
  if (_workerBusy)  return false;
  _workerBusy = true;
  try {
    const base       = absoluteBase();      // absolute URL — safe inside a blob worker
    const wasmPath   = base + '/';
    const skipWebGPU = webgpuKnownBroken();
    onStatus('Initialising TTS engine…');
    await workerSend({ cmd: 'init', wasmPath, basePath: base, skipWebGPU });
    _workerReady = true;
    _workerBusy  = false;
    return true;
  } catch (err) {
    console.error('Worker init failed:', err);
    _workerBusy = false;
    return false;
  }
}

async function workerLoadVoice(name) {
  if (_workerVoice === name) return;
  const base = absoluteBase();
  await workerSend({ cmd: 'loadVoice', path: `${base}/assets/voice_styles/${name}.json` });
  _workerVoice = name;
}

function workerSynthesize(text, lang, steps, speed) {
  return workerSend({ cmd: 'synthesize', text, lang, steps, speed });
}

function workerAbort() {
  _pendingMsg?.reject(new Error('aborted'));
  _pendingMsg = null;
  _worker?.postMessage({ cmd: 'abort' });
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
    workerAbort();
    try { sourceRef.current?.stop(); } catch {}
    try { audioCtxRef.current?.close(); } catch {}
    sourceRef.current = null;
    audioCtxRef.current = null;
    setTtsStatus(s => s === 'unavailable' ? s : 'ready');
    setTtsMsg('');
  }, []);

  const startReading = useCallback(async () => {
    abortRef.current = false;
    setTtsStatus('loading');
    setTtsMsg('');

    const ok = await ensureWorkerReady((msg) => setTtsMsg(msg));
    if (!ok) { setTtsStatus('unavailable'); setTtsMsg('TTS engine failed to load'); return; }

    try {
      setTtsMsg(`Loading voice ${voice}…`);
      await workerLoadVoice(voice);
    } catch {
      setTtsStatus('unavailable'); setTtsMsg('Voice failed to load'); return;
    }

    const sections = extractSections();
    if (!sections.length) { setTtsStatus('ready'); return; }

    setTtsStatus('reading');
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    try {
      for (let i = 0; i < sections.length; i++) {
        if (abortRef.current) break;
        const sec = sections[i];

        // Synthesise in the worker (off the main thread — no freeze)
        setTtsMsg(`Synthesising "${sec.label}" (${i + 1}/${sections.length})…`);
        let wav;
        try {
          _onStatusCb = (msg) => setTtsMsg(msg);
          const res = await workerSynthesize(sec.text, lang, steps, speed);
          wav = res; // { buffer, sampleRate }
        } catch (err) {
          if (err.message === 'aborted' || abortRef.current) break;
          // WebGPU inference failure — mark broken, restart worker with WASM
          if (!webgpuKnownBroken()) {
            markWebgpuBroken();
            _workerReady = false; _workerVoice = null;
            _worker?.terminate(); _worker = null;
            _workerBusy = false;
            setTtsMsg('WebGPU failed — restarting with WASM…');
            const ok2 = await ensureWorkerReady((m) => setTtsMsg(m));
            if (!ok2 || abortRef.current) break;
            await workerLoadVoice(voice);
            try {
              _onStatusCb = (msg) => setTtsMsg(msg);
              wav = await workerSynthesize(sec.text, lang, steps, speed);
            } catch { continue; }
          } else {
            setTtsMsg(`Skipping "${sec.label}": ${err.message}`);
            continue;
          }
        }

        if (abortRef.current) break;

        // Decode and play (main thread — non-blocking hardware audio)
        setTtsMsg(`▶  "${sec.label}" (${i + 1}/${sections.length})`);
        const decoded = await ctx.decodeAudioData(wav.buffer);
        if (abortRef.current) break;

        await new Promise((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          sourceRef.current = src;
          src.onended = resolve;
          src.start();
        });
        sourceRef.current = null;
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
        </div>
      )}
    </div>
  );
}
