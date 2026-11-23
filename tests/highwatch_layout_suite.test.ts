import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHORED_TOWN_INN_IDS, AUTHORED_TOWNS } from '../src/sim/authored_town_registry';
import { buildingContainsRestPoint } from '../src/sim/building_layout';
import {
  bankerChestSpots,
  isBlocked,
  resolveMovement,
  streetlampPlacements,
} from '../src/sim/colliders';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { NOTICEBOARDS } from '../src/sim/content/noticeboards';
import { PRACTICE_ROW_X } from '../src/sim/content/practice_dummies';
import { STATIONS } from '../src/sim/content/professions';
import { ZONE3_NPCS, ZONE3_PROPS, ZONE3_ROADS, ZONE3_ZONE } from '../src/sim/content/zone3';
import { BUILTIN_WORLD, CAMPS } from '../src/sim/data';
import { isExcludedStreetlamp } from '../src/sim/decoration_exclusions';
import {
  HIGHWATCH_BUILDINGS_BY_ID,
  HIGHWATCH_LAYOUT,
  HIGHWATCH_NPC_PLACEMENTS_BY_ID,
  REMOVED_HIGHWATCH_BUILDINGS,
} from '../src/sim/highwatch_layout';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import { findPath, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { distancePointToObb, localToWorld } from '../src/sim/placed_town_kit';
import { Sim } from '../src/sim/sim';
import {
  groundHeight,
  roadDistance,
  terrainHeight,
  terrainSteepnessAt,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Highwatch, the hold of Thornpeak Heights, rebuilt with five painted
// Tidehold buildings round the square it always had and the adventurers' guild
// at the old stable yard (sim/highwatch_layout.ts). Everything else in the
// town stays where it stood; this suite pins that the buildings stand clear of
// all of it, on level ground, off the roads, and that every door, NPC and
// service is still reachable.

const SEED = WORLD_SEED;
const BUILDINGS = HIGHWATCH_LAYOUT.buildings;

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** Every point of an OBB on a grid of `step` (edges included). */
function samplesOf(
  obb: { center: { x: number; z: number }; halfWidth: number; halfDepth: number; rotation: number },
  step = 0.5,
): { x: number; z: number }[] {
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

describe('the Highwatch layout', () => {
  it('is a frozen source of truth that imports only the shared town kit', () => {
    const source = readFileSync(new URL('../src/sim/highwatch_layout.ts', import.meta.url), 'utf8');
    const imports = source.match(/^import[\s\S]*?from '([^']+)';/gm) ?? [];
    expect(imports.map((line) => line.replace(/^[\s\S]*from '/, '').replace(/';$/, ''))).toEqual([
      './placed_town_kit',
    ]);
    expect(source).not.toMatch(/\b(?:document|window|THREE|Math\.random|Date|performance)\b/);
    expect(HIGHWATCH_LAYOUT.id).toBe('highwatch_rebuild_v1');
    expectDeepFrozen(HIGHWATCH_LAYOUT);
    expect(HIGHWATCH_LAYOUT.hub).toEqual({
      center: { x: 0, z: 660 },
      radius: ZONE3_ZONE.hub.radius,
    });
  });

  it('stands five painted buildings in the Highwatch look, one per role, and the guild', () => {
    expect(
      BUILDINGS.map((building) => [building.id, building.assetId, building.kind, building.walkIn]),
    ).toEqual([
      ['highwatch_summit_inn', '/models/tidehold/highwatch/tavern_b.glb', 'inn', true],
      ['highwatch_gate_chapel', '/models/tidehold/highwatch/hall.glb', 'chapel', true],
      ['highwatch_counting_house', '/models/tidehold/highwatch/shop_a.glb', 'house', true],
      ['highwatch_watch_house', '/models/tidehold/highwatch/house_c.glb', 'house', false],
      ['highwatch_smithy', '/models/tidehold/highwatch/smithy.glb', 'house', true],
      ['highwatch_guild', '/models/tidehold/highwatch/guild.glb', 'house', true],
    ]);
    // stood GRAND: each at the scale that clears a door of about five yards
    // (highwatch_layout.ts), the footing buried and the ground line sunk 0.05
    expect(BUILDINGS.map((building) => [building.id, building.placement.scale])).toEqual([
      ['highwatch_summit_inn', 1.2],
      ['highwatch_gate_chapel', 1.2],
      ['highwatch_counting_house', 1.5],
      ['highwatch_watch_house', 1.4],
      ['highwatch_smithy', 1.3],
      // built at its own grand size (scripts/assets/highwatch_guild/)
      ['highwatch_guild', 1],
    ]);
    for (const building of BUILDINGS) {
      expect(building.placement.lift, building.id).toBeCloseTo(
        -(building.placement.scale + 0.05),
        9,
      );
      // the door step grows with the building
      expect(building.frontClearance, building.id).toBeCloseTo(1.8 * building.placement.scale, 9);
    }
    // the town is the third rebuilt town, with its own promoted family
    const town = AUTHORED_TOWNS.find((candidate) => candidate.id === 'highwatch');
    expect(town?.promotedBy).toBe('highwatchTown');
    expect(town?.buildings).toBe(BUILDINGS);
    expect(AUTHORED_TOWN_INN_IDS.has('highwatch_summit_inn')).toBe(true);
  });

  it('keeps every building clear of every other one', () => {
    for (let i = 0; i < BUILDINGS.length; i++) {
      for (let j = i + 1; j < BUILDINGS.length; j++) {
        let nearest = Infinity;
        for (const point of samplesOf(BUILDINGS[i].reach)) {
          nearest = Math.min(nearest, distancePointToObb(point, BUILDINGS[j].reach));
        }
        expect(nearest, `${BUILDINGS[i].id} to ${BUILDINGS[j].id}`).toBeGreaterThan(3);
      }
    }
  });

  it('keeps the square and every service it had where it stood, clear of the buildings', () => {
    const well = ZONE3_PROPS.wells.find((candidate) => candidate.x === 0 && candidate.z === 662);
    expect(well).toBeDefined();
    const station = STATIONS.find((candidate) => candidate.id === 'station_highwatch_apothecary');
    expect(station?.pos).toEqual({ x: 7, z: 660 });
    expect(MAILBOXES).toContainEqual({ x: 6, z: 654 });
    const board = NOTICEBOARDS.find((candidate) => candidate.id === 'highwatch_noticeboard');
    expect(board).toMatchObject({ x: -5, z: 652 });
    expect(ZONE3_PROPS.stalls.slice(0, 2)).toEqual([
      { x: -7.5, z: 667, rot: Math.PI / 2, r: 1.7 },
      { x: -4.5, z: 673.5, rot: -0.6, r: 1.7, smithy: true },
    ]);
    expect(ZONE3_PROPS.graveyards[0]).toEqual({ x: 15, z: 645 });
    expect(ZONE3_PROPS.fences.slice(0, 2)).toEqual([
      { x1: -14, z1: 649, x2: -4, z2: 647 },
      { x1: 4, z1: 647, x2: 14, z2: 649 },
    ]);
    const kept: { id: string; x: number; z: number; clearance: number }[] = [
      { id: 'hub centre', x: 0, z: 660, clearance: 8 },
      { id: 'well', x: 0, z: 662, clearance: 3 },
      { id: 'station', x: 7, z: 660, clearance: 2 },
      { id: 'mailbox', x: 6, z: 654, clearance: 2 },
      { id: 'noticeboard reading spot', x: -5, z: 653.5, clearance: 2 },
      { id: 'quartermaster stall', x: -7.5, z: 667, clearance: 2.5 },
      { id: 'armorer stall', x: -4.5, z: 673.5, clearance: 2.5 },
      { id: 'gate fence east end', x: -14, z: 649, clearance: 2 },
      { id: 'gate fence west end', x: 14, z: 649, clearance: 1 },
      { id: 'Thornpeak Cairns', x: 15, z: 645, clearance: 1 },
      { id: 'cairn headstones', x: 19.4, z: 647.6, clearance: 1 },
      { id: 'practice row', x: PRACTICE_ROW_X, z: 654, clearance: 3 },
      // the farm's six beds
      ...[
        [-23, 685],
        [-18, 685],
        [-13, 685],
        [-23, 690],
        [-18, 690],
        [-13, 690],
      ].map(([x, z]) => ({ id: `bed ${x},${z}`, x, z, clearance: 3 })),
    ];
    // and every NPC that kept its spot
    for (const [id, npc] of Object.entries(ZONE3_NPCS)) {
      if (npc.dynamic || id in HIGHWATCH_NPC_PLACEMENTS_BY_ID) continue;
      if (Math.hypot(npc.pos.x, npc.pos.z - 660) > 50) continue;
      kept.push({ id, x: npc.pos.x, z: npc.pos.z, clearance: 1.5 });
    }
    for (const node of GATHER_NODES) {
      if (Math.hypot(node.pos.x, node.pos.z - 660) > 50) continue;
      kept.push({ id: node.id, x: node.pos.x, z: node.pos.z, clearance: 2 });
    }
    for (const building of BUILDINGS) {
      for (const point of kept) {
        expect(
          distancePointToObb(point, building.reach),
          `${building.id} to ${point.id}`,
        ).toBeGreaterThan(point.clearance);
      }
    }
  });

  it('replaced exactly the five kit records, and kept the Galecrest stables barn', () => {
    const records = ZONE3_PROPS.buildings;
    expect(records.map((record) => record.id)).toEqual([
      ...BUILDINGS.map((building) => building.id),
      undefined,
    ]);
    for (const removed of REMOVED_HIGHWATCH_BUILDINGS) {
      expect(
        records.some((record) => record.x === removed.x && record.z === removed.z),
        `${removed.kind} at ${removed.x},${removed.z}`,
      ).toBe(false);
    }
    expect(records.at(-1)).toEqual({ kind: 'inn', x: 352, z: 598, w: 10, d: 8, rot: 2.7 });
    for (const building of BUILDINGS) {
      expect(records.find((record) => record.id === building.id)).toEqual({
        id: building.id,
        assetId: building.assetId,
        kind: building.kind,
        x: building.position.x,
        z: building.position.z,
        w: building.nativeDimensions.width,
        d: building.nativeDimensions.depth,
        rot: building.rotation,
        height: building.nativeDimensions.height,
      });
    }
  });

  it('re-routes only the Stormcrag road, out of the square and between the inn and the smithy', () => {
    // the new first stretch, then the old line from (70, 720) to Stormcrag
    expect(ZONE3_ROADS[2]).toEqual([
      { x: 4, z: 674 },
      { x: 11, z: 689 },
      { x: 33, z: 691.5 },
      { x: 42, z: 695 },
      { x: 48, z: 700 },
      { x: 56, z: 707 },
      { x: 70, z: 720 },
      { x: 110, z: 760 },
    ]);
    // the stables spur still starts on it, and the other spokes are untouched
    expect(ZONE3_ROADS[4]).toEqual([
      { x: 70, z: 720 },
      { x: 79, z: 714 },
      { x: 91, z: 709 },
    ]);
    expect(ZONE3_ROADS[0]).toEqual([
      { x: 0, z: 320 },
      { x: 10, z: 450 },
      { x: 0, z: 540 },
      { x: 0, z: 660 },
    ]);
    expect(ZONE3_ROADS[1]).toEqual([
      { x: -6, z: 666 },
      { x: -60, z: 700 },
      { x: -110, z: 735 },
    ]);
    expect(ZONE3_ROADS[3]).toEqual([
      { x: 0, z: 676 },
      { x: 0, z: 780 },
      { x: 0, z: 860 },
    ]);
    // it runs between the inn's north end and the smithy's terrace
    const inn = BUILDINGS.find((building) => building.id === 'highwatch_summit_inn');
    const smithy = BUILDINGS.find((building) => building.id === 'highwatch_smithy');
    if (!inn || !smithy) throw new Error('missing inn or smithy');
    const roadZAt22 = 689 + ((22 - 11) / (33 - 11)) * (691.5 - 689);
    expect(roadZAt22).toBeGreaterThan(inn.reach.center.z + inn.reach.halfWidth);
    expect(roadZAt22).toBeLessThan(smithy.reach.center.z - smithy.reach.halfDepth);
  });

  it('keeps every drawn road off every building', () => {
    for (const building of BUILDINGS) {
      // the guild's reach takes in its paved yard, where the old stables spur ends by
      // design (below): the house itself, its porch's front (the model's z -17.2) to the
      // trophy hall's back, is the ground no road may cross
      const ground =
        building.id === 'highwatch_guild'
          ? {
              center: localToWorld(building.placement, building.rotation, 2.825, 2.65),
              halfWidth: building.reach.halfWidth,
              halfDepth: 19.85,
              rotation: building.rotation,
            }
          : building.reach;
      let nearest = Infinity;
      for (const point of samplesOf(ground)) {
        nearest = Math.min(nearest, roadDistance(point.x, point.z));
      }
      // the drawn road band (grass-free) ends at 2.4 yd from its curve
      expect(nearest, building.id).toBeGreaterThan(2.4);
    }
  });

  it("ends the old stables spur in the guild's yard, at the foot of its steps", () => {
    const guild = BUILDINGS.find((building) => building.id === 'highwatch_guild');
    if (!guild) throw new Error('no guild');
    const spur = ZONE3_ROADS.find((road) => road[0].x === 70 && road[0].z === 720);
    if (!spur) throw new Error('no stables spur');
    const end = spur[spur.length - 1];
    expect(end).toEqual({ x: 91, z: 709 });
    // inside the reach, in the yard in front of the porch's steps (the model's z -19)
    expect(distancePointToObb(end, guild.reach)).toBe(0);
    const local = {
      x: -(end.z - guild.placement.z),
      z: end.x - guild.placement.x,
    };
    expect(local.z).toBeLessThan(-19);
    expect(local.z).toBeGreaterThan(-25.25);
    expect(Math.abs(local.x)).toBeLessThan(8);
  });

  it('levels each building on its own pad across its whole reach', () => {
    const edits = BUILTIN_WORLD.terrainEdits ?? [];
    const pads = HIGHWATCH_LAYOUT.pads;
    // applied after every other stamp of the built-in world but the painted
    // towns' (sim/painted_towns/), which follow it on their own ground
    const after = PAINTED_TOWNS.reduce((count, town) => count + town.pads.length, 0);
    expect(edits.slice(edits.length - after - pads.length, edits.length - after)).toEqual([
      ...pads,
    ]);
    const expected: Record<string, number> = {
      highwatch_summit_inn: 9,
      highwatch_gate_chapel: 8.8,
      highwatch_counting_house: 8.8,
      highwatch_watch_house: 7.6,
      highwatch_smithy: 10.6,
      highwatch_guild: 9,
    };
    for (const building of BUILDINGS) {
      for (const point of samplesOf(building.reach, 1)) {
        expect(terrainHeight(point.x, point.z, SEED), building.id).toBeCloseTo(
          expected[building.id],
          2,
        );
      }
    }
    // the square stays the shelf it was
    for (const point of [
      { x: 0, z: 660 },
      { x: 6, z: 654 },
      { x: -5, z: 668 },
      { x: 0, z: 672 },
    ]) {
      expect(terrainHeight(point.x, point.z, SEED), `${point.x},${point.z}`).toBeCloseTo(9, 1);
    }
  });

  it('grades the ground round every building so a player can walk all the way round', () => {
    // A pad's own taper is short, and on the shelf's rim it left banks too
    // steep to climb behind the counting house, the smithy and the chapel and
    // below the watch house; each building's apron eases them to a walkable
    // grade. (Read from the shipped world alone: the calm skirts are sized
    // from the finished ground the first time a process touches them, so a
    // swap to a pad-free world here would measure the wrong skirts.)
    // Read through the movement gate's own steepness (the gradient a climbing
    // step is refused on, player_motion.ts), on a half-yard grid.
    let checked = 0;
    const tooSteep: string[] = [];
    for (let z = 600; z <= 725; z += 0.5) {
      for (let x = -50; x <= 55; x += 0.5) {
        const near = Math.min(
          ...BUILDINGS.map((building) => distancePointToObb({ x, z }, building.reach)),
        );
        if (near < 0.75 || near > 8) continue;
        checked++;
        const steepness = terrainSteepnessAt(x, z, SEED);
        if (steepness > PLAYER_MAX_CLIMB_SLOPE)
          tooSteep.push(`${x}, ${z}: ${steepness.toFixed(3)}`);
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(tooSteep).toEqual([]);
  });

  it('stands no street lamp on a building, and drops the one that stood on the watch house', () => {
    const lamps = streetlampPlacements(SEED);
    // the town's roads keep their lamps
    expect(
      lamps.filter((lamp) => Math.hypot(lamp.x, lamp.z - 660) < 90).length,
    ).toBeGreaterThanOrEqual(9);
    for (const building of BUILDINGS) {
      for (const lamp of lamps) {
        expect(distancePointToObb(lamp, building.reach), `${building.id} lamp`).toBeGreaterThan(
          1.5,
        );
      }
    }
    // the planned lamp at the watch house's corner is gone, not just listed
    expect(isExcludedStreetlamp(3.8, 628.0621005145729)).toBe(true);
    expect(lamps.some((lamp) => Math.hypot(lamp.x - 3.8, lamp.z - 628.06) < 1)).toBe(false);
  });
});

describe('Highwatch NPCs, services and traversal', () => {
  it('stands the moved NPCs at their doors and counter, spawned exactly there and unblocked', () => {
    const chapel = HIGHWATCH_BUILDINGS_BY_ID.highwatch_gate_chapel;
    const bank = HIGHWATCH_BUILDINGS_BY_ID.highwatch_counting_house;
    expect(HIGHWATCH_NPC_PLACEMENTS_BY_ID.brother_aldric_highwatch).toMatchObject({
      position: chapel.frontStandingPoint,
      facing: chapel.frontFacing,
    });
    expect(HIGHWATCH_NPC_PLACEMENTS_BY_ID.bursar_aldous_crane).toMatchObject({
      position: bank.frontStandingPoint,
      facing: bank.frontFacing,
    });
    expect(HIGHWATCH_LAYOUT.services.bank.npcId).toBe('bursar_aldous_crane');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    for (const placement of HIGHWATCH_LAYOUT.services.npcs) {
      const def = ZONE3_NPCS[placement.id];
      expect(def.pos, placement.id).toEqual(placement.position);
      expect(def.facing, placement.id).toBe(placement.facing);
      const entity = [...sim.entities.values()].find(
        (candidate) => candidate.kind === 'npc' && candidate.templateId === placement.id,
      );
      expect(entity, placement.id).toBeDefined();
      expect({ x: entity?.pos.x, z: entity?.pos.z }, placement.id).toEqual(placement.position);
      expect(isBlocked(SEED, placement.position.x, placement.position.z, 0.6), placement.id).toBe(
        false,
      );
    }
    // no collider covers any town NPC's spot, and Kole keeps his elbow room
    const kole = { x: -11, z: 669 };
    for (const [id, npc] of Object.entries(ZONE3_NPCS)) {
      if (npc.dynamic || Math.hypot(npc.pos.x, npc.pos.z - 660) > 45) continue;
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.05), id).toBe(false);
      expect(Math.hypot(npc.pos.x - kole.x, npc.pos.z - kole.z), id).toBeGreaterThanOrEqual(4);
    }
    // the bursar keeps a live strongbox beside him
    const crane = HIGHWATCH_NPC_PLACEMENTS_BY_ID.bursar_aldous_crane.position;
    const chest = bankerChestSpots(SEED).find(
      (spot) => spot.anchorX === crane.x && spot.anchorZ === crane.z,
    );
    expect(chest).toBeDefined();
    expect(isBlocked(SEED, chest?.x ?? 0, chest?.z ?? 0, 0.5)).toBe(true);
  });

  it('rests a traveller inside the inn, and only there', () => {
    const inn = ZONE3_PROPS.buildings.find((record) => record.id === 'highwatch_summit_inn');
    if (!inn) throw new Error('no inn record');
    expect(buildingContainsRestPoint(inn, inn.x, inn.z, 2)).toBe(true);
    const back = HIGHWATCH_BUILDINGS_BY_ID.highwatch_summit_inn;
    // the far end of the taproom, inside the walls
    const farEnd = localToWorld(back.position, back.rotation, 12, 0);
    expect(buildingContainsRestPoint(inn, farEnd.x, farEnd.z, 2)).toBe(true);
    // the well is not resting ground
    expect(buildingContainsRestPoint(inn, 0, 662, 2)).toBe(false);
  });

  it('pathfinds from the square to every door, NPC and service and back', () => {
    const square = { x: 2, z: 664 };
    const destinations = [
      ...BUILDINGS.map((building) => ({
        id: `${building.id}:door`,
        point: building.frontStandingPoint,
      })),
      ...HIGHWATCH_LAYOUT.services.npcs.map((npc) => ({ id: npc.id, point: npc.position })),
      { id: 'south road', point: { x: 0, z: 612 } },
      { id: 'stormcrag road', point: { x: 42, z: 694 } },
      { id: 'mailbox apron', point: { x: 4, z: 654 } },
      { id: 'graveyard', point: { x: 15, z: 643 } },
    ];
    for (const destination of destinations) {
      expectPath(`${destination.id}:out`, square, destination.point, 0.6);
      expectPath(`${destination.id}:back`, destination.point, square, 0.6);
    }
  });
});

describe("the Highwatch adventurers' guild at the old stable yard", () => {
  const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
  // the model's own axes (scripts/assets/highwatch_guild/guild_plan.py) carried into the world
  const at = (x: number, z: number) => localToWorld(guild.placement, guild.rotation, x, z);

  it('cuts back the rock knob in front of its door to an open, walkable meadow', () => {
    // the knob rose about 20 yd over the yard at (70, 690); the view out of the door is open
    for (let x = 62; x <= 80; x += 2) {
      for (let z = 684; z <= 698; z += 2) {
        expect(terrainHeight(x, z, WORLD_SEED), `${x},${z}`).toBeLessThan(11);
      }
    }
    expect(terrainHeight(70, 690, WORLD_SEED)).toBeCloseTo(9, 1);
    // graded, never a cut seam: a player walks every step from the yard over the old knob
    for (let x = 58; x <= 88; x += 1.5) {
      for (let z = 678; z <= 704; z += 1.5) {
        expect(terrainSteepnessAt(x, z, WORLD_SEED), `${x},${z}`).toBeLessThan(
          PLAYER_MAX_CLIMB_SLOPE,
        );
      }
    }
    // the cut is the town's last pad, after every building's own, so no apron lifts it again
    const pads = HIGHWATCH_LAYOUT.pads;
    const cut = pads.findIndex((p) => p.x === 71 && p.z === 691);
    expect(cut).toBe(pads.length - 1);
  });

  it('looks east down the stables spur at the town, and stands clear of every other building', () => {
    // the door (the model's -z) looks east (-x), toward the square
    expect(guild.frontStandingPoint.x).toBeLessThan(guild.position.x);
    expect(Math.abs(guild.frontStandingPoint.z - guild.position.z)).toBeLessThan(0.01);
    for (const other of BUILDINGS) {
      if (other.id === guild.id) continue;
      for (const point of samplesOf(other.reach, 2)) {
        expect(distancePointToObb(point, guild.reach), other.id).toBeGreaterThan(10);
      }
    }
    // no streetlamp stands in its yard or its house
    for (const lamp of streetlampPlacements(SEED)) {
      expect(distancePointToObb(lamp, guild.reach), `lamp ${lamp.x}, ${lamp.z}`).toBeGreaterThan(1);
    }
  });

  it('walks from the square to its yard, through its door, and on through the arch', () => {
    const yard = at(0, -22);
    expectPath('square to the guild yard', { x: 2, z: 664 }, yard, 0.6);
    // then a player runs straight up the steps, across the porch, through the door, down the
    // hall and through the arch into the trophy hall: nothing in the way
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const body = sim.player;
    const meta = sim.players.get(body.id);
    if (!meta) throw new Error('missing player meta');
    body.pos.x = yard.x;
    body.pos.z = yard.z;
    body.pos.y = groundHeight(yard.x, yard.z, SEED);
    body.prevPos = { ...body.pos };
    body.facing = guild.rotation;
    for (let i = 0; i < 20 * 7; i++) {
      Object.assign(meta.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
      });
      sim.tick();
    }
    Object.assign(meta.moveInput, { forward: false });
    for (let i = 0; i < 20; i++) sim.tick();
    // in the model's axes: past the arch (z 10.9) into the trophy hall, still on the axis
    const local = { x: guild.placement.z - body.pos.z, z: body.pos.x - guild.placement.x };
    expect(local.z).toBeGreaterThan(12);
    expect(Math.abs(local.x)).toBeLessThan(0.5);
    // and the floors stand where the model's decks are: the hall a hand over the yard
    const ground = terrainHeight(guild.placement.x, guild.placement.z, SEED);
    const hall = at(0, -4);
    expect(groundHeight(hall.x, hall.z, SEED) - ground).toBeGreaterThan(0.4);
    expect(groundHeight(hall.x, hall.z, SEED) - ground).toBeLessThan(0.7);
  });

  it("leaves every camp's ground as it was: no camp walks within reach of its pad", () => {
    // A camp's mobs wander up to 9 yd past its radius, and each arrival draws the shared
    // rng: a pad or an apron under them would change when they arrive, and with it every
    // seeded roll in the world. The guild's apron eases the ground out 8 yd past its reach;
    // the Stormcrag elementals to the north are the nearest camp.
    const apron = 8;
    const wander = 9;
    let nearest = Infinity;
    for (const camp of CAMPS) {
      if (camp.count === 0) continue;
      const clear = distancePointToObb(camp.center, guild.reach) - camp.radius - wander;
      nearest = Math.min(nearest, clear);
      expect(clear, `${camp.mobId} at ${camp.center.x}, ${camp.center.z}`).toBeGreaterThan(
        apron + 2,
      );
    }
    // not vacuous: a camp stands within a stone's throw of the margin
    expect(nearest).toBeLessThan(apron + 6);
  });
});
