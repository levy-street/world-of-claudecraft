import { describe, expect, it } from 'vitest';
import {
  applyFogScenePreset,
  type FogTarget,
  resolveFogScene,
} from '../src/render/fog_scene_state';
import { IGNIVAR_RAID_ENVIRONMENT } from '../src/render/ignivar_raid_environment';
import type { FogSceneState } from '../src/render/interior_light_rig';
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
    expect(resolveFogScene(true, interiorPx('temple'), 5, cam, SEED).desired).toBe('temple');
    expect(resolveFogScene(true, interiorPx('nythraxis'), 5, cam, SEED).desired).toBe('nythraxis');
    expect(resolveFogScene(true, interiorPx('wildheart'), 5, cam, SEED).desired).toBe(
      'wildheartField',
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
    ['wildheartField', 0x8ca786, 105, 430],
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
