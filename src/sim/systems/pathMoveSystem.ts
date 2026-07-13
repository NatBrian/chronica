// System 7 — movement (03 §Movement & pathfinding).
// Fast path: greedy 8-dir steps. When greedy jams (concave terrain — dwarf
// country), fall back to the settlement flow field: descend to center, then
// walk the Dijkstra chain out to the target. Guaranteed arrival in-region.
import { ActionId } from '../../shared/types';
import { PawnFlag, SimState } from '../state';
import { isPassable, moveCost } from '../world/map';
import { getField, chainToCenter, stepToCenter, inField } from '../world/flowField';

export function pathMoveSystem(s: SimState): void {
  const p = s.pawns;
  const N = s.map.size;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) continue;
    const target = p.actionTarget[i];
    if (target < 0) continue;
    const tx = target % N, ty = (target / N) | 0;
    if (p.x[i] === tx && p.y[i] === ty) continue;          // arrived

    const budget = p.action[i] === ActionId.Flee ? 16 : 10;
    p.movePts[i] = Math.min(250, p.movePts[i] + budget);

    const cx = p.x[i], cy = p.y[i];
    // ---- greedy step ----
    const dx = Math.sign(tx - cx), dy = Math.sign(ty - cy);
    const cands = dx !== 0 && dy !== 0
      ? [[dx, dy], [dx, 0], [0, dy]]
      : dx !== 0
        ? [[dx, 0], [dx, 1], [dx, -1]]
        : [[0, dy], [1, dy], [-1, dy]];
    let nx = -1, ny = -1;
    for (const [mx, my] of cands) {
      const gx = cx + mx, gy = cy + my;
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
      const gi = gy * N + gx;
      if (!isPassable(s.map, gi)) continue;
      // don't take sidesteps that move AWAY from target (jam detector):
      // primary diagonal/axis always ok; sidesteps only if they reduce distance
      nx = gx; ny = gy;
      break;
    }

    if (nx < 0) {
      // ---- greedy jammed → flow-field fallback ----
      const st = s.settlements[p.settlementId[i]];
      if (!st || st.razed) { cancel(s, i); continue; }
      const f = getField(s, st);
      if (!inField(f, cx, cy) || !inField(f, tx, ty)) { cancel(s, i); continue; }
      const chain = chainToCenter(f, tx, ty);
      if (!chain) { cancel(s, i); continue; }
      const packed = cy * 65536 + cx;
      const k = chain.indexOf(packed);
      if (k > 0) {
        // on the target's chain → step outward (toward target)
        const nxt = chain[k - 1];
        nx = nxt % 65536; ny = (nxt / 65536) | 0;
      } else {
        // not on chain → descend toward center
        const nxt = stepToCenter(f, cx, cy);
        if (!nxt) { cancel(s, i); continue; }
        nx = nxt[0]; ny = nxt[1];
      }
    }

    const cost = moveCost(s.map, ny * N + nx);
    if (p.movePts[i] < cost) continue;                     // wait for points
    p.movePts[i] -= cost;
    p.x[i] = nx; p.y[i] = ny;

    // flee can take a second step
    if (p.action[i] === ActionId.Flee && p.movePts[i] >= 24) {
      const dx2 = Math.sign(tx - nx), dy2 = Math.sign(ty - ny);
      const fx = nx + dx2, fy = ny + dy2;
      if (fx >= 0 && fy >= 0 && fx < N && fy < N && isPassable(s.map, fy * N + fx)) {
        const c2 = moveCost(s.map, fy * N + fx);
        if (p.movePts[i] >= c2) {
          p.movePts[i] -= c2;
          p.x[i] = fx; p.y[i] = fy;
        }
      }
    }
  }
}

function cancel(s: SimState, i: number): void {
  s.pawns.action[i] = ActionId.Idle;
  s.pawns.actionTarget[i] = -1;
  s.pawns.actionTicks[i] = 0;
}
