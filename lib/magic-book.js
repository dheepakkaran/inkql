/* Shared logic between the local Express dev server (server.js) and the
   Vercel serverless handler (api/ask.js). Any change to prompts, validation,
   or Gemini/OCR calls goes here — both entry points stay in sync. */

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const OCR_PROVIDER = (process.env.OCR_PROVIDER || 'gemini').toLowerCase();
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || 'helloworld';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const VISION_SYSTEM_PROMPT = `You are the Magic Book — a mystical parchment that reads handwritten questions and answers them.

The image contains a handwritten question written with a stylus on a light parchment background.

STEP 1 — TRANSCRIBE:
Read the handwriting word-by-word. Be literal: transcribe exactly what is written, not what you think the user meant. If a word is genuinely unreadable, use [?].

STEP 2 — ANSWER:
Answer the transcribed question in 2–4 short sentences. Style: clear, direct, warm — as if handwritten in a magic tome. No markdown, no lists, no code blocks.

If the writing is not a question (e.g., a statement, a doodle, blank), set answer to a single friendly line like "The parchment awaits your question."

Return your reply strictly as JSON matching the schema.`;

export const TEXT_SYSTEM_PROMPT = `You are the Magic Book — a mystical parchment that answers questions from a wise, warm perspective.

The user's handwritten question (transcribed by OCR) is provided below. It may have small OCR errors — infer the intended question when reasonable.

Answer in 2–4 short sentences. Style: clear, direct, warm — as if handwritten in a magic tome. No markdown, no lists, no code blocks.

If the transcription is nonsense or empty, answer: "The parchment awaits your question."

Return your reply strictly as JSON matching the schema.`;

export const VISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcribed: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    answer: { type: 'STRING' },
  },
  required: ['transcribed', 'confidence', 'answer'],
};

export const TEXT_SCHEMA = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' } },
  required: ['answer'],
};

export function validateImage(image) {
  if (typeof image !== 'string' || image.length === 0) {
    return { ok: false, error: 'image is required' };
  }
  if (!image.startsWith('data:image/')) {
    return { ok: false, error: 'invalid image format' };
  }
  const commaIdx = image.indexOf(',');
  if (commaIdx === -1) {
    return { ok: false, error: 'malformed data URI' };
  }
  const base64 = image.slice(commaIdx + 1);
  const approxBytes = base64.length * 0.75;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'image too large (max 3MB)' };
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    return { ok: false, error: 'invalid base64 content' };
  }
  return { ok: true, base64 };
}

export async function callGemini(parts, schema) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.4,
      maxOutputTokens: 600,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      const err = new Error(detail);
      err.upstreamStatus = response.status;
      throw err;
    }
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');
    return JSON.parse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

export async function ocrSpaceExtract(base64) {
  const form = new URLSearchParams();
  form.append('apikey', OCR_SPACE_API_KEY);
  form.append('base64Image', `data:image/png;base64,${base64}`);
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  form.append('language', 'eng');
  form.append('isTable', 'false');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await res.json();
  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : (data.ErrorMessage || 'OCR.space failed');
    throw new Error(`OCR.space: ${msg}`);
  }
  return (data.ParsedResults?.[0]?.ParsedText || '').trim();
}

export function toClientError(err) {
  const raw = String(err?.message || '').toLowerCase();
  if (err?.name === 'AbortError' || raw.includes('timeout') || raw.includes('aborted')) {
    return { code: 'timeout', message: 'The parchment thinks too long. Try again.' };
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate')) {
    return { code: 'quota', message: 'The book is silent for a moment.' };
  }
  if (raw.includes('safety') || raw.includes('blocked')) {
    return { code: 'safety', message: 'The book refuses to answer this.' };
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('key')) {
    return { code: 'auth', message: 'The magic seal is broken.' };
  }
  return { code: 'server_error', message: 'The magic falters. Try again.' };
}

/* Main ask handler — returns { status, body } for either Express or Vercel to send. */
export async function handleAsk(image) {
  const validation = validateImage(image);
  if (!validation.ok) {
    return { status: 400, body: { error: 'bad_image', message: validation.error } };
  }
  const base64 = validation.base64;

  try {
    if (OCR_PROVIDER === 'ocrspace') {
      const transcribed = await ocrSpaceExtract(base64);
      if (!transcribed) {
        return {
          status: 200,
          body: {
            transcribed: '',
            confidence: 'low',
            answer: 'The parchment awaits your question.',
            provider: 'ocrspace',
          },
        };
      }
      const { answer } = await callGemini(
        [{ text: `${TEXT_SYSTEM_PROMPT}\n\nQuestion (OCR'd): "${transcribed}"` }],
        TEXT_SCHEMA
      );
      return {
        status: 200,
        body: { transcribed, confidence: 'medium', answer, provider: 'ocrspace' },
      };
    }

    const parsed = await callGemini(
      [
        { text: VISION_SYSTEM_PROMPT },
        { inline_data: { mime_type: 'image/png', data: base64 } },
      ],
      VISION_SCHEMA
    );
    return { status: 200, body: { ...parsed, provider: 'gemini' } };
  } catch (err) {
    console.error('handleAsk error:', err);
    const { code, message } = toClientError(err);
    const status = code === 'quota' ? 429 : code === 'auth' ? 502 : 500;
    return { status, body: { error: code, message } };
  }
}
