// System 2: weather: yearly drought level + winter severity from seeded stream.
// Injector-scheduled disasters (M6) also land here.
import { EventType, TICKS_PER_YEAR } from '../../shared/types';
import { SimState } from '../state';
import { emitEvent, yearOf } from '../events/events';

export function weatherSystem(s: SimState): void {
  if (s.tick % TICKS_PER_YEAR !== 0) return;
  const rng = s.rng.get('weather');
  const year = yearOf(s.tick);
  // drought: 0 normal, 100..200 = drought year (injector cadence keeps rare)
  const droughtRoll = rng.int(100);
  if (s.config.injectors && droughtRoll < 7 && year > 3) {
    s.weather.drought = 120 + rng.int(80);
    emitEvent(s, {
      type: EventType.Drought, severity: 3,
      factions: [0, 1, 2, 3],
      text: `Y${year}: A great drought grips the land. Rivers thin and fields crack.`,
    });
  } else {
    s.weather.drought = 0;
  }
  // winter severity 60..160 (100 = normal); harsh winters are events
  const w = 70 + rng.int(70);
  if (s.config.injectors && rng.int(100) < 6 && year > 2) {
    s.weather.winterSeverity = 170 + rng.int(50);
    emitEvent(s, {
      type: EventType.HarshWinter, severity: 3,
      factions: [0, 1, 2, 3],
      text: `Y${year}: Elders read the signs; the coming winter will be merciless.`,
    });
  } else {
    s.weather.winterSeverity = w;
  }
}
