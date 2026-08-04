import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import {
  isSwimming,
  moveSpeedMult,
  type PlayerMotionDeps,
  stepPlayerMotion,
} from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput } from '../src/sim/types';
import { inHollowOpenSea, terrainHeight, WATER_LEVEL, waterLevelAt } from '../src/sim/world';

// The programmatic border waters (the Hollow's moats, the column straits, the
// row meres) are carved and rendered as water where two maps meet, and the
// design comments call them swimmable: the sim must agree. Field report: a
// player crossing from Palmreach into the Hollow at the west moat could not
// return (the "water" was mechanically dry land, so the movement kernel gated
// on the raw trench bed), and could not climb out under the border ridge that
// rose sheer from the channel.
//
// The fix: isInWaterBody covers the border-water rects (so swimming, the
// ride-height clamp, and the shore step-out all work there), the non-sealed
// border ridges gate out across those waters, and their banks get the same
// shore grading as declared lakes.

const SEED = 20061; // the production seed; the reported spots live here
// The reported crossing: the west moat / Palmreach|Hollow strait at z ~1005.
const STRAIT = { x: -180, z: 1005 };

afterEach(() => setActiveWorldContent(null));

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  ...over,
});

function kernelDeps(seed: number): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (_fx, _fz, nx, nz) => ({ x: nx, z: nz }),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

function makeActor(sim: Sim, x: number, z: number, facing: number): Entity {
  const actor = {
    ...sim.player,
    pos: { x, y: 0, z },
    prevPos: { x, y: 0, z },
    facing,
    onGround: true,
    vx: 0,
    vy: 0,
    vz: 0,
    fallStartY: 0,
  };
  actor.pos.y = terrainHeight(x, z, sim.cfg.seed);
  actor.prevPos = { ...actor.pos };
  actor.fallStartY = actor.pos.y;
  return actor;
}

function drive(actor: Entity, deps: PlayerMotionDeps, input: MoveInput, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    actor.prevPos = { ...actor.pos };
    stepPlayerMotion(deps, actor, input);
  }
}

describe('border waters between maps are real, escapable water', () => {
  it('the west moat channel is a live water body a player swims in', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    // the channel is carved below swim depth, so with a live waterline the
    // player treads instead of bed-walking
    const bed = terrainHeight(STRAIT.x, STRAIT.z, SEED);
    expect(bed, 'strait bed is carved deep').toBeLessThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);
    expect(waterLevelAt(STRAIT.x, STRAIT.z, SEED), 'waterline is live').toBe(WATER_LEVEL);

    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const actor = makeActor(sim, STRAIT.x, STRAIT.z, 0);
    drive(actor, kernelDeps(SEED), mi(), 10); // settle
    expect(isSwimming(actor, SEED), 'treads the moat surface').toBe(true);
  });

  it('no border ridge rises out of the moat water (the reported cliff)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    // the reported wall stood at the border line around z 1005 (11yd above
    // the waterline); across the water band the ground must stay low graded
    // shore, never a mountain flank
    for (let x = -200; x <= -160; x += 2) {
      const h = terrainHeight(x, STRAIT.z, SEED);
      expect(h, `ridge flank in the moat at x ${x}`).toBeLessThan(WATER_LEVEL + 3);
    }
  });

  it('crosses Palmreach -> Hollow -> Palmreach without wedging (the reported trap)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const deps = kernelDeps(SEED);

    // eastbound: from the palm shore across the moat into the Hollow
    const east = makeActor(sim, -230, STRAIT.z, Math.PI / 2);
    drive(east, deps, mi({ forward: true }), 20 * 30);
    expect(east.pos.x, 'reached the Hollow side').toBeGreaterThan(-150);

    // westbound: back from the Hollow side to the safe palm shore
    const west = makeActor(sim, east.pos.x, east.pos.z, -Math.PI / 2);
    drive(west, deps, mi({ forward: true }), 20 * 30);
    expect(west.pos.x, 'returned to the palm shore').toBeLessThan(-215);
    expect(
      terrainHeight(west.pos.x, west.pos.z, SEED),
      'standing on dry palm ground',
    ).toBeGreaterThan(WATER_LEVEL);
  });

  it('crosses a row mere between column realms and comes back at most spots', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    // the Duskmere: the Palmreach|Nightbloom row border at z 1260, sampled
    // away from its isthmus road (passX -330). Individual banks may be
    // authored cliffs (a swimmer follows the mere to the next beach), but
    // most crossings must round-trip, so nobody is ever trapped on one side.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const deps = kernelDeps(SEED);
    const spots = [-520, -500, -480, -460, -440, -420, -280, -260, -240, -230, -210, -200];
    let attempted = 0;
    let roundTrips = 0;
    for (const X of spots) {
      // start from the first genuinely dry south-bank ground (some of the
      // mere's outer approaches are open-coast shelf, a different domain)
      let startZ = Number.NaN;
      for (let z = 1238; z >= 1170; z -= 2) {
        if (terrainHeight(X, z, SEED) > WATER_LEVEL + 0.2) {
          startZ = z;
          break;
        }
      }
      if (Number.isNaN(startZ)) continue;
      attempted++;
      const north = makeActor(sim, X, startZ, 0);
      drive(north, deps, mi({ forward: true }), 20 * 30);
      if (north.pos.z <= 1285) continue;
      const south = makeActor(sim, north.pos.x, north.pos.z, Math.PI);
      drive(south, deps, mi({ forward: true }), 20 * 30);
      // a real completed crossing: back across AND standing on dry ground
      if (south.pos.z < startZ + 8 && terrainHeight(south.pos.x, south.pos.z, SEED) > WATER_LEVEL) {
        roundTrips++;
      }
    }
    expect(attempted, 'dry starting banks found').toBeGreaterThanOrEqual(4);
    expect(roundTrips, 'dry-ground round trips across the Duskmere').toBeGreaterThanOrEqual(
      attempted - 1,
    );
  });

  it('the designed crossings carry no swim fatigue (they are meres, not open sea)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    // the whole crossing corridor must be fatigue-free at swim depth: the
    // moat/strait at several z, and each row mere's span away from its mouth
    for (let z = 960; z <= 1900; z += 40) {
      expect(inHollowOpenSea(-180, z), `west strait fatigue at z ${z}`).toBe(false);
      expect(inHollowOpenSea(180, z), `east strait fatigue at z ${z}`).toBe(false);
    }
    for (const [borderZ, xLo, xHi] of [
      [700, 240, 552],
      [1260, 168, 552],
      [1820, 168, 552],
      [700, -552, -240],
      [1260, -552, -168],
      [1820, -552, -168],
    ]) {
      for (let x = xLo + 10; x <= xHi - 10; x += 40) {
        expect(inHollowOpenSea(x, borderZ), `mere fatigue at ${x},${borderZ}`).toBe(false);
      }
    }
  });

  it('a mover can step back into a water body from the submerged bed outside it', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    // west of the west strait band (x < -228) the Hollow-side sea floor
    // continues below the waterline with no live waterline: a mover walking
    // its bed toward the band must be able to re-enter the swimmable water
    // (the surface must never read as a wall from outside)
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const deps = kernelDeps(SEED);
    // find a submerged-but-waterline-free spot just outside the band
    let start: { x: number; z: number } | null = null;
    for (let z = 1100; z <= 1800; z += 10) {
      const x = -232;
      if (
        waterLevelAt(x, z, SEED) === -Infinity &&
        terrainHeight(x, z, SEED) < WATER_LEVEL - 1 &&
        waterLevelAt(-226, z, SEED) === WATER_LEVEL
      ) {
        start = { x, z };
        break;
      }
    }
    if (!start) return; // no such seam at this seed: nothing to pin
    const actor = makeActor(sim, start.x, start.z, Math.PI / 2); // face east, into the band
    drive(actor, deps, mi({ forward: true }), 20 * 10);
    expect(actor.pos.x, 're-entered the water body').toBeGreaterThan(-228);
    expect(isSwimming(actor, SEED) || actor.pos.y > WATER_LEVEL - 0.8, 'swimming or ashore').toBe(
      true,
    );
  });

  it('a custom-map dry sunken feature still never reads as water (#1518 holds)', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [{ x: 30, z: 40, radius: 6, delta: -25, falloff: 'flat', mode: 'add' }],
    });
    expect(waterLevelAt(30, 40, SEED)).toBe(-Infinity);
  });

  it('is deterministic: identical strait heights on identical inputs', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const probe = (): number[] => {
      const out: number[] = [];
      for (let z = 960; z <= 1440; z += 40) out.push(terrainHeight(-180, z, SEED));
      return out;
    };
    expect(probe()).toEqual(probe());
  });
});
