// The Guardian of the Quench's frost pass on the bodies, its pure plan
// (src/render/smith_heart_fx/quench_frost_fx_core.ts): the icy aura climbing
// with the bar and biting through an immunity, the vapour's rate, the
// huddle's rings, a splash shard's flight, the shatter's chunks, the freeze's
// spikes.

import { describe, expect, it } from 'vitest';
import {
  CHUNK_SECONDS,
  chunkPose,
  type HuddleRing,
  huddleRings,
  QUENCH_FROST_POOLS,
  shardFlight,
  shellLook,
  spikePose,
  vaporRate,
} from '../src/render/smith_heart_fx/quench_frost_fx_core';
import { QUENCH_TUNING as T } from '../src/sim/encounters/smith_heart/quench_ids';

describe('Quench frost pass: the icy aura', () => {
  it('climbs and brightens with the bar, pulses past three quarters', () => {
    const low = { ...shellLook(10, false, 0, 0) };
    const mid = { ...shellLook(50, false, 0, 0) };
    const high = { ...shellLook(90, false, 0, 0.1) };
    expect(shellLook(0, false, 0, 0).alpha).toBe(0);
    expect(mid.height).toBeGreaterThan(low.height);
    expect(high.height).toBeGreaterThan(mid.height);
    expect(mid.glow).toBeGreaterThan(low.glow);
    expect(low.pulse).toBe(0);
    expect(high.pulse).toBeGreaterThan(0);
    expect(high.height).toBeLessThanOrEqual(1);
  });

  it('bites through an immunity even at no cold, and a splash flares it', () => {
    const sealed = shellLook(0, true, 0, 0);
    expect(sealed.bite).toBe(1);
    expect(sealed.alpha).toBeGreaterThan(0.5);
    const flared = shellLook(5, false, 1, 0);
    expect(flared.alpha).toBe(1);
    expect(flared.glow).toBeGreaterThan(shellLook(5, false, 0, 0).glow + 0.5);
  });

  it('breathes vapour faster as it freezes, none when barely cold', () => {
    expect(vaporRate(5)).toBe(0);
    expect(vaporRate(40)).toBeGreaterThan(0);
    expect(vaporRate(T.coldMax)).toBeGreaterThan(vaporRate(40));
  });
});

describe('Quench frost pass: the huddle ring', () => {
  it('rings each group of three or more warm bodies, reaching every member', () => {
    const bodies = [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 2, z: 0 },
      { id: 3, x: 1, z: 2 },
      // A pair far away: no ring.
      { id: 4, x: 40, z: 0 },
      { id: 5, x: 42, z: 0 },
      // A second huddle.
      { id: 6, x: 0, z: 30 },
      { id: 7, x: 3, z: 30 },
      { id: 8, x: 6, z: 30 },
    ];
    const out: HuddleRing[] = [];
    const n = huddleRings(bodies, out, 6);
    expect(n).toBe(2);
    for (const r of out.slice(0, n)) {
      const members = bodies.filter((b) => Math.hypot(b.x - r.x, b.z - r.z) < r.radius);
      expect(members.length).toBe(r.members);
      expect(r.members).toBe(3);
    }
    expect(huddleRings(bodies.slice(3, 5), out, 6)).toBe(0);
    expect(huddleRings(bodies, out, 1)).toBe(1);
  });
});

describe('Quench frost pass: shards, chunks, spikes', () => {
  it('a splash shard leaves the shattered and strikes the struck at chest height', () => {
    const a = shardFlight(0, 0, 0, 6, 0);
    const b = shardFlight(1, 0, 0, 6, 0);
    const mid = shardFlight(0.5, 0, 0, 6, 0);
    expect(a.x).toBe(0);
    expect(b.x).toBeCloseTo(6);
    expect(b.y).toBeCloseTo(1.25);
    expect(mid.y).toBeGreaterThan(a.y);
  });

  it("a shatter's chunks fly out, land on the ice and are gone by the end", () => {
    const early = chunkPose(3, 77, 0.05);
    const late = chunkPose(3, 77, CHUNK_SECONDS * 0.9);
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(Math.hypot(late?.x ?? 0, late?.z ?? 0)).toBeGreaterThan(
      Math.hypot(early?.x ?? 0, early?.z ?? 0),
    );
    expect(late?.y).toBeCloseTo(0.08, 1);
    expect(late?.size ?? 1).toBeLessThan(early?.size ?? 0);
    expect(chunkPose(3, 77, CHUNK_SECONDS)).toBeNull();
    expect(chunkPose(3, 77, 0.3)).toEqual(chunkPose(3, 77, 0.3));
  });

  it("the freeze's spikes burst out of the ice round the body and stay put once grown", () => {
    const seen = new Set<number>();
    for (let k = 0; k < QUENCH_FROST_POOLS.spikesPer; k++) {
      const s0 = { ...spikePose(9, k, 0) };
      const s1 = spikePose(9, k, 1);
      expect(s0.h).toBe(0);
      expect(s1.h).toBeGreaterThan(0.6);
      expect(s1.r).toBeGreaterThan(0.8);
      seen.add(Math.floor(((s1.a % (Math.PI * 2)) / (Math.PI * 2)) * 4));
    }
    // Round the whole body, not to one side.
    expect(seen.size).toBe(4);
  });
});
