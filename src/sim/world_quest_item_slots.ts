// The day's item slots. Three of the rotating zone slots carry an item reward
// each cycle, the same three for every character on the realm, and the piece a
// character receives is fixed per cycle, zone and class from its class table.
// Everything here is a pure function of the cycle id (host-fed, shared by every
// host through the world-quest cycle mirror), so the map hover and the award
// agree, and the completion path draws nothing from ctx.rng: a
// locally seeded Rng is the same deterministic-content idiom the daily puzzle
// generator uses (src/sim/world_quest_daily_generation.ts).
import { WORLD_QUEST_CLASS_LOOT } from './content/world_quest_loot';
import { Rng } from './rng';
import { ALL_CLASSES, type PlayerClass, type WorldQuestDef } from './types';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  WORLD_QUEST_ZONES,
  WORLD_QUESTS_BY_ZONE,
  worldQuestCycleNumber,
} from './world_quest_rotation';

/** Zone slots that carry an item reward each cycle. */
export const WORLD_QUEST_ITEM_SLOTS_PER_CYCLE = 3;
/** The item bracket: the level 16 to 20 circuit, the same floor as Clue Scrolls
 *  (src/sim/content/clue_hunts.ts). Below it a quest pays the bundle only. */
export const WORLD_QUEST_ITEM_MIN_LEVEL = 16;

// Seed salts: distinct streams for the slot draw and the per-class item draw,
// so changing one table can never move which zones carry items. Both seeds
// also mix the POSITION of the zone in WORLD_QUEST_ZONES and of the class in
// ALL_CLASSES, so those orders are load-bearing: reordering either reshuffles
// every character's daily item across a deploy, with an old client previewing
// one piece while the server grants another. tests/world_quest_item_slots.test.ts
// pins the concrete zones and items of the first cycles for that reason.
const SLOT_SEED_SALT = 0x5107_0000;
const ITEM_SEED_SALT = 0x17e3_0000;

/** The zones that rotate a quest (a zone whose quests are all always-active
 *  dailies never carries an item slot; the dailies are the same every day). */
export const WORLD_QUEST_ITEM_ZONES: readonly string[] = Object.freeze(
  WORLD_QUEST_ZONES.filter((zoneId) =>
    (WORLD_QUESTS_BY_ZONE[zoneId] ?? []).some((id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id)),
  ),
);

/** The cycle's item-bearing zones, in slot order. Empty for an unknown cycle. */
export function worldQuestItemZonesForCycle(cycle: unknown): readonly string[] {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return [];
  const pool = [...WORLD_QUEST_ITEM_ZONES];
  const rng = new Rng((SLOT_SEED_SALT + number) >>> 0);
  const picked: string[] = [];
  const count = Math.min(WORLD_QUEST_ITEM_SLOTS_PER_CYCLE, pool.length);
  // Partial Fisher-Yates: each pick removes its zone, so the three are distinct.
  for (let slot = 0; slot < count; slot++) {
    const index = rng.int(0, pool.length - 1);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

/** The piece a class receives from a zone's quest this cycle, or null when the
 *  zone carries no item this cycle or the class table is empty. Attached to the
 *  ZONE, not the quest id, so a reroll in that zone keeps the day's item. */
export function worldQuestItemRewardFor(
  cycle: unknown,
  zoneId: string,
  cls: PlayerClass,
): string | null {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return null;
  if (!worldQuestItemZonesForCycle(cycle).includes(zoneId)) return null;
  const table = WORLD_QUEST_CLASS_LOOT[cls];
  if (!table || table.length === 0) return null;
  const zoneIndex = WORLD_QUEST_ITEM_ZONES.indexOf(zoneId);
  const classIndex = ALL_CLASSES.indexOf(cls);
  const rng = new Rng((ITEM_SEED_SALT + number * 1009 + zoneIndex * 31 + classIndex) >>> 0);
  return table[rng.int(0, table.length - 1)];
}

/** The award-side view: a zone's item rides its ROTATING quest, gated on the
 *  item bracket. The always-active dailies never carry one, even in a zone
 *  that holds a slot today (evergarden offers both kinds), so a cycle pays
 *  exactly WORLD_QUEST_ITEM_SLOTS_PER_CYCLE pieces and never a duplicate. */
export function worldQuestItemRewardForQuest(
  cycle: unknown,
  quest: Pick<WorldQuestDef, 'id' | 'zoneId'>,
  cls: PlayerClass,
  level: number,
): string | null {
  if (level < WORLD_QUEST_ITEM_MIN_LEVEL) return null;
  if (ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id)) return null;
  return worldQuestItemRewardFor(cycle, quest.zoneId, cls);
}
