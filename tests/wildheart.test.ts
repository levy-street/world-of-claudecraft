// The Wildheart Basin is Palmreach's open-field jungle dungeon. This suite
// pins its authored roster, radial route, overflow instance band, shared
// terrain and collision contract, Heroic tuning, and appended deed pair.

import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { resolvePosition } from '../src/sim/colliders';
import { DEEDS } from '../src/sim/content/deeds';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import {
  WILDHEART_DUNGEON_DEFS,
  WILDHEART_ITEMS,
  WILDHEART_MOBS,
} from '../src/sim/content/wildheart';
import {
  BUILTIN_WORLD,
  DUNGEON_OVERFLOW_X_BASE,
  DUNGEONS,
  dungeonAt,
  ITEMS,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  MOBS,
  YUMI_BAND_X_MAX,
  zoneAt,
} from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import {
  WILDHEART_FIELD_BOUNDS,
  WILDHEART_FIELD_COLLIDER_SPECS,
  WILDHEART_FIELD_PLACEMENTS,
  wildheartFieldHeight,
} from '../src/sim/wildheart_field';
import { groundHeight } from '../src/sim/world';

const WILDHEART_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 91): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WILDHEART_TEST_WORLD });
}

describe('Wildheart Basin dungeon content', () => {
  it('registers a five-player open-field dungeon beside the Sunken Idol in Palmreach', () => {
    const def = DUNGEONS.wildheart_basin;
    expect(def).toMatchObject({
      name: 'The Wildheart Basin',
      index: 7,
      interior: 'wildheart',
      suggestedPlayers: 5,
    });
    expect(zoneAt(def.doorPos.x, def.doorPos.z).id).toBe('palmreach');
    const indices = Object.values(DUNGEONS).map((dungeon) => dungeon.index);
    expect(indices.filter((index) => index === def.index)).toHaveLength(1);
  });

  it('defines five distinct, fully registered savage troll combat roles', () => {
    expect(Object.keys(WILDHEART_MOBS).sort()).toEqual([
      'wildheart_beastmaster',
      'wildheart_hexcaller',
      'wildheart_high_priest',
      'wildheart_ravager',
      'wildheart_stalker',
    ]);
    for (const id of Object.keys(WILDHEART_MOBS)) {
      expect(MOBS[id], `${id} reaches MOBS`).toBeDefined();
      expect(MOBS[id].family).toBe('troll');
      expect(MOBS[id].elite).toBe(true);
    }
    expect(MOBS.wildheart_stalker.petSpell?.name).toBe('Razorvine Spear');
    expect(MOBS.wildheart_ravager.bleed?.name).toBe('Bloodmane Rend');
    expect(MOBS.wildheart_hexcaller.mendAlly?.name).toBe('Ancestral Sap');
    expect(MOBS.wildheart_beastmaster).toMatchObject({ rare: true, ccImmune: true });
    expect(MOBS.wildheart_beastmaster.warcry?.name).toBe('Call of the Hunt');
    for (const id of Object.keys(WILDHEART_MOBS)) {
      const visual = VISUALS[`mob_${id}`];
      expect(visual?.yaw, `${id} faces the game +Z movement axis`).toBe(-Math.PI / 2);
      expect(visual?.clips.run, `${id} carries its run clip`).toBe('Run');
    }
  });

  it('makes Zulgar the sole final boss with arena-scale mechanics and three epics', () => {
    const boss = MOBS.wildheart_high_priest;
    expect(boss).toMatchObject({ boss: true, elite: true, ccImmune: true });
    expect(boss.aoePulse?.name).toBe('Wildheart Pulse');
    expect(boss.knockback?.name).toBe('Jaguar Roar');
    expect(boss.enrage?.belowHpPct).toBe(0.3);
    const epicIds = Object.keys(WILDHEART_ITEMS).sort();
    expect(epicIds).toEqual([
      'wildheart_fangknife',
      'wildheart_hexwood_staff',
      'wildheart_tuskblade',
    ]);
    for (const id of epicIds) {
      expect(ITEMS[id].quality).toBe('epic');
      expect(boss.loot?.some((drop) => drop.itemId === id)).toBe(true);
    }
  });

  it('populates both banks, two rare encounters, and one deepest shrine boss', () => {
    const spawns = WILDHEART_DUNGEON_DEFS.wildheart_basin.spawns;
    expect(spawns).toHaveLength(20);
    for (const spawn of spawns) expect(spawn.mobId.startsWith('wildheart_')).toBe(true);
    expect(spawns.filter((spawn) => spawn.mobId === 'wildheart_beastmaster')).toHaveLength(2);
    const bosses = spawns.filter((spawn) => spawn.mobId === 'wildheart_high_priest');
    expect(bosses).toHaveLength(1);
    expect(bosses[0].z).toBe(Math.max(...spawns.map((spawn) => spawn.z)));
    expect(spawns.some((spawn) => spawn.x < -20)).toBe(true);
    expect(spawns.some((spawn) => spawn.x > 20)).toBe(true);
  });

  it('keeps combat spawns inside the field and clear of blocking props', () => {
    for (const spawn of WILDHEART_DUNGEON_DEFS.wildheart_basin.spawns) {
      expect(spawn.x).toBeGreaterThanOrEqual(WILDHEART_FIELD_BOUNDS.minX);
      expect(spawn.x).toBeLessThanOrEqual(WILDHEART_FIELD_BOUNDS.maxX);
      expect(spawn.z).toBeGreaterThanOrEqual(WILDHEART_FIELD_BOUNDS.minZ);
      expect(spawn.z).toBeLessThanOrEqual(WILDHEART_FIELD_BOUNDS.maxZ);
      const clearance = Math.min(
        ...WILDHEART_FIELD_COLLIDER_SPECS.map(
          (spec) => Math.hypot(spawn.x - spec.x, spawn.z - spec.z) - spec.r,
        ),
      );
      expect(clearance, `${spawn.mobId} at ${spawn.x},${spawn.z}`).toBeGreaterThan(4);
    }
  });

  it('spawns all five roles when a party claims the instance', () => {
    const sim = makeSim();
    const playerId = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', playerId)).toBe(true);
    const instance = (
      sim.instances as { dungeonId: string; partyKey: unknown; mobIds: number[] }[]
    ).find((candidate) => candidate.dungeonId === 'wildheart_basin' && candidate.partyKey !== null);
    expect(instance).toBeDefined();
    if (!instance) throw new Error('Wildheart instance was not claimed');
    const templates = instance.mobIds
      .map((id) => sim.entities.get(id))
      .filter((entity): entity is Entity => !!entity)
      .map((entity) => entity.templateId);
    for (const id of Object.keys(WILDHEART_MOBS)) expect(templates).toContain(id);
  });

  it('uses the overflow band without reclassifying any existing instance system', () => {
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    expect(origin.x).toBe(DUNGEON_OVERFLOW_X_BASE);
    expect(origin.x).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX + 1000);
    expect(dungeonAt(origin.x)?.id).toBe('wildheart_basin');
    expect(isArenaPos(origin.x)).toBe(false);
    expect(isDelvePos(origin.x)).toBe(false);
    expect(isRiftPos(origin.x)).toBe(false);
    expect(isYumiMazePos(origin.x)).toBe(false);
    for (const existing of Object.values(DUNGEONS).filter((dungeon) => dungeon.index < 7)) {
      expect(instanceOrigin(existing.index, 0).x).toBeLessThan(DUNGEON_OVERFLOW_X_BASE - 1000);
      expect(dungeonAt(instanceOrigin(existing.index, 0).x)?.id).toBe(existing.id);
    }
  });

  it('routes collision and shared height through the Wildheart interior', () => {
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    const spec = WILDHEART_FIELD_COLLIDER_SPECS.find(
      (candidate) => candidate.kind === 'wildheart_mask_totem',
    );
    if (!spec) throw new Error('Wildheart mask totem collider is missing');
    const probe = { x: origin.x + spec.x + 0.2, z: origin.z + spec.z };
    const resolved = resolvePosition(1, probe.x, probe.z, 1);
    expect(Math.hypot(resolved.x - probe.x, resolved.z - probe.z)).toBeGreaterThan(0.5);

    for (const [x, z] of [
      [0, -5],
      [-37, 96],
      [0, 132],
      [0, 213],
    ] as const) {
      expect(groundHeight(origin.x + x, origin.z + z, 1)).toBeCloseTo(
        wildheartFieldHeight(x, z),
        10,
      );
    }
    expect(wildheartFieldHeight(0, 213)).toBeGreaterThan(wildheartFieldHeight(0, 104) + 7);
  });

  it('derives visible prop collisions from the single authored placement table', () => {
    expect(WILDHEART_FIELD_PLACEMENTS.length).toBeGreaterThanOrEqual(45);
    const blockingKinds = new Set(WILDHEART_FIELD_COLLIDER_SPECS.map((spec) => spec.kind));
    expect(blockingKinds).toEqual(
      new Set([
        'wildheart_beast_den',
        'wildheart_canopy_platform',
        'wildheart_ancestor_ruin',
        'wildheart_jaguar_gate',
        'wildheart_jungle_canopy_tree',
        'wildheart_mask_totem',
        'wildheart_ritual_pyramid',
      ]),
    );
  });

  it('ships Heroic tuning and an append-only normal plus Heroic deed pair', () => {
    expect(HEROIC_DUNGEON_TUNING.wildheart_basin).toMatchObject({
      level: 22,
      finalBossId: 'wildheart_high_priest',
      marksPerParticipant: 1,
    });
    expect(DEEDS.dgn_wildheart_basin.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'wildheart_basin',
      count: 1,
    });
    expect(DEEDS.dgn_wildheart_basin_heroic.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'wildheart_basin',
      difficulty: 'heroic',
      count: 1,
    });
  });
});
