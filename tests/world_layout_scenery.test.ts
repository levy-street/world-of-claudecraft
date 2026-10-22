import { describe, expect, it } from 'vitest';
import { matchLayoutScenery } from '../src/editor/world_layout_scenery';
import type { MapPlacement } from '../src/sim/map_doc';

const rock: MapPlacement = {
  assetId: 'props/rock_large_d',
  x: 10,
  z: 20,
  rotY: 0,
  scale: 2,
  collide: true,
  collisionMode: 'baked',
};

describe('current scenery preservation', () => {
  it('matches labels, editor visibility and default axis serialization without dropping collision', () => {
    const source = {
      ...rock,
      uid: 'source',
      name: 'Renamed',
      hidden: true,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      rotX: 0,
      rotZ: 0,
      y: 0,
    };
    expect(matchLayoutScenery([source], [rock])).toEqual({
      matches: [{ sourceIndex: 0, currentIndex: 0 }],
      unmatchedSource: [],
      unmatchedCurrent: [],
    });
    for (const change of [
      { x: 10.000001 },
      { collide: false, collisionMode: 'none' as const },
      { collisionMode: 'basic' as const, collideRadius: 8 },
      { detached: true, groundY: 10 },
      { rotY: 0.000001 },
      { scale: 2.000001 },
      { regionRole: 'flag0' as const },
    ])
      expect(matchLayoutScenery([{ ...source, ...change }], [rock]).unmatchedSource).toEqual([0]);
  });

  it('detects independent seat and basic collision radius changes', () => {
    const detached = { ...rock, detached: true, groundY: 10 };
    expect(matchLayoutScenery([{ ...detached, groundY: 11 }], [detached]).unmatchedSource).toEqual([
      0,
    ]);
    const basic = { ...rock, collisionMode: 'basic' as const, collideRadius: 8 };
    expect(matchLayoutScenery([{ ...basic, collideRadius: 9 }], [basic]).unmatchedSource).toEqual([
      0,
    ]);
  });

  it('consumes each current occurrence once, preserving copies and newly added current scenery', () => {
    const later = { ...rock, x: 100 };
    expect(matchLayoutScenery([rock, rock], [rock, later])).toEqual({
      matches: [{ sourceIndex: 0, currentIndex: 0 }],
      unmatchedSource: [1],
      unmatchedCurrent: [1],
    });
    expect(matchLayoutScenery([rock, rock], [rock, rock]).matches).toHaveLength(2);
  });

  it('does not discard unknown assets or authored collision edits as matching scenery', () => {
    const missing = { ...rock, assetId: 'missing/example' };
    expect(matchLayoutScenery([missing], [missing]).unmatchedSource).toEqual([0]);
    expect(
      matchLayoutScenery(
        [{ ...rock, hitboxes: [{ x: 0, y: 0, z: 0, hx: 2, hy: 3, hz: 4 }] }],
        [rock],
      ).unmatchedSource,
    ).toEqual([0]);
    expect(
      matchLayoutScenery([{ ...rock, collisionMode: 'mesh' }], [rock], {
        [rock.assetId]: [{ x: 0, y: 0, z: 0, hx: 2, hy: 3, hz: 4 }],
      }).unmatchedSource,
    ).toEqual([0]);
  });
});
