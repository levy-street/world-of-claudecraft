import { describe, expect, it } from 'vitest';
import {
  filterIgnivarPropPlacements,
  ignivarApproachPropPlan,
  ignivarArenaPropPlan,
  ignivarCruciblePropPlan,
} from '../src/render/ignivar_dressing_plan_core';
import {
  cameraSeesWallBack,
  splitWallMountedItems,
  WALL_BACKFACE_CULL_MARGIN,
  WALL_BACKFACE_CULL_RANGE,
  WALL_MOUNTED_PROP_KINDS,
  WALL_PROP_EDGE_MAX_DIST,
  wallSegmentOutward,
} from '../src/render/wall_backface_cull_core';
import { polygonWallSegments } from '../src/sim/delve_litany_layout';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../src/sim/dungeon_layout';

const RAID_LAYOUTS = [
  ['approach', IGNIVAR_FORGE_APPROACH_LAYOUT],
  ['arena', IGNIVAR_LAYOUT],
  ['depths', IGNIVAR_SECOND_WING_LAYOUT],
] as const;

describe('wallSegmentOutward', () => {
  it('points away from the pole, unit length, for every raid shell segment', () => {
    for (const [name, layout] of RAID_LAYOUTS) {
      const pole = layout.shellPole;
      const polygon = layout.shellPolygon;
      expect(pole, name).toBeDefined();
      expect(polygon, name).toBeDefined();
      if (!pole || !polygon) continue;
      for (const seg of polygonWallSegments(polygon)) {
        const { nx, nz } = wallSegmentOutward(seg.x, seg.z, seg.rot, pole.x, pole.z);
        expect(Math.hypot(nx, nz)).toBeCloseTo(1, 6);
        // outward means the pole sits strictly on the inner side
        expect((seg.x - pole.x) * nx + (seg.z - pole.z) * nz).toBeGreaterThan(0);
        // and perpendicular to the segment's long axis (colliders rot convention)
        expect(Math.cos(seg.rot) * nx - Math.sin(seg.rot) * nz).toBeCloseTo(0, 6);
      }
    }
  });

  it('gives the approach entry wall a south-facing outward normal', () => {
    // south edge of the approach polygon: (-16,-58) to (16,-58), rot 0
    const { nx, nz } = wallSegmentOutward(0, -58, 0, 0, 0);
    expect(nx).toBeCloseTo(0, 6);
    expect(nz).toBeCloseTo(-1, 6);
  });
});

describe('cameraSeesWallBack', () => {
  const south = { x: 0, z: -58, nx: 0, nz: -1 };

  it('is false for every face while the camera is inside the room', () => {
    for (const [name, layout] of RAID_LAYOUTS) {
      const pole = layout.shellPole;
      const polygon = layout.shellPolygon;
      if (!pole || !polygon) continue;
      for (const seg of polygonWallSegments(polygon)) {
        const n = wallSegmentOutward(seg.x, seg.z, seg.rot, pole.x, pole.z);
        const plane = { x: seg.x, z: seg.z, nx: n.nx, nz: n.nz };
        expect(cameraSeesWallBack(plane, pole.x, pole.z), name).toBe(false);
      }
    }
  });

  it('culls only the faces whose outside the camera is on', () => {
    const pole = IGNIVAR_FORGE_APPROACH_LAYOUT.shellPole;
    const polygon = IGNIVAR_FORGE_APPROACH_LAYOUT.shellPolygon;
    if (!pole || !polygon) throw new Error('approach layout lost its shell');
    // camera pushed out through the entry wall, the reproduced bug shape
    const camX = 0;
    const camZ = -64;
    let culled = 0;
    let kept = 0;
    for (const seg of polygonWallSegments(polygon)) {
      const n = wallSegmentOutward(seg.x, seg.z, seg.rot, pole.x, pole.z);
      const hit = cameraSeesWallBack({ x: seg.x, z: seg.z, nx: n.nx, nz: n.nz }, camX, camZ);
      // every straight south-edge segment culls; the north half of the room
      // must keep its walls
      if (seg.z === -58) {
        expect(hit).toBe(true);
      }
      if (seg.z > 0) {
        expect(hit).toBe(false);
      }
      if (hit) culled++;
      else kept++;
    }
    expect(culled).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(culled);
  });

  it('starts the cull inside the wall slab, before the near plane can clip it', () => {
    // signed distance -1 is the inner wall surface; the margin must reach
    // past it so a camera entering the slab never renders its guts
    expect(WALL_BACKFACE_CULL_MARGIN).toBeGreaterThan(1);
    expect(cameraSeesWallBack(south, 0, -58 + WALL_BACKFACE_CULL_MARGIN - 0.01)).toBe(true);
    expect(cameraSeesWallBack(south, 0, -58 + WALL_BACKFACE_CULL_MARGIN + 0.01)).toBe(false);
    // camera well inside the room: never culled
    expect(cameraSeesWallBack(south, 0, -50)).toBe(false);
    // camera fully outside: always culled
    expect(cameraSeesWallBack(south, 0, -70)).toBe(true);
  });

  it('never fires beyond the cull range, so a far resident interior keeps its shell', () => {
    // outside the plane but across the map (instance origins sit 600 apart)
    expect(cameraSeesWallBack(south, 0, -58 - WALL_BACKFACE_CULL_RANGE - 1)).toBe(false);
    expect(cameraSeesWallBack(south, 0, -58 - WALL_BACKFACE_CULL_RANGE + 1)).toBe(true);
    // any legitimate in-room orbit sits far inside the range
    expect(WALL_BACKFACE_CULL_RANGE).toBeGreaterThan(22 + 40);
  });
});

describe('splitWallMountedItems', () => {
  const polygon = IGNIVAR_FORGE_APPROACH_LAYOUT.shellPolygon;
  const pole = IGNIVAR_FORGE_APPROACH_LAYOUT.shellPole;

  it('keeps floor kinds interior even when flush to a wall', () => {
    const items = [{ key: 'forge', x: 0, z: -57 }];
    const split = splitWallMountedItems(items, polygon, pole);
    expect(split.interior).toEqual(items);
    expect(split.faces).toEqual([]);
  });

  it('assigns a wall kind near an edge to that face, and far ones interior', () => {
    const near = { key: 'vault_door', x: 0, z: -56.5 };
    const far = { key: 'vault_door', x: 0, z: -40 };
    const split = splitWallMountedItems([near, far], polygon, pole);
    expect(split.interior).toEqual([far]);
    expect(split.faces).toHaveLength(1);
    expect(split.faces[0].edge).toBe(0);
    expect(split.faces[0].items).toEqual([near]);
    // the face plane faces outward (south) from the entry edge
    expect(split.faces[0].plane.nz).toBeCloseTo(-1, 6);
    expect(split.faces[0].plane.z).toBeCloseTo(-58, 6);
  });

  it('is a partition: every input lands in exactly one output list', () => {
    for (const [name, layout, planFn] of [
      ['approach', IGNIVAR_FORGE_APPROACH_LAYOUT, ignivarApproachPropPlan],
      ['arena', IGNIVAR_LAYOUT, ignivarArenaPropPlan],
      ['depths', IGNIVAR_SECOND_WING_LAYOUT, ignivarCruciblePropPlan],
    ] as const) {
      for (const lowGfx of [false, true]) {
        const plan = filterIgnivarPropPlacements(planFn(layout), lowGfx);
        const split = splitWallMountedItems(plan, layout.shellPolygon, layout.shellPole);
        const total = split.interior.length + split.faces.reduce((n, f) => n + f.items.length, 0);
        expect(total, `${name} lowGfx=${lowGfx}`).toBe(plan.length);
        const seen = new Set(split.interior);
        for (const face of split.faces) for (const item of face.items) seen.add(item);
        expect(seen.size, `${name} lowGfx=${lowGfx}`).toBe(plan.length);
      }
    }
  });

  it('finds the live wall-mounted dressing: the approach vault doors and the depths beams', () => {
    const approach = splitWallMountedItems(
      filterIgnivarPropPlacements(ignivarApproachPropPlan(IGNIVAR_FORGE_APPROACH_LAYOUT), false),
      IGNIVAR_FORGE_APPROACH_LAYOUT.shellPolygon,
      IGNIVAR_FORGE_APPROACH_LAYOUT.shellPole,
    );
    const approachKinds = new Set(approach.faces.flatMap((f) => f.items.map((i) => i.key)));
    expect(approachKinds.has('vault_door')).toBe(true);
    // mid-room chains never bind to a wall
    expect(approach.faces.some((f) => f.items.some((i) => i.key === 'chain'))).toBe(false);

    const depths = splitWallMountedItems(
      filterIgnivarPropPlacements(ignivarCruciblePropPlan(IGNIVAR_SECOND_WING_LAYOUT), false),
      IGNIVAR_SECOND_WING_LAYOUT.shellPolygon,
      IGNIVAR_SECOND_WING_LAYOUT.shellPole,
    );
    const beamFace = depths.faces.find((f) => f.items.some((i) => i.key === 'beam'));
    expect(beamFace).toBeDefined();
    expect(beamFace?.items.filter((i) => i.key === 'beam').length).toBeGreaterThan(1);
  });

  it('passes everything through untouched without a shell polygon', () => {
    const items = [
      { key: 'vault_door', x: 0, z: -56.5 },
      { key: 'beam', x: 5, z: 10 },
    ];
    expect(splitWallMountedItems(items, undefined, pole)).toEqual({
      interior: items,
      faces: [],
    });
    expect(splitWallMountedItems(items, polygon, undefined)).toEqual({
      interior: items,
      faces: [],
    });
  });

  it('classifies by the shared kind set and distance constants', () => {
    expect(WALL_MOUNTED_PROP_KINDS.has('vault_door')).toBe(true);
    expect(WALL_MOUNTED_PROP_KINDS.has('beam')).toBe(true);
    expect(WALL_MOUNTED_PROP_KINDS.has('forge')).toBe(false);
    expect(WALL_MOUNTED_PROP_KINDS.has('lava_channel')).toBe(false);
    expect(WALL_PROP_EDGE_MAX_DIST).toBeGreaterThan(1);
  });
});
