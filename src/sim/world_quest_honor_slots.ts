// The day's Honor slots. Two of the rotating zone slots pay a flat Honor bonus
// each cycle, the same two for every character on the realm, so a player who
// has never queued for PvP can still bank a head start toward Warfare gear from
// the world quest circuit. The pick changes at the realm reset, the same moment
// the rotation does, because it is a pure function of the host-fed cycle id
// (src/sim/world_quest_rotation.ts): the map hover and the award agree, and the
// completion path draws nothing from ctx.rng. A locally seeded Rng is the same
// deterministic-content idiom the day's item slots use
// (src/sim/world_quest_item_slots.ts), on its own salt so neither pick can move
// the other.
import { Rng } from './rng';
import type { WorldQuestDef } from './types';
import { WORLD_QUEST_ITEM_ZONES } from './world_quest_item_slots';
import { ALWAYS_ACTIVE_WORLD_QUEST_IDS, worldQuestCycleNumber } from './world_quest_rotation';

/** Zone slots that pay the Honor bonus each cycle. */
export const WORLD_QUEST_HONOR_SLOTS_PER_CYCLE = 2;
/** The Honor one bonus quest pays on completion (owner tuning: a head start
 *  toward Warfare gear, a little over a Thornhollow Fields win). */
export const WORLD_QUEST_HONOR_REWARD = 150;

// Seed salt for the slot draw. Distinct from the item slots' salts, so retuning
// either table never moves the other. The seed mixes the zone's POSITION in
// WORLD_QUEST_HONOR_ZONES, so that order is load-bearing: reordering it
// reshuffles the day's Honor quests across a deploy, with an old client
// previewing one zone while the server pays another.
// tests/world_quest_honor_slots.test.ts pins the first cycles' zones for that reason.
const HONOR_SLOT_SEED_SALT = 0x40a0_0000;

/** The zones that rotate a quest, the item slots' pool: a zone whose quests are
 *  all always-active dailies never carries an Honor slot. */
export const WORLD_QUEST_HONOR_ZONES: readonly string[] = WORLD_QUEST_ITEM_ZONES;

/** The cycle's Honor-bearing zones, in slot order. Empty for an unknown cycle. */
export function worldQuestHonorZonesForCycle(cycle: unknown): readonly string[] {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return [];
  const pool = [...WORLD_QUEST_HONOR_ZONES];
  const rng = new Rng((HONOR_SLOT_SEED_SALT + number) >>> 0);
  const picked: string[] = [];
  const count = Math.min(WORLD_QUEST_HONOR_SLOTS_PER_CYCLE, pool.length);
  // Partial Fisher-Yates: each pick removes its zone, so the two are distinct.
  for (let slot = 0; slot < count; slot++) {
    const index = rng.int(0, pool.length - 1);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

/** The Honor a quest pays on completion this cycle, 0 when it carries none.
 *  Attached to the ZONE's rotating quest, so a reroll in that zone keeps the
 *  bonus; the always-active dailies never carry it, even in a zone that holds a
 *  slot today, so a cycle pays exactly WORLD_QUEST_HONOR_SLOTS_PER_CYCLE bonuses. */
export function worldQuestHonorRewardForQuest(
  cycle: unknown,
  quest: Pick<WorldQuestDef, 'id' | 'zoneId'>,
): number {
  if (ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id)) return 0;
  return worldQuestHonorZonesForCycle(cycle).includes(quest.zoneId) ? WORLD_QUEST_HONOR_REWARD : 0;
}
