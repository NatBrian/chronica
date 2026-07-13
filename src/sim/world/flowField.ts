// Settlement flow fields (03 §Movement): cost-weighted Dijkstra from the
// settlement center over a windowed region. Pure function of (map, center) —
// cached outside SimState, recomputable, so determinism is unaffected.
import { SimState, Settlement } from '../state';
import { WorldMap, isPassable, moveCost } from './map';

export interface Field {
  x0: number; y0: number; w: number; h: number;
  cx: number; cy: number;
  dist: Uint16Array;    // 65535 = unreachable
  parent: Uint8Array;   // direction index into DIRS8 pointing TOWARD center
}

export const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
];

const RADIUS = 48;
const OPP = [1, 0, 3, 2, 7, 6, 5, 4]; // opposite direction index in DIRS8

const fieldCache = new WeakMap<object, Map<string, Field>>();

export function getField(s: SimState, st: Settlement): Field {
  let m = fieldCache.get(s.map);
  if (!m) { m = new Map(); fieldCache.set(s.map, m); }
  const key = `${st.x},${st.y}`;
  let f = m.get(key);
  if (!f) {
    f = computeField(s.map, st.x, st.y);
    m.set(key, f);
  }
  return f;
}

function computeField(map: WorldMap, cx: number, cy: number): Field {
  const N = map.size;
  const x0 = Math.max(0, cx - RADIUS), y0 = Math.max(0, cy - RADIUS);
  const x1 = Math.min(N - 1, cx + RADIUS), y1 = Math.min(N - 1, cy + RADIUS);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const dist = new Uint16Array(w * h).fill(65535);
  const parent = new Uint8Array(w * h).fill(255);
  const idx = (x: number, y: number) => (y - y0) * w + (x - x0);
  // integer Dijkstra via bucket queue (costs 6..24)
  const buckets: number[][] = [];
  const push = (d: number, v: number) => {
    (buckets[d] ??= []).push(v);
  };
  dist[idx(cx, cy)] = 0;
  push(0, idx(cx, cy));
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const v = bucket[bi];
      if (dist[v] !== d) continue;
      const vx = (v % w) + x0, vy = ((v / w) | 0) + y0;
      for (let dir = 0; dir < 8; dir++) {
        const nx = vx + DIRS8[dir][0], ny = vy + DIRS8[dir][1];
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const ni = ny * N + nx;
        if (!isPassable(map, ni)) continue;
        const nd = d + moveCost(map, ni);
        const nv = idx(nx, ny);
        if (nd < dist[nv]) {
          dist[nv] = nd;
          // parent points back toward center: opposite dir
          parent[nv] = OPP[dir];
          push(nd, nv);
        }
      }
    }
  }
  return { x0, y0, w, h, cx, cy, dist, parent };
}

export function inField(f: Field, x: number, y: number): boolean {
  return x >= f.x0 && y >= f.y0 && x < f.x0 + f.w && y < f.y0 + f.h;
}

export function fieldDist(f: Field, x: number, y: number): number {
  if (!inField(f, x, y)) return 65535;
  return f.dist[(y - f.y0) * f.w + (x - f.x0)];
}

/** Step from (x,y) one tile toward the center along the Dijkstra tree. */
export function stepToCenter(f: Field, x: number, y: number): [number, number] | null {
  const p = f.parent[(y - f.y0) * f.w + (x - f.x0)];
  if (p === 255) return null;
  return [x + DIRS8[p][0], y + DIRS8[p][1]];
}

/** Chain of tiles from (tx,ty) back to center (inclusive). Null if unreachable. */
export function chainToCenter(f: Field, tx: number, ty: number, maxLen = 256): number[] | null {
  if (fieldDist(f, tx, ty) === 65535) return null;
  const chain: number[] = [];
  let x = tx, y = ty;
  for (let i = 0; i < maxLen; i++) {
    chain.push(y * 65536 + x);
    if (x === f.cx && y === f.cy) return chain;
    const nxt = stepToCenter(f, x, y);
    if (!nxt) return null;
    x = nxt[0]; y = nxt[1];
  }
  return null;
}
