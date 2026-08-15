// Content integration checks: referential integrity across the merged
// content tables, and the XP pacing budget that keeps leveling 1-20 free of
// forced grinding. These tests are content-shape tests: they run against
// whatever the content modules currently export, so they hold as zones grow.
import { describe, expect, it } from 'vitest';
import { CHOICE_ROW_LEVELS, CHOICE_ROWS } from '../src/sim/content/choice_rows';
import {
  ABILITIES,
  ALL_RECIPES,
  CAMPS,
  CLASSES,
  DUNGEON_LIST,
  GATHER_NODES,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUEST_ORDER,
  QUESTS,
  REWARD_ARCHETYPE,
  ROADS,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
} from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { HARVEST_COMPONENT_ITEMS, NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, XP_TABLE, type ZoneDef } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SCRIPTED_COLLECT_ITEMS = new Set(['the_codfather']);

// The complete set of ways a collect-objective item can legitimately enter a
// player's bags. The mob-loot / ground-object / scripted trio is the original
// model, plus the two gathering acquisition paths the work-order
// materials use: gather-node harvest (NODE_MATERIAL_TABLE grants copper_ore,
// ironbark_log, goldleaf_herb in their zones) and corpse harvest
// (HARVEST_COMPONENT_ITEMS maps a component tag to game_meat, spider_silk,
// rough_hide, etc). Both the obtainability check and its negative control call
// this one predicate, so the negative control proves the REAL model, not a copy.
function collectItemAcquirable(itemId: string): boolean {
  const fromLoot = Object.values(MOBS).some((m) => m.loot.some((l) => l.itemId === itemId));
  const fromGround = GROUND_OBJECTS.some((g) => g.itemId === itemId);
  const fromScript = SCRIPTED_COLLECT_ITEMS.has(itemId);
  const fromNode = Object.values(NODE_MATERIAL_TABLE).some((byZone) =>
    Object.values(byZone).some((row) => row.itemId === itemId),
  );
  const fromHarvest = Object.values(HARVEST_COMPONENT_ITEMS).includes(itemId);
  return fromLoot || fromGround || fromScript || fromNode || fromHarvest;
}

describe('content referential integrity', () => {
  it('every quest reference resolves (NPCs, mobs, items, chains)', () => {
    const problems: string[] = [];
    for (const q of Object.values(QUESTS)) {
      if (!NPCS[q.giverNpcId]) problems.push(`${q.id}: giver ${q.giverNpcId} missing`);
      if (!NPCS[q.turnInNpcId]) problems.push(`${q.id}: turn-in ${q.turnInNpcId} missing`);
      if (q.requiresQuest && !QUESTS[q.requiresQuest])
        problems.push(`${q.id}: requires ${q.requiresQuest} missing`);
      for (const [cls, itemId] of Object.entries(q.itemRewards)) {
        if (itemId && !ITEMS[itemId]) problems.push(`${q.id}: reward ${itemId} (${cls}) missing`);
      }
      for (const obj of q.objectives) {
        if (obj.type === 'kill' && (!obj.targetMobId || !MOBS[obj.targetMobId])) {
          problems.push(`${q.id}: kill target ${obj.targetMobId} missing`);
        }
        if (obj.type === 'collect' && (!obj.itemId || !ITEMS[obj.itemId])) {
          problems.push(`${q.id}: collect item ${obj.itemId} missing`);
        }
        if (obj.type === 'craft' && !ALL_RECIPES.some((recipe) => recipe.id === obj.recipeId)) {
          problems.push(`${q.id}: craft recipe ${obj.recipeId} missing`);
        }
        if (obj.type === 'gather') {
          if (!obj.nodeType && !obj.itemId) problems.push(`${q.id}: gather target missing`);
          if (obj.nodeType && !GATHER_NODES.some((node) => node.type === obj.nodeType)) {
            problems.push(`${q.id}: gather node type ${obj.nodeType} missing`);
          }
          if (obj.itemId) {
            if (!ITEMS[obj.itemId]) problems.push(`${q.id}: gather item ${obj.itemId} missing`);
            if (
              !Object.values(NODE_MATERIAL_TABLE).some((byZone) =>
                Object.values(byZone).some((row) => row.itemId === obj.itemId),
              )
            ) {
              problems.push(`${q.id}: gather item ${obj.itemId} has no node source`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every quest is offered by its giver and turn-in NPCs', () => {
    const problems: string[] = [];
    for (const q of Object.values(QUESTS)) {
      if (!NPCS[q.giverNpcId]?.questIds.includes(q.id))
        problems.push(`${q.id}: not in ${q.giverNpcId}.questIds`);
      if (q.turnInNpcId !== q.giverNpcId && !NPCS[q.turnInNpcId]?.questIds.includes(q.id)) {
        problems.push(`${q.id}: not in turn-in ${q.turnInNpcId}.questIds`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every collect objective is obtainable', () => {
    const problems: string[] = [];
    for (const q of Object.values(QUESTS)) {
      for (const obj of q.objectives) {
        if (obj.type !== 'collect' || !obj.itemId) continue;
        if (!collectItemAcquirable(obj.itemId))
          problems.push(`${q.id}: ${obj.itemId} has no acquisition source`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the collect-obtainability model rejects a fabricated unobtainable item (negative control)', () => {
    // Decisive guard so the widened model (with the gather-node and
    // corpse-harvest paths for the work-order materials) can never go all-
    // permissive: an item that lives in NO mob loot table, ground object,
    // scripted set, gather-node material row, or corpse-harvest component map
    // must still be classified unacquirable. The four real acquisition paths are
    // re-proven acquirable here so a later refactor that drops a path reds this.
    expect(collectItemAcquirable('totally_not_a_real_item_xyz')).toBe(false);
    expect(collectItemAcquirable('copper_ore')).toBe(true); // gather-node material
    expect(collectItemAcquirable('ironbark_log')).toBe(true); // gather-node material
    expect(collectItemAcquirable('goldleaf_herb')).toBe(true); // gather-node material
    expect(collectItemAcquirable('game_meat')).toBe(true); // corpse-harvest component
    expect(collectItemAcquirable('spider_silk')).toBe(true); // corpse-harvest component
    expect(collectItemAcquirable('rough_hide')).toBe(true); // corpse-harvest component
  });

  it('QUEST_ORDER covers every quest exactly once', () => {
    expect([...QUEST_ORDER].sort()).toEqual(Object.keys(QUESTS).sort());
    expect(new Set(QUEST_ORDER).size).toBe(QUEST_ORDER.length);
  });

  it('every camp-spawned mob has an unconditional loot entry (copper at minimum)', () => {
    // The v0.32.0 realms shipped 34 camp-spawned mobs with empty loot arrays
    // and another 20 whose only entries were quest-gated: rollLoot
    // (src/sim/loot/loot_roll.ts) drives entirely off template.loot, so both
    // shapes drop nothing outside their quest, not even copper. Require at
    // least one entry with no questId gate. The sanctioned lootless camp
    // spawns are the practice target and the ambient stable horse (both
    // non-combat fixtures by design), plus the Gilded Stag: the farm-yield
    // economy model (tests/economy_yield.test.ts) uses it as the quest-only,
    // zero-coin exemplar on purpose. The quest-dedupe content pass added the
    // Broodmother egg clutch (spider_egg): a destructible quest object, not a
    // combatant (dmgBase 0, moveSpeed 0, aggroRadius 0, xpMult 0, damageable
    // only on q_broodmother via requiresQuestId), so it is lootless by design
    // like the other fixtures, not a v0.32.0-style empty-loot regression.
    const LOOTLESS_FIXTURES = new Set([
      'training_dummy',
      'stable_horse',
      'gilded_stag',
      'spider_egg',
    ]);
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const c of CAMPS) {
      if (seen.has(c.mobId) || LOOTLESS_FIXTURES.has(c.mobId)) continue;
      seen.add(c.mobId);
      const t = MOBS[c.mobId];
      // Puzzle-object mobs (xpMult 0: the 1 HP dragonkin egg, the spider
      // egg-sac pattern) pay no XP and carry no loot BY DESIGN: the hatched
      // fight is the reward, and a lootable shell would sparkle every corpse
      // in a clutch. The xpMult-0 marker is the principled gate.
      if (t?.xpMult === 0) continue;
      if (t && !t.loot.some((l) => !l.questId))
        problems.push(`${c.mobId} spawns from a camp with no unconditional loot`);
    }
    expect(problems).toEqual([]);
  });

  it('all loot tables, vendor stock, camps and dungeon spawns resolve', () => {
    const problems: string[] = [];
    for (const m of Object.values(MOBS)) {
      for (const l of m.loot) {
        if (l.itemId && !ITEMS[l.itemId]) problems.push(`${m.id}: loot ${l.itemId} missing`);
        if (l.questId && !QUESTS[l.questId])
          problems.push(`${m.id}: loot quest-gate ${l.questId} missing`);
      }
    }
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) {
        if (!ITEMS[itemId]) problems.push(`${npc.id}: vendor item ${itemId} missing`);
        else if (!ITEMS[itemId].buyValue && !ITEMS[itemId].priceHonor)
          problems.push(`${npc.id}: vendor item ${itemId} has no purchase price`);
      }
      for (const qid of npc.questIds) {
        if (!QUESTS[qid]) problems.push(`${npc.id}: questId ${qid} missing`);
      }
    }
    for (const c of CAMPS) {
      if (!MOBS[c.mobId])
        problems.push(`camp at (${c.center.x},${c.center.z}): mob ${c.mobId} missing`);
    }
    for (const g of GROUND_OBJECTS) {
      if (!ITEMS[g.itemId]) problems.push(`ground object ${g.itemId} missing from ITEMS`);
    }
    for (const d of DUNGEON_LIST) {
      for (const s of d.spawns) {
        if (!MOBS[s.mobId]) problems.push(`${d.id}: spawn ${s.mobId} missing`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every kill-quest target mob actually spawns somewhere', () => {
    // v0.34.0 shipped q_gc_scuttlers_in_the_pots (shoal_scuttler) and
    // q_gc_wind_against_the_wick (gale_wisp) with kill targets that resolved
    // fine in MOBS but had zero camp or dungeon spawn entry: unfinishable,
    // and blocking the downstream Galecrest chain via requiresQuest. The
    // "every quest reference resolves" test above only checks the mob id
    // exists, never that anything spawns it, so this closes that gap.
    // bound_guardian is a Nythraxis raid-encounter add spawned by the
    // encounter script itself (src/sim/encounters/nythraxis.ts), not a
    // world camp or a dungeon spawn list, so it is a documented exception.
    const RAID_ENCOUNTER_SPAWNED = new Set(['bound_guardian']);
    const spawning = new Set<string>();
    for (const c of CAMPS) spawning.add(c.mobId);
    for (const d of DUNGEON_LIST) for (const s of d.spawns) spawning.add(s.mobId);
    const problems: string[] = [];
    for (const q of Object.values(QUESTS)) {
      for (const obj of q.objectives) {
        if (
          obj.type === 'kill' &&
          obj.targetMobId &&
          !spawning.has(obj.targetMobId) &&
          !RAID_ENCOUNTER_SPAWNED.has(obj.targetMobId)
        ) {
          problems.push(`${q.id}: kill target ${obj.targetMobId} has no camp/dungeon spawn source`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('zones tile the grid and content sits inside its zone band', () => {
    // the strip column tiles south to north exactly as it always did
    const strip = ZONES.filter((zn) => (zn.xMin ?? -180) <= -180 && (zn.xMax ?? 180) >= 180);
    for (let i = 0; i + 1 < strip.length; i++) {
      expect(strip[i].zMax).toBe(strip[i + 1].zMin);
    }
    // the columns stack beside the strip: bands may straddle strip rows
    // (the realms kept their sizes when the grid landed), so the invariants
    // are: no two zone rects overlap, and every column shares some z with
    // the strip (an unreachable island would be a bug)
    const x0 = (zn: (typeof ZONES)[number]) => zn.xMin ?? -180;
    const x1 = (zn: (typeof ZONES)[number]) => zn.xMax ?? 180;
    for (const a of ZONES) {
      for (const b of ZONES) {
        if (a.id >= b.id) continue;
        const overlap = x0(a) < x1(b) && x1(a) > x0(b) && a.zMin < b.zMax && a.zMax > b.zMin;
        expect(overlap, `${a.id} and ${b.id} rects must not overlap`).toBe(false);
      }
    }
    const stripMin = strip[0].zMin;
    const stripMax = strip[strip.length - 1].zMax;
    for (const zn of ZONES) {
      if (x0(zn) <= -180 && x1(zn) >= 180) continue;
      expect(
        zn.zMin < stripMax && zn.zMax > stripMin,
        `${zn.id} band overlaps the strip somewhere`,
      ).toBe(true);
    }
    const problems: string[] = [];
    const inWorld = (x: number, z: number) =>
      x > WORLD_MIN_X && x < WORLD_MAX_X && z > WORLD_MIN_Z && z < WORLD_MAX_Z;
    for (const zone of ZONES) {
      expect(zone.hub.z).toBeGreaterThanOrEqual(zone.zMin);
      expect(zone.hub.z).toBeLessThan(zone.zMax);
    }
    for (const npc of Object.values(NPCS)) {
      if (!inWorld(npc.pos.x, npc.pos.z))
        problems.push(`${npc.id} outside world at (${npc.pos.x},${npc.pos.z})`);
    }
    for (const c of CAMPS) {
      if (!inWorld(c.center.x, c.center.z)) problems.push(`camp ${c.mobId} outside world`);
    }
    for (const g of GROUND_OBJECTS) {
      for (const p of g.positions) {
        if (!inWorld(p.x, p.z))
          problems.push(`${g.itemId} sparkle outside world at (${p.x},${p.z})`);
      }
    }
    for (const d of DUNGEON_LIST) {
      if (!inWorld(d.doorPos.x, d.doorPos.z)) problems.push(`${d.id} door outside world`);
    }
    expect(problems).toEqual([]);
  });

  it('every archetype-resolved quest reward is equippable by the receiving class', () => {
    // turnInQuest resolves itemRewards[cls] ?? itemRewards[REWARD_ARCHETYPE[cls]],
    // so the resolved item's class lock must admit every class in the group.
    const problems: string[] = [];
    for (const q of Object.values(QUESTS)) {
      for (const cls of ALL_CLASSES) {
        const itemId = q.itemRewards[cls] ?? q.itemRewards[REWARD_ARCHETYPE[cls]];
        if (!itemId) continue;
        const item = ITEMS[itemId];
        if (!item) continue; // missing items are caught by the integrity test
        if (!canEquipItem(cls, item)) {
          problems.push(`${q.id}: ${cls} receives ${itemId} but cannot equip it`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('roads never dip into deep water (sampled every ~4yd)', () => {
    const problems: string[] = [];
    for (const road of ROADS) {
      for (let i = 0; i + 1 < road.length; i++) {
        const a = road[i],
          b = road[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const h = terrainHeight(x, z, WORLD_SEED);
          if (h < WATER_LEVEL - 0.5) {
            problems.push(
              `road point (${x.toFixed(1)},${z.toFixed(1)}) underwater (h=${h.toFixed(2)})`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('class kits fit the 12-slot action bar and ranks are ordered', () => {
    for (const def of Object.values(CLASSES)) {
      expect(def.abilities.length).toBeGreaterThan(0);
      for (const id of def.abilities) {
        const ab = ABILITIES[id];
        expect(ab, `ability ${id} of ${def.id}`).toBeTruthy();
        expect(ab.learnLevel).toBeLessThanOrEqual(MAX_LEVEL);
        let prev = ab.learnLevel;
        for (const r of ab.ranks ?? []) {
          expect(r.level, `${id} rank ${r.rank} level ordering`).toBeGreaterThanOrEqual(prev);
          prev = r.level;
        }
      }
    }
  });
});

describe('talent row unlock progression', () => {
  const unlockedRowsAt = (level: number): number =>
    CHOICE_ROW_LEVELS.filter((rowLevel) => rowLevel <= level).length;

  it('unlocks rows on the choice-row level schedule', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    for (const level of [1, 4, 5, 7, 8, 11, 14, 17, 20]) {
      sim.setPlayerLevel(level);
      expect(sim.talentPoints().total, `level ${level}`).toBe(unlockedRowsAt(level));
    }
  });

  it('counts spent talents as picked rows, not old rank totals', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    sim.setPlayerLevel(20);
    const r5 = CHOICE_ROWS.warrior.rows[0].options[0].id;
    const r11 = CHOICE_ROWS.warrior.rows[2].options[1].id;
    expect(sim.applyTalents({ spec: null, rows: { 5: r5, 11: r11 } })).toBe(true);
    expect(sim.talentPoints()).toEqual({ total: CHOICE_ROW_LEVELS.length, spent: 2 });
  });
});

describe('xp pacing budget (no forced grinding)', () => {
  // Mirrors the design-spec method: quest XP + estimated kill XP must cover
  // each zone's level band with headroom. Kill estimate: quest-required kills
  // (collect counts divided by drop chance) times a 1.6 travel/overshoot
  // factor, at 45+5*mobLevel each (elites x2).
  function questsForZone(zone: ZoneDef): { xp: number; killXp: number; count: number } {
    let xp = 0,
      killXp = 0,
      count = 0;
    for (const q of Object.values(QUESTS)) {
      const giver = NPCS[q.giverNpcId];
      if (!giver || giver.pos.z < zone.zMin || giver.pos.z >= zone.zMax) continue;
      count++;
      xp += q.xpReward;
      for (const obj of q.objectives) {
        let mobId: string | undefined;
        let kills = 0;
        if (obj.type === 'kill' && obj.targetMobId) {
          mobId = obj.targetMobId;
          kills = obj.count;
        } else if (obj.type === 'collect' && obj.itemId) {
          for (const m of Object.values(MOBS)) {
            const entry = m.loot.find((l) => l.itemId === obj.itemId);
            if (entry) {
              mobId = m.id;
              kills = obj.count / Math.max(0.05, entry.chance);
              break;
            }
          }
        }
        if (!mobId) continue;
        const m = MOBS[mobId];
        const level = (m.minLevel + m.maxLevel) / 2;
        const per = (45 + 5 * level) * (m.elite ? 2 : 1);
        // dungeon kills land at grouped rates (~0.57x solo); soloable kills get the overshoot factor
        const grouped = (q.suggestedPlayers ?? 1) >= 3;
        killXp += kills * per * (grouped ? 0.572 : 1.6);
      }
    }
    return { xp, killXp, count };
  }

  function xpNeeded(fromLevel: number, toLevel: number): number {
    let sum = 0;
    for (let l = fromLevel; l < toLevel; l++) sum += XP_TABLE[l - 1];
    return sum;
  }

  for (const zone of ZONES) {
    it(`${zone.id} covers levels ${zone.levelRange[0]}-${zone.levelRange[1]} with headroom`, () => {
      const budget = questsForZone(zone);
      if (budget.count === 0) return; // zone content not built yet
      const [lo, hi] = zone.levelRange;
      const needed = xpNeeded(lo, hi);
      const available = budget.xp + budget.killXp;
      const headroom = available / needed;
      expect(
        headroom,
        `${zone.id}: quests ${budget.count}, questXp ${budget.xp}, killXp ${Math.round(budget.killXp)}, needed ${needed}`,
      ).toBeGreaterThanOrEqual(1.0);
    });
  }

  it('XP table reaches the level cap', () => {
    expect(XP_TABLE.length).toBeGreaterThanOrEqual(MAX_LEVEL);
    expect(MAX_LEVEL).toBe(20);
  });
});
