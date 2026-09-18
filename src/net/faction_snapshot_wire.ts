// Delta-safe decode for the faction standing, daily reroll and clue hunt
// owner keys. The server emits them beside the world-quest family
// (server/quest_snapshot_wire.ts, emitQuestSelfKeys); omission retains the
// previous mirror and a malformed value is clamped by the same sanitizers the
// save/load boundary uses, so a hostile or skewed snapshot can never leave the
// client holding out-of-range standing or an unknown hunt.
import { sanitizeClueHunt } from '../sim/clue_scrolls';
import type { FactionId } from '../sim/factions';
import { sanitizeFactionReputation } from '../sim/factions';
import { sanitizeWorldQuestReplacements } from '../sim/world_quest_reroll';
import { sanitizeWorldQuestCycle } from '../sim/world_quests';

export interface FactionSelfMirrors {
  factions: Readonly<Record<FactionId, number>>;
  worldQuestRerollCycle: string;
  worldQuestReplacements: Readonly<Record<string, string>>;
  clueHunt: Readonly<{ huntId: string; step: number }> | null;
}

/** Apply the `fac`, `wqrr`, `wqrep` and `cluh` self keys; each is independent. */
export function applyFactionSelfWire(
  target: Partial<FactionSelfMirrors> & { worldQuestCycle?: string },
  self: { fac?: unknown; wqrr?: unknown; wqrep?: unknown; cluh?: unknown },
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
  if (self.cluh !== undefined) {
    // The clue hunt cursor: the same sanitizer the save boundary runs (an
    // unknown hunt id or any junk decodes to null, the step is clamped), so
    // the mirror can never name a hunt the tracker has no clues for.
    const hunt = sanitizeClueHunt(self.cluh);
    target.clueHunt = hunt ? Object.freeze(hunt) : null;
  }
}
