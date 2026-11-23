import { describe, expect, it } from 'vitest';
import {
  BUILDING_FLOOR_THICKNESS,
  type BuildingDragOptions,
  type BuildingPlacement,
  type BuildingWallAsset,
  buildingPlacementVisible,
  filterExistingBuildingWalls,
  levelY,
  MAX_BUILDING_GESTURE_PLACEMENTS,
  planBuildingDrag,
  roomCorners,
} from '../src/editor/building_core';
import { MAX_PLACEMENTS, MODEL_ASSET_ID, MODEL_PATH, sanitizeMapDoc } from '../src/sim/map_doc';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { WorldContent } from '../src/sim/types';

const building = { id: 'castle', baseY: 36, floorHeight: 6, levels: 4 };
const defaults: BuildingDragOptions = {
  mode: 'wall',
  start: { x: 0, z: 0 },
  end: { x: 10, z: 0 },
  building,
  level: 1,
  gridSize: 1,
  existingPlacementCount: 0,
};
const kit: BuildingWallAsset = {
  assetId: 'tidehold_parts/castle_wall',
  footprint: { sizeX: 2.2, sizeY: 3.5, sizeZ: 0.2 },
  scale: 2,
};

function lengthEndpoints(p: BuildingPlacement, wall: BuildingWallAsset): [number, number][] {
  const axis = wall.footprint.sizeX >= wall.footprint.sizeZ ? 'x' : 'z';
  const half =
    (p.scale *
      (axis === 'x'
        ? (p.scaleX ?? 1) * wall.footprint.sizeX
        : (p.scaleZ ?? 1) * wall.footprint.sizeZ)) /
    2;
  const dx = axis === 'x' ? Math.cos(p.rotY) * half : Math.sin(p.rotY) * half;
  const dz = axis === 'x' ? -Math.sin(p.rotY) * half : Math.cos(p.rotY) * half;
  return [
    [p.x - dx, p.z - dz],
    [p.x + dx, p.z + dz],
  ];
}

describe('building drag geometry', () => {
  it.each([
    { x: 6, z: 6 },
    { x: -6, z: 6 },
    { x: -6, z: -6 },
    { x: 6, z: -6 },
    { x: 8, z: 3 },
    { x: -3, z: 8 },
  ])('joins diagonal wall pieces without gaps toward %o and preserves them on save', (end) => {
    for (const wall of [
      undefined,
      kit,
      { ...kit, footprint: { sizeX: 0.2, sizeY: 3.5, sizeZ: 2.2 } },
    ]) {
      const plan = planBuildingDrag({ ...defaults, end, wall, diagonal: true });
      expect(plan.error).toBeUndefined();
      expect(plan.corners).toEqual([{ x: 0, z: 0 }, end]);
      const endpoints = plan.placements.map((p) => {
        if (wall) return lengthEndpoints(p, wall);
        const half = p.hitboxes?.[0].hx ?? NaN;
        const dx = Math.cos(p.rotY) * half;
        const dz = -Math.sin(p.rotY) * half;
        return [
          [p.x - dx, p.z - dz],
          [p.x + dx, p.z + dz],
        ];
      });
      expect(endpoints[0][0][0]).toBeCloseTo(0);
      expect(endpoints[0][0][1]).toBeCloseTo(0);
      expect(endpoints.at(-1)?.[1][0]).toBeCloseTo(end.x);
      expect(endpoints.at(-1)?.[1][1]).toBeCloseTo(end.z);
      for (let i = 1; i < endpoints.length; i++) {
        expect(endpoints[i][0][0]).toBeCloseTo(endpoints[i - 1][1][0]);
        expect(endpoints[i][0][1]).toBeCloseTo(endpoints[i - 1][1][1]);
      }
      const loaded = sanitizeMapDoc({
        content: { zones: [{ zMin: -500, zMax: 500, hub: { x: 0, z: 0 } }] },
        buildings: [building],
        placements: plan.placements,
      });
      expect(loaded?.placements).toHaveLength(plan.placements.length);
      plan.placements.forEach((p, i) => {
        expect(loaded?.placements[i]).toMatchObject({ x: p.x, z: p.z, rotY: p.rotY });
        for (const key of ['scale', 'scaleX', 'scaleY', 'scaleZ', 'groundY', 'building'] as const)
          expect(loaded?.placements[i][key]).toEqual(p[key]);
        expect(loaded?.placements[i].meshes).toEqual(p.meshes);
        expect(loaded?.placements[i].hitboxes).toEqual(p.hitboxes);
      });
      if (!wall) {
        const reversed = planBuildingDrag({
          ...defaults,
          start: end,
          end: defaults.start,
          diagonal: true,
        });
        expect(filterExistingBuildingWalls(reversed.placements, plan.placements)).toEqual([]);
      }
    }
  });

  it.each([
    [{ x: 10, z: 0 }, 'x'],
    [{ x: -10, z: 0 }, 'x'],
    [{ x: 0, z: 10 }, 'z'],
    [{ x: 0, z: -10 }, 'z'],
  ] as const)('fits kit edges without gaps while dragging toward %o', (end, _axis) => {
    const plan = planBuildingDrag({ ...defaults, end, wall: kit });
    expect(plan.error).toBeUndefined();
    expect(plan.placements).toHaveLength(2);
    const endpoints = plan.placements.map((p) => lengthEndpoints(p, kit));
    expect(endpoints[0][0][0]).toBeCloseTo(0);
    expect(endpoints[0][0][1]).toBeCloseTo(0);
    expect(endpoints[1][1][0]).toBeCloseTo(end.x);
    expect(endpoints[1][1][1]).toBeCloseTo(end.z);
    expect(endpoints[0][1][0]).toBeCloseTo(endpoints[1][0][0]);
    expect(endpoints[0][1][1]).toBeCloseTo(endpoints[1][0][1]);
    for (const p of plan.placements) {
      expect(p.groundY).toBe(42);
      expect(p.detached).toBe(true);
      expect(p.scale * (p.scaleY ?? 1) * kit.footprint.sizeY).toBeCloseTo(6);
    }
  });

  it('fits assets whose long axis is Z and preserves facing flips', () => {
    const wall = { ...kit, footprint: { sizeX: 0.2, sizeY: 3.5, sizeZ: 2.2 } };
    const options = { ...defaults, wall, end: { x: 4, z: 3 }, diagonal: true };
    const plan = planBuildingDrag(options);
    expect(plan.error).toBeUndefined();
    expect(plan.placements[0].building).toMatchObject({ kind: 'wall', wallAxis: 'x' });
    const ends = lengthEndpoints(plan.placements[0], wall);
    expect(ends[0][0]).toBeCloseTo(0);
    expect(ends[0][1]).toBeCloseTo(0);
    expect(ends[1][0]).toBeCloseTo(4);
    expect(ends[1][1]).toBeCloseTo(3);
    const flipped = planBuildingDrag({ ...options, wall: { ...wall, rotY: Math.PI } });
    expect(flipped.placements[0].building).toMatchObject({ kind: 'wall', wallAxis: 'x' });
    const flippedEnds = lengthEndpoints(flipped.placements[0], wall);
    expect(flippedEnds[0][0]).toBeCloseTo(4);
    expect(flippedEnds[0][1]).toBeCloseTo(3);
    expect(flippedEnds[1][0]).toBeCloseTo(0);
    expect(flippedEnds[1][1]).toBeCloseTo(0);
    const loaded = sanitizeMapDoc({
      content: { zones: [{ zMin: -500, zMax: 500, hub: { x: 0, z: 0 } }] },
      buildings: [building],
      placements: plan.placements,
    });
    expect(loaded?.placements[0].building).toEqual(plan.placements[0].building);
  });

  it('snaps before constraining to the dominant axis and permits diagonal mode', () => {
    const options = { ...defaults, start: { x: 0.3, z: 0.2 }, end: { x: 7.8, z: 3.1 } };
    expect(planBuildingDrag(options).corners).toEqual([
      { x: 0, z: 0 },
      { x: 8, z: 0 },
    ]);
    expect(planBuildingDrag({ ...options, diagonal: true }).corners).toEqual([
      { x: 0, z: 0 },
      { x: 8, z: 3 },
    ]);
    expect(planBuildingDrag({ ...defaults, end: { x: 3, z: 8 } }).corners[1]).toEqual({
      x: 0,
      z: 8,
    });
  });

  it.each([
    [
      { x: 0, z: 0 },
      { x: 8, z: 6 },
    ],
    [
      { x: 8, z: 6 },
      { x: 0, z: 0 },
    ],
    [
      { x: 8, z: 0 },
      { x: 0, z: 6 },
    ],
    [
      { x: 0, z: 6 },
      { x: 8, z: 0 },
    ],
  ])('makes the same closed room from either diagonal %o to %o', (start, end) => {
    const plan = planBuildingDrag({ ...defaults, mode: 'room', start, end });
    const baseline = planBuildingDrag({ ...defaults, mode: 'room', end: { x: 8, z: 6 } });
    expect(plan).toEqual(baseline);
    expect(plan.error).toBeUndefined();
    expect(plan.placements.filter((p) => p.building.kind === 'wall')).toHaveLength(28);
    expect(plan.placements.filter((p) => p.building.kind === 'floor')).toHaveLength(1);
    expect(roomCorners(start, end, 1)).toEqual(plan.corners);
    expect(plan.placements.every((p) => p.groundY === levelY(building, 1))).toBe(true);
  });

  it('builds bare wall meshes and matching solid hitboxes with requested thickness', () => {
    const plan = planBuildingDrag({ ...defaults, thickness: 1.2 });
    expect(plan.placements).toHaveLength(10);
    for (const p of plan.placements) {
      expect(p).toMatchObject({
        assetId: MODEL_ASSET_ID,
        scale: 1,
        collide: true,
        collisionMode: 'baked',
      });
      expect(p.hitboxes).toEqual([{ x: 0, y: 3, z: 0, hx: 0.5, hy: 3, hz: 0.6 }]);
      const ys = p.meshes?.[0].verts.filter((_, i) => i % 3 === 1) ?? [];
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBe(6);
      expect(p.building).toEqual({ id: 'castle', level: 1, kind: 'wall' });
    }
  });

  it('keeps doorway collision authored and never inserts a box across its opening', () => {
    const doorway = {
      ...kit,
      hitboxes: [{ x: -1, y: 1, z: 0, hx: 0.1, hy: 1, hz: 0.1 }],
      ramps: [{ x: 0, z: 0, hx: 0.5, hz: 0.1, y0: 0, y1: 0 }],
    };
    const plan = planBuildingDrag({ ...defaults, wall: doorway });
    expect(plan.placements[0].hitboxes).toEqual(doorway.hitboxes);
    expect(plan.placements[0].ramps).toEqual(doorway.ramps);
    expect(plan.placements[0].hitboxes).not.toBe(doorway.hitboxes);
    expect(plan.placements[0].hitboxes).not.toBe(plan.placements[1].hitboxes);
    expect(planBuildingDrag({ ...defaults, wall: kit }).placements[0].hitboxes).toBeUndefined();
  });

  it('places walkable floor tops exactly at the chosen level with the solid slab below', () => {
    const { placements } = planBuildingDrag({
      ...defaults,
      mode: 'floor',
      end: { x: 8, z: 6 },
      level: 2,
    });
    expect(placements).toHaveLength(1);
    const p = placements[0];
    expect(p.groundY).toBe(48);
    expect(p.hitboxes).toEqual([{ x: 0, y: -0.1, z: 0, hx: 4, hy: 0.1, hz: 3 }]);
    expect(p.ramps).toEqual([{ x: 0, z: 0, hx: 4, hz: 3, y0: 0, y1: 0 }]);
    expect(p.meshes?.[0].ramp).toBe(true);
    const ys = p.meshes?.[0].verts.filter((_, i) => i % 3 === 1) ?? [];
    expect(Math.min(...ys)).toBe(-BUILDING_FLOOR_THICKNESS);
    expect(Math.max(...ys)).toBe(0);
    const content = {
      placements: placements.map((placement) => ({
        ...placement,
        path: MODEL_PATH,
        collideRadius: 1,
      })),
    } as unknown as WorldContent;
    for (const [x, z] of [
      [0, 0],
      [4, 3],
      [8, 6],
    ]) {
      expect(placementRampFloorAt(content, 1, x, z)).toBe(48);
    }
  });

  it('tiles large floors within mesh and hitbox save bounds without changing geometry on load', () => {
    const { placements } = planBuildingDrag({
      ...defaults,
      mode: 'floor',
      end: { x: 240, z: 130 },
    });
    expect(placements).toHaveLength(6);
    const loaded = sanitizeMapDoc({
      content: { zones: [{ zMin: -500, zMax: 500, hub: { x: 0, z: 0 } }] },
      buildings: [building],
      placements,
    });
    expect(loaded).not.toBeNull();
    expect(loaded?.placements).toHaveLength(6);
    for (let i = 0; i < placements.length; i++) {
      expect(loaded?.placements[i].meshes).toEqual(placements[i].meshes);
      expect(loaded?.placements[i].hitboxes).toEqual(placements[i].hitboxes);
      expect(loaded?.placements[i].ramps).toEqual(placements[i].ramps);
    }
  });
});

describe('bounded atomic building gestures', () => {
  it('counts the full diagonal distance against the placement cap', () => {
    const options = { ...defaults, diagonal: true, end: { x: 181, z: 181 } };
    expect(planBuildingDrag(options).placements).toHaveLength(256);
    expect(planBuildingDrag({ ...options, end: { x: 182, z: 182 } })).toMatchObject({
      error: 'capacity',
      placements: [],
    });
    expect(
      planBuildingDrag({ ...options, existingPlacementCount: MAX_PLACEMENTS - 255 }),
    ).toMatchObject({ error: 'capacity', placements: [] });
  });

  it('accepts exactly the per-gesture cap and refuses one extra piece without a partial wall', () => {
    const options = { ...defaults, end: { x: MAX_BUILDING_GESTURE_PLACEMENTS, z: 0 } };
    expect(planBuildingDrag(options).placements).toHaveLength(MAX_BUILDING_GESTURE_PLACEMENTS);
    const overflow = planBuildingDrag({
      ...options,
      end: { x: MAX_BUILDING_GESTURE_PLACEMENTS + 1, z: 0 },
    });
    expect(overflow.error).toBe('capacity');
    expect(overflow.placements).toEqual([]);
  });

  it('refuses the whole room when walls fit but the floor would overflow remaining map capacity', () => {
    const options = {
      ...defaults,
      mode: 'room' as const,
      end: { x: 8, z: 6 },
      existingPlacementCount: MAX_PLACEMENTS - 28,
    };
    expect(planBuildingDrag(options)).toMatchObject({ error: 'capacity', placements: [] });
    expect(
      planBuildingDrag({ ...options, existingPlacementCount: MAX_PLACEMENTS - 29 }).placements,
    ).toHaveLength(29);
  });

  it('bounds huge floor rectangles and tiny kit pitches before allocating pieces', () => {
    expect(
      planBuildingDrag({
        ...defaults,
        mode: 'floor',
        start: { x: -10000, z: -10000 },
        end: { x: 10000, z: 10000 },
      }),
    ).toMatchObject({ error: 'capacity', placements: [] });
    expect(
      planBuildingDrag({
        ...defaults,
        wall: { ...kit, footprint: { sizeX: 1e-300, sizeZ: 1e-301, sizeY: 3.5 } },
      }),
    ).toMatchObject({ error: 'capacity', placements: [] });
  });

  it.each([
    { end: { x: Infinity, z: 0 } },
    { start: { x: 10001, z: 0 } },
    { gridSize: NaN },
    { gridSize: 0.001 },
    { level: 4 },
    { level: 0.5 },
    { thickness: 0 },
    { building: { ...building, baseY: Infinity } },
    { existingPlacementCount: -1 },
    { existingPlacementCount: MAX_PLACEMENTS + 1 },
    { wall: { ...kit, scale: 0 } },
    { wall: { ...kit, footprint: { ...kit.footprint, sizeY: 0 } } },
  ])('rejects invalid geometry without placements: %o', (bad) => {
    expect(planBuildingDrag({ ...defaults, ...bad })).toMatchObject({
      error: 'invalid',
      placements: [],
    });
  });

  it('refuses clicks without a wall length and flat room rectangles', () => {
    expect(planBuildingDrag({ ...defaults, end: { x: 0.1, z: 0.2 } })).toMatchObject({
      error: 'empty',
      placements: [],
    });
    expect(planBuildingDrag({ ...defaults, mode: 'room' })).toMatchObject({
      error: 'empty',
      placements: [],
    });
  });
});

describe('building floor visibility', () => {
  it('hides only higher levels of the active building and honors show-all', () => {
    expect(buildingPlacementVisible({ id: 'castle', level: 2, kind: 'wall' }, 'castle', 1)).toBe(
      false,
    );
    expect(buildingPlacementVisible({ id: 'castle', level: 1, kind: 'floor' }, 'castle', 1)).toBe(
      true,
    );
    expect(buildingPlacementVisible({ id: 'castle', level: 0, kind: 'wall' }, 'castle', 1)).toBe(
      true,
    );
    expect(
      buildingPlacementVisible({ id: 'castle', level: 2, kind: 'wall' }, 'castle', 1, false),
    ).toBe(true);
    expect(buildingPlacementVisible({ id: 'other', level: 2, kind: 'wall' }, 'castle', 1)).toBe(
      true,
    );
    expect(buildingPlacementVisible(undefined, 'castle', 1)).toBe(true);
    expect(buildingPlacementVisible({ id: 'castle', level: 2, kind: 'wall' }, undefined, 1)).toBe(
      true,
    );
  });
});

describe('shared room walls', () => {
  it('keeps one shared bare boundary between adjacent rooms and preserves existing finishes', () => {
    const left = planBuildingDrag({ ...defaults, mode: 'room', end: { x: 4, z: 3 } }).placements;
    const right = planBuildingDrag({
      ...defaults,
      mode: 'room',
      start: { x: 4, z: 0 },
      end: { x: 8, z: 3 },
    }).placements;
    const shared = left.filter((p) => p.x === 4 && p.building.kind === 'wall');
    for (const p of shared)
      p.wallFinishes = { front: { texture: 'Stone01' }, back: { texture: 'Plaster01' } };
    const before = structuredClone(left);
    const accepted = filterExistingBuildingWalls(right, left);
    expect(shared).toHaveLength(3);
    expect(right).toHaveLength(15);
    expect(accepted).toHaveLength(12);
    expect(accepted.filter((p) => p.x === 4 && p.building.kind === 'wall')).toHaveLength(0);
    expect(accepted.filter((p) => p.building.kind === 'floor')).toHaveLength(1);
    expect(left).toEqual(before);
    expect(right).toHaveLength(15);
  });

  it('recognizes reverse wall drags and whole-turn rotations as the same solid geometry', () => {
    const original = planBuildingDrag(defaults).placements;
    const reversed = planBuildingDrag({
      ...defaults,
      start: defaults.end,
      end: defaults.start,
    }).placements;
    expect(filterExistingBuildingWalls(reversed, original)).toEqual([]);
    const revolved = original.map((p) => ({ ...p, rotY: p.rotY + Math.PI * 4 }));
    expect(filterExistingBuildingWalls(revolved, original)).toEqual([]);
  });

  it('retains the same boundary on another level or building and walls with different dimensions', () => {
    const original = planBuildingDrag(defaults).placements;
    const changed = [
      planBuildingDrag({ ...defaults, level: 2 }).placements,
      planBuildingDrag({ ...defaults, building: { ...building, id: 'other' } }).placements,
      planBuildingDrag({ ...defaults, thickness: 0.4 }).placements,
      planBuildingDrag({ ...defaults, building: { ...building, floorHeight: 5 } }).placements,
      original.map((p) => ({ ...p, groundY: (p.groundY ?? 0) + 0.1 })),
      original.map((p) => ({ ...p, x: p.x + 0.001 })),
      original.map((p) => ({ ...p, rotY: p.rotY + Math.PI / 2 })),
    ];
    for (const candidates of changed)
      expect(filterExistingBuildingWalls(candidates, original)).toEqual(candidates);
  });

  it('does not discard kits or a remodeled wall merely because its anchor matches a bare wall', () => {
    const original = planBuildingDrag(defaults).placements;
    const remodeled = structuredClone(original);
    for (const p of remodeled) if (p.meshes) p.meshes[0].verts[0] += 0.2;
    expect(filterExistingBuildingWalls(original, remodeled)).toEqual(original);
    expect(filterExistingBuildingWalls(remodeled, original)).toEqual(remodeled);
    const kitWalls = planBuildingDrag({ ...defaults, wall: kit }).placements;
    expect(filterExistingBuildingWalls(kitWalls, kitWalls)).toEqual(kitWalls);
    expect(filterExistingBuildingWalls(kitWalls, original)).toEqual(kitWalls);
  });
});
