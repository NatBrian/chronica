// Seeded 2D gradient noise + fBm + domain warp. Uses only IEEE-exact float ops
// (+ - * / sqrt) and integer hashing; bit-identical across engines.
import { Rng } from '../rng/rng';

const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071067811865476, 0.7071067811865476], [-0.7071067811865476, 0.7071067811865476],
  [0.7071067811865476, -0.7071067811865476], [-0.7071067811865476, -0.7071067811865476],
];

export class Noise2D {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private grad(ix: number, iy: number): readonly [number, number] {
    return GRAD[this.perm[(ix & 255) + this.perm[iy & 255]] & 7];
  }

  /** Perlin-style gradient noise in [-1, 1]. */
  at(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dot = (gx: number, gy: number, dx: number, dy: number) => gx * dx + gy * dy;
    const g00 = this.grad(x0, y0), g10 = this.grad(x0 + 1, y0);
    const g01 = this.grad(x0, y0 + 1), g11 = this.grad(x0 + 1, y0 + 1);
    const n00 = dot(g00[0], g00[1], fx, fy);
    const n10 = dot(g10[0], g10[1], fx - 1, fy);
    const n01 = dot(g01[0], g01[1], fx, fy - 1);
    const n11 = dot(g11[0], g11[1], fx - 1, fy - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.4142135623730951;
  }

  /** Fractal Brownian motion, octaves summed, in ~[-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Ridged noise for mountain chains: 1 - |fbm| sharpens into ridges. */
export function ridged(n: Noise2D, x: number, y: number, octaves: number): number {
  let amp = 0.5, freq = 1, sum = 0;
  for (let o = 0; o < octaves; o++) {
    const v = n.at(x * freq, y * freq);
    sum += amp * (1 - (v < 0 ? -v : v));
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
