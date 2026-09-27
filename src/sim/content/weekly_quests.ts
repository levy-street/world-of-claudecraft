// The weekly emissary and the four weekly quests he offers. Data-as-code: the
// rules (one pick per week, credit, reward, the Tuesday roll) live in
// src/sim/weekly_quests.ts; this file only says WHAT is on offer.
import type { NpcDef } from '../types';

export type WeeklyQuestKind = 'dungeons' | 'raid' | 'battlegrounds' | 'worldboss';

export interface WeeklyQuestDef {
  id: string;
  kind: WeeklyQuestKind;
  /** Completions needed (dungeons cleared, raids cleared, matches played, bosses slain). */
  count: number;
}

export const WEEKLY_QUESTS: readonly WeeklyQuestDef[] = [
  { id: 'wk_dungeons', kind: 'dungeons', count: 3 },
  { id: 'wk_raid', kind: 'raid', count: 1 },
  { id: 'wk_battlegrounds', kind: 'battlegrounds', count: 3 },
  { id: 'wk_worldboss', kind: 'worldboss', count: 1 },
];

export const WEEKLY_QUESTS_BY_ID: Readonly<Record<string, WeeklyQuestDef>> = Object.freeze(
  Object.fromEntries(WEEKLY_QUESTS.map((quest) => [quest.id, quest])),
);

/** Every weekly pays the same purse (scaled by level) plus one Emissary's
 *  Cache (src/sim/emissary_cache.ts: a Normal raid piece for the owner's
 *  class and a few Heroic Marks). */
export const WEEKLY_QUEST_REWARD = Object.freeze({
  copper: Object.freeze({ base: 20_000, perLevel: 500 }),
  cacheItemId: 'emissary_cache',
  cacheCount: 1,
  /** The emissary's commendation: standing with ONE faction of the owner's
   *  choice, claimed from the window once the charge is finished. It goes
   *  through awardFactionReputation like a world-quest turn-in, so the level
   *  cap applies; a faction paused at the cap cannot take it (the choice
   *  stays open rather than being wasted). */
  commendationStanding: 1_000,
});

/** Weeks roll at the realm's weekly reset (a Tuesday); this anchor is one. */
export const WEEKLY_QUEST_EPOCH_DAY = '2026-09-01';
export const WEEKLY_QUEST_WEEK_PREFIX = 'wk_';

/** Talk range: the same reach the world-quest instructors use. */
export const WEEKLY_EMISSARY_TALK_RANGE = 7;

export const WEEKLY_EMISSARY_NPC_ID = 2_146_900_060;
// On the green south of the Eastbrook notice board, a stride from Marshal
// Redbrook, facing the civic square (the same lawn the marshal watches from).
export const WEEKLY_EMISSARY_NPC_DEF: NpcDef = {
  id: 'weekly_emissary',
  name: 'Cham Pete',
  title: 'Emissary',
  pos: { x: -52, z: -108 },
  facing: 1.41,
  color: 0x6b4fa8,
  questIds: [],
  dynamic: true,
  weeklyEmissary: true,
  greeting:
    'The Vale keeps a ledger of deeds, and I keep the ledger. Pick one charge for the week, see it through, and the purse is yours.',
};
