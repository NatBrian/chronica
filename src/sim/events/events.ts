// Event log + causality DAG (04 §Causality). Severity thresholds keep it sparse.
import { EventType, WorldEvent } from '../../shared/types';
import { SimState } from '../state';

export interface EmitOpts {
  type: EventType;
  actors?: number[];
  factions?: number[];
  x?: number; y?: number;
  causes?: number[];
  severity: number;
  text: string;
  data?: Record<string, number | string>;
}

export function emitEvent(s: SimState, opts: EmitOpts): WorldEvent {
  const ev: WorldEvent = {
    id: s.nextEventId++,
    tick: s.tick,
    type: opts.type,
    actors: opts.actors ?? [],
    factions: opts.factions ?? [],
    x: opts.x ?? 0, y: opts.y ?? 0,
    causes: opts.causes ?? [],
    severity: opts.severity,
    text: opts.text,
    ...(opts.data ? { data: opts.data } : {}),
  };
  s.events.push(ev);
  return ev;
}

/** Most recent events of given types involving a faction — for digests & causes. */
export function recentEvents(s: SimState, factionId: number, sinceTicks: number, max = 8): WorldEvent[] {
  const out: WorldEvent[] = [];
  const cutoff = s.tick - sinceTicks;
  for (let i = s.events.length - 1; i >= 0 && out.length < max; i--) {
    const ev = s.events[i];
    if (ev.tick < cutoff) break;
    if (ev.factions.includes(factionId)) out.push(ev);
  }
  return out;
}

export function yearOf(tick: number): number {
  return Math.floor(tick / 360);
}
