// Event Spectacle Engine (doc 13, V2): tier-1 events play choreographed
// in-world scenes instead of being a 10px icon. Scenes are pure functions of
// (event, snapshot, rAF clock) with seeded variation from the event id, so
// time-machine scrubs replay the identical show. Screen feedback: <= 3px
// shake, brief flash vignette, letterbox title cards. Pooled, alloc-light,
// hard caps: 3 concurrent scenes, 8-15s each, compressed at 16x speed.
import { Camera } from './camera';
import { FACTION_HEX } from './palette';
import { fnv1a } from '../sim/rng/rng';
import { TICKS_PER_YEAR, EventType } from '../shared/types';

export interface SpectacleEventIn {
  id: number; tick: number; type: number; severity: number;
  x: number; y: number; text: string; factions?: number[];
}

interface Scene {
  ev: SpectacleEventIn;
  kind: 'battle' | 'rout' | 'siege' | 'dragon' | 'razing' | 'coronation';
  bornAt: number;
  durMs: number;
  fA: number; fB: number;             // faction colors involved
}

const WINDOW_TICKS = TICKS_PER_YEAR / 4;

/** seeded 0..1 from (event id, salt): deterministic scene variation */
function sr(id: number, k: number): number {
  return (fnv1a(`sp:${id}:${k}`) % 1000) / 1000;
}

export class Spectacle {
  private scenes: Scene[] = [];
  private seen = new Map<number, number>();   // ev.id -> bornAt
  /** outputs main.ts applies each frame */
  shake = 0;
  flash = 0;

  private classify(ev: SpectacleEventIn): Scene['kind'] | null {
    switch (ev.type) {
      case EventType.BattleFought:
        if (ev.text.includes('breaks and runs')) return 'rout';
        if (ev.text.includes('lays siege')) return 'siege';
        return 'battle';
      case EventType.DragonRaid: return 'dragon';
      case EventType.SettlementRazed: return 'razing';
      case EventType.Coronation: return 'coronation';
      default: return null;
    }
  }

  update(majors: SpectacleEventIn[], simTick: number, now: number, speed: number): void {
    // expire finished scenes; prune the seen map with the sim window
    this.scenes = this.scenes.filter(sc => now - sc.bornAt < sc.durMs);
    for (const [id, ] of this.seen) {
      const ev = majors.find(e => e.id === id);
      if (!ev || simTick - ev.tick > WINDOW_TICKS || simTick < ev.tick) this.seen.delete(id);
    }
    for (const ev of majors) {
      const age = simTick - ev.tick;
      if (age < 0 || age > WINDOW_TICKS || this.seen.has(ev.id)) continue;
      const kind = this.classify(ev);
      if (!kind) continue;
      this.seen.set(ev.id, now);
      if (this.scenes.length >= 3) {
        // severity wins the stage
        const weakest = this.scenes.reduce((a, b) => (a.ev.severity <= b.ev.severity ? a : b));
        if (weakest.ev.severity >= ev.severity) continue;
        this.scenes = this.scenes.filter(s => s !== weakest);
      }
      const base = kind === 'dragon' ? 15000 : kind === 'razing' ? 10000 : kind === 'battle' ? 8000 : 6000;
      this.scenes.push({
        ev, kind,
        bornAt: now,
        durMs: speed >= 16 ? base / 4 : base,
        fA: ev.factions?.[0] ?? 0,
        fB: ev.factions?.[1] ?? 3,
      });
    }
    // decay outputs
    this.shake *= 0.85;
    this.flash *= 0.9;
    if (this.shake < 0.05) this.shake = 0;
    if (this.flash < 0.02) this.flash = 0;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, now: number): void {
    // scenes scale with zoom so a battle fills the eye at Local zoom
    const z = Math.min(3.2, Math.max(0.8, cam.pxPerTile / 9));
    for (const sc of this.scenes) {
      const [sx, sy] = cam.worldToScreen(sc.ev.x + 0.5, sc.ev.y + 0.5);
      if (sx < -160 * z || sy < -160 * z || sx > cam.viewW + 160 * z || sy > cam.viewH + 160 * z) continue;
      const t = Math.min(1, (now - sc.bornAt) / sc.durMs);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(z, z);
      switch (sc.kind) {
        case 'battle': this.battle(ctx, sc, 0, 0, t, now); break;
        case 'rout': this.rout(ctx, sc, 0, 0, t, now); break;
        case 'siege': this.siege(ctx, sc, 0, 0, t, now); break;
        case 'dragon': this.dragon(ctx, sc, 0, 0, t, now); break;
        case 'razing': this.razing(ctx, sc, 0, 0, t, now); break;
        case 'coronation': this.coronation(ctx, sc, 0, 0, t, now); break;
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** post-pass: flash vignette (main calls after everything else) */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (this.flash > 0.02) {
      ctx.globalAlpha = this.flash * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
      ctx.globalAlpha = 1;
    }
  }

  hover(sx: number, sy: number, cam: Camera): string | null {
    for (const sc of this.scenes) {
      const [x, y] = cam.worldToScreen(sc.ev.x + 0.5, sc.ev.y + 0.5);
      if ((sx - x) * (sx - x) + (sy - y) * (sy - y) < 40 * 40) {
        return sc.ev.text.replace(/^Y\d+: /, '');
      }
    }
    return null;
  }

  // ---- scenes -------------------------------------------------------------

  /** two lines CHARGE, sparks at the meeting line, arrows, casualty pips */
  private battle(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    const cA = FACTION_HEX[sc.fA] ?? '#cbdbfc', cB = FACTION_HEX[sc.fB] ?? '#d95763';
    const gap = 46 * (1 - Math.min(1, t / 0.3));           // charge closes the gap
    for (let i = 0; i < 6; i++) {
      const oy = (i - 2.5) * 7 + (sr(sc.ev.id, i) - 0.5) * 4;
      const lag = sr(sc.ev.id, i + 10) * 6;
      ctx.fillStyle = cA;
      ctx.fillRect(Math.round(sx - gap - 8 - lag), Math.round(sy + oy), 3, 4);
      ctx.fillStyle = cB;
      ctx.fillRect(Math.round(sx + gap + 5 + lag), Math.round(sy + oy), 3, 4);
    }
    if (t >= 0.28 && t < 0.34) { this.shake = 2.5; this.flash = Math.max(this.flash, 0.5); }
    if (t >= 0.3) {
      // weapon sparks along the contact line (seeded flicker)
      for (let i = 0; i < 5; i++) {
        const ph = ((now / 90) + sr(sc.ev.id, i + 20) * 7) | 0;
        if (ph % 3 !== i % 3) continue;
        const oy = (sr(sc.ev.id, i + 30) - 0.5) * 34;
        ctx.fillStyle = ph % 2 ? '#ffffff' : '#fbf236';
        ctx.fillRect(Math.round(sx + (sr(sc.ev.id, i + ph) - 0.5) * 10), Math.round(sy + oy), 2, 2);
      }
      // dust
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(now / 200);
      ctx.fillStyle = '#847e87';
      ctx.beginPath(); ctx.arc(sx, sy, 16 + t * 14, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      // arrows arc overhead
      for (let a = 0; a < 4; a++) {
        const at = ((now / 900) + sr(sc.ev.id, a + 40)) % 1;
        const dir = a % 2 ? 1 : -1;
        const ax = sx + dir * (40 - at * 80);
        const ay = sy - 18 - Math.sin(at * Math.PI) * 22;
        ctx.fillStyle = '#eec39a';
        ctx.fillRect(Math.round(ax), Math.round(ay), 3, 1);
      }
      // red x casualty pips floating up
      for (let p = 0; p < 3; p++) {
        const pt = ((now / 1400) + sr(sc.ev.id, p + 50)) % 1;
        ctx.globalAlpha = 1 - pt;
        ctx.fillStyle = '#d95763';
        const px2 = sx + (sr(sc.ev.id, p + 60) - 0.5) * 30;
        const py = sy - 4 - pt * 24;
        ctx.fillRect(px2 - 2, py - 2, 2, 2); ctx.fillRect(px2, py, 2, 2);
        ctx.fillRect(px2 - 2, py, 2, 2); ctx.fillRect(px2, py - 2, 2, 2);
        ctx.fillRect(px2 - 1, py - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
      // dueling morale bars
      const mA = Math.max(0.15, 1 - t * (0.5 + sr(sc.ev.id, 70) * 0.5));
      const mB = Math.max(0.15, 1 - t * (0.5 + sr(sc.ev.id, 71) * 0.5));
      ctx.fillStyle = '#14141fc0';
      ctx.fillRect(sx - 26, sy - 34, 52, 6);
      ctx.fillStyle = cA; ctx.fillRect(sx - 25, sy - 33, Math.round(24 * mA), 4);
      ctx.fillStyle = cB; ctx.fillRect(sx + 25 - Math.round(24 * mB), sy - 33, Math.round(24 * mB), 4);
    }
  }

  /** the line breaks: banner topples, streaks flee, crows settle */
  private rout(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    const cL = FACTION_HEX[sc.fA] ?? '#d95763';
    // banner topple: pole rotates to the mud over first third
    const ang = Math.min(1, t / 0.35) * Math.PI / 2;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, -16, 2, 16);
    ctx.fillStyle = cL;
    ctx.fillRect(2, -16, 9, 6);
    ctx.restore();
    // fleeing streaks
    const dir = sr(sc.ev.id, 1) > 0.5 ? 1 : -1;
    for (let i = 0; i < 5; i++) {
      const ft = Math.min(1, t * 1.6 + sr(sc.ev.id, i) * 0.2);
      const fx = sx + dir * (10 + ft * 60 + i * 6);
      const fy = sy + (sr(sc.ev.id, i + 5) - 0.5) * 18;
      ctx.globalAlpha = 1 - ft;
      ctx.fillStyle = cL;
      ctx.fillRect(Math.round(fx), Math.round(fy), 3, 3);
      ctx.fillStyle = '#84808766';
      ctx.fillRect(Math.round(fx - dir * 6), Math.round(fy + 1), 6, 1);
      ctx.globalAlpha = 1;
    }
    // crows settle late
    if (t > 0.6) {
      for (let c = 0; c < 4; c++) {
        const ct = (now / 700 + sr(sc.ev.id, c + 9)) % 1;
        ctx.fillStyle = '#222034';
        ctx.fillRect(
          Math.round(sx + (sr(sc.ev.id, c + 13) - 0.5) * 40 + Math.sin(ct * 6.3) * 3),
          Math.round(sy - 10 + ct * 12), 2, 1);
      }
    }
  }

  /** stones lob at the walls; cracks widen; fire arrows late */
  private siege(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    const cAtt = FACTION_HEX[sc.fA] ?? '#d95763';
    const dir = sr(sc.ev.id, 2) > 0.5 ? 1 : -1;
    // catapult stone: one lob per 2s
    const st2 = (now % 2000) / 2000;
    const ox = dir * (56 - st2 * 56);
    ctx.fillStyle = '#847e87';
    ctx.beginPath();
    ctx.arc(sx + ox, sy - 6 - Math.sin(st2 * Math.PI) * 30, 2.5, 0, 7);
    ctx.fill();
    if (st2 > 0.95) { this.shake = Math.max(this.shake, 1.5); }
    // impact puff at the wall
    if (st2 < 0.2) {
      ctx.globalAlpha = 0.5 - st2 * 2;
      ctx.fillStyle = '#9badb7';
      ctx.beginPath(); ctx.arc(sx, sy - 4, 5 + st2 * 20, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // widening cracks
    ctx.strokeStyle = '#222034';
    ctx.lineWidth = 1;
    const nCracks = 1 + Math.floor(t * 4);
    for (let c = 0; c < nCracks; c++) {
      const a0 = sr(sc.ev.id, c + 20) * 6.28;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a0) * 6, sy + Math.sin(a0) * 6);
      ctx.lineTo(sx + Math.cos(a0 + 0.4) * (10 + t * 8), sy + Math.sin(a0 + 0.4) * (10 + t * 8));
      ctx.stroke();
    }
    // fire arrows in the last half
    if (t > 0.5) {
      for (let a = 0; a < 3; a++) {
        const at = ((now / 700) + sr(sc.ev.id, a + 30)) % 1;
        const ax = sx + dir * (40 - at * 40);
        const ay = sy - 10 - Math.sin(at * Math.PI) * 18;
        ctx.fillStyle = at > 0.8 ? '#d95763' : '#df7126';
        ctx.fillRect(Math.round(ax), Math.round(ay), 3, 1);
      }
    }
    // attacker banner steady at the siege line
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(Math.round(sx + dir * 40), Math.round(sy - 14), 2, 14);
    ctx.fillStyle = cAtt;
    ctx.fillRect(Math.round(sx + dir * 40 + 2), Math.round(sy - 14), 8, 5);
  }

  /** shadow circles, dives, fire cone, embers, departs */
  private dragon(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    if (t < 0.35) {
      // FORESHADOW: circling shadow
      const a = t * 18 + sr(sc.ev.id, 1) * 6.28;
      const r = 70 - t * 120;
      const shx = sx + Math.cos(a) * Math.max(12, r);
      const shy = sy + Math.sin(a) * Math.max(8, r * 0.6);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#14141f';
      ctx.beginPath(); ctx.ellipse(shx, shy, 14, 6, a, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (t < 0.42) {
      if (this.flash < 0.3) { this.flash = 0.6; this.shake = 3; }
    } else if (t < 0.8) {
      // FIRE. A breath cone sweeping the town, scorch accumulating beneath
      const ft = (t - 0.42) / 0.38;
      const ang = sr(sc.ev.id, 3) * 6.28 + Math.sin(now / 800) * 0.5;  // sweeping
      // ground scorch grows with the breath
      ctx.globalAlpha = 0.35 * ft;
      ctx.fillStyle = '#222034';
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 20 + ft * 14, 10 + ft * 6, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      // the cone itself: dense layered flame from the dragon's maw to ground
      const mawX = sx, mawY = sy - 34;
      for (let i = 0; i < 26; i++) {
        const fr = sr(sc.ev.id, i + (((now / 90) | 0) % 5) * 31);
        const reach = fr * (0.35 + ft * 0.65);
        const fx = mawX + Math.cos(ang) * 6 + (Math.cos(ang + 1.57) * (fr - 0.5) * 18 * reach);
        const fy = mawY + (sy + 6 - mawY) * reach;
        const size = 2 + reach * 5;
        ctx.fillStyle = reach < 0.3 ? '#ffffff' : reach < 0.55 ? '#fbf236' : reach < 0.8 ? '#df7126' : '#d95763';
        ctx.fillRect(Math.round(fx - size / 2), Math.round(fy - size / 2), Math.round(size), Math.round(size));
      }
      // embers spiraling up off the burn
      for (let e = 0; e < 10; e++) {
        const et = ((now / 1100) + sr(sc.ev.id, e + 60)) % 1;
        ctx.globalAlpha = 1 - et;
        ctx.fillStyle = e % 2 ? '#df7126' : '#fbf236';
        ctx.fillRect(
          Math.round(sx + (sr(sc.ev.id, e + 70) - 0.5) * 40 + Math.sin(et * 9 + e) * 4),
          Math.round(sy - et * 44), 2, 2);
        ctx.globalAlpha = 1;
      }
      // the dragon itself: body, beating wings, whipping tail
      const wing = Math.sin(now / 130) * 10;
      const bob = Math.sin(now / 400) * 3;
      const dy2 = sy - 40 + bob;
      ctx.fillStyle = '#45283c';
      ctx.fillRect(Math.round(sx - 7), Math.round(dy2), 14, 5);          // body
      ctx.fillRect(Math.round(sx + 7), Math.round(dy2 + 1), 5, 3);       // head
      ctx.fillRect(Math.round(sx - 13), Math.round(dy2 + 2 + Math.sin(now / 220) * 2), 6, 2); // tail
      ctx.fillStyle = '#663931';
      ctx.fillRect(Math.round(sx - 16), Math.round(dy2 - 2 + wing / 2), 10, 3);  // wings
      ctx.fillRect(Math.round(sx + 6), Math.round(dy2 - 2 - wing / 2), 10, 3);
      // maw glow while breathing
      ctx.fillStyle = '#fbf236';
      ctx.fillRect(Math.round(sx + 10), Math.round(dy2 + 3), 2, 2);
      // wing shadow on the ground
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#14141f';
      ctx.beginPath(); ctx.ellipse(sx, sy + 4, 16, 6, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // departs: shadow shrinks toward the horizon
      const dt2 = (t - 0.8) / 0.2;
      ctx.globalAlpha = 0.3 * (1 - dt2);
      ctx.fillStyle = '#14141f';
      ctx.beginPath();
      ctx.ellipse(sx + dt2 * 90, sy - dt2 * 50, 12 * (1 - dt2) + 2, 5, 0.4, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** staggered building fires, a tall smoke column, refugees streaming out */
  private razing(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    // staggered ignition ring
    for (let b = 0; b < 8; b++) {
      const ignite = sr(sc.ev.id, b) * 0.5;
      if (t < ignite) continue;
      const bx = sx + Math.cos(b / 8 * 6.28) * (8 + sr(sc.ev.id, b + 8) * 14);
      const by = sy + Math.sin(b / 8 * 6.28) * (6 + sr(sc.ev.id, b + 16) * 10);
      const fl = ((now / 110) | 0) + b;
      ctx.fillStyle = fl % 3 === 0 ? '#fbf236' : fl % 3 === 1 ? '#df7126' : '#d95763';
      ctx.fillRect(Math.round(bx - 1), Math.round(by - 4), 3, 4);
      ctx.fillStyle = '#df7126';
      ctx.fillRect(Math.round(bx), Math.round(by - 6), 1, 2);
    }
    // smoke column, visible from afar
    for (let s2 = 0; s2 < 6; s2++) {
      const st2 = ((now / 1600) + s2 / 6) % 1;
      ctx.globalAlpha = 0.5 * (1 - st2);
      ctx.fillStyle = '#222034';
      ctx.beginPath();
      ctx.arc(sx + Math.sin(st2 * 5 + s2) * 5, sy - 8 - st2 * 60, 4 + st2 * 10, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // refugee line walks away with bundles
    const dir = sr(sc.ev.id, 99) > 0.5 ? 1 : -1;
    for (let r = 0; r < 6; r++) {
      const rt = Math.min(1, Math.max(0, t * 1.4 - r * 0.08));
      if (rt <= 0) continue;
      const rx = sx + dir * (12 + rt * 70) + r * 5 * dir;
      const ry = sy + 12 + (sr(sc.ev.id, r + 30) - 0.5) * 6;
      ctx.globalAlpha = 1 - rt * 0.6;
      ctx.fillStyle = '#9badb7';
      ctx.fillRect(Math.round(rx), Math.round(ry), 2, 3);
      ctx.fillStyle = '#8a6f30';
      ctx.fillRect(Math.round(rx + dir), Math.round(ry - 2), 2, 2);
      ctx.globalAlpha = 1;
    }
    if (t < 0.05) { this.shake = Math.max(this.shake, 2); this.flash = Math.max(this.flash, 0.4); }
  }

  /** golden rays, a crown descends, subjects ring the keep */
  private coronation(ctx: CanvasRenderingContext2D, sc: Scene, sx: number, sy: number, t: number, now: number): void {
    // rotating golden rays
    ctx.globalAlpha = Math.min(0.5, t * 2) * (1 - t * 0.6);
    ctx.strokeStyle = '#fbf236';
    ctx.lineWidth = 1;
    for (let r = 0; r < 12; r++) {
      const a = r / 12 * 6.28 + now / 2400;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10);
      ctx.lineTo(sx + Math.cos(a) * (26 + Math.sin(now / 300 + r) * 4), sy + Math.sin(a) * (26 + Math.sin(now / 300 + r) * 4));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // crown descends
    const cy = sy - 36 + Math.min(1, t / 0.4) * 24;
    ctx.fillStyle = '#fbf236';
    ctx.fillRect(Math.round(sx - 5), Math.round(cy), 10, 3);
    ctx.fillRect(Math.round(sx - 5), Math.round(cy - 3), 2, 3);
    ctx.fillRect(Math.round(sx - 1), Math.round(cy - 4), 2, 4);
    ctx.fillRect(Math.round(sx + 3), Math.round(cy - 3), 2, 3);
    // subjects converge into a cheering ring
    for (let p = 0; p < 8; p++) {
      const pa = p / 8 * 6.28 + sr(sc.ev.id, p) * 0.4;
      const pr = 40 - Math.min(1, t / 0.5) * 22;
      const hop = t > 0.5 ? Math.abs(Math.sin(now / 160 + p)) * 2 : 0;
      ctx.fillStyle = '#cbdbfc';
      ctx.fillRect(
        Math.round(sx + Math.cos(pa) * pr),
        Math.round(sy + Math.sin(pa) * pr * 0.6 - hop), 2, 3);
    }
  }
}
