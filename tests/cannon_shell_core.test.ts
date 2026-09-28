import { describe, expect, it } from 'vitest';
import {
  CANNON_BLAST,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_SCORCH_POOL,
  CANNON_SHELL,
  CANNON_SHELL_POOL,
  type CannonBurstFrame,
  type CannonChunkFrame,
  CannonShotTimeline,
  cannonArcHeight,
  cannonChunkInto,
  cannonChunkLaunch,
  cannonFlashInto,
  cannonGroundNormalInto,
  cannonHash01,
  cannonMuzzleFlashInto,
  cannonRecoilOffset,
  cannonScorchFade,
  cannonScorchTexels,
  cannonShakeFalloff,
  cannonShotCounts,
  cannonWaveInto,
  newCannonChunk,
} from '../src/render/cannon_shell_core';
import { DT } from '../src/sim/types';

const flat = () => 0;
const shot = { shotId: 3, x: 30, y: 1, z: 40, flightTicks: 10, impactTick: 210 };
const muzzle = { x: 0, y: 2.5, z: 0 };

describe('cannon shot tuning', () => {
  it('keeps the spec and Ground Blast values', () => {
    expect(CANNON_SHELL).toMatchObject({
      arcFraction: 0.18,
      arcMin: 2.5,
      arcMax: 7,
      trailMotes: 16,
      trailLife: 0.32,
    });
    expect(CANNON_MUZZLE).toMatchObject({
      flashLife: 0.08,
      recoilKick: 0.35,
      recoilLife: 0.25,
      fovPunch: 2,
      shake: 0.22,
    });
    expect(CANNON_BLAST).toMatchObject({ scorchLife: 8, shakeFull: 10, shakeZero: 40 });
    expect([
      CANNON_SHELL_POOL,
      CANNON_IMPACT_POOL,
      CANNON_SCORCH_POOL,
      CANNON_CHUNKS_PER_IMPACT,
    ]).toEqual([4, 6, 18, 12]);
    expect(cannonShotCounts(false)).toEqual({
      chunks: 12,
      dirt: 28,
      dust: 3,
      sparks: 14,
      smoke: 2,
    });
    expect(cannonShotCounts(true)).toEqual({ chunks: 5, dirt: 12, dust: 1, sparks: 4, smoke: 1 });
  });
});

describe('cannon shell arc', () => {
  it('lifts the arc with the span, clamped to the Ground Blast bounds', () => {
    expect(cannonArcHeight(2)).toBe(CANNON_SHELL.arcMin);
    expect(cannonArcHeight(20)).toBeCloseTo(20 * CANNON_SHELL.arcFraction, 12);
    expect(cannonArcHeight(500)).toBe(CANNON_SHELL.arcMax);
  });

  it('leaves the muzzle, peaks over the chord and lands on the blast point on the impact tick', () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, 5);
    const at = { x: 0, y: 0, z: 0 };
    expect(timeline.progress(slot, 200)).toBe(0);
    expect(timeline.progress(slot, 205)).toBeCloseTo(0.5, 12);
    expect(timeline.progress(slot, 230)).toBe(1);
    expect(timeline.shellAt(slot, 199, at)).toBe(false);
    expect(timeline.shellAt(slot, 200, at)).toBe(true);
    expect(at).toEqual(muzzle);
    expect(timeline.shellAt(slot, 205, at)).toBe(true);
    const arc = cannonArcHeight(50);
    expect(at.x).toBeCloseTo(15, 9);
    expect(at.z).toBeCloseTo(20, 9);
    expect(at.y).toBeCloseTo((2.5 + 1) / 2 + arc, 9);
    timeline.arcPointInto(slot, 1, at);
    expect(at).toEqual({ x: 30, y: 1, z: 40 });
    expect(timeline.shellAt(slot, 210, at)).toBe(false);
    expect(timeline.shellAge(slot, 204)).toBeCloseTo(4 * DT, 12);
    expect(timeline.muzzleAt).toBe(5);
  });

  it('drops the shell at its impact while the trail fades out after it', () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, 0);
    const trail = new Float32Array(CANNON_SHELL.trailMotes * 4);
    timeline.impact({ shotId: 3, x: 30, y: 1, z: 40 }, 1, 12, flat);
    const at = { x: 0, y: 0, z: 0 };
    expect(timeline.shellAt(slot, 209, at)).toBe(false);
    expect(timeline.trailInto(slot, 211, trail)).toBeGreaterThan(0);
    const spent = 210 + Math.ceil(CANNON_SHELL.trailLife / DT);
    expect(timeline.trailInto(slot, spent, trail)).toBe(0);
    expect(timeline.shells[slot].shotId).toBe(0);
  });
});

describe('cannon shell trail cadence', () => {
  const interval = CANNON_SHELL.trailLife / CANNON_SHELL.trailMotes;

  it('drops one mote per interval along the arc, newest first, each shrinking over its life', () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, 0);
    const trail = new Float32Array(CANNON_SHELL.trailMotes * 4);
    expect(timeline.trailInto(slot, 199, trail)).toBe(0);
    expect(timeline.trailInto(slot, 200, trail)).toBe(1);
    expect(trail[3]).toBe(1);
    // 0.1 s in: motes at 0, 0.02, ..., 0.1 s (six), the newest at full size.
    const tick = 200 + 0.1 / DT;
    const n = timeline.trailInto(slot, tick, trail);
    expect(n).toBe(Math.floor(0.1 / interval + 1e-9) + 1);
    for (let k = 1; k < n; k++) expect(trail[k * 4 + 3]).toBeLessThan(trail[(k - 1) * 4 + 3]);
    const at = { x: 0, y: 0, z: 0 };
    timeline.arcPointInto(slot, (5 * interval) / (10 * DT), at);
    expect(trail[0]).toBeCloseTo(at.x, 5);
    expect(trail[1]).toBeCloseTo(at.y, 5);
    expect(trail[2]).toBeCloseTo(at.z, 5);
  });

  it('never holds more than trailMotes motes, and stops dropping them once the shell lands', () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, 0);
    const trail = new Float32Array(CANNON_SHELL.trailMotes * 4);
    expect(timeline.trailInto(slot, 209.9, trail)).toBe(CANNON_SHELL.trailMotes);
    const landedAt = timeline.trailInto(slot, 210, trail);
    const later = timeline.trailInto(slot, 212, trail);
    expect(later).toBeLessThan(landedAt);
    // Nothing newer than the landing: the newest mote is the one at the blast.
    expect(trail[0]).toBeCloseTo(30, 6);
    expect(trail[2]).toBeCloseTo(40, 6);
  });
});

describe('cannon muzzle and blast curves', () => {
  it('pops the muzzle flash and spends it in flashLife', () => {
    const f = { core: 0, length: 0, width: 0 };
    expect(cannonMuzzleFlashInto(-0.01, f)).toBe(false);
    expect(cannonMuzzleFlashInto(0, f)).toBe(true);
    const first = f.core;
    expect(cannonMuzzleFlashInto(CANNON_MUZZLE.flashLife * 0.2, f)).toBe(true);
    expect(f.core).toBeGreaterThan(first);
    expect(cannonMuzzleFlashInto(CANNON_MUZZLE.flashLife * 0.9, f)).toBe(true);
    expect(f.core).toBeLessThan(first);
    expect(f.length).toBeGreaterThan(f.width);
    expect(cannonMuzzleFlashInto(CANNON_MUZZLE.flashLife, f)).toBe(false);
  });

  it('grows the flash from 0.35 radii as it fades on a square', () => {
    const f: CannonBurstFrame = { scale: 0, fade: 0 };
    expect(cannonFlashInto(0, 6, f)).toBe(true);
    expect(f).toEqual({ scale: 6 * 0.35, fade: 1 });
    expect(cannonFlashInto(CANNON_BLAST.flashLife / 2, 6, f)).toBe(true);
    expect(f.scale).toBeCloseTo(6 * (0.35 + 0.45), 9);
    expect(f.fade).toBeCloseTo(0.25, 9);
    expect(cannonFlashInto(CANNON_BLAST.flashLife, 6, f)).toBe(false);
  });

  it('runs the shockwave out past the blast radius and thins it', () => {
    const f: CannonBurstFrame = { scale: 0, fade: 0 };
    expect(cannonWaveInto(0, 6, f)).toBe(true);
    expect(f.scale).toBeCloseTo(2.4, 9);
    expect(f.fade).toBeCloseTo(0.9, 9);
    expect(cannonWaveInto(CANNON_BLAST.waveLife * 0.99, 6, f)).toBe(true);
    expect(f.scale).toBeGreaterThan(6 * 2.7);
    expect(f.fade).toBeLessThan(0.01);
    expect(cannonWaveInto(CANNON_BLAST.waveLife, 6, f)).toBe(false);
  });

  it('holds the scorch, fades it to nothing by its life, and never before the blast', () => {
    expect(cannonScorchFade(-1)).toBe(0);
    expect(cannonScorchFade(0)).toBe(0);
    expect(cannonScorchFade(0.12)).toBe(1);
    expect(cannonScorchFade(CANNON_BLAST.scorchHold)).toBe(1);
    const mid = cannonScorchFade((CANNON_BLAST.scorchHold + CANNON_BLAST.scorchLife) / 2);
    expect(mid).toBeCloseTo(0.5, 9);
    expect(cannonScorchFade(CANNON_BLAST.scorchLife - 0.01)).toBeLessThan(0.001);
    expect(cannonScorchFade(CANNON_BLAST.scorchLife)).toBe(0);
  });
});

describe('cannon barrel recoil', () => {
  it('kicks back fast, springs home with a small overshoot, and rests after recoilLife', () => {
    expect(cannonRecoilOffset(-0.01)).toBe(0);
    expect(cannonRecoilOffset(0)).toBe(0);
    expect(cannonRecoilOffset(CANNON_MUZZLE.recoilAttack)).toBeCloseTo(CANNON_MUZZLE.recoilKick, 9);
    let peak = 0;
    let overshoot = 0;
    for (let age = 0; age < CANNON_MUZZLE.recoilLife; age += 0.001) {
      const kick = cannonRecoilOffset(age);
      peak = Math.max(peak, kick);
      overshoot = Math.min(overshoot, kick);
    }
    expect(peak).toBeCloseTo(CANNON_MUZZLE.recoilKick, 6);
    expect(overshoot).toBeLessThan(0);
    expect(overshoot).toBeGreaterThan(-0.1 * CANNON_MUZZLE.recoilKick);
    expect(Math.abs(cannonRecoilOffset(CANNON_MUZZLE.recoilLife - 1e-6))).toBeLessThan(0.01);
    expect(cannonRecoilOffset(CANNON_MUZZLE.recoilLife)).toBe(0);
    expect(cannonRecoilOffset(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('cannon shake by distance', () => {
  it('shakes fully within 10 yd, not at all past 40, linearly between', () => {
    expect(cannonShakeFalloff(0)).toBe(1);
    expect(cannonShakeFalloff(CANNON_BLAST.shakeFull)).toBe(1);
    expect(cannonShakeFalloff(25)).toBeCloseTo(0.5, 12);
    expect(cannonShakeFalloff(CANNON_BLAST.shakeZero)).toBe(0);
    expect(cannonShakeFalloff(90)).toBe(0);
    expect(cannonShakeFalloff(10)).toBe(1);
    expect(cannonShakeFalloff(10.5)).toBeLessThan(1);
    expect(cannonShakeFalloff(39.5)).toBeGreaterThan(0);
    expect(cannonShakeFalloff(40)).toBe(0);
  });
});

describe('cannon graphics tiers', () => {
  it('sheds chunks, dirt, dust, sparks and smoke on low, and nothing else', () => {
    const full = cannonShotCounts(false);
    const low = cannonShotCounts(true);
    expect(Object.keys(low).sort()).toEqual(['chunks', 'dirt', 'dust', 'smoke', 'sparks']);
    expect(full.chunks).toBe(CANNON_CHUNKS_PER_IMPACT);
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(low[key]).toBeGreaterThan(0);
      expect(low[key]).toBeLessThan(full[key]);
    }
  });
});

describe('cannon dirt chunks', () => {
  it('launches deterministically, spread around the blast, and lands on the sampled floor', () => {
    const a = cannonChunkLaunch(newCannonChunk(), 7, 2, 12, 10, 0, 10, flat);
    const b = cannonChunkLaunch(newCannonChunk(), 7, 2, 12, 10, 0, 10, flat);
    expect(a).toEqual(b);
    const angles = Array.from({ length: 12 }, (_, i) => {
      const c = cannonChunkLaunch(newCannonChunk(), 7, i, 12, 10, 0, 10, flat);
      expect(Math.hypot(c.dirX, c.dirZ)).toBeCloseTo(1, 12);
      expect(Math.hypot(c.axisX, c.axisY, c.axisZ)).toBeCloseTo(1, 12);
      return Math.atan2(c.dirX, c.dirZ);
    });
    const quadrants = new Set(angles.map((a) => Math.floor((a + Math.PI) / (Math.PI / 2))));
    expect(quadrants.size).toBe(4);
  });

  it('samples its floor once, under where it comes down, not under the blast', () => {
    const probes: [number, number][] = [];
    const ledge = (x: number, z: number) => {
      probes.push([x, z]);
      return 2;
    };
    const c = cannonChunkLaunch(newCannonChunk(), 7, 3, 12, 10, 0, 10, ledge);
    expect(probes).toHaveLength(1);
    const g = CANNON_BLAST.chunkGravity;
    // The flight to the blast's own height, the guess the floor is sampled at.
    const guess = (c.lift + Math.sqrt(c.lift * c.lift + 2 * g * (c.startY - 0))) / g;
    const [px, pz] = probes[0];
    expect(px).toBeCloseTo(c.startX + c.dirX * c.speed * guess, 9);
    expect(pz).toBeCloseTo(c.startZ + c.dirZ * c.speed * guess, 9);
    expect(Math.hypot(px - 10, pz - 10)).toBeGreaterThan(c.speed * guess);
    expect(c.floorY).toBeCloseTo(2 + c.size * 0.4, 12);
  });

  it('flies a closed-form arc, rests where it lands, and shrinks away by the end of its life', () => {
    const chunk = cannonChunkLaunch(newCannonChunk(), 9, 0, 12, 0, 0, 0, flat);
    const f: CannonChunkFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
    expect(cannonChunkInto(chunk, -0.01, f)).toBe(false);
    expect(cannonChunkInto(chunk, 0, f)).toBe(true);
    expect(f.y).toBeCloseTo(chunk.startY, 12);
    expect(f.scale).toBe(chunk.size);
    cannonChunkInto(chunk, chunk.lift / CANNON_BLAST.chunkGravity, f);
    expect(f.y).toBeGreaterThan(chunk.startY + 0.5);
    cannonChunkInto(chunk, chunk.landAt, f);
    expect(f.y).toBeCloseTo(chunk.floorY, 6);
    const landedX = f.x;
    const landedAngle = f.angle;
    cannonChunkInto(chunk, chunk.landAt + 0.3, f);
    expect(f.x).toBe(landedX);
    expect(f.y).toBe(chunk.floorY);
    expect(f.angle).toBe(landedAngle);
    expect(chunk.landAt).toBeLessThan(CANNON_BLAST.chunkLife * 0.65);
    cannonChunkInto(chunk, CANNON_BLAST.chunkLife - 1e-4, f);
    expect(f.scale).toBeLessThan(chunk.size * 0.01);
    expect(cannonChunkInto(chunk, CANNON_BLAST.chunkLife, f)).toBe(false);
  });

  it('hashes to [0, 1) without a random source', () => {
    for (let i = 0; i < 200; i++) {
      const h = cannonHash01(i, i * 7 + 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(cannonHash01(i, i * 7 + 1)).toBe(h);
    }
  });
});

describe('cannon scorch', () => {
  it('darkens most at the centre, nothing at the rim, a little more in blue', () => {
    const size = 32;
    const texels = cannonScorchTexels(size);
    expect(texels).toHaveLength(size * size * 4);
    const at = (i: number, j: number) => (j * size + i) * 4;
    const centre = at(size / 2, size / 2);
    expect(texels[centre + 2]).toBeGreaterThan(100);
    expect(texels[centre + 2]).toBeGreaterThanOrEqual(texels[centre]);
    for (const [i, j] of [
      [0, 0],
      [size - 1, 0],
      [0, size / 2],
      [size / 2, size - 1],
    ]) {
      expect(texels[at(i, j)] + texels[at(i, j) + 1] + texels[at(i, j) + 2]).toBe(0);
    }
    for (let k = 3; k < texels.length; k += 4) expect(texels[k]).toBe(255);
    expect(cannonScorchTexels(size)).toEqual(texels);
  });

  it('lies on the ground normal', () => {
    const out = { nx: 0, ny: 0, nz: 0 };
    cannonGroundNormalInto(flat, 0, 0, out);
    expect(out).toEqual({ nx: 0, ny: 1, nz: 0 });
    cannonGroundNormalInto((x) => x, 0, 0, out);
    expect(out.nx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(out.ny).toBeCloseTo(Math.SQRT1_2, 9);
    expect(out.nz).toBe(0);
  });
});

describe('cannon shot timeline pools', () => {
  it('reuses its fixed pools round robin, starts a blast, chunks and a scorch per impact, and clears', () => {
    const timeline = new CannonShotTimeline();
    for (let i = 1; i <= CANNON_SHELL_POOL + 1; i++) {
      timeline.fired({ ...shot, shotId: i }, muzzle, i);
    }
    expect(timeline.shells.map((s) => s.shotId)).toEqual([5, 2, 3, 4]);
    for (let i = 1; i <= CANNON_SCORCH_POOL + 1; i++) {
      timeline.impact({ shotId: i, x: i, y: 0, z: 0 }, i, i % 2 ? 12 : 5, flat);
    }
    expect(timeline.impacts).toHaveLength(CANNON_IMPACT_POOL);
    expect(timeline.impacts.every((s) => s.active)).toBe(true);
    expect(timeline.impacts.map((s) => s.chunkCount).sort()).toEqual([12, 12, 12, 5, 5, 5]);
    expect(timeline.scorches.map((s) => s.x)).toEqual([
      19, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(timeline.lastScorch).toBe(0);
    timeline.clear();
    expect(timeline.shells.every((s) => s.shotId === 0)).toBe(true);
    expect(timeline.impacts.every((s) => !s.active)).toBe(true);
    expect(timeline.scorches.every((s) => !s.active)).toBe(true);
    expect(timeline.muzzleAt).toBe(Number.NEGATIVE_INFINITY);
    expect(timeline.lastScorch).toBe(-1);
  });
});
