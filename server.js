import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleAsk } from './lib/magic-book.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

if (!process.env.GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

/* Trust proxy only in production behind a real edge (Vercel/Cloudflare set
   TRUST_PROXY=1). Locally there's no proxy — turning this on would cause
   express-rate-limit to throw ERR_ERL_PERMISSIVE_TRUST_PROXY. */
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use((req, res, next) => {
  if (ALLOWED_ORIGIN) {
    const origin = req.headers.origin;
    if (origin === ALLOWED_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '3mb' }));
app.use(express.static(join(__dirname, 'public')));

const RATE_LIMIT_VALIDATE = process.env.TRUST_PROXY
  ? undefined
  : { trustProxy: false, xForwardedForHeader: false };

const perMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  validate: RATE_LIMIT_VALIDATE,
  handler: (_req, res) => res.status(429).json({
    error: 'rate_limit',
    message: 'The book rests. Return in a moment.',
  }),
});

const perDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: RATE_LIMIT_VALIDATE,
  handler: (_req, res) => res.status(429).json({
    error: 'daily_limit',
    message: 'The book has spoken enough today.',
  }),
});

app.post('/api/ask', perDayLimiter, perMinuteLimiter, async (req, res) => {
  const { image, history } = req.body || {};
  const result = await handleAsk(image, history);
  res.status(result.status).json(result.body);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Magic Book running at http://localhost:${PORT}`);
});
