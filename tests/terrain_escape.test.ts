// Every enterable landform must be leavable on foot, WITHOUT wading rendered
// lava. The Drakemaw Caldera was a one-way pit twice over (player reports):
// first the rim climbed past the movement gate at every azimuth, then the fix
// round exposed that the melt pool filled the vent floor wall to wall, so the
// only physical exit still read as a lava crossing no player would take. The
// vent now carries a dry shore bench ringing the melt eye plus a breached
// outflow gorge on the south face, and this suite walks a real player from
// the exact reported stranding spot around the shore and out to the waste,
// asserting the whole path stays clear of every rendered melt disc.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { EMBER_LAVA_POOLS, groundHeight, WATER_LEVEL } from '../src/sim/world';

// The production seed: the reports are seed-pinned world geometry.
const SEED = 20061;

// The render melt disc sits at pool.floor + 0.9 with radius pool.r * 0.98
// (src/render/ember_features.ts): ground below that surface inside that
// radius reads as standing in lava.
function inMelt(x: number, z: number): boolean {
  for (const pool of EMBER_LAVA_POOLS) {
    const d = Math.hypot(x - pool.x, z - pool.z);
    if (d < pool.r * 0.98 && groundHeight(x, z, SEED) < pool.floor + 0.9) return true;
  }
  return false;
}

function makeWalker(spot: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId)!;
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) sim.tick();
  return { sim, p, meta };
}

// Straight-line sweep: sixteen fixed headings, longest first toward SOUTH
// (the gorge side), each a fourteen-second walk. Used for the melt-eye and
// small-cone starts, where the way out is a straight line.
function escapes(spot: { x: number; z: number }, minDist: number): boolean {
  const { sim, p, meta } = makeWalker(spot);
  const sx = p.pos.x;
  const sz = p.pos.z;
  const sy = p.pos.y;
  for (let k = 0; k < 16; k++) {
    const d = (k + 8) % 16;
    p.pos.x = sx;
    p.pos.z = sz;
    p.pos.y = sy;
    p.prevPos = { ...p.pos };
    p.hp = p.maxHp;
    (p as unknown as { dead: boolean }).dead = false;
    const facing = (d * Math.PI) / 8;
    for (let i = 0; i < 20 * 14; i++) {
      meta.moveInput.forward = true;
      p.facing = facing;
      // the question is terrain, not combat: the walker heals through the
      // local wildlife so a mob pile-up never reads as a terrain trap
      p.hp = p.maxHp;
      (p as unknown as { dead: boolean }).dead = false;
      sim.tick();
    }
    meta.moveInput.forward = false;
    const moved = Math.hypot(p.pos.x - sx, p.pos.z - sz);
    if (moved > minDist && groundHeight(p.pos.x, p.pos.z, SEED) > WATER_LEVEL + 0.3) return true;
  }
  return false;
}

// Waypoint walker: steers a live player through the given points, the way a
// real player follows the shore. Returns the melt contacts seen after the
// start (a dry route must have zero).
function walkRoute(
  start: { x: number; z: number },
  waypoints: { x: number; z: number }[],
): { completed: boolean; meltTicks: number } {
  const { sim, p, meta } = makeWalker(start);
  let wp = 0;
  let meltTicks = 0;
  for (let i = 0; i < 20 * 90 && wp < waypoints.length; i++) {
    const t = waypoints[wp];
    p.facing = Math.atan2(t.x - p.pos.x, t.z - p.pos.z);
    meta.moveInput.forward = true;
    p.hp = p.maxHp;
    (p as unknown as { dead: boolean }).dead = false;
    sim.tick();
    if (inMelt(p.pos.x, p.pos.z)) meltTicks++;
    if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 2) wp++;
  }
  meta.moveInput.forward = false;
  return { completed: wp >= waypoints.length, meltTicks };
}

describe('the Drakemaw Caldera vent is leavable without touching lava', () => {
  it('keeps a dry shore bench above the melt at every azimuth', () => {
    // the rendered melt surface is 12.9 (floor 12 + the 0.9 disc seat); the
    // bench must clear it all the way around or a landing spot reads as lava
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      for (let r = 11; r <= 17; r += 1) {
        const h = groundHeight(390 + Math.sin(rad) * r, 2320 + Math.cos(rad) * r, SEED);
        expect(h, `bench at ${a}deg r${r}`).toBeGreaterThan(13.2);
      }
    }
  });

  it('grades the melt eye onto the bench under the climb gate everywhere', () => {
    // radial rise per half-yard from inside the melt eye out across the
    // bench: a step past 1.5 rise/run is a wall the movement kernel blocks
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      let prev = groundHeight(390 + Math.sin(rad) * 6, 2320 + Math.cos(rad) * 6, SEED);
      for (let r = 6.5; r <= 17; r += 0.5) {
        const h = groundHeight(390 + Math.sin(rad) * r, 2320 + Math.cos(rad) * r, SEED);
        expect((h - prev) / 0.5, `rise at ${a}deg r${r}`).toBeLessThan(1.3);
        prev = h;
      }
    }
  });

  // long-run walker suites need headroom under full-suite core contention
  // (the same class of timeout the stable yard's long-run test carries)
  it('walks the reported stranding spot around the shore and out, fully dry', {
    timeout: 90_000,
  }, () => {
    // (387, 2329): where the stranded player stood (north side of the pool,
    // opposite the gorge). The route a player finds: onto the bench, around
    // the western shore, out through the south gorge to the open waste.
    const start = { x: 387, z: 2329 };
    expect(inMelt(start.x, start.z), 'the reported spot itself must be dry shore').toBe(false);
    const ring = (deg: number, r: number) => ({
      x: 390 + Math.sin((deg * Math.PI) / 180) * r,
      z: 2320 + Math.cos((deg * Math.PI) / 180) * r,
    });
    const route = [
      ring(-60, 13),
      ring(-105, 13),
      ring(-150, 13),
      { x: 390, z: 2302 },
      { x: 390, z: 2288 },
      { x: 390, z: 2272 },
      { x: 390, z: 2258 },
    ];
    const { completed, meltTicks } = walkRoute(start, route);
    expect(completed, 'the walker must reach the waste south of the gorge').toBe(true);
    expect(meltTicks, 'the shore route must never cross a melt disc').toBe(0);
  });

  it('walks straight out even from inside the melt eye', { timeout: 90_000 }, () => {
    // a player who lands dead-center can still wade the shortest way onto
    // the bench and leave: the straight south line stays under the gate
    expect(escapes({ x: 388, z: 2317 }, 45)).toBe(true);
  });
});

describe('the smaller Drakemaw cone craters are leavable on foot', () => {
  it('walks out of both cone craters', { timeout: 90_000 }, () => {
    expect(escapes({ x: 270, z: 2282 }, 30)).toBe(true);
    // the east cone moved inland to (487, 2356): at (500, 2370) it straddled
    // the column strait and row mere carves and its seaward half drowned
    expect(escapes({ x: 487, z: 2356 }, 30)).toBe(true);
  });
});
