import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOWN_BUILDING_NATURAL } from '../src/editor/feature_prop_placements';
import {
  placedTownInteriorModels,
  placedTownModelName,
} from '../src/render/placed_town_interior_core';
import { AUTHORED_TOWN_INN_IDS, AUTHORED_TOWNS } from '../src/sim/authored_town_registry';
import { buildingContainsRestPoint } from '../src/sim/building_layout';
import { isBlocked, resolveMovement, streetlampPlacements } from '../src/sim/colliders';
import { FACTION_HUB_LANDINGS } from '../src/sim/content/faction_vendors';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { NOTICEBOARDS } from '../src/sim/content/noticeboards';
import { STATIONS } from '../src/sim/content/professions';
import { BUILTIN_WORLD, CAMPS, MOBS, ZONES, zoneAt } from '../src/sim/data';
import { PAINTED_TOWN_SCATTER_PAD } from '../src/sim/decoration_exclusions';
import { fenWillowSpots, hollowWillowSpots } from '../src/sim/fen_willows';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import {
  PAINTED_LOOK_MODELS,
  PAINTED_LOOK_SETS,
  PAINTED_MODELS,
  PAINTED_TOWNS,
  type PaintedLook,
  type PaintedModel,
  type PaintedTownLayout,
  paintedTownBuilding,
  paintedTownBuildingDefs,
} from '../src/sim/painted_towns';
import { findPath, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { distancePointToObb, localToWorld, type Obb2 } from '../src/sim/placed_town_kit';
import {
  farshorePalmSpots,
  reachPalmSpots,
  roadDistance,
  terrainHeight,
  terrainSteepnessAt,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The painted towns (sim/painted_towns/): every built-in town after Highwatch
// whose kit houses were replaced by the painted Tidehold buildings. The first
// block pins the shared recipe; then each town that stands buildings is held to
// what Highwatch's own suite holds it to: inside its zone on shipped files, its
// buildings clear of each other, of every NPC, service, camp and lamp, off the
// roads and the water, on level pads, and every door reachable on foot.

const SEED = WORLD_SEED;
const PUBLIC = new URL('../public', import.meta.url);

/** Every point of an OBB on a grid of `step` (edges included). */
function samplesOf(obb: Obb2, step = 0.5): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const nx = Math.max(1, Math.ceil((obb.halfWidth * 2) / step));
  const nz = Math.max(1, Math.ceil((obb.halfDepth * 2) / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      out.push(
        localToWorld(
          obb.center,
          obb.rotation,
          -obb.halfWidth + (2 * obb.halfWidth * i) / nx,
          -obb.halfDepth + (2 * obb.halfDepth * j) / nz,
        ),
      );
    }
  }
  return out;
}

function publicFile(url: string): boolean {
  return existsSync(new URL(`.${url}`, `${PUBLIC.href}/`));
}

function expectPath(
  label: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  bodyRadius: number,
): void {
  expect(isBlocked(SEED, from.x, from.z, bodyRadius), `${label} start`).toBe(false);
  expect(isBlocked(SEED, to.x, to.z, bodyRadius), `${label} destination`).toBe(false);
  const path = findPath(from, to, {
    seed: SEED,
    bodyRadius,
    maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
    minGround: (x, z) => waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH,
    maxSpan: 128,
  });
  expect(path.length, `${label} path`).toBeGreaterThan(0);
  let current = { ...from };
  for (const waypoint of path) {
    current = resolveMovement(SEED, current.x, current.z, waypoint.x, waypoint.z, bodyRadius);
  }
  expect(Math.hypot(current.x - to.x, current.z - to.z), `${label} reached endpoint`).toBeLessThan(
    0.25,
  );
}

/** A free spot for a body on the town's square: the hub centre, or the nearest
 *  unblocked point round it (a well or a stall may stand on the centre). */
function squareSpot(town: PaintedTownLayout): { x: number; z: number } {
  const { x, z } = town.hub.center;
  for (let r = 0; r <= 10; r += 0.5) {
    const steps = Math.max(1, Math.round((Math.PI * 2 * r) / 0.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      if (!isBlocked(SEED, p.x, p.z, 0.6)) return p;
    }
  }
  throw new Error(`${town.id}: no free spot within 10 yd of the hub`);
}

/** The hex kit's town buildings (any colourway): the houses, taverns, halls,
 *  markets and workshops a painted town replaces. Towers, windmills, barracks,
 *  stables, docks and the castle are not town houses and may stay. */
const HEX_TOWN_BUILDING =
  /^hex[br]?(HomeA|HomeB|Tavern|Townhall|Market|Workshop|Church|Blacksmith)$/;

function nearTown(town: PaintedTownLayout, x: number, z: number, margin: number): boolean {
  return Math.hypot(x - town.hub.center.x, z - town.hub.center.z) <= town.hub.radius + margin;
}

describe('the painted towns recipe', () => {
  it('lists every painted town once and registers each under the paintedTowns family', () => {
    const ids = PAINTED_TOWNS.map((town) => town.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const town of PAINTED_TOWNS) {
      const registered = AUTHORED_TOWNS.find((candidate) => candidate.id === town.id);
      expect(registered?.promotedBy, town.id).toBe('paintedTowns');
      expect(registered?.buildings, town.id).toBe(town.buildings);
      expect(Object.isFrozen(town), town.id).toBe(true);
      const zone = ZONES.find((candidate) => candidate.id === town.zoneId);
      expect(zone, town.id).toBeDefined();
      expect(town.hub.center, town.id).toEqual({ x: zone?.hub.x, z: zone?.hub.z });
    }
  });

  it('never touches the Drakelands', () => {
    expect(PAINTED_TOWNS.map((town) => town.zoneId)).not.toContain('drakelands');
  });

  it("holds Drifthaven's faction hearthstone landing to the clearance check", () => {
    // each town's clearance check takes the landings near it; this pins that the
    // one landing standing in a painted town is among them, not skipped
    const checked = Object.entries(FACTION_HUB_LANDINGS)
      .filter(([, landing]) =>
        PAINTED_TOWNS.some((town) => nearTown(town, landing.x, landing.z, 80)),
      )
      .map(([faction]) => faction);
    expect(checked).toEqual(['rift_watch']);
  });

  it('stands only shipped files: each look carries its models with every texture tier', () => {
    for (const [look, models] of Object.entries(PAINTED_LOOK_MODELS)) {
      const dir = PAINTED_LOOK_SETS[look as keyof typeof PAINTED_LOOK_SETS];
      for (const model of models) {
        for (const tier of ['', '.half', '.quarter']) {
          expect(publicFile(`${dir}/${model}${tier}.glb`), `${look} ${model}${tier}`).toBe(true);
        }
      }
    }
  });

  it('gives every look model a Studio natural size, its default model size', () => {
    // a town building whose asset has no natural-size row is silently left out
    // of the Studio conversion (editor/feature_prop_placements.ts); a look is
    // the default model re-textured, so it stands at the default model's size
    for (const [look, models] of Object.entries(PAINTED_LOOK_MODELS)) {
      for (const model of models) {
        const building = paintedTownBuilding({
          id: 't',
          kind: 'house',
          model,
          look: look as PaintedLook,
          anchor: { x: 0, z: 0 },
          rotation: 0,
          scale: 1,
          walkIn: false,
        });
        const id = building.assetId.replace(/^\/models\//, '').replace(/\.glb$/i, '');
        expect(TOWN_BUILDING_NATURAL[id], id).toBeDefined();
        expect(TOWN_BUILDING_NATURAL[id], id).toEqual(TOWN_BUILDING_NATURAL[`tidehold/${model}`]);
      }
    }
  });

  it('stands a model walk-in exactly when it carries the indoor camera air', () => {
    const air = new Set(placedTownInteriorModels());
    for (const [model, spec] of Object.entries(PAINTED_MODELS)) {
      expect(spec.walkInAir, model).toBe(air.has(model));
    }
  });

  it('refuses a look without the model, and a sealed model stood walk-in', () => {
    const base = { id: 't', kind: 'house' as const, anchor: { x: 0, z: 0 }, rotation: 0, scale: 1 };
    expect(() => paintedTownBuilding({ ...base, model: 'bank', look: 'fenrire' })).toThrow();
    expect(() =>
      paintedTownBuilding({ ...base, model: 'house_a', look: 'default', walkIn: true }),
    ).toThrow();
    const sealed = paintedTownBuilding({ ...base, model: 'house_c', look: 'highwatch' });
    expect(sealed.walkIn).toBe(false);
    expect(sealed.assetId).toBe('/models/tidehold/highwatch/house_c.glb');
    const shop = paintedTownBuilding({ ...base, model: 'shop_b', look: 'default', scale: 1.5 });
    expect(shop.walkIn).toBe(true);
    expect(shop.placement).toMatchObject({ scale: 1.5, lift: -1.55 });
    // the visitor stands 1.8 yd times the scale off the door
    expect(shop.frontClearance).toBeCloseTo(2.7, 9);
  });

  it("appends every town's pads to the built-in terrain edits after Highwatch's, in order", () => {
    const edits = BUILTIN_WORLD.terrainEdits ?? [];
    const painted = PAINTED_TOWNS.flatMap((town) => town.pads);
    const tail = edits.slice(edits.length - painted.length);
    expect(tail).toEqual(painted);
    const highwatch = HIGHWATCH_LAYOUT.pads;
    expect(
      edits.slice(edits.length - painted.length - highwatch.length, edits.length - painted.length),
    ).toEqual([...highwatch]);
  });
});

for (const town of PAINTED_TOWNS) describePaintedTown(town);

function describePaintedTown(town: PaintedTownLayout): void {
  describe(`the painted town ${town.id}`, () => {
    if (town.buildings.length === 0) {
      it.skip('stands no painted buildings yet', () => undefined);
      return;
    }
    const buildings = town.buildings;
    const zoneRecords = BUILTIN_WORLD.props.buildings.filter(
      (record) => zoneAt(record.x, record.z).id === town.zoneId,
    );

    it('stands its buildings in its zone, on shipped files, at a grand scale', () => {
      const ids = buildings.map((building) => building.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(buildings.some((building) => building.kind === 'inn')).toBe(true);
      for (const building of buildings) {
        expect(building.id.startsWith(`${town.id}_`), building.id).toBe(true);
        expect(zoneAt(building.position.x, building.position.z).id, building.id).toBe(town.zoneId);
        for (const corner of samplesOf(building.reach, 1000)) {
          expect(zoneAt(corner.x, corner.z).id, `${building.id} reach corner`).toBe(town.zoneId);
        }
        expect(publicFile(building.assetId), building.assetId).toBe(true);
        const model = placedTownModelName(building.assetId) as PaintedModel;
        expect(Object.keys(PAINTED_MODELS), building.id).toContain(model);
        expect(building.walkIn, building.id).toBe(
          building.walkIn ? PAINTED_MODELS[model].walkInAir : false,
        );
        if (building.kind === 'inn') {
          expect(['tavern', 'tavern_b'], building.id).toContain(model);
          expect(building.walkIn, building.id).toBe(true);
        }
        if (building.kind === 'chapel') expect(model, building.id).toBe('hall');
        expect(building.placement.scale, building.id).toBeGreaterThanOrEqual(1);
        expect(building.placement.scale, building.id).toBeLessThanOrEqual(1.6);
      }
    });

    it('replaced its kit records, and the zone file carries exactly the layout', () => {
      expect(town.replacedKitBuildings.length).toBeGreaterThan(0);
      for (const def of paintedTownBuildingDefs(town)) {
        expect(zoneRecords, def.id).toContainEqual(def);
      }
      for (const old of town.replacedKitBuildings) {
        const left = zoneRecords.find(
          (record) =>
            record.kind === old.kind &&
            Math.abs(record.x - old.x) < 1e-6 &&
            Math.abs(record.z - old.z) < 1e-6,
        );
        expect(left, `${old.kind} at ${old.x}, ${old.z}`).toBeUndefined();
      }
      // no kit house is left standing in the town itself
      const painted = new Set(buildings.map((building) => building.id));
      const kit = zoneRecords.filter(
        (record) =>
          !(record.id && painted.has(record.id)) && nearTown(town, record.x, record.z, 40),
      );
      expect(kit.map((record) => `${record.kind} at ${record.x}, ${record.z}`)).toEqual([]);
      // ...nor a hex-kit (KayKit Medieval Hexagon) town building standing as decor
      const decor = BUILTIN_WORLD.props.decorProps ?? [];
      for (const old of town.replacedDecorProps) {
        const left = decor.find(
          (row) =>
            row.key === old.key && Math.abs(row.x - old.x) < 1e-6 && Math.abs(row.z - old.z) < 1e-6,
        );
        expect(left, `${old.key} at ${old.x}, ${old.z}`).toBeUndefined();
      }
      const hexTown = decor.filter(
        (row) => HEX_TOWN_BUILDING.test(row.key) && nearTown(town, row.x, row.z, 40),
      );
      expect(hexTown.map((row) => `${row.key} at ${row.x}, ${row.z}`)).toEqual([]);
    });

    it('keeps every building clear of every other one', () => {
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          let nearest = Number.POSITIVE_INFINITY;
          for (const point of samplesOf(buildings[i].reach)) {
            nearest = Math.min(nearest, distancePointToObb(point, buildings[j].reach));
          }
          expect(nearest, `${buildings[i].id} to ${buildings[j].id}`).toBeGreaterThan(2);
        }
      }
    });

    it('keeps every NPC, service and town prop clear of the buildings', () => {
      const kept: { id: string; x: number; z: number; clearance: number }[] = [];
      for (const [id, npc] of Object.entries(BUILTIN_WORLD.npcs)) {
        if (npc.dynamic || !nearTown(town, npc.pos.x, npc.pos.z, 80)) continue;
        // an NPC stands outside every wall; one at a door stands on its step
        kept.push({ id, x: npc.pos.x, z: npc.pos.z, clearance: 0 });
        // and no collider of the buildings (their baked walls included) covers it
        const nearBuilding = buildings.some(
          (building) => distancePointToObb(npc.pos, building.reach) < 10,
        );
        if (nearBuilding) expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.05), id).toBe(false);
      }
      for (const box of MAILBOXES) {
        if (nearTown(town, box.x, box.z, 80))
          kept.push({ id: `mailbox ${box.x},${box.z}`, x: box.x, z: box.z, clearance: 1.5 });
      }
      for (const board of NOTICEBOARDS) {
        if (nearTown(town, board.x, board.z, 80))
          kept.push({ id: board.id, x: board.x, z: board.z, clearance: 1.5 });
      }
      for (const station of STATIONS) {
        if (nearTown(town, station.pos.x, station.pos.z, 80))
          kept.push({ id: station.id, x: station.pos.x, z: station.pos.z, clearance: 1.5 });
      }
      for (const node of GATHER_NODES) {
        if (nearTown(town, node.pos.x, node.pos.z, 80))
          kept.push({ id: node.id, x: node.pos.x, z: node.pos.z, clearance: 2 });
      }
      for (const well of BUILTIN_WORLD.props.wells) {
        if (nearTown(town, well.x, well.z, 80))
          kept.push({
            id: `well ${well.x},${well.z}`,
            x: well.x,
            z: well.z,
            clearance: well.r + 1,
          });
      }
      for (const stall of BUILTIN_WORLD.props.stalls) {
        if (nearTown(town, stall.x, stall.z, 80))
          kept.push({
            id: `stall ${stall.x},${stall.z}`,
            x: stall.x,
            z: stall.z,
            clearance: stall.r,
          });
      }
      for (const yard of [
        ...(BUILTIN_WORLD.services?.graveyards ?? []),
        ...BUILTIN_WORLD.props.graveyards,
      ]) {
        if (nearTown(town, yard.x, yard.z, 80))
          kept.push({ id: `graveyard ${yard.x},${yard.z}`, x: yard.x, z: yard.z, clearance: 2 });
      }
      // a faction hearthstone lands its player here (content/faction_vendors.ts)
      for (const [faction, landing] of Object.entries(FACTION_HUB_LANDINGS)) {
        if (nearTown(town, landing.x, landing.z, 80))
          kept.push({ id: `${faction} landing`, x: landing.x, z: landing.z, clearance: 2 });
      }
      for (const object of BUILTIN_WORLD.groundObjects) {
        for (const p of object.positions) {
          if (nearTown(town, p.x, p.z, 80))
            kept.push({ id: `${object.itemId} ${p.x},${p.z}`, x: p.x, z: p.z, clearance: 1 });
        }
      }
      for (const building of buildings) {
        const solids: Obb2[] = [
          { ...building.footprint, center: building.position },
          ...building.annexes,
        ];
        for (const point of kept) {
          const wall = Math.min(...solids.map((solid) => distancePointToObb(point, solid)));
          expect(wall, `${building.id} to ${point.id}`).toBeGreaterThan(0.6);
          if (point.clearance > 0) {
            expect(
              distancePointToObb(point, building.reach),
              `${building.id} reach to ${point.id}`,
            ).toBeGreaterThan(point.clearance);
          }
        }
      }
    });

    it("keeps every camp's home ground and wander clear of the town", () => {
      // A camp's mobs spawn inside its radius and wander up to 9 yd past it. No pad
      // or apron may reshape the ground they spawn on, and no building may stand
      // where they wander (Highwatch's aprons reach a stalker camp's outer wander,
      // which is fine: its mobs still spawn and roam on their own ground).
      const wander = 9;
      for (const camp of CAMPS) {
        // a mob that never moves (a practice dummy) wanders nowhere: its ground may change
        if (camp.count === 0 || MOBS[camp.mobId]?.moveSpeed === 0) continue;
        for (const pad of town.pads) {
          const gap =
            Math.hypot(camp.center.x - pad.x, camp.center.z - pad.z) - pad.radius - camp.radius;
          expect(gap, `${camp.mobId} at ${camp.center.x}, ${camp.center.z}`).toBeGreaterThan(0);
        }
        for (const building of buildings) {
          expect(
            distancePointToObb(camp.center, building.reach) - camp.radius,
            `${building.id} to ${camp.mobId}`,
          ).toBeGreaterThan(wander);
        }
      }
    });

    it('stands nothing over water, and levels each building on its pad', () => {
      for (const building of buildings) {
        const heights: number[] = [];
        for (const point of samplesOf(building.footprint, 1)) {
          const y = terrainHeight(point.x, point.z, SEED);
          heights.push(y);
          expect(
            y - waterLevelAt(point.x, point.z, SEED),
            `${building.id} over water`,
          ).toBeGreaterThan(0.3);
        }
        expect(Math.max(...heights) - Math.min(...heights), `${building.id} level`).toBeLessThan(
          0.15,
        );
        const front = building.frontStandingPoint;
        expect(
          terrainHeight(front.x, front.z, SEED) - waterLevelAt(front.x, front.z, SEED),
          `${building.id} door over water`,
        ).toBeGreaterThan(0.3);
      }
    });

    it('grades the ground round every building so a player can walk round it', () => {
      let checked = 0;
      const tooSteep: string[] = [];
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const building of buildings) {
        const r = Math.hypot(building.reach.halfWidth, building.reach.halfDepth) + 6;
        minX = Math.min(minX, building.reach.center.x - r);
        maxX = Math.max(maxX, building.reach.center.x + r);
        minZ = Math.min(minZ, building.reach.center.z - r);
        maxZ = Math.max(maxZ, building.reach.center.z + r);
      }
      for (let z = Math.floor(minZ); z <= maxZ; z += 0.5) {
        for (let x = Math.floor(minX); x <= maxX; x += 0.5) {
          let near = Number.POSITIVE_INFINITY;
          for (const building of buildings) {
            near = Math.min(near, distancePointToObb({ x, z }, building.reach));
          }
          if (near < 0.75 || near > 6) continue;
          if (waterLevelAt(x, z, SEED) > terrainHeight(x, z, SEED)) continue;
          checked++;
          const steepness = terrainSteepnessAt(x, z, SEED);
          if (steepness > PLAYER_MAX_CLIMB_SLOPE)
            tooSteep.push(`${x}, ${z}: ${steepness.toFixed(3)}`);
        }
      }
      expect(checked).toBeGreaterThan(200);
      // a back wall may stand against a bank the town never walked; the doors may not
      expect(tooSteep.length / checked, tooSteep.slice(0, 20).join('; ')).toBeLessThan(0.02);
      for (const building of buildings) {
        for (let along = 0; along <= 6; along += 0.5) {
          for (const side of [-1.5, 0, 1.5]) {
            const p = localToWorld(building.frontStandingPoint, building.frontFacing, side, along);
            expect(
              terrainSteepnessAt(p.x, p.z, SEED),
              `${building.id} door approach ${along}, ${side}`,
            ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
          }
        }
      }
    });

    it('roots no generated palm or willow in a building', () => {
      // These feature trees space themselves off building record CENTRES, which held
      // a kit house's few yards but not a painted building's whole reach.
      const trees = [
        ...reachPalmSpots(SEED),
        ...farshorePalmSpots(SEED),
        ...fenWillowSpots(SEED),
        ...hollowWillowSpots(SEED),
      ];
      for (const tree of trees) {
        if (!nearTown(town, tree.x, tree.z, 120)) continue;
        for (const building of buildings) {
          expect(
            distancePointToObb(tree, building.reach),
            `${building.id} tree at ${tree.x.toFixed(2)}, ${tree.z.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(PAINTED_TOWN_SCATTER_PAD);
        }
      }
    });

    it('stands no street lamp on a building and keeps every drawn road off them', () => {
      for (const lamp of streetlampPlacements(SEED)) {
        if (!nearTown(town, lamp.x, lamp.z, 120)) continue;
        for (const building of buildings) {
          expect(
            distancePointToObb(lamp, building.reach),
            `${building.id} lamp`,
          ).toBeGreaterThanOrEqual(1);
        }
      }
      for (const building of buildings) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const point of samplesOf(building.reach)) {
          nearest = Math.min(nearest, roadDistance(point.x, point.z));
        }
        // the drawn road band (grass-free) ends at 2.4 yd from its curve
        expect(nearest, building.id).toBeGreaterThan(2.4);
      }
    });

    it('rests a traveller inside its inn', () => {
      for (const building of buildings) {
        if (building.kind !== 'inn') continue;
        expect(AUTHORED_TOWN_INN_IDS.has(building.id), building.id).toBe(true);
        const record = zoneRecords.find((candidate) => candidate.id === building.id);
        if (!record) throw new Error(`no record for ${building.id}`);
        expect(buildingContainsRestPoint(record, record.x, record.z, 2), building.id).toBe(true);
      }
    });

    it('stands its moved NPCs exactly where the layout says, unblocked', () => {
      for (const stand of town.npcs) {
        const npc = BUILTIN_WORLD.npcs[stand.id];
        expect(npc, stand.id).toBeDefined();
        expect(npc.pos, stand.id).toEqual(stand.position);
        expect(npc.facing, stand.id).toBe(stand.facing);
        expect(isBlocked(SEED, stand.position.x, stand.position.z, 0.6), stand.id).toBe(false);
      }
    });

    it('walks from the square to every door and every moved NPC, and back', () => {
      const square = squareSpot(town);
      const destinations = [
        ...buildings.map((building) => ({
          id: `${building.id}:door`,
          point: building.frontStandingPoint,
        })),
        ...town.npcs.map((npc) => ({ id: npc.id, point: npc.position })),
      ];
      for (const destination of destinations) {
        expectPath(`${destination.id}:out`, square, destination.point, 0.6);
        expectPath(`${destination.id}:back`, destination.point, square, 0.6);
      }
    });
  });
}
