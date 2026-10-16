import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlocked, streetlampPlacements } from '../src/sim/colliders';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPCS,
} from '../src/sim/content/world_quest_investigation';
import { BUILTIN_WORLD, GATHER_NODES, QUESTS, setActiveWorldContent, ZONES } from '../src/sim/data';
import { isExcludedDecoration, isExcludedStreetlamp } from '../src/sim/decoration_exclusions';
import { FENBRIDGE_BUILDINGS_BY_ID, FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import { loadPublishedMap, MAP_SEED } from '../src/sim/maps/eastbrook_rebuild.generated';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { distancePointToObb, localToWorld, type Obb2 } from '../src/sim/placed_town_kit';
import { isInTownZone } from '../src/sim/professions/focus';
import { isResting } from '../src/sim/progression/xp';
import { GRAVE_COUNT, GRAVE_RADIUS, graveOffset } from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import { isProfessionTrainerNpc, questAnchorNpcIds, townQuestIds } from '../src/sim/town_quests';
import type { Entity } from '../src/sim/types';
import { generateDecorationsInBounds, terrainHeight, terrainSteepnessAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Fenbridge stood GRAND (sim/fenbridge_layout.ts): each painted building at the
// smallest size that walks a player in under a door of about five yards, the
// way Highwatch stands its own (tests/highwatch_layout_suite.test.ts). This
// suite ties each size to the model's baked collision, and pins that the
// re-laid town keeps its square, its services and its quests clear, on level
// ground a player can walk all the way round.

const SEED = WORLD_SEED;
const ROOT = path.join(__dirname, '..');
const BUILDINGS = FENBRIDGE_LAYOUT.buildings;
type Building = (typeof BUILDINGS)[number];

/** Placed-asset target height: a baked row is stored in multiples of the
 *  model's largest dimension over it (sim/town_walk_in.ts). */
const PLACED_TARGET_HEIGHT = 2.2;
/** About five yards: the Highwatch counting house's 4.9 yd door counts. */
const FIVE_YARD_DOOR = 4.85;
/** The Mirefen watch quest's ledger clue (content/world_quest_investigation.ts). */
const LEDGER = 'wq_infiltrator_ledger';

interface BakedBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  ry?: number;
}
interface BakedDeck {
  x: number;
  z: number;
  hx: number;
  hz: number;
  y0: number;
  y1: number;
}
const BAKED = JSON.parse(
  readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8'),
) as Record<string, { boxes: BakedBox[]; ramps?: BakedDeck[] }>;

/** The baked rows of a painted record's model, in yards at AUTHORED size over
 *  its ground line (one yard of footing under it). */
function authoredRows(building: Building) {
  const rows = BAKED[building.assetId.replace(/^\/models\//, '').replace(/\.glb$/, '')];
  if (!rows) throw new Error(`no baked rows for ${building.assetId}`);
  const unit = building.placement.modelSize / PLACED_TARGET_HEIGHT;
  const boxes = rows.boxes.map((box) => {
    const cos = Math.abs(Math.cos(box.ry ?? 0));
    const sin = Math.abs(Math.sin(box.ry ?? 0));
    const ex = (box.hx * cos + box.hz * sin) * unit;
    const ez = (box.hx * sin + box.hz * cos) * unit;
    return {
      x0: box.x * unit - ex,
      x1: box.x * unit + ex,
      z0: box.z * unit - ez,
      z1: box.z * unit + ez,
      y0: (box.y - box.hy) * unit - 1,
      y1: (box.y + box.hy) * unit - 1,
    };
  });
  const decks = (rows.ramps ?? []).map((deck) => ({
    x0: (deck.x - deck.hx) * unit,
    x1: (deck.x + deck.hx) * unit,
    z0: (deck.z - deck.hz) * unit,
    z1: (deck.z + deck.hz) * unit,
    y0: deck.y0 * unit - 1,
    y1: deck.y1 * unit - 1,
  }));
  return { boxes, decks };
}

/** The door's clear height at AUTHORED size: from the floor deck under the
 *  room's middle to the lintel over the door on the front wall line. */
function authoredDoorHeight(building: Building): number {
  const { boxes, decks } = authoredRows(building);
  const scale = building.placement.scale;
  const door = building.sockets.entrance.localPosition;
  const doorX = door.x / scale;
  const wallZ = door.z / scale;
  const floor = decks.find((deck) => deck.y0 === deck.y1 && deck.x0 < 0 && deck.x1 > 0);
  if (!floor) throw new Error(`no floor deck for ${building.id}`);
  const lintels = boxes.filter(
    (box) =>
      box.x0 < doorX &&
      box.x1 > doorX &&
      box.z0 < wallZ + 0.3 &&
      box.z1 > wallZ - 0.3 &&
      box.y0 > floor.y0 + 1,
  );
  expect(lintels.length, `${building.id} lintel`).toBeGreaterThan(0);
  return Math.min(...lintels.map((box) => box.y0)) - floor.y0;
}

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

function nearestBox(point: { x: number; z: number }, boxes: readonly Obb2[]): number {
  return Math.min(...boxes.map((box) => distancePointToObb(point, box)));
}

const SOLIDS: Obb2[] = BUILDINGS.flatMap((building) => [building.footprint, ...building.annexes]);
const REACHES: Obb2[] = BUILDINGS.map((building) => building.reach);

describe('the grand Fenbridge buildings', () => {
  it('stand each walk-in building at the smallest size that clears a five-yard door', () => {
    const doors = Object.fromEntries(
      BUILDINGS.filter((building) => building.walkIn).map((building) => [
        building.id,
        Number(authoredDoorHeight(building).toFixed(2)),
      ]),
    );
    // measured off the baked collision at authored size
    expect(doors).toEqual({
      fenbridge_crooked_reed_inn: 4.4,
      fenbridge_lantern_chapel: 5,
      fenbridge_moonwort_apothecary: 3.25,
      fenbridge_gilded_strongbox: 3.25,
    });
    for (const building of BUILDINGS.filter((candidate) => candidate.walkIn)) {
      const door = authoredDoorHeight(building);
      const scale = building.placement.scale;
      expect(door * scale, `${building.id} door`).toBeGreaterThanOrEqual(FIVE_YARD_DOOR);
      // ...and no smaller size would: a tenth less leaves the door short,
      // and a door already five yards keeps its authored size
      if (scale > 1) {
        expect(door * (scale - 0.1), `${building.id} smaller`).toBeLessThan(FIVE_YARD_DOOR);
      } else {
        expect(scale, building.id).toBe(1);
      }
    }
  });

  it('stands the sealed warden house a storey high as the Highwatch watch house', () => {
    const storeyOf = (building: { assetId: string; placement: { modelSize: number } }) => {
      const { boxes, decks } = authoredRows(building as Building);
      // the sealed shell: the widest box standing on the ground line, its top
      // over the door step's
      const shell = boxes
        .filter((box) => box.y0 < 0.1)
        .sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
      if (!shell || decks.length === 0) throw new Error(`no shell for ${building.assetId}`);
      return shell.y1 - Math.max(...decks.map((deck) => deck.y1));
    };
    const warden = BUILDINGS.find((building) => building.id === 'fenbridge_warden_gatehouse');
    const watch = HIGHWATCH_LAYOUT.buildings.find(
      (building) => building.id === 'highwatch_watch_house',
    );
    if (!warden || !watch) throw new Error('missing a sealed house');
    expect(warden.walkIn).toBe(false);
    expect(storeyOf(warden)).toBeCloseTo(3.95, 1);
    expect(warden.placement.scale).toBe(watch.placement.scale);
    expect(storeyOf(warden) * warden.placement.scale).toBeGreaterThan(5.4);
    expect(storeyOf(warden) * warden.placement.scale).toBeCloseTo(
      storeyOf(watch) * watch.placement.scale,
      0,
    );
  });

  it('keeps every building clear of every other one, a lane between their walls', () => {
    for (let i = 0; i < BUILDINGS.length; i++) {
      for (let j = i + 1; j < BUILDINGS.length; j++) {
        let reach = Infinity;
        let walls = Infinity;
        for (const point of samplesOf(BUILDINGS[i].reach)) {
          reach = Math.min(reach, distancePointToObb(point, BUILDINGS[j].reach));
        }
        for (const point of samplesOf(BUILDINGS[i].footprint)) {
          walls = Math.min(walls, distancePointToObb(point, BUILDINGS[j].footprint));
        }
        const pair = `${BUILDINGS[i].id} to ${BUILDINGS[j].id}`;
        expect(reach, `${pair} eaves`).toBeGreaterThan(1);
        expect(walls, `${pair} walls`).toBeGreaterThan(4);
      }
    }
  });

  it('keeps the square, its services, the barrow, the farm and the watch quest clear', () => {
    const { civic, services, repeated } = FENBRIDGE_LAYOUT;
    // the square's pieces stand where they stood
    expect(civic.cistern.position).toEqual({ x: 0, z: 303 });
    expect(civic.provisionStall.position).toEqual({ x: 3, z: 294.5 });
    expect(civic.musterBoard.position).toEqual({ x: -6, z: 278 });
    expect(services.mailbox.position).toEqual({ x: 3.2, z: 310.2 });
    expect(services.graveyard.position).toEqual({ x: -18, z: 286 });
    const kept: { id: string; point: { x: number; z: number }; walls: number }[] = [
      { id: 'cistern', point: civic.cistern.position, walls: civic.cistern.radius + 2 },
      { id: 'mailbox', point: services.mailbox.position, walls: services.mailbox.bodyRadius + 1 },
      { id: 'mailbox stand', point: services.mailbox.frontStandingPoint, walls: 2 },
      { id: 'stall customer', point: civic.provisionStall.customerStandingPoint, walls: 2 },
      { id: 'muster board', point: civic.musterBoard.frontStandingPoint, walls: 2 },
      ...repeated.musterOrders.map((order) => ({
        id: order.id,
        point: order.position,
        walls: 1.5,
      })),
      ...Array.from({ length: GRAVE_COUNT }, (_, index) => {
        const offset = graveOffset(index);
        return {
          id: `barrow stone ${index}`,
          point: {
            x: services.graveyard.position.x + offset.x,
            z: services.graveyard.position.z + offset.z,
          },
          walls: GRAVE_RADIUS + 2,
        };
      }),
      ...INVESTIGATION_NPCS.map((npc) => ({ id: npc.id, point: npc.pos, walls: 1.2 })),
      ...INVESTIGATION_CLUES.filter((clue) => clue.objectItemId !== LEDGER).map((clue) => ({
        id: clue.objectItemId,
        point: { x: clue.x, z: clue.z },
        walls: 1.5,
      })),
    ];
    const farm = FARM_PATCHES.find((candidate) => candidate.id === 'patch_mirefen');
    if (!farm) throw new Error('no Mirefen farm patch');
    expect(farm.beds.length).toBeGreaterThan(0);
    for (const bed of farm.beds) kept.push({ id: bed.id, point: bed, walls: 4 });
    expect(kept.length).toBeGreaterThan(20);
    for (const { id, point, walls } of kept) {
      expect(nearestBox(point, SOLIDS), id).toBeGreaterThan(walls);
    }
    // the stall clears every wall by a stride, and every watch spot the grand
    // buildings came near stands unblocked
    expect(nearestBox(civic.provisionStall.footprint.center, SOLIDS)).toBeGreaterThan(2.5);
    for (const npc of INVESTIGATION_NPCS) {
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    for (const clue of INVESTIGATION_CLUES.filter(
      (candidate) => candidate.objectItemId !== LEDGER,
    )) {
      expect(isBlocked(SEED, clue.x, clue.z, 0.4), clue.objectItemId).toBe(false);
    }
    // The watch ledger is the one clue set against a building: it lies at the
    // chapel's front corner, as it did before the town stood grand, because
    // the chapel (its portal already five yards) kept its size and its spot.
    const ledger = INVESTIGATION_CLUES.find((clue) => clue.objectItemId === LEDGER);
    if (!ledger) throw new Error('no watch ledger clue');
    const chapel = FENBRIDGE_BUILDINGS_BY_ID.fenbridge_lantern_chapel;
    expect(chapel.placement).toMatchObject({ x: -16.2, z: 299.6, scale: 1 });
    expect(distancePointToObb(ledger, chapel.footprint)).toBe(0);
    for (const building of BUILDINGS.filter((candidate) => candidate !== chapel)) {
      expect(distancePointToObb(ledger, building.reach), building.id).toBeGreaterThan(5);
    }
    // ...and every gather node near town keeps clear of the eaves
    const nearNodes = GATHER_NODES.filter((node) => Math.hypot(node.pos.x, node.pos.z - 303) <= 60);
    expect(nearNodes.length).toBeGreaterThan(0);
    for (const node of nearNodes) {
      expect(nearestBox(node.pos, REACHES), node.id).toBeGreaterThan(2);
    }
  });

  it('keeps every townsfolk who gives or takes a quest inside the hub circle', () => {
    // A quest counts as one of the town's own errands only while its giver or a
    // turn-in stands inside the zone's hub circle (sim/town_quests.ts). The
    // grand bank's stall took Scout Maren's spot; she stays in the circle at
    // the street's edge, so her troll and cult errands remain Fenbridge's.
    const zone = ZONES.find((candidate) => candidate.id === FENBRIDGE_LAYOUT.zoneId);
    if (!zone) throw new Error('no Mirefen zone');
    const anchors = FENBRIDGE_LAYOUT.services.npcs.filter(
      (npc) =>
        !isProfessionTrainerNpc(npc.id) &&
        Object.values(QUESTS).some((quest) => questAnchorNpcIds(quest).includes(npc.id)),
    );
    expect(anchors.map((npc) => npc.id)).toEqual([
      'warden_fenwick',
      'brother_aldric_fen',
      'provisioner_hale',
      'herbalist_yara',
      'scout_maren',
    ]);
    for (const npc of anchors) expect(isInTownZone(npc.position, zone), npc.id).toBe(true);
    expect(townQuestIds(zone)).toEqual(expect.arrayContaining(['q_troll_fetishes', 'q_cult_camp']));
  });

  it('levels each building on its own pad across its whole reach', () => {
    const edits = BUILTIN_WORLD.terrainEdits ?? [];
    const pads = FENBRIDGE_LAYOUT.pads;
    expect(pads.length).toBeGreaterThan(0);
    // stamped by the built-in world, apron and pad in the layout's order...
    const start = edits.findIndex((edit) => JSON.stringify(edit) === JSON.stringify(pads[0]));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(edits.slice(start, start + pads.length)).toEqual([...pads]);
    // ...and no other stamp of the world reaches the town's ground, so the
    // pads have the last word there wherever they sit in the list
    const others = [...edits.slice(0, start), ...edits.slice(start + pads.length)];
    expect(others.length).toBeGreaterThan(HIGHWATCH_LAYOUT.pads.length);
    for (const edit of others) {
      const near = Math.hypot(
        Math.max(-60 - edit.x, 0, edit.x - 60),
        Math.max(240 - edit.z, 0, edit.z - 370),
      );
      expect(near, `stamp at ${edit.x}, ${edit.z}`).toBeGreaterThanOrEqual(edit.radius);
    }
    for (const building of BUILDINGS) {
      for (const point of samplesOf(building.reach, 1)) {
        expect(terrainHeight(point.x, point.z, SEED), building.id).toBeCloseTo(1.2, 2);
      }
    }
    // the square stays the marsh hub's level ground
    for (const point of [
      { x: 0, z: 303 },
      { x: 0, z: 313.5 },
      { x: 0, z: 285 },
    ]) {
      expect(terrainHeight(point.x, point.z, SEED), `${point.x},${point.z}`).toBeCloseTo(1.2, 2);
    }
  });

  it('grades the ground round every building so a player can walk all the way round', () => {
    // Read through the movement gate's own steepness (player_motion.ts), on a
    // half-yard grid, from the eaves out to eight yards.
    let checked = 0;
    const tooSteep: string[] = [];
    for (let z = 255; z <= 350; z += 0.5) {
      for (let x = -45; x <= 35; x += 0.5) {
        const near = nearestBox({ x, z }, REACHES);
        if (near < 0.75 || near > 8) continue;
        checked++;
        const steepness = terrainSteepnessAt(x, z, SEED);
        if (steepness > PLAYER_MAX_CLIMB_SLOPE)
          tooSteep.push(`${x}, ${z}: ${steepness.toFixed(3)}`);
      }
    }
    expect(checked).toBeGreaterThan(8000);
    expect(tooSteep).toEqual([]);
  });

  it('stands no street lamp under the eaves, and drops the one the apothecary took', () => {
    const hub = FENBRIDGE_LAYOUT.hub.center;
    isBlocked(SEED, hub.x, hub.z); // plans the lamp network with the grid
    const lamps = streetlampPlacements(SEED).filter(
      (lamp) => Math.hypot(lamp.x - hub.x, lamp.z - hub.z) < 70,
    );
    expect(lamps.length).toBeGreaterThanOrEqual(5);
    for (const lamp of lamps) {
      expect(nearestBox(lamp, REACHES), `lamp at ${lamp.x}, ${lamp.z}`).toBeGreaterThan(1.5);
    }
    // the marsh street's lamp between the apothecary's south wall and the street
    expect(isExcludedStreetlamp(12.944393496618803, 317.48530764241514)).toBe(true);
    expect(lamps.some((lamp) => Math.hypot(lamp.x - 12.944, lamp.z - 317.485) < 1)).toBe(false);
  });

  it('clears the scatter the grand buildings stand on, in the game and in the Studio map', () => {
    // the scatter keeps clear of the hub's ring only, and the apothecary's
    // back corner reaches past it onto a tree
    expect(isExcludedDecoration(20.594, 335.37)).toBe(true);
    const bounds = { minX: -60, maxX: 60, minZ: 245, maxZ: 365 };
    for (const [name, world, seed] of [
      ['built-in', null, SEED],
      ['Studio', loadPublishedMap(), MAP_SEED],
    ] as const) {
      setActiveWorldContent(world);
      try {
        const scatter = generateDecorationsInBounds(seed, bounds);
        expect(scatter.length, name).toBeGreaterThan(20);
        for (const decoration of scatter) {
          // a crown spreads about 3 yd, a boulder's shoulder 1.5
          const clearance = decoration.kind === 'rock' ? 1.5 : 3;
          expect(
            nearestBox(decoration, REACHES),
            `${name}: ${decoration.kind} at ${decoration.x.toFixed(2)}, ${decoration.z.toFixed(2)}`,
          ).toBeGreaterThan(clearance);
        }
      } finally {
        setActiveWorldContent(null);
      }
    }
  });
});

describe('living in the grand Fenbridge', () => {
  it('rests a traveller inside the grand inn and on its threshold, not out at the stand', () => {
    const inn = FENBRIDGE_BUILDINGS_BY_ID.fenbridge_crooked_reed_inn;
    const at = (point: { x: number; z: number }) =>
      ({
        inCombat: false,
        pos: { x: point.x, y: terrainHeight(point.x, point.z, SEED), z: point.z },
      }) as Entity;
    const door = inn.sockets.entrance.localPosition;
    // the far end of the taproom, and the threshold a stride out of the door
    expect(isResting(at(localToWorld(inn.position, inn.rotation, 10, 0)))).toBe(true);
    expect(isResting(at(localToWorld(inn.position, inn.rotation, door.x, door.z - 1)))).toBe(true);
    // the rest area grew with the inn: a stride and a half past the grand
    // gable end still rests (12 + the two-yard padding), where the authored
    // inn's area (10 + 2) stopped short
    expect(inn.nativeDimensions.width / 2).toBeCloseTo(12, 9);
    expect(isResting(at(localToWorld(inn.position, inn.rotation, 13.5, 0)))).toBe(true);
    expect(isResting(at(localToWorld(inn.position, inn.rotation, 14.5, 0)))).toBe(false);
    // the visitor's stand grew with the inn (2.16 yd off the wall), past the
    // two-yard rest padding every inn keeps, as at the grand Highwatch inn
    expect(inn.frontClearance).toBeCloseTo(2.16, 9);
    expect(isResting(at(inn.frontStandingPoint))).toBe(false);
  });

  it('moves a save from the ground the sealed warden house now stands on to clear ground', () => {
    // open ground south of the old gatehouse, now inside the grand one's walls
    const warden = FENBRIDGE_BUILDINGS_BY_ID.fenbridge_warden_gatehouse;
    const position = { x: warden.placement.x, z: warden.placement.z };
    expect(distancePointToObb(position, warden.footprint)).toBe(0);
    expect(isBlocked(SEED, position.x, position.z, 0.5)).toBe(true);
    const source = new Sim({ seed: SEED, playerClass: 'warrior' });
    const state = source.serializeCharacter(source.playerId);
    if (!state) throw new Error('no persisted-position fixture');
    const loadAt = () => {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
      const pid = sim.addPlayer('warrior', 'Saved', {
        state: { ...structuredClone(state), pos: { ...position } },
      });
      const player = sim.entities.get(pid);
      if (!player) throw new Error('the saved player did not load');
      return { x: player.pos.x, z: player.pos.z };
    };
    const first = loadAt();
    expect(first).not.toEqual(position);
    expect(loadAt()).toEqual(first);
    expect(isBlocked(SEED, first.x, first.z, 0.5)).toBe(false);
    // the nearest clear ground, just outside the walls: not a graveyard or
    // the start of the world
    expect(Math.hypot(first.x - position.x, first.z - position.z)).toBeLessThan(
      warden.maxCornerRadius + 2,
    );
  });
});
