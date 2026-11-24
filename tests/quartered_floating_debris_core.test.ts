import { describe, expect, it } from 'vitest';
import {
  CLOUD_BELOW_MAX,
  CLOUD_BELOW_MIN,
  CLOUD_TEXTURE_SIZE,
  CROWN_Y,
  chainLinkY,
  cloudPuffTexels,
  type FloatingIsle,
  ISLE_CHAIN_MAX,
  ISLE_CHAIN_MIN,
  ISLE_GAP,
  ISLE_GROUND_CLEAR,
  ISLE_MODEL_KEYS,
  ISLE_MODELS,
  ISLE_SLOTS,
  isleWorldPoint,
  LOW_TIER_DEBRIS_SHARE,
  planFloatingIsles,
  RAID_ISLE_SLOT,
  RAID_VIEW_CLEAR,
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

  // Seen from the crown looking north: left is +X, right is -X. An islet's
  // bearing (degrees, + to the left) and the half-angle its width subtends.
  const bearing = (i: FloatingIsle) =>
    (Math.atan2(i.x - GYRE_PEAK.x, i.z - GYRE_PEAK.z) * 180) / Math.PI;
  const halfAngle = (i: FloatingIsle) =>
    (Math.atan(i.width / 2 / Math.hypot(i.x - GYRE_PEAK.x, i.z - GYRE_PEAK.z)) * 180) / Math.PI;
  const raid = plan.isles.find((i) => i.model === 'raid');
  const flanks = plan.isles.filter((i) => i.model !== 'raid');

  it('hangs the raid isle in the middle of the view and three islets either side', () => {
    expect(raid).toBeDefined();
    if (!raid) return;
    expect(plan.isles.filter((i) => i.model === 'raid')).toHaveLength(1);
    // due north of the crown, far out over the sea
    expect(Math.abs(bearing(raid))).toBeLessThan(1);
    expect(raid.z - GYRE_PEAK.z).toBeGreaterThan(250);
    const left = flanks.filter((i) => bearing(i) > 0);
    const right = flanks.filter((i) => bearing(i) < 0);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    expect(flanks).toHaveLength(ISLE_SLOTS.length);
    // every islet hangs north of the isle, never over it, and the six flanking
    // islets use all six of the sky models
    for (const isle of plan.isles) {
      expect(ISLE_MODEL_KEYS).toContain(isle.model);
      for (const c of corners(isle)) expect(c[2]).toBeGreaterThan(GYRE_PEAK.z + 40);
    }
    expect(new Set(flanks.map((i) => i.model)).size).toBe(6);
    for (const cluster of ['near', 'mid', 'far']) {
      expect(
        plan.isles.some((i) => i.cluster === cluster),
        cluster,
      ).toBe(true);
    }
  });

  it("keeps the middle of the view the raid isle's alone", () => {
    if (!raid) throw new Error('no raid isle');
    const raidEdge = halfAngle(raid);
    for (const isle of flanks) {
      const inner = Math.abs(bearing(isle)) - halfAngle(isle);
      expect(inner, `islet ${isle.isle} (${isle.model})`).toBeGreaterThanOrEqual(
        raidEdge + RAID_VIEW_CLEAR,
      );
    }
  });

  it('hangs the flanking islets at uneven heights', () => {
    const tops = flanks.map((i) => i.maxY).sort((a, b) => a - b);
    // a wide spread, every islet over the crown, and no two at a like height
    expect(tops[tops.length - 1] - tops[0]).toBeGreaterThan(100);
    expect(tops[0]).toBeGreaterThan(CROWN_Y + 15);
    for (let k = 1; k < tops.length; k++) expect(tops[k] - tops[k - 1]).toBeGreaterThan(10);
    // and each side climbs and dips on its own
    for (const side of [1, -1]) {
      const own = flanks.filter((i) => Math.sign(bearing(i)) === side).map((i) => i.maxY);
      expect(Math.max(...own) - Math.min(...own)).toBeGreaterThan(40);
    }
  });

  it('makes the raid isle the biggest and highest thing in the view, its heart toward the crown', () => {
    if (!raid) throw new Error('no raid isle');
    for (const isle of flanks) expect(raid.width).toBeGreaterThan(isle.width * 1.8);
    expect(raid.maxY).toBeGreaterThan(CROWN_Y + 80);
    // the highest point in the sky: well over every flanking islet's top
    expect(raid.maxY).toBeGreaterThan(Math.max(...flanks.map((i) => i.maxY)) + 15);
    expect(raid.width).toBe(RAID_ISLE_SLOT.width);
    // the heart (the model's +X face) turned to face south, and the top
    // tipped toward the crown (seen from below, its keep still shows)
    const flat = { ...raid, x: 0, y: 0, z: 0, tilt: 0 };
    const heart = isleWorldPoint(flat, [1, 0, 0]);
    expect(heart[2]).toBeLessThan(-0.99 * raid.scale);
    expect(Math.abs(heart[0])).toBeLessThan(1e-6);
    const up = isleWorldPoint({ ...raid, x: 0, y: 0, z: 0 }, [0, 1, 0]);
    expect(up[2]).toBeLessThan(-0.25 * raid.scale);
    expect(Math.abs(up[0])).toBeLessThan(1e-6);
    expect(raid.tilt).toBe(RAID_ISLE_SLOT.lean);
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
      // a small lean only (the raid isle's is its own, tested below)
      if (isle.model !== 'raid') expect(Math.abs(isle.tilt)).toBeLessThanOrEqual(0.08 + 1e-9);
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
    // the raid isle and the broad islets trail chains, the small fillers none
    const chained = new Set(plan.chains.map((c) => c.isle));
    for (const isle of plan.isles) {
      const slot = isle.model === 'raid' ? RAID_ISLE_SLOT : ISLE_SLOTS[isle.isle - 1];
      expect(slot.model).toBe(isle.model);
      expect(chained.has(isle.isle), `islet ${isle.isle} (${isle.model})`).toBe(slot.chains > 0);
    }
    if (!raid) throw new Error('no raid isle');
    const raidChains = plan.chains.filter((c) => c.isle === raid.isle);
    expect(raidChains.length).toBe(RAID_ISLE_SLOT.chains);
    // the raid isle's chains are its own longer run
    expect(Math.max(...raidChains.map((c) => c.length))).toBeGreaterThan(ISLE_CHAIN_MAX);
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
      const cap = isle.model === 'raid' ? RAID_ISLE_SLOT.chainLength[1] : ISLE_CHAIN_MAX;
      expect(chain.length).toBeLessThanOrEqual(cap);
      expect(chain.length).toBeCloseTo(chain.links * chain.pitch, 6);
      expect(chain.links).toBeGreaterThanOrEqual(4);
      const bottom = chainLinkY(chain, chain.links - 1) - chain.pitch;
      expect(bottom).toBeGreaterThan(finished(chain.x, chain.z) + ISLE_GROUND_CLEAR - chain.pitch);
    }
    // most chains hang their full span out over the sea
    expect(plan.chains.some((c) => c.length >= ISLE_CHAIN_MIN)).toBe(true);
  });

  it('floats a cloud bank under the islets, below them and above the ground', () => {
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
    // the raid isle stays on every tier, the small fillers go first, and a
    // broad islet still hangs on each side
    expect(kept.isles.some((i) => i.model === 'raid')).toBe(true);
    for (const filler of ['crag', 'spire'] as const) {
      expect(kept.isles.some((i) => i.model === filler)).toBe(false);
    }
    for (const side of [1, -1]) {
      expect(kept.isles.some((i) => i.model !== 'raid' && Math.sign(bearing(i)) === side)).toBe(
        true,
      );
    }
    const keptIds = new Set(kept.isles.map((i) => i.isle));
    for (const chain of plan.chains) {
      expect(kept.chains.includes(chain)).toBe(keptIds.has(chain.isle));
    }
    expect(kept.clouds).toEqual(plan.clouds);
  });
});
