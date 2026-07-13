// Long-distance routes: cost-aware A* between settlement anchors, cached per
// (from,to) pair. Pure function of the static passability map — recomputable,
// so the cache lives outside SimState and determinism is unaffected.
import { SimState } from '../state';
import { WorldMap, isPassable, moveCost } from './map';

const routeCache = new WeakMap<object, Map<string, Int32Array | null>>();

/** Packed tile path from (ax,ay) to (bx,by), inclusive. Null if unreachable. */
export function getRoute(s: SimState, ax: number, ay: number, bx: number, by: number): Int32Array | null {
  let m = routeCache.get(s.map);
  if (!m) { m = new Map(); routeCache.set(s.map, m); }
  const key = `${ax},${ay}:${bx},${by}`;
  if (m.has(key)) return m.get(key)!;
  const rev = m.get(`${bx},${by}:${ax},${ay}`);
  if (rev) {
    const fwd = new Int32Array(rev.length);
    for (let i = 0; i < rev.length; i++) fwd[i] = rev[rev.length - 1 - i];
    m.set(key, fwd);
    return fwd;
  }
  const path = astar(s.map, ax, ay, bx, by);
  m.set(key, path);
  return path;
}

function astar(map: WorldMap, ax: number, ay: number, bx: number, by: number): Int32Array | null {
  const N = map.size;
  const start = ay * N + ax, goal = by * N + bx;
  if (!isPassable(map, start) || !isPassable(map, goal)) return null;
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  // binary heap of [f, node]
  const heap: number[] = [];      // pairs flattened
  const push = (f: number, v: number) => {
    heap.push(f, v);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p * 2] <= heap[i * 2]) break;
      swap(i, p); i = p;
    }
  };
  const swap = (i: number, j: number) => {
    const f = heap[i * 2], v = heap[i * 2 + 1];
    heap[i * 2] = heap[j * 2]; heap[i * 2 + 1] = heap[j * 2 + 1];
    heap[j * 2] = f; heap[j * 2 + 1] = v;
  };
  const pop = (): number => {
    const v = heap[1];
    const n = heap.length / 2 - 1;
    heap[0] = heap[n * 2]; heap[1] = heap[n * 2 + 1];
    heap.length = n * 2;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let sm = i;
      if (l < heap.length / 2 && heap[l * 2] < heap[sm * 2]) sm = l;
      if (r < heap.length / 2 && heap[r * 2] < heap[sm * 2]) sm = r;
      if (sm === i) break;
      swap(i, sm); i = sm;
    }
    return v;
  };
  const h = (v: number) => {
    const x = v % N, y = (v / N) | 0;
    return (Math.max(Math.abs(x - bx), Math.abs(y - by))) * 10;
  };
  g.set(start, 0);
  push(h(start), start);
  let expansions = 0;
  const LIMIT = 90_000;
  while (heap.length > 0 && expansions < LIMIT) {
    const cur = pop();
    if (cur === goal) {
      const out: number[] = [];
      let v: number | undefined = goal;
      while (v !== undefined) { out.push(v); v = parent.get(v); }
      out.reverse();
      return Int32Array.from(out);
    }
    expansions++;
    const cx = cur % N, cy = (cur / N) | 0;
    const gc = g.get(cur)!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nv = ny * N + nx;
        if (!isPassable(map, nv)) continue;
        const ng = gc + moveCost(map, nv);
        const old = g.get(nv);
        if (old === undefined || ng < old) {
          g.set(nv, ng);
          parent.set(nv, cur);
          push(ng + h(nv), nv);
        }
      }
    }
  }
  return null;
}

/** Advance along a route from current packed position; returns next tile. */
export function nextOnRoute(route: Int32Array, curIdx: number): number {
  return Math.min(route.length - 1, curIdx + 1);
}

/** Find index of the route node nearest to (x,y), searching forward from hint. */
export function nearestRouteIdx(route: Int32Array, N: number, x: number, y: number, hint: number): number {
  let best = hint, bestD = Infinity;
  const lo = Math.max(0, hint - 4), hi = Math.min(route.length - 1, hint + 8);
  for (let i = lo; i <= hi; i++) {
    const rx = route[i] % N, ry = (route[i] / N) | 0;
    const d = Math.max(Math.abs(rx - x), Math.abs(ry - y));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
