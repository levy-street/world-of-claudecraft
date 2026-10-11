// The "water is near the player" probe the underwater compile gate arms on
// (src/render/water_approach_core.ts). Pins: which water it sees, at what
// read cost per call, that standing still reads nothing, and that the radius
// buys the fastest ground mover a real lead before it can reach the water.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createWaterApproachProbe,
  WATER_APPROACH_DISC_POINTS,
  WATER_APPROACH_PITCH,
  WATER_APPROACH_RADIUS,
  WATER_APPROACH_READS_PER_CALL,
  type WaterLevelAt,
} from '../src/render/water_approach_core';
import { MOUNTS } from '../src/sim/content/mounts';
import { RUN_SPEED } from '../src/sim/types';
import { waterBodies } from '../src/sim/world';
import { stripComments } from './helpers/strip_comments';

const SEED = 7;
/** Assumed frame-rate floor: the rate a loaded client sinks to before the render
 *  budget sheds (the floor character_cull_core.ts sizes its lag margin on). The
 *  probe reads once per frame, so a slower frame rate shortens the lead. */
const FPS_FLOOR = 20;
const FASTEST = RUN_SPEED * (1 + Math.max(...Object.values(MOUNTS).map((m) => m.moveSpeedPct)));

function pond(cx: number, cz: number, radius: number): WaterLevelAt {
  return (x, z) => ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius ? 0 : Number.NEGATIVE_INFINITY);
}

/** Calls at one spot until the probe latches or has read one full cycle. */
function settleAt(levelAt: WaterLevelAt, x: number, z: number) {
  const probe = createWaterApproachProbe(levelAt);
  let near = false;
  for (let i = 0; i < WATER_APPROACH_DISC_POINTS && !near; i++) near = probe.near(x, z, SEED);
  return { probe, near };
}

describe('water approach probe', () => {
  it('sees water that holds a pitch / sqrt(2) disc anywhere inside its radius', () => {
    const r = WATER_APPROACH_PITCH / Math.SQRT2 + 0.01;
    const reach = WATER_APPROACH_RADIUS - WATER_APPROACH_PITCH / Math.SQRT2 - r;
    let checked = 0;
    for (let px = 0; px < WATER_APPROACH_PITCH; px += 2.3) {
      for (let a = 0; a < Math.PI * 2; a += 0.37) {
        for (const d of [0, reach * 0.5, reach]) {
          const levelAt = pond(px + Math.cos(a) * d, 1.1 + Math.sin(a) * d, r);
          expect(settleAt(levelAt, px, 1.1).near).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('pins the radius, pitch, read budget and disc size', () => {
    expect(WATER_APPROACH_RADIUS).toBe(60);
    expect(WATER_APPROACH_PITCH).toBe(12);
    expect(WATER_APPROACH_READS_PER_CALL).toBe(5);
    expect(WATER_APPROACH_DISC_POINTS).toBe(81);
  });

  it('sees a lattice point on its radius and not the one a ring past it', () => {
    const edge = WATER_APPROACH_RADIUS;
    const past = WATER_APPROACH_RADIUS + WATER_APPROACH_PITCH;
    expect(settleAt(pond(edge, 0, 1), 0, 0).near).toBe(true);
    const beyond = settleAt(pond(past, 0, 1), 0, 0);
    expect(beyond.near).toBe(false);
    expect(beyond.probe.reads).toBe(WATER_APPROACH_DISC_POINTS);
    // On the diagonal: (3, 4) pitches lies on the radius, (4, 4) is past it.
    const p = WATER_APPROACH_PITCH;
    expect(settleAt(pond(3 * p, 4 * p, 1), 0, 0).near).toBe(true);
    expect(settleAt(pond(4 * p, 4 * p, 1), 0, 0).near).toBe(false);
  });

  it('guarantees every authored lake footprint is wide enough to be seen', () => {
    const smallest = Math.min(...waterBodies().map((lake) => lake.radius));
    expect(smallest).toBeGreaterThan(0);
    expect(smallest).toBeGreaterThanOrEqual(WATER_APPROACH_PITCH / Math.SQRT2);
  });

  it('reads at most its per-call budget, and nothing once a cycle ran from a still player', () => {
    const probe = createWaterApproachProbe(() => Number.NEGATIVE_INFINITY);
    let calls = 0;
    let before = 0;
    while (probe.reads < WATER_APPROACH_DISC_POINTS) {
      probe.near(3, 3, SEED);
      calls++;
      expect(probe.reads - before).toBeLessThanOrEqual(WATER_APPROACH_READS_PER_CALL);
      before = probe.reads;
    }
    expect(calls).toBe(Math.ceil(WATER_APPROACH_DISC_POINTS / WATER_APPROACH_READS_PER_CALL));
    for (let i = 0; i < 200; i++) probe.near(3 + (i % 5) * 0.5, 3, SEED);
    expect(probe.reads).toBe(WATER_APPROACH_DISC_POINTS);
  });

  it('reads again once the player reaches a new lattice point, on the world lattice', () => {
    const seen: [number, number][] = [];
    const probe = createWaterApproachProbe((x, z) => {
      seen.push([x, z]);
      return Number.NEGATIVE_INFINITY;
    });
    for (let i = 0; i < WATER_APPROACH_DISC_POINTS; i++) probe.near(3.7, -2.2, SEED);
    expect(probe.reads).toBe(WATER_APPROACH_DISC_POINTS);
    probe.near(WATER_APPROACH_PITCH + 3.7, -2.2, SEED);
    expect(probe.reads).toBe(WATER_APPROACH_DISC_POINTS + WATER_APPROACH_READS_PER_CALL);
    for (const [x, z] of seen) {
      expect(Math.abs(x % WATER_APPROACH_PITCH)).toBe(0);
      expect(Math.abs(z % WATER_APPROACH_PITCH)).toBe(0);
    }
  });

  it('reads every offset of the disc even when the lattice point moves on every call', () => {
    let center = 0;
    const offsets = new Set<string>();
    const probe = createWaterApproachProbe((x, z) => {
      offsets.add(
        `${Math.round(x / WATER_APPROACH_PITCH) - center},${Math.round(z / WATER_APPROACH_PITCH)}`,
      );
      return Number.NEGATIVE_INFINITY;
    });
    const calls = Math.ceil(WATER_APPROACH_DISC_POINTS / WATER_APPROACH_READS_PER_CALL);
    for (let i = 0; i < calls; i++) {
      center = i;
      probe.near(i * WATER_APPROACH_PITCH, 0, SEED);
    }
    expect(offsets.size).toBe(WATER_APPROACH_DISC_POINTS);
  });

  it('latches once it has seen water, with no further reads', () => {
    const probe = createWaterApproachProbe(() => 0);
    expect(probe.near(0, 0, SEED)).toBe(true);
    const reads = probe.reads;
    expect(probe.near(500, 500, SEED)).toBe(true);
    expect(probe.reads).toBe(reads);
  });

  it('finishes a read cycle before the fastest mount crosses a lattice cell, at the fps floor', () => {
    // A slower cycle lets the moving disc skip the same world point cycle
    // after cycle: a pond can then go unseen until the player reaches it.
    const cycleFrames = Math.ceil(WATER_APPROACH_DISC_POINTS / WATER_APPROACH_READS_PER_CALL);
    expect(cycleFrames * (FASTEST / FPS_FLOOR)).toBeLessThanOrEqual(WATER_APPROACH_PITCH);
  });

  it('leaves the fastest mount more lead to the smallest lake than the gate deadline, at the fps floor', () => {
    // The lead is measured by running the probe along straight approaches at
    // every bearing, toward the smallest authored lake footprint placed across
    // one lattice cell, timed to its waterline. The start distance is swept
    // over one read cycle of travel: the cursor's phase on arrival decides
    // which lattice point is read first, and one fixed start hides the worst.
    const deadline = rendererGateDeadlineSeconds();
    const step = FASTEST / FPS_FLOOR;
    const cycle = Math.ceil(WATER_APPROACH_DISC_POINTS / WATER_APPROACH_READS_PER_CALL) * step;
    const r = Math.min(...waterBodies().map((lake) => lake.radius));
    const phases = 8;
    let lead = Number.POSITIVE_INFINITY;
    for (let k = 0; k < phases; k++) {
      const start = WATER_APPROACH_RADIUS + WATER_APPROACH_PITCH * 3 + (k * cycle) / phases;
      for (let cx = 0; cx < WATER_APPROACH_PITCH; cx += 0.5) {
        for (let cz = 0; cz < WATER_APPROACH_PITCH; cz += 0.5) {
          for (let deg = 0; deg < 360; deg += 2) {
            const probe = createWaterApproachProbe(pond(cx, cz, r));
            const dx = Math.cos((deg * Math.PI) / 180);
            const dz = Math.sin((deg * Math.PI) / 180);
            let d = start;
            while (d > r && !probe.near(cx + dx * d, cz + dz * d, SEED)) d -= step;
            lead = Math.min(lead, (d - r) / FASTEST);
          }
        }
      }
    }
    expect(lead).toBeGreaterThan(deadline);
  });
});

/** The renderer's per-piece live gate deadline (`VIEW_COMPILE_GATE_MAX_MS`),
 *  read from its source: the constant is private to the renderer. */
function rendererGateDeadlineSeconds(): number {
  const source = stripComments(
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
  );
  const match = source.match(/\bconst VIEW_COMPILE_GATE_MAX_MS = (\d+);/);
  expect(match).not.toBeNull();
  return Number(match?.[1]) / 1000;
}
