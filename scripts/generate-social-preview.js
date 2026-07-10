/* Render public/social-preview.html → social-preview.png (1280×640).
   Uses Puppeteer's bundled headless Chromium so fonts and gradients look
   identical to what you see in your browser.

   One-time install:
     npm i -D puppeteer

   Then:
     node scripts/generate-social-preview.js

   Output: ./social-preview.png at repo root. Upload it at
   GitHub → repo Settings → General → Social preview → Upload an image. */

import puppeteer from 'puppeteer';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const htmlPath = join(repoRoot, 'public', 'social-preview.html');
const outPath = join(repoRoot, 'social-preview.png');

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });

/* Wait an extra beat so Google Fonts finish painting */
await new Promise((r) => setTimeout(r, 500));

const cardEl = await page.$('.card');
if (!cardEl) {
  console.error('❌ Could not find .card element in the HTML.');
  await browser.close();
  process.exit(1);
}

await cardEl.screenshot({ path: outPath, omitBackground: false });
await browser.close();

console.log(`✅ social-preview.png written to ${outPath}`);
console.log('   Upload it: GitHub → repo Settings → General → Social preview');
