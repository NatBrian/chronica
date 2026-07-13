// System 5: apply journaled decisions at their scheduled tick (01).
// Dead-actor voiding, uniform decision window, deterministic deadline
// fallback: if no journal entry exists for a due request, RuleBrain decides
// and the entry is appended; live runs and replays are bit-identical.
import { JournalEntry } from '../../shared/types';
import { SimState } from '../state';
import { SystemCtx } from './index';
import { applyDecision, pushMemory } from '../rules/decisions';
import { ruleBrainDecide } from '../rules/ruleBrain';
import { yearOf } from '../events/events';

export function brainInboxSystem(s: SimState, ctx: SystemCtx): void {
  if (s.pending.length === 0) return;
  const due = s.pending.filter(p => p.applyAtTick <= s.tick);
  if (due.length === 0) return;

  for (const req of due) {
    // find the journal entry for this request (host may have appended one)
    let entry = ctx.journal.entries.find(e => e.requestId === req.requestId);
    if (!entry) {
      // deadline fallback: synthesized deterministically, journaled (05 §2)
      const result = ruleBrainDecide(s, req);
      entry = {
        seq: ctx.journal.entries.length,
        requestId: req.requestId,
        requestTick: req.tick,
        applyAtTick: req.applyAtTick,
        actorId: req.actorId,
        factionId: req.factionId,
        choice: result.choice,
        reasoning: result.reasoning,
        source: 'fallback',
      };
      ctx.journal.entries.push(entry);
    }

    const actor = s.named[entry.actorId];
    const faction = s.factions[entry.factionId];
    const actorValid = actor && actor.deathTick < 0 &&
      faction && !faction.extinct && faction.leaderId === entry.actorId;
    const choiceValid = req.options.includes(entry.choice);

    if (!actorValid || !choiceValid) {
      entry.void = true;                 // stays in journal; replay-identical
    } else {
      applyDecision(s, entry);
      // coverage bookkeeping (05 fairness): llm vs fallback per faction
      faction.llmCoverageDen++;
      if (entry.source !== 'fallback') faction.llmCoverageNum++;
      if (actor) {
        actor.recentChoices.push(entry.choice);
        if (actor.recentChoices.length > 5) actor.recentChoices.shift();
        if (entry.newMemory) {
          pushMemory(actor, { text: entry.newMemory, landmark: false, weight: 4, tick: s.tick });
        }
      }
    }
  }
  const dueIds = new Set(due.map(d => d.requestId));
  s.pending = s.pending.filter(p => !dueIds.has(p.requestId));
}
