import { handleAsk } from '../lib/magic-book.js';

/* In-memory rate limit — best-effort per Vercel function instance.
   Not shared across instances, so limits are approximate. For strict
   enforcement, plug in Upstash Redis or Vercel KV later. */
const requestLog = new Map();
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_MINUTE = 15;
const MAX_PER_DAY = 100;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real);
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = requestLog.get(ip) || { minute: [], day: [] };
  entry.minute = entry.minute.filter(t => now - t < MINUTE_MS);
  entry.day = entry.day.filter(t => now - t < DAY_MS);
  if (entry.day.length >= MAX_PER_DAY) return 'daily';
  if (entry.minute.length >= MAX_PER_MINUTE) return 'minute';
  entry.minute.push(now);
  entry.day.push(now);
  requestLog.set(ip, entry);
  return null;
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
  }

  const ip = clientIp(req);
  const limited = checkRateLimit(ip);
  if (limited === 'daily') {
    return res.status(429).json({ error: 'daily_limit', message: 'The book has spoken enough today.' });
  }
  if (limited === 'minute') {
    return res.status(429).json({ error: 'rate_limit', message: 'The book rests. Return in a moment.' });
  }

  const { image } = req.body || {};
  const result = await handleAsk(image);
  return res.status(result.status).json(result.body);
}
