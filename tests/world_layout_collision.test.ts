import { afterEach, describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import { placementsToPlayAssets } from '../src/editor/custom_map';
import { compileLayoutCollision } from '../src/editor/world_layout_collision';
import type { Collider } from '../src/sim/collider_shapes';
import { pushPlacementColliders } from '../src/sim/colliders_authored/placement_colliders';
import { authoredMapActive, BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { MapDoc, MapPlacement } from '../src/sim/map_doc';
import { placeLayoutScenery } from '../src/sim/world_layout/scenery';
import { WORLD_SEED } from '../src/sim/world_seed';

const baseline: MapPlacement = {
  assetId: 'props/rock_large_d',
  x: 10,
  z: 20,
  y: -0.12,
  rotY: 0,
  scale: 2,
  collide: false,
};
const authored = { ...baseline, uid: 'rock', collide: true, collisionMode: 'baked' as const };
function compile(
  placement: MapPlacement = authored,
  current: MapPlacement[] | undefined = [baseline],
  duplicate = false,
) {
  const issues: string[] = [];
  const adoption = {
    uid: 'rock',
    source: baseline,
    reason: 'Carry the authored asset collision adoption.',
  };
  const used = new Set<string>();
  const result = compileLayoutCollision(
    { placements: [placement] } as MapDoc,
    duplicate ? [adoption, adoption] : [adoption],
    current,
    used,
    (id) => issues.push(id),
  );
  return { ...result, issues, used };
}
afterEach(() => setActiveWorldContent(null));

describe('collision adoption without duplicate scenery', () => {
  it('emits the real placement collider shapes without adding rendered models or enabling authored-map rules', () => {
    const result = compile();
    expect(result.issues).toEqual([]);
    expect(result.used).toEqual(new Set(['rock']));
    expect(result.reservedIndices).toEqual(new Set([0]));
    const world = placeLayoutScenery(BUILTIN_WORLD, result);
    expect(world.placements).toBe(BUILTIN_WORLD.placements);
    expect(world.props).toBe(BUILTIN_WORLD.props);
    setActiveWorldContent(world);
    expect(authoredMapActive()).toBe(false);
    const actual: Collider[] = [];
    const expected: Collider[] = [];
    pushPlacementColliders(actual, world, WORLD_SEED);
    pushPlacementColliders(
      expected,
      { ...BUILTIN_WORLD, placements: placementsToPlayAssets([authored]) },
      WORLD_SEED,
    );
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('keeps the current seat for sub-picoyard conversion drift but rejects a real move or visual change', () => {
    const result = compile({ ...authored, y: -0.1200000000000001 });
    expect(result.issues).toEqual([]);
    expect(result.collisions[0].y).toBe(-0.12);
    for (const change of [
      { x: 11 },
      { y: 0 },
      { scale: 3 },
      { hue: 20 },
      { regionRole: 'flag0' as const },
    ]) {
      const invalid = compile({ ...authored, ...change });
      expect(invalid.issues).toEqual(['collision:rock']);
      expect(invalid.collisions).toEqual([]);
    }
  });

  it('rejects absent, stale, ambiguous or reused baselines', () => {
    expect(compile(authored, []).issues).toEqual(['collision:rock']);
    expect(compile(authored, [{ ...baseline, scale: 3 }]).issues).toEqual(['collision:rock']);
    expect(compile(authored, [baseline, baseline]).issues).toEqual(['collision:rock']);
    const duplicate = compile(authored, [baseline], true);
    expect(duplicate.issues).toEqual(['collision:rock']);
    expect(duplicate.collisions).toHaveLength(1);
  });
});
