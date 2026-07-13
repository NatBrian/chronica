// World statistics (11 §I1): hand-rolled canvas line charts over YearStats.
// Zero-dep rule holds: a line chart is ~40 lines. Charts share the era-band
// color language with timeline v2, and clicking any chart seeks the time
// machine to that year.
import { FACTION_HEX } from '../render/palette';
import { eraColor } from './eventMeta';

export interface StatsData {
  years: number[];
  pop: number[][];
  food: number[][];
  territory: number[][];
  warTicks: number[];
}
export interface Era { name: string; yearStart: number; yearEnd: number }

interface ChartSpec {
  title: string;
  series: (d: StatsData) => number[][];
  /** transform a series value given the same-index pop value (per-capita etc.) */
  value?: (v: number, pop: number) => number;
  bandLow?: number;            // shade region under this value (famine band)
}

const CHARTS: ChartSpec[] = [
  { title: 'population', series: d => d.pop },
  { title: 'settlements held', series: d => d.territory },
  // capped: the Year-1 spike (huge stock / tiny pop) would flatten the rest
  { title: 'food per capita', series: d => d.food, value: (v, p) => Math.min(40, p > 0 ? v / p : 0), bandLow: 8 },
];

const CH_H = 96, PAD_L = 34, PAD_B = 14;

export class StatsPanel {
  private data: StatsData | null = null;
  private canvases: HTMLCanvasElement[] = [];
  private ribbon: HTMLCanvasElement;
  private hoverYear = -1;

  constructor(
    private container: HTMLElement,
    private opts: {
      factionName: (f: number) => string;
      eras: () => Era[];
      onSeek: (year: number) => void;
    },
  ) {
    container.innerHTML = '';
    const legend = document.createElement('div');
    legend.id = 'stats-legend';
    legend.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#9badb7;margin-bottom:6px';
    container.appendChild(legend);
    for (const spec of CHARTS) {
      const title = document.createElement('div');
      title.textContent = spec.title;
      title.style.cssText = 'color:#9badb7;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:10px 0 2px';
      container.appendChild(title);
      const cv = document.createElement('canvas');
      cv.height = CH_H;
      cv.style.cssText = 'width:100%;display:block;background:#14141f;border-radius:4px;cursor:crosshair';
      container.appendChild(cv);
      this.attach(cv);
      this.canvases.push(cv);
    }
    const rt = document.createElement('div');
    rt.textContent = 'war intensity';
    rt.style.cssText = 'color:#9badb7;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:10px 0 2px';
    container.appendChild(rt);
    this.ribbon = document.createElement('canvas');
    this.ribbon.height = 16;
    this.ribbon.style.cssText = 'width:100%;display:block;background:#14141f;border-radius:4px;cursor:crosshair';
    container.appendChild(this.ribbon);
    this.attach(this.ribbon);
    const tip = document.createElement('div');
    tip.id = 'stats-tip';
    tip.style.cssText = 'font-size:12px;color:#9badb7;margin-top:8px;min-height:32px';
    container.appendChild(tip);
  }

  private attach(cv: HTMLCanvasElement): void {
    cv.addEventListener('mousemove', (e) => {
      if (!this.data || this.data.years.length === 0) return;
      const rect = cv.getBoundingClientRect();
      const frac = (e.clientX - rect.left - PAD_L) / Math.max(1, rect.width - PAD_L);
      const i = Math.round(frac * (this.data.years.length - 1));
      this.hoverYear = this.data.years[Math.max(0, Math.min(this.data.years.length - 1, i))];
      this.render();
    });
    cv.addEventListener('mouseleave', () => { this.hoverYear = -1; this.render(); });
    cv.addEventListener('click', () => {
      if (this.hoverYear >= 0) this.opts.onSeek(this.hoverYear);
    });
  }

  setData(d: StatsData): void {
    this.data = d;
    this.render();
  }

  render(): void {
    const d = this.data;
    if (!d || d.years.length === 0) return;
    const legend = this.container.querySelector('#stats-legend')!;
    legend.innerHTML = d.pop.map((_, f) =>
      `<span><span style="color:${FACTION_HEX[f]}">■</span> ${this.opts.factionName(f)}</span>`).join('');
    const n = d.years.length;
    const y0 = d.years[0], y1 = d.years[n - 1];
    const eras = this.opts.eras();
    CHARTS.forEach((spec, ci) => {
      const cv = this.canvases[ci];
      cv.width = cv.clientWidth || 340;
      const W = cv.width, H = cv.height;
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      const X = (i: number) => PAD_L + ((d.years[i] - y0) / Math.max(1, y1 - y0)) * (W - PAD_L - 2);
      // era bands as chart background: charts and timeline speak one language
      eras.forEach((era, i) => {
        const ex0 = PAD_L + ((era.yearStart - y0) / Math.max(1, y1 - y0)) * (W - PAD_L - 2);
        const ex1 = PAD_L + ((era.yearEnd - y0) / Math.max(1, y1 - y0)) * (W - PAD_L - 2);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = eraColor(i);
        ctx.fillRect(Math.max(PAD_L, ex0), 0, Math.min(W, ex1) - Math.max(PAD_L, ex0), H - PAD_B);
        ctx.globalAlpha = 1;
      });
      const raw = spec.series(d);
      const val = (f: number, i: number) => spec.value ? spec.value(raw[f][i], d.pop[f][i]) : raw[f][i];
      let max = 1;
      for (let f = 0; f < raw.length; f++) for (let i = 0; i < n; i++) max = Math.max(max, val(f, i));
      const Y = (v: number) => (H - PAD_B) - (v / max) * (H - PAD_B - 6);
      if (spec.bandLow !== undefined) {
        ctx.fillStyle = '#d9576318';
        ctx.fillRect(PAD_L, Y(spec.bandLow), W - PAD_L, (H - PAD_B) - Y(spec.bandLow));
      }
      for (let f = 0; f < raw.length; f++) {
        ctx.strokeStyle = FACTION_HEX[f] ?? '#fff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = X(i), y = Y(val(f, i));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // axes labels: max value + year range
      ctx.fillStyle = '#9badb7';
      ctx.font = '9px system-ui';
      ctx.fillText(String(Math.round(max)), 2, 10);
      ctx.fillText(`Y${y0}`, PAD_L, H - 3);
      ctx.fillText(`Y${y1}`, W - 30, H - 3);
      // hover crosshair
      if (this.hoverYear >= 0) {
        const hx = PAD_L + ((this.hoverYear - y0) / Math.max(1, y1 - y0)) * (W - PAD_L - 2);
        ctx.strokeStyle = '#cbdbfc88';
        ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H - PAD_B); ctx.stroke();
      }
    });
    // war-intensity heat ribbon: aligns with the pop dips above (11 §I1)
    const rb = this.ribbon;
    rb.width = rb.clientWidth || 340;
    const rctx = rb.getContext('2d')!;
    rctx.clearRect(0, 0, rb.width, rb.height);
    const maxWar = Math.max(1, ...d.warTicks);
    for (let i = 0; i < n; i++) {
      const x = PAD_L + ((d.years[i] - y0) / Math.max(1, y1 - y0)) * (rb.width - PAD_L - 2);
      const heat = d.warTicks[i] / maxWar;
      if (heat <= 0) continue;
      rctx.fillStyle = `rgba(217,87,99,${0.15 + heat * 0.85})`;
      rctx.fillRect(x, 2, Math.max(1, (rb.width - PAD_L) / n), rb.height - 4);
    }
    // hover tooltip values
    const tip = this.container.querySelector('#stats-tip')!;
    if (this.hoverYear >= 0) {
      const i = d.years.indexOf(this.hoverYear);
      if (i >= 0) {
        tip.innerHTML = `<b style="color:#cbdbfc">Year ${this.hoverYear}</b> · click to travel<br>` +
          d.pop.map((_, f) =>
            `<span style="color:${FACTION_HEX[f]}">${this.opts.factionName(f)}</span> ${d.pop[f][i]}`,
          ).join(' · ');
      }
    } else {
      tip.textContent = 'hover for values · click any chart to time-travel there';
    }
  }
}
