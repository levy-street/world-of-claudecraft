// The Ashen Bulwark's grounds: a real player walks in by the muster gate and
// the sea postern, climbs either flight to the wall-walk, and can never walk
// through the curtain. The walls are bulwarkLift terrain over the graded pad,
// so these are movement-kernel walks against the live sim, not geometry
// assertions.
//
// The site is a HEADLAND, so the pad also has to be checked against the
// water it sits between: the compound must stand dry with real freeboard,
// and the buildings must fit the yard they were sized for.
import { describe, expect, it } from 'vitest';
import {
  BULWARK,
  BULWARK_BUILDING_UNIT,
  BULWARK_BUILDINGS,
  BULWARK_GATES,
  BULWARK_RAMPS,
  bulwarkLift,
} from '../src/sim/bulwark_layout';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 42;
const LIVE = 20061; // the shipped world: the site survey was done here

function makeWalker(spot: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
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
    p.hp = p.maxHp;
    sim.tick();
  }
  meta.moveInput.forward = false;
  return false;
}

describe('the Ashen Bulwark grounds', () => {
  it('stands dry on the headland with real freeboard', () => {
    for (let x = BULWARK.pad.x0; x <= BULWARK.pad.x1; x += 2) {
      for (let z = BULWARK.pad.z0; z <= BULWARK.pad.z1; z += 2) {
        const h = groundHeight(x, z, LIVE);
        expect(h, `pad at (${x},${z}) is under water`).toBeGreaterThan(WATER_LEVEL + 4);
      }
    }
    // and the graded pad really is level where the yard sits
    expect(Math.abs(groundHeight(230, 2332, LIVE) - BULWARK.pad.h)).toBeLessThan(0.05);
  });

  it('a player enters by the muster gate and the sea postern', () => {
    const gm = (BULWARK_GATES.muster.a0 + BULWARK_GATES.muster.a1) / 2;
    {
      const { sim, p, meta } = makeWalker({ x: 252, z: gm });
      expect(walkTo(sim, p, meta, { x: 238, z: gm }), 'muster gate').toBe(true);
    }
    const pm = (BULWARK_GATES.postern.a0 + BULWARK_GATES.postern.a1) / 2;
    {
      const { sim, p, meta } = makeWalker({ x: 210, z: pm });
      expect(walkTo(sim, p, meta, { x: 222, z: pm }), 'sea postern').toBe(true);
    }
  });

  it('the curtain refuses a direct crossing away from a gate', () => {
    for (const z of [2320, 2334]) {
      const { sim, p, meta } = makeWalker({ x: 251, z });
      walkTo(sim, p, meta, { x: 238, z }, 20 * 8);
      expect(p.pos.x, `east curtain at z ${z}`).toBeGreaterThan(BULWARK.wx1 + 0.4);
    }
  });

  it('both flights climb to the walk, and the Sea Watch tops the circuit', () => {
    // the east flight, climbing north
    const { sim, p, meta } = makeWalker({ x: 242.1, z: 2334 });
    expect(walkTo(sim, p, meta, { x: 242.1, z: 2317 }), 'up the east flight').toBe(true);
    expect(p.pos.y, 'reaches the walk').toBeGreaterThan(BULWARK.walkAbs - 0.5);
  });

  it('the walk leaves its mouth open over both gates', () => {
    const gm = (BULWARK_GATES.muster.a0 + BULWARK_GATES.muster.a1) / 2;
    const pm = (BULWARK_GATES.postern.a0 + BULWARK_GATES.postern.a1) / 2;
    expect(bulwarkLift(BULWARK.wx1, gm)).toBe(0);
    expect(bulwarkLift(BULWARK.wx0, pm)).toBe(0);
    // ...and stands everywhere else along those walls
    expect(bulwarkLift(BULWARK.wx1, 2330)).toBeGreaterThan(0);
    expect(bulwarkLift(BULWARK.wx0, 2340)).toBeGreaterThan(0);
  });

  it('every wall run divides into whole modules', () => {
    // towerHw is half a module, so each run between the corner towers is an
    // exact multiple: no half-module slack anywhere on the curtain
    const zRun = BULWARK.wz1 - BULWARK.wz0 - BULWARK.towerHw * 2;
    const xRun = BULWARK.wx1 - BULWARK.wx0 - BULWARK.towerHw * 2;
    expect(zRun % BULWARK.module, 'z runs divide').toBeCloseTo(0, 6);
    expect(xRun % BULWARK.module, 'x runs divide').toBeCloseTo(0, 6);
    // and each gate sits on a module centre, so it renders as a real arch
    const a0 = BULWARK.wz0 + BULWARK.towerHw;
    for (const gate of [BULWARK_GATES.muster, BULWARK_GATES.postern]) {
      const mid = (gate.a0 + gate.a1) / 2;
      const k = (mid - a0 - BULWARK.module / 2) / BULWARK.module;
      expect(Math.abs(k - Math.round(k)), `gate at ${mid} is off the module grid`).toBeLessThan(
        1e-6,
      );
    }
  });

  it('fits every yard building inside the walls, the flights and the gate lane', () => {
    const inX0 = BULWARK.wx0 + BULWARK.wallTh / 2;
    const inX1 = BULWARK.wx1 - BULWARK.wallTh / 2;
    const inZ0 = BULWARK.wz0 + BULWARK.wallTh / 2;
    const inZ1 = BULWARK.wz1 - BULWARK.wallTh / 2;
    const boxes = BULWARK_BUILDINGS.map((b) => {
      const u = BULWARK_BUILDING_UNIT[b.key];
      expect(u, `${b.key} has a measured footprint`).toBeDefined();
      const swap = Math.abs(Math.sin(b.rot)) > 0.5;
      const hw = ((swap ? u.d : u.w) * b.scale) / 2;
      const hd = ((swap ? u.w : u.d) * b.scale) / 2;
      return { b, x0: b.x - hw, x1: b.x + hw, z0: b.z - hd, z1: b.z + hd };
    });
    for (const q of boxes) {
      expect(q.x0, `${q.b.key} crosses the west curtain`).toBeGreaterThan(inX0);
      expect(q.x1, `${q.b.key} crosses the east curtain`).toBeLessThan(inX1);
      expect(q.z0, `${q.b.key} crosses the north curtain`).toBeGreaterThan(inZ0);
      expect(q.z1, `${q.b.key} crosses the south curtain`).toBeLessThan(inZ1);
      // never standing on a stair flight
      for (const r of BULWARK_RAMPS) {
        if (r.axis !== 'z') continue;
        expect(
          q.x0 < r.b1 && q.x1 > r.b0,
          `${q.b.key} stands on the flight band ${r.b0}..${r.b1}`,
        ).toBe(false);
      }
      // never blocking the way in from the muster gate
      expect(
        q.z0 < BULWARK_GATES.muster.a1 && q.z1 > BULWARK_GATES.muster.a0,
        `${q.b.key} blocks the muster lane`,
      ).toBe(false);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(
          a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0,
          `${a.b.key} overlaps ${b.b.key}`,
        ).toBe(false);
      }
    }
  });

  it('grades the pad without cutting the sea off or steepening the shore', () => {
    // the skirt may fill a shore lip, but it must not raise ground that was
    // under water into a wall the player cannot climb
    for (let x = BULWARK.pad.x0 - 10; x <= BULWARK.pad.x1 + 10; x += 2) {
      for (let z = BULWARK.pad.z0 - 10; z <= BULWARK.pad.z1 + 10; z += 2) {
        const e = 1.5;
        const g = (px: number, pz: number) => terrainHeight(px, pz, LIVE);
        const slope = Math.hypot(g(x + e, z) - g(x - e, z), g(x, z + e) - g(x, z - e)) / (2 * e);
        expect(slope, `graded shore at (${x},${z}) is a cliff`).toBeLessThan(3.2);
      }
    }
  });
});
