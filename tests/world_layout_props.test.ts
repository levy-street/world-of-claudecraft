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
import { compileLayoutProps, layoutPropPlacements } from '../src/editor/world_layout_props';
import { matchLayoutScenery } from '../src/editor/world_layout_scenery';
import { worldMajorPropPlacements } from '../src/editor/world_prop_conversion';
import { buildWorldAmbientSources } from '../src/render/world_audio';
import { pushCampCrateColliders } from '../src/sim/camp_crate_colliders';
import type { Collider } from '../src/sim/collider_shapes';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { crossesFence } from '../src/sim/fence_crossing';
import type { MapDoc } from '../src/sim/map_doc';
import { campCrateShape } from '../src/sim/prop_layout';
import { emptyZoneProps } from '../src/sim/types';
import { placeLayoutProps, propSourceIndex } from '../src/sim/world_layout/props';
import { placeLayoutScenery } from '../src/sim/world_layout/scenery';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => setActiveWorldContent(null));

describe('canonical scenery group replacement', () => {
  it('keeps surviving hut dressing facing the original camp centre', () => {
    const props = {
      ...emptyZoneProps(),
      mudHuts: [
        [180, 420],
        [190, 420],
        [190, 430],
      ] as [number, number][],
    };
    const before = worldMajorPropPlacements(props, WORLD_SEED, false);
    const after = placeLayoutProps(props, [{ family: 'mudHuts', source: props.mudHuts[0] }]);
    const projected = worldMajorPropPlacements(after, WORLD_SEED, false);
    expect(projected.length).toBeGreaterThan(2);
    expect(matchLayoutScenery(projected, before).unmatchedSource).toEqual([]);
    const isolated = layoutPropPlacements(props, { family: 'mudHuts', source: props.mudHuts[1] });
    expect(isolated).toEqual(before.filter((p) => p.name?.startsWith('Mud hut 2')));
  });

  it('keeps later crate and stall variants, names, stack heights and geometry after an earlier removal', () => {
    const props = {
      ...emptyZoneProps(),
      crates: [
        [180, 400],
        [185, 400],
        [190, 400, 2],
      ] as [number, number, number?][],
      stalls: [0, 1, 2].map((i) => ({ x: 180 + i * 6, z: 420, r: 2, rot: 0 })),
    };
    const before = worldMajorPropPlacements(props, WORLD_SEED, false);
    const after = placeLayoutProps(props, [
      { family: 'crates', source: props.crates[0] },
      { family: 'stalls', source: props.stalls[0] },
    ]);
    expect(after.crates).toEqual(props.crates.slice(1));
    expect(after.crates[1]).toBe(props.crates[2]);
    expect(propSourceIndex(after, 'crates', 1)).toBe(2);
    expect(campCrateShape(190, 400, propSourceIndex(after, 'crates', 1))).toEqual(
      campCrateShape(190, 400, 2),
    );
    const colliders: Collider[] = [];
    pushCampCrateColliders(colliders, after, (_x, _z, height) => 10 + height);
    expect(colliders[1]).toMatchObject({ x: 190, z: 400, moveTopY: 12.26, standable: true });
    const projected = worldMajorPropPlacements(after, WORLD_SEED, false);
    expect(matchLayoutScenery(projected, before).unmatchedSource).toEqual([]);
    expect(projected.some((p) => p.name === 'Camp barrel 3 level 2')).toBe(true);
    expect(projected.filter((p) => p.name?.startsWith('Market stall 2'))).toEqual(
      before.filter((p) => p.name?.startsWith('Market stall 2')),
    );
    expect(placeLayoutProps(props)).toBe(props);
    expect(() => placeLayoutProps(props, [{ family: 'crates', source: [1, 2] }])).toThrow(
      /Missing/,
    );
    expect(() =>
      placeLayoutProps(
        {
          ...props,
          crates: [
            [1, 2],
            [1, 2],
          ],
        },
        [{ family: 'crates', source: [1, 2] }],
      ),
    ).toThrow(/ambiguous/);
  });

  it('retains untouched stone runs as native fences with jump crossing', () => {
    const props = {
      ...emptyZoneProps(),
      fences: [{ x1: 180, z1: 420, x2: 180, z2: 444, kind: 'stone' as const }],
    };
    const record = { family: 'fences' as const, source: props.fences[0] };
    const children = layoutPropPlacements(props, record);
    expect(children.length).toBeGreaterThan(2);
    const doc = {
      placements: children.map((p, index) => ({
        ...p,
        uid: `stone-${index}`,
        ...(index === 1 ? { x: p.x + 20 } : {}),
      })),
    } as MapDoc;
    const errors: string[] = [];
    const result = compileLayoutProps(
      doc,
      [
        {
          record,
          parts: [{ source: children[1], uid: 'stone-1' }],
          reason: 'Move one stone segment, retaining the rest.',
        },
      ],
      props,
      children,
      new Set(),
      new Set(),
      (id) => errors.push(id),
    );
    expect(errors).toEqual([]);
    expect(result.additions).toHaveLength(1);
    expect(result.retainedFences).toHaveLength(2);
    const after = placeLayoutProps(props, result.propRemovals, result.retainedFences);
    expect(worldMajorPropPlacements(after, WORLD_SEED, false)).toHaveLength(children.length - 1);
    expect(result.retainedFences[0]).toMatchObject({ x1: 180, z1: 420, x2: 180 });
    setActiveWorldContent(placeLayoutScenery({ ...BUILTIN_WORLD, props: after }, result));
    const retained = result.retainedFences[0];
    const midZ = (retained.z1 + retained.z2) / 2;
    expect(crossesFence(179, midZ, 181, midZ, 0.3)).toBe(true);
  });

  it.each(['campfire', 'forge'] as const)(
    'moves %s ambience with the parent and keeps its relative height',
    (kind) => {
      const props = {
        ...emptyZoneProps(),
        campfires: [[180, 420]] as [number, number][],
        stalls: [{ x: 190, z: 420, rot: 0, r: 2, smithy: true as const }],
      };
      const record =
        kind === 'campfire'
          ? { family: 'campfires' as const, source: props.campfires[0] }
          : { family: 'stalls' as const, source: props.stalls[0] };
      const children = layoutPropPlacements(props, record);
      const moved = {
        ...children[0],
        uid: 'moved-sound',
        x: children[0].x + 10,
        detached: true,
        groundY: 20,
        y: 2,
      };
      const errors: string[] = [];
      const result = compileLayoutProps(
        { placements: [moved] } as MapDoc,
        [
          {
            record,
            parts: [{ source: children[0], uid: moved.uid }],
            reason: 'Move the parent, including its ambience.',
          },
        ],
        props,
        children,
        new Set(),
        new Set(),
        (id) => errors.push(id),
      );
      expect(errors).toEqual([]);
      const world = placeLayoutScenery(
        { ...BUILTIN_WORLD, props: placeLayoutProps(props, result.propRemovals) },
        result,
      );
      setActiveWorldContent(world);
      const sounds = buildWorldAmbientSources(WORLD_SEED).filter((s) => s.id.startsWith('layout:'));
      expect(sounds).toEqual([expect.objectContaining({ kind, x: moved.x, z: moved.z })]);
      expect(sounds[0].y).toBeCloseTo(22 + (kind === 'campfire' ? 0.6 : 1) - (children[0].y ?? 0));
    },
  );

  it('replaces one stall child without losing its accessories, and consumes retained source siblings exactly once', () => {
    const props = { ...emptyZoneProps(), stalls: [{ x: 180, z: 420, r: 2, rot: 0 }] };
    const record = { family: 'stalls' as const, source: props.stalls[0] };
    const children = layoutPropPlacements(props, record);
    expect(children.length).toBeGreaterThan(2);
    const doc = {
      placements: children.map((p, index) => ({
        ...p,
        uid: `child-${index}`,
        ...(index === 0 ? { x: p.x + 10 } : {}),
      })),
    } as MapDoc;
    const edit = {
      record,
      parts: [{ source: children[0], uid: 'child-0' }],
      reason: 'Authored move of the stand; retain its accessories.',
    };
    const used = new Set<string>();
    const reserved = new Set<number>();
    const issues: string[] = [];
    const result = compileLayoutProps(doc, [edit], props, children, used, reserved, (id) =>
      issues.push(id),
    );
    expect(issues).toEqual([]);
    expect(result.propRemovals).toEqual([record]);
    expect(result.additions).toHaveLength(children.length);
    expect(result.additions).toEqual(
      expect.arrayContaining(placementsToPlayAssets(children.slice(1))),
    );
    expect(used.size).toBe(children.length);
    expect(reserved.size).toBe(children.length);
    expect(placeLayoutProps(props, result.propRemovals).stalls).toEqual([]);
    for (const invalid of [
      { ...edit, parts: [...edit.parts, ...edit.parts] },
      { ...edit, parts: [{ source: { ...children[0], scale: 99 }, uid: 'child-0' }] },
    ]) {
      const nextUsed = new Set<string>();
      const nextReserved = new Set<number>();
      const errors: string[] = [];
      const next = compileLayoutProps(
        doc,
        [invalid],
        props,
        children,
        nextUsed,
        nextReserved,
        (id) => errors.push(id),
      );
      expect(errors).toHaveLength(1);
      expect(next.additions).toEqual([]);
      expect(nextUsed.size).toBe(0);
      expect(nextReserved.size).toBe(0);
    }
  });
});
