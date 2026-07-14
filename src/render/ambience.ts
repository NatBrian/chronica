// Living ambience (doc 13 V4): the world moves even when nothing happens.
// Chimney smoke, weather made visible, seasonal grading, emergent caravan
// roads, birds. Render clock only; roads accumulate from observed caravans
// (cosmetic wear, resets on reload by design).
import { Camera } from './camera';
import { TICKS_PER_YEAR } from '../shared/types';
import { fnv1a } from '../sim/rng/rng';

const TICKS_PER_SEASON = TICKS_PER_YEAR / 4;

export class Ambience {
  private wear: Uint8Array;
  private wearN: number;

  constructor(mapSize: number) {
    this.wearN = mapSize;
    this.wear = new Uint8Array(mapSize * mapSize);
  }

  /** caravans grind the grass into roads (V4/B5, emergent wear) */
  observeCaravans(caravans: { x: number; y: number }[]): void {
    for (const c of caravans) {
      const i = (c.y | 0) * this.wearN + (c.x | 0);
      if (i >= 0 && i < this.wear.length && this.wear[i] < 250) this.wear[i] += 3;
    }
  }

  draw(
    ctx: CanvasRenderingContext2D, cam: Camera, now: number, tick: number,
    snap: {
      settlements: { x: number; y: number; razed: boolean; pop: number }[];
      weather?: { drought: number; winterSeverity: number; plagueActive: boolean };
    },
    detailAlpha: number,
  ): void {
    const season = Math.floor(tick / TICKS_PER_SEASON) % 4;

    if (detailAlpha > 0.05) {
      ctx.globalAlpha = detailAlpha;
      // worn roads where caravans have passed
      if (cam.pxPerTile >= 8) {
        const { x0, y0, x1, y1 } = cam.viewRect();
        ctx.fillStyle = 'rgba(102,57,49,0.35)';
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (this.wear[y * this.wearN + x] > 12) {
              const [sx, sy] = cam.worldToScreen(x + 0.35, y + 0.35);
              ctx.fillRect(Math.round(sx), Math.round(sy), Math.max(2, cam.pxPerTile * 0.3), Math.max(2, cam.pxPerTile * 0.3));
            }
          }
        }
      }
      // chimney smoke, one gentle stream per ~80 souls
      for (const st of snap.settlements) {
        if (st.razed || st.pop < 20) continue;
        const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y - 0.5);
        if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
        const streams = Math.min(3, 1 + (st.pop / 150 | 0));
        for (let s2 = 0; s2 < streams; s2++) {
          for (let p = 0; p < 3; p++) {
            const t = ((now / 2600) + p / 3 + s2 * 0.37) % 1;
            ctx.globalAlpha = detailAlpha * 0.35 * (1 - t);
            ctx.fillStyle = '#9badb7';
            ctx.beginPath();
            ctx.arc(
              sx + (s2 - 1) * 9 + Math.sin(t * 5 + s2 * 2) * 3,
              sy - 4 - t * 26, 1.5 + t * 3, 0, 7);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
      // birds wheel over the biggest town in view
      const big = snap.settlements.filter(s2 => !s2.razed && s2.pop > 120);
      for (const st of big.slice(0, 2)) {
        const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y + 0.5);
        if (sx < 0 || sy < 0 || sx > cam.viewW || sy > cam.viewH) continue;
        for (let bd = 0; bd < 3; bd++) {
          const a = now / 3400 + bd * 2.1 + fnv1a(`bird:${st.x}`) % 7;
          const bx = sx + Math.cos(a) * (30 + bd * 8);
          const by = sy - 30 + Math.sin(a) * 12;
          const flap = Math.sin(now / 120 + bd) > 0 ? 1 : 0;
          ctx.strokeStyle = 'rgba(34,32,52,0.7)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(bx - 2, by + flap); ctx.lineTo(bx, by - 1); ctx.lineTo(bx + 2, by + flap);
          ctx.stroke();
        }
      }
    }

    // ---- weather + season, full viewport ----
    const w = snap.weather;
    if (season === 3) {
      // winter: cold cast + snowfall (heavier with winterSeverity)
      ctx.fillStyle = 'rgba(203,219,252,0.10)';
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      const flakes = 40 + (w?.winterSeverity ?? 0) / 4;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let f = 0; f < flakes; f++) {
        const fx = (fnv1a(`sn:${f}`) % 1000) / 1000 * cam.viewW + Math.sin(now / 900 + f) * 14;
        const fy = ((now / 24 + (fnv1a(`sy:${f}`) % 997)) % (cam.viewH + 8)) - 4;
        ctx.fillRect(Math.round(fx % (cam.viewW + 10)), Math.round(fy), 2, 2);
      }
    } else if (w && w.drought > 0) {
      // drought: dusty heat haze bands
      ctx.fillStyle = 'rgba(223,113,38,0.06)';
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      ctx.fillStyle = 'rgba(238,195,154,0.05)';
      for (let bnd = 0; bnd < 3; bnd++) {
        const by = ((now / 40 + bnd * 220) % (cam.viewH + 120)) - 60;
        ctx.fillRect(0, by, cam.viewW, 26);
      }
    } else {
      // passing rain showers, seeded from the sim clock: scrub-consistent
      const cell = Math.floor(tick / (TICKS_PER_SEASON / 2));
      const raining = (season === 0 || season === 2) && fnv1a(`rain:${cell}`) % 3 === 0;
      if (raining) {
        ctx.strokeStyle = 'rgba(95,205,228,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r < 46; r++) {
          const rx = (fnv1a(`rx:${r}`) % 1000) / 1000 * cam.viewW;
          const ry = ((now / 3 + (fnv1a(`ry:${r}`) % 991)) % (cam.viewH + 20)) - 10;
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 2, ry + 7);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(48,96,130,0.05)';
        ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      }
      // gentle seasonal grade
      if (season === 0) { ctx.fillStyle = 'rgba(153,229,80,0.04)'; ctx.fillRect(0, 0, cam.viewW, cam.viewH); }
      if (season === 2) { ctx.fillStyle = 'rgba(223,113,38,0.06)'; ctx.fillRect(0, 0, cam.viewW, cam.viewH); }
    }
  }
}
