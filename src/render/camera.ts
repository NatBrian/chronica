// Camera: pan / wheel zoom-to-cursor / px-per-tile zoom ladder (06/07, doc 14 D2).
export const ZOOM_LEVELS = [2, 4, 8, 16, 32, 48] as const; // island / region / area / local / close / portrait
export type ZoomLevel = 0 | 1 | 2 | 3 | 4 | 5;
/** ladder index of the 16px "local" step (several UI jumps land here) */
export const LEVEL_LOCAL = 3 as ZoomLevel;

export class Camera {
  /** world position (in tiles, float) at the center of the viewport */
  cx: number;
  cy: number;
  level: ZoomLevel = LEVEL_LOCAL;
  /** animated px-per-tile (eases toward ZOOM_LEVELS[level]) */
  pxPerTile: number = ZOOM_LEVELS[LEVEL_LOCAL];
  viewW = 800; viewH = 600;

  constructor(private mapSize: number) {
    this.cx = mapSize / 2;
    this.cy = mapSize / 2;
  }

  targetPx(): number { return ZOOM_LEVELS[this.level]; }

  /** Ease pxPerTile toward the ladder target; call per frame. dt ms. */
  update(dt: number): void {
    const t = this.targetPx();
    const k = 1 - Math.pow(0.0025, dt / 200); // ~200ms transition (07 polish)
    this.pxPerTile += (t - this.pxPerTile) * k;
    if (Math.abs(this.pxPerTile - t) < 0.01) this.pxPerTile = t;
    this.clamp();
  }

  clamp(): void {
    const half = this.mapSize * 0.02;
    this.cx = Math.min(this.mapSize - half, Math.max(half, this.cx));
    this.cy = Math.min(this.mapSize - half, Math.max(half, this.cy));
  }

  /** screen px → world tile */
  screenToWorld(sx: number, sy: number): [number, number] {
    return [
      this.cx + (sx - this.viewW / 2) / this.pxPerTile,
      this.cy + (sy - this.viewH / 2) / this.pxPerTile,
    ];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [
      this.viewW / 2 + (wx - this.cx) * this.pxPerTile,
      this.viewH / 2 + (wy - this.cy) * this.pxPerTile,
    ];
  }

  pan(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.pxPerTile;
    this.cy -= dyPx / this.pxPerTile;
    this.clamp();
  }

  /** Step ladder keeping the world point under the cursor fixed. dir ±1. */
  zoomStep(dir: 1 | -1, cursorX?: number, cursorY?: number): void {
    const nl = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, this.level + dir)) as ZoomLevel;
    if (nl === this.level) return;
    if (cursorX !== undefined && cursorY !== undefined) {
      const [wx, wy] = this.screenToWorld(cursorX, cursorY);
      const newPx = ZOOM_LEVELS[nl];
      // after zoom, keep (wx,wy) under (cursorX,cursorY):
      this.cx = wx - (cursorX - this.viewW / 2) / newPx;
      this.cy = wy - (cursorY - this.viewH / 2) / newPx;
    }
    this.level = nl;
    this.clamp();
  }

  /** Top-left world tile + snapped screen offset for pixel-crisp drawing. */
  viewRect(): { x0: number; y0: number; x1: number; y1: number; offX: number; offY: number; px: number } {
    const px = this.pxPerTile;
    const halfW = this.viewW / 2 / px, halfH = this.viewH / 2 / px;
    const x0f = this.cx - halfW, y0f = this.cy - halfH;
    // snap to integer device pixels (06; subpixel shimmer)
    const offX = Math.round(-x0f * px), offY = Math.round(-y0f * px);
    return {
      x0: Math.max(0, Math.floor(x0f)),
      y0: Math.max(0, Math.floor(y0f)),
      x1: Math.min(this.mapSize, Math.ceil(this.cx + halfW) + 1),
      y1: Math.min(this.mapSize, Math.ceil(this.cy + halfH) + 1),
      offX, offY, px,
    };
  }
}
