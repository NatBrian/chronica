// Impact decals (doc 14 T3.5/D8): history leaves marks on the land. Every
// decal is derived purely from (major event log, current tick), so the time
// machine reproduces them exactly at any scrub position. Capped at 64 live
// decals; drawing is a handful of canvas ops each, no per-frame allocation
// beyond the rebuilt active list on event/tick-window changes.
import { Camera } from './camera';
import { EventType, TICKS_PER_YEAR } from '../shared/types';
import { fnv1a } from '../sim/rng/rng';

interface DecalSpec { kind: 'scorch' | 'rubble' | 'blood' | 'trample' | 'confetti' | 'plague'; ttlYears: number; r: number }

const SPEC: Partial<Record<number, DecalSpec>> = {
  [EventType.BattleFought]: { kind: 'blood', ttlYears: 1.5, r: 2.2 },
  [EventType.SettlementRazed]: { kind: 'rubble', ttlYears: 8, r: 3.2 },
  [EventType.DragonRaid]: { kind: 'scorch', ttlYears: 4, r: 3.4 },
  [EventType.ForestFire]: { kind: 'scorch', ttlYears: 3, r: 4.0 },
  [EventType.Festival]: { kind: 'confetti', ttlYears: 0.4, r: 2.0 },
  [EventType.Plague]: { kind: 'plague', ttlYears: 2, r: 3.0 },
  [EventType.WolfAttack]: { kind: 'blood', ttlYears: 1, r: 1.4 },
  [EventType.TrollBlockade]: { kind: 'trample', ttlYears: 1.5, r: 1.8 },
  [EventType.CaravanRaided]: { kind: 'blood', ttlYears: 1, r: 1.2 },
};

interface Active { x: number; y: number; kind: DecalSpec['kind']; birth: number; ttl: number; r: number; seed: number }

export class Decals {
  private active: Active[] = [];
  private key = '';

  /** Rebuild the active set when events or the tick window change. */
  update(majors: { id: number; tick: number; type: number; x: number; y: number }[], tick: number): void {
    const key = `${majors.length}:${tick >> 5}`;
    if (key === this.key) return;
    this.key = key;
    this.active.length = 0;
    for (let i = majors.length - 1; i >= 0 && this.active.length < 64; i--) {
      const ev = majors[i];
      const spec = SPEC[ev.type];
      if (!spec) continue;
      const ttl = spec.ttlYears * TICKS_PER_YEAR;
      const age = tick - ev.tick;
      if (age < 0 || age > ttl) continue;
      if (ev.x < 0 || ev.y < 0) continue;
      this.active.push({ x: ev.x, y: ev.y, kind: spec.kind, birth: ev.tick, ttl, r: spec.r, seed: fnv1a(`decal:${ev.id}`) });
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, tick: number): void {
    if (!this.active.length || cam.pxPerTile < 4) return;
    for (const d of this.active) {
      const [sx, sy] = cam.worldToScreen(d.x + 0.5, d.y + 0.5);
      const R = d.r * cam.pxPerTile;
      if (sx < -R || sy < -R || sx > cam.viewW + R || sy > cam.viewH + R) continue;
      const age01 = Math.min(1, Math.max(0, (tick - d.birth) / d.ttl));
      const a = age01 < 0.06 ? age01 / 0.06 : 1 - (age01 - 0.06) / 0.94;
      const u = (k: number) => ((d.seed >>> (k * 3)) & 31) / 31;
      switch (d.kind) {
        case 'scorch': {
          ctx.globalAlpha = 0.5 * a;
          ctx.fillStyle = '#14100c';
          ctx.beginPath();
          ctx.ellipse(sx, sy, R, R * 0.7, u(0), 0, 7);
          ctx.fill();
          ctx.globalAlpha = 0.7 * a;
          ctx.fillStyle = '#2a221a';
          for (let i = 0; i < 7; i++) {
            const ang = u(i) * 6.28, rr = R * (0.3 + u(i + 2) * 0.7);
            ctx.fillRect(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr * 0.7, 3, 2);
          }
          break;
        }
        case 'rubble': {
          ctx.globalAlpha = 0.85 * a;
          for (let i = 0; i < 10; i++) {
            const ang = u(i) * 6.28, rr = R * u(i + 3) * 0.8;
            const gx = sx + Math.cos(ang) * rr, gy = sy + Math.sin(ang) * rr * 0.7;
            ctx.fillStyle = i % 3 === 0 ? '#5c636e' : i % 3 === 1 ? '#7e848c' : '#4a4238';
            const s = Math.max(2, cam.pxPerTile * (0.14 + u(i + 5) * 0.2));
            ctx.fillRect(Math.round(gx), Math.round(gy), s, Math.max(2, s * 0.7));
          }
          // one leaning wall remnant
          ctx.fillStyle = '#7e848c';
          ctx.fillRect(Math.round(sx - R * 0.3), Math.round(sy - cam.pxPerTile * 0.5),
            Math.max(2, cam.pxPerTile * 0.2), Math.max(3, cam.pxPerTile * 0.6));
          break;
        }
        case 'blood': {
          ctx.globalAlpha = 0.6 * a;
          ctx.fillStyle = '#7c1f24';
          for (let i = 0; i < 8; i++) {
            const ang = u(i) * 6.28, rr = R * u(i + 2) * 0.7;
            const s = Math.max(1, cam.pxPerTile * 0.1);
            ctx.fillRect(Math.round(sx + Math.cos(ang) * rr), Math.round(sy + Math.sin(ang) * rr * 0.7), s, s);
          }
          break;
        }
        case 'trample': {
          ctx.globalAlpha = 0.4 * a;
          ctx.fillStyle = '#6e5a3a';
          for (let i = 0; i < 6; i++) {
            ctx.fillRect(Math.round(sx - R + u(i) * R * 2), Math.round(sy - R * 0.4 + u(i + 3) * R * 0.8),
              Math.max(2, cam.pxPerTile * 0.5), Math.max(1, cam.pxPerTile * 0.1));
          }
          break;
        }
        case 'confetti': {
          ctx.globalAlpha = 0.9 * a;
          const cols = ['#fbf236', '#d95763', '#5fcde4', '#99e550', '#d77bba'];
          for (let i = 0; i < 12; i++) {
            const ang = u(i) * 6.28, rr = R * u(i + 1);
            ctx.fillStyle = cols[i % cols.length];
            ctx.fillRect(Math.round(sx + Math.cos(ang) * rr), Math.round(sy + Math.sin(ang) * rr * 0.7), 2, 2);
          }
          break;
        }
        case 'plague': {
          ctx.globalAlpha = 0.35 * a;
          ctx.strokeStyle = '#99e550';
          ctx.lineWidth = Math.max(1, cam.pxPerTile * 0.12);
          ctx.beginPath();
          ctx.ellipse(sx, sy, R * (0.6 + 0.4 * age01), R * (0.42 + 0.28 * age01), 0, 0, 7);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
