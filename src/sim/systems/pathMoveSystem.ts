// System 7 — movement. Terrain-cost-aware greedy 8-dir steps toward target.
// O(1) per pawn per tick; blocked paths sidestep, then give up (re-decide).
import { ActionId } from '../../shared/types';
import { PawnFlag, SimState } from '../state';
import { isPassable, moveCost } from '../world/map';

const DIRS: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
];

export function pathMoveSystem(s: SimState): void {
  const p = s.pawns;
  const N = s.map.size;
  for (let i = 0; i < s.pawnCount; i++) {
    if (!(p.flags[i] & PawnFlag.Alive)) continue;
    const target = p.actionTarget[i];
    if (target < 0) continue;
    const tx = target % N, ty = (target / N) | 0;
    const px = p.x[i], py = p.y[i];
    if (px === tx && py === ty) continue;                 // arrived; workSystem takes over

    // movement budget: 10/tick normal, 16 fleeing
    const budget = p.action[i] === ActionId.Flee ? 16 : 10;
    p.movePts[i] = Math.min(250, p.movePts[i] + budget);

    let steps = 0;
    while (steps < 2) {                                    // at most 2 tiles/tick (flee)
      const cx = p.x[i], cy = p.y[i];
      if (cx === tx && cy === ty) break;
      const dx = Math.sign(tx - cx), dy = Math.sign(ty - cy);
      // candidate steps: diagonal-first, then axis, then sidesteps
      let moved = false;
      const cands = dx !== 0 && dy !== 0
        ? [[dx, dy], [dx, 0], [0, dy]]
        : dx !== 0
          ? [[dx, 0], [dx, 1], [dx, -1]]
          : [[0, dy], [1, dy], [-1, dy]];
      for (const [mx, my] of cands) {
        const nx = cx + mx, ny = cy + my;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (!isPassable(s.map, ni)) continue;
        const cost = moveCost(s.map, ni);
        if (p.movePts[i] < cost) { moved = true; break; } // can't afford yet — wait
        p.movePts[i] -= cost;
        p.x[i] = nx; p.y[i] = ny;
        moved = true;
        break;
      }
      if (!moved) {
        // fully blocked → abandon action, re-decide next window
        p.action[i] = ActionId.Idle;
        p.actionTarget[i] = -1;
        p.actionTicks[i] = 0;
        break;
      }
      if (p.movePts[i] < 24) break;                        // save leftover for next tick
      steps++;
    }
  }
}
