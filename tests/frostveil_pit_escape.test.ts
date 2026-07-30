// Every enterable landform must be leavable on foot (the rule the Drakemaw
// caldera suite enforces, tests/terrain_escape.test.ts). The Frostveil's
// Glacier Tarn broke it: the tarn and its northern finger carve one merged
// bowl whose sandy pond floor sits 10 to 25yd under a terraced icy rim, and a
// player who jumped in could not climb back out at any azimuth (the player
// report, world (42, 1642), with the Rime Elementals' beach camp inside the
// bowl for company). The tarn now carries an authored shore ramp on its west
// flank, where the Icemantle road already comes down to the "Glacier Tarn
// shore" waypoint, and this suite walks a real player out of the reported
// stranding spot, back down again, and checks nobody re-sharpened the ramp.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import {
  GLACIER_TARN_RAMP,
  groundHeight,
  isInWaterBody,
  terrainHeight,
  terrainSteepnessAt,
  WATER_LEVEL,
  waterLevelAt,
} from '../src/sim/world';

// The production seed: the report is seed-pinned world geometry.
const SEED = 20061;

// where the stranded player stood: the pond's dry west beach, inside the bowl
const STRANDED = { x: 42, z: 1642 };

// the two authored lakes whose merged carve is the bowl (frostveil.ts)
const TARN = { x: 60, z: 1640, radius: 16 };
const TARN_FINGER = { x: 48, z: 1652, radius: 9 };

// The rim: dry ground (outside every lake footprint) standing clear above the
// pond's shore band. The bowl's whole interior, the elemental beach included,
// sits inside the tarn footprints and below this line.
function onRim(x: number, z: number): boolean {
  return !isInWaterBody(x, z) && groundHeight(x, z, SEED) > 1;
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

// Walk one fixed heading for `seconds`, healing through the local wildlife so
// a mob pile-up never reads as a terrain trap (the caldera suite's idiom).
function walkHeading(
  spot: { x: number; z: number },
  facing: number,
  seconds: number,
): { x: number; z: number } {
  const { sim, p, meta } = makeWalker(spot);
  for (let i = 0; i < 20 * seconds; i++) {
    meta.moveInput.forward = true;
    p.facing = facing;
    p.hp = p.maxHp;
    (p as unknown as { dead: boolean }).dead = false;
    sim.tick();
  }
  meta.moveInput.forward = false;
  return { x: p.pos.x, z: p.pos.z };
}

// Sixteen-azimuth sweep out of the bowl. Returns the headings (in degrees,
// atan2(dx, dz) convention) that reached the rim.
function escapeHeadings(spot: { x: number; z: number }, seconds: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 16; k++) {
    const facing = (k * Math.PI) / 8;
    const end = walkHeading(spot, facing, seconds);
    const moved = Math.hypot(end.x - spot.x, end.z - spot.z);
    if (moved > 8 && onRim(end.x, end.z)) out.push(Math.round((facing * 180) / Math.PI));
  }
  return out;
}

const r = GLACIER_TARN_RAMP;
// facing convention: atan2(dx, dz), the same one the sim's walkers use
const UP_THE_RAMP = Math.atan2(r.bx - r.ax, r.bz - r.az);
const DOWN_THE_RAMP = Math.atan2(r.ax - r.bx, r.az - r.bz);

describe('the Glacier Tarn bowl is leavable on foot', () => {
  it('walks out of the reported stranding spot', { timeout: 90_000 }, () => {
    const headings = escapeHeadings(STRANDED, 12);
    expect(headings.length, 'no heading out of the pond floor reaches the rim').toBeGreaterThan(0);
  });

  it('leaves by the authored ramp, straight up the west flank', { timeout: 60_000 }, () => {
    const end = walkHeading(STRANDED, UP_THE_RAMP, 12);
    expect(
      Math.hypot(end.x - STRANDED.x, end.z - STRANDED.z),
      'the ramp walker must actually travel',
    ).toBeGreaterThan(8);
    expect(onRim(end.x, end.z), `ramp walk ended at (${end.x}, ${end.z})`).toBe(true);
  });

  it('walks back down the ramp into the bowl without a fall', { timeout: 60_000 }, () => {
    // start on the bench above the ramp top and walk down to the water
    const top = { x: r.bx - 4, z: r.bz };
    const { sim, p, meta } = makeWalker(top);
    const startHp = p.hp;
    let airborneTicks = 0;
    for (let i = 0; i < 20 * 10; i++) {
      meta.moveInput.forward = true;
      p.facing = DOWN_THE_RAMP;
      sim.tick();
      if (!p.onGround) airborneTicks++;
    }
    meta.moveInput.forward = false;
    // a slope no steeper than the climb gate is snapped down, never fallen
    // off (player_motion maxStepDown), so the descent must never go airborne
    expect(airborneTicks, 'the descent must never enter free fall').toBe(0);
    expect(p.hp, 'the descent must cost no health').toBe(startHp);
    expect((p as unknown as { dead: boolean }).dead).toBe(false);
    // and it must actually arrive in the bowl, at the pond
    expect(isInWaterBody(p.pos.x, p.pos.z), `ended at (${p.pos.x}, ${p.pos.z})`).toBe(true);
    expect(p.pos.y, 'the walker must end down at the pond, not on the rim').toBeLessThan(
      WATER_LEVEL + 1.5,
    );
  });
});

describe('the Glacier Tarn ramp keeps the tarn intact', () => {
  it('meets the water at a swimmable foot', () => {
    expect(isInWaterBody(r.ax, r.az), 'the ramp foot must sit inside the tarn').toBe(true);
    expect(
      groundHeight(r.ax, r.az, SEED),
      'the ramp foot must start under the waterline',
    ).toBeLessThan(WATER_LEVEL);
  });

  it('holds water in both tarn lakes', () => {
    for (const lake of [TARN, TARN_FINGER]) {
      expect(waterLevelAt(lake.x, lake.z)).toBe(WATER_LEVEL);
      expect(terrainHeight(lake.x, lake.z, SEED), 'the basin must stay under water').toBeLessThan(
        WATER_LEVEL,
      );
      // the whole footprint is still declared water, not just the pin point
      for (let a = 0; a < 360; a += 45) {
        const rad = (a * Math.PI) / 180;
        const x = lake.x + Math.sin(rad) * lake.radius * 0.6;
        const z = lake.z + Math.cos(rad) * lake.radius * 0.6;
        expect(waterLevelAt(x, z), `water at ${a}deg of (${lake.x}, ${lake.z})`).toBe(WATER_LEVEL);
      }
    }
  });

  it('leaves the pond bed unreshaped away from the ramp', () => {
    // pre-fix bed heights, pinned to literals: the ramp is a cut through the
    // WEST FLANK and must not lift or dig the pond it runs down into. (The
    // east shallow at (60, 1630.4) is the tarn's own organic shore wobble,
    // above the waterline before the fix and after it.)
    const bed: [number, number, number][] = [
      [60, 1640, -7.6],
      [69.6, 1640, -6.6074798367305],
      [60, 1630.4, -4.421488179551974],
      [58, 1634, -6.9929825395840535],
      [48, 1652, -7.6],
      [53.4, 1652, -7.597759267257777],
      [42.6, 1652, -7.401574172538028],
    ];
    for (const [x, z, h] of bed) {
      expect(terrainHeight(x, z, SEED), `pond bed at (${x}, ${z})`).toBeCloseTo(h, 10);
    }
  });

  it('keeps the ramp foot submerged, so the tarn is never bridged', () => {
    // the ramp foot fills the west shallows a little (a slipway shelf) on its
    // way down to meet the bed; the shoreline it hands over to must not march
    // out into the pond, so the whole pond end of the channel stays wet
    for (const x of [46, 47, 48.5, 50, 52]) {
      expect(groundHeight(x, r.az, SEED), `ramp axis at x=${x}`).toBeLessThan(WATER_LEVEL);
    }
    // and the channel's shoulders, where the cut eases back onto the flank,
    // stay wet too: the ramp may nudge the bed, never lift it out of the pond
    for (const [x, z] of [
      [48, 1646.6],
      [50, 1648],
      [50, 1636],
    ]) {
      expect(groundHeight(x, z, SEED), `ramp shoulder at (${x}, ${z})`).toBeLessThan(WATER_LEVEL);
    }
  });

  it('leaves the Rime Elemental camp ground untouched', () => {
    // the camp center's pre-fix height, pinned to the literal: the ramp is on
    // the far (west) flank and must never reshape the elementals' beach
    expect(terrainHeight(66, 1622, SEED)).toBeCloseTo(-3.9529135048925803, 10);
  });

  it('never re-sharpens the ramp centerline past the climb gate', () => {
    // walk the segment (plus a yard of run-out at each end) in movement-tick
    // steps: a step past 1.5 rise/run is a wall the movement kernel refuses
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const step = 0.35; // STEEPNESS_SAMPLE: about one movement tick of run
    let prev = groundHeight(r.ax - ux, r.az - uz, SEED);
    for (let s = -1 + step; s <= len + 1; s += step) {
      const x = r.ax + ux * s;
      const z = r.az + uz * s;
      const h = groundHeight(x, z, SEED);
      expect(Math.abs(h - prev) / step, `ramp step at s=${s.toFixed(2)}`).toBeLessThanOrEqual(1.5);
      // the true local gradient too, so an approach at an angle cannot be
      // walled where the straight line reads clean
      expect(terrainSteepnessAt(x, z, SEED), `ramp gradient at s=${s.toFixed(2)}`).toBeLessThan(
        1.5,
      );
      prev = h;
    }
  });
});
