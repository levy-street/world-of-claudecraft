// Pure optimistic quest-state resolution for the online client.
//
// Bug fixed (issue 1667): after turning in a quest through the NPC dialog, a
// follow-up quest that requires it (`requiresQuest`) stayed hidden until the
// next server snapshot arrived, even though the dialog re-renders immediately
// after the turn-in command is sent. `ClientWorld.turnInQuest` is fire-and-
// forget: it records the action in `pendingQuestCommands` but the quest only
// actually leaves `questLog` / lands in `questsDone` once the server's `qlog`/
// `qdone` snapshot fields round-trip. The dialog's re-render (`hud.ts`
// `renderGossip`) already re-queries `questState()` live for every quest the
// NPC could offer, so the staleness was never in the UI layer: it was that
// `computeQuestState`'s prerequisite check (`quest.requiresQuest &&
// !questsDone.has(...)`) read the not-yet-updated `questsDone` set for any
// quest OTHER than the one just turned in.
//
// The fix extends the existing pending-command optimism (already sanctioned
// for the turned-in quest itself, see src/net/CLAUDE.md) to prerequisite
// checks for every other quest: while a `turnin` command is in flight, treat
// that quest as done when resolving anyone else's state. This is display-only
// optimism reconciled the moment a real snapshot lands and clears
// `pendingQuestCommands` (see `ClientWorld.applySnapshot`); the server still
// authoritatively resolves the turn-in itself.
import type { ArchetypeState } from '../sim/professions/archetype';
import { computeQuestState } from '../sim/sim';
import type { QuestProgress, QuestState } from '../sim/types';

export function optimisticQuestState(
  questId: string,
  questLog: Map<string, QuestProgress>,
  questsDone: Set<string>,
  pendingQuestCommands: Map<string, 'accept' | 'turnin'>,
  playerLevel: number,
  professionState?: ArchetypeState,
): QuestState {
  let effectiveDone = questsDone;
  if (pendingQuestCommands.size > 0) {
    for (const [qid, action] of pendingQuestCommands) {
      if (action === 'turnin' && qid !== questId) {
        if (effectiveDone === questsDone) effectiveDone = new Set(questsDone);
        effectiveDone.add(qid);
      }
    }
  }
  const state = computeQuestState(questId, questLog, effectiveDone, playerLevel, professionState);
  const pending = pendingQuestCommands.get(questId);
  if (
    (pending === 'accept' && state === 'available') ||
    (pending === 'turnin' && state === 'ready')
  ) {
    return 'active';
  }
  return state;
}
