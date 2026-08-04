import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  eastbrookGrassExclusions,
  insideDressingExclusion,
  insideEastbrookGrassExclusion,
  insideGrassHubExclusion,
} from '../src/render/foliage_core';
import { BUILTIN_WORLD, PROPS } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import {
  EASTBROOK_NOTICEBOARD_ASSET_ID,
  EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS,
  EASTBROOK_NOTICEBOARD_NATIVE_DIMENSIONS,
  EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
  type NoticeboardDef,
} from '../src/sim/types';

const PADDING = 0.35;
const BOUNDARY_EPSILON = 0.01;
const BUILTIN_NOTICEBOARDS = BUILTIN_WORLD.services?.noticeboards ?? [];

describe('Eastbrook town grass exclusion', () => {
  it('snapshots every building, service apron, civic prop, market prop, fence, and wall chord', () => {
    const exclusions = eastbrookGrassExclusions(PROPS.buildings, true, BUILTIN_NOTICEBOARDS);
    expect(BUILTIN_NOTICEBOARDS).toHaveLength(1);
    expect(exclusions).toHaveLength(51);
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      expect(exclusions.some((item) => item.id === building.id)).toBe(true);
      expect(exclusions.some((item) => item.id === `${building.id}:serviceApron`)).toBe(true);
      expect(
        insideEastbrookGrassExclusion(
          exclusions,
          building.position.x,
          building.position.z,
          PADDING,
        ),
      ).toBe(true);
      expect(
        insideEastbrookGrassExclusion(
          exclusions,
          building.frontStandingPoint.x,
          building.frontStandingPoint.z,
          PADDING,
        ),
      ).toBe(true);
    }
  });

  it('pins the literal exclusion dimensions for the complete replacement layout', () => {
    const exclusions = eastbrookGrassExclusions(PROPS.buildings, true, BUILTIN_NOTICEBOARDS);
    const byId = new Map(exclusions.map((exclusion) => [exclusion.id, exclusion]));
    const expectedObbDimensions = {
      eastbrook_grand_armoury: [6.5, 4.5],
      eastbrook_bank: [3.5, 2.75],
      eastbrook_smithy: [3.5, 2.75],
      eastbrook_inn: [3.75, 3],
      eastbrook_chapel: [2.75, 3],
      eastbrook_weaving_workshop: [2.75, 2.25],
      eastbrook_toolworks: [2.75, 2.25],
    } as const;
    for (const [id, [halfWidth, halfDepth]] of Object.entries(expectedObbDimensions)) {
      expect(byId.get(id)).toMatchObject({ kind: 'obb', halfWidth, halfDepth });
      expect(byId.get(`${id}:serviceApron`)).toMatchObject({ kind: 'circle', radius: 1.5 });
    }
    expect(byId.get('eastbrook_civic_well_beacon')).toMatchObject({
      kind: 'circle',
      radius: 1.5,
    });
    expect(byId.get('eastbrook_noticeboard')).toMatchObject({
      kind: 'obb',
      halfWidth: 1.2,
      halfDepth: 0.3,
      rotation: -0.7853981633974483,
    });
    expect(byId.get('eastbrook_noticeboard:serviceApron')).toMatchObject({
      kind: 'circle',
      radius: 1.2,
    });
    expect(byId.has('eastbrook_market_stall_artisans')).toBe(false);

    const dimensionsFor = (ids: readonly string[]) =>
      ids.map((id) => {
        const exclusion = byId.get(id);
        if (exclusion?.kind !== 'obb') throw new Error(`missing OBB ${id}`);
        return [exclusion.halfWidth, exclusion.halfDepth];
      });
    expect(dimensionsFor(EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id))).toEqual([
      [0.9, 0.3],
      [0.9, 0.3],
      [0.9, 0.3],
    ]);
    expect(dimensionsFor(EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id))).toEqual([
      [1.4, 1.1],
      [1.4, 1.1],
    ]);
    const fenceDimensions = dimensionsFor(EASTBROOK_LAYOUT.fences.map((fence) => fence.id));
    expect(fenceDimensions.map(([halfWidth]) => halfWidth)).toEqual([
      0.8499999999999994, 4.200000000000001, 0.8499999999999995,
    ]);
    expect(fenceDimensions.map(([, halfDepth]) => halfDepth)).toEqual([0.14, 0.14, 0.14]);

    const wallDimensions = dimensionsFor(
      EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
    );
    expect(wallDimensions).toHaveLength(26);
    expect(wallDimensions.every(([, halfDepth]) => halfDepth === 0.325)).toBe(true);
    const expectedWallHalfWidths = [
      2.6446667111981697, 2.6446667111981723, 2.979520542277603, 2.9795205422776054,
      2.979520542277606, 2.9795205422776063, 2.4349948994293773, 2.434994899429382,
      2.4349948994293755, 2.8391225437014658, 2.8391225437014667, 2.8391225437014724,
      2.8391225437014658, 2.8391225437014658, 2.8391225437014667, 2.8866575680317688,
      2.886657568031776, 2.886657568031762, 2.8866575680317634, 2.8866575680317754,
      2.8866575680317763, 2.8866575680317617, 3.0804197164194327, 3.0804197164194336,
      3.0804197164194336, 3.080419716419433,
    ];
    for (const [index, [halfWidth]] of wallDimensions.entries()) {
      expect(halfWidth).toBeCloseTo(expectedWallHalfWidths[index], 12);
    }
  });

  it('keeps every exclusion just inside its padded boundary and rejects just outside', () => {
    const exclusions = eastbrookGrassExclusions(PROPS.buildings, true, BUILTIN_NOTICEBOARDS);
    for (const exclusion of exclusions) {
      if (exclusion.kind === 'circle') {
        const boundary = exclusion.radius + PADDING;
        expect(
          insideEastbrookGrassExclusion(
            [exclusion],
            exclusion.x + boundary - BOUNDARY_EPSILON,
            exclusion.z,
            PADDING,
          ),
          `${exclusion.id} circle inside`,
        ).toBe(true);
        expect(
          insideEastbrookGrassExclusion(
            [exclusion],
            exclusion.x + boundary + BOUNDARY_EPSILON,
            exclusion.z,
            PADDING,
          ),
          `${exclusion.id} circle outside`,
        ).toBe(false);
        continue;
      }

      const localXInside = exclusion.halfWidth + PADDING - BOUNDARY_EPSILON;
      const localXOutside = exclusion.halfWidth + PADDING + BOUNDARY_EPSILON;
      const cosine = Math.cos(exclusion.rotation);
      const sine = Math.sin(exclusion.rotation);
      const worldPoint = (localX: number) => ({
        x: exclusion.x + localX * cosine,
        z: exclusion.z - localX * sine,
      });
      const inside = worldPoint(localXInside);
      const outside = worldPoint(localXOutside);
      expect(
        insideEastbrookGrassExclusion([exclusion], inside.x, inside.z, PADDING),
        `${exclusion.id} OBB inside`,
      ).toBe(true);
      expect(
        insideEastbrookGrassExclusion([exclusion], outside.x, outside.z, PADDING),
        `${exclusion.id} OBB outside`,
      ).toBe(false);
    }

    // Keep the original Armoury regression pin literal: its 4.85-yard padded
    // world-X edge is rotated from the footprint's local depth axis. Isolate
    // that OBB because its service apron intentionally overlaps the outer edge.
    const armoury = exclusions.find((exclusion) => exclusion.id === 'eastbrook_grand_armoury');
    if (!armoury) throw new Error('missing Armoury exclusion');
    expect(insideEastbrookGrassExclusion([armoury], 12.66, -5.5, PADDING)).toBe(true);
    expect(insideEastbrookGrassExclusion([armoury], 12.64, -5.5, PADDING)).toBe(false);
  });

  it('keeps grass out of the well and wall while preserving every exact gate opening', () => {
    const exclusions = eastbrookGrassExclusions(PROPS.buildings, true, BUILTIN_NOTICEBOARDS);
    const well = EASTBROOK_LAYOUT.civic.wellBeacon;
    expect(
      insideEastbrookGrassExclusion(exclusions, well.position.x, well.position.z, PADDING),
    ).toBe(true);
    for (const segment of EASTBROOK_LAYOUT.wall.segments) {
      expect(
        insideEastbrookGrassExclusion(
          exclusions,
          segment.footprint.center.x,
          segment.footprint.center.z,
          PADDING,
        ),
        segment.id,
      ).toBe(true);
    }
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      expect(
        insideEastbrookGrassExclusion(exclusions, gate.crossing.x, gate.crossing.z, PADDING),
        gate.id,
      ).toBe(false);
    }
  });

  it('never injects the canonical layout into a custom world snapshot', () => {
    expect(eastbrookGrassExclusions([], false, [])).toEqual([]);
    const explicitLandmarkOnly = eastbrookGrassExclusions(PROPS.buildings, false);
    expect(explicitLandmarkOnly).toHaveLength(1);
    expect(explicitLandmarkOnly[0].id).toBe('eastbrook_grand_armoury');
    const bank = EASTBROOK_LAYOUT.buildings[0];
    expect(
      insideEastbrookGrassExclusion(
        explicitLandmarkOnly,
        bank.position.x,
        bank.position.z,
        PADDING,
      ),
    ).toBe(false);

    const customBoard = {
      id: 'custom_noticeboard',
      entityId: 2_000_000_002,
      templateId: EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
      assetId: EASTBROOK_NOTICEBOARD_ASSET_ID,
      name: 'Custom Board',
      x: 120,
      z: -80,
      rotation: 0.25,
      ...EASTBROOK_NOTICEBOARD_NATIVE_DIMENSIONS,
      interactionRadius: EASTBROOK_NOTICEBOARD_INTERACTION_RADIUS,
      frontStandingPoint: { x: 120, z: -78 },
    } satisfies NoticeboardDef;
    expect(eastbrookGrassExclusions([], false, [customBoard])).toEqual([
      {
        kind: 'obb',
        id: 'custom_noticeboard',
        x: 120,
        z: -80,
        halfWidth: 1.2,
        halfDepth: 0.3,
        rotation: 0.25,
      },
      {
        kind: 'circle',
        id: 'custom_noticeboard:serviceApron',
        x: 120,
        z: -78,
        radius: 1.2,
      },
    ]);
  });

  it('uses only the active world hub for grass clearance', () => {
    const customZones = [{ hub: { x: 120, z: -80 } }];
    expect(insideGrassHubExclusion(customZones, 0, 0)).toBe(false);
    expect(insideGrassHubExclusion(customZones, 120, -80)).toBe(true);
    expect(insideGrassHubExclusion(customZones, 134.99, -80)).toBe(true);
    expect(insideGrassHubExclusion(customZones, 135.01, -80)).toBe(false);
  });

  it('uses only active-world hubs and camps for dressing clearance', () => {
    const zones = [{ hub: { x: 120, z: -80, radius: 9 } }];
    const camps = [{ center: { x: -70, z: 95 }, radius: 6 }];
    expect(insideDressingExclusion(zones, camps, 0, 0)).toBe(false);
    expect(insideDressingExclusion(zones, camps, 132.9, -80)).toBe(true);
    expect(insideDressingExclusion(zones, camps, 133.1, -80)).toBe(false);
    expect(insideDressingExclusion(zones, camps, -62.1, 95)).toBe(true);
    expect(insideDressingExclusion(zones, camps, -61.9, 95)).toBe(false);
  });

  it('wires the one-time active-world snapshot into streamed grass', () => {
    const source = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    expect(source).toContain('const GRASS_BUILDING_PADDING = 0.35;');
    expect(source).toContain('activeContent === BUILTIN_WORLD');
    expect(source).toContain('activeContent.services?.noticeboards ?? []');
    expect(source).toContain('insideGrassHubExclusion(activeContent.zones, x, z)');
    expect(source).toContain(
      'insideDressingExclusion(activeContent.zones, activeContent.camps, x, z)',
    );
    expect(source).toMatch(
      /if \(insideEastbrookGrassExclusion\(townExclusions, x, z, GRASS_BUILDING_PADDING\)\)\s*continue;/,
    );
  });
});
