// Seeded PRNG — xoshiro128** with splitmix32 seeding. Pure 32-bit integer math.
// Each system gets a named stream derived from (rootSeed, streamName) so adding
// a random call in one system never shifts another system's sequence (01 §Determinism).

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** FNV-1a 32-bit string hash — for deriving stream seeds from names. */
export function fnv1a(str: string, basis = 0x811c9dc5): number {
  let h = basis >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private s0: number; private s1: number; private s2: number; private s3: number;

  constructor(seed: number) {
    const mix = splitmix32(seed >>> 0);
    this.s0 = mix(); this.s1 = mix(); this.s2 = mix(); this.s3 = mix();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Next uint32. */
  u32(): number {
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9)) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0; this.s3 ^= this.s1; this.s1 ^= this.s2; this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Integer in [0, n) — unbiased enough for sim purposes (n << 2^32). */
  int(n: number): number {
    return n <= 0 ? 0 : this.u32() % n;
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability num/den (integer odds — no float branching). */
  chance(num: number, den: number): boolean {
    return this.int(den) < num;
  }

  /** Float in [0,1) — ONLY for worldgen-time noise, never tick-time branching. */
  float(): number {
    return this.u32() / 4294967296;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Deterministic in-place Fisher–Yates. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Serialize internal state (for keyframe snapshots). */
  save(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  restore(s: [number, number, number, number]): void {
    this.s0 = s[0]; this.s1 = s[1]; this.s2 = s[2]; this.s3 = s[3];
  }
}

/** Named PRNG streams derived from one root seed. */
export class RngStreams {
  private streams = new Map<string, Rng>();
  constructor(public readonly rootSeed: number) {}

  get(name: string): Rng {
    let r = this.streams.get(name);
    if (!r) {
      r = new Rng((fnv1a(name) ^ this.rootSeed) >>> 0);
      this.streams.set(name, r);
    }
    return r;
  }

  /** Snapshot all stream states, sorted by name for determinism. */
  save(): Record<string, [number, number, number, number]> {
    const out: Record<string, [number, number, number, number]> = {};
    for (const name of [...this.streams.keys()].sort()) {
      out[name] = this.streams.get(name)!.save();
    }
    return out;
  }

  restore(data: Record<string, [number, number, number, number]>): void {
    this.streams.clear();
    for (const name of Object.keys(data).sort()) {
      const r = new Rng(0);
      r.restore(data[name]);
      this.streams.set(name, r);
    }
  }
}
