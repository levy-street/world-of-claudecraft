// The Last Keep's castle grounds: a real player can enter by all three
// gates, climb the stair flights to the wall-walk, reach the watch
// chamber, climb the ward steps to the keep terrace, and can NEVER walk
// through the curtain walls or the ward's retaining edge. The walls are
// castleLift terrain (the beacon idiom) over terraced pads, so these are
// movement-kernel walks against the live sim, not geometry assertions.
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_GATES, castleLift } from '../src/sim/castle_layout';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SEED = 42;

function makeWalker(spot: { x: number; z: number }) {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId);
  if (!meta) throw new Error('no meta');
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) sim.tick();
  return { sim, p, meta };
}

/** Walk toward a target for up to maxTicks; true when within 1.2yd. */
function walkTo(
  sim: Sim,
  p: { pos: { x: number; z: number }; facing: number; hp: number; maxHp: number },
  meta: { moveInput: { forward: boolean } },
  target: { x: number; z: number },
  maxTicks = 20 * 30,
): boolean {
  for (let i = 0; i < maxTicks; i++) {
    const dx = target.x - p.pos.x;
    const dz = target.z - p.pos.z;
    if (Math.hypot(dx, dz) < 1.2) {
      meta.moveInput.forward = false;
      return true;
    }
    p.facing = Math.atan2(dx, dz);
    meta.moveInput.forward = true;
    p.hp = p.maxHp; // terrain question, not combat
    sim.tick();
  }
  meta.moveInput.forward = false;
  return false;
}

describe('the Last Keep castle grounds', () => {
  it('a player enters by the main gate, the postern alley, and the breach', () => {
    // main gate: straight in off the road, through the barbican's outer
    // doorway, across the forecourt, and under the gatehouse arch
    {
      const { sim, p, meta } = makeWalker({ x: 330, z: 2029.9 });
      expect(walkTo(sim, p, meta, { x: 376, z: 2029.9 }), 'outer gate + main gate').toBe(true);
    }
    // postern: through the doorway into the wall-side alley, then west
    // into the open bailey (the alley runs between wall and ward terrace)
    {
      const { sim, p, meta } = makeWalker({ x: 408.9, z: 1982 });
      expect(walkTo(sim, p, meta, { x: 408.9, z: 1990.3 }), 'postern doorway').toBe(true);
      expect(walkTo(sim, p, meta, { x: 396, z: 1990.3 }), 'the alley west').toBe(true);
      expect(walkTo(sim, p, meta, { x: 392, z: 2000 }), 'into the bailey').toBe(true);
    }
    // breach: over the rubble line into the yard
    {
      const { sim, p, meta } = makeWalker({ x: 444, z: 2050.9 });
      expect(walkTo(sim, p, meta, { x: 429, z: 2050.9 }), 'breach').toBe(true);
    }
  });

  it('the curtain wall refuses a direct crossing everywhere but the gates', () => {
    for (const z of [2010, 2044, 2060]) {
      const { sim, p, meta } = makeWalker({ x: 354, z });
      walkTo(sim, p, meta, { x: 366, z }, 20 * 10);
      expect(p.pos.x, `wall at z ${z} should stop the walker`).toBeLessThan(CASTLE.wx0 - 0.4);
    }
  });

  it('the barbican wall refuses a crossing; the garden opens only at its doorways', () => {
    // the outer work is a sheer 4yd riser off the road line
    {
      const { sim, p, meta } = makeWalker({ x: 336, z: 2020 });
      walkTo(sim, p, meta, { x: 350, z: 2020 }, 20 * 8);
      expect(p.pos.x, 'the barbican wall should stop the walker').toBeLessThan(340.8);
    }
    // in through the garden's west doorway
    {
      const { sim, p, meta } = makeWalker({ x: 366.75, z: 2088 });
      expect(walkTo(sim, p, meta, { x: 366.75, z: 2079 }), 'garden doorway').toBe(true);
    }
    // the garden wall itself refuses the shortcut
    {
      const { sim, p, meta } = makeWalker({ x: 400, z: 2088 });
      walkTo(sim, p, meta, { x: 400, z: 2079 }, 20 * 8);
      expect(p.pos.z, 'the garden wall should stop the walker').toBeGreaterThan(2084.1);
    }
  });

  it('the ward steps climb the terrace and its edge refuses shortcuts', () => {
    {
      const { sim, p, meta } = makeWalker({ x: 405.75, z: 2026 });
      expect(walkTo(sim, p, meta, { x: 405.75, z: 2014 }), 'ward step').toBe(true);
      expect(p.pos.y, 'on the terrace').toBeGreaterThan(CASTLE.ward.h - 0.4);
    }
    {
      const { sim, p, meta } = makeWalker({ x: 413.5, z: 2024 });
      walkTo(sim, p, meta, { x: 413.5, z: 2012 }, 20 * 8);
      expect(p.pos.z, 'the retaining edge should stop the walker').toBeGreaterThan(
        CASTLE.ward.z1 + 0.4,
      );
    }
  });

  it('the flights climb to the walk; the walk circuit reaches the watch chamber', () => {
    const walkH = CASTLE.walkAbs;
    // west flight to the walk, then south along it to the SW bastion
    {
      const { sim, p, meta } = makeWalker({ x: 362.3, z: 2043 });
      expect(walkTo(sim, p, meta, { x: 362.3, z: 2057.6 })).toBe(true);
      expect(walkTo(sim, p, meta, { x: 360.4, z: 2060.5 })).toBe(true);
      expect(walkTo(sim, p, meta, { x: 360, z: 2069 })).toBe(true);
      expect(p.pos.y, 'SW bastion').toBeGreaterThan(walkH - 0.5);
    }
    // the alley flight to the NE walk, then south along the east wall
    {
      const { sim, p, meta } = makeWalker({ x: 416, z: 1990.2 });
      expect(walkTo(sim, p, meta, { x: 432.5, z: 1990.2 })).toBe(true);
      expect(walkTo(sim, p, meta, { x: 436.8, z: 1990 })).toBe(true); // NE bastion
      expect(walkTo(sim, p, meta, { x: 436.8, z: 2040 })).toBe(true);
      expect(p.pos.y, 'east walk').toBeGreaterThan(walkH - 0.5);
    }
    // the far walk east into the watch chamber (spawned on the walk; the
    // waypoints hug the strip since the walker is a straight-liner)
    {
      const { sim, p, meta } = makeWalker({ x: 380, z: CASTLE.wz1 });
      expect(walkTo(sim, p, meta, { x: 420, z: CASTLE.wz1 })).toBe(true);
      expect(walkTo(sim, p, meta, { x: 436.8, z: CASTLE.wz1 })).toBe(true);
      expect(p.pos.y, 'watch chamber floor').toBeGreaterThan(CASTLE.watchAbs - 0.5);
    }
  });

  it('the walk leaves its mouth open over every gate (no lift above an opening)', () => {
    const openings = [
      { x: CASTLE.wx0, z: (CASTLE_GATES.main.a0 + CASTLE_GATES.main.a1) / 2 },
      { x: (CASTLE_GATES.postern.a0 + CASTLE_GATES.postern.a1) / 2, z: CASTLE.wz0 },
      { x: CASTLE.wx1, z: (CASTLE_GATES.breach.a0 + CASTLE_GATES.breach.a1) / 2 },
    ];
    for (const o of openings) {
      expect(castleLift(o.x, o.z), `gate at (${o.x},${o.z})`).toBe(0);
    }
  });

  it('the keep door spot and its leave-drop are open terrace ground', () => {
    // doorPos in content/dungeons.ts, and the leave teleport at z - 4
    for (const z of [2016.5, 2012.5]) {
      expect(castleLift(413.5, z)).toBe(0);
      expect(Math.abs(groundHeight(413.5, z, SEED) - CASTLE.ward.h)).toBeLessThan(0.1);
    }
  });

  it('the tall towers stand at their heights and stay unreachable from the walk', () => {
    // NW garrison silo at 17, SE watch at 20 (reached by its flight)
    expect(Math.abs(groundHeight(CASTLE.wx0, CASTLE.wz0, SEED) - 17)).toBeLessThan(0.1);
    expect(Math.abs(groundHeight(CASTLE.wx1, CASTLE.wz1, SEED) - CASTLE.watchAbs)).toBeLessThan(
      0.1,
    );
    // a walker on the west walk cannot climb the NW silo's sheer side
    const { sim, p, meta } = makeWalker({ x: CASTLE.wx0, z: 1995 });
    walkTo(sim, p, meta, { x: CASTLE.wx0, z: CASTLE.wz0 }, 20 * 8);
    expect(p.pos.z, 'the silo face should stop the walker').toBeGreaterThan(1990.6);
  });
});
