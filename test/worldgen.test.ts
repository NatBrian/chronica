// M0 exit criteria: seed 42 generates identically twice; rejection rate < 20%.
import { describe, it, expect } from 'vitest';
import { generateWorld } from '../src/sim/world/worldgen';
import { defaultConfig } from '../src/shared/types';
import { isLand } from '../src/sim/world/map';
import { fnv1a } from '../src/sim/rng/rng';

function mapHash(m: { elevation: Uint8Array; biome: Uint8Array; ore: Uint16Array }): number {
  let h = 0x811c9dc5;
  const mix = (arr: ArrayLike<number>) => {
    for (let i = 0; i < arr.length; i++) { h ^= arr[i] & 0xff; h = Math.imul(h, 0x01000193); }
  };
  mix(m.elevation); mix(m.biome); mix(m.ore as unknown as ArrayLike<number>);
  return h >>> 0;
}

describe('worldgen', () => {
  const cfg = { ...defaultConfig(), mapSize: 256 };

  it('seed 42 generates identically twice (hash-verified)', () => {
    const a = generateWorld(42, cfg);
    const b = generateWorld(42, cfg);
    expect(mapHash(a.map)).toBe(mapHash(b.map));
    expect(a.islandName).toBe(b.islandName);
    expect(a.spawns).toEqual(b.spawns);
    expect(fnv1a(JSON.stringify(a.hiddenVeins))).toBe(fnv1a(JSON.stringify(b.hiddenVeins)));
  });

  it('rejection rate < 20% over seeds 0–49', () => {
    let totalAttempts = 0, accepted = 0;
    for (let seed = 0; seed < 50; seed++) {
      const r = generateWorld(seed, cfg);
      totalAttempts += r.rejections + 1;
      accepted++;
      expect(r.spawns.length).toBe(4);
    }
    const rejectionRate = 1 - accepted / totalAttempts;
    // eslint-disable-next-line no-console
    console.log(`worldgen rejection rate: ${(rejectionRate * 100).toFixed(1)}%`);
    expect(rejectionRate).toBeLessThan(0.2);
  });

  it('accepted islands satisfy land fraction and 4 reachable spawns', () => {
    for (const seed of [1, 7, 42, 99]) {
      const r = generateWorld(seed, cfg);
      let land = 0;
      for (let i = 0; i < cfg.mapSize * cfg.mapSize; i++) if (isLand(r.map, i)) land++;
      const frac = land / (cfg.mapSize * cfg.mapSize);
      expect(frac).toBeGreaterThan(0.15);
      expect(frac).toBeLessThan(0.55);
      expect(r.spawns.length).toBe(4);
    }
  });
});
