import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  circleIntersectsObb,
  distancePointToObb,
  EASTBROOK_LAYOUT,
  generateCircularWallSegments,
  localToWorld,
  type Obb2,
  obbCorners,
  obbsOverlap,
  type Point2,
  pointAtYaw,
  REMOVED_EASTBROOK_PLACEMENTS,
  samplePolyline,
} from '../src/sim/eastbrook_layout';

const EPSILON = 1e-9;
const PLAYER_RADIUS = 0.5;
const MAX_MOVER_RADIUS = 0.8;

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) expectDeepFrozen(child);
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nonWallSolidObbs(): Obb2[] {
  return [
    ...EASTBROOK_LAYOUT.preservedBuildings.map((building) => building.footprint),
    ...EASTBROOK_LAYOUT.buildings.map((building) => building.footprint),
    ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.footprint),
    ...EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.footprint),
    ...EASTBROOK_LAYOUT.fences.map((fence) => fence.footprint),
    EASTBROOK_LAYOUT.services.noticeboard.footprint,
  ];
}

function pointClearance(point: Point2, includeWall = false): number {
  let clearance =
    Math.hypot(
      point.x - EASTBROOK_LAYOUT.civic.wellBeacon.position.x,
      point.z - EASTBROOK_LAYOUT.civic.wellBeacon.position.z,
    ) - EASTBROOK_LAYOUT.civic.wellBeacon.radius;
  const obbs = includeWall
    ? [...nonWallSolidObbs(), ...EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.footprint)]
    : nonWallSolidObbs();
  for (const obb of obbs) clearance = Math.min(clearance, distancePointToObb(point, obb));
  return clearance;
}

describe('removed Eastbrook placement inventory', () => {
  it('literally pins every collision-bearing town placement being replaced', () => {
    expect(REMOVED_EASTBROOK_PLACEMENTS.buildings).toEqual([
      {
        id: 'legacy_eastbrook_house_northeast',
        disposition: 'removed',
        kind: 'house',
        x: 10,
        z: 12,
        width: 7,
        depth: 6,
        rotation: -0.4,
      },
      {
        id: 'legacy_eastbrook_house_northwest',
        disposition: 'removed',
        kind: 'house',
        x: -10,
        z: 10,
        width: 6,
        depth: 5,
        rotation: 0.5,
      },
      {
        id: 'legacy_eastbrook_chapel',
        disposition: 'removed',
        kind: 'chapel',
        x: -16,
        z: -8,
        width: 5,
        depth: 7,
        rotation: 0.9,
      },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.wells).toEqual([
      {
        id: 'legacy_eastbrook_well',
        disposition: 'replaced',
        replacedBy: 'eastbrook_civic_well_beacon',
        x: 0,
        z: 2,
        radius: 1.5,
      },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.stalls).toEqual([
      {
        id: 'legacy_eastbrook_provisioner_stall',
        disposition: 'removed',
        x: -8.5,
        z: 3,
        rotation: Math.PI / 2,
        radius: 1.7,
        smithy: false,
      },
      {
        id: 'legacy_eastbrook_smithy_stall',
        disposition: 'removed',
        x: 9.5,
        z: 17.5,
        rotation: -2.7,
        radius: 1.7,
        smithy: true,
      },
      {
        id: 'legacy_eastbrook_world_market_stall',
        disposition: 'removed',
        x: 0,
        z: 11.5,
        rotation: Math.PI,
        radius: 1.8,
        smithy: false,
      },
      {
        id: 'eastbrook_market_stall_artisans',
        disposition: 'removed_after_live_review',
        x: 3.5,
        z: 11.5,
        rotation: -2.788602,
        width: 2.8,
        depth: 2.2,
        smithy: false,
      },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.campfires).toEqual([
      { id: 'legacy_eastbrook_town_fire', disposition: 'removed', x: 3, z: -4 },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.fences).toEqual([
      {
        id: 'legacy_eastbrook_fence_east',
        disposition: 'removed',
        start: { x: 16, z: 16 },
        end: { x: 22, z: 4 },
      },
      {
        id: 'legacy_eastbrook_fence_west',
        disposition: 'removed',
        start: { x: -16, z: 14 },
        end: { x: -20, z: 2 },
      },
      {
        id: 'eastbrook_fence_market_outer',
        disposition: 'removed',
        start: { x: -12.222218917656093, z: 4.01813945810839 },
        end: { x: -11.729022993287566, z: 1.0589575136875549 },
      },
    ]);

    const serialized = JSON.stringify(REMOVED_EASTBROOK_PLACEMENTS);
    expect(serialized).not.toContain('eastbrook_grand_armoury');
  });

  it('pins all ten renderer-only Artisan Row placements and every old NPC and station anchor', () => {
    expect(REMOVED_EASTBROOK_PLACEMENTS.artisanRow).toEqual([
      {
        id: 'engineering_workbench',
        disposition: 'removed',
        assetId: '/models/props/engineering_workbench.glb',
        nativeHeight: 1,
        x: 2,
        z: 20,
        rotation: 0.4,
      },
      {
        id: 'alchemy_cauldron',
        disposition: 'removed',
        assetId: '/models/props/alchemy_cauldron.glb',
        nativeHeight: 0.9,
        x: 5,
        z: 23,
        rotation: -0.6,
      },
      {
        id: 'cooking_spit',
        disposition: 'removed',
        assetId: '/models/props/cooking_spit.glb',
        nativeHeight: 0.85,
        x: 9,
        z: 25,
        rotation: 0,
      },
      {
        id: 'leatherworking_rack',
        disposition: 'removed',
        assetId: '/models/props/leatherworking_rack.glb',
        nativeHeight: 1.5,
        x: 13,
        z: 24,
        rotation: 0.9,
      },
      {
        id: 'tailoring_loom',
        disposition: 'removed',
        assetId: '/models/props/tailoring_loom.glb',
        nativeHeight: 1.3,
        x: 13.5,
        z: 20.5,
        rotation: 1.6,
      },
      {
        id: 'inscription_lectern',
        disposition: 'removed',
        assetId: '/models/props/inscription_lectern.glb',
        nativeHeight: 1.1,
        x: 19.5,
        z: 14.5,
        rotation: 2.4,
      },
      {
        id: 'enchanting_altar',
        disposition: 'removed',
        assetId: '/models/props/enchanting_altar.glb',
        nativeHeight: 1,
        x: 16,
        z: 13,
        rotation: -2.6,
      },
      {
        id: 'jewelcrafting_bench',
        disposition: 'removed',
        assetId: '/models/props/jewelcrafting_bench.glb',
        nativeHeight: 0.9,
        x: 15,
        z: 9,
        rotation: -1.8,
      },
      {
        id: 'mining_ore_cart',
        disposition: 'removed',
        assetId: '/models/props/mining_ore_cart.glb',
        nativeHeight: 1.1,
        x: 3,
        z: 12,
        rotation: -0.9,
      },
      {
        id: 'herbalism_drying_rack',
        disposition: 'removed',
        assetId: '/models/props/herbalism_drying_rack.glb',
        nativeHeight: 1.4,
        x: 1,
        z: 16,
        rotation: 0.3,
      },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.npcPlacements).toEqual([
      { id: 'the_merchant', disposition: 'relocated', position: { x: 0, z: 9.5 }, facing: Math.PI },
      {
        id: 'marshal_redbrook',
        disposition: 'relocated',
        position: { x: 4, z: 6 },
        facing: Math.PI,
      },
      {
        id: 'trader_wilkes',
        disposition: 'relocated',
        position: { x: -7, z: 3 },
        facing: Math.PI / 2,
      },
      {
        id: 'apothecary_lin',
        disposition: 'relocated',
        position: { x: 11, z: -3 },
        facing: -Math.PI / 2,
      },
      { id: 'brother_aldric', disposition: 'relocated', position: { x: -14, z: -10 }, facing: 0.8 },
      { id: 'smith_haldren', disposition: 'relocated', position: { x: 7, z: 16.5 }, facing: -2.7 },
      {
        id: 'fisherman_brandt',
        disposition: 'relocated',
        position: { x: -16, z: 6 },
        facing: -0.75,
      },
      { id: 'foreman_odell', disposition: 'relocated', position: { x: -4, z: -14 }, facing: -2.14 },
      {
        id: 'bursar_fernando',
        disposition: 'relocated',
        position: { x: 13, z: 8 },
        facing: -Math.PI / 2,
      },
      {
        id: 'card_master',
        disposition: 'relocated',
        position: { x: 13, z: 2 },
        facing: -Math.PI / 2,
      },
      { id: 'chronicler_saul', disposition: 'relocated', position: { x: 15, z: -16 }, facing: 2.4 },
      {
        id: 'fury',
        disposition: 'relocated',
        position: { x: -11, z: 1 },
        facing: Math.PI / 2,
      },
      {
        id: 'forgemistress_darva',
        disposition: 'relocated',
        position: { x: 5, z: 15 },
        facing: -2.4,
      },
      {
        id: 'cook_marlow',
        disposition: 'relocated',
        position: { x: -12.5, z: 3 },
        facing: Math.PI / 2,
      },
      { id: 'weaver_ottilie', disposition: 'relocated', position: { x: -4, z: -9 }, facing: 0.8 },
      { id: 'tinker_gizzel', disposition: 'relocated', position: { x: 9.5, z: -14 }, facing: -0.8 },
    ]);
    expect(REMOVED_EASTBROOK_PLACEMENTS.stationDecorativeClusters).toEqual([
      {
        id: 'station_eastbrook_forge',
        disposition: 'relocated',
        type: 'forge',
        position: { x: 7, z: 16.5 },
      },
      {
        id: 'station_eastbrook_kitchens',
        disposition: 'relocated',
        type: 'kitchens',
        position: { x: -11, z: 4.5 },
      },
      {
        id: 'station_eastbrook_loom',
        disposition: 'relocated',
        type: 'loom',
        position: { x: -2, z: -8 },
      },
      {
        id: 'station_eastbrook_toolworks',
        disposition: 'relocated',
        type: 'toolworks',
        position: { x: 11, z: -12 },
      },
    ]);
  });
});

describe('authoritative Eastbrook replacement plan', () => {
  it('is deeply immutable and pins the preserved Armoury without making it an inn', () => {
    expectDeepFrozen(EASTBROOK_LAYOUT);
    expect(EASTBROOK_LAYOUT.id).toBe('eastbrook_civic_layout_v2');
    expect(EASTBROOK_LAYOUT.preservedBuildings).toEqual([
      {
        id: 'eastbrook_grand_armoury',
        assetId: '/models/props/eastbrook_grand_armoury.glb',
        landmark: 'eastbrook_grand_armoury',
        kind: 'house',
        position: { x: 17.5, z: -5.5 },
        nativeDimensions: { width: 13, height: 16.35, depth: 9 },
        aboveGradeHeight: 15,
        foundationDepth: 1.35,
        rotation: -Math.PI / 2,
        footprint: {
          id: 'eastbrook_grand_armoury',
          center: { x: 17.5, z: -5.5 },
          halfWidth: 6.5,
          halfDepth: 4.5,
          rotation: -Math.PI / 2,
        },
        maxCornerRadius: 7.905694150420948,
        frontStandingPoint: { x: 12, z: -5.5 },
      },
    ]);
  });

  it('literally pins every new building and derives each front from local +Z', () => {
    expect(
      EASTBROOK_LAYOUT.buildings.map((building) => ({
        id: building.id,
        assetId: building.assetId,
        kind: building.kind,
        position: building.position,
        nativeDimensions: building.nativeDimensions,
        rotation: building.rotation,
        maxCornerRadius: building.maxCornerRadius,
      })),
    ).toEqual([
      {
        id: 'eastbrook_bank',
        assetId: '/models/props/eastbrook_bank.glb',
        kind: 'house',
        position: { x: 18, z: 10.5 },
        nativeDimensions: { width: 7, height: 7.8, depth: 5.5 },
        rotation: Math.atan2(-18, -8.5),
        maxCornerRadius: 4.451123453691213,
      },
      {
        id: 'eastbrook_smithy',
        assetId: '/models/props/eastbrook_smithy.glb',
        kind: 'house',
        position: { x: 4.8, z: 19.7 },
        nativeDimensions: { width: 7, height: 7.5, depth: 5.5 },
        rotation: -2.876775,
        maxCornerRadius: 4.451123453691213,
      },
      {
        id: 'eastbrook_inn',
        assetId: '/models/props/eastbrook_inn.glb',
        kind: 'inn',
        position: { x: -12.5, z: 16.5 },
        nativeDimensions: { width: 7.5, height: 8.5, depth: 6 },
        rotation: Math.atan2(12.5, -14.5),
        maxCornerRadius: 4.802343178074636,
      },
      {
        id: 'eastbrook_chapel',
        assetId: '/models/props/eastbrook_chapel.glb',
        kind: 'chapel',
        position: { x: -21, z: -2.3 },
        nativeDimensions: { width: 5.5, height: 7, depth: 6 },
        rotation: 1.368826,
        maxCornerRadius: 4.0697051490249265,
      },
      {
        id: 'eastbrook_weaving_workshop',
        assetId: '/models/props/eastbrook_weaving_workshop.glb',
        kind: 'house',
        position: { x: -7.2, z: -21 },
        nativeDimensions: { width: 5.5, height: 5.8, depth: 4.5 },
        rotation: 0.30338,
        maxCornerRadius: 3.5531676008879742,
      },
      {
        id: 'eastbrook_toolworks',
        assetId: '/models/props/eastbrook_toolworks.glb',
        kind: 'house',
        position: { x: 6.2, z: -18 },
        nativeDimensions: { width: 5.5, height: 5.8, depth: 4.5 },
        rotation: -0.3006056700423954,
        maxCornerRadius: 3.5531676008879742,
      },
    ]);

    for (const building of EASTBROOK_LAYOUT.buildings) {
      expect(building.footprint).toEqual({
        id: building.id,
        center: building.position,
        halfWidth: building.nativeDimensions.width / 2,
        halfDepth: building.nativeDimensions.depth / 2,
        rotation: building.rotation,
      });
      expect(building.frontStandingPoint).toEqual(
        localToWorld(
          building.position,
          building.rotation,
          0,
          building.nativeDimensions.depth / 2 + building.frontClearance,
        ),
      );
    }
  });

  it('pins the offset civic beacon, three clear-lane benches, and the distributed market', () => {
    expect(EASTBROOK_LAYOUT.civic.center).toEqual({ x: 0, z: 2 });
    expect(EASTBROOK_LAYOUT.civic.ring).toEqual({ radius: 4.75, pathHalfWidth: 1.5 });
    expect(EASTBROOK_LAYOUT.civic.wellBeacon).toEqual({
      id: 'eastbrook_civic_well_beacon',
      assetId: '/models/props/eastbrook_civic_well_beacon.glb',
      position: { x: -0.75, z: 2 },
      radius: 1.5,
      height: 3.1,
      nativeDimensions: { width: 3.2, height: 3.1, depth: 3.2 },
    });
    expect(
      EASTBROOK_LAYOUT.civic.benches.map((bench) => ({
        id: bench.id,
        assetId: bench.assetId,
        position: bench.position,
        rotation: bench.rotation,
        width: bench.width,
        depth: bench.depth,
      })),
    ).toEqual([
      {
        id: 'eastbrook_civic_bench_north',
        assetId: '/models/dungeon/bench.glb',
        position: { x: 0, z: 4.9 },
        rotation: Math.PI,
        width: 1.8,
        depth: 0.6,
      },
      {
        id: 'eastbrook_civic_bench_south',
        assetId: '/models/dungeon/bench.glb',
        position: { x: 0, z: -0.9 },
        rotation: 0,
        width: 1.8,
        depth: 0.6,
      },
      {
        id: 'eastbrook_civic_bench_west',
        assetId: '/models/dungeon/bench.glb',
        position: { x: -2.9, z: 2 },
        rotation: Math.PI / 2,
        width: 1.8,
        depth: 0.6,
      },
    ]);

    expect(EASTBROOK_LAYOUT.market.arrangement).toBe('distributed');
    expect(EASTBROOK_LAYOUT.market.axisYaw).toBeNull();
    expect(
      EASTBROOK_LAYOUT.market.stalls.map((stall) => ({
        id: stall.id,
        assetId: stall.assetId,
        canopyVariant: stall.canopyVariant,
        radiusFromCivic: stall.radiusFromCivic,
        position: stall.position,
        width: stall.width,
        depth: stall.depth,
        rotation: stall.rotation,
        frontStandingPoint: stall.frontStandingPoint,
      })),
    ).toEqual([
      {
        id: 'eastbrook_market_stall_world_market',
        assetId: '/models/props/eastbrook_market_stall.glb',
        canopyVariant: 'gold',
        radiusFromCivic: 9.300537618869136,
        position: { x: -5.5, z: 9.5 },
        width: 2.8,
        depth: 2.2,
        rotation: 2.508844,
        frontStandingPoint: { x: -4.55381837226296, z: 8.20975183498178 },
      },
      {
        id: 'eastbrook_market_stall_provisions',
        assetId: '/models/props/eastbrook_market_stall.glb',
        canopyVariant: 'green',
        radiusFromCivic: 9.124143795447328,
        position: { x: -9, z: 0.5 },
        width: 2.8,
        depth: 2.2,
        rotation: 1.405648,
        frontStandingPoint: { x: -7.421769629642221, z: 0.7630378263298812 },
      },
    ]);
    expect(EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id)).not.toContain(
      'eastbrook_market_stall_artisans',
    );
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      const towardCivic = {
        x: EASTBROOK_LAYOUT.civic.center.x - stall.position.x,
        z: EASTBROOK_LAYOUT.civic.center.z - stall.position.z,
      };
      const localFront = { x: Math.sin(stall.rotation), z: Math.cos(stall.rotation) };
      expect(localFront.x * towardCivic.x + localFront.z * towardCivic.z).toBeGreaterThan(0);
    }
    for (let left = 0; left < EASTBROOK_LAYOUT.market.stalls.length; left++) {
      for (let right = left + 1; right < EASTBROOK_LAYOUT.market.stalls.length; right++) {
        expect(
          distance(
            EASTBROOK_LAYOUT.market.stalls[left].position,
            EASTBROOK_LAYOUT.market.stalls[right].position,
          ),
        ).toBeGreaterThan(8);
      }
    }

    const npcsByAnchor = new Map(EASTBROOK_LAYOUT.services.npcs.map((npc) => [npc.anchorId, npc]));
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      const vendor = npcsByAnchor.get(stall.id);
      expect(vendor, `missing vendor for ${stall.id}`).toBeDefined();
      if (!vendor) throw new Error(`missing vendor for ${stall.id}`);
      expect(vendor.facing, `${vendor.id} faces away from customers`).toBe(stall.rotation);
      expect(
        distance(vendor.position, stall.position),
        `${vendor.id} public-side distance`,
      ).toBeCloseTo(1.9, 12);
      const publicSide = {
        x: Math.sin(stall.rotation),
        z: Math.cos(stall.rotation),
      };
      expect(
        (vendor.position.x - stall.position.x) * publicSide.x +
          (vendor.position.z - stall.position.z) * publicSide.z,
        `${vendor.id} stands behind the stall`,
      ).toBeGreaterThan(0);
    }
  });

  it('pins only low smithy-yard fences', () => {
    expect(
      EASTBROOK_LAYOUT.fences.map((fence) => ({
        id: fence.id,
        district: fence.district,
        start: fence.start,
        end: fence.end,
        width: fence.width,
        height: fence.height,
      })),
    ).toEqual([
      {
        id: 'eastbrook_fence_smithy_west',
        district: 'smithy_yard',
        start: { x: 10.42562417868173, z: 23.25138741905632 },
        end: { x: 9.98067759818833, z: 21.610649005869373 },
        width: 0.28,
        height: 0.9,
      },
      {
        id: 'eastbrook_fence_smithy_outer',
        district: 'smithy_yard',
        start: { x: 10.214602090559337, z: 23.61944947676462 },
        end: { x: 2.107424048929704, z: 25.81800905096731 },
        width: 0.28,
        height: 0.9,
      },
      {
        id: 'eastbrook_fence_smithy_east',
        district: 'smithy_yard',
        start: { x: 1.739361991221407, z: 25.606986962844914 },
        end: { x: 1.2944154107280057, z: 23.966248549657966 },
        width: 0.28,
        height: 0.9,
      },
    ]);
    expect(EASTBROOK_LAYOUT.fences.every((fence) => fence.height <= 1)).toBe(true);
  });
});

describe('wall and road geometry', () => {
  it('pins the wall, the six exact five-yard gates, and complete bounded spans', () => {
    expect({
      center: EASTBROOK_LAYOUT.wall.center,
      assetId: EASTBROOK_LAYOUT.wall.assetId,
      radius: EASTBROOK_LAYOUT.wall.radius,
      thickness: EASTBROOK_LAYOUT.wall.thickness,
      height: EASTBROOK_LAYOUT.wall.height,
      maximumSegmentSpan: EASTBROOK_LAYOUT.wall.maximumSegmentSpan,
    }).toEqual({
      center: { x: 0, z: 0 },
      assetId: '/models/props/eastbrook_wall_wing.glb',
      radius: 28.4,
      thickness: 0.65,
      height: 2.7,
      maximumSegmentSpan: 6.5,
    });
    expect(
      EASTBROOK_LAYOUT.wall.gates.map((gate) => ({
        id: gate.id,
        roadId: gate.roadId,
        crossing: gate.crossing,
        width: gate.width,
      })),
    ).toEqual([
      {
        id: 'eastbrook_gate_east',
        roadId: 'east',
        crossing: { x: 27.443132443127425, z: 7.309889308940804 },
        width: 5,
      },
      {
        id: 'eastbrook_gate_northeast',
        roadId: 'northeast',
        crossing: { x: 19.58928369573657, z: 20.562586517458097 },
        width: 5,
      },
      {
        id: 'eastbrook_gate_north',
        roadId: 'north',
        crossing: { x: -7.190451611555966, z: 27.474668435158083 },
        width: 5,
      },
      {
        id: 'eastbrook_gate_northwest',
        roadId: 'northwest',
        crossing: { x: -23.056701749697417, z: 16.58157122909346 },
        width: 5,
      },
      {
        id: 'eastbrook_gate_southwest',
        roadId: 'southwest',
        crossing: { x: -20.69365035767656, z: -19.45077980118619 },
        width: 5,
      },
      {
        id: 'eastbrook_gate_bandit',
        roadId: 'bandit',
        crossing: { x: 20.08183258569795, z: -20.08183258569795 },
        width: 5,
      },
    ]);

    for (let index = 1; index < EASTBROOK_LAYOUT.wall.gates.length; index++) {
      expect(EASTBROOK_LAYOUT.wall.gates[index].angle).toBeGreaterThan(
        EASTBROOK_LAYOUT.wall.gates[index - 1].angle,
      );
    }
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      expect(distance(gate.start, gate.end)).toBeCloseTo(5, 10);
      expect(Math.hypot(gate.crossing.x, gate.crossing.z)).toBeCloseTo(28.4, 3);
    }

    const regenerated = generateCircularWallSegments(
      {
        assetId: EASTBROOK_LAYOUT.wall.assetId,
        center: EASTBROOK_LAYOUT.wall.center,
        radius: EASTBROOK_LAYOUT.wall.radius,
        thickness: EASTBROOK_LAYOUT.wall.thickness,
        height: EASTBROOK_LAYOUT.wall.height,
        maximumSegmentSpan: EASTBROOK_LAYOUT.wall.maximumSegmentSpan,
      },
      EASTBROOK_LAYOUT.wall.gates,
    );
    expect(regenerated).toEqual(EASTBROOK_LAYOUT.wall.segments);
    expect(EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id)).toEqual(
      EASTBROOK_LAYOUT.wall.segments.map(
        (_, index) => `eastbrook_wall_${String(index).padStart(2, '0')}`,
      ),
    );
    for (let index = 0; index < EASTBROOK_LAYOUT.wall.segments.length; index++) {
      const segment = EASTBROOK_LAYOUT.wall.segments[index];
      expect(segment.arcLength).toBeLessThanOrEqual(6.5 + EPSILON);
      if (index > 0) {
        const previous = EASTBROOK_LAYOUT.wall.segments[index - 1];
        expect(segment.startAngle).toBeGreaterThanOrEqual(previous.endAngle - EPSILON);
        if (Math.abs(segment.startAngle - previous.endAngle) <= EPSILON) {
          expect(segment.start.x).toBeCloseTo(previous.end.x, 12);
          expect(segment.start.z).toBeCloseTo(previous.end.z, 12);
        }
      }
    }
    const coveredArc = EASTBROOK_LAYOUT.wall.segments.reduce(
      (sum, segment) => sum + segment.arcLength,
      0,
    );
    const gateArc = EASTBROOK_LAYOUT.wall.gates.reduce(
      (sum, gate) => sum + (gate.endAngle - gate.startAngle) * EASTBROOK_LAYOUT.wall.radius,
      0,
    );
    expect(coveredArc + gateArc).toBeCloseTo(Math.PI * 2 * 28.4, 9);
  });

  it('keeps the fixed-seed east boar wander target outside the solid wall', () => {
    // Seed 4242, entity 54: this pre-existing target must remain reachable or
    // its arrival-timer draw disappears and forks the shared RNG stream.
    const wanderTarget = { x: 29.4338221478, z: 0.9998592577 };
    const clearances = EASTBROOK_LAYOUT.wall.segments
      .map((segment) => ({
        id: segment.id,
        clearance: distancePointToObb(wanderTarget, segment.footprint),
      }))
      .sort((left, right) => left.clearance - right.clearance);
    expect(clearances[0]).toEqual({
      id: 'eastbrook_wall_25',
      clearance: 0.8805028274180917,
    });
    expect(clearances[0].clearance).toBeGreaterThan(PLAYER_RADIUS);
  });

  it('pins six three-yard lanes from the civic ring through the existing road points', () => {
    expect(
      EASTBROOK_LAYOUT.roads.map((road) => ({
        id: road.id,
        existingRoadPoint: road.existingRoadPoint,
        gateId: road.gateId,
        halfWidth: road.halfWidth,
        points: road.points,
      })),
    ).toEqual([
      {
        id: 'north',
        existingRoadPoint: { x: 0, z: 8 },
        gateId: 'eastbrook_gate_north',
        halfWidth: 1.5,
        points: [
          { x: 0, z: 6.75 },
          { x: 0, z: 8 },
          { x: -7.190451611555966, z: 27.474668435158083 },
          { x: -7.469, z: 28.539 },
        ],
      },
      {
        id: 'east',
        existingRoadPoint: { x: 8, z: 2 },
        gateId: 'eastbrook_gate_east',
        halfWidth: 1.5,
        points: [
          { x: 4.75, z: 2 },
          { x: 8, z: 2 },
          { x: 15, z: 3.5 },
          { x: 23, z: 4.5 },
          { x: 27.443132443127425, z: 7.309889308940804 },
          { x: 28.506, z: 7.593 },
        ],
      },
      {
        id: 'bandit',
        existingRoadPoint: { x: 6, z: -6 },
        gateId: 'eastbrook_gate_bandit',
        halfWidth: 1.5,
        points: [
          { x: 2.85, z: -1.8000000000000003 },
          { x: 6, z: -6 },
          { x: 8, z: -12 },
          { x: 20.08183258569795, z: -20.08183258569795 },
          { x: 20.86, z: -20.86 },
        ],
      },
      {
        id: 'northwest',
        existingRoadPoint: { x: -8, z: 6 },
        gateId: 'eastbrook_gate_northwest',
        halfWidth: 1.5,
        points: [
          { x: -4.2485291572496005, z: 4.124264578624801 },
          { x: -8, z: 6 },
          { x: -15, z: 8 },
          { x: -21, z: 11 },
          { x: -23.056701749697417, z: 16.58157122909346 },
          { x: -23.95, z: 17.224 },
        ],
      },
      {
        id: 'southwest',
        existingRoadPoint: { x: -6, z: -6 },
        gateId: 'eastbrook_gate_southwest',
        halfWidth: 1.5,
        points: [
          { x: -2.85, z: -1.8000000000000003 },
          { x: -6, z: -6 },
          { x: -10, z: -8 },
          { x: -20, z: -9 },
          { x: -22, z: -12 },
          { x: -17.851916681798443, z: -16.779722011586674 },
          { x: -20.69365035767656, z: -19.45077980118619 },
          { x: -21.495, z: -20.204 },
        ],
      },
      {
        id: 'northeast',
        existingRoadPoint: { x: 6, z: 8 },
        gateId: 'eastbrook_gate_northeast',
        halfWidth: 1.5,
        points: [
          { x: 3.3587572106361003, z: 5.358757210636101 },
          { x: 6, z: 8 },
          { x: 12, z: 14 },
          { x: 19.58928369573657, z: 20.562586517458097 },
          { x: 20.348, z: 21.359 },
        ],
      },
    ]);
    expect(EASTBROOK_LAYOUT.roads.find((road) => road.id === 'bandit')?.points).toContainEqual({
      x: 8,
      z: -12,
    });
  });
});

describe('layout clearance and service anchors', () => {
  it('has no replacement footprint overlap and keeps every building inside the inner wall', () => {
    const obbs = nonWallSolidObbs();
    for (let left = 0; left < obbs.length; left++) {
      for (let right = left + 1; right < obbs.length; right++) {
        expect(
          obbsOverlap(obbs[left], obbs[right]),
          `${obbs[left].id} overlaps ${obbs[right].id}`,
        ).toBe(false);
      }
      expect(
        circleIntersectsObb(
          {
            center: EASTBROOK_LAYOUT.civic.wellBeacon.position,
            radius: EASTBROOK_LAYOUT.civic.wellBeacon.radius,
          },
          obbs[left],
        ),
        `${obbs[left].id} overlaps civic beacon`,
      ).toBe(false);
    }

    const innerRadius = EASTBROOK_LAYOUT.wall.radius - EASTBROOK_LAYOUT.wall.thickness / 2;
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      for (const corner of obbCorners(building.footprint)) {
        expect(Math.hypot(corner.x, corner.z), `${building.id} crosses inner wall`).toBeLessThan(
          innerRadius,
        );
      }
    }
    for (const corner of obbCorners(EASTBROOK_LAYOUT.services.noticeboard.footprint)) {
      expect(Math.hypot(corner.x, corner.z), 'noticeboard crosses inner wall').toBeLessThan(
        innerRadius,
      );
    }
  });

  it('keeps every sampled road lane clear for player and maximum mover bodies', () => {
    for (const road of EASTBROOK_LAYOUT.roads) {
      const samples = samplePolyline(road.points, 0.1);
      expect(samples.length, road.id).toBeGreaterThan(2);
      const minimum = Math.min(...samples.map((point) => pointClearance(point, true)));
      expect(minimum, `${road.id} centerline clearance`).toBeGreaterThanOrEqual(
        road.halfWidth - 1e-6,
      );
      for (const bodyRadius of [PLAYER_RADIUS, MAX_MOVER_RADIUS]) {
        expect(
          minimum - bodyRadius,
          `${road.id} clearance for radius ${bodyRadius}`,
        ).toBeGreaterThanOrEqual(road.halfWidth - bodyRadius - 1e-6);
      }
    }
  });

  it('pins and clears player, mail, graveyard, healer, rest, station, and NPC anchors', () => {
    expect(EASTBROOK_LAYOUT.services.playerStart).toEqual({
      id: 'eastbrook_player_start',
      position: { x: 2, z: -2 },
      bodyRadius: 0.5,
    });
    expect(EASTBROOK_LAYOUT.services.mailbox).toEqual({
      id: 'mailbox_eastbrook',
      templateId: 'mailbox',
      assetId: '/models/props/mailbox_pillar.glb',
      position: { x: 0, z: -7.5 },
      bodyRadius: 0.8,
      interactionRadius: 7,
      frontStandingPoint: { x: 0, z: -6.4 },
    });
    expect(EASTBROOK_LAYOUT.services.noticeboard).toEqual({
      id: 'eastbrook_noticeboard',
      entityId: 2_000_000_001,
      templateId: 'noticeboard_eastbrook',
      assetId: '/models/props/eastbrook_noticeboard.glb',
      name: 'Notice Board',
      position: { x: 10, z: -8 },
      rotation: -0.7853981633974483,
      nativeDimensions: { width: 2.4, height: 2.6, depth: 0.6 },
      footprint: {
        id: 'eastbrook_noticeboard',
        center: { x: 10, z: -8 },
        halfWidth: 1.2,
        halfDepth: 0.3,
        rotation: -0.7853981633974483,
      },
      frontStandingPoint: { x: 9.010050506338834, z: -7.010050506338834 },
      interactionRadius: 4,
    });
    expect(EASTBROOK_LAYOUT.services.graveyard).toEqual({
      id: 'gy_eastbrook',
      position: { x: -14, z: -14 },
      legacyReleasePoint: { x: -12, z: -14 },
      healerTemplateId: 'spirit_healer',
      healerFacing: Math.PI,
      headstones: [
        { id: 'gy_eastbrook_headstone_0', position: { x: -14, z: -14 } },
        { id: 'gy_eastbrook_headstone_1', position: { x: -11.8, z: -14 } },
        { id: 'gy_eastbrook_headstone_2', position: { x: -9.6, z: -14 } },
        { id: 'gy_eastbrook_headstone_3', position: { x: -14, z: -11.4 } },
        { id: 'gy_eastbrook_headstone_4', position: { x: -11.8, z: -11.4 } },
        { id: 'gy_eastbrook_headstone_5', position: { x: -9.6, z: -11.4 } },
      ],
    });
    expect(EASTBROOK_LAYOUT.services.rest).toEqual({
      id: 'eastbrook_inn_rest',
      buildingId: 'eastbrook_inn',
    });

    expect(
      EASTBROOK_LAYOUT.services.stations.map((station) => ({
        id: station.id,
        type: station.type,
        masterNpcId: station.masterNpcId,
        position: station.position,
        interactionRadius: station.interactionRadius,
      })),
    ).toEqual([
      {
        id: 'station_eastbrook_forge',
        type: 'forge',
        masterNpcId: 'forgemistress_darva',
        position: { x: 3.687633548766497, z: 15.598153967032626 },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_kitchens',
        type: 'kitchens',
        masterNpcId: 'cook_marlow',
        position: { x: -11.45529660468886, z: 11.459306117623747 },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_loom',
        type: 'loom',
        masterNpcId: 'weaver_ottilie',
        position: { x: -6.07969668833487, z: -17.421254341270934 },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_toolworks',
        type: 'toolworks',
        masterNpcId: 'tinker_gizzel',
        position: { x: 5.089629608322198, z: -14.4181600268458 },
        interactionRadius: 20,
      },
    ]);

    expect(
      EASTBROOK_LAYOUT.services.npcs.map((npc) => [
        npc.id,
        npc.position.x,
        npc.position.z,
        npc.facing,
        npc.anchorId,
      ]),
    ).toEqual([
      [
        'the_merchant',
        -4.376409317062264,
        7.967830304040863,
        2.508844,
        'eastbrook_market_stall_world_market',
      ],
      ['marshal_redbrook', 4.5, 5.5, -2.2318394956455836, 'eastbrook_civic_well_beacon'],
      [
        'trader_wilkes',
        -7.125851435200138,
        0.812357418766734,
        1.405648,
        'eastbrook_market_stall_provisions',
      ],
      [
        'apothecary_lin',
        2.8431593444121797,
        9.717148252611294,
        -2.788602,
        'eastbrook_gate_northeast',
      ],
      ['brother_aldric', -16.59147045515334, -1.3973000209293893, 1.368826, 'eastbrook_chapel'],
      [
        'smith_haldren',
        5.617914034868791,
        15.074687401746273,
        -2.876775,
        'station_eastbrook_forge',
      ],
      ['fisherman_brandt', -22, 4, 1.661456213995642, 'eastbrook_gate_northwest'],
      ['foreman_odell', -8, -9.5, 0.607802, 'eastbrook_gate_southwest'],
      [
        'bursar_fernando',
        14.156943251329539,
        8.685223202016726,
        -2.0119758072098772,
        'eastbrook_bank',
      ],
      ['card_master', 10.5, 1, -1.4758446204521403, 'eastbrook_grand_armoury'],
      ['chronicler_saul', 0, -14.5, -0.3006056700423954, 'mailbox_eastbrook'],
      [
        'forgemistress_darva',
        1.7573530626642033,
        16.121620532318982,
        -2.876775,
        'station_eastbrook_forge',
      ],
      [
        'cook_marlow',
        -12.780764037489869,
        10.316661779002187,
        2.4301335278502854,
        'station_eastbrook_kitchens',
      ],
      ['weaver_ottilie', -4.171032337012701, -18.01874944082567, 0.30338, 'station_eastbrook_loom'],
      [
        'tinker_gizzel',
        6.999944260671105,
        -13.825962484617639,
        -0.3006056700423954,
        'station_eastbrook_toolworks',
      ],
      ['fury', -22.5, -7.5, 1.171280832795522, 'eastbrook_chapel'],
    ]);

    const pointAnchors = [
      EASTBROOK_LAYOUT.services.playerStart,
      EASTBROOK_LAYOUT.services.mailbox,
      {
        id: `${EASTBROOK_LAYOUT.services.noticeboard.id}:standing`,
        position: EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
        bodyRadius: 0.6,
      },
      ...EASTBROOK_LAYOUT.services.stations.map((station) => ({ ...station, bodyRadius: 0.8 })),
      ...EASTBROOK_LAYOUT.services.npcs,
      {
        id: EASTBROOK_LAYOUT.services.graveyard.id,
        position: EASTBROOK_LAYOUT.services.graveyard.position,
        bodyRadius: 0.6,
      },
      {
        id: 'eastbrook_legacy_release',
        position: EASTBROOK_LAYOUT.services.graveyard.legacyReleasePoint,
        bodyRadius: 0.6,
      },
    ];
    for (const anchor of pointAnchors) {
      expect(
        pointClearance(anchor.position),
        `${anchor.id} overlaps a solid`,
      ).toBeGreaterThanOrEqual(anchor.bodyRadius - 1e-8);
    }
    for (const headstone of EASTBROOK_LAYOUT.services.graveyard.headstones) {
      expect(pointClearance(headstone.position), headstone.id).toBeGreaterThanOrEqual(0.3);
    }

    const npcs = new Map(EASTBROOK_LAYOUT.services.npcs.map((npc) => [npc.id, npc]));
    for (const station of EASTBROOK_LAYOUT.services.stations) {
      const master = npcs.get(station.masterNpcId);
      expect(master, station.masterNpcId).toBeDefined();
      if (!master) throw new Error(`missing station master ${station.masterNpcId}`);
      const masterDistance = distance(station.position, master.position);
      expect(masterDistance).toBeGreaterThanOrEqual(1);
      expect(masterDistance).toBeLessThanOrEqual(3);
    }
    const loom = EASTBROOK_LAYOUT.services.stations.find((station) => station.type === 'loom');
    if (!loom) throw new Error('missing Eastbrook loom station');
    expect(distance(loom.position, EASTBROOK_LAYOUT.services.graveyard.position)).toBeGreaterThan(
      8,
    );
  });

  it('keeps every entrance, stall standing point, service route, and banker chest sample clear', () => {
    for (const building of EASTBROOK_LAYOUT.buildings) {
      expect(pointClearance(building.frontStandingPoint), building.id).toBeGreaterThanOrEqual(
        MAX_MOVER_RADIUS - 1e-8,
      );
    }
    expect(
      pointClearance(EASTBROOK_LAYOUT.preservedBuildings[0].frontStandingPoint),
      'Armoury approach',
    ).toBeGreaterThanOrEqual(MAX_MOVER_RADIUS);
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      expect(pointClearance(stall.frontStandingPoint), stall.id).toBeGreaterThanOrEqual(
        PLAYER_RADIUS - 1e-8,
      );
    }
    expect(
      pointClearance(EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint),
      'noticeboard standing point',
    ).toBeGreaterThanOrEqual(MAX_MOVER_RADIUS - 1e-8);
    for (const route of EASTBROOK_LAYOUT.services.routes) {
      for (const point of samplePolyline(route.points, 0.1)) {
        expect(pointClearance(point), `${route.id} is blocked`).toBeGreaterThanOrEqual(
          route.bodyRadius - 1e-6,
        );
      }
    }

    expect(EASTBROOK_LAYOUT.services.bankerChest).toEqual({
      id: 'eastbrook_banker_chest',
      assetId: '/models/props/banker_chest.glb',
      attachedToNpcId: 'bursar_fernando',
      bakedIntoBankAsset: false,
      targetHeight: 1.3,
      halfWidth: 1.09,
      halfDepth: 0.65,
      preferredLocalPlacement: { x: 1.15, z: -0.7, rotation: 0 },
    });
    for (const sample of EASTBROOK_LAYOUT.services.bankerChestSamplePoints) {
      expect(pointClearance(sample), 'banker chest sample overlaps collision').toBeGreaterThan(0);
    }
  });
});

describe('pure deterministic module boundary', () => {
  it('contains no runtime dependency, DOM, Three, random, or wall-clock access', () => {
    const source = readFileSync(new URL('../src/sim/eastbrook_layout.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain('three');
    expect(source).not.toContain('THREE');
    expect(source).not.toContain('window');
    expect(source).not.toContain('document');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('Date.');
    expect(source).not.toContain('performance.');
  });

  it('keeps yaw and sampling helpers deterministic without mutating inputs', () => {
    const origin = Object.freeze({ x: 2, z: -3 });
    expect(pointAtYaw(origin, Math.PI / 2, 4)).toEqual({ x: 6, z: -2.9999999999999996 });
    expect(localToWorld(origin, Math.PI / 2, 2, 3)).toEqual({ x: 5, z: -5 });
    const points = Object.freeze([Object.freeze({ x: 0, z: 0 }), Object.freeze({ x: 0, z: 1 })]);
    expect(samplePolyline(points, 0.4)).toEqual([
      { x: 0, z: 0 },
      { x: 0, z: 1 / 3 },
      { x: 0, z: 2 / 3 },
      { x: 0, z: 1 },
    ]);
    expect(points).toEqual([
      { x: 0, z: 0 },
      { x: 0, z: 1 },
    ]);
  });
});
