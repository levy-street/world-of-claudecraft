import { describe, expect, it } from 'vitest';
import {
  applyFogScenePreset,
  type FogTarget,
  resolveFogScene,
} from '../src/render/fog_scene_state';
import { IGNIVAR_RAID_ENVIRONMENT } from '../src/render/ignivar_raid_environment';
import type { FogSceneState } from '../src/render/interior_light_rig';
import {
  BREATH,
  CLEFT,
  HAMMER_PIT,
  HEART_ROOM,
  QUENCH,
} from '../src/sim/content/smith_heart_layout';
import {
  battlegroundOrigin,
  DUNGEON_LIST,
  delveOrigin,
  instanceOrigin,
  yumiMazeOrigin,
} from '../src/sim/data';

const SEED = 1;

function fogStub(): FogTarget & { hex: number } {
  const stub = {
    hex: -1,
    near: -1,
    far: -1,
    color: {
      setHex(value: number) {
        stub.hex = value;
        return undefined;
      },
    },
  };
  return stub;
}

function interiorPx(interior: string): number {
  const dungeon = DUNGEON_LIST.find((d) => d.interior === interior);
  expect(dungeon, `a dungeon with interior '${interior}'`).toBeDefined();
  if (!dungeon) throw new Error('unreachable');
  return instanceOrigin(dungeon.index, 0).x;
}

describe('resolveFogScene (the renderer fog resolution, moved verbatim)', () => {
  const cam = { x: 0, z: 0 };

  it('resolves the open world, and underwater below the water line', () => {
    expect(resolveFogScene(false, 0, 10000, cam, SEED).desired).toBe('outdoor');
    // The open sea north of the landmass (waterLevelAt reads -4.3 there); a
    // camera above the surface stays outdoor, one below it goes underwater.
    const sea = { x: 0, z: 2000 };
    expect(resolveFogScene(false, 0, 5, sea, SEED).desired).toBe('outdoor');
    expect(resolveFogScene(false, 0, -20, sea, SEED).desired).toBe('underwater');
    // No water body at all: even a deep camera reads outdoor (-Infinity level).
    expect(resolveFogScene(false, 0, -1000, cam, SEED).desired).toBe('outdoor');
  });

  it('resolves each special instance band ahead of the generic dungeon murk', () => {
    // Every one of these positions is also `inside`, so each case is a real
    // precedence assertion against the 'dungeon' fallback arm.
    expect(resolveFogScene(true, delveOrigin(0, 0).x, 5, cam, SEED).desired).toBe('delve');
    expect(resolveFogScene(true, yumiMazeOrigin(0).x, 5, cam, SEED).desired).toBe('yumiMaze');
    expect(resolveFogScene(true, battlegroundOrigin(0).x, 5, cam, SEED).desired).toBe(
      'battleground',
    );
  });

  it('resolves the named interiors, and reports the interior for the prewarm seam', () => {
    // The five-dungeon rework moved each reworked dungeon onto its own
    // open-air interior and fog state (the legacy 'temple' interior is gone).
    expect(resolveFogScene(true, interiorPx('drowned_temple'), 5, cam, SEED).desired).toBe(
      'drownedTemple',
    );
    expect(resolveFogScene(true, interiorPx('hollow_crypt'), 5, cam, SEED).desired).toBe(
      'hollowCrypt',
    );
    expect(resolveFogScene(true, interiorPx('sunken_bastion'), 5, cam, SEED).desired).toBe(
      'sunkenBastion',
    );
    // The Smith's Heart's main map borrows the Bastion's storm-dusk state;
    // its Heart (the separate final room) has its own ember-night state, its
    // Hammer vein its own quarry dusk and the Ring its own (phase 2F), each
    // read from where the camera stands in the slot.
    const heart = DUNGEON_LIST.find((d) => d.id === 'smith_heart');
    if (!heart) throw new Error('no smith_heart dungeon');
    const slotOrigin = instanceOrigin(heart.index, 2);
    const inHeart = { x: slotOrigin.x + HEART_ROOM.x, z: slotOrigin.z + HEART_ROOM.z };
    const onRing = { x: slotOrigin.x, z: slotOrigin.z + 70 };
    const inQuarry = { x: slotOrigin.x + HAMMER_PIT.x, z: slotOrigin.z + HAMMER_PIT.z };
    const atCleft = { x: slotOrigin.x + CLEFT.x, z: slotOrigin.z + CLEFT.z };
    expect(resolveFogScene(true, slotOrigin.x, 5, inHeart, SEED).desired).toBe('smithHeartCore');
    expect(resolveFogScene(true, slotOrigin.x, 5, onRing, SEED).desired).toBe('smithHeartRing');
    // The camera standing back past the Ring's rim still sees it in its own light.
    const pastRim = { x: slotOrigin.x, z: slotOrigin.z + 96 };
    expect(resolveFogScene(true, slotOrigin.x, 5, pastRim, SEED).desired).toBe('smithHeartRing');
    // The Quench has its own cold lake light (phase 2H): the Frozen Lake,
    // the Singing Ice, and east of the Ring past its mouth (the first
    // landing, a camera standing back from it) over the Ring's.
    const inQuench = { x: slotOrigin.x + QUENCH.lake.x, z: slotOrigin.z + QUENCH.lake.z };
    expect(resolveFogScene(true, slotOrigin.x, 5, inQuench, SEED).desired).toBe('smithHeartQuench');
    for (const [x, z] of [
      [156, -86],
      [110, 0],
      [101, 4],
    ]) {
      const at = { x: slotOrigin.x + x, z: slotOrigin.z + z };
      expect(resolveFogScene(true, slotOrigin.x, 5, at, SEED).desired).toBe('smithHeartQuench');
    }
    // The Quench's mouth on the Ring keeps the Ring's light.
    const atMouth = { x: slotOrigin.x + 84, z: slotOrigin.z };
    expect(resolveFogScene(true, slotOrigin.x, 5, atMouth, SEED).desired).toBe('smithHeartRing');
    // The Heat has the Hearth's own light (phase 2I): the Forge, the casting
    // floor, the hall past the Ring's rim; its mouth on the Ring keeps the
    // Ring's.
    for (const [x, z] of [
      [-214, 0],
      [-150, 20],
      [-100, 0],
    ]) {
      const at = { x: slotOrigin.x + x, z: slotOrigin.z + z };
      expect(resolveFogScene(true, slotOrigin.x, 5, at, SEED).desired).toBe('smithHeartHeat');
    }
    const atHeatMouth = { x: slotOrigin.x - 70, z: slotOrigin.z };
    expect(resolveFogScene(true, slotOrigin.x, 5, atHeatMouth, SEED).desired).toBe(
      'smithHeartRing',
    );
    // The Breath has its own storm summit light (phase 2G), the Cornice and
    // the Wind Bridge both.
    const onCornice = { x: slotOrigin.x + BREATH.cornice.x, z: slotOrigin.z + BREATH.cornice.z };
    const onBridge = { x: slotOrigin.x - 84, z: slotOrigin.z + 140 };
    expect(resolveFogScene(true, slotOrigin.x, 5, onCornice, SEED).desired).toBe(
      'smithHeartBreath',
    );
    expect(resolveFogScene(true, slotOrigin.x, 5, onBridge, SEED).desired).toBe('smithHeartBreath');
    // North of the Ring past its mouth (the first landing, the chimney) the
    // Breath's light wins over the Ring's.
    for (const [x, z] of [
      [0, 106],
      [-30, 110],
    ]) {
      const at = { x: slotOrigin.x + x, z: slotOrigin.z + z };
      expect(resolveFogScene(true, slotOrigin.x, 5, at, SEED).desired).toBe('smithHeartBreath');
    }
    expect(resolveFogScene(true, slotOrigin.x, 5, inQuarry, SEED).desired).toBe('smithHeartHammer');
    expect(resolveFogScene(true, slotOrigin.x, 5, atCleft, SEED).desired).toBe('smithHeartHammer');
    expect(resolveFogScene(true, interiorPx('gravewyrm_sanctum'), 5, cam, SEED).desired).toBe(
      'gravewyrmSanctum',
    );
    expect(resolveFogScene(true, interiorPx('nythraxis'), 5, cam, SEED).desired).toBe('nythraxis');
    expect(resolveFogScene(true, interiorPx('wildheart'), 5, cam, SEED).desired).toBe(
      'wildheartBasin',
    );
    expect(resolveFogScene(true, interiorPx('lastkeep'), 5, cam, SEED).desired).toBe('lastkeep');
    expect(resolveFogScene(true, interiorPx('dawnhold'), 5, cam, SEED).desired).toBe('dawnhold');
    const approach = resolveFogScene(true, interiorPx('ignivar_approach'), 5, cam, SEED);
    expect(approach.desired).toBe('ignivarApproach');
    expect(approach.interior).toBe('ignivar_approach');
    expect(resolveFogScene(true, interiorPx('ignivar'), 5, cam, SEED).desired).toBe('ignivar');
    expect(resolveFogScene(true, interiorPx('ignivar_depths'), 5, cam, SEED).desired).toBe(
      'varkhul',
    );
  });

  it('falls back to the crypt murk for an interior with no bespoke fog state', () => {
    const crypt = resolveFogScene(true, interiorPx('crypt'), 5, cam, SEED);
    expect(crypt.desired).toBe('dungeon');
    expect(crypt.interior).toBe('crypt');
  });
});

describe('applyFogScenePreset (the renderer fog presets, moved verbatim)', () => {
  const raid = (state: 'ignivarApproach' | 'ignivar' | 'varkhul') => {
    const profile = IGNIVAR_RAID_ENVIRONMENT[state];
    return [profile.fogColor, profile.fogNear, profile.fogFar] as const;
  };
  const cases: ReadonlyArray<readonly [FogSceneState, number, number, number]> = [
    ['dungeon', 0x05060a, 18, 90],
    ['temple', 0x0a3a44, 12, 78],
    ['nythraxis', 0x020106, 20, 80],
    ['ignivarApproach', ...raid('ignivarApproach')],
    ['ignivar', ...raid('ignivar')],
    ['varkhul', ...raid('varkhul')],
    ['wildheartBasin', 0xbfb98a, 150, 1050],
    ['gravewyrmSanctum', 0x3d5a82, 90, 980],
    ['hollowCrypt', 0x1c2238, 70, 460],
    ['sunkenBastion', 0x4d5a57, 70, 640],
    ['smithHeartCore', 0x1c1424, 80, 520],
    ['smithHeartHammer', 0x6c6c70, 90, 600],
    ['smithHeartRing', 0x686a72, 120, 700],
    ['smithHeartBreath', 0x707b88, 80, 560],
    ['smithHeartQuench', 0x8899ac, 70, 520],
    ['smithHeartHeat', 0x6e645c, 80, 560],
    ['drownedTemple', 0x252a4c, 140, 1050],
    ['lastkeep', 0x241610, 30, 150],
    ['dawnhold', 0x3d422a, 40, 190],
    ['delve', 0x0e0705, 14, 74],
    ['yumiMaze', 0x161d31, 30, 170],
    ['battleground', 0xaecbe0, 70, 210],
    ['underwater', 0x17506e, 2, 48],
  ];

  it.each(cases)(
    '%s sets its authored triple without touching the outdoor preset',
    (state, color, near, far) => {
      const fog = fogStub();
      let outdoorCalls = 0;
      applyFogScenePreset(state, fog, () => {
        outdoorCalls++;
        return { color: 0x123456, near: 7, far: 89 };
      });
      expect({ hex: fog.hex, near: fog.near, far: fog.far }).toEqual({ hex: color, near, far });
      expect(outdoorCalls).toBe(0);
    },
  );

  it('outdoor takes the caller-graded preset through the thunk, exactly once', () => {
    const fog = fogStub();
    let outdoorCalls = 0;
    applyFogScenePreset('outdoor', fog, () => {
      outdoorCalls++;
      return { color: 0x123456, near: 7, far: 89 };
    });
    expect({ hex: fog.hex, near: fog.near, far: fog.far }).toEqual({
      hex: 0x123456,
      near: 7,
      far: 89,
    });
    expect(outdoorCalls).toBe(1);
  });
});
