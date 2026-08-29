import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  circleIntersectsObb,
  distancePointToObb,
  EASTBROOK_LAYOUT,
  generateCircularWallSegments,
  localToWorld,
  type Obb2,
  obbsOverlap,
  type Point2,
  pointAtYaw,
  REMOVED_EASTBROOK_PLACEMENTS,
  samplePolyline,
} from '../src/sim/eastbrook_layout';

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
        // Round 6 (owner): the rise house crowded the chapel green and stood
        // between Brother Aldric and the graves, so it left the layout after
        // live review and its lot became the north half of the new churchyard
        // enclosure. It joins the inventory as a removed placement.
        id: 'eastbrook_home_rise',
        disposition: 'removed_after_live_review',
        kind: 'house',
        x: -8,
        z: -82,
        width: 6.9,
        depth: 5.6,
        rotation: 1.17,
      },
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
  it('is deeply immutable and retires the preserved Armoury from placement', () => {
    expectDeepFrozen(EASTBROOK_LAYOUT);
    expect(EASTBROOK_LAYOUT.id).toBe('eastbrook_civic_layout_v2');
    // Round 4: the Grand Armoury left its Wolf Run lot (the KayKit barracks
    // garrison stands there now, authored as zone1 decorProps). The list
    // stays as the API shape every spread/map consumer reads.
    expect(EASTBROOK_LAYOUT.preservedBuildings).toEqual([]);
  });

  it('literally pins every new building and derives each front from local +Z', () => {
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md), then again for owner
    // refinement round 3: every kit lot grew so its door reads at player
    // height, and the trio of homes that were zone1 decor props are
    // first-class houses now (the chapel keeps its authored proportions).
    // Round 6 (owner) dropped eastbrook_home_rise from the table after live
    // review, so the count fell to eight buildings, not nine, and the removed
    // row now lives in REMOVED_EASTBROOK_PLACEMENTS.buildings. The same round
    // then appended the harbour quarter, three coastal lots lining the dock
    // road out to the headland, so the table is eleven buildings now.
    // Round 6b (owner) re-shelled the chapel onto the KayKit church: same id,
    // same position, same rotation and footprint, but the assetId is
    // '/models/biome/hex_church.glb' and the height rose from 7 to 9 so the
    // spire reads, which is why only those two fields moved in this table.
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
        assetId: '/models/biome/hexb_townhall.glb',
        kind: 'house',
        position: {
          x: 12,
          z: -94,
        },
        nativeDimensions: {
          width: 8.6,
          height: 12.7,
          depth: 6.9,
        },
        rotation: -2.356194490192345,
        maxCornerRadius: 5.512939324897382,
      },
      {
        id: 'eastbrook_smithy',
        assetId: '/models/biome/hexb_workshop.glb',
        kind: 'house',
        position: {
          x: -2,
          z: -122,
        },
        nativeDimensions: {
          width: 8.4,
          height: 9.6,
          depth: 6.6,
        },
        rotation: -2.0344439357957027,
        maxCornerRadius: 5.341348144429457,
      },
      {
        id: 'eastbrook_inn',
        assetId: '/models/biome/hexb_tavern.glb',
        kind: 'inn',
        position: {
          x: -38,
          z: -88,
        },
        nativeDimensions: {
          width: 8.6,
          height: 11.5,
          depth: 6.9,
        },
        rotation: -2.5535900500422257,
        maxCornerRadius: 5.512939324897382,
      },
      {
        id: 'eastbrook_chapel',
        assetId: '/models/biome/hex_church.glb',
        kind: 'chapel',
        position: {
          x: 2,
          z: -78,
        },
        nativeDimensions: {
          width: 5.5,
          height: 9,
          depth: 6,
        },
        rotation: 0.7853981633974483,
        maxCornerRadius: 4.0697051490249265,
      },
      {
        id: 'eastbrook_weaving_workshop',
        assetId: '/models/biome/hexb_home_a.glb',
        kind: 'house',
        position: {
          x: -28,
          z: -122,
        },
        nativeDimensions: {
          width: 6.9,
          height: 9.4,
          depth: 5.6,
        },
        rotation: 2.5535900500422257,
        maxCornerRadius: 4.443253312607778,
      },
      {
        id: 'eastbrook_toolworks',
        assetId: '/models/biome/hexb_home_b.glb',
        kind: 'house',
        position: {
          x: -16,
          z: -128,
        },
        nativeDimensions: {
          width: 6.9,
          height: 10.6,
          depth: 5.6,
        },
        rotation: 0.5880026035475675,
        maxCornerRadius: 4.443253312607778,
      },
      {
        id: 'eastbrook_home_market',
        assetId: '/models/biome/hexb_home_a.glb',
        kind: 'house',
        position: {
          x: -33,
          z: -111,
        },
        nativeDimensions: {
          width: 6.9,
          height: 9.4,
          depth: 5.6,
        },
        rotation: 0.2,
        maxCornerRadius: 4.443253312607778,
      },
      {
        id: 'eastbrook_home_east',
        assetId: '/models/biome/hexb_home_b.glb',
        kind: 'house',
        position: {
          x: 22,
          z: -106,
        },
        nativeDimensions: {
          width: 6.9,
          height: 10.6,
          depth: 5.6,
        },
        rotation: -1.46,
        maxCornerRadius: 4.443253312607778,
      },
      {
        id: 'eastbrook_quayside_home',
        assetId: '/models/biome/hexb_home_b.glb',
        kind: 'house',
        position: {
          x: -82,
          z: -102,
        },
        nativeDimensions: {
          width: 6.9,
          height: 10.6,
          depth: 5.6,
        },
        rotation: -2.2,
        maxCornerRadius: 4.443253312607778,
      },
      {
        id: 'eastbrook_harbour_market',
        assetId: '/models/biome/hexb_market.glb',
        kind: 'house',
        position: {
          x: -68,
          z: -108,
        },
        nativeDimensions: {
          width: 8.6,
          height: 7.5,
          depth: 7,
        },
        rotation: -2.2,
        maxCornerRadius: 5.544366510251644,
      },
      {
        id: 'eastbrook_dock_home',
        assetId: '/models/biome/hexb_home_a.glb',
        kind: 'house',
        position: {
          x: -50,
          z: -112,
        },
        nativeDimensions: {
          width: 6.9,
          height: 9.4,
          depth: 5.6,
        },
        rotation: -2.2,
        maxCornerRadius: 4.443253312607778,
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
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the civic square, its
    // offset well beacon, the benches, and both stalls now sit on the market
    // square west of the quay arrival lane.
    // Stall rows re-pinned again for owner round 6b: the two stalls stood 9 yd
    // apart on one line, so they were opened out across the square (world
    // market to (-20.5, -94), provisions to (-19, -108)), which also moves both
    // radiusFromCivic values and both derived front standing points.
    expect(EASTBROOK_LAYOUT.civic.center).toEqual({ x: -14, z: -102 });
    expect(EASTBROOK_LAYOUT.civic.ring).toEqual({ radius: 4.75, pathHalfWidth: 1.5 });
    expect(EASTBROOK_LAYOUT.civic.wellBeacon).toEqual({
      id: 'eastbrook_civic_well_beacon',
      assetId: '/models/props/eastbrook_civic_well_beacon.glb',
      position: { x: -14.75, z: -102 },
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
        position: { x: -14, z: -99.1 },
        rotation: Math.PI,
        width: 1.8,
        depth: 0.6,
      },
      {
        id: 'eastbrook_civic_bench_south',
        assetId: '/models/dungeon/bench.glb',
        position: { x: -14, z: -104.9 },
        rotation: 0,
        width: 1.8,
        depth: 0.6,
      },
      {
        id: 'eastbrook_civic_bench_west',
        assetId: '/models/dungeon/bench.glb',
        position: { x: -11.1, z: -102 },
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
        radiusFromCivic: 10.307764064044152,
        position: { x: -20.5, z: -94 },
        width: 2.8,
        depth: 2.2,
        rotation: 2.4805494847391065,
        frontStandingPoint: { x: -19.517695018376127, z: -95.26296354780212 },
      },
      {
        id: 'eastbrook_market_stall_provisions',
        assetId: '/models/props/eastbrook_market_stall.glb',
        canopyVariant: 'green',
        radiusFromCivic: 7.810249675906656,
        position: { x: -19, z: -108 },
        width: 2.8,
        depth: 2.2,
        rotation: 0.6610431688506869,
        frontStandingPoint: { x: -18.017695018376127, z: -106.73703645219788 },
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
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the yard fences derive
    // from the smithy, which moved to the crafts district at (-2, -122);
    // width and height are unchanged.
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
        start: {
          x: 5.155417527999327,
          z: -124.0124611797498,
        },
        end: {
          x: 3.5454485841994785,
          z: -124.81744565164973,
        },
        width: 0.28,
        height: 0.9,
      },
      {
        id: 'eastbrook_fence_smithy_outer',
        district: 'smithy_yard',
        start: {
          x: 5.289581606649314,
          z: -123.60996894379986,
        },
        end: {
          x: 1.0857738089497104,
          z: -115.20235334840064,
        },
        width: 0.28,
        height: 0.9,
      },
      {
        id: 'eastbrook_fence_smithy_east',
        district: 'smithy_yard',
        start: {
          x: 0.6832815729997472,
          z: -115.06818926975066,
        },
        end: {
          x: -0.9266873708001011,
          z: -115.87317374165059,
        },
        width: 0.28,
        height: 0.9,
      },
    ]);
    expect(EASTBROOK_LAYOUT.fences.every((fence) => fence.height <= 1)).toBe(true);
  });
});

describe('wall and road geometry', () => {
  it('pins the retired ring wall: config kept, zero gates and segments, generator intact', () => {
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
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the harbor town is open to
    // the quay and beach, so layout v3 retired the ring wall by design. The
    // gate and segment lists are deliberately empty with the wall API kept,
    // and the zero-gate generator must keep agreeing with the layout.
    expect(EASTBROOK_LAYOUT.wall.gates).toEqual([]);
    expect(EASTBROOK_LAYOUT.wall.segments).toEqual([]);

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
  });

  it('keeps the fixed-seed east boar wander target clear with the ring wall retired', () => {
    // Seed 4242, entity 54: this pre-existing target must remain reachable or
    // its arrival-timer draw disappears and forks the shared RNG stream.
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md), then again in round 4: the
    // preserved Armoury retired from placement with the barracks swap, so the
    // nearest remaining LAYOUT solid is the chapel, eighty yards off. The
    // barracks garrison that took the lot is a zone1 decor collider, not a
    // layout solid; its own clearance from this target is covered by the
    // gameplay-integration fixed-seed projection.
    const wanderTarget = { x: 29.4338221478, z: 0.9998592577 };
    expect(EASTBROOK_LAYOUT.wall.segments).toHaveLength(0);
    const clearances = nonWallSolidObbs()
      .map((obb) => ({
        id: obb.id,
        clearance: distancePointToObb(wanderTarget, obb),
      }))
      .sort((left, right) => left.clearance - right.clearance);
    expect(clearances[0]).toEqual({
      id: 'eastbrook_chapel',
      clearance: 79.73738253357934,
    });
    expect(clearances[0].clearance).toBeGreaterThan(PLAYER_RADIUS);
  });

  it('pins the harbor streets through the existing road points', () => {
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md), then for owner refinement
    // round 3: the town is open so every gateId is null; the main street to
    // the quay runs a wider halfWidth 2 spine, the side lanes stay 1.5, and
    // the inn lane joins the inn square to that spine (appended last: zone1
    // spreads these entries by index).
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
        existingRoadPoint: {
          x: 6,
          z: -72,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: 14.6,
            z: -88.6,
          },
          {
            x: 12,
            z: -85,
          },
          {
            x: 10,
            z: -80,
          },
          {
            x: 6,
            z: -72,
          },
          {
            x: 0,
            z: -58,
          },
        ],
      },
      {
        id: 'east',
        existingRoadPoint: {
          x: -44,
          z: -98,
        },
        gateId: null,
        halfWidth: 2,
        points: [
          {
            x: -20,
            z: -102,
          },
          {
            x: -26,
            z: -101,
          },
          {
            x: -44,
            z: -98,
          },
          {
            x: -56,
            z: -88,
          },
          {
            x: -62,
            z: -76,
          },
          {
            x: -70,
            z: -68,
          },
          {
            x: -80,
            z: -66,
          },
          {
            x: -88,
            z: -60,
          },
          {
            x: -92,
            z: -56,
          },
        ],
      },
      {
        id: 'bandit',
        existingRoadPoint: {
          x: -10,
          z: -112,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: -11,
            z: -105.5,
          },
          {
            x: -10,
            z: -112,
          },
          {
            x: -9,
            z: -119,
          },
          {
            x: -12,
            z: -123,
          },
          {
            x: -22,
            z: -120.5,
          },
        ],
      },
      {
        id: 'northwest',
        existingRoadPoint: {
          x: -9.2,
          z: -132,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: -12,
            z: -107.5,
          },
          {
            x: -10.8,
            z: -118,
          },
          {
            x: -9.2,
            z: -132,
          },
          {
            x: -9.2,
            z: -134,
          },
        ],
      },
      {
        id: 'southwest',
        existingRoadPoint: {
          x: 0,
          z: -99,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: 7,
            z: -97.4,
          },
          {
            x: 0,
            z: -99,
          },
          {
            x: -9,
            z: -100.4,
          },
        ],
      },
      {
        id: 'northeast',
        existingRoadPoint: {
          x: -92,
          z: -54,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: -92,
            z: -32,
          },
          {
            x: -92,
            z: -56,
          },
          {
            x: -96,
            z: -61,
          },
          {
            x: -92,
            z: -66,
          },
          {
            x: -92,
            z: -74,
          },
          {
            x: -96.5,
            z: -78,
          },
          {
            x: -92,
            z: -82,
          },
          {
            x: -92,
            z: -92,
          },
        ],
      },
      {
        id: 'inn_lane',
        existingRoadPoint: {
          x: -44,
          z: -98,
        },
        gateId: null,
        halfWidth: 1.5,
        points: [
          {
            x: -40.8,
            z: -92.2,
          },
          {
            x: -42,
            z: -95,
          },
          {
            x: -44,
            z: -98,
          },
        ],
      },
    ]);
    expect(EASTBROOK_LAYOUT.roads.find((road) => road.id === 'bandit')?.points).toContainEqual({
      x: -12,
      z: -123,
    });
  });
});

describe('layout clearance and service anchors', () => {
  it('has no replacement footprint overlap anywhere in the harbor town', () => {
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): the inner-wall containment
    // sweep retired with the ring wall; the harbor town is open and its lots
    // spread across districts, so the pairwise overlap sweep is the whole
    // contract now.
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
    // Re-pinned 2026-08 for the harbor move (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md): spawn to the quay, the
    // mailbox pillar to the market square's east lane, the noticeboard to
    // the civic square, the graveyard to the chapel green, and all sixteen
    // NPCs spread across the harbor districts (the quay pair anchor on
    // 'eastbrook_quay').
    // Re-pinned again for owner refinement round 6b, which redistributed the
    // town's NPCs by role along the dock road: marshal_redbrook moved out to
    // the harbour market, apothecary_lin to the quayside home (her facing is
    // derived from facingToward(CIVIC_CENTER) now, not a hand-set angle), and
    // card_master across to the bank.
    // Re-pinned once more for owner round 6b, which de-clustered the remaining
    // huddles: both market stalls opened out across the square (carrying
    // the_merchant and trader_wilkes with them), fury moved off the chapel step
    // out to the town's edge at (16, -78), and forgemistress_darva and
    // tinker_gizzel now stand out to OPPOSITE sides of their own benches, which
    // widens the station-to-master band below from 3 yd to 4.5 yd.
    expect(EASTBROOK_LAYOUT.services.playerStart).toEqual({
      id: 'eastbrook_player_start',
      position: { x: -94, z: -58 },
      bodyRadius: 0.5,
    });
    expect(EASTBROOK_LAYOUT.services.mailbox).toEqual({
      id: 'mailbox_eastbrook',
      templateId: 'mailbox',
      assetId: '/models/props/mailbox_pillar.glb',
      position: { x: -10, z: -98 },
      bodyRadius: 0.8,
      interactionRadius: 7,
      // The source still authors the pre-move posting-spot literal here (the
      // pillar itself moved to the market square); mirrored as-is, source
      // owners flagged to re-derive it from the new pillar.
      frontStandingPoint: { x: -10, z: -96.9 },
    });
    expect(EASTBROOK_LAYOUT.services.noticeboard).toEqual({
      id: 'eastbrook_noticeboard',
      entityId: 2_000_000_001,
      templateId: 'noticeboard_eastbrook',
      assetId: '/models/props/eastbrook_noticeboard.glb',
      name: 'Notice Board',
      position: { x: 5, z: -89 },
      rotation: -2.17084654019665,
      nativeDimensions: { width: 2.4, height: 2.6, depth: 0.6 },
      footprint: {
        id: 'eastbrook_noticeboard',
        center: { x: 5, z: -89 },
        halfWidth: 1.2,
        halfDepth: 0.3,
        rotation: -2.17084654019665,
      },
      frontStandingPoint: { x: 3.844569834250236, z: -89.79055748182878 },
      interactionRadius: 4,
    });
    expect(EASTBROOK_LAYOUT.services.graveyard).toEqual({
      id: 'gy_eastbrook',
      position: { x: -2, z: -70 },
      legacyReleasePoint: { x: 0, z: -70 },
      healerTemplateId: 'spirit_healer',
      healerFacing: Math.PI,
      headstones: [
        { id: 'gy_eastbrook_headstone_0', position: { x: -2, z: -70 } },
        { id: 'gy_eastbrook_headstone_1', position: { x: 0.2, z: -70 } },
        { id: 'gy_eastbrook_headstone_2', position: { x: 2.4, z: -70 } },
        { id: 'gy_eastbrook_headstone_3', position: { x: -2, z: -67.4 } },
        { id: 'gy_eastbrook_headstone_4', position: { x: 0.2, z: -67.4 } },
        { id: 'gy_eastbrook_headstone_5', position: { x: 2.4, z: -67.4 } },
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
        position: {
          x: -6.293250516799596,
          z: -124.1466252583998,
        },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_kitchens',
        type: 'kitchens',
        masterNpcId: 'cook_marlow',
        position: {
          x: -42.82589170715949,
          z: -90.73189846640925,
        },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_loom',
        type: 'loom',
        masterNpcId: 'weaver_ottilie',
        position: {
          x: -25.614789156231517,
          z: -125.57781626565273,
        },
        interactionRadius: 20,
      },
      {
        id: 'station_eastbrook_toolworks',
        type: 'toolworks',
        masterNpcId: 'tinker_gizzel',
        position: {
          x: -13.614789156231515,
          z: -124.42218373434727,
        },
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
        -19.333512834321652,
        -95.49976921301501,
        2.4805494847391065,
        'eastbrook_market_stall_world_market',
      ],
      ['marshal_redbrook', -58, -102, 1.5707963267948966, 'eastbrook_harbour_market'],
      [
        'trader_wilkes',
        -17.833512834321652,
        -106.50023078698499,
        0.6610431688506869,
        'eastbrook_market_stall_provisions',
      ],
      ['apothecary_lin', -72, -96, 1.673877935317597, 'eastbrook_quayside_home'],
      [
        'brother_aldric',
        5.181980515339464,
        -74.81801948466054,
        0.7853981633974483,
        'eastbrook_chapel',
      ],
      ['smith_haldren', -3.4, -112.5, -1.6631256615264958, 'eastbrook_blacksmith'],
      ['fisherman_brandt', -95, -50, -1.5707963267948966, 'eastbrook_quay'],
      ['foreman_odell', -84, -63, 0.6747409422235526, 'eastbrook_quay'],
      [
        'bursar_fernando',
        8.49982143312659,
        -97.50017856687342,
        -2.356194490192345,
        'eastbrook_bank',
      ],
      ['card_master', 20, -98, -2.677945044588987, 'eastbrook_bank'],
      ['chronicler_saul', 10.2, -87.5, 0.5880026035475675, 'mailbox_eastbrook'],
      [
        'forgemistress_darva',
        -8.171547617899419,
        -120.39003105620014,
        -2.0344439357957027,
        'station_eastbrook_forge',
      ],
      [
        'cook_marlow',
        -42.62589170715949,
        -92.23189846640925,
        -0.669638945676638,
        'station_eastbrook_kitchens',
      ],
      [
        'weaver_ottilie',
        -27.278889744907204,
        -126.68721665810318,
        2.5535900500422257,
        'station_eastbrook_loom',
      ],
      [
        'tinker_gizzel',
        -16.277350098112613,
        -122.64714310642654,
        0.5880026035475675,
        'station_eastbrook_toolworks',
      ],
      ['fury', 16, -78, -2.2455372690184494, 'eastbrook_chapel'],
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
      // Band widened from 3 to 4.5 for owner round 6b: darva stands 4.2 out and
      // gizzel 3.2 out, on opposite sides of their adjacent benches, so the
      // crafts lane stops reading as one huddle. Each master still works their
      // own station, which is what this bound exists to catch.
      expect(masterDistance).toBeLessThanOrEqual(4.5);
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
    // Round 4: preservedBuildings is empty (the armoury retired from
    // placement); the barracks-approach route front stays covered by the
    // routes sweep below, since the approach is still an authored route.
    expect(EASTBROOK_LAYOUT.preservedBuildings).toHaveLength(0);
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
