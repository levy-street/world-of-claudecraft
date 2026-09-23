// Delta-safe decode for the faction standing and daily reroll owner keys. The
// server emits them beside the world-quest family (server/quest_snapshot_wire.ts,
// emitQuestSelfKeys); omission retains the previous mirror and a malformed value
// is clamped by the same sanitizers the save/load boundary uses, so a hostile
// or skewed snapshot can never leave the client holding out-of-range standing.
import type { FactionId } from '../sim/factions';
import { sanitizeFactionReputation } from '../sim/factions';
import { sanitizeWorldQuestReplacements } from '../sim/world_quest_reroll';
import { sanitizeWorldQuestCycle } from '../sim/world_quests';

export interface FactionSelfMirrors {
  factions: Readonly<Record<FactionId, number>>;
  worldQuestRerollCycle: string;
  worldQuestReplacements: Readonly<Record<string, string>>;
}

/** Apply the `fac`, `wqrr` and `wqrep` self keys; each is independent. */
export function applyFactionSelfWire(
  target: Partial<FactionSelfMirrors> & { worldQuestCycle?: string },
  self: { fac?: unknown; wqrr?: unknown; wqrep?: unknown },
): void {
  if (self.fac !== undefined) {
    target.factions = Object.freeze(sanitizeFactionReputation(self.fac));
  }
  if (self.wqrr !== undefined) {
    target.worldQuestRerollCycle = sanitizeWorldQuestCycle(self.wqrr);
  }
  if (self.wqrep !== undefined) {
    // Replacements only mean something on today's board: sanitize against the
    // cycle the same snapshot (or the retained mirror) established.
    target.worldQuestReplacements = Object.freeze(
      sanitizeWorldQuestReplacements(self.wqrep, target.worldQuestCycle ?? ''),
    );
  }
}
