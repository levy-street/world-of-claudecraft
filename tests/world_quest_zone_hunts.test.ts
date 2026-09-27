import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_ZONE_HUNTS } from '../src/sim/content/world_quest_zone_hunts';
import { WORLD_QUEST_MIN_LEVEL, WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { CAMPS, MOBS, ZONES } from '../src/sim/data';
import { MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges';
import { WORLD_QUEST_CHAMPION_TYPES } from '../src/sim/world_quest_champion';
import {
  ALWAYS_ACTIVE_WORLD_QUEST_IDS,
  activeWorldQuestsForCycle,
  WORLD_QUEST_ZONES,
  WORLD_QUESTS_BY_ZONE,
} from '../src/sim/world_quest_rotation';

// The round-2 zone hunts (world quests round 2, 2026-09): kill quests against
// each zone's existing camps. A world quest credits kills inside its area, so
// an area that misses the target's camps is an uncompletable quest; every
// record is pinned against the shipped camp table, not against its own
// comment.

// 0 is Galecrest (its two dailies are always active, nothing rotates).
const POOL_LENGTHS_ALLOWED = new Set([0, 1, 4, 7]);
const LONGEST_POOL = 7;

function campSpawnsInside(quest: (typeof WORLD_QUEST_ZONE_HUNTS)[number]): number {
  if (quest.objective.type !== 'kill') return 0;
  const target = quest.objective.targetMobId;
  let inside = 0;
  for (const camp of CAMPS) {
    if (camp.mobId !== target) continue;
    // The whole camp (centre plus spawn radius plus the idle wander every camp
    // mob is allowed, mob/aggro_ranges.ts) must sit inside the ring, or a mob
    // pulled at the camp's edge dies outside the credit area.
    const reach = Math.hypot(camp.center.x - quest.area.x, camp.center.z - quest.area.z);
    if (reach + camp.radius + MAX_WANDER_RADIUS <= quest.area.radius) inside += camp.count;
  }
  return inside;
}

function rotatingPool(zone: string): readonly string[] {
  return WORLD_QUESTS_BY_ZONE[zone].filter((id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id));
}

describe('world quest zone hunts', () => {
  it('ships 39 hunts, every one a kill quest with a unique id in the merged catalog', () => {
    expect(WORLD_QUEST_ZONE_HUNTS).toHaveLength(39);
    const ids = new Set<string>();
    for (const quest of WORLD_QUEST_ZONE_HUNTS) {
      expect(quest.objective.type).toBe('kill');
      expect(ids.has(quest.id), `duplicate id ${quest.id}`).toBe(false);
      ids.add(quest.id);
      expect(WORLD_QUESTS_BY_ID[quest.id], `${quest.id} is in the merged catalog`).toBe(quest);
    }
  });

  it('the unlock level literal matches the exported constant', () => {
    // The hunts module repeats the literal to avoid an import cycle.
    for (const quest of WORLD_QUEST_ZONE_HUNTS) {
      expect(quest.minLevel).toBeGreaterThanOrEqual(WORLD_QUEST_MIN_LEVEL);
    }
    // Eastbrook and Farshore: three starter hunts each.
    expect(
      WORLD_QUEST_ZONE_HUNTS.filter((quest) => quest.minLevel === WORLD_QUEST_MIN_LEVEL).length,
    ).toBe(6);
  });

  it('every hunt targets a shipped mob whose camps the area fully covers, at least count deep', () => {
    for (const quest of WORLD_QUEST_ZONE_HUNTS) {
      if (quest.objective.type !== 'kill') throw new Error('unreachable');
      const mob = MOBS[quest.objective.targetMobId];
      expect(mob, `${quest.id}: mob ${quest.objective.targetMobId} exists`).toBeTruthy();
      const inside = campSpawnsInside(quest);
      expect(
        inside,
        `${quest.id}: the ring at ${quest.area.x},${quest.area.z} r${quest.area.radius} covers ${inside} ${quest.objective.targetMobId} spawns, needs ${quest.count}`,
      ).toBeGreaterThanOrEqual(quest.count);
    }
  });

  it('every hunt sits in its zone, gated at the band start, against a mob of that band', () => {
    for (const quest of WORLD_QUEST_ZONE_HUNTS) {
      if (quest.objective.type !== 'kill') throw new Error('unreachable');
      const zone = ZONES.find((z) => z.id === quest.zoneId);
      expect(zone, `${quest.id}: zone ${quest.zoneId}`).toBeTruthy();
      if (!zone) continue;
      expect(quest.area.z).toBeGreaterThanOrEqual(zone.zMin);
      expect(quest.area.z).toBeLessThanOrEqual(zone.zMax);
      const [bandMin, bandMax] = zone.levelRange;
      // The gate is the zone's band start (or the level-5 unlock in the starter
      // bands), the same rule every sibling quest follows and the content pin in
      // tests/world_quests.test.ts enforces: a zone's players see every one of
      // its hunts from the day they arrive.
      expect(quest.minLevel, quest.id).toBe(Math.max(WORLD_QUEST_MIN_LEVEL, bandMin));
      expect(quest.minLevel).toBeLessThanOrEqual(bandMax);
      // And the target is a mob of that band, never a stray from a neighbour.
      const mob = MOBS[quest.objective.targetMobId];
      expect(mob?.minLevel, `${quest.id}: ${quest.objective.targetMobId}`).toBeGreaterThanOrEqual(
        Math.min(bandMin, WORLD_QUEST_MIN_LEVEL) - 4,
      );
      expect(mob?.maxLevel ?? mob?.minLevel ?? 0).toBeLessThanOrEqual(bandMax);
    }
  });

  it('every hunt is appended to its zone pool, after the earlier entries', () => {
    for (const quest of WORLD_QUEST_ZONE_HUNTS) {
      const pool = WORLD_QUESTS_BY_ZONE[quest.zoneId];
      expect(pool, `${quest.id}: zone pool`).toBeTruthy();
      expect(pool.includes(quest.id), `${quest.id} in the ${quest.zoneId} pool`).toBe(true);
      expect(ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id)).toBe(false);
    }
    // The earlier entries keep their day index (appended, never inserted).
    expect(WORLD_QUESTS_BY_ZONE.mirefen_marsh.slice(0, 2)).toEqual([
      'wq_mirefen_gravecallers',
      'wq_mirefen_infiltrator',
    ]);
    expect(WORLD_QUESTS_BY_ZONE.frostveil.slice(0, 2)).toEqual([
      'wq_frostveil_howlers',
      'wq_frostveil_caravan',
    ]);
    expect(WORLD_QUESTS_BY_ZONE.eastbrook_vale.slice(0, 4)).toEqual([
      'wq_eastbrook_bandits',
      'wq_eastbrook_caravan',
      'wq_eastbrook_calligraphy',
      'wq_eastbrook_shadow',
    ]);
    // Galecrest deliberately keeps only its two always-active dailies (a
    // rotating slot there would move the item-bearing zone draw every cycle).
    expect(WORLD_QUESTS_BY_ZONE.galecrest).toEqual(['wq_galecrest_wisps', 'wq_galecrest_slalom']);
  });

  it('pool lengths are 1, 4 or 7: every entry reachable under legacy three-day cycle ids', () => {
    // A legacy wq3_N id canonicalises to day 3N, so a pool of 3 or 6 would only
    // ever offer two of its entries under it; 1, 4 and 7 reach them all, and
    // each divides the 84-day roster period. Palmreach is the one pool left at
    // a single entry (the daily confection board, below); every other zone
    // rotates.
    let longest = 0;
    for (const zone of WORLD_QUEST_ZONES) {
      const pool = rotatingPool(zone);
      expect(POOL_LENGTHS_ALLOWED.has(pool.length), `${zone} pool of ${pool.length}`).toBe(true);
      longest = Math.max(longest, pool.length);
      if (zone !== 'galecrest' && zone !== 'palmreach') {
        expect(pool.length, `${zone} pool`).toBeGreaterThanOrEqual(4);
      }
    }
    expect(longest).toBe(LONGEST_POOL);
    for (const zone of WORLD_QUEST_ZONES) {
      const pool = rotatingPool(zone);
      const reached = new Set<string>();
      for (let n = 0; n < LONGEST_POOL; n++) {
        for (const quest of activeWorldQuestsForCycle(`wq3_${n}`)) {
          if (quest.zoneId !== zone) continue;
          if (ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id)) continue;
          reached.add(quest.id);
        }
      }
      expect([...reached].sort(), `${zone} under wq3_`).toEqual([...pool].sort());
    }
  });

  it('every day keeps at least one purse-free rotating quest on the board (the daily budget)', () => {
    // Kill, gather, interact and delivery quests all pay the champion purse
    // (world_quest_champion.ts). A day of thirteen such slots overshoots the
    // ten-gold budget by a few hundred copper. Palmreach's confection board is
    // a day-keyed puzzle (tests/world_quest_daily_levels.test.ts pins that a
    // new board arrives with every reset), so it is the one rotating slot that
    // never rotates, and its purse-free slot is what keeps every day under
    // the budget.
    for (let n = 0; n < 84; n++) {
      const rotating = activeWorldQuestsForCycle(`wq1_${n}`).filter(
        (quest) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id),
      );
      const purseFree = rotating.filter(
        (quest) => !WORLD_QUEST_CHAMPION_TYPES.has(quest.objective.type),
      );
      expect(purseFree.length, `cycle wq1_${n}`).toBeGreaterThanOrEqual(1);
    }
    expect(WORLD_QUESTS_BY_ZONE.palmreach).toEqual(['wq_palmreach_confections']);
    for (let n = 0; n < 84; n++) {
      expect(
        activeWorldQuestsForCycle(`wq1_${n}`).some(
          (quest) => quest.id === 'wq_palmreach_confections',
        ),
        `confections on wq1_${n}`,
      ).toBe(true);
    }
  });

  it('across one longest-pool cycle the board never repeats and every hunt is offered', () => {
    const seen = new Set<string>();
    const boards = new Set<string>();
    for (let day = 0; day < LONGEST_POOL; day++) {
      const board = activeWorldQuestsForCycle(`wq1_${day}`).map((quest) => quest.id);
      boards.add(board.join('|'));
      for (const id of board) seen.add(id);
    }
    expect(boards.size).toBe(LONGEST_POOL);
    for (const quest of WORLD_QUEST_ZONE_HUNTS) expect(seen.has(quest.id), quest.id).toBe(true);
  });
});
