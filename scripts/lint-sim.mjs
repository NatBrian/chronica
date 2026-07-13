#!/usr/bin/env node
// Determinism lint — ground rules 1 & 2 of docs/08-roadmap.md.
// Bans nondeterminism sources in /src/sim and imports from render/ui/brain.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SIM_DIR = new URL('../src/sim', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;

const BANNED = [
  { re: /\bMath\.random\b/, why: 'Math.random banned in /sim — use seeded Rng streams' },
  { re: /\bDate\.now\b/, why: 'Date.now banned in /sim — time is tick count' },
  { re: /\bnew Date\b/, why: 'Date banned in /sim — time is tick count' },
  { re: /\bperformance\.now\b/, why: 'performance.now banned in /sim' },
  { re: /\bsetTimeout\b|\bsetInterval\b/, why: 'timers banned in /sim' },
  { re: /from\s+['"][^'"]*\/(render|ui|brain)\//, why: '/sim must not import render/ui/brain' },
  { re: /from\s+['"](\.\.\/)+(render|ui|brain)['"/]/, why: '/sim must not import render/ui/brain' },
];

let failures = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|js)$/.test(name)) continue;
    const src = readFileSync(p, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('lint-sim-allow')) return;
      for (const { re, why } of BANNED) {
        if (re.test(line)) {
          console.error(`${relative(ROOT, p)}:${i + 1}: ${why}\n    ${line.trim()}`);
          failures++;
        }
      }
    });
  }
}

try { walk(SIM_DIR); } catch (e) {
  console.error('lint-sim: cannot read src/sim:', e.message);
  process.exit(1);
}

if (failures > 0) {
  console.error(`\nlint-sim: ${failures} violation(s). Determinism rules are bugs, not style.`);
  process.exit(1);
}
console.log('lint-sim: OK');
