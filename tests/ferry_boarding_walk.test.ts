import { describe, expect, it } from 'vitest';
import { HARBORS, type HarborDef, type HarborRamp, harborDeckAt } from '../src/sim/harbor_layout';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { isSwimming } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { type Entity, emptyMoveInput } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEEDS = [20061, 4242, 7, 999983];
const WAYPOINT_EPSILON = 0.4;
const RAIL_STANDOFF_EPSILON = 0.06;

interface Point2 {
  x: number;
  z: number;
}

function makeSim(seed: number): Sim {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    playerName: 'Ash',
    devCommands: true,
  });
  sim.player.level = 20;
  return sim;
}

function clearInput(sim: Sim): void {
  Object.assign(sim.moveInput, emptyMoveInput());
}

function stage(sim: Sim, point: Point2, y = groundHeight(point.x, point.z, sim.cfg.seed)): void {
  clearInput(sim);
  sim.player.pos = { x: point.x, y, z: point.z };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.fallStartY = y;
  sim.player.onGround = true;
  sim.player.jumping = false;
  sim.player.vx = 0;
  sim.player.vy = 0;
  sim.player.vz = 0;
  sim.rebucket(sim.player);
}

function walkTo(
  sim: Sim,
  target: Point2,
  label: string,
  onTick?: (player: Entity) => void,
  tickBudget = 360,
): void {
  for (let tick = 0; tick < tickBudget; tick++) {
    const distance = Math.hypot(target.x - sim.player.pos.x, target.z - sim.player.pos.z);
    if (distance <= WAYPOINT_EPSILON) {
      clearInput(sim);
      return;
    }
    sim.player.facing = Math.atan2(target.x - sim.player.pos.x, target.z - sim.player.pos.z);
    Object.assign(sim.moveInput, emptyMoveInput(), { forward: true });
    sim.tick();
    onTick?.(sim.player);
  }
  clearInput(sim);
  expect.fail(`${label} stalled at ${sim.player.pos.x.toFixed(2)},${sim.player.pos.z.toFixed(2)}`);
}

function pushToward(
  sim: Sim,
  target: Point2,
  ticks: number,
  onTick?: (player: Entity) => void,
): void {
  sim.player.facing = Math.atan2(target.x - sim.player.pos.x, target.z - sim.player.pos.z);
  Object.assign(sim.moveInput, emptyMoveInput(), { forward: true });
  for (let tick = 0; tick < ticks; tick++) {
    sim.tick();
    onTick?.(sim.player);
  }
  clearInput(sim);
}

function rampHighEdge(ramp: HarborRamp): Point2 {
  switch (ramp.dir) {
    case 'x+':
      return { x: ramp.x - ramp.hw, z: ramp.z };
    case 'x-':
      return { x: ramp.x + ramp.hw, z: ramp.z };
    case 'z+':
      return { x: ramp.x, z: ramp.z - ramp.hd };
    case 'z-':
      return { x: ramp.x, z: ramp.z + ramp.hd };
  }
}

function rampLowEdge(ramp: HarborRamp): Point2 {
  const high = rampHighEdge(ramp);
  return { x: ramp.x * 2 - high.x, z: ramp.z * 2 - high.z };
}

function insideDeck(deck: HarborDef['shipDecks'][number], point: Point2): boolean {
  return Math.abs(point.x - deck.x) <= deck.hw && Math.abs(point.z - deck.z) <= deck.hd;
}

function pointInsideBlocker(blocker: HarborDef['shipBlockers'][number], point: Point2): boolean {
  const dx = point.x - blocker.x;
  const dz = point.z - blocker.z;
  const cos = Math.cos(blocker.rot);
  const sin = Math.sin(blocker.rot);
  const along = dx * cos - dz * sin;
  const across = dx * sin + dz * cos;
  return Math.abs(along) <= blocker.hw && Math.abs(across) <= blocker.hd;
}

function pointClearanceFromBlocker(
  blocker: HarborDef['shipBlockers'][number],
  point: Point2,
): number {
  const dx = point.x - blocker.x;
  const dz = point.z - blocker.z;
  const cos = Math.cos(blocker.rot);
  const sin = Math.sin(blocker.rot);
  const along = dx * cos - dz * sin;
  const across = dx * sin + dz * cos;
  return Math.hypot(
    Math.max(Math.abs(along) - blocker.hw, 0),
    Math.max(Math.abs(across) - blocker.hd, 0),
  );
}

function walkBoardingCircuit(sim: Sim, harbor: HarborDef): void {
  const mainDeck = harbor.shipDecks[0];
  const landing = harbor.shipDecks[1];
  const ramp = harbor.ramps.at(-1);
  if (!mainDeck || !landing || !ramp) throw new Error(`${harbor.id} boarding plan is incomplete`);
  const high = rampHighEdge(ramp);
  const low = rampLowEdge(ramp);
  const outwardX = low.x - high.x;
  const outwardZ = low.z - high.z;
  const outwardLength = Math.hypot(outwardX, outwardZ);
  const outward = { x: outwardX / outwardLength, z: outwardZ / outwardLength };
  const approach = { x: low.x + outward.x * 3, z: low.z + outward.z * 3 };
  const aboard = { x: high.x - outward.x * 4, z: high.z - outward.z * 4 };
  const pierSideSignX = Math.sign(aboard.x - mainDeck.x);
  const pierSideX = mainDeck.x + pierSideSignX * (mainDeck.hw - 1);
  const waterSideX = mainDeck.x - pierSideSignX * (mainDeck.hw - 1);
  const sternZ = mainDeck.z + mainDeck.hd - 1.5;
  const bowZ = mainDeck.z - mainDeck.hd + 1.5;

  stage(sim, approach);
  const boardingHeights: number[] = [];
  walkTo(
    sim,
    aboard,
    `${harbor.id} boards through the gangway`,
    (player) => {
      boardingHeights.push(player.pos.y);
      expect(player.onGround, `${harbor.id} gangplank footing`).toBe(true);
      expect(isSwimming(player, sim.cfg.seed), `${harbor.id} gangplank water gap`).toBe(false);
    },
    240,
  );
  expect(insideDeck(mainDeck, sim.player.pos), `${harbor.id} reached the main deck`).toBe(true);
  expect(Math.min(...boardingHeights), `${harbor.id} ramp-to-deck gap`).toBeGreaterThanOrEqual(
    Math.min(ramp.lowY, ramp.highY) - 0.01,
  );

  const perimeter = [
    { x: pierSideX, z: sternZ },
    { x: waterSideX, z: sternZ },
    { x: waterSideX, z: bowZ },
    { x: pierSideX, z: bowZ },
    aboard,
  ];
  for (const [index, waypoint] of perimeter.entries()) {
    walkTo(
      sim,
      waypoint,
      `${harbor.id} deck perimeter leg ${index}`,
      (player) => {
        expect(
          insideDeck(mainDeck, player.pos),
          `${harbor.id} perimeter leg ${index} left the deck`,
        ).toBe(true);
        expect(player.onGround, `${harbor.id} perimeter leg ${index} footing`).toBe(true);
      },
      300,
    );
  }

  let leftMainDeck = false;
  const exitHeights: number[] = [];
  walkTo(
    sim,
    approach,
    `${harbor.id} leaves through the gangway`,
    (player) => {
      exitHeights.push(player.pos.y);
      expect(player.onGround, `${harbor.id} outbound gangplank footing`).toBe(true);
      expect(isSwimming(player, sim.cfg.seed), `${harbor.id} outbound gangplank water gap`).toBe(
        false,
      );
      if (insideDeck(mainDeck, player.pos)) return;
      leftMainDeck = true;
      const onLanding = insideDeck(landing, player.pos);
      const onRamp =
        Math.abs(player.pos.x - ramp.x) <= ramp.hw + PLAYER_BODY_RADIUS &&
        Math.abs(player.pos.z - ramp.z) <= ramp.hd + PLAYER_BODY_RADIUS;
      expect(
        onLanding || onRamp || harborDeckAt(harbor, player.pos.x, player.pos.z) !== null,
        `${harbor.id} deck exit stays on the gangway route`,
      ).toBe(true);
      if (ramp.dir === 'x+' || ramp.dir === 'x-') {
        expect(
          Math.abs(player.pos.z - ramp.z),
          `${harbor.id} deck exit crossed the gangway opening`,
        ).toBeLessThanOrEqual(ramp.hd + PLAYER_BODY_RADIUS);
      } else {
        expect(
          Math.abs(player.pos.x - ramp.x),
          `${harbor.id} deck exit crossed the gangway opening`,
        ).toBeLessThanOrEqual(ramp.hw + PLAYER_BODY_RADIUS);
      }
    },
    240,
  );
  expect(leftMainDeck, `${harbor.id} left the deck`).toBe(true);
  expect(Math.min(...exitHeights), `${harbor.id} outbound ramp-to-deck gap`).toBeGreaterThanOrEqual(
    Math.min(ramp.lowY, ramp.highY) - 0.01,
  );
  expect(
    Math.hypot(sim.player.pos.x - approach.x, sim.player.pos.z - approach.z),
    `${harbor.id} returned to the pier`,
  ).toBeLessThanOrEqual(WAYPOINT_EPSILON);
}

function challengeRailRun(sim: Sim, harbor: HarborDef, railIndex: number): void {
  const rail = harbor.shipRails[railIndex];
  const mainDeck = harbor.shipDecks[0];
  if (!rail || !mainDeck) throw new Error(`${harbor.id} rail ${railIndex} is missing`);
  const axis = { x: Math.cos(rail.rot), z: -Math.sin(rail.rot) };
  const normal = { x: Math.sin(rail.rot), z: Math.cos(rail.rot) };
  const deckDelta = { x: mainDeck.x - rail.x, z: mainDeck.z - rail.z };
  const insideSign = Math.sign(deckDelta.x * normal.x + deckDelta.z * normal.z);
  if (insideSign === 0) throw new Error(`${harbor.id} rail ${railIndex} has no deck side`);
  const halfThickness = rail.halfThickness ?? 0.14;
  const usableHalfRun = Math.max(0, rail.hw - PLAYER_BODY_RADIUS - 0.2);

  for (const fraction of [-0.75, 0, 0.75]) {
    const along = usableHalfRun * fraction;
    const railPoint = {
      x: rail.x + axis.x * along,
      z: rail.z + axis.z * along,
    };
    const startDistance = halfThickness + PLAYER_BODY_RADIUS + 0.25;
    const start = {
      x: railPoint.x + normal.x * insideSign * startDistance,
      z: railPoint.z + normal.z * insideSign * startDistance,
    };
    const target = {
      x: railPoint.x - normal.x * insideSign * 2,
      z: railPoint.z - normal.z * insideSign * 2,
    };
    stage(sim, start);
    pushToward(sim, target, 12);
    const signedDistance =
      ((sim.player.pos.x - railPoint.x) * normal.x + (sim.player.pos.z - railPoint.z) * normal.z) *
      insideSign;
    expect(
      signedDistance,
      `${harbor.id} rail ${railIndex} at ${fraction} crossed from the deck side`,
    ).toBeGreaterThanOrEqual(halfThickness + PLAYER_BODY_RADIUS - RAIL_STANDOFF_EPSILON);
  }
}

function blockerSupportRadius(
  blocker: HarborDef['shipBlockers'][number],
  direction: Point2,
): number {
  const axis = { x: Math.cos(blocker.rot), z: -Math.sin(blocker.rot) };
  const normal = { x: Math.sin(blocker.rot), z: Math.cos(blocker.rot) };
  return (
    blocker.hw * Math.abs(direction.x * axis.x + direction.z * axis.z) +
    blocker.hd * Math.abs(direction.x * normal.x + direction.z * normal.z)
  );
}

function challengeHullBlocker(
  sim: Sim,
  harbor: HarborDef,
  blockerId: string,
  direction: Point2,
  label: string,
): void {
  const blocker = harbor.shipBlockers.find((candidate) => candidate.id === blockerId);
  if (!blocker) throw new Error(`${harbor.id} lost ${blockerId}`);
  const length = Math.hypot(direction.x, direction.z);
  const outward = { x: direction.x / length, z: direction.z / length };
  const support = blockerSupportRadius(blocker, outward);
  const start = {
    x: blocker.x + outward.x * (support + PLAYER_BODY_RADIUS + 1),
    z: blocker.z + outward.z * (support + PLAYER_BODY_RADIUS + 1),
  };
  const target = {
    x: blocker.x - outward.x * (support + 2),
    z: blocker.z - outward.z * (support + 2),
  };
  stage(sim, start, waterLevelAt(start.x, start.z));
  pushToward(sim, target, 24);
  const signedDistance =
    (sim.player.pos.x - blocker.x) * outward.x + (sim.player.pos.z - blocker.z) * outward.z;
  expect(signedDistance, `${harbor.id} ${label} crossed ${blockerId}`).toBeGreaterThan(0);
  expect(
    pointClearanceFromBlocker(blocker, sim.player.pos),
    `${harbor.id} ${label} body clearance from ${blockerId}`,
  ).toBeGreaterThanOrEqual(PLAYER_BODY_RADIUS - RAIL_STANDOFF_EPSILON);
  expect(
    pointInsideBlocker(blocker, sim.player.pos),
    `${harbor.id} ${label} entered the hull`,
  ).toBe(false);
}

describe('grand ferry boarding walk', () => {
  it.each(SEEDS)(
    'walks both boarding circuits and leaves only through the openings, seed %i',
    (seed) => {
      for (const harbor of HARBORS) {
        walkBoardingCircuit(makeSim(seed), harbor);
      }
    },
  );

  it.each(SEEDS)('blocks every generated rail run from the deck side, seed %i', (seed) => {
    for (const harbor of HARBORS) {
      expect(harbor.shipRails).toHaveLength(5);
      const sim = makeSim(seed);
      for (let railIndex = 0; railIndex < harbor.shipRails.length; railIndex++) {
        challengeRailRun(sim, harbor, railIndex);
      }
    }
  });

  it.each(SEEDS)('blocks pier, water, bow, and stern hull approaches, seed %i', (seed) => {
    for (const harbor of HARBORS) {
      const sim = makeSim(seed);
      const ramp = harbor.ramps.at(-1);
      if (!ramp) throw new Error(`${harbor.id} lost its gangplank`);
      const high = rampHighEdge(ramp);
      const low = rampLowEdge(ramp);
      const pierDirection = { x: low.x - high.x, z: low.z - high.z };
      const waterDirection = { x: -pierDirection.x, z: -pierDirection.z };
      const bowDirection = {
        x: Math.cos(harbor.berth.rot),
        z: -Math.sin(harbor.berth.rot),
      };
      challengeHullBlocker(
        sim,
        harbor,
        'lower-hull-port-stern-1',
        pierDirection,
        'pier-side hull approach',
      );
      challengeHullBlocker(
        sim,
        harbor,
        'lower-hull-starboard-2',
        waterDirection,
        'water-side hull approach',
      );
      challengeHullBlocker(sim, harbor, 'bow-center-2', bowDirection, 'bow approach');
      challengeHullBlocker(
        sim,
        harbor,
        'stern-center-1',
        { x: -bowDirection.x, z: -bowDirection.z },
        'stern approach',
      );
    }
  });
  it('keeps both keeper posts on the main deck beside the opening and outside blockers', () => {
    const sim = makeSim(4242);
    for (const [templateId, harbor] of [
      ['ferryman_ewald', HARBORS[0]],
      ['ferrykeeper_odda', HARBORS[1]],
    ] as const) {
      const keeper = [...sim.entities.values()].find((entity) => entity.templateId === templateId);
      expect(keeper, templateId).toBeDefined();
      if (!keeper) continue;
      const mainDeck = harbor.shipDecks[0];
      const ramp = harbor.ramps.at(-1);
      if (!mainDeck || !ramp) throw new Error(`${harbor.id} keeper plan is incomplete`);
      const high = rampHighEdge(ramp);
      expect(insideDeck(mainDeck, keeper.pos), `${templateId} main deck post`).toBe(true);
      expect(
        Math.hypot(keeper.pos.x - harbor.boarding.x, keeper.pos.z - harbor.boarding.z),
        `${templateId} distance from boarding post`,
      ).toBeLessThan(3);
      expect(
        Math.hypot(harbor.boarding.x - high.x, harbor.boarding.z - high.z),
        `${templateId} boarding post distance from gangway`,
      ).toBeLessThan(9);
      expect(
        harbor.shipBlockers.some((blocker) => pointInsideBlocker(blocker, keeper.pos)),
        `${templateId} blocker overlap`,
      ).toBe(false);
    }
  });
});
