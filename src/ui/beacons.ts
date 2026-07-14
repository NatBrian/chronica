// Event spotlight (11 §H): tier-1 events fire an expanding ring beacon at
// their map location, decay to a clickable pin for ~a season of sim time,
// and echo as edge arrows when off-viewport plus minimap pings. Pins are a
// pure function of (event log, sim tick): time-machine scrubbing replays the
// same beacons at the same years. Render-layer only.
import { Camera } from '../render/camera';
import { eventMeta } from './eventMeta';
import { MapIconAtlas, ICON_W, ICON_H } from '../render/mapIcons';
import { TICKS_PER_YEAR, EventType } from '../shared/types';

export interface BeaconEvent {
  id: number; tick: number; type: number; severity: number;
  x: number; y: number; text: string;
}
interface LiveBeacon { ev: BeaconEvent; bornAt: number; live: boolean }
interface ArrowHit { x: number; y: number; w: number; h: number; ev: BeaconEvent | null }

const RING_MS = 1600;
const ARROW_MS = 4200;
const PIN_TICKS = TICKS_PER_YEAR / 4;      // pin lives ~one season

export class Beacons {
  private inWindow = new Map<number, LiveBeacon>();
  private arrowHits: ArrowHit[] = [];
  private lastBattleToastAt = 0;
  /** fired once per live tier-1 event (G3 toasts); not during replay */
  onTier1Live: ((ev: BeaconEvent) => void) | null = null;

  update(majors: BeaconEvent[], simTick: number, now: number, inPast: boolean): void {
    for (const [id, b] of this.inWindow) {
      const age = simTick - b.ev.tick;
      // sim-season window, with a real-time floor so pins stay catchable at 16x
      if (age < 0 || (age > PIN_TICKS && now - b.bornAt > 6000)) this.inWindow.delete(id);
    }
    for (const ev of majors) {
      const age = simTick - ev.tick;
      if (age < 0 || age > PIN_TICKS || this.inWindow.has(ev.id)) continue;
      if (eventMeta(ev.type).tier !== 1) continue;
      const live = !inPast && age < TICKS_PER_YEAR;
      this.inWindow.set(ev.id, { ev, bornAt: now, live });
      if (live && this.onTier1Live) {
        if (ev.type === EventType.BattleFought) {
          // battles cluster; one toast per 10s is plenty (A4)
          if (now - this.lastBattleToastAt > 10000) {
            this.lastBattleToastAt = now;
            this.onTier1Live(ev);
          }
        } else if (ev.type !== EventType.WarDeclared) {
          // war declarations already toast through the council decision path
          this.onTier1Live(ev);
        }
      }
    }
  }

  /** starred-character moments are tier-1 regardless of type (M11, P3.1) */
  force(ev: BeaconEvent, now: number): void {
    if (this.inWindow.has(ev.id)) return;
    this.inWindow.set(ev.id, { ev, bornAt: now, live: true });
  }

  /** rings + pins, screen-space sized so a far war reads at World zoom (H1) */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, now: number, icons?: MapIconAtlas): void {
    for (const b of this.inWindow.values()) {
      const [sx, sy] = cam.worldToScreen(b.ev.x + 0.5, b.ev.y + 0.5);
      const onScreen = sx >= -30 && sy >= -30 && sx <= cam.viewW + 30 && sy <= cam.viewH + 30;
      if (!onScreen) continue;
      const meta = eventMeta(b.ev.type);
      const t = (now - b.bornAt) / RING_MS;
      if (t < 1) {
        for (let r = 0; r < 3; r++) {
          const rt = t * 1.4 - r * 0.2;
          if (rt < 0 || rt > 1) continue;
          ctx.globalAlpha = (1 - rt) * 0.9;
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 6 + rt * 44, 0, 7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#14141fd0';
      ctx.beginPath(); ctx.arc(sx, sy, 10, 0, 7); ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 10, 0, 7); ctx.stroke();
      const cell = icons?.index[`g:${meta.cat}`];
      if (cell && icons) {
        ctx.drawImage(icons.canvas as CanvasImageSource, cell.x, cell.y, ICON_W, ICON_H, sx - 11, sy - 9, 22, 18);
      } else {
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(meta.glyph, sx, sy + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
  }

  /** edge-of-screen arrow chips toward recent off-viewport beacons (H2) */
  drawArrows(ctx: CanvasRenderingContext2D, cam: Camera, now: number, icons?: MapIconAtlas): void {
    this.arrowHits = [];
    const pending: LiveBeacon[] = [];
    for (const b of this.inWindow.values()) {
      if (now - b.bornAt > ARROW_MS) continue;
      const [sx, sy] = cam.worldToScreen(b.ev.x + 0.5, b.ev.y + 0.5);
      if (sx >= 0 && sy >= 0 && sx <= cam.viewW && sy <= cam.viewH) continue;
      pending.push(b);
    }
    pending.sort((a, b) => b.ev.severity - a.ev.severity);
    const shown = pending.slice(0, 3);
    for (const b of shown) {
      const [wx, wy] = cam.worldToScreen(b.ev.x + 0.5, b.ev.y + 0.5);
      // bearing from screen center, clamped to viewport edge with margin
      const cx = cam.viewW / 2, cy = cam.viewH / 2;
      const dx = wx - cx, dy = wy - cy;
      const scale = 1 / Math.max(Math.abs(dx) / (cam.viewW / 2 - 30), Math.abs(dy) / (cam.viewH / 2 - 30));
      const ax = cx + dx * scale, ay = cy + dy * scale;
      const meta = eventMeta(b.ev.type);
      const ang = Math.atan2(dy, dx);
      ctx.fillStyle = '#14141fe0';
      ctx.beginPath(); ctx.arc(ax, ay, 13, 0, 7); ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax, ay, 13, 0, 7); ctx.stroke();
      const gcell = icons?.index[`g:${meta.cat}`];
      if (gcell && icons) {
        ctx.drawImage(icons.canvas as CanvasImageSource, gcell.x, gcell.y, ICON_W, ICON_H, ax - 11, ay - 9, 22, 18);
      } else {
        ctx.font = '13px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(meta.glyph, ax, ay + 1);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // direction tick just outside the chip
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(ang) * 19, ay + Math.sin(ang) * 19);
      ctx.lineTo(ax + Math.cos(ang + 2.5) * 12, ay + Math.sin(ang + 2.5) * 12);
      ctx.lineTo(ax + Math.cos(ang - 2.5) * 12, ay + Math.sin(ang - 2.5) * 12);
      ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      this.arrowHits.push({ x: ax - 15, y: ay - 15, w: 30, h: 30, ev: b.ev });
    }
    if (pending.length > 3) {
      // overflow chip: "+N" at the right edge opens the Events tab (H2)
      const ax = cam.viewW - 34, ay = cam.viewH / 2;
      ctx.fillStyle = '#14141fe0';
      ctx.beginPath(); ctx.arc(ax, ay, 13, 0, 7); ctx.fill();
      ctx.strokeStyle = '#9badb7';
      ctx.beginPath(); ctx.arc(ax, ay, 13, 0, 7); ctx.stroke();
      ctx.fillStyle = '#cbdbfc';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`+${pending.length - 3}`, ax, ay + 1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      this.arrowHits.push({ x: ax - 15, y: ay - 15, w: 30, h: 30, ev: null });
    }
  }

  /** click routing: arrow chip → its event; pin → its event; null = no hit.
   *  Returns {ev:null} for the overflow chip (open the Events tab). */
  hitTest(sx: number, sy: number, cam: Camera): { ev: BeaconEvent | null } | null {
    for (const a of this.arrowHits) {
      if (sx >= a.x && sx <= a.x + a.w && sy >= a.y && sy <= a.y + a.h) return { ev: a.ev };
    }
    for (const b of this.inWindow.values()) {
      const [bx, by] = cam.worldToScreen(b.ev.x + 0.5, b.ev.y + 0.5);
      if ((sx - bx) * (sx - bx) + (sy - by) * (sy - by) <= 144) return { ev: b.ev };
    }
    return null;
  }

  /** minimap echo (H3): same color, pulsing */
  pings(): { x: number; y: number; color: string }[] {
    const out: { x: number; y: number; color: string }[] = [];
    for (const b of this.inWindow.values()) {
      out.push({ x: b.ev.x, y: b.ev.y, color: eventMeta(b.ev.type).color });
    }
    return out;
  }
}
