// The beach-band gate: a shoreline is painted only where water is actually
// there. The repro that motivated it is the last block: the Eastbrook ->
// Mirefen road pass floors out about a yard above the waterline with no water
// for a hundred yards, and the old height-only band stamped a pale sand-green
// patch across the whole gorge.
import { describe, expect, it } from 'vitest';
import {
  makeShoreProbe,
  SHORE_BAND_HEIGHT,
  SHORE_GATE_FEATHER,
  SHORE_PROBE_RADII,
  SHORE_PROBE_RAYS,
  SHORE_PROBE_SNAP,
  shoreWaterGate,
} from '../src/render/shore_water_gate_core';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const WL = -4.3;

/**
 * One gate query against a synthetic heightfield. The probe is minted PER CALL
 * on purpose: its memo is keyed on position alone, so reusing one across two
 * different samplers would answer from the first sampler's cache, and the
 * call-counting case below depends on a cold memo to see every ray.
 *
 * `h` is the queried point's OWN height, distinct from the waterline: the gate
 * short-circuits at or under the line (that is water, not a candidate beach),
 * so every synthetic case has to sit above it to exercise any probing at all.
 * A yard up is inside SHORE_BAND_HEIGHT, which is where a caller asks.
 */
const gate = (x: number, z: number, sample: (x: number, z: number) => number, h = WL + 1): number =>
  shoreWaterGate(x, z, h, WL, makeShoreProbe(sample));

describe('shoreWaterGate', () => {
  it('opens fully when any probed ground lies under the waterline', () => {
    // a flat plain at the top of the band, with water due east
    const sample = (x: number, _z: number) => (x > 5 ? WL - 2 : WL + 1);
    expect(gate(0, 0, sample)).toBe(1);
  });

  it('closes on dry ground whose whole neighbourhood clears the waterline', () => {
    // the defect shape: a basin floor inside the band, nothing under the line
    const sample = () => WL + 0.95;
    expect(gate(0, 0, sample)).toBeLessThan(0.02);
  });

  it('answers 1 at or under the waterline without probing at all', () => {
    // The seabed carve is not a candidate shore, and the short circuit is what
    // keeps a whole-world sweep off the ring set for every submerged vertex.
    let calls = 0;
    const sample = () => {
      calls++;
      return WL + 5;
    };
    expect(gate(0, 0, sample, WL)).toBe(1);
    expect(gate(0, 0, sample, WL - 2)).toBe(1);
    expect(calls).toBe(0);
  });

  it('feathers rather than cutting a hard edge as the neighbourhood lifts', () => {
    const at = (floor: number) => gate(0, 0, () => WL + floor);
    expect(at(0)).toBe(1);
    const half = at(SHORE_GATE_FEATHER / 2);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    expect(at(SHORE_GATE_FEATHER)).toBe(0);
    // monotone: no fold-back anywhere across the feather
    let prev = 1.01;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const g = at(SHORE_GATE_FEATHER * t);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });

  it('finds water only inside the outer probe radius', () => {
    const outer = Math.max(...SHORE_PROBE_RADII);
    // water beyond the reach: a ring at radius outer + 4 is invisible to it
    const beyond = (x: number, z: number) => (Math.hypot(x, z) > outer + 2 ? WL - 3 : WL + 1);
    expect(gate(0, 0, beyond)).toBe(0);
    const within = (x: number, z: number) => (Math.hypot(x, z) > outer - 2 ? WL - 3 : WL + 1);
    expect(gate(0, 0, within)).toBe(1);
  });

  it('probes a ring, not a single ray: water on any bearing counts', () => {
    const inner = SHORE_PROBE_RADII[0];
    for (const bearing of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
      const wx = Math.cos(bearing) * inner;
      const wz = Math.sin(bearing) * inner;
      const sample = (x: number, z: number) => (Math.hypot(x - wx, z - wz) < 3 ? WL - 1 : WL + 1);
      expect(gate(0, 0, sample)).toBe(1);
    }
  });

  it('stops probing as soon as it has its answer', () => {
    let calls = 0;
    const sample = () => {
      calls++;
      return WL - 1; // the first ray settles it
    };
    expect(gate(0, 0, sample)).toBe(1);
    expect(calls).toBe(1);
    calls = 0;
    gate(0, 0, () => {
      calls++;
      return WL + 5; // nothing under the line: the whole ring set gets walked
    });
    expect(calls).toBe(SHORE_PROBE_RAYS * SHORE_PROBE_RADII.length);
  });

  it('is a pure function of its inputs', () => {
    const sample = (x: number, z: number) => WL + 0.4 + Math.sin(x * 0.3) * Math.cos(z * 0.3);
    const a = gate(12, -7, sample);
    const b = gate(12, -7, sample);
    expect(a).toBe(b);
  });

  it('snaps probe points to a lattice so neighbouring vertices share them', () => {
    // Without the snap each caller pays for a full ring set; snapped, a chunk's
    // probes collapse onto one lattice and the memo turns the sweep into O(area).
    const seen: [number, number][] = [];
    const probe = makeShoreProbe((x: number, z: number) => {
      seen.push([x, z]);
      return WL + 5;
    });
    shoreWaterGate(0, 0, WL + 1, WL, probe);
    const ringSet = SHORE_PROBE_RAYS * SHORE_PROBE_RADII.length;
    expect(seen.length).toBe(ringSet);
    // Every point the sampler ever sees sits ON the lattice, never between it.
    for (const [x, z] of seen) {
      expect(Number.isInteger(x / SHORE_PROBE_SNAP), `x=${x}`).toBe(true);
      expect(Number.isInteger(z / SHORE_PROBE_SNAP), `z=${z}`).toBe(true);
    }
    // The same vertex again costs nothing at all: the memo answers every ray.
    shoreWaterGate(0, 0, WL + 1, WL, probe);
    expect(seen.length).toBe(ringSet);
    // A vertex a fifth of a yard away snaps onto mostly the same points, which
    // is the sharing that makes a whole-chunk sweep O(area) instead of
    // O(vertices * rays). Most, not all: a ray whose coordinate sits near a
    // half-lattice boundary rounds to the next cell across.
    shoreWaterGate(0.2, 0.2, WL + 1, WL, probe);
    expect(seen.length - ringSet).toBeLessThan(ringSet / 2);
  });

  it('reads the shipped waterline band as a beach only where water is', () => {
    const sample = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);
    const probe = makeShoreProbe(sample);
    const inBand = (x: number, z: number) => {
      const h = terrainHeight(x, z, WORLD_SEED);
      return h >= WATER_LEVEL && h <= WATER_LEVEL + SHORE_BAND_HEIGHT;
    };
    // The Eastbrook -> Mirefen pass: inside the band the whole way, dry.
    for (const z of [140, 150, 160, 170, 180, 190]) {
      expect(inBand(0, z), `pass floor at z=${z} should sit in the beach band`).toBe(true);
      expect(
        shoreWaterGate(0, z, terrainHeight(0, z, WORLD_SEED), WATER_LEVEL, probe),
      ).toBeLessThan(0.05);
    }
    // Real Mirefen lake shores keep every bit of their beach.
    for (const [lx, lz] of [
      [60, 380],
      [-105, 300],
      [-40, 450],
    ] as const) {
      let found = false;
      for (let r = 0; r < 60 && !found; r += 1) {
        if (!inBand(lx + r, lz)) continue;
        found = true;
        const h = terrainHeight(lx + r, lz, WORLD_SEED);
        expect(shoreWaterGate(lx + r, lz, h, WATER_LEVEL, probe)).toBe(1);
      }
      expect(found, `no beach band found east of the lake at (${lx}, ${lz})`).toBe(true);
    }
  });
});
