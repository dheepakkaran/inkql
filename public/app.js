import { getStroke } from 'https://esm.sh/perfect-freehand@1.2.2';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { desynchronized: true });
const statusEl = document.getElementById('status');
const confidenceEl = document.getElementById('confidence');
const feedEl = document.getElementById('feed');
const feedInner = document.getElementById('feedInner');
const emptyState = document.getElementById('emptyState');
const entryTemplate = document.getElementById('entryTemplate');
const thinkingEl = document.getElementById('thinking');
const thinkingTextEl = document.getElementById('thinkingText');
const canvasHint = document.getElementById('canvasHint');
const dateEl = document.getElementById('dateEl');
const menuBtn = document.getElementById('menuBtn');

/* Track most recent Q&A pairs (client-side) so follow-up questions inherit
   context. Kept short to stay under model context limits. */
const MAX_HISTORY = 4;
const conversationHistory = [];

const THINKING_PHRASES = [
  'the journal listens…',
  'reading your handwriting…',
  'considering…',
  'writing an answer…',
  'the pen is thinking…',
];

const strokes = [];
let current = null;
let isAsking = false;
let thinkingTimer = null;
let revealAbort = null;
let entryCount = 0;

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
  statusEl.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  autoSubmitTimer = setTimeout(() => {
    autoSubmitTimer = null;
    askBook();
  }, AUTO_SUBMIT_MS);
}

const STROKE_OPTIONS = {
  size: 2.5,
  thinning: 0.55,
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
   pointercancel with a captured pointerId. */
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cancelAutoSubmit();
  hideCanvasHint();
  refreshCanvasRect();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  activePointerId = e.pointerId;
  current = { points: [getPoint(e)], pointerType: e.pointerType };
  strokes.push(current);
  statusEl.textContent = 'writing';
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
  statusEl.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  scheduleAutoSubmit();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

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
  ctx.fillStyle = '#1c2a4a';
  for (const s of strokes) drawStroke(s.points, s.pointerType);
}

/* Render strokes to an offscreen canvas with baked notebook background. */
function exportImage() {
  const w = canvasRect.width || canvas.clientWidth;
  const h = canvasRect.height || canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  const off = document.createElement('canvas');
  off.width = Math.round(w * dpr);
  off.height = Math.round(h * dpr);
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);
  octx.fillStyle = '#fdfaf1';
  octx.fillRect(0, 0, w, h);
  octx.fillStyle = '#1c2a4a';
  for (const s of strokes) drawStroke(s.points, s.pointerType, octx);
  return off.toDataURL('image/png');
}

function hideCanvasHint() {
  if (canvasHint) canvasHint.classList.add('hidden');
}
function showCanvasHint() {
  if (canvasHint && strokes.length === 0) canvasHint.classList.remove('hidden');
}

/* -------- Toolbar buttons -------- */

document.getElementById('undo').addEventListener('click', () => {
  cancelAutoSubmit();
  strokes.pop();
  redraw();
  statusEl.textContent = strokes.length ? `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}` : '';
  if (strokes.length > 0) scheduleAutoSubmit();
  else showCanvasHint();
});

document.getElementById('clear').addEventListener('click', () => {
  cancelAutoSubmit();
  strokes.length = 0;
  redraw();
  statusEl.textContent = '';
  showCanvasHint();
});

document.getElementById('preview').addEventListener('click', () => {
  if (strokes.length === 0) { statusEl.textContent = 'write something first'; return; }
  const url = exportImage();
  const w = window.open('');
  if (!w) { statusEl.textContent = 'popup blocked'; return; }
  w.document.write(`<title>Preview</title><body style="margin:0;background:#f2f2f7;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%;max-height:100vh"/></body>`);
});

if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    if (conversationHistory.length === 0 && feedInner.querySelectorAll('.entry').length === 0) {
      flashStatus('a fresh page');
      return;
    }
    conversationHistory.length = 0;
    feedInner.innerHTML = '';
    if (emptyState) {
      feedInner.appendChild(emptyState);
      emptyState.classList.remove('hidden');
    }
    entryCount = 0;
    flashStatus('new page');
  });
}

function flashStatus(text, ms = 1500) {
  statusEl.textContent = text;
  setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, ms);
}

/* -------- Gentle ink fade during API call --------
   No sparks — the ink just softens as the journal thinks. */

function gentleFade() {
  const snapshot = strokes.slice();
  const startTime = performance.now();
  const soakDuration = 4200;
  const finishDuration = 550;

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
      const baseAlpha = 1 - 0.5 * soakT;
      const ft = Math.min(1, (now - finishStart) / finishDuration);
      alpha = baseAlpha * (1 - ft);
    } else {
      const t = Math.min(1, (now - startTime) / soakDuration);
      alpha = 1 - 0.5 * t;
    }

    if (alpha > 0.02) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#1c2a4a';
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

/* -------- Thinking indicator (placeholder entry that appears in feed) -------- */

function showThinking(questionText) {
  if (!thinkingEl) return;
  thinkingEl.classList.remove('hidden');
  cycleThinkingPhrase();
  clearInterval(thinkingTimer);
  thinkingTimer = setInterval(cycleThinkingPhrase, 2400);
  scrollFeedToBottom();
}
function cycleThinkingPhrase() {
  if (!thinkingTextEl) return;
  const next = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
  thinkingTextEl.style.opacity = '0';
  setTimeout(() => {
    thinkingTextEl.textContent = next;
    thinkingTextEl.style.opacity = '';
  }, 250);
}
function hideThinking() {
  if (thinkingEl) thinkingEl.classList.add('hidden');
  clearInterval(thinkingTimer);
  thinkingTimer = null;
}

/* -------- Feed / entry rendering -------- */

function formatTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function scrollFeedToBottom(smooth = true) {
  requestAnimationFrame(() => {
    feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function appendEntry({ question, provider, confidence }) {
  if (emptyState && !emptyState.classList.contains('hidden')) {
    emptyState.classList.add('hidden');
  }
  entryCount += 1;

  const frag = entryTemplate.content.cloneNode(true);
  const article = frag.querySelector('.entry');
  const timeEl = frag.querySelector('.entry-time');
  const qEl = frag.querySelector('.entry-q');
  const aEl = frag.querySelector('.entry-a');

  timeEl.textContent = `${formatTime(new Date())} · Entry ${entryCount}`;
  qEl.textContent = question || '(illegible)';

  if (thinkingEl && !thinkingEl.classList.contains('hidden')) {
    feedInner.insertBefore(article, thinkingEl.nextSibling); // shouldn't happen, but safe
  }
  feedInner.appendChild(article);

  return { article, aEl };
}

function markEntryError(aEl, message) {
  aEl.classList.add('error');
  aEl.textContent = message || 'Something went wrong.';
}

/* -------- Char-by-char pencil reveal for the answer -------- */

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

function pauseFor(char) {
  if (char === ' ') return 22;
  if (char === ',' || char === ';' || char === ':') return 160;
  if (char === '.' || char === '!' || char === '?') return 260;
  if (char === '\n') return 200;
  return 28 + Math.random() * 22;
}

async function revealInk(el, text, signal) {
  el.innerHTML = '';
  const shouldFollowScroll = () => {
    const nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 120;
    return nearBottom;
  };
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
    if (shouldFollowScroll()) scrollFeedToBottom(false);
    try { await sleep(pauseFor(ch), signal); } catch { return; }
  }
}

/* -------- Ask -------- */

async function askBook() {
  cancelAutoSubmit();
  if (isAsking) return;
  if (strokes.length === 0) {
    statusEl.textContent = 'write something first';
    return;
  }

  isAsking = true;
  statusEl.textContent = '';
  showThinking();

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

    hideThinking();
    await dissolve.finish();
    strokes.length = 0;
    showCanvasHint();

    confidenceEl.textContent = `${data.confidence || '—'} · via ${data.provider || 'gemini'}`;

    const { aEl } = appendEntry({
      question: data.transcribed,
      provider: data.provider,
      confidence: data.confidence,
    });

    if (data.transcribed && data.answer) {
      conversationHistory.push({ question: data.transcribed, answer: data.answer });
      while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
    }

    scrollFeedToBottom();

    /* Small pause so the reader sees their question written down first,
       then the "A" appears letter by letter like a pencil answering. */
    await sleep(500).catch(() => {});

    const controller = new AbortController();
    revealAbort = () => controller.abort();
    await revealInk(aEl, data.answer || '', controller.signal);
  } catch (err) {
    hideThinking();
    const { aEl } = appendEntry({ question: '(the pen slipped)' });
    markEntryError(aEl, err.message || 'Something went wrong.');
    strokes.length = 0;
    redraw();
    showCanvasHint();
  } finally {
    isAsking = false;
    statusEl.textContent = '';
    scrollFeedToBottom();
  }
}

document.getElementById('ask').addEventListener('click', askBook);

/* -------- Date in masthead -------- */

function updateDate() {
  if (!dateEl) return;
  const d = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  dateEl.textContent = d.toLocaleDateString(undefined, opts);
}
updateDate();

/* -------- Canvas sizing (ResizeObserver + rAF for iPad layout timing) -------- */

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
}
requestAnimationFrame(() => requestAnimationFrame(resize));
resize();
statusEl.textContent = '';
