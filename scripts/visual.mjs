// Visual QA harness (doc 14 T0.1 / D6): captures a fixed screenshot matrix
// against a running dev server. Usage:
//   npm run dev            (vite serves on its default port 5173)
//   node scripts/visual.mjs [outDir] [baseUrl]
// Defaults: outDir=shots-v3, baseUrl=http://127.0.0.1:5173
// Requires: playwright devDep. Seed must be NUMERIC (main.ts parses it with
// Number(...)), so keep SEED a digit string.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = process.argv[2] ?? 'shots-v3';
const BASE = process.argv[3] ?? 'http://127.0.0.1:5173';
const SEED = '20260716';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const key = async (k, ms = 400) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };

// Wait until the HUD year counter reaches a target year.
async function untilYear(y, timeoutMs = 240000) {
  const t0 = Date.now();
  for (;;) {
    const txt = await page.textContent('#hud-year');
    const m = /Year (\d+)/.exec(txt ?? '');
    if (m && Number(m[1]) >= y) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for year ${y} (at: ${txt})`);
    await page.waitForTimeout(500);
  }
}

// ---- landing ----
await page.goto(`${BASE}/?turbo=2000`);
await page.waitForTimeout(2500);
await shot('01-landing');

// ---- begin, run to year 5 ----
await page.fill('#seed-input', SEED);
await page.click('#btn-begin');
await page.waitForTimeout(2500);
await shot('02-begin-default');
await key('3', 200);            // turbo
await untilYear(5);
await key('1', 600);            // back to 1x while shooting
await shot('03-y5-default');

// zoom tour at year 5
await key('-', 700); await key('-', 900);
await shot('04-y5-far');
for (let i = 0; i < 8; i++) await key('+', 350);
await shot('05-y5-closest');
await key('-', 500); await key('-', 700);
await shot('06-y5-mid');

// ---- run to year 30 ----
await key('3', 200);
await untilYear(30);
await key('1', 600);
await shot('07-y30-mid');
await key('t', 800);
await shot('08-y30-territory');
await key('t', 400);
await key('-', 700); await key('-', 900);
await shot('09-y30-far');

// rail tabs (the rail opens by default on wide screens; only toggle if closed)
const railOpen = await page.$eval('#chronicle-rail', el => el.classList.contains('open')).catch(() => false);
if (!railOpen) await key('c', 1000);
await shot('10-y30-chronicle');
for (const t of ['events', 'councils', 'stats']) {
  const btn = page.locator(`.rtab[data-tab="${t}"]`);
  if (await btn.count() && await btn.isVisible()) {
    await btn.click(); await page.waitForTimeout(700);
    await shot(`11-y30-tab-${t}`);
  }
}
await key('c', 400);

// ---- run to year 80: wars/monsters likely; century-arc midpoint ----
await key('3', 200);
await untilYear(80);
await key('1', 600);
await shot('12-y80-mid');
// click a war/tier-1 toast if present to land on an event
const warToast = page.locator('#toast-stack .toast').first();
if (await warToast.count() && await warToast.isVisible()) {
  await warToast.click(); await page.waitForTimeout(1200);
  await shot('13-y80-event-look');
  for (let i = 0; i < 3; i++) await key('+', 350);
  await shot('14-y80-event-close');
}

// ---- run to year 150 for the century test ----
await key('3', 200);
await untilYear(150);
await key('1', 600);
await shot('15-y150-mid');
for (let i = 0; i < 4; i++) await key('+', 350);
await shot('16-y150-capital-close');

// mobile viewport spot check
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await shot('17-y150-mobile');

console.log('captures complete:', OUT);
await browser.close();
