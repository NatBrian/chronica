// Living ambience (doc 13 V4): the world moves even when nothing happens.
// Chimney smoke, weather made visible, seasonal grading, emergent caravan
// roads, birds. Render clock only; roads accumulate from observed caravans
// (cosmetic wear, resets on reload by design).
import { Camera } from './camera';
import { TICKS_PER_YEAR } from '../shared/types';

/** Integer mix hash: allocation-free seeded variation on the hot draw path. */
function ih(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (h ^ (h >>> 16)) >>> 0;
}

const TICKS_PER_SEASON = TICKS_PER_YEAR / 4;

export class Ambience {
  private wear: Uint8Array;
  private wearN: number;

  constructor(mapSize: number) {
    this.wearN = mapSize;
    this.wear = new Uint8Array(mapSize * mapSize);
  }

  /** caravans grind the grass into roads (V4/B5, emergent wear).
   *  v3 (doc 14 T3b.2): wear spreads to neighbors so routes become visible
   *  roads instead of scattered specks. */
  observeCaravans(caravans: { x: number; y: number }[]): void {
    for (const c of caravans) {
      const cx = c.x | 0, cy = c.y | 0;
      const i = cy * this.wearN + cx;
      if (i < 0 || i >= this.wear.length) continue;
      if (this.wear[i] < 250) this.wear[i] += 6;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = (cy + dy) * this.wearN + (cx + dx);
        if (j >= 0 && j < this.wear.length && this.wear[j] < 200) this.wear[j] += 2;
      }
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

    // drifting cloud shadows (doc 14 T1.5): world-anchored soft blobs, so the
    // land breathes; pure function of (cloud index, clock), render-only
    if (cam.pxPerTile <= 32) {
      const N = this.wearN;
      for (let k = 0; k < 3; k++) {
        const seed = ih(k, 101);
        const drift = now / (46000 + (seed % 9000));
        const wx = ((seed % N) + drift * N * 0.6 + k * N / 3) % (N * 1.3) - N * 0.15;
        const wy = ((seed >> 8) % N) + Math.sin(drift * 4 + k * 2.1) * N * 0.06;
        const [sx, sy] = cam.worldToScreen(wx, wy);
        const r = (34 + (seed % 14)) * cam.pxPerTile;
        if (sx < -r || sy < -r || sx > cam.viewW + r || sy > cam.viewH + r) continue;
        const grad = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r);
        grad.addColorStop(0, 'rgba(20,24,40,0.085)');
        grad.addColorStop(0.7, 'rgba(20,24,40,0.05)');
        grad.addColorStop(1, 'rgba(20,24,40,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(sx, sy, r, r * 0.62, (seed % 7) / 7, 0, 7);
        ctx.fill();
      }
    }

    if (detailAlpha > 0.05) {
      ctx.globalAlpha = detailAlpha;
      // worn roads where caravans have passed: deeper wear = wider, warmer
      if (cam.pxPerTile >= 4) {
        const { x0, y0, x1, y1 } = cam.viewRect();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const w2 = this.wear[y * this.wearN + x];
            if (w2 > 8) {
              const [sx, sy] = cam.worldToScreen(x + 0.25, y + 0.25);
              ctx.fillStyle = w2 > 60 ? 'rgba(176,148,104,0.6)' : 'rgba(140,110,78,0.42)';
              const s = Math.max(2, cam.pxPerTile * (w2 > 60 ? 0.55 : 0.4));
              ctx.fillRect(Math.round(sx), Math.round(sy), s, s);
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
          const a = now / 3400 + bd * 2.1 + ih(st.x, 9) % 7;
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
        const fx = (ih(f, 1) % 1000) / 1000 * cam.viewW + Math.sin(now / 900 + f) * 14;
        const fy = ((now / 24 + (ih(f, 2) % 997)) % (cam.viewH + 8)) - 4;
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
      const raining = (season === 0 || season === 2) && ih(cell, 8) % 3 === 0;
      if (raining) {
        ctx.strokeStyle = 'rgba(95,205,228,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r < 46; r++) {
          const rx = (ih(r, 3) % 1000) / 1000 * cam.viewW;
          const ry = ((now / 3 + (ih(r, 4) % 991)) % (cam.viewH + 20)) - 10;
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 2, ry + 7);
        }
        ctx.stroke();
        // ground contact (doc 14 T5.4): splash rings where drops land
        ctx.strokeStyle = 'rgba(203,219,252,0.3)';
        ctx.beginPath();
        for (let r = 0; r < 14; r++) {
          const t = ((now / 6 + (ih(r, 5) % 613)) % 400) / 400;
          if (t > 0.25) continue;
          const rx = (ih(r, 6) % 1000) / 1000 * cam.viewW;
          const ry = (ih(r, 7) % 1000) / 1000 * cam.viewH;
          const rr = 1 + t * 14;
          ctx.moveTo(rx + rr, ry);
          ctx.ellipse(rx, ry, rr, rr * 0.4, 0, 0, 7);
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
