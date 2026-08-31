import { describe, expect, it } from 'vitest';

import { DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';

const MINI = {
  healthMultiplier: 2.35,
  scale: 2.75,
  ccImmune: true,
  slowImmune: true,
};

describe('restored Ignivar pre-boss rooms', () => {
  it('keeps every Approach position and formation while replacing only its two healers', () => {
    const approach = DUNGEONS[IGNIVAR_FORGE_APPROACH_ID];
    expect(approach.interior).toBe('ignivar_approach');
    expect(approach.spawns).toEqual([
      { mobId: 'derelict_mech', x: -16, z: -17, facing: 0, packId: 'approach_1' },
      { mobId: 'derelict_mech', x: -14.3, z: -14, facing: -2.09, packId: 'approach_1' },
      {
        mobId: IGNIVAR_EMBER_SENTINEL_ID,
        x: -17.7,
        z: -14,
        facing: 2.09,
        idleStationary: true,
        packId: 'approach_1',
      },
      { mobId: 'derelict_mech', x: 13, z: 2, facing: 0, packId: 'approach_2' },
      { mobId: 'derelict_mech', x: 14.7, z: 5, facing: -2.09, packId: 'approach_2' },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: 11.3,
        z: 5,
        facing: 2.09,
        idleStationary: true,
        packId: 'approach_2',
      },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: -21,
        z: 7,
        facing: 0,
        idleStationary: true,
        packId: 'approach_3',
        miniboss: MINI,
      },
      { mobId: 'derelict_mech', x: -19.3, z: 10, facing: -2.09, packId: 'approach_3' },
      { mobId: 'derelict_mech', x: -22.7, z: 10, facing: 2.09, packId: 'approach_3' },
      { mobId: 'derelict_mech', x: 19, z: 39.7, facing: 0, packId: 'approach_4' },
      { mobId: 'derelict_mech', x: 21.3, z: 42, facing: -1.57, packId: 'approach_4' },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: 19,
        z: 44.3,
        facing: -3.14,
        idleStationary: true,
        packId: 'approach_4',
      },
      {
        mobId: IGNIVAR_EMBER_SENTINEL_ID,
        x: 16.7,
        z: 42,
        facing: 1.57,
        idleStationary: true,
        packId: 'approach_4',
      },
      { mobId: 'derelict_mech', x: -22, z: 39.4, facing: 0, packId: 'approach_5' },
      { mobId: 'derelict_mech', x: -19.5, z: 41.2, facing: -1.26, packId: 'approach_5' },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: -20.5,
        z: 44.1,
        facing: -2.51,
        idleStationary: true,
        packId: 'approach_5',
      },
      {
        mobId: IGNIVAR_EMBER_SENTINEL_ID,
        x: -23.5,
        z: 44.1,
        facing: 2.51,
        idleStationary: true,
        packId: 'approach_5',
      },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: -24.5,
        z: 41.2,
        facing: 1.26,
        idleStationary: true,
        packId: 'approach_5',
        miniboss: MINI,
      },
    ]);
    expect(approach.spawns.some((spawn) => spawn.mobId === IGNIVAR_CINDER_ARTIFICER_ID)).toBe(
      false,
    );
  });

  it('restores Molten Assembly on the existing Approach visual with three authored packs', () => {
    const assembly = DUNGEONS[IGNIVAR_MOLTEN_ASSEMBLY_ID];
    expect(assembly).toMatchObject({
      id: IGNIVAR_MOLTEN_ASSEMBLY_ID,
      index: 13,
      overworldDoor: false,
      guideVisible: false,
      interior: 'ignivar_approach',
      entry: { x: 0, z: -50 },
      exitOffset: { x: 0, z: -54 },
    });
    expect(assembly.mobDifficultyTuningId).toBeUndefined();
    expect(assembly.spawns).toEqual([
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: -5, z: -24, packId: 'intake' },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: -22, packId: 'intake' },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 5, z: -24, packId: 'intake' },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: -5, z: 4, packId: 'middle' },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: 6, packId: 'middle' },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 5, z: 4, packId: 'middle' },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: -5,
        z: 31,
        packId: 'final',
        miniboss: MINI,
      },
      { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: 33, packId: 'final' },
      {
        mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        x: 5,
        z: 31,
        packId: 'final',
        miniboss: MINI,
      },
    ]);
    expect(assembly.spawns.some((spawn) => spawn.mobId === IGNIVAR_CINDER_ARTIFICER_ID)).toBe(
      false,
    );
    expect(assembly.objects?.at(-1)).toMatchObject({
      dungeonId: IGNIVAR_SECOND_WING_ID,
      x: 0,
      z: 53,
    });
  });

  it.each([
    { roomId: IGNIVAR_FORGE_APPROACH_ID, minibosses: 2, packs: 5 },
    { roomId: IGNIVAR_MOLTEN_ASSEMBLY_ID, minibosses: 2, packs: 3 },
  ])('applies the authored miniboss and pack markers when claiming $roomId', (fixture) => {
    const sim = new Sim({ seed: 7431, playerClass: 'warrior', devCommands: true });
    sim.chat(`/dev dungeon ${fixture.roomId} normal`);
    const claim = sim.instances.find(
      (instance) => instance.dungeonId === fixture.roomId && instance.partyKey !== null,
    );
    if (!claim) throw new Error(`${fixture.roomId} claim did not form`);
    const mobs = claim.mobIds.flatMap((id) => {
      const mob = sim.entities.get(id);
      return mob ? [mob] : [];
    });
    const minibosses = mobs.filter((mob) => mob.dungeonSpawnMiniboss);
    expect(minibosses).toHaveLength(fixture.minibosses);
    for (const miniboss of minibosses) {
      expect(miniboss).toMatchObject({
        scale: 2.75,
        ccImmune: true,
        slowImmune: true,
        stompTimer: 6,
        bigCastTimer: Number.MAX_SAFE_INTEGER,
      });
    }
    expect(new Set(mobs.map((mob) => mob.dungeonPackId))).toHaveLength(fixture.packs);
    expect(mobs.every((mob) => mob.dungeonPackId?.startsWith(`${fixture.roomId}:`))).toBe(true);

    const ordinaryWardens = mobs.filter(
      (mob) => mob.templateId === IGNIVAR_CRUCIBLE_WARDEN_ID && !mob.dungeonSpawnMiniboss,
    );
    if (fixture.roomId === IGNIVAR_FORGE_APPROACH_ID) {
      expect(ordinaryWardens).toHaveLength(3);
      expect(ordinaryWardens.every((mob) => !mob.ccImmune && !mob.slowImmune)).toBe(true);
    }
  });
});
