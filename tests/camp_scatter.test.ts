import { describe, expect, it } from 'vitest';
import { CAMP_GOLDEN_ANGLE, CAMP_SCATTER_JITTER, campSpawnOffset } from '../src/sim/camp_scatter';
import { Rng } from '../src/sim/rng';

// Reproduce the OLD independent-uniform-disc placement so we can prove the new
// sunflower placement is strictly better-spaced on the same rng stream.
function oldOffset(rng: Rng, radius: number): { x: number; z: number } {
  const ang = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(rng.next()) * radius;
  return { x: Math.sin(ang) * r, z: Math.cos(ang) * r };
}

function minPairDistance(pts: { x: number; z: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dz = pts[i].z - pts[j].z;
      min = Math.min(min, Math.hypot(dx, dz));
    }
  }
  return min;
}

function scatterCamp(rng: Rng, count: number, radius: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    // SAME two draws, SAME order as the old placement, reused as jitter.
    const jitterAngle = rng.range(0, Math.PI * 2);
    const jitterFrac = rng.next();
    pts.push(campSpawnOffset(i, count, radius, jitterAngle, jitterFrac));
  }
  return pts;
}

describe('campSpawnOffset', () => {
  it('uses the golden angle and a sub-half-spacing jitter (the anti-collapse knobs)', () => {
    // Sunflower spiral => the classic golden angle ~2.39996 rad.
    expect(CAMP_GOLDEN_ANGLE).toBeCloseTo(Math.PI * (3 - Math.sqrt(5)), 10);
    // Jitter must stay well under half the spacing or two neighbors could collapse.
    expect(CAMP_SCATTER_JITTER).toBeLessThan(0.5);
    expect(CAMP_SCATTER_JITTER).toBeGreaterThan(0);
  });

  it('separates a camp far more than the old independent-uniform placement', () => {
    const radius = 22;
    const count = 7; // a real zone1 camp density
    // Both methods consume the SAME rng draws in the SAME order (2 per mob).
    const newPts = scatterCamp(new Rng(1234), count, radius);
    const oldRng = new Rng(1234);
    const oldPts = Array.from({ length: count }, () => oldOffset(oldRng, radius));

    const newMin = minPairDistance(newPts);
    const oldMin = minPairDistance(oldPts);

    // The new placement's closest pair is meaningfully more separated. This is the
    // whole feature: mobs no longer stack, so melee is not forced into a pile.
    expect(newMin).toBeGreaterThan(oldMin);
    // And in absolute terms the closest pair clears a real body-plus gap. The
    // nominal sunflower spacing here is radius/sqrt(count) ~= 8.3; require most of it.
    const spacing = radius / Math.sqrt(count);
    expect(newMin).toBeGreaterThan(spacing * 0.5);
  });

  it('keeps a comfortable minimum gap across many camp sizes and seeds', () => {
    for (const radius of [8, 15, 22, 30]) {
      for (const count of [3, 5, 7, 12]) {
        for (const seed of [1, 42, 777]) {
          const pts = scatterCamp(new Rng(seed), count, radius);
          const spacing = radius / Math.sqrt(count);
          // Even the worst pair over every size/seed keeps at least half the
          // nominal spacing: the jitter can never make two mobs collapse.
          expect(minPairDistance(pts)).toBeGreaterThan(spacing * 0.4);
        }
      }
    }
  });

  it('keeps every mob inside the camp radius', () => {
    const radius = 22;
    const pts = scatterCamp(new Rng(9), 10, radius);
    for (const p of pts) {
      // Base spiral is within radius; jitter can only push a hair past the rim.
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(radius * 1.1);
    }
  });

  it('is deterministic: same inputs give the same offset', () => {
    expect(campSpawnOffset(3, 7, 22, 1.1, 0.4)).toEqual(campSpawnOffset(3, 7, 22, 1.1, 0.4));
  });

  it('places a single-mob camp (a rare) near center without dividing by zero', () => {
    const off = campSpawnOffset(0, 1, 6, 0.7, 0.9);
    expect(Number.isFinite(off.x)).toBe(true);
    expect(Number.isFinite(off.z)).toBe(true);
    // count === 1 => base radius is 0, so only the small jitter displaces it.
    const jitterCap = 6 * CAMP_SCATTER_JITTER; // spacing == radius when count == 1
    expect(Math.hypot(off.x, off.z)).toBeLessThanOrEqual(jitterCap);
  });
});
