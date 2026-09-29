import { describe, expect, it } from 'vitest';
import {
  CANNON_BLAST_FIXED_PUFFS,
  CANNON_TRAIL,
  newCannonPuff,
  PUFF,
} from '../src/render/cannon_puff_core';
import {
  CANNON_BLAST,
  CANNON_BLAST_PUFFS,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_MUZZLE_POOL,
  CANNON_SCORCH_GRID,
  CANNON_SCORCH_LAYERS,
  CANNON_SCORCH_POOL,
  CANNON_SCORCH_VERTS,
  CANNON_SHELL,
  CANNON_SHELL_POOL,
  CANNON_TRAIL_PUFFS,
  type CannonChunkFrame,
  CannonShotTimeline,
  cannonArcHeight,
  cannonChunkInto,
  cannonChunkLaunch,
  cannonHash01,
  cannonRecoilOffset,
  cannonScorchDrapeInto,
  cannonScorchFade,
  cannonScorchTexels,
  cannonShakeFalloff,
  cannonShotCounts,
  newCannonChunk,
} from '../src/render/cannon_shell_core';
import { DT } from '../src/sim/types';

const flat = () => 0;
const shot = { shotId: 3, x: 30, y: 1, z: 40, flightTicks: 10, impactTick: 210 };
const muzzle = { x: 0, y: 2.5, z: 0 };
const axis = { x: 0.6, y: 0, z: 0.8 };
const FULL = cannonShotCounts(false);

describe('cannon shot tuning', () => {
  it('keeps the spec and Ground Blast values', () => {
    expect(CANNON_SHELL).toMatchObject({ arcFraction: 0.18, arcMin: 2.5, arcMax: 7 });
    expect(CANNON_MUZZLE).toMatchObject({
      recoilKick: 0.35,
      recoilLife: 0.25,
      fovPunch: 2,
      shake: 0.22,
    });
    expect(CANNON_BLAST).toMatchObject({ scorchLife: 8, shakeFull: 10, shakeZero: 40 });
    expect([
      CANNON_SHELL_POOL,
      CANNON_MUZZLE_POOL,
      CANNON_IMPACT_POOL,
      CANNON_SCORCH_POOL,
      CANNON_CHUNKS_PER_IMPACT,
    ]).toEqual([4, 4, 6, 18, 12]);
    expect(cannonShotCounts(false)).toEqual({
      chunks: 12,
      dirt: 24,
      dust: 12,
      sparks: 16,
      smoke: 6,
    });
    expect(cannonShotCounts(true)).toEqual({ chunks: 5, dirt: 8, dust: 4, sparks: 5, smoke: 2 });
    expect(CANNON_BLAST_PUFFS).toBe(CANNON_BLAST_FIXED_PUFFS + 12 + 24 + 16);
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
    const slot = timeline.fired(shot, muzzle, axis, 5, FULL.smoke);
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

  it('drops the shell at its impact while its wake fades out after it', () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, axis, 0, FULL.smoke);
    const puffs = Array.from({ length: CANNON_TRAIL_PUFFS }, newCannonPuff);
    const ages = new Float32Array(CANNON_TRAIL_PUFFS);
    timeline.impact({ shotId: 3, x: 30, y: 1, z: 40 }, 1, FULL, 6, 1, flat);
    const at = { x: 0, y: 0, z: 0 };
    expect(timeline.shellAt(slot, 209, at)).toBe(false);
    expect(timeline.trailPuffsInto(slot, 211, puffs, ages)).toBeGreaterThan(0);
    const spent = 210 + Math.ceil(CANNON_TRAIL.smokeLife / DT);
    expect(timeline.trailPuffsInto(slot, spent, puffs, ages)).toBe(0);
    expect(timeline.shells[slot].shotId).toBe(0);
  });
});

describe('cannon shell wake', () => {
  const run = () => {
    const timeline = new CannonShotTimeline();
    const slot = timeline.fired(shot, muzzle, axis, 0, FULL.smoke);
    const puffs = Array.from({ length: CANNON_TRAIL_PUFFS }, newCannonPuff);
    const ages = new Float32Array(CANNON_TRAIL_PUFFS);
    return { timeline, slot, puffs, ages };
  };

  it('drops smoke by distance along the arc, newest first, with sparks between', () => {
    const { timeline, slot, puffs, ages } = run();
    expect(timeline.trailPuffsInto(slot, 199, puffs, ages)).toBe(0);
    const n = timeline.trailPuffsInto(slot, 205, puffs, ages);
    const smoke = puffs.slice(0, n).filter((p) => p.kind === PUFF.trailSmoke);
    const sparks = puffs.slice(0, n).filter((p) => p.kind === PUFF.trailSpark);
    expect(smoke.length).toBeGreaterThan(10);
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks.length).toBeLessThan(smoke.length);
    for (let k = 1; k < n; k++) expect(ages[k]).toBeGreaterThanOrEqual(ages[k - 1]);
    // Unbroken: consecutive smoke puffs sit closer than a puff is wide.
    for (let k = 1; k < smoke.length; k++) {
      const gap = Math.hypot(smoke[k].x - smoke[k - 1].x, smoke[k].z - smoke[k - 1].z);
      expect(gap).toBeLessThan(smoke[k].size0 + 0.3);
    }
    // The newest is where the shell is now.
    const at = { x: 0, y: 0, z: 0 };
    timeline.shellAt(slot, 205, at);
    expect(Math.hypot(puffs[0].x - at.x, puffs[0].z - at.z)).toBeLessThan(
      CANNON_TRAIL.spacing + 0.2,
    );
  });

  it('never holds more than its pool, and drops nothing past the blast', () => {
    const { timeline, slot, puffs, ages } = run();
    expect(timeline.trailPuffsInto(slot, 209.9, puffs, ages)).toBeLessThanOrEqual(
      CANNON_TRAIL_PUFFS,
    );
    const landedAt = timeline.trailPuffsInto(slot, 210, puffs, ages);
    const later = timeline.trailPuffsInto(slot, 216, puffs, ages);
    expect(later).toBeLessThan(landedAt);
    expect(Math.hypot(puffs[0].x - 30, puffs[0].z - 40)).toBeLessThan(0.2);
  });
});

describe('cannon scorch fade', () => {
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
  it('chars the inner half dark, nothing at the rim, a little more in blue', () => {
    const size = 64;
    const texels = cannonScorchTexels(size);
    expect(texels).toHaveLength(size * size * 4);
    const at = (i: number, j: number) => (j * size + i) * 4;
    const blue = (i: number, j: number) => texels[at(i, j) + 2] / 255;
    // Dark enough to survive tone mapping at a grazing 40 yd: the old mark
    // peaked at 0.43 at its very centre and was gone by half its radius.
    expect(blue(size / 2, size / 2)).toBeGreaterThan(0.6);
    const half = [
      blue(size / 2 + size / 8, size / 2),
      blue(size / 2 - size / 8, size / 2),
      blue(size / 2, size / 2 + size / 8),
      blue(size / 2, size / 2 - size / 8),
    ];
    expect(Math.min(...half)).toBeGreaterThan(0.5);
    const centre = at(size / 2, size / 2);
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

  it('drapes every vertex over bumpy ground instead of burying a flat plane in it', () => {
    // The test site's ground: a 0.15 yd bulge within 2 yd of the blast, which
    // swallowed most of the old flat mark (centre height plus a lift).
    const ground = (x: number, z: number) => 1 + 0.15 * Math.cos(x * 0.8) * Math.cos(z * 0.8);
    const out = new Float32Array(CANNON_SCORCH_VERTS * 3 + 6);
    cannonScorchDrapeInto(out, 3, 10, -4, 0.7, 2.7, 0.06, ground);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(0);
    let spanX = 0;
    for (let v = 0; v < CANNON_SCORCH_VERTS; v++) {
      const x = out[3 + v * 3];
      const y = out[3 + v * 3 + 1];
      const z = out[3 + v * 3 + 2];
      expect(y).toBeCloseTo(ground(x, z) + 0.06, 5);
      spanX = Math.max(spanX, Math.hypot(x - 10, z + 4));
    }
    // A square 2.7 yd from its centre each way, turned: its corners reach 2.7 * sqrt 2.
    expect(spanX).toBeCloseTo(2.7 * Math.SQRT2, 4);
    const grid = CANNON_SCORCH_GRID;
    const mid = (grid / 2) * (grid + 1) + grid / 2;
    expect(out[3 + mid * 3]).toBeCloseTo(10, 9);
    expect(out[3 + mid * 3 + 2]).toBeCloseTo(-4, 9);
  });

  it('stacks a soil sheet under canopy sheets that darken less', () => {
    expect(CANNON_SCORCH_LAYERS[0]).toEqual({ lift: 0.06, strength: 1 });
    for (let i = 1; i < CANNON_SCORCH_LAYERS.length; i++) {
      expect(CANNON_SCORCH_LAYERS[i].lift).toBeGreaterThan(CANNON_SCORCH_LAYERS[i - 1].lift);
      expect(CANNON_SCORCH_LAYERS[i].strength).toBeLessThan(CANNON_SCORCH_LAYERS[i - 1].strength);
    }
  });
});

describe('cannon shot timeline pools', () => {
  it('reuses its fixed pools round robin, starts a blast, chunks and a scorch per impact, and clears', () => {
    const timeline = new CannonShotTimeline();
    for (let i = 1; i <= CANNON_SHELL_POOL + 1; i++) {
      timeline.fired({ ...shot, shotId: i }, muzzle, axis, i, i % 2 ? FULL.smoke : 2);
    }
    expect(timeline.shells.map((s) => s.shotId)).toEqual([5, 2, 3, 4]);
    for (let i = 1; i <= CANNON_SCORCH_POOL + 1; i++) {
      timeline.impact(
        { shotId: i, x: i, y: 0, z: 0 },
        i,
        cannonShotCounts(i % 2 === 0),
        6,
        1,
        flat,
      );
    }
    expect(timeline.impacts).toHaveLength(CANNON_IMPACT_POOL);
    expect(timeline.impacts.every((s) => s.active)).toBe(true);
    expect(timeline.impacts.map((s) => s.chunkCount).sort()).toEqual([12, 12, 12, 5, 5, 5]);
    const low = cannonShotCounts(true);
    expect(timeline.impacts.map((s) => s.puffCount).sort()).toEqual(
      [
        ...Array(3).fill(CANNON_BLAST_FIXED_PUFFS + FULL.dust + FULL.dirt + FULL.sparks),
        ...Array(3).fill(CANNON_BLAST_FIXED_PUFFS + low.dust + low.dirt + low.sparks),
      ].sort(),
    );
    expect(timeline.muzzles.every((m) => m.active)).toBe(true);
    expect(timeline.muzzles.map((m) => m.at)).toEqual([5, 2, 3, 4]);
    expect(timeline.scorches.map((s) => s.x)).toEqual([
      19, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(timeline.lastScorch).toBe(0);
    timeline.clear();
    expect(timeline.shells.every((s) => s.shotId === 0)).toBe(true);
    expect(timeline.impacts.every((s) => !s.active)).toBe(true);
    expect(timeline.muzzles.every((m) => !m.active)).toBe(true);
    expect(timeline.scorches.every((s) => !s.active)).toBe(true);
    expect(timeline.muzzleAt).toBe(Number.NEGATIVE_INFINITY);
    expect(timeline.lastScorch).toBe(-1);
  });
});
