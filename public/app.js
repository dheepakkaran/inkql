import { getStroke } from 'https://esm.sh/perfect-freehand@1.2.2';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const answerOverlay = document.getElementById('answerOverlay');
const transcribedEl = document.getElementById('transcribed');
const confidenceEl = document.getElementById('confidence');
const answerTextEl = document.getElementById('answerText');
const spellTextEl = document.getElementById('spellText');
const pageNav = document.getElementById('pageNav');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageIndicator = document.getElementById('pageIndicator');

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

let responsePages = [];
let currentPageIdx = 0;

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

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  redraw();
}

function getPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  return [
    evt.clientX - rect.left,
    evt.clientY - rect.top,
    evt.pressure && evt.pressure > 0 ? evt.pressure : 0.5,
  ];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cancelAutoSubmit();
  if (!answerOverlay.classList.contains('hidden')) {
    dismissAnswer();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  current = { points: [getPoint(e)], pointerType: e.pointerType };
  strokes.push(current);
  status.textContent = 'writing';
  redraw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!current || e.buttons === 0) return;
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
  for (const ev of events) current.points.push(getPoint(ev));
  redraw();
});

function endStroke() {
  if (!current) return;
  current = null;
  status.textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}`;
  scheduleAutoSubmit();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', endStroke);

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
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#2a1a08';
  for (const s of strokes) drawStroke(s.points, s.pointerType);
}

/* Render strokes to an offscreen canvas with baked paper background.
   Renders from `strokes` array, independent of live canvas — safe during dissolve. */
function exportImage() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const off = document.createElement('canvas');
  off.width = Math.round(rect.width * dpr);
  off.height = Math.round(rect.height * dpr);
  const octx = off.getContext('2d');
  octx.scale(dpr, dpr);
  octx.fillStyle = '#efe1c0';
  octx.fillRect(0, 0, rect.width, rect.height);
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

document.getElementById('preview').addEventListener('click', () => {
  const url = exportImage();
  const w = window.open('');
  if (!w) { status.textContent = 'popup blocked'; return; }
  w.document.write(`<title>Preview</title><body style="margin:0;background:#f2f2f7;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%;max-height:100vh"/></body>`);
});

function dismissAnswer() {
  if (revealAbort) revealAbort();
  answerOverlay.classList.add('hidden');
  answerTextEl.innerHTML = '';
  answerTextEl.classList.remove('error', 'flipping');
  transcribedEl.textContent = '';
  pageNav.classList.add('hidden');
  responsePages = [];
  currentPageIdx = 0;
  status.textContent = '';
}

answerOverlay.addEventListener('click', (e) => {
  if (e.target.closest('.page-nav')) return;
  dismissAnswer();
});
answerOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissAnswer();
  else if (e.key === 'ArrowRight' && currentPageIdx < responsePages.length - 1) {
    showPage(currentPageIdx + 1);
  } else if (e.key === 'ArrowLeft' && currentPageIdx > 0) {
    showPage(currentPageIdx - 1);
  }
});

/* -------- Magical dissolve — ink burns into embers, smoke, and sparks --------
   Realistic fire physics: embers start slow, fall a little, then buoyancy lifts
   them upward with sideways wobble; color transitions hot-white → orange → red
   as they cool; motion-blur trails via prev-position line segments; smoke wisps
   rise behind; occasional bright spark bursts. Uses 'lighter' composite for
   additive glow (no shadow blur — much faster on iPad). */

function magicalDissolve() {
  const rect = canvas.getBoundingClientRect();
  const snapshot = strokes.slice();

  const allPoints = [];
  for (const s of snapshot) {
    for (const p of s.points) allPoints.push(p);
  }

  const embers = [];
  const smoke = [];
  const sparks = [];

  const startTime = performance.now();
  let running = true;
  let finishing = false;
  let finishStart = 0;
  let finalBurstDone = false;
  let resolveFinish = null;
  let lastFrame = startTime;
  let emberAcc = 0, smokeAcc = 0, sparkAcc = 0;

  function spawnEmber(intense) {
    if (allPoints.length === 0) return;
    const src = allPoints[Math.floor(Math.random() * allPoints.length)];
    const size = 0.9 + Math.random() * 1.6 + (intense ? 0.6 : 0);
    const e = {
      x: src[0] + (Math.random() - 0.5) * 4,
      y: src[1] + (Math.random() - 0.5) * 4,
      px: 0, py: 0,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.08 + Math.random() * 0.18,
      life: 0,
      maxLife: 1400 + Math.random() * 1400,
      size,
      buoyancy: 0.0009 + Math.random() * 0.0007,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.0028 + Math.random() * 0.0032,
    };
    e.px = e.x; e.py = e.y;
    embers.push(e);
  }

  function spawnSmoke() {
    if (allPoints.length === 0) return;
    const src = allPoints[Math.floor(Math.random() * allPoints.length)];
    smoke.push({
      x: src[0] + (Math.random() - 0.5) * 10,
      y: src[1] + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.07 - Math.random() * 0.1,
      life: 0,
      maxLife: 2000 + Math.random() * 1500,
      size: 4 + Math.random() * 7,
      opacity: 0.05 + Math.random() * 0.05,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.002 + Math.random() * 0.001,
    });
  }

  function spawnSpark() {
    if (allPoints.length === 0) return;
    const src = allPoints[Math.floor(Math.random() * allPoints.length)];
    sparks.push({
      x: src[0] + (Math.random() - 0.5) * 6,
      y: src[1] + (Math.random() - 0.5) * 6,
      life: 0,
      maxLife: 220 + Math.random() * 160,
      size: 6 + Math.random() * 10,
    });
  }

  function emberColor(lt) {
    if (lt < 0.3) {
      const k = lt / 0.3;
      return { r: 255, g: Math.round(240 - 60 * k), b: Math.round(160 - 100 * k) };
    }
    if (lt < 0.65) {
      const k = (lt - 0.3) / 0.35;
      return { r: Math.round(255 - 35 * k), g: Math.round(180 - 90 * k), b: Math.round(60 - 35 * k) };
    }
    const k = (lt - 0.65) / 0.35;
    return { r: Math.round(220 - 180 * k), g: Math.round(90 - 70 * k), b: Math.round(25 - 20 * k) };
  }

  function frame(now) {
    if (!running && embers.length === 0 && smoke.length === 0 && sparks.length === 0) {
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (resolveFinish) { const r = resolveFinish; resolveFinish = null; r(); }
      return;
    }

    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;

    ctx.clearRect(0, 0, rect.width, rect.height);

    /* Ink base — slow fade while running, quick fade while finishing */
    let inkAlpha;
    if (finishing) {
      const ft = Math.min(1, (now - finishStart) / 850);
      inkAlpha = 0.55 * (1 - ft);
    } else {
      const t = Math.min(1, (now - startTime) / 3500);
      inkAlpha = 1 - 0.45 * t;
    }
    if (inkAlpha > 0.02) {
      ctx.globalAlpha = inkAlpha;
      ctx.fillStyle = '#2a1a08';
      for (const s of snapshot) drawStroke(s.points, s.pointerType);
      ctx.globalAlpha = 1;
    }

    /* Final burst on entering finish state (one-shot) */
    if (finishing && !finalBurstDone) {
      for (let i = 0; i < 45; i++) spawnEmber(true);
      for (let i = 0; i < 7; i++) spawnSpark();
      for (let i = 0; i < 6; i++) spawnSmoke();
      finalBurstDone = true;
    }

    /* Continuous spawn */
    emberAcc += dt;
    const emberInterval = finishing ? 4 : 8;
    while (emberAcc >= emberInterval) {
      emberAcc -= emberInterval;
      if (running) spawnEmber(false);
      else if (finishing && (now - finishStart) < 550) {
        spawnEmber(true);
        if (Math.random() < 0.35) spawnEmber(true);
      }
    }
    smokeAcc += dt;
    if (smokeAcc >= 70) {
      smokeAcc = 0;
      if (running) spawnSmoke();
      else if (finishing && (now - finishStart) < 400) spawnSmoke();
    }
    sparkAcc += dt;
    if (sparkAcc >= 260) {
      sparkAcc = 0;
      if (running && Math.random() < 0.5) spawnSpark();
      else if (finishing && (now - finishStart) < 550) spawnSpark();
    }

    /* Smoke first (behind embers, normal composite) */
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life += dt;
      const lt = s.life / s.maxLife;
      if (lt >= 1) { smoke.splice(i, 1); continue; }
      s.wobble += s.wobbleSpeed * dt;
      s.vx += Math.sin(s.wobble) * 0.004;
      s.vy -= dt * 0.00012;
      s.x += s.vx * dt * 0.1;
      s.y += s.vy * dt * 0.1;

      const op = s.opacity * Math.sin(lt * Math.PI);
      const sz = s.size * (1 + lt * 1.8);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sz);
      g.addColorStop(0, `rgba(45, 28, 15, ${op})`);
      g.addColorStop(1, 'rgba(30, 20, 12, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Embers with additive glow (lighter composite) */
    ctx.globalCompositeOperation = 'lighter';
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.life += dt;
      const lt = e.life / e.maxLife;
      if (lt >= 1) { embers.splice(i, 1); continue; }

      e.px = e.x; e.py = e.y;
      e.vy -= e.buoyancy * dt;
      e.vy += 0.00025 * dt;
      e.wobble += e.wobbleSpeed * dt;
      e.vx += Math.sin(e.wobble) * 0.012;
      e.x += e.vx * dt * 0.15;
      e.y += e.vy * dt * 0.15;

      const alpha = lt < 0.08 ? lt / 0.08 : (lt < 0.9 ? 1 : (1 - lt) / 0.1);
      const size = e.size * (1 - lt * 0.4);
      const c = emberColor(lt);

      /* Motion-blur trail from previous position */
      ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.5})`;
      ctx.lineWidth = Math.max(0.5, size * 1.1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.px, e.py);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      /* Outer halo */
      ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.28})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, size * 3.2, 0, Math.PI * 2);
      ctx.fill();

      /* Middle glow */
      ctx.fillStyle = `rgba(${Math.min(c.r + 30, 255)}, ${Math.min(c.g + 30, 255)}, ${Math.min(c.b + 20, 255)}, ${alpha * 0.55})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, size * 1.6, 0, Math.PI * 2);
      ctx.fill();

      /* Hot white core (only while hot) */
      if (lt < 0.5) {
        ctx.fillStyle = `rgba(255, 245, 210, ${alpha * (1 - lt * 2) * 0.9})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Bright cross-flash sparks */
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.life += dt;
      const lt = sp.life / sp.maxLife;
      if (lt >= 1) { sparks.splice(i, 1); continue; }
      const alpha = Math.sin(lt * Math.PI);
      const size = sp.size * (1 + lt * 0.5);

      const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, size);
      g.addColorStop(0, `rgba(255, 255, 240, ${alpha})`);
      g.addColorStop(0.4, `rgba(255, 220, 130, ${alpha * 0.7})`);
      g.addColorStop(1, 'rgba(255, 220, 130, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 250, 220, ${alpha * 0.85})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - size, sp.y);
      ctx.lineTo(sp.x + size, sp.y);
      ctx.moveTo(sp.x, sp.y - size);
      ctx.lineTo(sp.x, sp.y + size);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    finish: () => new Promise((resolve) => {
      resolveFinish = resolve;
      finishing = true;
      finishStart = performance.now();
      setTimeout(() => { running = false; }, 850);
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

/* -------- Multi-page response -------- */

const MAX_CHARS_PER_PAGE = 360;

function splitIntoPages(text, maxChars = MAX_CHARS_PER_PAGE) {
  const trimmed = (text || '').trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const parts = trimmed.match(/[^.!?\n]+[.!?\n]+|\S[^.!?\n]*$/g) || [trimmed];
  const pages = [];
  let cur = '';
  for (const part of parts) {
    if ((cur + part).length > maxChars && cur.length > 0) {
      pages.push(cur.trim());
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur.trim()) pages.push(cur.trim());
  return pages;
}

function updatePageNav() {
  if (responsePages.length <= 1) {
    pageNav.classList.add('hidden');
    return;
  }
  pageNav.classList.remove('hidden');
  pageIndicator.textContent = `${currentPageIdx + 1} / ${responsePages.length}`;
  prevPageBtn.disabled = currentPageIdx === 0;
  nextPageBtn.disabled = currentPageIdx === responsePages.length - 1;
}

async function showPage(idx) {
  if (idx < 0 || idx >= responsePages.length) return;
  if (revealAbort) revealAbort();

  const isSameIndex = idx === currentPageIdx && answerTextEl.innerHTML !== '';
  if (!isSameIndex && answerTextEl.innerHTML !== '') {
    answerTextEl.classList.add('flipping');
    await sleep(220).catch(() => {});
  }

  currentPageIdx = idx;
  updatePageNav();

  answerTextEl.innerHTML = '';
  answerTextEl.classList.remove('flipping');

  const controller = new AbortController();
  revealAbort = () => controller.abort();
  revealInk(answerTextEl, responsePages[idx], controller.signal);
}

prevPageBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentPageIdx > 0) showPage(currentPageIdx - 1);
});
nextPageBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentPageIdx < responsePages.length - 1) showPage(currentPageIdx + 1);
});

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
    const dissolve = magicalDissolve();

    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
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

    transcribedEl.textContent = data.transcribed ? `you wrote — ${data.transcribed}` : '';
    confidenceEl.textContent = `${data.confidence || '—'} · via ${data.provider || 'gemini'}`;
    answerTextEl.classList.remove('error');

    responsePages = splitIntoPages(data.answer || '');
    currentPageIdx = 0;
    answerTextEl.innerHTML = '';
    answerOverlay.classList.remove('hidden');
    answerOverlay.focus?.();

    await showPage(0);
  } catch (err) {
    hideSpellText();
    status.textContent = '';
    transcribedEl.textContent = '';
    responsePages = [];
    currentPageIdx = 0;
    pageNav.classList.add('hidden');
    answerTextEl.classList.add('error');
    answerTextEl.textContent = err.message || 'Something went wrong.';
    answerOverlay.classList.remove('hidden');
    redraw();
  } finally {
    isAsking = false;
  }
}

document.getElementById('ask').addEventListener('click', askBook);

window.addEventListener('resize', resize);
resize();
status.textContent = '';
