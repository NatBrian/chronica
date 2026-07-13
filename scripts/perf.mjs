#!/usr/bin/env node
// True headless throughput (01 budget: ≥2000 ticks/s fast-forward).
// Usage: node scripts/perf.mjs [years] [mapSize]
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const years = Number(process.argv[2] ?? 10);
const mapSize = Number(process.argv[3] ?? 192);
const dir = mkdtempSync(join(tmpdir(), 'chronica-perf-'));
try {
  execSync(`npx --no-install esbuild src/sim/engine.ts --bundle --format=esm --platform=node --outfile=${join(dir, 'sim.mjs')}`, { stdio: 'inherit' });
  writeFileSync(join(dir, 'run.mjs'), `
import { Sim } from './sim.mjs';
const sim = Sim.fresh(42, { mapSize: ${mapSize} });
sim.runYears(60);
const t0 = performance.now();
sim.runYears(${years});
const dt = (performance.now() - t0) / 1000;
console.log('pop', sim.state.alivePawns, '→', Math.round(${years} * 360 / dt), 'ticks/s');
`);
  execSync(`node ${join(dir, 'run.mjs')}`, { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
