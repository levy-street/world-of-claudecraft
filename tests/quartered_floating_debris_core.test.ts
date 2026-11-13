import { describe, expect, it } from 'vitest';
import {
  CLOUD_BELOW_MAX,
  CLOUD_BELOW_MIN,
  CLOUD_TEXTURE_SIZE,
  chainLinkY,
  cloudPuffTexels,
  type FloatingIsle,
  ISLE_CHAIN_MAX,
  ISLE_CHAIN_MIN,
  ISLE_GAP,
  ISLE_GROUND_CLEAR,
  ISLE_MODEL_KEYS,
  ISLE_MODELS,
  ISLE_TARGET,
  ISLE_TOP_FAR,
  ISLE_TOP_NEAR,
  ISLE_TRAIL,
  isleWorldPoint,
  LOW_TIER_DEBRIS_SHARE,
  planFloatingIsles,
  shedFloatingIsles,
} from '../src/render/quartered_floating_debris_core';
import { GYRE_PEAK } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';

const finished = (x: number, z: number): number => terrainHeight(x, z, 0);
// A high plateau under the whole trail: every islet must lift to clear it.
const plateau = (): number => 120;

/** Every corner of an islet's turned model box, world yards. */
function corners(isle: FloatingIsle): [number, number, number][] {
  const spec = ISLE_MODELS[isle.model];
  const out: [number, number, number][] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [0, 1]) {
      for (const sz of [-0.5, 0.5]) {
        out.push(isleWorldPoint(isle, [sx * spec.w, sy * spec.h, sz * spec.d]));
      }
    }
  }
  return out;
}

describe('the Quartered Isle floating isles', () => {
  const plan = planFloatingIsles(finished);

  it('hangs a trail of island models north of the Gyre, never over the isle itself', () => {
    expect(plan.isles.length).toBeGreaterThanOrEqual(12);
    expect(plan.isles.length).toBeLessThanOrEqual(ISLE_TARGET);
    for (const isle of plan.isles) {
      expect(ISLE_MODEL_KEYS).toContain(isle.model);
      for (const c of corners(isle)) expect(c[2]).toBeGreaterThan(GYRE_PEAK.z + 40);
      expect(isle.z).toBeLessThanOrEqual(ISLE_TRAIL.endZ + 1);
    }
    // the trail reaches from near the Gyre out to the far distance, in all
    // three cull stretches, and mixes the models
    const zs = plan.isles.map((i) => i.z);
    expect(Math.min(...zs)).toBeLessThan(ISLE_TRAIL.startZ + 40);
    expect(Math.max(...zs)).toBeGreaterThan(ISLE_TRAIL.endZ - 60);
    for (const cluster of ['near', 'mid', 'far']) {
      expect(
        plan.isles.some((i) => i.cluster === cluster),
        cluster,
      ).toBe(true);
    }
    expect(new Set(plan.isles.map((i) => i.model)).size).toBeGreaterThanOrEqual(5);
  });

  it('places one model per islet, scaled so its width is the planned width', () => {
    expect(new Set(plan.isles.map((i) => i.isle)).size).toBe(plan.isles.length);
    for (const isle of plan.isles) {
      const spec = ISLE_MODELS[isle.model];
      expect(isle.scale * Math.max(spec.w, spec.d)).toBeCloseTo(isle.width, 6);
      // the box bounds the plan records are the turned box's
      const ys = corners(isle).map((c) => c[1]);
      expect(Math.min(...ys)).toBeCloseTo(isle.minY, 6);
      expect(Math.max(...ys)).toBeCloseTo(isle.maxY, 6);
      // a small lean only
      expect(Math.abs(isle.tilt)).toBeLessThanOrEqual(0.08 + 1e-9);
    }
  });

  it('levels the slab: its tilted top turns back to face up', () => {
    const base = ISLE_MODELS.slab.base;
    expect(base).toBeDefined();
    const flat = {
      model: 'slab' as const,
      x: 0,
      y: 0,
      z: 0,
      scale: 1,
      yaw: 0,
      tilt: 0,
      tiltAxisYaw: 0,
    };
    // the slab's measured top normal turned by the correction points (near) up
    const n: [number, number, number] = [0.373, 0.819, 0.437];
    const tip = isleWorldPoint(flat, [0, 0, 0]);
    const head = isleWorldPoint(flat, n);
    expect(head[1] - tip[1]).toBeGreaterThan(0.97);
  });

  it('climbs and grows the farther north it hangs, so the far islands read big', () => {
    const sorted = [...plan.isles].sort((a, b) => a.z - b.z);
    const third = Math.floor(sorted.length / 3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const near = sorted.slice(0, third);
    const far = sorted.slice(-third);
    expect(mean(far.map((i) => i.maxY))).toBeGreaterThan(mean(near.map((i) => i.maxY)) + 30);
    expect(mean(far.map((i) => i.width))).toBeGreaterThan(mean(near.map((i) => i.width)) * 1.3);
    // the big far islands read 40 to 70yd across
    const leads = plan.isles.filter((i) => i.cluster === 'far' && !ISLE_MODELS[i.model].filler);
    expect(leads.length).toBeGreaterThan(0);
    for (const i of leads) {
      expect(i.width).toBeGreaterThanOrEqual(40);
      expect(i.width).toBeLessThanOrEqual(70);
    }
    for (const i of plan.isles) {
      expect(i.maxY).toBeGreaterThan(ISLE_TOP_NEAR - 15);
      expect(i.maxY).toBeLessThan(ISLE_TOP_FAR + 20);
    }
  });

  it('keeps sky between islets', () => {
    // wide enough that each island reads alone from the Gyre's summit
    expect(ISLE_GAP).toBeGreaterThanOrEqual(20);
    for (const [k, a] of plan.isles.entries()) {
      for (const b of plan.isles.slice(k + 1)) {
        expect(
          Math.hypot(a.x - b.x, a.z - b.z),
          `islets ${a.isle} and ${b.isle}`,
        ).toBeGreaterThanOrEqual((a.width + b.width) / 2 + ISLE_GAP);
      }
    }
  });

  it('lifts every islet clear of whatever ground is under it', () => {
    for (const [ground, isles] of [
      [finished, plan.isles],
      [plateau, planFloatingIsles(plateau).isles],
    ] as const) {
      for (const isle of isles) {
        for (const c of corners(isle)) {
          expect(c[1]).toBeGreaterThanOrEqual(ground(c[0], c[2]) + ISLE_GROUND_CLEAR - 1e-6);
        }
      }
    }
  });

  it('hangs chains under some islets, straight down, ending loose above the ground', () => {
    expect(plan.chains.length).toBeGreaterThan(0);
    const chained = new Set(plan.chains.map((c) => c.isle));
    expect(chained.size).toBeGreaterThan(plan.isles.length * 0.2);
    expect(chained.size).toBeLessThan(plan.isles.length * 0.7);
    for (const chain of plan.chains) {
      const isle = plan.isles.find((i) => i.isle === chain.isle);
      expect(isle).toBeDefined();
      if (!isle) continue;
      // anchored under the islet's top and inside its reach
      expect(chain.y).toBeLessThan(isle.maxY);
      expect(chain.y).toBeGreaterThan(isle.minY);
      expect(Math.hypot(chain.x - isle.x, chain.z - isle.z)).toBeLessThan(isle.width);
      expect(chain.cluster).toBe(isle.cluster);
      expect(chain.keep).toBe(isle.keep);
      expect(chain.length).toBeLessThanOrEqual(ISLE_CHAIN_MAX);
      expect(chain.length).toBeCloseTo(chain.links * chain.pitch, 6);
      expect(chain.links).toBeGreaterThanOrEqual(4);
      const bottom = chainLinkY(chain, chain.links - 1) - chain.pitch;
      expect(bottom).toBeGreaterThan(finished(chain.x, chain.z) + ISLE_GROUND_CLEAR - chain.pitch);
    }
    // most chains hang their full span out over the sea
    expect(plan.chains.some((c) => c.length >= ISLE_CHAIN_MIN)).toBe(true);
  });

  it('floats a cloud bank under the trail, below the islets and above the ground', () => {
    expect(plan.clouds.length).toBeGreaterThanOrEqual(plan.isles.length);
    for (const puff of plan.clouds) {
      // under the islet nearest it
      const nearest = [...plan.isles].sort(
        (a, b) => Math.hypot(a.x - puff.x, a.z - puff.z) - Math.hypot(b.x - puff.x, b.z - puff.z),
      )[0];
      expect(puff.z).toBeGreaterThan(GYRE_PEAK.z + 40);
      expect(puff.y).toBeLessThanOrEqual(nearest.maxY);
      expect(puff.y - puff.h / 2).toBeGreaterThanOrEqual(
        finished(puff.x, puff.z) + ISLE_GROUND_CLEAR - 1e-6,
      );
      expect(puff.alpha).toBeGreaterThan(0);
      expect(puff.alpha).toBeLessThanOrEqual(1);
    }
    // each islet's own puffs sit the planned band under its lowest point (or
    // lifted clear of the ground)
    const under = plan.clouds.filter((p) =>
      plan.isles.some(
        (i) => i.minY - p.y >= CLOUD_BELOW_MIN - 1e-6 && i.minY - p.y <= CLOUD_BELOW_MAX + 1e-6,
      ),
    );
    expect(under.length).toBeGreaterThan(plan.clouds.length * 0.5);
  });

  it('draws a soft puff texture that fades to nothing at the card edge', () => {
    const tex = cloudPuffTexels(CLOUD_TEXTURE_SIZE);
    const size = CLOUD_TEXTURE_SIZE;
    const alpha = (x: number, y: number) => tex[(y * size + x) * 4 + 3];
    for (let k = 0; k < size; k++) {
      expect(alpha(k, 0)).toBe(0);
      expect(alpha(0, k)).toBe(0);
      expect(alpha(k, size - 1)).toBe(0);
      expect(alpha(size - 1, k)).toBe(0);
    }
    expect(alpha(size / 2, Math.floor(size * 0.55))).toBeGreaterThan(100);
  });

  it('is deterministic', () => {
    expect(planFloatingIsles(finished)).toEqual(plan);
  });

  it('sheds whole islets with their chains on a low tier, and keeps the cloud bank', () => {
    expect(shedFloatingIsles(plan, 1)).toEqual(plan);
    const kept = shedFloatingIsles(plan, LOW_TIER_DEBRIS_SHARE);
    expect(kept.isles.length).toBeLessThan(plan.isles.length);
    expect(kept.isles.length).toBeGreaterThan(0);
    const keptIds = new Set(kept.isles.map((i) => i.isle));
    for (const chain of plan.chains) {
      expect(kept.chains.includes(chain)).toBe(keptIds.has(chain.isle));
    }
    expect(kept.clouds).toEqual(plan.clouds);
  });
});
