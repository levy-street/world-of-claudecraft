import { describe, expect, it } from 'vitest';
import { supportHeightAt } from '../src/sim/colliders';
import { battlegroundOrigin } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { floorHeightAt } from '../src/sim/physics/character';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// A feared player is moved by `moveToward`, the MOB movement path, and returns
// early from the player step, so `stepPlayerMotion` (and with it the whole
// vertical pass) never runs for the duration of the fear. That is the setup for
// the reported battleground bug: fear someone standing on a rampart and they end
// up inside it, unable to move once the fear ends, because swept collision
// exists to stop a body crossing surfaces and from inside a volume every
// direction is a surface.
//
// The floor a body rests on is `floorHeightAt` (terrain, or the standable prop
// top underfoot), which is what the vertical pass lands and snaps against and
// what climb.ts already reuses. These pin that a fear cannot drop a player
// through it.

const seed = 42;

/** A spot inside the battleground where a standable top sits well above ground. */
function rampartSpot(): { x: number; z: number; ground: number; support: number } {
  const o = battlegroundOrigin(0);
  for (let dx = -140; dx <= 140; dx += 1) {
    for (let dz = -140; dz <= 140; dz += 1) {
      const x = o.x + dx;
      const z = o.z + dz;
      const ground = groundHeight(x, z, seed);
      const support = supportHeightAt(seed, x, z, PLAYER_BODY_RADIUS, ground + 40);
      if (support > ground + 4) return { x, z, ground, support };
    }
  }
  throw new Error('no standable top found in the battleground band');
}

function fearedOnRampart(): {
  sim: Sim;
  pid: number;
  spot: ReturnType<typeof rampartSpot>;
} {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('priest', 'Feared');
  const spot = rampartSpot();
  const e = sim.entities.get(pid)!;
  // Stand them ON the rampart deck, which is where the report comes from.
  e.pos = { x: spot.x, y: spot.support, z: spot.z };
  e.prevPos = { ...e.pos };
  e.onGround = true;
  sim.ctx.rebucket(e);
  // The warrior's fear, as the effect dispatch applies it: an incapacitate aura
  // whose value is the flee heading.
  e.auras.push({
    id: 'fear_incap',
    name: 'Fear',
    kind: 'incapacitate',
    duration: 6,
    remaining: 6,
    value: 0,
  } as never);
  return { sim, pid, spot };
}

describe('a fear must not drop a player through the surface they stand on', () => {
  it('the arrangement is real: the battleground has a standable top well above ground', () => {
    const spot = rampartSpot();
    expect(spot.support - spot.ground, 'a rampart deck, not a kerb').toBeGreaterThan(4);
  });

  it('keeps a feared player on the rampart instead of inside it', () => {
    const { sim, pid, spot } = fearedOnRampart();
    const e = sim.entities.get(pid)!;

    sim.tick();

    // The decisive assertion. Before the fix the fear snapped y to the raw
    // terrain heightfield, planting the body several yards INSIDE the rampart
    // it was standing on.
    // Asked from the height the body STOOD at, never from where it ended up:
    // the query is capped at maxY, so a body that has already sunk can no longer
    // see the deck it fell through and would vacuously pass.
    const floor = floorHeightAt(seed, e.pos.x, e.pos.z, PLAYER_BODY_RADIUS, spot.support + 1e-3);
    expect(e.pos.y, 'the body must rest on its own floor, never below it').toBeGreaterThanOrEqual(
      floor - 1e-3,
    );
    expect(e.pos.y, 'and specifically must not be at the terrain under the deck').toBeGreaterThan(
      spot.ground + 1,
    );
  });

  it('still runs the fear for its whole duration, not just one tick', () => {
    const { sim, pid, spot } = fearedOnRampart();
    const e = sim.entities.get(pid)!;
    const from = { x: e.pos.x, z: e.pos.z };

    for (let i = 0; i < 20 * 2; i++) {
      sim.tick();
      const floor = floorHeightAt(seed, e.pos.x, e.pos.z, PLAYER_BODY_RADIUS, spot.support + 1e-3);
      expect(e.pos.y, `tick ${i}: never below the floor underfoot`).toBeGreaterThanOrEqual(
        floor - 1e-3,
      );
    }
    // ...and it really did flee, so the pin above is not passing on a body that
    // simply never moved.
    expect(Math.hypot(e.pos.x - from.x, e.pos.z - from.z), 'the fear moved them').toBeGreaterThan(
      1,
    );
    expect(spot.support).toBeGreaterThan(spot.ground);
  });

  it('still drops a feared player who is fled off the edge, rather than pinning them mid-air', () => {
    // The other half: the fix must not weld a feared body to a height it has
    // walked off. Standing on open terrain, the floor IS the terrain, so the
    // same expression has to track it down a slope.
    const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('priest', 'Runner');
    const e = sim.entities.get(pid)!;
    e.pos = { x: 0, y: groundHeight(0, -40, seed), z: -40 };
    e.prevPos = { ...e.pos };
    sim.ctx.rebucket(e);
    e.auras.push({
      id: 'fear_incap',
      name: 'Fear',
      kind: 'incapacitate',
      duration: 6,
      remaining: 6,
      value: 0,
    } as never);

    for (let i = 0; i < 20; i++) sim.tick();

    expect(e.pos.y).toBeCloseTo(groundHeight(e.pos.x, e.pos.z, seed), 2);
  });
});
