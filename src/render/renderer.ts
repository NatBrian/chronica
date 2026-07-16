// Canvas2D renderer: layers: terrain → water → buildings → pawns → effects
// → overlays → markers (06). M0: terrain + camera. Later layers slot in.
import { Camera } from './camera';
import { TerrainCache, RenderMapData, CHUNK_TILES } from './terrain';

export { CHUNK_TILES };

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terrain: TerrainCache | null = null;
  camera: Camera;
  private lastPx = 0;

  constructor(public canvas: HTMLCanvasElement, mapSize: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.camera = new Camera(mapSize);
    this.resize();
  }

  setMap(map: RenderMapData): void {
    this.terrain = new TerrainCache(map);
    this.camera = new Camera(map.size);
    this.camera.viewW = this.canvas.width;
    this.camera.viewH = this.canvas.height;
  }

  resize(): void {
    const dpr = 1; // crisp pixel art: logical pixels
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    if (w && h) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.camera.viewW = this.canvas.width;
      this.camera.viewH = this.canvas.height;
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  drawTerrain(): void {
    const t = this.terrain;
    if (!t) return;
    const cam = this.camera;
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    // bake at the ladder target px (integer), draw scaled if mid-transition
    const bakePx = cam.targetPx();
    if (bakePx !== this.lastPx) { t.trim(bakePx); this.lastPx = bakePx; }
    const scale = cam.pxPerTile / bakePx;
    const c0x = Math.floor(cam.cx - cam.viewW / 2 / cam.pxPerTile);
    const c0y = Math.floor(cam.cy - cam.viewH / 2 / cam.pxPerTile);
    const cx0 = Math.max(0, Math.floor(c0x / CHUNK_TILES));
    const cy0 = Math.max(0, Math.floor(c0y / CHUNK_TILES));
    const tilesW = cam.viewW / cam.pxPerTile, tilesH = cam.viewH / cam.pxPerTile;
    const cx1 = Math.min(Math.ceil(t.map.size / CHUNK_TILES) - 1, Math.floor((c0x + tilesW + CHUNK_TILES) / CHUNK_TILES));
    const cy1 = Math.min(Math.ceil(t.map.size / CHUNK_TILES) - 1, Math.floor((c0y + tilesH + CHUNK_TILES) / CHUNK_TILES));
    ctx.imageSmoothingEnabled = false;
    // water swell: two baked phases alternating on a slow clock (doc 14 T1.3)
    const frame = Math.floor(performance.now() / 700) % 2;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = t.chunk(bakePx, cx, cy, frame);
        if (!chunk) continue;
        const [sx, sy] = cam.worldToScreen(cx * CHUNK_TILES, cy * CHUNK_TILES);
        const sizePx = CHUNK_TILES * bakePx * scale;
        ctx.drawImage(chunk as CanvasImageSource, Math.round(sx), Math.round(sy), Math.ceil(sizePx), Math.ceil(sizePx));
      }
    }
  }
}
