// Dev tools (02 §Debug tooling): worldgen layer viewer + seed browser.
// Ship as dev-only pages; double as marketing screenshots.
import { generateWorld } from '../sim/world/worldgen';
import { defaultConfig } from '../shared/types';
import { tileColor, RenderMapData } from '../render/terrain';
import { WorldMap } from '../sim/world/map';
import { bakePawnAtlas, JOBS, SPRITE_W, SPRITE_H } from '../render/sprites';

function asRenderMap(m: WorldMap): RenderMapData {
  return m as unknown as RenderMapData;
}

function drawMapToCanvas(map: WorldMap, canvas: HTMLCanvasElement): void {
  const N = map.size;
  canvas.width = N; canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const rm = asRenderMap(map);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const [r, g, b] = tileColor(rm, i, x, y);
      const o = i * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function heatmap(plane: ArrayLike<number>, N: number, canvas: HTMLCanvasElement, max: number): void {
  canvas.width = N; canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = Math.min(1, plane[i] / max);
    const o = i * 4;
    img.data[o] = v * 255; img.data[o + 1] = v * 140; img.data[o + 2] = (1 - v) * 200; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function shell(title: string): HTMLElement {
  document.body.innerHTML = '';
  document.body.style.cssText = 'overflow:auto;background:#14141f;color:#cbdbfc;font-family:system-ui;padding:20px';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin-bottom:14px;font-weight:400;letter-spacing:2px';
  document.body.appendChild(h);
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

export function mountSeedBrowser(): void {
  const root = shell('Chronica — Seed Browser (0–99)');
  const info = document.createElement('div');
  info.style.cssText = 'color:#9badb7;margin-bottom:12px';
  root.appendChild(info);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,132px);gap:8px';
  root.appendChild(grid);
  const cfg = { ...defaultConfig(), mapSize: 128 };
  let rejectedAttempts = 0, total = 0;
  let seed = 0;
  function next(): void {
    if (seed >= 100) {
      info.textContent = `rejection rate: ${(100 * rejectedAttempts / total).toFixed(1)}% (${rejectedAttempts}/${total} attempts)`;
      return;
    }
    const r = generateWorld(seed, cfg);
    rejectedAttempts += r.rejections; total += r.rejections + 1;
    const cell = document.createElement('div');
    cell.style.cssText = 'text-align:center;font-size:11px;color:#9badb7;cursor:pointer';
    const c = document.createElement('canvas');
    c.style.cssText = 'width:128px;height:128px;image-rendering:pixelated;border:1px solid #34345230';
    drawMapToCanvas(r.map, c);
    const s = seed;
    cell.addEventListener('click', () => { location.search = `?dev=layers&seed=${s}`; });
    cell.appendChild(c);
    cell.appendChild(document.createTextNode(`${seed} · ${r.islandName}${r.rejections ? ` (${r.rejections}✗)` : ''}`));
    grid.appendChild(cell);
    seed++;
    info.textContent = `generating seed ${seed}/100...`;
    setTimeout(next, 0);
  }
  next();
}

/** Sprite preview (06 §Closed visual loop): all templates at 1×/2×/4× on
 * terrain, plus blacked-out silhouette row for the race-silhouette gate. */
export function mountSpritePreview(): void {
  const root = shell('Chronica — Sprite Preview & Quality Gates');
  const atlas = bakePawnAtlas();
  const scales = [1, 2, 4, 8];
  const raceNames = ['human', 'elf', 'dwarf', 'orc'];

  // terrain backdrop strip from a real seed
  const world = generateWorld(42, { ...defaultConfig(), mapSize: 128 });

  for (let race = 0; race < 4; race++) {
    const h = document.createElement('h3');
    h.textContent = raceNames[race];
    h.style.cssText = 'margin:14px 0 6px;color:#9badb7;font-weight:400';
    root.appendChild(h);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap';
    root.appendChild(row);
    for (const scale of scales) {
      const c = document.createElement('canvas');
      const cols = 4 * JOBS.length * 3;
      c.width = cols * (SPRITE_W + 2) * scale;
      c.height = (SPRITE_H + 8) * scale;
      c.style.cssText = 'image-rendering:pixelated;border:1px solid #34345230';
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      // terrain backdrop
      const rm = world.map as unknown as RenderMapData;
      for (let tx = 0; tx * 16 < c.width; tx++) {
        const ti = (64 + (tx % 8)) * 128 + 40 + (tx % 12);
        const [r, g, b] = tileColor(rm, ti, tx, 0);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(tx * 16, 0, 16, c.height);
      }
      let col = 0;
      for (let faction = 0; faction < 4; faction++) {
        for (const job of JOBS) {
          for (let v = 0; v < 3; v++) {
            const { x, y } = atlas.index[`${race}:${faction}:${job}:${v}`];
            ctx.drawImage(atlas.canvas as CanvasImageSource, x, y, SPRITE_W, SPRITE_H,
              col * (SPRITE_W + 2) * scale, 4 * scale, SPRITE_W * scale, SPRITE_H * scale);
            col++;
          }
        }
      }
      row.appendChild(c);
    }
  }

  // silhouette gate: blacked shapes side by side
  const h = document.createElement('h3');
  h.textContent = 'silhouette gate (races must be distinguishable as solid shapes)';
  h.style.cssText = 'margin:18px 0 6px;color:#9badb7;font-weight:400';
  root.appendChild(h);
  const c = document.createElement('canvas');
  c.width = 4 * (SPRITE_W + 4) * 8; c.height = SPRITE_H * 8;
  c.style.cssText = 'image-rendering:pixelated;background:#cbdbfc';
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let race = 0; race < 4; race++) {
    const { x, y } = atlas.index[`${race}:0:none:0`];
    ctx.drawImage(atlas.canvas as CanvasImageSource, x, y, SPRITE_W, SPRITE_H,
      race * (SPRITE_W + 4) * 8, 0, SPRITE_W * 8, SPRITE_H * 8);
  }
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  root.appendChild(c);
}

export function mountLayerViewer(seed: number, size: number): void {
  const root = shell(`Chronica — Layer Viewer (seed ${seed})`);
  const r = generateWorld(seed, { ...defaultConfig(), mapSize: size });
  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap';
  root.appendChild(bar);
  const meta = document.createElement('div');
  meta.style.cssText = 'color:#9badb7;margin-bottom:10px;font-size:13px';
  meta.textContent = `${r.islandName} · rejections ${r.rejections} · spawns: ${r.spawns.map(s => `race${s.race}@(${s.x},${s.y}) rel${s.relScore}%`).join('  ')}`;
  root.appendChild(meta);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:768px;height:768px;image-rendering:pixelated;border:1px solid #34345230';
  root.appendChild(canvas);

  const layers: Record<string, () => void> = {
    terrain: () => drawMapToCanvas(r.map, canvas),
    elevation: () => heatmap(r.map.elevation, size, canvas, 255),
    moisture: () => heatmap(r.map.moisture, size, canvas, 255),
    temperature: () => heatmap(r.map.temperature, size, canvas, 255),
    flux: () => heatmap(r.map.waterFlux, size, canvas, 400),
    fertility: () => heatmap(r.map.fertility, size, canvas, 255),
    forest: () => heatmap(r.map.forest, size, canvas, 255),
    ore: () => heatmap(r.map.ore, size, canvas, 3000),
    fish: () => heatmap(r.map.fish, size, canvas, 255),
    game: () => heatmap(r.map.game, size, canvas, 255),
  };
  for (const name of Object.keys(layers)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText = 'background:#1c1c2b;color:#cbdbfc;border:1px solid #34345260;border-radius:4px;padding:4px 10px;cursor:pointer';
    b.addEventListener('click', () => { layers[name](); drawSpawns(); });
    bar.appendChild(b);
  }
  function drawSpawns(): void {
    const ctx = canvas.getContext('2d')!;
    for (const sp of r.spawns) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sp.x - 2, sp.y - 2, 5, 5);
      ctx.fillStyle = ['#639bff', '#6abe30', '#8a6f30', '#ac3232'][sp.race];
      ctx.fillRect(sp.x - 1, sp.y - 1, 3, 3);
    }
  }
  layers.terrain();
  drawSpawns();
}
