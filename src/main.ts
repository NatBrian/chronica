// App entry: landing, worker boot, render loop, camera input, time machine UI,
// autosave, journal export/import, multi-tab lock (F4).
// Dev tools: ?dev=seeds / ?dev=layers&seed=N / ?dev=sprites.
import { Renderer } from './render/renderer';
import { RenderMapData, tileColor } from './render/terrain';
import { mountSeedBrowser, mountLayerViewer, mountSpritePreview } from './ui/devtools';
import { bakePawnAtlas, actionToJob, SPRITE_W, SPRITE_H, PawnAtlas } from './render/sprites';
import { bakeMapIcons, bakeBuildingAtlas, BUILDING_CELL } from './render/mapIcons';
import { MapMode } from './render/mapMode';
import { FACTION_HEX } from './render/palette';
import { eventMeta, CATEGORY_LIST, CATEGORY_COLOR, EventCategory, eraColor } from './ui/eventMeta';
import { Beacons } from './ui/beacons';
import { Spectacle } from './render/spectacle';
import { StatsPanel, StatsData } from './ui/statsCharts';
import { TICKS_PER_YEAR, Journal, DecisionRequest, DecisionResult, JournalEntry } from './shared/types';
import { SaveStore, IdbBackend, SaveRecord } from './shared/saveStore';
import { Brain } from './brain/brain';
import { OllamaBrain } from './brain/ollamaBrain';
import { ByoKeyBrain, loadByoConfig, saveByoConfig } from './brain/byoKeyBrain';
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
  settlements: { id: number; x: number; y: number; name: string; factionId: number; razed: boolean; pop: number; stockpile: number[]; buildings: { kind: number; x: number; y: number; stage: number }[] }[];
  factions?: { id: number; race: number; name: string; extinct?: boolean; capital?: number }[];
  wars?: { id: number; attacker: number; defender: number; objective: string; startTick: number }[];
  pairs?: { a: number; b: number; diplo: number; grudge: number }[];
  squads?: { x: number; y: number; factionId: number; state: string; n: number; morale?: number; warId?: number }[];
  caravans?: { x: number; y: number; factionId: number; purpose: string }[];
  monsters?: { x: number; y: number; kind: string }[];
  namedPos?: { id: number; name: string; x: number; y: number }[];
  eventsTail: { text: string; severity: number }[];
}

const FACTION_COLORS = FACTION_HEX;

function bootApp(): void {
  const landing = document.getElementById('landing')!;
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;
  const llmStatus = document.getElementById('llm-status')!;

  fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    .then(r => r.json())
    .then(() => { llmStatus.textContent = '✓ Local LLM found: kings will think.'; })
    .catch(() => {
      const hasKey = !!loadByoConfig();
      llmStatus.innerHTML = hasKey
        ? '✓ API key set: kings will think (BYO key).'
        : 'No local LLM: kings will rule by instinct. (ollama + OLLAMA_ORIGINS=* enables thinking kings, or <a href="#" id="byok-link" style="color:#639bff">use an API key</a>)';
      document.getElementById('byok-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        const provider = (prompt('Provider: "openrouter" or "anthropic"?', 'openrouter') ?? '').trim() as 'openrouter' | 'anthropic';
        if (provider !== 'openrouter' && provider !== 'anthropic') return;
        const apiKey = (prompt('API key (stored in your browser only):') ?? '').trim();
        if (!apiKey) return;
        const model = (prompt('Model id:', provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'meta-llama/llama-3.3-70b-instruct') ?? '').trim();
        if (!model) return;
        saveByoConfig({ provider, apiKey, model });
        llmStatus.textContent = '✓ API key saved: kings will think (BYO key).';
      });
    });

  document.getElementById('btn-random')!.addEventListener('click', () => {
    seedInput.value = String((Math.random() * 2 ** 31) | 0);
  });
  document.getElementById('btn-begin')!.addEventListener('click', () => {
    landing.style.display = 'none';
    // world laws (M12, P4.1): genesis-time only, journaled via the header
    const law = (id: string) => Number((document.getElementById(id) as HTMLSelectElement).value);
    startWorld({
      seed: Number(seedInput.value) | 0,
      config: {
        aggressionScale: law('law-aggression'),
        fertilityScale: law('law-fertility'),
        lifespanScale: law('law-lifespan'),
        disasterScale: law('law-disaster'),
        injectors: law('law-injectors') === 1,
        eraWheel: law('law-erawheel') === 1,
      },
    });
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
      b.textContent = `${rec.islandName}: Year ${Math.floor(rec.tick / TICKS_PER_YEAR)} (seed ${rec.seed})`;
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

function startWorld(boot: { seed?: number; resume?: SaveRecord; journal?: Journal; config?: Record<string, unknown> }): void {
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const renderer = new Renderer(canvas, 512);
  const mapIcons = bakeMapIcons();
  const buildingAtlas = bakeBuildingAtlas();
  let farms: number[] = [];              // [x, y, stage] triples, polled
  let lastFarmsPoll = 0;
  let mapMode: MapMode | null = null;
  const beacons = new Beacons();
  const spectacle = new Spectacle();
  let flyTarget: { x: number; y: number } | null = null;
  // follow + favorites (M11, P3.1)
  let starred = new Set<number>();
  let followId = -1;
  let lastStarScanId = -1;
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

  // F4: Web Locks; second tab opening any world is read-only
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
    worker.postMessage({ t: 'init', seed: boot.seed, config: boot.config });
  }

  worker.onmessage = (e) => {
    const msg = e.data;
    switch (msg.t) {
      case 'ready': {
        renderer.setMap(msg.map as RenderMapData);
        mapMode = new MapMode(msg.map.size, msg.map.biome);
        hudIsland.textContent = msg.islandName;
        document.title = `Chronica: ${msg.islandName}`;
        worldSeed = msg.header.seed;
        saveStore = new SaveStore(idb, `world:${worldSeed}`);
        starred = new Set(JSON.parse(localStorage.getItem(`chronica.stars.${worldSeed}`) ?? '[]'));
        bakeMinimap();
        applySpeed();
        // timeline v2 era bands need the chronicle's eras from the start
        worker.postMessage({ t: 'requestChronicle' });
        break;
      }
      case 'snapshot':
        latest = msg;
        brainQueue?.prune(msg.tick);
        break;
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
      case 'chronicle': renderChronicle(msg); break;
      case 'chronicleDraft': narrateChapter(msg); break;
      case 'chapterToast':
        toast(`New chapter: ${msg.title}`, 'click to open the chronicle', false, () => {
          openChronicle(msg.chapterId);
        });
        break;
      case 'eraToast':
        toast(`A new era: ${msg.name}`, msg.summary.slice(0, 90) + '…', false, () => openChronicle());
        break;
      case 'allEvents':
        allEvents = msg.events;
        renderEvents();
        break;
      case 'stats':
        statsData = msg;
        statsPanel?.setData(msg);
        renderHudChips();
        break;
      case 'farms':
        farms = msg.xyStage;
        break;
      case 'characterSheet':
        renderCharacterSheet(msg.sheet);
        break;
      case 'tlFrame':
        tlFrames.push(msg);
        seekStatus.textContent = `Filming... Year ${msg.year}`;
        break;
      case 'tlDone':
        void exportTimelapse();
        break;
      case 'records':
        renderRecords(msg.rows);
        break;
      case 'councilLog':
        councilEntries = msg.entries;
        renderCouncils();
        break;
      case 'searchIndex': searchIndexArrived(msg); break;
      case 'inspection':
        if (msg.settlement) showSettlementInspector(msg.settlement);
        else showInspector(msg.pawn);
        break;
      case 'seeked': {
        seekStatus.style.display = 'none';
        setReplayUI(msg.inPast);
        const toYear = Math.floor(msg.tick / TICKS_PER_YEAR);
        if (seekFromYear >= 0 && Math.abs(toYear - seekFromYear) > 5) {
          showDigest(seekFromYear, toYear);
        }
        seekFromYear = -1;
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
  btnPause.addEventListener('click', () => { paused = !paused; btnPause.textContent = paused ? '▶' : '⏸'; applySpeed(); updateReadingMode(); });
  document.querySelectorAll('button.speed').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('button.speed').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      speed = Number((b as HTMLElement).dataset.s);
      paused = false; btnPause.textContent = '⏸';
      applySpeed();
    });
  });
  btnPresent.addEventListener('click', () => {
    seekFromYear = latest ? latest.year : -1;
    worker.postMessage({ t: 'jumpPresent' });
  });
  document.getElementById('btn-export')!.addEventListener('click', () => worker.postMessage({ t: 'exportJournal' }));
  document.getElementById('btn-timelapse')!.addEventListener('click', startTimelapse);
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
    if (e.key === 'Escape') {
      closeSearch();
      councilPanel.style.display = 'none';
      chainView.style.display = 'none';
      inspectorEl.style.display = 'none';
      digestCard.style.display = 'none';
      return;
    }
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
    if (e.key === 'c' || e.key === 'C') {
      if (rail.classList.contains('open')) closeRail();
      else openChronicle();
    }
    if (e.key === 'e' || e.key === 'E') {
      if (rail.classList.contains('open') && activeTab === 'events') closeRail();
      else openRail('events');
    }
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    if (e.key === 't' || e.key === 'T') setOverlay('territory');
    if (e.key === 'p' || e.key === 'P') setOverlay('pop');
    if (e.key === 'f' || e.key === 'F') setOverlay('food');
    if (e.key === 'W') setOverlay('war');                  // Shift+W (plain w pans)
    if (e.key === 'h' || e.key === 'H') togglePostcard();
    if (e.key === 'g' || e.key === 'G') screenshot();
  });

  function stepSeek(years: number): void {
    if (!latest) return;
    doSeek(latest.tick / TICKS_PER_YEAR + years);
  }

  // ---- mouse: drag pan + wheel zoom + click-to-inspect ----
  let dragging = false; let lastX = 0; let lastY = 0; let downX = 0; let downY = 0;
  canvas.addEventListener('mousedown', (e) => {
    dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY;
    flyTarget = null;                       // manual camera cancels auto-pan
    followId = -1;                          // and releases any followed star
    canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', (e) => {
    if (dragging && Math.abs(e.clientX - downX) < 4 && Math.abs(e.clientY - downY) < 4) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      // beacon pins and edge arrows take the click before pawn inspection (H)
      const hit = beacons.hitTest(sx, sy, renderer.camera);
      if (hit) {
        if (hit.ev) {
          flyTarget = { x: hit.ev.x, y: hit.ev.y };
          worker.postMessage({ t: 'chain', eventId: hit.ev.id });
        } else {
          openRail('events');
        }
      } else {
        const [wx, wy] = renderer.camera.screenToWorld(sx, sy);
        worker.postMessage({ t: 'inspect', x: Math.round(wx), y: Math.round(wy) });
      }
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

  // ---- timeline v2 (11 §G2): era bands, category markers, two-stage zoom ----
  const tl = document.getElementById('timeline') as HTMLCanvasElement;
  const tlTip = document.getElementById('tl-tooltip')!;
  let tlZoom: { y0: number; y1: number } | null = null;   // decade strip when set
  const ERA_H = 9;                                        // era band strip height
  function sizeTimeline(): void {
    tl.width = tl.clientWidth || 600;
    tl.height = 34;
  }
  sizeTimeline();

  function tlSpan(): { y0: number; y1: number } {
    if (tlZoom) return tlZoom;
    return { y0: 0, y1: latest ? Math.max(10, latest.presentYear) : 10 };
  }
  function yearToX(year: number, W: number): number {
    const s = tlSpan();
    return ((year - s.y0) / Math.max(1, s.y1 - s.y0)) * W;
  }
  function xToYear(x: number, w: number): number {
    const s = tlSpan();
    return s.y0 + (x / w) * (s.y1 - s.y0);
  }
  function eraAt(year: number): { name: string; yearStart: number; yearEnd: number; idx: number } | null {
    for (let i = 0; i < chronState.eras.length; i++) {
      const era = chronState.eras[i];
      if (year >= era.yearStart && year < era.yearEnd) return { ...era, idx: i };
    }
    return null;
  }

  function drawTimeline(): void {
    const ctx = tl.getContext('2d')!;
    const W = tl.width, H = tl.height;
    ctx.clearRect(0, 0, W, H);
    if (!latest) return;
    // era bands (named, colored)
    ctx.font = '9px system-ui';
    ctx.textBaseline = 'top';
    chronState.eras.forEach((era: any, i: number) => {
      const x0 = Math.max(0, yearToX(era.yearStart, W));
      const x1 = Math.min(W, yearToX(era.yearEnd, W));
      if (x1 <= 0 || x0 >= W) return;
      ctx.fillStyle = eraColor(i);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x0, 0, x1 - x0, ERA_H - 1);
      ctx.globalAlpha = 1;
      if (x1 - x0 > 76) {
        ctx.fillStyle = '#cbdbfc';
        ctx.fillText(era.name.slice(0, Math.floor((x1 - x0) / 6)), x0 + 3, 0);
      }
    });
    // baseline
    ctx.fillStyle = '#23233a';
    ctx.fillRect(0, H - 5, W, 3);
    // chapter markers: blue book pips just under the era strip
    for (const c of chronState.chapters) {
      const x = yearToX(c.yearStart, W);
      if (x < -2 || x > W + 2) continue;
      ctx.fillStyle = '#639bff';
      ctx.fillRect(Math.round(x) - 1, ERA_H + 1, 3, 4);
    }
    // category markers, clustered (11 §G2): one aggregated marker per bucket,
    // sized by event count, colored by the bucket's most severe event.
    // Adaptive floor keeps the full-history view to the biggest moments.
    const span = tlSpan();
    const spanYears = span.y1 - span.y0;
    const minSev = spanYears > 400 ? 4 : spanYears > 150 ? 3 : 0;
    // V1 density v3: buckets widen with world age so ancient worlds still read
    const BUCKET = Math.min(14, 5 + Math.floor(spanYears / 250) * 3);
    const buckets = new Map<number, { top: MajorEvent; count: number }>();
    for (const ev of majors) {
      if (ev.severity < minSev) continue;
      const y = ev.tick / TICKS_PER_YEAR;
      if (y < span.y0 || y > span.y1) continue;
      const b = Math.floor(yearToX(y, W) / BUCKET);
      const cur = buckets.get(b);
      if (!cur) buckets.set(b, { top: ev, count: 1 });
      else { cur.count++; if (ev.severity > cur.top.severity) cur.top = ev; }
    }
    for (const [b, { top, count }] of buckets) {
      const size = Math.min(8, 2 + count + (top.severity >= 5 ? 2 : 0));
      ctx.fillStyle = eventMeta(top.type).color;
      const x = b * BUCKET + BUCKET / 2;
      ctx.fillRect(Math.round(x - size / 2), H - 6 - size, size, size);
    }
    // cursor
    const cx = yearToX(latest.tick / TICKS_PER_YEAR, W);
    ctx.fillStyle = '#cbdbfc';
    ctx.fillRect(Math.round(cx) - 1, 0, 3, H);
    // present marker while replaying
    if (latest.inPast) {
      const px2 = yearToX(latest.presentYear, W);
      ctx.fillStyle = '#5fcde4';
      ctx.fillRect(Math.round(px2) - 1, 0, 2, H);
    }
  }

  function doSeek(year: number): void {
    seekFromYear = latest ? latest.year : -1;
    seekStatus.textContent = `Traveling to Year ${Math.floor(year)}...`;
    seekStatus.style.display = 'block';
    worker.postMessage({ t: 'seek', year });
  }

  // zoom-exit chip + legend chip live next to the canvas
  const tlExit = document.createElement('button');
  tlExit.className = 'ctl';
  tlExit.textContent = '⤺ all history';
  tlExit.style.display = 'none';
  tl.parentElement!.insertBefore(tlExit, tl);
  tlExit.addEventListener('click', () => { tlZoom = null; tlExit.style.display = 'none'; });
  const tlLegend = document.createElement('button');
  tlLegend.className = 'ctl';
  tlLegend.textContent = '?';
  tlLegend.title = 'timeline legend';
  tl.parentElement!.insertBefore(tlLegend, tl.nextSibling);
  const legendPop = document.createElement('div');
  legendPop.style.cssText = 'position:fixed;bottom:54px;right:120px;background:#1c1c2bf5;border:1px solid #34345230;' +
    'border-radius:8px;padding:10px 14px;font-size:12px;z-index:22;display:none;line-height:1.7';
  legendPop.innerHTML = '<b style="font-size:11px;color:#9badb7;letter-spacing:1px">TIMELINE LEGEND</b><br>' +
    CATEGORY_LIST.map(c => `<span style="color:${CATEGORY_COLOR[c]}">■</span> ${c}`).join('<br>') +
    '<br><span style="color:#639bff">■</span> chapter begins' +
    '<br><span style="color:#5fcde4">|</span> the present (while replaying)' +
    '<br>top strip: named eras · click an era to zoom into it';
  document.body.appendChild(legendPop);
  tlLegend.addEventListener('mouseenter', () => { legendPop.style.display = 'block'; });
  tlLegend.addEventListener('mouseleave', () => { legendPop.style.display = 'none'; });
  tlLegend.addEventListener('click', () => {
    legendPop.style.display = legendPop.style.display === 'none' ? 'block' : 'none';
  });

  tl.addEventListener('click', (e) => {
    const rect = tl.getBoundingClientRect();
    const year = xToYear(e.clientX - rect.left, rect.width);
    // two-stage precision: clicking an era band zooms to its decades
    if (e.clientY - rect.top < ERA_H && !tlZoom) {
      const era = eraAt(year);
      if (era) {
        tlZoom = { y0: era.yearStart, y1: era.yearEnd };
        tlExit.style.display = 'inline-block';
        return;
      }
    }
    doSeek(year);
  });
  tl.addEventListener('mousemove', (e) => {
    const rect = tl.getBoundingClientRect();
    const year = xToYear(e.clientX - rect.left, rect.width);
    const nearTick = year * TICKS_PER_YEAR;
    const span = tlSpan();
    let best: MajorEvent | null = null;
    for (const ev of majors) {
      const y = ev.tick / TICKS_PER_YEAR;
      if (y < span.y0 || y > span.y1) continue;
      if (!best || Math.abs(ev.tick - nearTick) < Math.abs(best.tick - nearTick)) best = ev;
    }
    const era = eraAt(year);
    const windowTicks = Math.max(4, (span.y1 - span.y0) * 0.03) * TICKS_PER_YEAR;
    tlTip.innerHTML = `<span class="yr">Year ${Math.floor(year)}</span>` +
      (era ? ` <span style="color:${eraColor(era.idx)}">■</span> <span style="color:#9badb7">${era.name}</span>` : '') +
      (best && Math.abs(best.tick - nearTick) < windowTicks
        ? `<br><span style="color:${eventMeta(best.type).color}">${eventMeta(best.type).glyph}</span> ${best.text}` : '');
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
      ${pawn.named ? `<div class="lbl" style="margin:4px 0"><span>${pawn.named.role}</span>` +
        `<span style="color:#d9a066">${(pawn.named.traits ?? []).join(' · ')}</span></div>` +
        `<button class="ctl" id="insp-sheet" style="margin:4px 0">📜 character sheet</button>` : ''}
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
    if (pawn.named) {
      document.getElementById('insp-sheet')?.addEventListener('click', () => {
        openCharacterSheet(pawn.named.id);
      });
    }
  }

  // ---- follow + favorites + character sheet (M11, P3.1/P3.2) ----
  const charSheet = document.getElementById('char-sheet')!;

  function saveStars(): void {
    localStorage.setItem(`chronica.stars.${worldSeed}`, JSON.stringify([...starred]));
  }
  function toggleStar(id: number): void {
    if (starred.has(id)) starred.delete(id); else starred.add(id);
    saveStars();
  }
  function followCharacter(id: number): void {
    followId = followId === id ? -1 : id;
  }
  /** starred deaths + follow release: scan fresh majors (G3 tier map override) */
  function watchStarred(): void {
    if (!latest) return;
    for (const ev of majors) {
      if (ev.id <= lastStarScanId) continue;
      const evActors: number[] = (ev as any).actors ?? [];
      if (ev.type === 39 /* CharacterDied */ && evActors.some(a => starred.has(a) || a === followId)) {
        beacons.force(ev as any, performance.now());
        toast(`★ ${ev.text.replace(/^Y\d+: /, '')}`, 'a favorite has fallen', true, () => {
          flyTarget = { x: ev.x, y: ev.y };
          worker.postMessage({ t: 'chain', eventId: ev.id });
        });
        if (evActors.includes(followId)) followId = -1;   // camera release
      }
    }
    lastStarScanId = majors.length > 0 ? Math.max(lastStarScanId, majors[majors.length - 1].id) : lastStarScanId;
    // camera follow (P3.1): track the star; release silently if gone
    if (followId >= 0) {
      const pos = (latest as any).namedPos?.find((n: any) => n.id === followId);
      if (pos) flyTarget = { x: pos.x, y: pos.y };
      else if (!(latest as any).namedPos) { /* old snapshot; wait */ }
    }
  }

  function openCharacterSheet(id: number): void {
    worker.postMessage({ t: 'characterSheet', id });
  }

  function renderCharacterSheet(sheet: any): void {
    if (!sheet) return;
    const fcol = FACTION_COLORS[sheet.factionId] ?? '#fff';
    const life = sheet.dead ? `Y${sheet.bornYear} · Y${sheet.deathYear} †` : `born Y${sheet.bornYear}`;
    const person = (c: any) => c
      ? `<span class="fam" data-id="${c.id}" style="cursor:pointer;color:${c.dead ? '#9badb7' : '#cbdbfc'}">${c.name}${c.dead ? ' †' : ''} <i style="color:#696a6a">(${c.role})</i></span>`
      : '<span style="color:#696a6a">unknown</span>';
    charSheet.innerHTML = `
      <span class="close" id="cs-close" style="float:right;cursor:pointer;color:#9badb7">✕</span>
      <h3><span style="color:${fcol}">■</span> ${sheet.name}</h3>
      <div style="color:#9badb7;font-size:12px">${sheet.role} of ${sheet.factionName} · ${life}</div>
      <div style="margin:6px 0;font-size:12px">
        <span style="color:#d9a066">${sheet.traits.join(' · ')}</span>
        · ⭐ ${sheet.renown} renown · ⚔ ${sheet.kills} kills
      </div>
      <div style="margin:6px 0">
        <button class="ctl" id="cs-star">${starred.has(sheet.id) ? '★ starred' : '☆ star'}</button>
        ${!sheet.dead ? `<button class="ctl" id="cs-follow">${followId === sheet.id ? '⏹ unfollow' : '🎥 follow'}</button>` : ''}
      </div>
      <div style="color:#9badb7;font-size:11px;letter-spacing:1px;margin-top:8px">LINEAGE</div>
      <div style="font-size:12px;line-height:1.8">
        ${person(sheet.family.grandparent)} → ${person(sheet.family.parent)} → <b>${sheet.name}</b>
        ${sheet.family.children.length ? `<br>children: ${sheet.family.children.map(person).join(', ')}` : ''}
        ${sheet.family.grandchildren.length ? `<br>grandchildren: ${sheet.family.grandchildren.map(person).join(', ')}` : ''}
      </div>
      ${sheet.bio.length ? `<div style="color:#9badb7;font-size:11px;letter-spacing:1px;margin-top:8px">DEEDS</div>
        ${sheet.bio.map((b: string) => `<div style="font-size:12px">· ${b}</div>`).join('')}` : ''}
      ${sheet.mentions.length ? `<div style="color:#9badb7;font-size:11px;letter-spacing:1px;margin-top:8px">IN THE RECORD</div>
        ${sheet.mentions.map((m: any) =>
          `<div class="mention" data-ev="${m.id}" data-x="${m.x}" data-y="${m.y}" style="font-size:12px;cursor:pointer;padding:2px 0">· ${m.text}</div>`).join('')}` : ''}
    `;
    charSheet.style.display = 'block';
    document.getElementById('cs-close')!.addEventListener('click', () => { charSheet.style.display = 'none'; });
    document.getElementById('cs-star')!.addEventListener('click', () => { toggleStar(sheet.id); renderCharacterSheet(sheet); });
    document.getElementById('cs-follow')?.addEventListener('click', () => { followCharacter(sheet.id); renderCharacterSheet(sheet); });
    charSheet.querySelectorAll<HTMLElement>('.fam').forEach(el => {
      el.addEventListener('click', () => openCharacterSheet(Number(el.dataset.id)));
    });
    charSheet.querySelectorAll<HTMLElement>('.mention').forEach(el => {
      el.addEventListener('click', () => {
        flyTarget = { x: Number(el.dataset.x), y: Number(el.dataset.y) };
        worker.postMessage({ t: 'chain', eventId: Number(el.dataset.ev) });
      });
    });
  }

  // ---- settlement inspector (M8, P1.2): the loyalty list IS the score ----
  function showSettlementInspector(st: any): void {
    const fcol = FACTION_COLORS[st.factionId] ?? '#fff';
    const modRow = (m: { label: string; value: number }) =>
      `<div class="lbl" style="margin:2px 0"><span>${m.label}</span>` +
      `<span style="color:${m.value >= 0 ? '#6abe30' : '#d95763'}">${m.value >= 0 ? '+' : ''}${m.value}</span></div>`;
    const loyColor = st.loyalty > 70 ? '#6abe30' : st.loyalty > 35 ? '#d9a066' : '#d95763';
    inspectorEl.innerHTML = `
      <span class="close" id="insp-close">✕</span>
      <h4><span style="color:${fcol}">■</span> ${st.name}${st.capital ? ' 👑' : ''}</h4>
      <div class="lbl"><span>${st.factionName}</span><span>founded Y${st.foundedYear}</span></div>
      <div class="lbl" style="margin:4px 0"><span>${st.pop} souls</span><span>${st.food} food · ${st.wood} wood</span></div>
      <div style="margin:10px 0 4px;color:#9badb7;font-size:12px">loyalty:
        <b style="color:${loyColor}">${st.loyalty}</b></div>
      <div class="bar"><div style="width:${Math.min(100, st.loyalty / 1.5)}%;background:${loyColor}"></div></div>
      ${st.loyaltyMods.map(modRow).join('')}
      ${st.loyalty <= 20 ? '<div style="color:#d95763;font-size:12px;margin-top:6px">⚠ rebellion stirs in the alleys</div>' : ''}
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
    // G3 hierarchy: only tier-1 decisions toast; the rest land silently in
    // the Councils tab with a badge increment
    if (!(activeTab === 'councils' && rail.classList.contains('open'))) {
      clUnread++; updateBadges();
    } else {
      worker.postMessage({ t: 'councilLog' });
    }
    if (!isMajor) return;
    toast(
      `${msg.actorName} has made a decision`,
      msg.entry.choice.split('(')[0].replace(/_/g, ' ').toLowerCase(),
      isWar,
      () => showCouncil(msg),
      'council',
    );
    // auto-pause on war declarations at 1× (07: default ON at 1×, OFF at 16×)
    if (isWar && speed === 1 && !paused) {
      paused = true; btnPause.textContent = '▶'; applySpeed();
      showCouncil(msg);
    }
  }

  // tier-1 event beacons also toast (G3/H tier map, one source of truth)
  beacons.onTier1Live = (ev) => {
    const meta = eventMeta(ev.type);
    toast(`${meta.glyph} ${ev.text.replace(/^Y\d+: /, '')}`, 'click to look', meta.cat === 'war', () => {
      flyTarget = { x: ev.x, y: ev.y };
      worker.postMessage({ t: 'chain', eventId: ev.id });
    }, meta.cat);
  };

  function toast(title: string, sub: string, war: boolean, onClick: () => void, cat = ''): void {
    // V1 coalescing: same-category toasts within 5s merge into a counter;
    // the map is the show, not the toast pile (doc 13 V1)
    if (cat) {
      const prev = [...toastStack.children].find(el =>
        (el as HTMLElement).dataset.cat === cat &&
        performance.now() - Number((el as HTMLElement).dataset.born) < 5000) as HTMLElement | undefined;
      if (prev) {
        const n = Number(prev.dataset.n ?? 1) + 1;
        prev.dataset.n = String(n);
        prev.querySelector('b')!.textContent = `${n} ${cat} moments`;
        (prev.querySelector('span') as HTMLElement).textContent = `latest: ${title.slice(0, 60)}`;
        return;
      }
    }
    const el = document.createElement('div');
    el.className = `toast${war ? ' war' : ''}`;
    el.dataset.cat = cat;
    el.dataset.born = String(performance.now());
    el.innerHTML = `<b>${title}</b><br><span style="color:#9badb7">${sub}</span>`;
    el.addEventListener('click', () => { onClick(); el.remove(); });
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 9000);
    while (toastStack.children.length > 3) toastStack.firstChild?.remove();
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

  // ---- the Chronicle panel (07 §3) ----
  const rail = document.getElementById('chronicle-rail')!;
  const chronToc = document.getElementById('chron-toc')!;
  const chronBody = document.getElementById('chron-body')!;
  const chronLag = document.getElementById('chron-lag')!;
  let chronState: { chapters: any[]; eras: any[]; lagYears: number } = { chapters: [], eras: [], lagYears: 0 };
  let narrating = false;
  let narrateWaits = 0;
  const narrateBacklog: any[] = [];

  function openChronicle(chapterId?: number): void {
    openRail('chronicle', chapterId);
  }

  // ---- history panel: one tabbed home for all narrative (11 §G1) ----
  const railTabs = document.querySelectorAll<HTMLElement>('.rtab');
  const badgeEvents = document.getElementById('badge-events')!;
  const badgeCouncils = document.getElementById('badge-councils')!;
  const evList = document.getElementById('ev-list')!;
  const evFiltersEl = document.getElementById('ev-filters')!;
  const clList = document.getElementById('cl-list')!;
  const clFiltersEl = document.getElementById('cl-filters')!;
  interface LogEvent { id: number; tick: number; type: number; severity: number; x: number; y: number; text: string; factions: number[]; hasCauses: boolean }
  let activeTab = 'chronicle';
  let allEvents: LogEvent[] = [];
  let evUnread = 0, clUnread = 0, lastSeenEventId = -1;
  let lastEventsRequest = 0;
  let councilEntries: any[] = [];
  const catOn: Record<EventCategory, boolean> = { war: true, politics: true, disaster: true, economy: true, life: true };
  let evMinSev = 2;
  let clFaction = -1;

  function openRail(tab: string, chapterId?: number): void {
    rail.classList.add('open');
    activeTab = tab;
    railTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    for (const t of ['chronicle', 'events', 'councils', 'stats']) {
      (document.getElementById(`tab-${t}`) as HTMLElement).style.display = t === tab ? '' : 'none';
    }
    if (tab === 'chronicle') {
      worker.postMessage({ t: 'requestChronicle' });
      if (chapterId !== undefined) {
        setTimeout(() => {
          document.getElementById(`ch-${chapterId}`)?.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      }
    } else if (tab === 'events') {
      worker.postMessage({ t: 'allEvents', minSeverity: 2 });
      lastEventsRequest = performance.now();
      evUnread = 0; updateBadges();
    } else if (tab === 'councils') {
      worker.postMessage({ t: 'councilLog' });
      clUnread = 0; updateBadges();
    } else if (tab === 'stats') {
      ensureStatsPanel();
      worker.postMessage({ t: 'stats' });
      worker.postMessage({ t: 'records' });
    }
    updateReadingMode();
  }
  railTabs.forEach(b => b.addEventListener('click', () => openRail(b.dataset.tab!)));

  function closeRail(): void {
    rail.classList.remove('open');
    updateReadingMode();
  }

  function updateBadges(): void {
    badgeEvents.textContent = String(evUnread);
    badgeEvents.style.display = evUnread > 0 ? 'inline' : 'none';
    badgeCouncils.textContent = String(clUnread);
    badgeCouncils.style.display = clUnread > 0 ? 'inline' : 'none';
  }

  /** Reading mode (11 §G4): paused + panel open = wide rail, dimmed world. */
  function updateReadingMode(): void {
    document.body.classList.toggle('reading', paused && rail.classList.contains('open'));
  }

  // Events tab: filter chips + severity slider (11 §G1)
  for (const cat of CATEGORY_LIST) {
    const chip = document.createElement('button');
    chip.className = 'fchip on';
    chip.textContent = cat;
    chip.style.setProperty('--fc', CATEGORY_COLOR[cat]);
    chip.addEventListener('click', () => {
      catOn[cat] = !catOn[cat];
      chip.classList.toggle('on', catOn[cat]);
      renderEvents();
    });
    evFiltersEl.appendChild(chip);
  }
  const sevWrap = document.createElement('span');
  sevWrap.style.cssText = 'margin-left:auto;color:#9badb7;font-size:11px;display:flex;align-items:center;gap:4px';
  sevWrap.innerHTML = 'sev <input id="ev-sev" type="range" min="2" max="5" value="2" style="width:60px">';
  evFiltersEl.appendChild(sevWrap);
  (document.getElementById('ev-sev') as HTMLInputElement).addEventListener('input', (e) => {
    evMinSev = Number((e.target as HTMLInputElement).value);
    renderEvents();
  });

  const EV_PAGE = 400;
  let evShown = EV_PAGE;
  function renderEvents(keepScroll = false): void {
    if (!keepScroll) evShown = EV_PAGE;
    const rows = allEvents.filter(ev =>
      ev.severity >= evMinSev && catOn[eventMeta(ev.type).cat]);
    evList.innerHTML = '';
    const slice = rows.slice(-evShown).reverse();
    for (const ev of slice) {
      const meta = eventMeta(ev.type);
      const row = document.createElement('div');
      row.className = `ev-row sev${ev.severity}`;
      const fcol = ev.factions.length > 0 ? FACTION_COLORS[ev.factions[0]] ?? '#34345230' : '#34345230';
      row.innerHTML = `<span class="yr">Y${Math.floor(ev.tick / TICKS_PER_YEAR)}</span>` +
        `<span class="gl" style="color:${meta.color}">${meta.glyph}</span>` +
        `<div class="fc" style="background:${fcol}"></div>` +
        `<span class="tx">${ev.text.replace(/^Y\d+: /, '')}</span>`;
      row.addEventListener('click', () => {
        renderer.camera.cx = ev.x; renderer.camera.cy = ev.y;
        if (renderer.camera.level < 2) renderer.camera.level = 2;
        worker.postMessage({ t: 'chain', eventId: ev.id });
      });
      evList.appendChild(row);
    }
    if (rows.length > evShown) {
      const more = document.createElement('button');
      more.className = 'ctl';
      more.style.cssText = 'margin:8px auto;display:block';
      more.textContent = `⬆ ${rows.length - evShown} older events`;
      more.addEventListener('click', () => { evShown += EV_PAGE; renderEvents(true); });
      evList.appendChild(more);
    }
  }

  // Councils tab: every decision, verbatim reasoning, faction filter (11 §G1)
  function renderCouncilFilters(): void {
    clFiltersEl.innerHTML = '';
    const mk = (label: string, id: number, color?: string) => {
      const chip = document.createElement('button');
      chip.className = `fchip${clFaction === id ? ' on' : ''}`;
      chip.textContent = label;
      if (color) chip.style.setProperty('--fc', color);
      chip.addEventListener('click', () => { clFaction = id; renderCouncils(); });
      clFiltersEl.appendChild(chip);
    };
    mk('all', -1);
    for (const f of latest?.factions ?? []) mk(f.name.split(' ')[0], f.id, FACTION_COLORS[f.id]);
  }
  function renderCouncils(): void {
    renderCouncilFilters();
    clList.innerHTML = '';
    const rows = councilEntries.filter(en => clFaction < 0 || en.factionId === clFaction);
    if (rows.length === 0) {
      clList.innerHTML = '<div style="color:#9badb7;font-style:italic;padding:16px 6px">No decisions on record yet.</div>';
      return;
    }
    for (const en of rows.slice(-160).reverse()) {
      const row = document.createElement('div');
      row.className = 'cl-row';
      const llm = en.source !== 'fallback';
      row.innerHTML =
        `<div class="hd"><span style="color:${FACTION_COLORS[en.factionId] ?? '#9badb7'}">👑 ${en.actorName} · ${en.factionName}</span>` +
        `<span>Y${Math.floor(en.applyAtTick / TICKS_PER_YEAR)}</span></div>` +
        `<div class="ch">${en.choice.split('(')[0].replace(/_/g, ' ').toLowerCase()}</div>` +
        (en.reasoning ? `<div class="rs">“${en.reasoning}”</div>` : '') +
        `<div class="hd"><span class="${llm ? 'src-llm' : ''}">${llm ? 'spoken by the king' : 'ruled by instinct'}</span></div>`;
      clList.appendChild(row);
    }
  }

  // ---- stats tab + HUD faction chips (11 §I1/I2) ----
  let statsData: StatsData | null = null;
  let statsPanel: StatsPanel | null = null;
  let lastStatsPoll = 0;
  const hudFactions = document.getElementById('hud-factions')!;

  /** world records (M11, I5) under the charts */
  function renderRecords(rows: string[]): void {
    const tab = document.getElementById('tab-stats')!;
    let box = document.getElementById('world-records');
    if (!box) {
      box = document.createElement('div');
      box.id = 'world-records';
      box.style.cssText = 'margin-top:12px;font-size:12px;line-height:1.8';
      tab.appendChild(box);
    }
    box.innerHTML = '<div style="color:#9badb7;font-size:11px;letter-spacing:1px;text-transform:uppercase">WORLD RECORDS</div>' +
      rows.map(r => `<div>🏆 ${r}</div>`).join('');
  }

  function ensureStatsPanel(): void {
    if (statsPanel) return;
    statsPanel = new StatsPanel(document.getElementById('tab-stats')!, {
      factionName: (f) => latest?.factions?.[f]?.name.split(' ')[0] ?? `#${f}`,
      eras: () => chronState.eras,
      onSeek: (year) => doSeek(year),
    });
    if (statsData) statsPanel.setData(statsData);
  }

  function renderHudChips(): void {
    if (!statsData || !latest?.factions) return;
    const n = statsData.years.length;
    if (n === 0) return;
    hudFactions.innerHTML = '';
    const atWar = new Set<number>();
    for (const w of latest.wars ?? []) { atWar.add(w.attacker); atWar.add(w.defender); }
    for (const f of latest.factions) {
      if (f.extinct) continue;
      const pop = statsData.pop[f.id]?.[n - 1] ?? 0;
      const popPrev = statsData.pop[f.id]?.[Math.max(0, n - 11)] ?? pop;
      const chip = document.createElement('div');
      chip.className = 'fhud';
      chip.title = `${f.name} · click for charts`;
      const trend = pop > popPrev ? '<span class="up">▲</span>' : pop < popPrev ? '<span class="down">▼</span>' : '';
      const live = latest.factions.filter(x => !x.extinct).length;
      chip.innerHTML = `<span class="sw" style="background:${FACTION_COLORS[f.id]}"></span>` +
        (live > 5 ? `<b>${pop}</b>${trend}` :
          `<span>${f.name.split(' ')[0]}</span><b>${pop}</b>${trend}`) +
        `${atWar.has(f.id) ? '⚔' : ''}${pop > 0 && pop < 50 ? '💀' : ''}`;
      // 50y pop sparkline
      const spark = document.createElement('canvas');
      spark.width = 44; spark.height = 14;
      const sctx = spark.getContext('2d')!;
      const win = statsData.pop[f.id]?.slice(-50) ?? [];
      const maxV = Math.max(1, ...win);
      sctx.strokeStyle = FACTION_COLORS[f.id] ?? '#fff';
      sctx.beginPath();
      win.forEach((v, i) => {
        const x = (i / Math.max(1, win.length - 1)) * 43;
        const y = 13 - (v / maxV) * 12;
        if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
      });
      sctx.stroke();
      chip.appendChild(spark);
      chip.addEventListener('click', () => openRail('stats'));
      hudFactions.appendChild(chip);
    }
  }

  // ---- war status strip (11 §A3, V1: ONE row, wars as tabs) ----
  const warStrip = document.getElementById('war-strip')!;
  let warStripKey = '';
  let warTab = 0;
  function renderWarStrip(): void {
    if (!latest) return;
    const wars = latest.wars ?? [];
    const squads = latest.squads ?? [];
    const key = wars.map(w => `${w.id}:${(w as any).captureProgress ?? 0}:${squads.length}`).join(',') + `#${warTab}`;
    if (key === warStripKey) return;
    warStripKey = key;
    warStrip.innerHTML = '';
    if (wars.length === 0) return;
    if (warTab >= wars.length) warTab = 0;
    // tab chips for the other wars: the map stays visible (doc 13 V1)
    if (wars.length > 1) {
      const tabs = document.createElement('div');
      tabs.style.cssText = 'display:flex;gap:4px;justify-content:center';
      wars.forEach((w, i) => {
        const chip = document.createElement('button');
        chip.className = 'ctl';
        chip.style.cssText = `font-size:11px;padding:1px 8px;${i === warTab ? 'background:#d9576333;border-color:#d95763' : ''}`;
        chip.textContent = `⚔ ${(w as any).name ?? latest!.factions?.[w.attacker]?.name.split(' ')[0] ?? i}`;
        chip.addEventListener('click', () => { warTab = i; warStripKey = ''; renderWarStrip(); });
        tabs.appendChild(chip);
      });
      warStrip.appendChild(tabs);
    }
    for (const w of [wars[warTab]]) {
      const an = latest.factions?.[w.attacker]?.name ?? '?';
      const dn = latest.factions?.[w.defender]?.name ?? '?';
      const aTroops = squads.filter(q => q.factionId === w.attacker).reduce((a, q) => a + q.n, 0);
      const dTroops = squads.filter(q => q.factionId === w.defender).reduce((a, q) => a + q.n, 0);
      const cap = (w as any).captureProgress ?? 0;
      const row = document.createElement('div');
      row.className = 'war-row';
      const wName = (w as any).name;
      row.innerHTML =
        `<div class="hd"><span>⚔ ${wName ? `<b style="color:#d9a066">${wName}</b> · ` : ''}<span style="color:${FACTION_COLORS[w.attacker]}">${an}</span>` +
        ` vs <span style="color:${FACTION_COLORS[w.defender]}">${dn}</span></span>` +
        `<span style="color:#9badb7">goal: ${w.objective}</span></div>` +
        (cap > 0 ? `<div class="cap"><div style="width:${cap}%"></div></div>` : '') +
        `<div class="armies"><span>${aTroops} marching</span><span>${dTroops} defending</span></div>`;
      row.addEventListener('click', () => {
        // jump to the hottest point: a battle, else a marching banner, else target
        const hot = squads.find(q => q.state === 'fight' && (q.factionId === w.attacker || q.factionId === w.defender))
          ?? squads.find(q => (q as any).warId === w.id);
        const tgt = latest!.settlements.find(st2 => st2.id === (w as any).targetSettlement);
        const to = hot ?? tgt;
        if (to) flyTarget = { x: to.x, y: to.y };
      });
      warStrip.appendChild(row);
    }
  }

  // ---- timelapse export (M12, P4.3): centuries of border churn as webm ----
  let tlFrames: any[] = [];
  let tlRecording = false;

  function startTimelapse(): void {
    if (!latest || tlRecording) return;
    const to = latest.inPast ? latest.presentYear : latest.year;
    const from = Math.max(0, to - 200);
    tlFrames = [];
    tlRecording = true;
    seekStatus.textContent = `Filming ${to - from} years of history...`;
    seekStatus.style.display = 'block';
    worker.postMessage({ t: 'timelapse', fromYear: from, toYear: to, stepYears: 5 });
  }

  async function exportTimelapse(): Promise<void> {
    tlRecording = false;
    seekStatus.style.display = 'none';
    if (tlFrames.length < 2 || !renderer.terrain) return;
    const size = 360;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size + 24;
    const c = cv.getContext('2d')!;
    const N = renderer.terrain.map.size;
    const k = size / N;
    const stream = (cv as any).captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>(res => { rec.onstop = () => res(); });
    rec.start();
    for (const fr of tlFrames) {
      // terrain base
      c.imageSmoothingEnabled = false;
      if (minimapBase) c.drawImage(minimapBase, 0, 0, size, size);
      // territory wash: nearest living settlement claims the block
      const alive = fr.settlements.filter((st: any) => !st.razed);
      const B = 8;
      for (let by = 0; by < N / B; by++) {
        for (let bx = 0; bx < N / B; bx++) {
          const cx = bx * B + B / 2, cy = by * B + B / 2;
          let owner = -1, bestD = 60 * 60;
          for (const st of alive) {
            const dx = st.x - cx, dy = st.y - cy;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; owner = st.factionId; }
          }
          if (owner < 0) continue;
          c.globalAlpha = 0.4;
          c.fillStyle = FACTION_COLORS[owner] ?? '#fff';
          c.fillRect(bx * B * k, by * B * k, B * k + 1, B * k + 1);
          c.globalAlpha = 1;
        }
      }
      for (const st of alive) {
        c.fillStyle = FACTION_COLORS[st.factionId] ?? '#fff';
        c.fillRect(st.x * k - 2, st.y * k - 2, 4, 4);
      }
      for (const bt of fr.battles ?? []) {
        c.strokeStyle = '#d95763';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(bt.x * k - 3, bt.y * k - 3); c.lineTo(bt.x * k + 3, bt.y * k + 3);
        c.moveTo(bt.x * k + 3, bt.y * k - 3); c.lineTo(bt.x * k - 3, bt.y * k + 3);
        c.stroke();
      }
      c.fillStyle = '#14141f';
      c.fillRect(0, size, size, 24);
      c.fillStyle = '#cbdbfc';
      c.font = '13px system-ui';
      c.fillText(`${hudIsland.textContent} · Year ${fr.year}`, 8, size + 16);
      (track as any).requestFrame?.();
      await new Promise(r => setTimeout(r, 125));         // ~8 fps
    }
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chronica-${hudIsland.textContent}-timelapse.webm`;
    a.click();
    URL.revokeObjectURL(a.href);
    tlFrames = [];
  }

  // catch-up digest (11 §G3): after a time jump > 5 years, "previously on"
  const digestCard = document.getElementById('digest-card')!;
  let seekFromYear = -1;
  function showDigest(fromYear: number, toYear: number): void {
    const lo = Math.min(fromYear, toYear), hi = Math.max(fromYear, toYear);
    const span = majors.filter(ev => {
      const y = ev.tick / TICKS_PER_YEAR;
      return y > lo && y <= hi;
    }).sort((a, b) => b.severity - a.severity).slice(0, 4);
    if (span.length === 0) return;
    digestCard.innerHTML = `<h4>Meanwhile, ${hi - lo} years pass…</h4>` +
      `<span style="float:right;cursor:pointer;color:#9badb7;position:absolute;top:10px;right:12px" id="digest-close">✕</span>`;
    for (const ev of span) {
      const row = document.createElement('div');
      row.className = 'dg-row';
      const meta = eventMeta(ev.type);
      row.innerHTML = `<span style="color:${meta.color}">${meta.glyph}</span> ${ev.text.replace(/^Y\d+: /, `Y${Math.floor(ev.tick / TICKS_PER_YEAR)}: `)}`;
      row.addEventListener('click', () => {
        renderer.camera.cx = ev.x; renderer.camera.cy = ev.y;
        worker.postMessage({ t: 'chain', eventId: ev.id });
        digestCard.style.display = 'none';
      });
      digestCard.appendChild(row);
    }
    digestCard.style.display = 'block';
    document.getElementById('digest-close')!.addEventListener('click', () => {
      digestCard.style.display = 'none';
    });
    setTimeout(() => { digestCard.style.display = 'none'; }, 16000);
  }

  document.getElementById('btn-chron-export')!.addEventListener('click', exportBook);
  document.getElementById('btn-chron-font')!.addEventListener('click', () => {
    rail.classList.toggle('big-font');
    localStorage.setItem('chronica.bigfont', rail.classList.contains('big-font') ? '1' : '');
  });
  if (localStorage.getItem('chronica.bigfont')) rail.classList.add('big-font');

  function renderChronicle(msg: any): void {
    chronState = msg;
    chronLag.textContent = msg.lagYears > 3 ? `the chronicler is ${msg.lagYears} years behind` : '';
    if (msg.chapters.length === 0) {
      chronToc.innerHTML = '';
      chronBody.innerHTML = '<div id="chron-empty">The historian waits for something worth writing…</div>';
      return;
    }
    // TOC grouped by era
    const byEra = new Map<string, any[]>();
    for (const c of msg.chapters) {
      if (!byEra.has(c.era)) byEra.set(c.era, []);
      byEra.get(c.era)!.push(c);
    }
    chronToc.innerHTML = '';
    for (const [era, chs] of byEra) {
      const h = document.createElement('div');
      h.className = 'era-h';
      h.textContent = era;
      chronToc.appendChild(h);
      for (const c of chs) {
        const d = document.createElement('div');
        d.className = 'toc-ch';
        d.textContent = `${c.title}`;
        d.addEventListener('click', () => {
          document.getElementById(`ch-${c.id}`)?.scrollIntoView({ behavior: 'smooth' });
        });
        chronToc.appendChild(d);
      }
    }
    // body: full book, paragraph anchors clickable → time machine (the soul)
    chronBody.innerHTML = '';
    for (const c of msg.chapters) {
      const h = document.createElement('h4');
      h.id = `ch-${c.id}`;
      h.textContent = c.title;
      chronBody.appendChild(h);
      const meta = document.createElement('div');
      meta.className = 'ch-meta';
      meta.textContent = `${c.era} · Years ${c.yearStart}–${c.yearEnd}${c.source === 'template' ? ' · (chronicler’s notes)' : ''}`;
      chronBody.appendChild(meta);
      for (const p of c.paragraphs) {
        const el = document.createElement('p');
        el.textContent = p.text;
        el.title = `Travel to Year ${p.anchor.year}`;
        el.addEventListener('click', () => {
          renderer.camera.cx = p.anchor.x; renderer.camera.cy = p.anchor.y;
          if (renderer.camera.level < 2) renderer.camera.level = 2;
          doSeek(p.anchor.year);
        });
        chronBody.appendChild(el);
      }
    }
  }

  function exportBook(): void {
    const island = hudIsland.textContent ?? 'the Island';
    const year = latest?.presentYear ?? latest?.year ?? 0;
    const parts: string[] = [
      `<h1>The History of ${island}</h1>`,
      `<p style="color:#666">Years 1–${year}, as set down by the island's chroniclers.</p>`,
    ];
    let curEra = '';
    for (const c of chronState.chapters) {
      if (c.era !== curEra) { curEra = c.era; parts.push(`<h2>${curEra}</h2>`); }
      parts.push(`<h3>${c.title}</h3>`);
      parts.push(`<p style="color:#888;font-size:12px">Years ${c.yearStart}–${c.yearEnd}</p>`);
      for (const p of c.paragraphs) parts.push(`<p>${p.text}</p>`);
    }
    for (const era of chronState.eras) {
      parts.push(`<hr><p><i>${era.name} (${era.yearStart}–${era.yearEnd}): ${era.summary}</i></p>`);
    }
    const html = `<!doctype html><meta charset="utf-8"><title>The History of ${island}</title>
<body style="max-width:680px;margin:40px auto;font-family:Georgia,serif;line-height:1.7;padding:0 20px">
${parts.join('\n')}</body>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `history-of-${island}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // chronicler LLM lane: low priority; write only while the kings' queue idles
  async function narrateChapter(msg: any): Promise<void> {
    narrateBacklog.push(msg);
    void pumpNarration();
  }

  async function pumpNarration(): Promise<void> {
    if (narrating || narrateBacklog.length === 0) return;
    const brain = (brainQueue as any)?.['brain'] as any;
    const ollama = brain && brain.name === 'ollama' ? brain : null;
    if (!ollama || brainQueue?.status().mode !== 'llm') { narrateBacklog.length = 0; return; }
    if (brainQueue.status().inFlight && narrateWaits < 8) {
      narrateWaits++;
      setTimeout(() => void pumpNarration(), 2500);
      return;
    }
    narrateWaits = 0;
    const msg = narrateBacklog.shift()!;
    narrating = true;
    try {
      const res = await ollama.narrate({
        titleHint: msg.titleFallback,
        era: msg.era,
        yearStart: msg.draft.yearStart,
        yearEnd: msg.draft.yearEnd,
        facts: msg.facts,
        islandName: msg.islandName,
        retryNote: msg.retryNote,
      });
      worker.postMessage({ t: 'chapterProse', chapterId: msg.draft.id, title: res.title, paragraphs: res.paragraphs });
    } catch (err) {
      console.warn('chronicler narrate failed:', err);
    }
    narrating = false;
    void pumpNarration();
  }

  // ---- global search (07 §9): '/' ----
  const searchOverlay = document.getElementById('search-overlay')!;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchResults = document.getElementById('search-results')!;
  let searchIndex: any = null;

  function openSearch(): void {
    searchOverlay.style.display = 'flex';
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchInput.focus();
    worker.postMessage({ t: 'searchIndex' });
  }
  function closeSearch(): void { searchOverlay.style.display = 'none'; }
  searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });

  function searchIndexArrived(msg: any): void { searchIndex = msg; runSearch(); }
  searchInput.addEventListener('input', runSearch);

  function runSearch(): void {
    if (!searchIndex) return;
    const q = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML = '';
    if (q.length < 2) return;
    const results: { label: string; kind: string; act: () => void }[] = [];
    for (const c of searchIndex.characters) {
      if (!c.name.toLowerCase().includes(q)) continue;
      results.push({
        label: `${c.name}${c.dead ? ' †' : ''}, ${c.role}, ${c.faction}${c.lineage ? ` · line of ${c.lineage}` : ''}${c.kills > 2 ? ` · ${c.kills} kills` : ''}`,
        kind: 'character',
        act: () => {
          if (!c.dead && c.x >= 0) { renderer.camera.cx = c.x; renderer.camera.cy = c.y; renderer.camera.level = 2; worker.postMessage({ t: 'inspect', x: c.x, y: c.y }); }
          else if (c.deathEventId >= 0) worker.postMessage({ t: 'chain', eventId: c.deathEventId });
        },
      });
    }
    for (const p of searchIndex.places) {
      if (!p.name.toLowerCase().includes(q)) continue;
      results.push({
        label: `${p.name}${p.razed ? ' (ruins)' : ''}, ${p.faction}`,
        kind: 'place',
        act: () => { renderer.camera.cx = p.x; renderer.camera.cy = p.y; renderer.camera.level = 2; },
      });
    }
    for (const c of searchIndex.chapters) {
      if (!c.title.toLowerCase().includes(q) && !c.era.toLowerCase().includes(q)) continue;
      results.push({ label: `${c.title}: ${c.era}`, kind: 'chapter', act: () => openChronicle(c.id) });
    }
    for (const ev of searchIndex.events) {
      if (!ev.text.toLowerCase().includes(q)) continue;
      results.push({
        label: ev.text.slice(0, 70),
        kind: 'event',
        act: () => {
          renderer.camera.cx = ev.x; renderer.camera.cy = ev.y;
          doSeek(ev.tick / TICKS_PER_YEAR);
          worker.postMessage({ t: 'chain', eventId: ev.id });
        },
      });
    }
    for (const r of results.slice(0, 14)) {
      const el = document.createElement('div');
      el.className = 'sr';
      el.innerHTML = `<span>${r.label}</span><span class="kind">${r.kind}</span>`;
      el.addEventListener('click', () => { r.act(); closeSearch(); });
      searchResults.appendChild(el);
    }
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="sr"><span style="color:#9badb7">nothing found</span></div>';
    }
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
    // unread badge: new events land silently in the Events tab (11 §G3)
    const maxId = events.length > 0 ? events[events.length - 1].id : -1;
    if (lastSeenEventId >= 0) {
      const fresh = events.filter(ev => ev.id > lastSeenEventId).length;
      if (fresh > 0) {
        if (activeTab === 'events' && rail.classList.contains('open')) {
          if (performance.now() - lastEventsRequest > 3000) {
            worker.postMessage({ t: 'allEvents', minSeverity: 2 });
            lastEventsRequest = performance.now();
          }
        } else {
          evUnread += fresh;
          updateBadges();
        }
      }
    }
    lastSeenEventId = Math.max(lastSeenEventId, maxId);
    // bottom ticker shrinks to ONE latest line acting as an Events-tab button (11 §G1)
    feed.innerHTML = '';
    const ev = events[events.length - 1];
    if (!ev) return;
    const meta = eventMeta((ev as any).type ?? 0);
    const span = document.createElement('span');
    span.className = `ev sev${ev.severity}`;
    span.innerHTML = `<span style="color:${meta.color}">${meta.glyph}</span> Y${Math.floor(ev.tick / TICKS_PER_YEAR)}: ${ev.text.replace(/^Y\d+: /, '')} <span style="color:#639bff;margin-left:8px">‣ all events</span>`;
    span.addEventListener('click', () => openRail('events'));
    feed.appendChild(span);
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

  // ---- overlays (06/07): T/P/F/W, one at a time ----
  let overlayMode: '' | 'territory' | 'pop' | 'food' | 'war' = '';
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 128; overlayCanvas.height = 128;
  let overlayKey = '';

  function setOverlay(mode: typeof overlayMode): void {
    overlayMode = overlayMode === mode ? '' : mode;
    overlayKey = '';
    document.querySelectorAll<HTMLElement>('.ov').forEach(b => {
      b.classList.toggle('active', b.dataset.ov === overlayMode);
    });
    updateOverlayLegend();
  }

  // legend chip (C5): an active overlay always announces itself
  const overlayLegend = document.getElementById('overlay-legend')!;
  const ovTip = document.getElementById('ov-tip')!;
  let legendWarCount = -1;
  function updateOverlayLegend(): void {
    if (overlayMode === '') { overlayLegend.style.display = 'none'; return; }
    overlayLegend.style.display = 'block';
    const rows: string[] = [];
    const head = (name: string) => `<b style="letter-spacing:1px;font-size:10px;color:#9badb7">${name.toUpperCase()} OVERLAY</b>`;
    if (overlayMode === 'territory') {
      rows.push(head('territory'));
      for (const f of latest?.factions ?? []) {
        if (!f.extinct) rows.push(`<span style="color:${FACTION_COLORS[f.id]}">■</span> ${f.name}`);
      }
      if (rows.length === 1) rows.push('nothing to show right now');
    } else if (overlayMode === 'pop') {
      rows.push(head('population'), '<span style="color:#d9a066">■</span> each dot: people');
    } else if (overlayMode === 'food') {
      rows.push(head('food'), '<span style="color:#6abe30">●</span> fed settlement', '<span style="color:#d95763">●</span> hungry settlement');
    } else if (overlayMode === 'war') {
      rows.push(head('war'));
      const wars = latest?.wars ?? [];
      if (wars.length === 0) {
        rows.push('🕊 the island is at peace');
      } else {
        for (const w of wars) {
          const an = latest?.factions?.[w.attacker]?.name ?? '?';
          const dn = latest?.factions?.[w.defender]?.name ?? '?';
          rows.push(`<span style="color:#d95763">⚔</span> ${an} vs ${dn} · ${w.objective}`);
        }
      }
      rows.push('<span style="color:#8f563b">✕</span> recent battle site', '<span style="color:#9badb7">hover a border for grudges</span>');
    }
    overlayLegend.innerHTML = rows.join('<br>');
  }

  const DIPLO_NAMES = ['at war', 'hostile', 'neutral', 'trading', 'allied', 'vassal'];
  canvas.addEventListener('mousemove', (e) => {
    if (dragging) { ovTip.style.display = 'none'; return; }
    const rect0 = canvas.getBoundingClientRect();
    // scene captions (doc 13 V2): hovering a running show names it
    const cap = spectacle.hover(e.clientX - rect0.left, e.clientY - rect0.top, renderer.camera);
    if (cap) {
      ovTip.textContent = cap;
      ovTip.style.left = `${e.clientX + 14}px`;
      ovTip.style.top = `${e.clientY + 10}px`;
      ovTip.style.display = 'block';
      return;
    }
    if (overlayMode !== 'war' || !mapMode) { ovTip.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const hit = mapMode.borderAt(e.clientX - rect.left, e.clientY - rect.top, renderer.camera, 14);
    if (!hit) { ovTip.style.display = 'none'; return; }
    const pair = latest?.pairs?.find(p => p.a === hit.a && p.b === hit.b);
    if (!pair) { ovTip.style.display = 'none'; return; }
    const an = latest?.factions?.[pair.a]?.name ?? '?';
    const bn = latest?.factions?.[pair.b]?.name ?? '?';
    ovTip.innerHTML = `<b>${an}</b> · <b>${bn}</b><br>${DIPLO_NAMES[pair.diplo] ?? '?'} · grudge ${pair.grudge}`;
    ovTip.style.left = `${e.clientX + 14}px`;
    ovTip.style.top = `${e.clientY + 10}px`;
    ovTip.style.display = 'block';
  });
  document.querySelectorAll<HTMLElement>('.ov').forEach(b => {
    b.addEventListener('click', () => setOverlay(b.dataset.ov as typeof overlayMode));
  });

  function refreshOverlay(): void {
    if (!latest || !renderer.terrain || overlayMode === '' || overlayMode === 'war') return;
    const key = `${overlayMode}:${latest.settlements.map(s2 => `${s2.factionId}${s2.razed ? 'r' : ''}${s2.pop}`).join(',')}`;
    if (key === overlayKey) return;
    overlayKey = key;
    const octx = overlayCanvas.getContext('2d')!;
    octx.clearRect(0, 0, 128, 128);
    const N = renderer.terrain.map.size;
    const scale = 128 / N;
    if (overlayMode === 'territory') {
      const img = octx.createImageData(128, 128);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const wx = x / scale, wy = y / scale;
          const ti = Math.floor(wy) * N + Math.floor(wx);
          if (!isLandBiome(renderer.terrain.map.biome[ti])) continue;
          let best = -1, bestD = 60 * 60;
          for (const st of latest.settlements) {
            if (st.razed) continue;
            const dx = st.x - wx, dy = st.y - wy;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = st.factionId; }
          }
          if (best < 0) continue;
          const col = FACTION_COLORS[best] ?? '#fff';
          const o = (y * 128 + x) * 4;
          img.data[o] = parseInt(col.slice(1, 3), 16);
          img.data[o + 1] = parseInt(col.slice(3, 5), 16);
          img.data[o + 2] = parseInt(col.slice(5, 7), 16);
          img.data[o + 3] = 70;
        }
      }
      octx.putImageData(img, 0, 0);
    } else if (overlayMode === 'pop') {
      octx.fillStyle = '#d9a06655';
      const p = latest.pawns;
      for (let i = 0; i < p.count; i++) {
        if (!(p.flags[i] & 1)) continue;
        octx.fillRect(p.x[i] * scale - 1, p.y[i] * scale - 1, 2.5, 2.5);
      }
    } else if (overlayMode === 'food') {
      for (const st of latest.settlements) {
        if (st.razed) continue;
        const food = (st.stockpile?.[0] ?? 0) + (st.stockpile?.[1] ?? 0) + (st.stockpile?.[2] ?? 0);
        const perCap = st.pop > 0 ? food / st.pop : 99;
        const bad = perCap < 8;
        octx.fillStyle = bad ? '#d9576388' : '#6abe3055';
        octx.beginPath();
        octx.arc(st.x * scale, st.y * scale, Math.max(4, Math.sqrt(st.pop) * 0.9), 0, 7);
        octx.fill();
      }
    }
  }

  function drawOverlay(): void {
    if (overlayMode === '' || !renderer.terrain) return;
    const ctx = renderer.ctx;
    const cam = renderer.camera;
    // an active overlay always shows something (C5): unmistakable mode tint
    ctx.fillStyle = '#0b0b1226';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    if (overlayMode === 'war') {
      // war overlay v2 (C5): state layers first, live actors on top
      if (mapMode && latest) {
        const nowMs = performance.now();
        const battles: { x: number; y: number; age01: number }[] = [];
        const HORIZON = 5 * TICKS_PER_YEAR;
        for (const ev of majors) {
          if (ev.type !== 2 && ev.type !== 3) continue;      // BattleFought, SettlementRazed
          const age = latest.tick - ev.tick;
          if (age < 0 || age > HORIZON) continue;
          battles.push({ x: ev.x, y: ev.y, age01: age / HORIZON });
        }
        mapMode.drawWarOverlay(ctx, cam, {
          settlements: latest.settlements,
          factions: latest.factions ?? [],
          wars: latest.wars ?? [],
          battles,
        }, nowMs);
      }
      for (const sq of latest?.squads ?? []) {
        const [sx, sy] = cam.worldToScreen(sq.x, sq.y);
        ctx.font = `${Math.max(14, cam.pxPerTile)}px system-ui`;
        ctx.fillText(sq.state === 'fight' ? '⚔️' : sq.state === 'rout' ? '🏳' : '🚩', sx, sy);
      }
      return;
    }
    refreshOverlay();
    const N = renderer.terrain.map.size;
    const [sx, sy] = cam.worldToScreen(0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(overlayCanvas, sx, sy, N * cam.pxPerTile, N * cam.pxPerTile);
  }

  function isLandBiome(b: number): boolean {
    return b !== 0 && b !== 1 && b !== 2;
  }

  // ---- minimap (07 §7) ----
  const minimap = document.getElementById('minimap') as HTMLCanvasElement;
  let minimapBase: HTMLCanvasElement | null = null;
  function bakeMinimap(): void {
    if (!renderer.terrain) return;
    const m = renderer.terrain.map;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const cctx = c.getContext('2d')!;
    const img = cctx.createImageData(128, 128);
    const step = m.size / 128;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const i = Math.floor(y * step) * m.size + Math.floor(x * step);
        const [r, g, b] = tileColor(m as any, i, x, y);
        const o = (y * 128 + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    cctx.putImageData(img, 0, 0);
    minimapBase = c;
  }
  function drawMinimap(): void {
    if (!minimapBase || !renderer.terrain) return;
    const mctx = minimap.getContext('2d')!;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(minimapBase, 0, 0, 140, 140);
    const N = renderer.terrain.map.size;
    const k = 140 / N;
    // settlements
    for (const st of latest?.settlements ?? []) {
      if (st.razed) continue;
      mctx.fillStyle = FACTION_COLORS[st.factionId] ?? '#fff';
      mctx.fillRect(st.x * k - 1, st.y * k - 1, 3, 3);
    }
    // war markers
    for (const sq of latest?.squads ?? []) {
      if (sq.state !== 'fight') continue;
      mctx.fillStyle = '#d95763';
      mctx.fillRect(sq.x * k - 2, sq.y * k - 2, 4, 4);
    }
    // beacon echo pings (H3): same event, same color, pulsing
    const pulse = 2 + 1.6 * (0.5 + 0.5 * Math.sin(performance.now() / 280));
    for (const p of beacons.pings()) {
      mctx.strokeStyle = p.color;
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(p.x * k, p.y * k, pulse, 0, 7);
      mctx.stroke();
    }
    // camera rect
    const cam = renderer.camera;
    const w = cam.viewW / cam.pxPerTile * k, h = cam.viewH / cam.pxPerTile * k;
    mctx.strokeStyle = '#cbdbfc';
    mctx.strokeRect(cam.cx * k - w / 2, cam.cy * k - h / 2, w, h);
  }
  minimap.addEventListener('click', (e) => {
    if (!renderer.terrain) return;
    const rect = minimap.getBoundingClientRect();
    const N = renderer.terrain.map.size;
    renderer.camera.cx = (e.clientX - rect.left) / rect.width * N;
    renderer.camera.cy = (e.clientY - rect.top) / rect.height * N;
  });

  // ---- postcard mode + screenshot (06) ----
  const postcardCaption = document.getElementById('postcard-caption')!;
  function togglePostcard(): void {
    document.body.classList.toggle('postcard');
    if (document.body.classList.contains('postcard') && latest) {
      postcardCaption.textContent = `${hudIsland.textContent} · Year ${latest.year}`;
    }
  }
  function screenshot(): void {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `chronica-${hudIsland.textContent}-y${latest?.year ?? 0}.png`;
    a.click();
  }

  // ---- A1: background tab; sim continues at 1× (deliberate default) ----
  let prePauseSpeed = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!paused && speed > 1) {
        prePauseSpeed = speed;
        worker.postMessage({ t: 'speed', ticksPerSec: 10 });
      }
    } else if (prePauseSpeed > 0) {
      prePauseSpeed = 0;
      applySpeed();
    }
  });

  // ---- progressive onboarding hints (07): contextual, lazy, dismissible ----
  const hintEl = document.getElementById('hint')!;
  const seenHints = new Set<string>(JSON.parse(localStorage.getItem('chronica.hints') ?? '[]'));
  function showHint(key: string, text: string): void {
    if (seenHints.has(key) || localStorage.getItem('chronica.nohints')) return;
    seenHints.add(key);
    localStorage.setItem('chronica.hints', JSON.stringify([...seenHints]));
    hintEl.innerHTML = `${text} <span style="color:#9badb7;cursor:pointer;margin-left:8px" id="hint-x">dismiss</span>`;
    hintEl.style.display = 'block';
    document.getElementById('hint-x')!.addEventListener('click', () => { hintEl.style.display = 'none'; });
    setTimeout(() => { hintEl.style.display = 'none'; }, 12000);
  }
  setTimeout(() => showHint('welcome', '⏯ Space pauses · 1/2/3 sets speed · drag to pan, wheel to zoom.'), 4000);
  setTimeout(() => showHint('feed', '⚔ When something happens, click it in the feed below to see WHY.'), 45000);
  setTimeout(() => showHint('chronicle', '📖 Press C to read the history book your world is writing.'), 90000);
  setTimeout(() => showHint('timeline', '⏪ Click anywhere on the timeline to travel back in time.'), 150000);

  // ---- render loop ----
  let lastT = performance.now();
  function frame(now: number): void {
    const dt = now - lastT; lastT = now;
    // eased camera pan toward a clicked beacon/arrow (H2: no hard teleports)
    if (flyTarget) {
      const cam = renderer.camera;
      const k = 1 - Math.pow(0.002, dt / 600);
      cam.cx += (flyTarget.x - cam.cx) * k;
      cam.cy += (flyTarget.y - cam.cy) * k;
      if (Math.abs(flyTarget.x - cam.cx) < 0.8 && Math.abs(flyTarget.y - cam.cy) < 0.8) flyTarget = null;
    }
    renderer.camera.update(dt);
    renderer.drawTerrain();
    drawOverlay();
    drawDynamic();
    if (latest) {
      watchStarred();
      // the show (doc 13 V2): scenes first, beacons/pins above them
      spectacle.update(majors as any, latest.tick, now, speed);
      spectacle.draw(renderer.ctx, renderer.camera, now);
      beacons.update(majors, latest.tick, now, latest.inPast);
      beacons.draw(renderer.ctx, renderer.camera, now);
      beacons.drawArrows(renderer.ctx, renderer.camera, now);
      spectacle.drawOverlay(renderer.ctx, renderer.camera);
      // camera shake rides a CSS transform: sim canvas only, no state drift
      canvas.style.transform = spectacle.shake > 0.05
        ? `translate(${(Math.random() - 0.5) * spectacle.shake * 2}px, ${(Math.random() - 0.5) * spectacle.shake * 2}px)`
        : '';
    }
    drawTimeline();
    drawMinimap();
    if (latest) {
      hudYear.textContent = `Year ${latest.year}`;
      yearLabel.textContent = `Year ${latest.year}`;
      hudPop.textContent = `${latest.alive} souls`;
    }
    if (now - lastFeedPoll > 900) {
      lastFeedPoll = now;
      worker.postMessage({ t: 'recentFeed', minSeverity: 2 });
    }
    if (now - lastStatsPoll > 5000) {
      lastStatsPoll = now;
      worker.postMessage({ t: 'stats' });
    }
    if (now - lastFarmsPoll > 2000 && renderer.camera.pxPerTile >= 8) {
      lastFarmsPoll = now;
      worker.postMessage({ t: 'farms' });
    }
    // war overlay legend tracks wars starting/ending while active
    if (overlayMode === 'war' && latest && (latest.wars?.length ?? 0) !== legendWarCount) {
      legendWarCount = latest.wars?.length ?? 0;
      updateOverlayLegend();
    }
    renderWarStrip();
    requestAnimationFrame(frame);
  }

  function drawDynamic(): void {
    if (!latest || !renderer.terrain) return;
    const ctx = renderer.ctx;
    const cam = renderer.camera;
    // zoom contract (11 §D3): <=4 px/tile map mode, 16 hybrid, 32 full detail;
    // crossfade rides the camera's eased pxPerTile so the world feels continuous
    const px = cam.pxPerTile;
    const mapAlpha = px <= 4.5 ? 1 : px >= 12 ? 0 : (12 - px) / 7.5;
    const detailAlpha = 1 - mapAlpha;
    ctx.globalAlpha = detailAlpha;
    // crops breathe with the year (M10, 11 §B2): furrows → shoots → gold → stubble
    if (detailAlpha > 0.01 && cam.pxPerTile >= 8) {
      const px2 = cam.pxPerTile;
      for (let i = 0; i + 2 < farms.length; i += 3) {
        const [sx, sy] = cam.worldToScreen(farms[i], farms[i + 1]);
        if (sx < -px2 || sy < -px2 || sx > cam.viewW || sy > cam.viewH) continue;
        const stage = farms[i + 2];
        if (stage === 0) {
          ctx.fillStyle = '#66393155';
          ctx.fillRect(Math.round(sx), Math.round(sy + px2 / 3), Math.round(px2), 1);
          ctx.fillRect(Math.round(sx), Math.round(sy + (px2 * 2) / 3), Math.round(px2), 1);
        } else {
          ctx.fillStyle = stage >= 200 ? '#fbf236' : stage >= 100 ? '#6abe30' : '#99e55088';
          const h = Math.max(1, (px2 * Math.min(200, stage)) / 500);
          for (let dx = 1; dx < px2 - 1; dx += 3) {
            ctx.fillRect(Math.round(sx + dx), Math.round(sy + px2 - 1 - h), 1, Math.round(h));
          }
        }
      }
    }
    // buildings (M10, 11 §B1): race-flavored sprites at Local zoom,
    // colored blocks at hybrid zoom, scaffold overlay while under construction
    if (detailAlpha > 0.01 && cam.pxPerTile >= 4) {
      const useSpritesB = cam.pxPerTile >= 16;
      for (const st of latest.settlements) {
        if (st.razed) continue;
        const race = latest.factions?.[st.factionId]?.race ?? 0;
        for (const b of st.buildings) {
          const [sx, sy] = cam.worldToScreen(b.x, b.y);
          if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
          if (useSpritesB) {
            const cell = buildingAtlas.index[`${race}:${b.kind}`];
            if (cell) {
              const sc = cam.pxPerTile / BUILDING_CELL;
              ctx.drawImage(buildingAtlas.canvas as CanvasImageSource,
                cell.x, cell.y, BUILDING_CELL, BUILDING_CELL,
                Math.round(sx), Math.round(sy), Math.round(BUILDING_CELL * sc), Math.round(BUILDING_CELL * sc));
              if (b.stage < 3) {
                const sca = buildingAtlas.index['scaffold'];
                ctx.drawImage(buildingAtlas.canvas as CanvasImageSource,
                  sca.x, sca.y, BUILDING_CELL, BUILDING_CELL,
                  Math.round(sx), Math.round(sy), Math.round(BUILDING_CELL * sc), Math.round(BUILDING_CELL * sc));
              }
              continue;
            }
          }
          const sz = Math.max(2, cam.pxPerTile * (b.stage === 3 ? 0.9 : 0.4 + b.stage * 0.15));
          ctx.fillStyle = b.kind === 1 ? '#8a6f30' : b.kind === 2 ? '#847e87' : '#663931';
          ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(sz), Math.round(sz));
        }
      }
    }
    // settlement markers (hybrid/local zoom; map mode owns far zoom)
    if (detailAlpha > 0.01) for (const st of latest.settlements) {
      if (st.razed) continue;
      const [sx, sy] = cam.worldToScreen(st.x + 0.5, st.y + 0.5);
      if (sx < -20 || sy < -20 || sx > cam.viewW + 20 || sy > cam.viewH + 20) continue;
      ctx.fillStyle = FACTION_COLORS[st.factionId] ?? '#fff';
      const r = Math.max(3, cam.pxPerTile * 0.6);
      ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - r / 2), Math.round(r), Math.round(r));
      if (cam.pxPerTile >= 4) {
        ctx.fillStyle = '#cbdbfc';
        ctx.font = '11px system-ui';
        ctx.fillText(st.name, Math.round(sx + r), Math.round(sy - 4));
      }
    }
    // squads as banner units (11 §A1): faction flag, morale = flag fullness,
    // soldier-count badge; battle dust + swords at engagements (A2)
    if (detailAlpha > 0.01) for (const sq of latest.squads ?? []) {
      const [sx, sy] = cam.worldToScreen(sq.x, sq.y);
      if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 30) continue;
      const h2 = Math.max(10, cam.pxPerTile * 0.9);
      const morale01 = Math.min(1, (sq.morale ?? 235) / 235);
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(Math.round(sx), Math.round(sy - h2), 2, Math.round(h2));
      ctx.fillStyle = FACTION_COLORS[sq.factionId] ?? '#fff';
      // a fresh host flies a full flag; a shaken one, a tattered sliver
      ctx.fillRect(Math.round(sx + 2), Math.round(sy - h2),
        Math.round(Math.max(3, h2 * 0.7 * morale01)), Math.round(h2 * 0.35));
      ctx.font = '10px system-ui';
      ctx.fillStyle = '#14141fc8';
      const cnt = String(sq.n);
      ctx.fillRect(Math.round(sx) - 2, Math.round(sy) + 2, ctx.measureText(cnt).width + 5, 12);
      ctx.fillStyle = '#cbdbfc';
      ctx.fillText(cnt, Math.round(sx), Math.round(sy) + 11);
      if (sq.state === 'fight') {
        // dust of battle: breathing haze under the clash icon
        const puff = 6 + 3 * Math.sin(performance.now() / 180 + sq.x);
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#847e87';
        ctx.beginPath(); ctx.arc(sx + 4, sy - 2, puff + 6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = `${Math.max(12, cam.pxPerTile)}px system-ui`;
        ctx.fillText('⚔️', sx - 6, sy - h2 - 2);
      }
      if (sq.state === 'siege') {
        ctx.font = `${Math.max(12, cam.pxPerTile * 0.8)}px system-ui`;
        ctx.fillText('🏰', sx - 6, sy - h2 - 2);
      }
    }
    // aftermath (11 §A5): razed sites smolder for ~2 years of sim time,
    // derived from the event log so time-machine scrubs replay the smoke
    if (detailAlpha > 0.01) for (const ev of majors) {
      if (ev.type !== 3) continue;                       // SettlementRazed
      const age = latest.tick - ev.tick;
      if (age < 0 || age > 2 * TICKS_PER_YEAR) continue;
      const [sx, sy] = cam.worldToScreen(ev.x + 0.5, ev.y + 0.5);
      if (sx < -40 || sy < -40 || sx > cam.viewW + 40 || sy > cam.viewH + 40) continue;
      const fade = 1 - age / (2 * TICKS_PER_YEAR);
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = '#000000';
      ctx.fillRect(Math.round(sx - cam.pxPerTile * 2), Math.round(sy - cam.pxPerTile), Math.round(cam.pxPerTile * 4), Math.round(cam.pxPerTile * 2));
      for (let p = 0; p < 3; p++) {
        const t = (performance.now() / 900 + p * 0.33) % 1;
        ctx.globalAlpha = 0.4 * fade * (1 - t);
        ctx.fillStyle = '#222034';
        const r = 3 + t * 7;
        ctx.beginPath();
        ctx.arc(sx + (p - 1) * 6 + Math.sin(t * 6 + p) * 3, sy - 6 - t * 26, r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = detailAlpha;
    }
    for (const c of latest.caravans ?? []) {
      const [sx, sy] = cam.worldToScreen(c.x, c.y);
      if (sx < -10 || sy < -10 || sx > cam.viewW + 10 || sy > cam.viewH + 10) continue;
      ctx.fillStyle = '#d9a066';
      const r = Math.max(2, cam.pxPerTile * 0.4);
      ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - r / 2), Math.round(r), Math.round(r * 0.7));
      ctx.fillStyle = FACTION_COLORS[c.factionId] ?? '#fff';
      ctx.fillRect(Math.round(sx - r / 2), Math.round(sy - r), Math.round(r * 0.5), Math.round(r * 0.4));
    }
    for (const m of latest.monsters ?? []) {
      const [sx, sy] = cam.worldToScreen(m.x, m.y);
      if (sx < -30 || sy < -30 || sx > cam.viewW + 30 || sy > cam.viewH + 30) continue;
      ctx.font = `${Math.max(14, cam.pxPerTile * (m.kind === 'dragon' ? 1.6 : 1))}px system-ui`;
      ctx.fillText(m.kind === 'dragon' ? '🐉' : m.kind === 'troll' ? '🧌' : '🐺', sx, sy);
    }

    // pawns: dots at region zoom, sprites at local/close
    if (detailAlpha > 0.01 && cam.pxPerTile >= 4) {
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
            // work animation (M10, 11 §B3): laborers bob with their tools
            const bob = job !== 'none' ? (performance.now() >> 8) & 1 : 0;
            ctx.drawImage(atlas.canvas as CanvasImageSource, cell.x, cell.y, SPRITE_W, SPRITE_H,
              Math.round(sx - SPRITE_W * spriteScale / 2), Math.round(sy - SPRITE_H * spriteScale + 2 - bob),
              SPRITE_W * spriteScale, SPRITE_H * spriteScale);
          }
        } else {
          ctx.fillStyle = ['#cbdbfc', '#99e550', '#eec39a', '#d95763'][p.factionId[i]] ?? '#fff';
          ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
    // far-zoom map mode layer (11 §D): fades in as detail fades out
    if (mapMode && mapAlpha > 0.01) {
      mapMode.draw(ctx, cam, mapIcons, {
        settlements: latest.settlements,
        squads: latest.squads ?? [],
        factions: latest.factions ?? [],
        wars: latest.wars ?? [],
        caravans: latest.caravans ?? [],
        monsters: latest.monsters ?? [],
      }, mapAlpha, performance.now());
    }
  }

  requestAnimationFrame(frame);

  // test/debug handle (used by Playwright checks)
  (window as any).__chronica = {
    renderer, worker, beacons, spectacle,
    getLatest: () => latest,
    getMajors: () => majors,
    openRail,
    goto: (x: number, y: number, level?: number) => {
      renderer.camera.cx = x; renderer.camera.cy = y;
      if (level !== undefined) renderer.camera.level = level as 0 | 1 | 2 | 3;
    },
    seek: (year: number) => doSeek(year),
  };
}
