// THE fixed system order (01 §Tick loop). Reordering is a save-breaking change.
import { Journal } from '../../shared/types';
import { SimState } from '../state';
import { calendarSystem } from './calendarSystem';
import { weatherSystem } from './weatherSystem';
import { cropSystem } from './cropSystem';
import { needsSystem } from './needsSystem';
import { brainInboxSystem } from './brainInboxSystem';
import { utilityAISystem } from './utilityAISystem';
import { pathMoveSystem } from './pathMoveSystem';
import { workSystem } from './workSystem';
import { combatSystem } from './combatSystem';
import { birthDeathSystem } from './birthDeathSystem';
import { factionSystem } from './factionSystem';
import { economySystem } from './economySystem';
import { injectorSystem } from './injectorSystem';
import { eventDetectSystem } from './eventDetectSystem';

export interface SystemCtx { journal: Journal }

export type System = (s: SimState, ctx: SystemCtx) => void;

export const SYSTEMS: System[] = [
  calendarSystem,     // 1 season/year rollover
  weatherSystem,      // 2 rain, drought, winter severity
  (s) => cropSystem(s),           // 3
  (s) => needsSystem(s),          // 4
  brainInboxSystem,               // 5 apply journaled decisions
  (s) => utilityAISystem(s),      // 6
  (s) => pathMoveSystem(s),       // 7
  (s) => workSystem(s),           // 8
  (s) => combatSystem(s),         // 9
  (s) => birthDeathSystem(s),     // 10
  (s) => factionSystem(s),        // 11
  (s) => economySystem(s),        // 12
  (s) => injectorSystem(s),       // 12.5 pressure injectors (M6)
  (s) => eventDetectSystem(s),    // 13
  // 14 lodSystem        (M6)
  // 15 snapshotSystem — keyframes handled by engine cadence
];
