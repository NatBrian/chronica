// System 3 — crop growth on farm plots (M2). Stages: 0 fallow, 1-199 growing,
// 200+ ripe. Sowing/harvest are pawn actions (workSystem); growth lives here.
import { Season } from '../../shared/types';
import { SimState } from '../state';
import { seasonOf } from './calendarSystem';

export function cropSystem(s: SimState): void {
  // growth pass every 3 ticks (staggered by plot) keeps cost negligible
  if (s.tick % 3 !== 0) return;
  const season = seasonOf(s.tick);
  const m = s.map;
  const drought = s.weather.drought;
  for (const st of s.settlements) {
    if (st.razed) continue;
    for (const plot of st.farmPlots) {
      const c = m.crop[plot];
      if (c === 0 || c >= 200) {
        // winter kills unharvested ripe crops
        if (c >= 200 && season === Season.Winter) m.crop[plot] = 0;
        continue;
      }
      if (season === Season.Winter) { m.crop[plot] = 0; continue; }  // frost
      // growth rate: ripe in ~90-110 ticks on decent soil (sow spring → reap summer/autumn)
      let g = 3 + (m.fertility[plot] >> 5);
      if (drought > 0) g = g >> 1;
      if (season === Season.Summer) g += 2;
      m.crop[plot] = Math.min(210, c + g);
    }
  }
}
