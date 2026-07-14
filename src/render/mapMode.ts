// Far-zoom map mode (11 §D): at World/Region zoom the island stops being
// shrunken pixels and becomes a *map*: faction territory tint + chunky
// borders, settlement icons with always-on labels, army banners, battle
// icons. Pure render layer: reads snapshots, never touches sim state.
import { Camera } from './camera';
import { FACTION_HEX } from './palette';
import { MapIconAtlas, ICON_W, ICON_H, popTier } from './mapIcons';

/** Blocks are 8×8 tiles: zone-quantized chunky borders (doc 12 §P5). */
export const BLOCK_TILES = 8;

export interface MapModeSettlement {
  id: number; x: number; y: number; name: string; factionId: number;
  razed: boolean; pop: number;
}
export interface MapModeSquad { x: number; y: number; factionId: number; state: string; n: number }
export interface MapModeFaction { id: number; race: number; name: string; extinct?: boolean; capital?: number }
export interface MapModeWar { attacker: number; defender: number }

const CLAIM_RADIUS = 60;          // tiles; matches the v1 territory overlay

export class MapMode {
  private grid: Int8Array;        // block → factionId, -1 unclaimed
  private gridW: number;
  private key = '';
  private tint: HTMLCanvasElement;
  private borders: { bx: number; by: number; dir: 0 | 1; a: number; b: number }[] = [];

  constructor(private mapSize: number, private biome: Uint8Array | number[]) {
    this.gridW = Math.ceil(mapSize / BLOCK_TILES);
    this.grid = new Int8Array(this.gridW * this.gridW).fill(-1);
    this.tint = document.createElement('canvas');
    this.tint.width = this.gridW; this.tint.height = this.gridW;
  }

  private isLand(tx: number, ty: number): boolean {
    const b = this.biome[ty * this.mapSize + tx];
    return b !== 0 && b !== 1 && b !== 2;
  }

  /** Recompute claims when settlements change (nearest living settlement). */
  private refresh(settlements: MapModeSettlement[]): void {
    const key = settlements.map(s => `${s.id}${s.factionId}${s.razed ? 'r' : ''}`).join(',');
    if (key === this.key) return;
    this.key = key;
    const W = this.gridW;
    const alive = settlements.filter(s => !s.razed);
    const R2 = CLAIM_RADIUS * CLAIM_RADIUS;
    for (let by = 0; by < W; by++) {
      for (let bx = 0; bx < W; bx++) {
        const cx = bx * BLOCK_TILES + BLOCK_TILES / 2;
        const cy = by * BLOCK_TILES + BLOCK_TILES / 2;
        let owner = -1;
        if (cx < this.mapSize && cy < this.mapSize && this.isLand(cx | 0, cy | 0)) {
          let bestD = R2;
          for (const s of alive) {
            const dx = s.x - cx, dy = s.y - cy;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; owner = s.factionId; }
          }
        }
        this.grid[by * W + bx] = owner;
      }
    }
    // tint canvas: one pixel per block, upscaled with smoothing off
    const tctx = this.tint.getContext('2d')!;
    const img = tctx.createImageData(W, W);
    for (let i = 0; i < W * W; i++) {
      const f = this.grid[i];
      if (f < 0) continue;
      const col = FACTION_HEX[f] ?? '#ffffff';
      const o = i * 4;
      img.data[o] = parseInt(col.slice(1, 3), 16);
      img.data[o + 1] = parseInt(col.slice(3, 5), 16);
      img.data[o + 2] = parseInt(col.slice(5, 7), 16);
      img.data[o + 3] = 34;                       // ~13% wash (11 §C1)
    }
    tctx.putImageData(img, 0, 0);
    // border segments: right (dir 0) and down (dir 1) neighbor mismatches
    this.borders = [];
    for (let by = 0; by < W; by++) {
      for (let bx = 0; bx < W; bx++) {
        const a = this.grid[by * W + bx];
        if (bx + 1 < W) {
          const b = this.grid[by * W + bx + 1];
          if (a !== b && (a >= 0 || b >= 0)) this.borders.push({ bx, by, dir: 0, a, b });
        }
        if (by + 1 < W) {
          const b = this.grid[(by + 1) * W + bx];
          if (a !== b && (a >= 0 || b >= 0)) this.borders.push({ bx, by, dir: 1, a, b });
        }
      }
    }
  }

  /** War overlay v2 (11 §C5): overlays show state, not just live actors.
   *  Territory context in dim faction strokes, at-war borders pulse red,
   *  banner-vs-banner chips at each front, scorch marks at recent battles. */
  drawWarOverlay(
    ctx: CanvasRenderingContext2D, cam: Camera,
    snap: {
      settlements: MapModeSettlement[]; factions: MapModeFaction[];
      wars: MapModeWar[]; battles: { x: number; y: number; age01: number }[];
    },
    now: number,
  ): void {
    this.refresh(snap.settlements);
    const [ox, oy] = cam.worldToScreen(0, 0);
    const B = BLOCK_TILES * cam.pxPerTile;
    const atWar = new Set<number>();
    for (const w of snap.wars) {
      atWar.add(Math.min(w.attacker, w.defender) * 16 + Math.max(w.attacker, w.defender));
    }
    const pulse = 0.55 + 0.45 * Math.sin(now / 260);
    // per-war-pair midpoint accumulator for banner-vs-banner chips
    const mids = new Map<number, { sx: number; sy: number; n: number; a: number; b: number }>();
    for (const seg of this.borders) {
      const sx = ox + seg.bx * B, sy = oy + seg.by * B;
      const ex = seg.dir === 0 ? sx + B : sx, ey = seg.dir === 0 ? sy : sy + B;
      const key = seg.a >= 0 && seg.b >= 0
        ? Math.min(seg.a, seg.b) * 16 + Math.max(seg.a, seg.b) : -1;
      if (key >= 0 && atWar.has(key)) {
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#d95763';
        if (seg.dir === 0) ctx.fillRect(Math.round(ex) - 2, Math.round(sy), 4, Math.ceil(B));
        else ctx.fillRect(Math.round(sx), Math.round(ey) - 2, Math.ceil(B), 4);
        ctx.globalAlpha = 1;
        const m = mids.get(key) ?? { sx: 0, sy: 0, n: 0, a: Math.min(seg.a, seg.b), b: Math.max(seg.a, seg.b) };
        m.sx += ex; m.sy += ey; m.n++;
        mids.set(key, m);
      } else {
        // peacetime borders stay visible but quiet: state, not noise
        ctx.globalAlpha = 0.35;
        if (seg.dir === 0) {
          if (seg.a >= 0) { ctx.fillStyle = FACTION_HEX[seg.a]; ctx.fillRect(Math.round(ex) - 1, Math.round(sy), 1, Math.ceil(B)); }
          if (seg.b >= 0) { ctx.fillStyle = FACTION_HEX[seg.b]; ctx.fillRect(Math.round(ex), Math.round(sy), 1, Math.ceil(B)); }
        } else {
          if (seg.a >= 0) { ctx.fillStyle = FACTION_HEX[seg.a]; ctx.fillRect(Math.round(sx), Math.round(ey) - 1, Math.ceil(B), 1); }
          if (seg.b >= 0) { ctx.fillStyle = FACTION_HEX[seg.b]; ctx.fillRect(Math.round(sx), Math.round(ey), Math.ceil(B), 1); }
        }
        ctx.globalAlpha = 1;
      }
    }
    // banner-vs-banner chip at each front's center of mass
    for (const m of mids.values()) {
      const cx = m.sx / m.n, cy = m.sy / m.n;
      ctx.fillStyle = '#14141fd8';
      ctx.fillRect(Math.round(cx) - 16, Math.round(cy) - 9, 32, 18);
      ctx.fillStyle = FACTION_HEX[m.a] ?? '#fff';
      ctx.fillRect(Math.round(cx) - 12, Math.round(cy) - 5, 9, 6);
      ctx.fillStyle = FACTION_HEX[m.b] ?? '#fff';
      ctx.fillRect(Math.round(cx) + 3, Math.round(cy) - 5, 9, 6);
      ctx.fillStyle = '#cbdbfc';
      ctx.font = '9px system-ui';
      ctx.fillText('⚔', Math.round(cx) - 3, Math.round(cy) + 3);
    }
    // scorch marks at recent battle sites, fading with age (C5 layer b)
    for (const bt of snap.battles) {
      const [sx, sy] = cam.worldToScreen(bt.x + 0.5, bt.y + 0.5);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      ctx.globalAlpha = (1 - bt.age01) * 0.8;
      ctx.strokeStyle = '#8f563b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
      ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Nearest territory border under the cursor, for grudge hover (C5). */
  borderAt(sx: number, sy: number, cam: Camera, rPx: number): { a: number; b: number } | null {
    const [ox, oy] = cam.worldToScreen(0, 0);
    const B = BLOCK_TILES * cam.pxPerTile;
    let best: { a: number; b: number } | null = null;
    let bestD = rPx * rPx;
    for (const seg of this.borders) {
      if (seg.a < 0 || seg.b < 0) continue;
      const ex = ox + (seg.dir === 0 ? (seg.bx + 1) * B : seg.bx * B + B / 2);
      const ey = oy + (seg.dir === 0 ? seg.by * B + B / 2 : (seg.by + 1) * B);
      const d = (sx - ex) * (sx - ex) + (sy - ey) * (sy - ey);
      if (d < bestD) { bestD = d; best = { a: seg.a, b: seg.b }; }
    }
    return best;
  }

  draw(
    ctx: CanvasRenderingContext2D, cam: Camera, icons: MapIconAtlas,
    snap: {
      settlements: MapModeSettlement[]; squads: MapModeSquad[];
      factions: MapModeFaction[]; wars: MapModeWar[];
      caravans: { x: number; y: number; factionId: number }[];
      monsters: { x: number; y: number; kind: string }[];
    },
    alpha: number, now: number,
  ): void {
    if (alpha <= 0.01) return;
    this.refresh(snap.settlements);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;

    // flatten terrain contrast so icons pop (11 §D1), then territory wash
    const [ox, oy] = cam.worldToScreen(0, 0);
    const mapPx = this.mapSize * cam.pxPerTile;
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(ox, oy, mapPx, mapPx);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tint, ox, oy, mapPx, mapPx);

    // chunky borders; at-war faction pairs pulse red (11 §D2)
    const atWar = new Set<number>();
    for (const w of snap.wars) {
      atWar.add(Math.min(w.attacker, w.defender) * 16 + Math.max(w.attacker, w.defender));
    }
    const B = BLOCK_TILES * cam.pxPerTile;
    const pulse = 0.55 + 0.45 * Math.sin(now / 260);
    for (const seg of this.borders) {
      const sx = ox + seg.bx * B, sy = oy + seg.by * B;
      const warring = seg.a >= 0 && seg.b >= 0 &&
        atWar.has(Math.min(seg.a, seg.b) * 16 + Math.max(seg.a, seg.b));
      if (warring) {
        ctx.globalAlpha = alpha * pulse;
        ctx.fillStyle = '#d95763';
        if (seg.dir === 0) ctx.fillRect(Math.round(sx + B) - 1, Math.round(sy), 3, Math.ceil(B));
        else ctx.fillRect(Math.round(sx), Math.round(sy + B) - 1, Math.ceil(B), 3);
        ctx.globalAlpha = alpha;
        continue;
      }
      // each owner strokes its own side of the fence
      if (seg.dir === 0) {
        if (seg.a >= 0) { ctx.fillStyle = FACTION_HEX[seg.a]; ctx.fillRect(Math.round(sx + B) - 1, Math.round(sy), 1, Math.ceil(B)); }
        if (seg.b >= 0) { ctx.fillStyle = FACTION_HEX[seg.b]; ctx.fillRect(Math.round(sx + B), Math.round(sy), 1, Math.ceil(B)); }
      } else {
        if (seg.a >= 0) { ctx.fillStyle = FACTION_HEX[seg.a]; ctx.fillRect(Math.round(sx), Math.round(sy + B) - 1, Math.ceil(B), 1); }
        if (seg.b >= 0) { ctx.fillStyle = FACTION_HEX[seg.b]; ctx.fillRect(Math.round(sx), Math.round(sy + B), Math.ceil(B), 1); }
      }
    }

    // caravans: cart pictogram on route (11 §D1); monsters: glyphs stay visible
    for (const c of snap.caravans) {
      const [sx, sy] = cam.worldToScreen(c.x, c.y);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      ctx.fillStyle = '#d9a066';
      ctx.fillRect(Math.round(sx) - 3, Math.round(sy) - 2, 7, 4);
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(Math.round(sx) - 2, Math.round(sy) + 2, 2, 2);
      ctx.fillRect(Math.round(sx) + 1, Math.round(sy) + 2, 2, 2);
      ctx.fillStyle = FACTION_HEX[c.factionId] ?? '#fff';
      ctx.fillRect(Math.round(sx) - 3, Math.round(sy) - 4, 3, 2);
    }
    for (const m of snap.monsters) {
      const [sx, sy] = cam.worldToScreen(m.x, m.y);
      if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 30) continue;
      const cell = icons.index[`m:${m.kind}`];
      if (cell) {
        const msc = m.kind === 'dragon' ? 2.4 : 1.8;
        ctx.drawImage(icons.canvas as CanvasImageSource, cell.x, cell.y, ICON_W, ICON_H,
          Math.round(sx - ICON_W * msc / 2), Math.round(sy - ICON_H * msc / 2), ICON_W * msc, ICON_H * msc);
      }
    }

    // settlement icons + labels (11 §D1; V1 declutter: priority + collision)
    const S = 2;                                  // icon pixel scale (screen-space)
    ctx.font = '600 11px system-ui';
    ctx.textBaseline = 'top';
    const placedLabels: { x: number; y: number; w: number; h: number }[] = [];
    const liveCount = snap.settlements.filter(s2 => !s2.razed).length;
    const sorted = [...snap.settlements].sort((a, b) => b.pop - a.pop);
    for (const st of sorted) {
      if (st.razed) continue;
      const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y + 0.5);
      if (sx < -80 || sy < -80 || sx > cam.viewW + 80 || sy > cam.viewH + 80) continue;
      const race = snap.factions[st.factionId]?.race ?? 0;
      const tier = popTier(st.pop);
      const cell = icons.index[`${race}:${tier}`];
      const iw = ICON_W * S, ih = ICON_H * S;
      const ix = Math.round(sx - iw / 2), iy = Math.round(sy - ih + 4);
      if (cell) {
        // dark halo so icons read against any biome
        ctx.fillStyle = '#14141f99';
        ctx.beginPath();
        ctx.ellipse(sx, iy + ih / 2 + 2, iw / 2 + 4, ih / 2 + 4, 0, 0, 7);
        ctx.fill();
        ctx.drawImage(icons.canvas as CanvasImageSource, cell.x, cell.y, ICON_W, ICON_H, ix, iy, iw, ih);
      }
      // faction pennant above the icon
      const fcol = FACTION_HEX[st.factionId] ?? '#fff';
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(Math.round(sx) - 1, iy - 10, 2, 12);
      ctx.fillStyle = fcol;
      ctx.fillRect(Math.round(sx) + 1, iy - 10, 8, 5);
      // capital crown pip (11 §D2)
      if (snap.factions[st.factionId]?.capital === st.id) {
        ctx.fillStyle = '#fbf236';
        ctx.fillRect(Math.round(sx) - 4, iy - 14, 2, 3);
        ctx.fillRect(Math.round(sx) - 1, iy - 15, 2, 4);
        ctx.fillRect(Math.round(sx) + 2, iy - 14, 2, 3);
      }
      // label priority (V1): capitals + big towns always; villages while the
      // screen stays quiet; hamlets never (icon + hover cover them)
      const isCapital = snap.factions[st.factionId]?.capital === st.id;
      if (!isCapital && st.pop < 90) continue;
      if (!isCapital && st.pop < 200 && liveCount > 12) continue;
      const label = `${st.name} · ${st.pop}`;
      ctx.font = '600 11px system-ui';
      const wLabel = ctx.measureText(label).width;
      const lx = Math.round(sx - wLabel / 2);
      let ly = iy + ih + 2;
      // collision nudge: try below, then two steps up; still colliding = skip
      const collides = (yy: number) => placedLabels.some(r =>
        lx - 4 < r.x + r.w && lx + wLabel + 4 > r.x && yy - 2 < r.y + r.h && yy + 13 > r.y);
      if (collides(ly)) ly = iy - 18;
      if (collides(ly)) ly = iy + ih + 18;
      if (collides(ly)) continue;
      placedLabels.push({ x: lx - 4, y: ly - 2, w: wLabel + 8, h: 15 });
      ctx.fillStyle = '#14141fc8';
      ctx.fillRect(lx - 4, ly - 2, wLabel + 8, 15);
      ctx.fillStyle = fcol;
      ctx.fillRect(lx - 4, ly - 2, 2, 15);
      ctx.fillStyle = '#cbdbfc';
      ctx.fillText(label, lx, ly);
    }

    // armies as banner icons + soldier count (11 §D1)
    for (const sq of snap.squads) {
      const [sx, sy] = cam.worldToScreen(sq.x, sq.y);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const fcol = FACTION_HEX[sq.factionId] ?? '#fff';
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(Math.round(sx), Math.round(sy) - 18, 2, 18);
      ctx.fillStyle = fcol;
      ctx.fillRect(Math.round(sx) + 2, Math.round(sy) - 18, 11, 7);
      ctx.fillStyle = '#14141fc8';
      const cnt = String(sq.n);
      const wc = ctx.measureText(cnt).width;
      ctx.fillRect(Math.round(sx) - 2, Math.round(sy) + 2, wc + 6, 13);
      ctx.fillStyle = '#cbdbfc';
      ctx.fillText(cnt, Math.round(sx) + 1, Math.round(sy) + 3);
      // battle: pulsing crossed swords over the tile (11 §D1)
      if (sq.state === 'fight') {
        const cell = icons.index['swords'];
        if (cell) {
          const bs = S * (1.6 + 0.5 * (0.5 + 0.5 * Math.sin(now / 200)));
          ctx.drawImage(icons.canvas as CanvasImageSource, cell.x, cell.y, ICON_W, ICON_H,
            Math.round(sx - ICON_W * bs / 2), Math.round(sy - 30 - ICON_H * bs / 2),
            ICON_W * bs, ICON_H * bs);
        }
      }
    }

    ctx.globalAlpha = prevAlpha;
  }
}
