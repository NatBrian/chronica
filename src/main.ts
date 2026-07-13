// App entry — landing, worker boot, render loop, camera input, time machine UI,
// autosave, journal export/import, multi-tab lock (F4).
// Dev tools: ?dev=seeds / ?dev=layers&seed=N / ?dev=sprites.
import { Renderer } from './render/renderer';
import { RenderMapData } from './render/terrain';
import { mountSeedBrowser, mountLayerViewer, mountSpritePreview } from './ui/devtools';
import { bakePawnAtlas, actionToJob, SPRITE_W, SPRITE_H, PawnAtlas } from './render/sprites';
import { TICKS_PER_YEAR, Journal, DecisionRequest, DecisionResult, JournalEntry } from './shared/types';
import { SaveStore, IdbBackend, SaveRecord } from './shared/saveStore';
import { Brain } from './brain/brain';
import { OllamaBrain } from './brain/ollamaBrain';
import { ByoKeyBrain, loadByoConfig } from './brain/byoKeyBrain';
import { BrainQueue } from './brain/queue';

const atlas: PawnAtlas = bakePawnAtlas();
const idb = new IdbBackend();

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

interface MajorEvent { id: number; tick: number; type: number; severity: number; x: number; y: number; text: string; causes: number[] }

interface WorkerSnapshot {
  t: 'snapshot'; tick: number; year: number; alive: number;
  inPast: boolean; presentYear: number;
  pawns: { x: Int16Array; y: Int16Array; factionId: Uint8Array; flags: Uint16Array; action: Uint8Array; count: number };
  settlements: { id: number; x: number; y: number; name: string; factionId: number; razed: boolean; pop: number; buildings: { kind: number; x: number; y: number; stage: number }[] }[];
  factions?: { id: number; race: number; name: string }[];
  eventsTail: { text: string; severity: number }[];
}

function bootApp(): void {
  const landing = document.getElementById('landing')!;
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;
  const llmStatus = document.getElementById('llm-status')!;

  fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    .then(r => r.json())
    .then(() => { llmStatus.textContent = '✓ Local LLM found — kings will think.'; })
    .catch(() => { llmStatus.textContent = 'No local LLM — kings will rule by instinct. (ollama + OLLAMA_ORIGINS=* enables thinking kings)'; });

  document.getElementById('btn-random')!.addEventListener('click', () => {
    seedInput.value = String((Math.random() * 2 ** 31) | 0);
  });
  document.getElementById('btn-begin')!.addEventListener('click', () => {
    landing.style.display = 'none';
    startWorld({ seed: Number(seedInput.value) | 0 });
  });

  // resume list (autosaves)
  idb.allRecords().then(records => {
    if (records.length === 0) return;
    const newest = new Map<number, SaveRecord>();
    for (const r of records) {
      const cur = newest.get(r.seed);
      if (!cur || r.savedAt > cur.savedAt) newest.set(r.seed, r);
    }
    const list = document.getElementById('resume-list')!;
    list.innerHTML = '<div style="color:#9badb7;margin:14px 0 6px;font-size:13px">Continue a world:</div>';
    for (const rec of [...newest.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, 5)) {
      const b = document.createElement('button');
      b.className = 'ctl';
      b.style.margin = '3px';
      b.textContent = `${rec.islandName} — Year ${Math.floor(rec.tick / TICKS_PER_YEAR)} (seed ${rec.seed})`;
      b.addEventListener('click', async () => {
        const store = new SaveStore(idb, `world:${rec.seed}`);
        const valid = await store.loadLatestValid();
        if (valid) {
          landing.style.display = 'none';
          startWorld({ resume: valid });
        }
      });
      list.appendChild(b);
    }
  }).catch(() => {});
}

function startWorld(boot: { seed?: number; resume?: SaveRecord; journal?: Journal }): void {
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const renderer = new Renderer(canvas, 512);
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  const hudYear = document.getElementById('hud-year')!;
  const hudPop = document.getElementById('hud-pop')!;
  const hudIsland = document.getElementById('hud-island')!;
  const yearLabel = document.getElementById('year-label')!;
  const seekStatus = document.getElementById('seek-status')!;
  const replayBadge = document.getElementById('replay-badge')!;
  const btnPresent = document.getElementById('btn-present')!;
  let latest: WorkerSnapshot | null = null;
  let majors: MajorEvent[] = [];
  let speed = 4;
  let paused = false;
  let readOnly = false;
  let saveStore: SaveStore | null = null;
  let worldSeed = boot.seed ?? boot.resume?.seed ?? boot.journal?.header.seed ?? 0;

  // ---- thinking kings: brain adapters + queue (M4) ----
  const llmBadge = document.getElementById('llm-badge')!;
  let brainQueue: BrainQueue | null = null;
  (async () => {
    let brain: Brain | null = null;
    const ollama = new OllamaBrain();
    if (await ollama.detectModel()) {
      brain = ollama;
    } else {
      const byo = loadByoConfig();
      if (byo) brain = new ByoKeyBrain(byo);
    }
    brainQueue = new BrainQueue(
      brain,
      (req, result: DecisionResult) => {
        const entry: JournalEntry = {
          seq: 0,   // worker assigns
          requestId: req.requestId,
          requestTick: req.tick,
          applyAtTick: req.applyAtTick,
          actorId: req.actorId,
          factionId: req.factionId,
          choice: result.choice,
          reasoning: result.reasoning,
          ...(result.newMemory ? { newMemory: result.newMemory } : {}),
          source: brain?.name === 'byok' ? 'byok' : 'ollama',
        };
        worker.postMessage({ t: 'decision', entry });
      },
      (st) => {
        llmBadge.textContent = st.mode === 'llm'
          ? `👑 kings think (${st.brainName}, ~${(st.probeMs / 1000).toFixed(1)}s, ${st.quotaPerYear}/y)${st.inFlight ? ' · thinking…' : ''}`
          : '👑 kings ruling by instinct';
        llmBadge.title = `answered ${st.answered} · failures ${st.failures} · queued ${st.queued}`;
      },
    );
    await brainQueue.start();
  })();

  // F4: Web Locks — second tab opening any world is read-only
  if (navigator.locks) {
    navigator.locks.request('chronica-world', { ifAvailable: true }, async lock => {
      if (!lock) {
        readOnly = true;
        (document.getElementById('tab-notice') as HTMLElement).style.display = 'flex';
        return;
      }
      return new Promise(() => {});   // hold lock for the tab's lifetime
    });
  }

  if (boot.resume) {
    worker.postMessage({ t: 'init', resume: boot.resume }, [boot.resume.snapshot]);
  } else if (boot.journal) {
    worker.postMessage({ t: 'init', journal: boot.journal, continueLive: true });
  } else {
    worker.postMessage({ t: 'init', seed: boot.seed });
  }

  worker.onmessage = (e) => {
    const msg = e.data;
    switch (msg.t) {
      case 'ready': {
        renderer.setMap(msg.map as RenderMapData);
        hudIsland.textContent = msg.islandName;
        document.title = `Chronica — ${msg.islandName}`;
        worldSeed = msg.header.seed;
        saveStore = new SaveStore(idb, `world:${worldSeed}`);
        applySpeed();
        break;
      }
      case 'snapshot': latest = msg; break;
      case 'majorEvents': majors = msg.events; break;
      case 'feed': renderFeed(msg.events); break;
      case 'chain': renderChain(msg.chain); break;
      case 'requests': {
        for (const req of msg.requests as DecisionRequest[]) {
          brainQueue?.enqueue(req, Math.floor(req.tick / TICKS_PER_YEAR));
        }
        break;
      }
      case 'decisionApplied': onDecisionApplied(msg); break;
      case 'inspection': showInspector(msg.pawn); break;
      case 'seeked': {
        seekStatus.style.display = 'none';
        setReplayUI(msg.inPast);
        break;
      }
      case 'reachedPresent': setReplayUI(false); break;
      case 'autosave': {
        if (saveStore && !readOnly) {
          saveStore.save(msg.record).catch(() => {});
        }
        break;
      }
      case 'journal': {
        const blob = new Blob([JSON.stringify(msg.journal)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chronica-${hudIsland.textContent}-seed${worldSeed}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
    }
  };

  function setReplayUI(inPast: boolean): void {
    replayBadge.style.display = inPast ? 'inline-block' : 'none';
    (btnPresent as HTMLElement).style.display = inPast ? 'inline-block' : 'none';
  }

  function ticksPerSec(): number {
    return paused || readOnly ? 0 : speed * 10;
  }
  function applySpeed(): void {
    worker.postMessage({ t: 'speed', ticksPerSec: ticksPerSec() });
  }

  // ---- controls ----
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
  btnPresent.addEventListener('click', () => worker.postMessage({ t: 'jumpPresent' }));
  document.getElementById('btn-export')!.addEventListener('click', () => worker.postMessage({ t: 'exportJournal' }));
  const importFile = document.getElementById('import-file') as HTMLInputElement;
  document.getElementById('btn-import')!.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const journal = JSON.parse(await f.text()) as Journal;
      if (journal.header?.seed === undefined) throw new Error('not a journal');
      worker.terminate();
      startWorld({ journal });
    } catch {
      alert('Not a valid Chronica journal file.');
    }
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
    if (e.key === ',' && paused) stepSeek(0.25);
    if (e.key === '.' && paused) stepSeek(1);
  });

  function stepSeek(years: number): void {
    if (!latest) return;
    doSeek(latest.tick / TICKS_PER_YEAR + years);
  }

  // ---- mouse: drag pan + wheel zoom + click-to-inspect ----
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
  window.addEventListener('resize', () => { renderer.resize(); sizeTimeline(); });

  // ---- timeline (the marquee — 07) ----
  const tl = document.getElementById('timeline') as HTMLCanvasElement;
  const tlTip = document.getElementById('tl-tooltip')!;
  function sizeTimeline(): void {
    tl.width = tl.clientWidth || 600;
    tl.height = 26;
  }
  sizeTimeline();

  function timelineSpanYears(): number {
    if (!latest) return 10;
    return Math.max(10, latest.presentYear);
  }

  function drawTimeline(): void {
    const ctx = tl.getContext('2d')!;
    const W = tl.width, H = tl.height;
    ctx.clearRect(0, 0, W, H);
    if (!latest) return;
    const span = timelineSpanYears();
    // baseline
    ctx.fillStyle = '#23233a';
    ctx.fillRect(0, H - 8, W, 4);
    // event markers
    for (const ev of majors) {
      const x = (ev.tick / TICKS_PER_YEAR / span) * W;
      const size = ev.severity >= 5 ? 6 : ev.severity === 4 ? 5 : 3;
      ctx.fillStyle = ev.severity >= 4 ? '#d95763' : '#d9a066';
      ctx.fillRect(Math.round(x) - size / 2, H - 10 - size, size, size);
    }
    // cursor
    const cx = (latest.tick / TICKS_PER_YEAR / span) * W;
    ctx.fillStyle = '#639bff';
    ctx.fillRect(Math.round(cx) - 1, 0, 3, H);
    // present marker while replaying
    if (latest.inPast) {
      const px = (latest.presentYear / span) * W;
      ctx.fillStyle = '#5fcde4';
      ctx.fillRect(Math.round(px) - 1, 0, 2, H);
    }
  }

  function doSeek(year: number): void {
    seekStatus.textContent = `Traveling to Year ${Math.floor(year)}...`;
    seekStatus.style.display = 'block';
    worker.postMessage({ t: 'seek', year });
  }

  tl.addEventListener('click', (e) => {
    const rect = tl.getBoundingClientRect();
    const year = ((e.clientX - rect.left) / rect.width) * timelineSpanYears();
    doSeek(year);
  });
  tl.addEventListener('mousemove', (e) => {
    const rect = tl.getBoundingClientRect();
    const year = ((e.clientX - rect.left) / rect.width) * timelineSpanYears();
    const nearTick = year * TICKS_PER_YEAR;
    let best: MajorEvent | null = null;
    for (const ev of majors) {
      if (!best || Math.abs(ev.tick - nearTick) < Math.abs(best.tick - nearTick)) best = ev;
    }
    tlTip.innerHTML = `<span class="yr">Year ${Math.floor(year)}</span>` +
      (best && Math.abs(best.tick - nearTick) < 15 * TICKS_PER_YEAR ? `<br>${best.text}` : '');
    tlTip.style.left = `${e.clientX}px`;
    (tlTip as HTMLElement).style.display = 'block';
  });
  tl.addEventListener('mouseleave', () => { (tlTip as HTMLElement).style.display = 'none'; });

  // ---- inspector ----
  const inspectorEl = document.getElementById('inspector')!;
  function showInspector(pawn: any): void {
    if (!pawn) { inspectorEl.style.display = 'none'; return; }
    const raceNames = ['human', 'elf', 'dwarf', 'orc'];
    const bar = (label: string, v: number) => {
      const pct = Math.round(Math.min(255, v) / 2.55);
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

  // ---- council panel + decision toasts (07 §4, shareable moment #1) ----
  const councilPanel = document.getElementById('council-panel')!;
  const toastStack = document.getElementById('toast-stack')!;
  const recentDecisions: any[] = [];

  function onDecisionApplied(msg: any): void {
    recentDecisions.push(msg);
    if (recentDecisions.length > 20) recentDecisions.shift();
    const isWar = msg.entry.choice.startsWith('DECLARE_WAR') || msg.entry.choice === 'RAZE';
    const isMajor = isWar || msg.entry.choice.startsWith('SUE_FOR_PEACE') ||
      msg.entry.choice.startsWith('ALLY_AGAINST') || msg.kind === 'postWar';
    // rate-limit: only toast notable decisions (or LLM ones)
    if (!isMajor && msg.entry.source === 'fallback') return;
    toast(
      `${msg.actorName} has made a decision`,
      msg.entry.choice.split('(')[0].replace(/_/g, ' ').toLowerCase(),
      isWar,
      () => showCouncil(msg),
    );
    // auto-pause on war declarations at 1× (07: default ON at 1×, OFF at 16×)
    if (isWar && speed === 1 && !paused) {
      paused = true; btnPause.textContent = '▶'; applySpeed();
      showCouncil(msg);
    }
  }

  function toast(title: string, sub: string, war: boolean, onClick: () => void): void {
    const el = document.createElement('div');
    el.className = `toast${war ? ' war' : ''}`;
    el.innerHTML = `<b>${title}</b><br><span style="color:#9badb7">${sub}</span>`;
    el.addEventListener('click', () => { onClick(); el.remove(); });
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 9000);
    while (toastStack.children.length > 4) toastStack.firstChild?.remove();
  }

  function showCouncil(msg: any): void {
    const d = msg.digest;
    const e = msg.entry;
    councilPanel.innerHTML = `
      <span style="float:right;cursor:pointer;color:#9badb7" id="council-close">✕</span>
      <h3>👑 ${msg.actorName}</h3>
      <div class="sub">${msg.factionName} · Year ${Math.floor(e.applyAtTick / TICKS_PER_YEAR)} · ${msg.kind.split(':')[0] || 'council'}</div>
      ${d ? `<div style="font-size:12px;color:#9badb7;margin-bottom:8px">
        ${d.situation.foodStores} of food · army ${d.situation.armyStrength} · ${d.situation.population} subjects
        ${d.grudges?.length ? `<br>grudges: ${d.grudges.map((g: any) => `${g.faction.split(' (')[0]} (${g.weight})`).join(', ')}` : ''}
      </div>` : ''}
      <div class="reasoning">“${e.reasoning}”</div>
      <div style="font-size:12px;color:#9badb7;margin:8px 0 4px">options considered:</div>
      ${(msg.options ?? []).map((o: string) =>
        `<div class="opt${o === e.choice ? ' chosen' : ''}">${o === e.choice ? '➤ ' : ''}${o}</div>`).join('')}
      <div class="src">${e.source === 'fallback' ? 'ruled by instinct (RuleBrain)' : `spoken by the king (${e.source})`}</div>
    `;
    councilPanel.style.display = 'block';
    document.getElementById('council-close')!.addEventListener('click', () => {
      councilPanel.style.display = 'none';
    });
  }

  // ---- event feed (07): clickable ticker → camera jump + causality chain ----
  const feed = document.getElementById('event-feed')!;
  const chainView = document.getElementById('chain-view')!;
  const chainNodes = document.getElementById('chain-nodes')!;
  document.getElementById('chain-close')!.addEventListener('click', () => {
    chainView.style.display = 'none';
  });
  let lastFeedPoll = 0;
  let feedIds = '';

  interface FeedEvent { id: number; tick: number; severity: number; x: number; y: number; text: string; hasCauses: boolean }

  function renderFeed(events: FeedEvent[]): void {
    const key = events.map(ev => ev.id).join(',');
    if (key === feedIds) return;
    feedIds = key;
    feed.innerHTML = '';
    for (const ev of events.slice(-8).reverse()) {
      const span = document.createElement('span');
      span.className = `ev sev${ev.severity}`;
      span.textContent = ev.text;
      span.addEventListener('click', () => {
        renderer.camera.cx = ev.x; renderer.camera.cy = ev.y;
        if (renderer.camera.level < 2) renderer.camera.level = 2;
        worker.postMessage({ t: 'chain', eventId: ev.id });
      });
      feed.appendChild(span);
    }
  }

  interface ChainNode { id: number; tick: number; severity: number; x: number; y: number; text: string }

  function renderChain(chain: ChainNode[]): void {
    if (!chain || chain.length === 0) return;
    chainNodes.innerHTML = '';
    chain.forEach((node, idx) => {
      if (idx > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'chain-arrow';
        arrow.textContent = '⟵ because';
        chainNodes.appendChild(arrow);
      }
      const el = document.createElement('div');
      el.className = 'chain-node';
      el.innerHTML = `<span class="cy">Y${Math.floor(node.tick / TICKS_PER_YEAR)}</span> ${node.text.replace(/^Y\d+: /, '')}`;
      el.addEventListener('click', () => {
        renderer.camera.cx = node.x; renderer.camera.cy = node.y;
        doSeek(node.tick / TICKS_PER_YEAR);
      });
      chainNodes.appendChild(el);
    });
    chainView.style.display = 'block';
  }

  // ---- render loop ----
  let lastT = performance.now();
  function frame(now: number): void {
    const dt = now - lastT; lastT = now;
    renderer.camera.update(dt);
    renderer.drawTerrain();
    drawDynamic();
    drawTimeline();
    if (latest) {
      hudYear.textContent = `Year ${latest.year}`;
      yearLabel.textContent = `Year ${latest.year}`;
      hudPop.textContent = `${latest.alive} souls`;
    }
    if (now - lastFeedPoll > 900) {
      lastFeedPoll = now;
      worker.postMessage({ t: 'recentFeed', minSeverity: 2 });
    }
    requestAnimationFrame(frame);
  }

  function drawDynamic(): void {
    if (!latest || !renderer.terrain) return;
    const ctx = renderer.ctx;
    const cam = renderer.camera;
    // buildings (M2): simple blocks colored by faction, sized by stage
    if (cam.pxPerTile >= 4) {
      for (const st of latest.settlements) {
        if (st.razed) continue;
        for (const b of st.buildings) {
          const [sx, sy] = cam.worldToScreen(b.x, b.y);
          if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
          const sz = Math.max(2, cam.pxPerTile * (b.stage === 3 ? 0.9 : 0.4 + b.stage * 0.15));
          ctx.fillStyle = b.kind === 1 ? '#8a6f30' : b.kind === 2 ? '#847e87' : '#663931';
          ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(sz), Math.round(sz));
          if (b.stage === 3 && cam.pxPerTile >= 16) {
            ctx.fillStyle = '#45283c';
            ctx.fillRect(Math.round(sx + sz / 4), Math.round(sy - sz / 4), Math.round(sz / 2), Math.round(sz / 4));
          }
        }
      }
    }
    // settlement markers
    for (const st of latest.settlements) {
      if (st.razed) continue;
      const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y + 0.5);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      ctx.fillStyle = ['#639bff', '#6abe30', '#8a6f30', '#ac3232'][st.factionId] ?? '#fff';
      const r = Math.max(3, cam.pxPerTile * 0.6);
      ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - r / 2), Math.round(r), Math.round(r));
      if (cam.pxPerTile >= 4) {
        ctx.fillStyle = '#cbdbfc';
        ctx.font = '11px system-ui';
        ctx.fillText(st.name, Math.round(sx + r), Math.round(sy - 4));
      }
    }
    // pawns: dots at region zoom, sprites at local/close
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

  // test/debug handle (used by Playwright checks)
  (window as any).__chronica = {
    renderer, worker,
    getLatest: () => latest,
    getMajors: () => majors,
    goto: (x: number, y: number, level?: number) => {
      renderer.camera.cx = x; renderer.camera.cy = y;
      if (level !== undefined) renderer.camera.level = level as 0 | 1 | 2 | 3;
    },
    seek: (year: number) => doSeek(year),
  };
}
