// THE fixed system order (01 §Tick loop). Reordering is a save-breaking change.
import { Journal } from '../../shared/types';
import { SimState } from '../state';
import { calendarSystem } from './calendarSystem';
import { weatherSystem } from './weatherSystem';
import { needsSystem } from './needsSystem';
import { utilityAISystem } from './utilityAISystem';
import { pathMoveSystem } from './pathMoveSystem';
import { workSystem } from './workSystem';
import { birthDeathSystem } from './birthDeathSystem';

export interface SystemCtx { journal: Journal }

export type System = (s: SimState, ctx: SystemCtx) => void;

export const SYSTEMS: System[] = [
  calendarSystem,     // 1 season/year rollover
  weatherSystem,      // 2 rain, drought, winter severity
  // 3 cropSystem        (M2)
  (s) => needsSystem(s),      // 4
  // 5 brainInboxSystem  (M3/M4)
  (s) => utilityAISystem(s),  // 6
  (s) => pathMoveSystem(s),   // 7
  (s) => workSystem(s),       // 8
  // 9 combatSystem      (M3)
  (s) => birthDeathSystem(s), // 10
  // 11 factionSystem    (M3)
  // 12 economySystem    (M3)
  // 13 eventDetectSystem(M3)
  // 14 lodSystem        (M6)
  // 15 snapshotSystem — keyframes handled by engine cadence
];
