// Content integration checks: referential integrity across the merged
// content tables, and the XP pacing budget that keeps leveling 1-20 free of
// forced grinding. These tests are content-shape tests — they run against
// whatever the content modules currently export, so they hold as zones grow.
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CAMPS,
  CLASSES,
  DUNGEON_LIST,
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
import { ALL_CLASSES, MAX_LEVEL, XP_TABLE, type ZoneDef } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

const WORLD_SEED = 20061; // production seed (main.ts / server/game.ts)
// chunk_of_ore (q_prof_intro): granted by an ore-node harvest while the quest
// is active (NODE_QUEST_GRANT, src/sim/professions/gathering.ts), not by mob
// loot or a ground object.
const SCRIPTED_COLLECT_ITEMS = new Set(['the_codfather', 'chunk_of_ore']);

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
        const fromLoot = Object.values(MOBS).some((m) =>
          m.loot.some((l) => l.itemId === obj.itemId),
        );
        const fromGround = GROUND_OBJECTS.some((g) => g.itemId === obj.itemId);
        const fromScript = SCRIPTED_COLLECT_ITEMS.has(obj.itemId);
        if (!fromLoot && !fromGround && !fromScript)
          problems.push(`${q.id}: ${obj.itemId} has no acquisition source`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('QUEST_ORDER covers every quest exactly once', () => {
    expect([...QUEST_ORDER].sort()).toEqual(Object.keys(QUESTS).sort());
    expect(new Set(QUEST_ORDER).size).toBe(QUEST_ORDER.length);
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

  it('zones tile the world strip and content sits inside its zone band', () => {
    for (let i = 0; i + 1 < ZONES.length; i++) {
      expect(ZONES[i].zMax).toBe(ZONES[i + 1].zMin);
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
