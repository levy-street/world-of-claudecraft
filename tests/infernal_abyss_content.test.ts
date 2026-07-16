import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_LIST, DUNGEONS, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { weaponDpsBudget } from '../src/sim/item_budget';
import { itemLevel } from '../src/sim/item_level';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/locomotion';

const DUNGEON_ID = 'infernal_abyss';
const QUEST_IDS = [
  'q_infernal_abyss_echoes',
  'q_infernal_abyss_covenant',
  'q_infernal_abyss_azazel',
] as const;

describe('Infernal Abyss content', () => {
  it('registers a unique level 20 five-player dungeon at index 6', () => {
    const dungeon = DUNGEONS[DUNGEON_ID];
    expect(dungeon).toMatchObject({
      id: DUNGEON_ID,
      name: 'Molten Abyss',
      index: 6,
      interior: 'infernal_abyss',
      suggestedPlayers: 5,
      entry: { x: 0, z: -10 },
    });
    expect(DUNGEON_LIST.filter((candidate) => candidate.index === 6)).toHaveLength(1);
    expect(dungeon.doorPos.z).toBeGreaterThanOrEqual(700);
  });

  it('builds the intended room progression and keeps the entry safe', () => {
    const dungeon = DUNGEONS[DUNGEON_ID];
    const zPositions = dungeon.spawns.map((spawn) => spawn.z);
    expect(zPositions.some((z) => z >= 30 && z <= 75)).toBe(true);
    expect(zPositions.some((z) => z >= 85 && z <= 105)).toBe(true);
    expect(dungeon.spawns.some((spawn) => spawn.x >= 20 && spawn.z >= 67)).toBe(true);
    expect(zPositions.some((z) => z >= 145 && z <= 170)).toBe(true);
    expect(dungeon.spawns).toContainEqual({ mobId: 'pyre_golem', x: -64, z: 84 });
    expect(dungeon.spawns).toContainEqual({ mobId: 'azazel_infernal_lord', x: 0, z: 224 });

    for (const spawn of dungeon.spawns) {
      const distance = Math.hypot(spawn.x - dungeon.entry.x, spawn.z - dungeon.entry.z);
      expect(distance, `${spawn.mobId} is too close to the entry`).toBeGreaterThanOrEqual(
        MAX_AGGRO_RADIUS,
      );
    }
  });

  it('provides two minibosses and a fully scripted final boss', () => {
    expect(MOBS.pyre_golem).toMatchObject({ minLevel: 20, maxLevel: 20, elite: true });
    expect(MOBS.pyre_golem.stomp).toBeDefined();
    expect(MOBS.forgekeeper).toMatchObject({ minLevel: 20, maxLevel: 20, elite: true });
    expect(MOBS.forgekeeper.bigCast).toBeDefined();

    const azazel = MOBS.azazel_infernal_lord;
    expect(azazel).toMatchObject({ minLevel: 20, maxLevel: 20, elite: true, boss: true });
    // Literal pins for the whole encounter script: any retune reds this test
    // deliberately (the values are the design-doc numbers, not derived).
    expect(azazel.bigCast).toMatchObject({
      castId: 'azazel_apocalypse_flame',
      castTime: 3,
      every: 18,
      radius: 17,
      min: 42,
      max: 58,
      school: 'fire',
    });
    expect(azazel.aoePulse).toMatchObject({
      min: 30,
      max: 42,
      radius: 13,
      every: 9,
      school: 'fire',
    });
    expect(azazel.stomp).toMatchObject({
      radius: 11,
      every: 15,
      duration: 1.5,
      min: 24,
      max: 34,
      school: 'fire',
    });
    expect(azazel.summonAdds).toMatchObject({
      mobId: 'infernal_cinderling',
      count: 3,
      atHpPct: [0.7, 0.4],
    });
    expect(azazel.terrify).toMatchObject({ radius: 14, every: 20, duration: 3, school: 'shadow' });
    expect(azazel.enrage).toEqual({ belowHpPct: 0.2, dmgMult: 1.6, hasteMult: 1.3 });
    expect(azazel.yells).toMatchObject({ engage: expect.any(String), enrage: expect.any(String) });
  });

  it('only references complete mob and item records from spawns, loot, and rewards', () => {
    const dungeon = DUNGEONS[DUNGEON_ID];
    for (const spawn of dungeon.spawns) {
      expect(MOBS[spawn.mobId], `missing spawn mob ${spawn.mobId}`).toBeDefined();
    }

    for (const mobId of new Set(dungeon.spawns.map((spawn) => spawn.mobId))) {
      for (const loot of MOBS[mobId].loot) {
        if (loot.itemId) expect(ITEMS[loot.itemId], `${mobId}: ${loot.itemId}`).toBeDefined();
      }
    }

    for (const questId of QUEST_IDS) {
      for (const itemId of Object.values(QUESTS[questId].itemRewards)) {
        expect(ITEMS[itemId], `${questId}: ${itemId}`).toBeDefined();
      }
    }
  });

  it('keeps the Azazel armor roll group guaranteed (chances sum to exactly 1)', () => {
    // 0.34 + 0.33 + 0.33: a typo in any row silently turns the guaranteed
    // armor drop into a sometimes-nothing roll, so pin the exact sum.
    const rows = MOBS.azazel_infernal_lord.loot.filter(
      (row) => row.rollGroup === 'azazel_guaranteed_armor',
    );
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(1, 10);
  });

  it('registers Caddis three-step lore chain across four dungeon objects and Azazel', () => {
    expect(NPCS.loremaster_caddis.questIds).toEqual(expect.arrayContaining([...QUEST_IDS]));
    expect(QUESTS[QUEST_IDS[0]].requiresQuest).toBeUndefined();
    expect(QUESTS[QUEST_IDS[1]].requiresQuest).toBe(QUEST_IDS[0]);
    expect(QUESTS[QUEST_IDS[2]].requiresQuest).toBe(QUEST_IDS[1]);

    const loreObjectives = QUEST_IDS.slice(0, 2).flatMap((questId) =>
      QUESTS[questId].objectives.filter((objective) => objective.type === 'interact'),
    );
    expect(loreObjectives).toHaveLength(4);
    const objectIds = loreObjectives.map((objective) => objective.targetObjectItemId);
    expect(new Set(objectIds).size).toBe(4);

    const dungeonObjects = DUNGEONS[DUNGEON_ID].objects ?? [];
    for (const itemId of objectIds) {
      expect(itemId).toBeTypeOf('string');
      if (!itemId) continue;
      expect(ITEMS[itemId], `missing lore item ${itemId}`).toBeDefined();
      expect(dungeonObjects.some((object) => object.itemId === itemId)).toBe(true);
    }
    expect(QUESTS[QUEST_IDS[2]].objectives).toContainEqual(
      expect.objectContaining({ type: 'kill', targetMobId: 'azazel_infernal_lord', count: 1 }),
    );
  });

  it('pins the de-IP display names to literals (the ip_scrub renames)', () => {
    // These are the strings the G0 Infernal rename produced; world_entity_i18n
    // derives its English from these same records, so only an inline literal
    // catches a rename regression.
    expect(MOBS.azazel_infernal_lord.name).toBe('Azazel the Abyssal Lord');
    expect(MOBS.infernal_cinderling.name).toBe('Abyssal Cinderling');
    expect(ITEMS.infernal_slag.name).toBe('Abyssal Slag');
    expect(QUESTS.q_infernal_abyss_azazel.name).toBe('Lord of the Molten Abyss');
  });

  it('keeps every dungeon weapon on the weaponDpsBudget curve', () => {
    const weaponIds = [
      'forgekeepers_warhammer',
      'forgekeepers_runestaff',
      'forgekeepers_fang',
      'azazels_ruinblade',
      'azazels_soulstaff',
      'azazels_emberfang',
    ];
    for (const id of weaponIds) {
      const item = ITEMS[id];
      const weapon = item.weapon;
      expect(weapon, `${id} is a weapon`).toBeDefined();
      if (!weapon) continue;
      const level = itemLevel(item);
      expect(level, `${id} has an item level`).toBeDefined();
      if (level === undefined) continue;
      const dps = (weapon.min + weapon.max) / 2 / weapon.speed;
      // Rounding min/max to integers can land ~0.5 dps off the exact curve.
      expect(
        Math.abs(dps - weaponDpsBudget(level)),
        `${id} dps ${dps.toFixed(2)} vs budget ${weaponDpsBudget(level).toFixed(2)}`,
      ).toBeLessThan(0.6);
    }
  });

  it('carries a heroic tuning entry on the equalized five-man ladder', () => {
    const tuning = HEROIC_DUNGEON_TUNING[DUNGEON_ID];
    expect(tuning).toMatchObject({
      id: DUNGEON_ID,
      difficulty: 'heroic',
      level: 22,
      finalBossId: 'azazel_infernal_lord',
      marksPerParticipant: 1,
    });
    // The final boss the marks/lockout key on must actually spawn in the dungeon.
    expect(DUNGEONS[DUNGEON_ID].spawns.some((s) => s.mobId === tuning.finalBossId)).toBe(true);
    // Damage equalization inverts the multiplier ladder: this dungeon has the
    // biggest base weapon damage of the five-mans, so its multiplier must sit
    // strictly below gravewyrm_sanctum's (the previous smallest).
    expect(tuning.damageMultiplier).toBeGreaterThan(1);
    expect(tuning.damageMultiplier).toBeLessThan(
      HEROIC_DUNGEON_TUNING.gravewyrm_sanctum.damageMultiplier,
    );
    expect(tuning.healthMultiplier).toBeGreaterThan(1);
    expect(tuning.armorMultiplier).toBeGreaterThan(1);
  });
});
