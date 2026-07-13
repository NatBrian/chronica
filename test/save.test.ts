// F2: rolling 3-slot autosave, checksum, corrupt-slot fallback.
import { describe, it, expect } from 'vitest';
import { SaveStore, MemoryBackend, computeChecksum, SaveRecord } from '../src/shared/saveStore';
import { SIM_VERSION, defaultConfig } from '../src/shared/types';

function makeRec(tick: number, savedAt: number): Omit<SaveRecord, 'checksum' | 'slot'> {
  const snapshot = new ArrayBuffer(1024);
  new Uint8Array(snapshot).fill(tick & 255);
  return {
    savedAt, seed: 42, islandName: 'Testholm', tick,
    journal: { header: { seed: 42, simVersion: SIM_VERSION, config: defaultConfig() }, entries: [] },
    snapshot,
  };
}

describe('F2: autosave slots', () => {
  it('rolls 3 slots, oldest overwritten', async () => {
    const store = new SaveStore(new MemoryBackend(), 'w42');
    await store.save(makeRec(100, 1));
    await store.save(makeRec(200, 2));
    await store.save(makeRec(300, 3));
    await store.save(makeRec(400, 4));   // overwrites savedAt=1
    const all = await store.list();
    expect(all.length).toBe(3);
    expect(all.map(r => r.tick).sort((a, b) => a - b)).toEqual([200, 300, 400]);
  });

  it('corrupt newest slot → falls back to previous valid slot', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend, 'w42');
    await store.save(makeRec(100, 1));
    await store.save(makeRec(200, 2));
    const slot3 = await store.save(makeRec(300, 3));
    // corrupt newest (browser killed mid-write): flip snapshot bytes
    const rec = await backend.get(`w42:${slot3}`);
    new Uint8Array(rec!.snapshot).fill(99);
    await backend.put(`w42:${slot3}`, rec!);
    const loaded = await store.loadLatestValid();
    expect(loaded).not.toBeNull();
    expect(loaded!.tick).toBe(200);      // fell back one slot
  });

  it('checksum validates content', () => {
    const rec = { ...makeRec(100, 1), slot: 0, checksum: 0 };
    rec.checksum = computeChecksum(rec);
    expect(computeChecksum(rec)).toBe(rec.checksum);
    new Uint8Array(rec.snapshot)[5] ^= 0xff;
    expect(computeChecksum(rec)).not.toBe(rec.checksum);
  });
});
