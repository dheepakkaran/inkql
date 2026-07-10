import { getStroke } from 'https://esm.sh/perfect-freehand@1.2.2';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { desynchronized: true });
const status = document.getElementById('status');
const answerOverlay = document.getElementById('answerOverlay');
const transcribedEl = document.getElementById('transcribed');
const confidenceEl = document.getElementById('confidence');
const answerTextEl = document.getElementById('answerText');
const spellTextEl = document.getElementById('spellText');
const answerScroll = document.getElementById('answerScroll');
const bookPage = document.getElementById('bookPage');
const followUpEl = document.getElementById('followUp');

/* Track most recent Q&A pairs (client-side) so the book can answer follow-up
   questions with context. Kept short to stay under model context limits. */
const MAX_HISTORY = 4;
const conversationHistory = [];

const SPELL_PHRASES = [
  'the ink stirs',
  'the parchment listens',
  'ancient pages turn',
  'whispers rise from the ink',
  'the quill searches',
  'deciphering your hand',
  'the book remembers',
  'consulting the magic',
];

const strokes = [];
let current = null;
let isAsking = false;
let spellTextTimer = null;
let revealAbort = null;

const AUTO_SUBMIT_MS = 2000;
let autoSubmitTimer = null;

function cancelAutoSubmit() {
  if (autoSubmitTimer) {
    clearTimeout(autoSubmitTimer);
    autoSubmitTimer = null;
  }
}
function scheduleAutoSubmit() {
  cancelAutoSubmit();
  if (strokes.length === 0 || isAsking) return;
  status.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  autoSubmitTimer = setTimeout(() => {
    autoSubmitTimer = null;
    askBook();
  }, AUTO_SUBMIT_MS);
}

const STROKE_OPTIONS = {
  size: 3.5,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
  last: true,
};

let canvasRect = { left: 0, top: 0, width: 0, height: 0 };
let activePointerId = null;

function refreshCanvasRect() {
  canvasRect = canvas.getBoundingClientRect();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  refreshCanvasRect();
  const w = Math.max(1, canvasRect.width);
  const h = Math.max(1, canvasRect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  redraw();
}

function getPoint(evt) {
  return [
    evt.clientX - canvasRect.left,
    evt.clientY - canvasRect.top,
    evt.pressure && evt.pressure > 0 ? evt.pressure : 0.5,
  ];
}

/* On iPadOS Apple Pencil, `e.buttons` sometimes reports 0 mid-stroke and
   `pointerleave` fires spuriously. We only trust pointerdown → pointerup /
   pointercancel with a captured pointerId. That + a cached bounding rect is
   what fixed strokes not appearing on iPad. */
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cancelAutoSubmit();
  if (!answerOverlay.classList.contains('hidden')) {
    dismissAnswer();
    return;
  }
  refreshCanvasRect();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  activePointerId = e.pointerId;
  current = { points: [getPoint(e)], pointerType: e.pointerType };
  strokes.push(current);
  status.textContent = 'writing';
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!current || e.pointerId !== activePointerId) return;
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
  for (const ev of events) current.points.push(getPoint(ev));
  redraw();
});

function endStroke(e) {
  if (!current) return;
  if (e && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
  current = null;
  activePointerId = null;
  status.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  scheduleAutoSubmit();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

/* Block iOS default gestures inside the writing surface */
['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'gestureend'].forEach((t) => {
  canvas.addEventListener(t, (e) => e.preventDefault(), { passive: false });
});

function drawStroke(points, pointerType, targetCtx = ctx) {
  const opts = { ...STROKE_OPTIONS };
  if (pointerType === 'pen') opts.simulatePressure = false;
  const outline = getStroke(points, opts);
  if (outline.length < 2) return;

  targetCtx.beginPath();
  targetCtx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    targetCtx.lineTo(outline[i][0], outline[i][1]);
  }
  targetCtx.closePath();
  targetCtx.fill();
}

function redraw() {
  const w = canvasRect.width || canvas.clientWidth;
  const h = canvasRect.height || canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#2a1a08';
  for (const s of strokes) drawStroke(s.points, s.pointerType);
}

/* Render strokes to an offscreen canvas with baked paper background.
   Renders from `strokes` array, independent of live canvas — safe during dissolve. */
function exportImage() {
  const w = canvasRect.width || canvas.clientWidth;
  const h = canvasRect.height || canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  const off = document.createElement('canvas');
  off.width = Math.round(w * dpr);
  off.height = Math.round(h * dpr);
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);
  octx.fillStyle = '#efe1c0';
  octx.fillRect(0, 0, w, h);
  octx.fillStyle = '#1c1c1e';
  for (const s of strokes) drawStroke(s.points, s.pointerType, octx);
  return off.toDataURL('image/png');
}

/* -------- Buttons -------- */

document.getElementById('undo').addEventListener('click', () => {
  cancelAutoSubmit();
  strokes.pop();
  redraw();
  status.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  if (strokes.length > 0) scheduleAutoSubmit();
});

document.getElementById('clear').addEventListener('click', () => {
  cancelAutoSubmit();
  strokes.length = 0;
  redraw();
  status.textContent = '';
});

const menuBtn = document.querySelector('.bar-btn:not(.ghost)');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    if (conversationHistory.length === 0) {
      status.textContent = 'a fresh page';
    } else {
      conversationHistory.length = 0;
      updateFollowUpHint();
      status.textContent = 'a new chapter begins';
    }
    setTimeout(() => { if (status.textContent === 'a new chapter begins' || status.textContent === 'a fresh page') status.textContent = ''; }, 1600);
  });
  menuBtn.setAttribute('aria-label', 'Start a new chapter');
  menuBtn.title = 'Start a new chapter';
}

document.getElementById('preview').addEventListener('click', () => {
  const url = exportImage();
  const w = window.open('');
  if (!w) { status.textContent = 'popup blocked'; return; }
  w.document.write(`<title>Preview</title><body style="margin:0;background:#f2f2f7;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%;max-height:100vh"/></body>`);
});

function dismissAnswer() {
  if (revealAbort) revealAbort();
  answerOverlay.classList.add('closing');
  const finish = () => {
    answerOverlay.classList.remove('closing', 'opening');
    answerOverlay.classList.add('hidden');
    answerTextEl.innerHTML = '';
    answerTextEl.classList.remove('error');
    transcribedEl.innerHTML = '';
    status.textContent = '';
  };
  setTimeout(finish, 340);
}

answerOverlay.addEventListener('click', () => dismissAnswer());
answerOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Enter') dismissAnswer();
});

/* -------- Gentle ink fade --------
   No sparks, no embers — just the ink slowly absorbing into the parchment
   while the book listens. Fade continues until the API returns, then a
   short accelerated fade to clear on `finish()`. */

function gentleFade() {
  const snapshot = strokes.slice();
  const startTime = performance.now();
  const soakDuration = 4200;   // while waiting, ink slowly softens (not fully gone)
  const finishDuration = 700;  // once answer arrives, remaining ink fades away

  let finishing = false;
  let finishStart = 0;
  let resolveFinish = null;
  let done = false;

  function frame(now) {
    if (done) return;
    const w = canvasRect.width || canvas.clientWidth;
    const h = canvasRect.height || canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    let alpha;
    if (finishing) {
      const soakT = Math.min(1, (finishStart - startTime) / soakDuration);
      const baseAlpha = 1 - 0.55 * soakT;
      const ft = Math.min(1, (now - finishStart) / finishDuration);
      alpha = baseAlpha * (1 - ft);
    } else {
      const t = Math.min(1, (now - startTime) / soakDuration);
      alpha = 1 - 0.55 * t;
    }

    if (alpha > 0.02) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#2a1a08';
      for (const s of snapshot) drawStroke(s.points, s.pointerType);
      ctx.globalAlpha = 1;
    }

    if (finishing && (now - finishStart) >= finishDuration) {
      ctx.clearRect(0, 0, w, h);
      done = true;
      if (resolveFinish) { const r = resolveFinish; resolveFinish = null; r(); }
      return;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    finish: () => new Promise((resolve) => {
      resolveFinish = resolve;
      finishing = true;
      finishStart = performance.now();
    }),
  };
}

/* -------- Spell phrases (rotating hint while dissolving) -------- */

function showSpellText() {
  let i = Math.floor(Math.random() * SPELL_PHRASES.length);
  spellTextEl.textContent = SPELL_PHRASES[i];
  spellTextEl.classList.remove('hidden');
  clearInterval(spellTextTimer);
  spellTextTimer = setInterval(() => {
    i = (i + 1) % SPELL_PHRASES.length;
    spellTextEl.style.opacity = '0';
    setTimeout(() => {
      spellTextEl.textContent = SPELL_PHRASES[i];
      spellTextEl.style.opacity = '';
    }, 300);
  }, 2400);
}

function hideSpellText() {
  clearInterval(spellTextTimer);
  spellTextTimer = null;
  spellTextEl.classList.add('hidden');
}

/* -------- Char-by-char ink reveal -------- */

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

function pauseFor(char) {
  if (char === ' ') return 30;
  if (char === ',' || char === ';' || char === ':') return 220;
  if (char === '.' || char === '!' || char === '?') return 340;
  if (char === '\n') return 260;
  return 45 + Math.random() * 30;
}

async function revealInk(el, text, signal) {
  el.innerHTML = '';
  for (const ch of text) {
    if (signal?.aborted) return;
    if (ch === '\n') {
      el.appendChild(document.createElement('br'));
    } else {
      const span = document.createElement('span');
      span.className = 'char' + (ch === ' ' ? ' space' : '');
      span.textContent = ch;
      el.appendChild(span);
    }
    try { await sleep(pauseFor(ch), signal); } catch { return; }
  }
}

/* -------- Ask -------- */

async function askBook() {
  cancelAutoSubmit();
  if (isAsking) return;
  if (strokes.length === 0) {
    status.textContent = 'write something first';
    return;
  }

  isAsking = true;
  status.textContent = '';
  showSpellText();

  try {
    const image = exportImage();
    const dissolve = gentleFade();

    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, history: conversationHistory }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.code = data.error;
      throw err;
    }

    hideSpellText();
    await dissolve.finish();
    strokes.length = 0;

    transcribedEl.textContent = data.transcribed || '';
    /* Force the quillWrite animation to replay on repeat asks (browsers
       don't always restart CSS animations when a hidden parent reappears). */
    transcribedEl.style.animation = 'none';
    void transcribedEl.offsetWidth;
    transcribedEl.style.animation = '';
    confidenceEl.textContent = `${data.confidence || '—'} · via ${data.provider || 'gemini'}`;
    answerTextEl.classList.remove('error');
    answerTextEl.innerHTML = '';

    /* Remember this exchange so the next question inherits context. */
    if (data.transcribed && data.answer) {
      conversationHistory.push({ question: data.transcribed, answer: data.answer });
      while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
    }
    updateFollowUpHint();

    answerOverlay.classList.remove('hidden');
    answerOverlay.classList.add('opening');
    answerOverlay.focus?.();
    if (answerScroll) answerScroll.scrollTop = 0;
    setTimeout(() => answerOverlay.classList.remove('opening'), 900);

    /* Hold a beat after the page opens so the reader can read their question
       before the book's answer starts writing itself. */
    await sleep(650).catch(() => {});

    const controller = new AbortController();
    revealAbort = () => controller.abort();
    await revealInk(answerTextEl, data.answer || '', controller.signal);
  } catch (err) {
    hideSpellText();
    status.textContent = '';
    transcribedEl.textContent = '';
    answerTextEl.classList.add('error');
    answerTextEl.textContent = err.message || 'Something went wrong.';
    answerOverlay.classList.remove('hidden');
    redraw();
  } finally {
    isAsking = false;
  }
}

function updateFollowUpHint() {
  if (!followUpEl) return;
  if (conversationHistory.length === 0) {
    followUpEl.classList.add('hidden');
    followUpEl.textContent = '';
  } else {
    followUpEl.classList.remove('hidden');
    followUpEl.textContent = `chapter ${conversationHistory.length} · ask a follow-up`;
  }
}

document.getElementById('ask').addEventListener('click', askBook);

/* Keep the canvas backing store in sync with layout. On iPad, the initial
   getBoundingClientRect() may fire before flex layout resolves — a
   ResizeObserver gives us the real dimensions the moment they change. */
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
}
requestAnimationFrame(() => requestAnimationFrame(resize));
resize();
status.textContent = '';
