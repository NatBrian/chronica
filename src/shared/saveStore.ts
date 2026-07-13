// Autosave store (F2): rolling 3 slots, checksum per slot, corrupt-slot
// fallback. Backend-abstracted so the rolling logic is unit-testable.
import { Journal } from './types';
import { fnv1a } from '../sim/rng/rng';

export interface SaveRecord {
  slot: number;
  savedAt: number;          // wall clock ms (outside sim — allowed here)
  seed: number;
  islandName: string;
  tick: number;
  journal: Journal;
  snapshot: ArrayBuffer;    // packed current state
  chronicle?: unknown;      // stored chapters (M5)
  checksum: number;
}

export interface SaveBackend {
  put(key: string, value: SaveRecord): Promise<void>;
  get(key: string): Promise<SaveRecord | null>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export function computeChecksum(rec: Omit<SaveRecord, 'checksum'>): number {
  const u8 = new Uint8Array(rec.snapshot);
  let h = 0x811c9dc5;
  // sample-stride hash keeps saves fast even at 4 MB
  const stride = Math.max(1, u8.length >> 16);
  for (let i = 0; i < u8.length; i += stride) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193);
  }
  h = (h ^ fnv1a(`${rec.seed}:${rec.tick}:${rec.journal.entries.length}`)) >>> 0;
  return h;
}

const SLOTS = 3;

export class SaveStore {
  constructor(private backend: SaveBackend, private worldKey: string) {}

  /** Write next rolling slot (oldest overwritten). */
  async save(rec: Omit<SaveRecord, 'checksum' | 'slot'>): Promise<number> {
    const existing = await this.list();
    let slot = 0;
    if (existing.length >= SLOTS) {
      existing.sort((a, b) => a.savedAt - b.savedAt);
      slot = existing[0].slot;
    } else {
      const used = new Set(existing.map(r => r.slot));
      while (used.has(slot)) slot++;
    }
    const full: SaveRecord = { ...rec, slot, checksum: 0 };
    full.checksum = computeChecksum(full);
    await this.backend.put(`${this.worldKey}:${slot}`, full);
    return slot;
  }

  async list(): Promise<SaveRecord[]> {
    const keys = (await this.backend.keys()).filter(k => k.startsWith(`${this.worldKey}:`));
    const out: SaveRecord[] = [];
    for (const k of keys.sort()) {
      const r = await this.backend.get(k);
      if (r) out.push(r);
    }
    return out;
  }

  /** Newest valid save; corrupt slots are skipped (fall back one slot — F2). */
  async loadLatestValid(): Promise<SaveRecord | null> {
    const all = await this.list();
    all.sort((a, b) => b.savedAt - a.savedAt);
    for (const rec of all) {
      const expect = rec.checksum;
      const actual = computeChecksum({ ...rec });
      if (expect === actual) return rec;
    }
    return null;
  }
}

export class MemoryBackend implements SaveBackend {
  private m = new Map<string, SaveRecord>();
  async put(k: string, v: SaveRecord): Promise<void> { this.m.set(k, v); }
  async get(k: string): Promise<SaveRecord | null> { return this.m.get(k) ?? null; }
  async keys(): Promise<string[]> { return [...this.m.keys()]; }
  async delete(k: string): Promise<void> { this.m.delete(k); }
}

const DB_NAME = 'chronica';
const STORE = 'saves';

export class IdbBackend implements SaveBackend {
  private dbP: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbP) {
      this.dbP = new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    return this.dbP;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  put(k: string, v: SaveRecord): Promise<void> {
    return this.tx('readwrite', st => st.put(v, k)) as unknown as Promise<void>;
  }
  get(k: string): Promise<SaveRecord | null> {
    return this.tx('readonly', st => st.get(k)).then(r => (r as SaveRecord) ?? null);
  }
  keys(): Promise<string[]> {
    return this.tx('readonly', st => st.getAllKeys()).then(ks => (ks as IDBValidKey[]).map(String));
  }
  delete(k: string): Promise<void> {
    return this.tx('readwrite', st => st.delete(k)) as unknown as Promise<void>;
  }

  /** List every world's newest record (landing resume list). */
  async allRecords(): Promise<SaveRecord[]> {
    const ks = await this.keys();
    const out: SaveRecord[] = [];
    for (const k of ks) {
      const r = await this.get(k);
      if (r) out.push(r);
    }
    return out;
  }
}
