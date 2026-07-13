// THE fixed system order (01 §Tick loop). Reordering is a save-breaking change.
import { Journal } from '../../shared/types';
import { SimState } from '../state';
import { calendarSystem } from './calendarSystem';
import { weatherSystem } from './weatherSystem';

export interface SystemCtx { journal: Journal }

export type System = (s: SimState, ctx: SystemCtx) => void;

export const SYSTEMS: System[] = [
  calendarSystem,     // 1 season/year rollover
  weatherSystem,      // 2 rain, drought, winter severity
  // 3 cropSystem        (M2)
  // 4 needsSystem       (M1)
  // 5 brainInboxSystem  (M3/M4)
  // 6 utilityAISystem   (M1)
  // 7 pathMoveSystem    (M1)
  // 8 workSystem        (M2)
  // 9 combatSystem      (M3)
  // 10 birthDeathSystem (M1)
  // 11 factionSystem    (M3)
  // 12 economySystem    (M3)
  // 13 eventDetectSystem(M3)
  // 14 lodSystem        (M6)
  // 15 snapshotSystem — keyframes handled by engine cadence
];

export function registerSystems(systems: System[]): void {
  SYSTEMS.length = 0;
  SYSTEMS.push(...systems);
}
