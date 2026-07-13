// App entry — landing, worker boot, render loop, camera input.
// Dev tools: ?dev=seeds (seed browser) / ?dev=layers&seed=N (layer viewer).
import { Renderer } from './render/renderer';
import { RenderMapData } from './render/terrain';
import { mountSeedBrowser, mountLayerViewer, mountSpritePreview } from './ui/devtools';
import { bakePawnAtlas, actionToJob, SPRITE_W, SPRITE_H, PawnAtlas } from './render/sprites';
import { TICKS_PER_YEAR } from './shared/types';

const params = new URLSearchParams(location.search);
const dev = params.get('dev');
if (dev === 'seeds') {
  mountSeedBrowser();
} else if (dev === 'layers') {
  mountLayerViewer(Number(params.get('seed') ?? 42), Number(params.get('size') ?? 256));
} else if (dev === 'sprites') {
  mountSpritePreview();
} else {
  bootApp();
}

interface WorkerSnapshot {
  t: 'snapshot'; tick: number; year: number; alive: number;
  pawns: { x: Int16Array; y: Int16Array; factionId: Uint8Array; flags: Uint16Array; action: Uint8Array; count: number };
  settlements: { id: number; x: number; y: number; name: string; factionId: number; razed: boolean }[];
  factions?: { id: number; race: number; name: string }[];
  eventsTail: { text: string; severity: number }[];
}

const atlas: PawnAtlas = bakePawnAtlas();

function bootApp(): void {
  const landing = document.getElementById('landing')!;
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;
  const btnRandom = document.getElementById('btn-random')!;
  const btnBegin = document.getElementById('btn-begin')!;
  const llmStatus = document.getElementById('llm-status')!;

  // LLM presence probe (kings think vs instinct) — non-blocking
  fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    .then(r => r.json())
    .then(() => { llmStatus.textContent = '✓ Local LLM found — kings will think.'; })
    .catch(() => { llmStatus.textContent = 'No local LLM — kings will rule by instinct. (ollama + OLLAMA_ORIGINS=* enables thinking kings)'; });

  btnRandom.addEventListener('click', () => {
    seedInput.value = String((Math.random() * 2 ** 31) | 0);
  });

  btnBegin.addEventListener('click', () => {
    const seed = Number(seedInput.value) | 0;
    landing.style.display = 'none';
    startWorld(seed);
  });
}

function startWorld(seed: number): void {
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const renderer = new Renderer(canvas, 512);
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  const hudYear = document.getElementById('hud-year')!;
  const hudPop = document.getElementById('hud-pop')!;
  const hudIsland = document.getElementById('hud-island')!;
  const yearLabel = document.getElementById('year-label')!;
  let latest: WorkerSnapshot | null = null;
  let speed = 4;
  let paused = false;

  worker.postMessage({ t: 'init', seed });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.t === 'ready') {
      renderer.setMap(msg.map as RenderMapData);
      hudIsland.textContent = msg.islandName;
      document.title = `Chronica — ${msg.islandName}`;
      applySpeed();
    } else if (msg.t === 'snapshot') {
      latest = msg;
    } else if (msg.t === 'inspection') {
      showInspector(msg.pawn);
    }
  };

  const inspectorEl = document.getElementById('inspector')!;
  function showInspector(pawn: any): void {
    if (!pawn) { inspectorEl.style.display = 'none'; return; }
    const raceNames = ['human', 'elf', 'dwarf', 'orc'];
    const bar = (label: string, v: number, invert = false) => {
      const pct = Math.round((invert ? 255 - v : v) / 2.55);
      return `<div class="lbl"><span>${label}</span><span>${Math.round(v)}</span></div><div class="bar"><div style="width:${pct}%"></div></div>`;
    };
    inspectorEl.innerHTML = `
      <span class="close" id="insp-close">✕</span>
      <h4>${pawn.named ? pawn.named.name : `${raceNames[pawn.race]} ${pawn.female ? '♀' : '♂'}`}${pawn.child ? ' (child)' : ''}</h4>
      <div class="lbl"><span>${pawn.faction}</span><span>age ${pawn.ageYears}</span></div>
      ${pawn.named ? `<div class="lbl" style="margin:4px 0"><span>${pawn.named.role}</span></div>` : ''}
      <div style="margin:8px 0 4px;color:#9badb7;font-size:12px">doing: <b style="color:#cbdbfc">${pawn.action}</b></div>
      ${bar('hp', pawn.needs.hp * 2.55)}
      ${bar('hunger', pawn.needs.hunger)}
      ${bar('energy', pawn.needs.energy)}
      ${bar('mood', pawn.needs.mood)}
      <div style="margin-top:8px;color:#9badb7;font-size:12px">considering:</div>
      ${pawn.offers.map((o: any) => `<div class="offer"><span>${o.action}</span><span>${o.score}</span></div>`).join('')}
      ${pawn.named && pawn.named.memories.length ? `<div style="margin-top:8px;color:#9badb7;font-size:12px">remembers:</div>
        ${pawn.named.memories.slice(-4).map((m: string) => `<div style="font-size:12px;margin:3px 0">· ${m}</div>`).join('')}` : ''}
    `;
    inspectorEl.style.display = 'block';
    document.getElementById('insp-close')!.addEventListener('click', () => {
      inspectorEl.style.display = 'none';
    });
  }

  function ticksPerSec(): number {
    // speed 1× = 10 ticks/s wall clock; 4× = 40; 16× = 160 (01 §Tick loop)
    return paused ? 0 : speed * 10;
  }
  function applySpeed(): void {
    worker.postMessage({ t: 'speed', ticksPerSec: ticksPerSec() });
  }

  // controls
  const btnPause = document.getElementById('btn-pause')!;
  btnPause.addEventListener('click', () => { paused = !paused; btnPause.textContent = paused ? '▶' : '⏸'; applySpeed(); });
  document.querySelectorAll('button.speed').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('button.speed').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      speed = Number((b as HTMLElement).dataset.s);
      paused = false; btnPause.textContent = '⏸';
      applySpeed();
    });
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); btnPause.dispatchEvent(new Event('click')); }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const map: Record<string, number> = { '1': 1, '2': 4, '3': 16 };
      document.querySelectorAll<HTMLElement>('button.speed').forEach(b => {
        if (Number(b.dataset.s) === map[e.key]) b.dispatchEvent(new Event('click'));
      });
    }
    if (e.key === '+' || e.key === '=') renderer.camera.zoomStep(1);
    if (e.key === '-') renderer.camera.zoomStep(-1);
    const PAN = 40;
    if (e.key === 'w' || e.key === 'ArrowUp') renderer.camera.pan(0, PAN);
    if (e.key === 's' || e.key === 'ArrowDown') renderer.camera.pan(0, -PAN);
    if (e.key === 'a' || e.key === 'ArrowLeft') renderer.camera.pan(PAN, 0);
    if (e.key === 'd' || e.key === 'ArrowRight') renderer.camera.pan(-PAN, 0);
  });

  // mouse: drag pan + wheel zoom-to-cursor + click-to-inspect
  let dragging = false; let lastX = 0; let lastY = 0; let downX = 0; let downY = 0;
  canvas.addEventListener('mousedown', (e) => {
    dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY;
    canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', (e) => {
    if (dragging && Math.abs(e.clientX - downX) < 4 && Math.abs(e.clientY - downY) < 4) {
      const rect = canvas.getBoundingClientRect();
      const [wx, wy] = renderer.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      worker.postMessage({ t: 'inspect', x: Math.round(wx), y: Math.round(wy) });
    }
    dragging = false; canvas.classList.remove('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    renderer.camera.pan(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.camera.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  window.addEventListener('resize', () => renderer.resize());

  // event feed (M0: raw tail)
  const feed = document.getElementById('event-feed')!;

  // render loop
  let lastT = performance.now();
  function frame(now: number): void {
    const dt = now - lastT; lastT = now;
    renderer.camera.update(dt);
    renderer.drawTerrain();
    drawDynamic();
    if (latest) {
      hudYear.textContent = `Year ${latest.year}`;
      yearLabel.textContent = `Year ${latest.year}`;
      hudPop.textContent = `${latest.alive} souls`;
      if (latest.eventsTail.length > 0) {
        feed.textContent = latest.eventsTail.slice(-3).map(ev => ev.text).join('   ·   ');
      }
    }
    requestAnimationFrame(frame);
  }

  function drawDynamic(): void {
    if (!latest || !renderer.terrain) return;
    const ctx = renderer.ctx;
    const cam = renderer.camera;
    // settlements as markers
    for (const st of latest.settlements) {
      if (st.razed) continue;
      const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y + 0.5);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      ctx.fillStyle = ['#639bff', '#6abe30', '#8a6f30', '#ac3232'][st.factionId] ?? '#fff';
      const r = Math.max(3, cam.pxPerTile * 0.6);
      ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - r / 2), Math.round(r), Math.round(r));
    }
    // pawns: dots at region zoom, full sprites at local/close (06 zoom ladder)
    if (cam.pxPerTile >= 4) {
      const p = latest.pawns;
      const useSprites = cam.pxPerTile >= 16;
      const spriteScale = cam.pxPerTile >= 32 ? 2 : 1;
      for (let i = 0; i < p.count; i++) {
        if (!(p.flags[i] & 1)) continue;
        const [sx, sy] = cam.worldToScreen(p.x[i] + 0.5, p.y[i] + 0.5);
        if (sx < -32 || sy < -32 || sx > cam.viewW + 32 || sy > cam.viewH + 32) continue;
        if (useSprites) {
          const race = latest.factions?.[p.factionId[i]]?.race ?? 0;
          const variant = (p.flags[i] & 128) ? 2 : (p.flags[i] & 32) ? 1 : 0;
          const job = variant === 2 ? 'none' : actionToJob(p.action[i]);
          const cell = atlas.index[`${race}:${p.factionId[i]}:${job}:${variant}`];
          if (cell) {
            ctx.drawImage(atlas.canvas as CanvasImageSource, cell.x, cell.y, SPRITE_W, SPRITE_H,
              Math.round(sx - SPRITE_W * spriteScale / 2), Math.round(sy - SPRITE_H * spriteScale + 2),
              SPRITE_W * spriteScale, SPRITE_H * spriteScale);
          }
        } else {
          ctx.fillStyle = ['#cbdbfc', '#99e550', '#eec39a', '#d95763'][p.factionId[i]] ?? '#fff';
          ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
        }
      }
    }
  }

  requestAnimationFrame(frame);

  // test/debug handle (harmless in prod; used by Playwright checks)
  (window as any).__chronica = {
    renderer,
    worker,
    getLatest: () => latest,
    goto: (x: number, y: number, level?: number) => {
      renderer.camera.cx = x; renderer.camera.cy = y;
      if (level !== undefined) renderer.camera.level = level as 0 | 1 | 2 | 3;
    },
  };
}
