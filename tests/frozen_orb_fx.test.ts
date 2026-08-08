import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FrozenOrbFx } from '../src/render/frozen_orb_fx';

interface OrbInternals {
  shellMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshBasicMaterial;
  shardMat: THREE.MeshStandardMaterial;
  trailMat: THREE.PointsMaterial;
}

function orbs(fx: FrozenOrbFx): OrbInternals[] {
  return (fx as unknown as { orbs: OrbInternals[] }).orbs;
}

describe('Frozen Orb visual', () => {
  it("reuses a released orb's materials for the next spawn and resets its faded opacity", () => {
    const scene = new THREE.Scene();
    const fx = new FrozenOrbFx(scene, () => 0);
    fx.spawn({ sourceId: 1, x: 0, z: 0, dirX: 1, dirZ: 0, speed: 5, duration: 1 });
    const [orb1] = orbs(fx);
    const shellMat1 = orb1.shellMat;
    const coreMat1 = orb1.coreMat;
    const shardMat1 = orb1.shardMat;
    const trailMat1 = orb1.trailMat;

    // Run the flight almost to the end of its life so the end-of-life fade
    // has driven the shell's opacity close to zero before it is released.
    fx.update(0.97);
    expect(shellMat1.opacity).toBeLessThan(0.05);
    fx.update(0.05); // crosses duration: removes the orb, releasing its materials
    expect(orbs(fx).length).toBe(0);

    fx.spawn({ sourceId: 2, x: 10, z: 10, dirX: 0, dirZ: 1, speed: 5, duration: 1 });
    const [orb2] = orbs(fx);

    // The pooled material objects come back, not freshly allocated ones.
    expect(orb2.shellMat).toBe(shellMat1);
    expect(orb2.coreMat).toBe(coreMat1);
    expect(orb2.shardMat).toBe(shardMat1);
    expect(orb2.trailMat).toBe(trailMat1);

    // A brand-new FrozenOrbFx (no pool involved at all) spawning the
    // identical orb is the ground truth for a freshly allocated material's
    // starting opacity; the pooled reuse above must match it exactly.
    const freshScene = new THREE.Scene();
    const freshFx = new FrozenOrbFx(freshScene, () => 0);
    freshFx.spawn({ sourceId: 9, x: 10, z: 10, dirX: 0, dirZ: 1, speed: 5, duration: 1 });
    const [freshOrb] = orbs(freshFx);

    expect(orb2.shellMat.opacity).toBeCloseTo(freshOrb.shellMat.opacity, 10);
    expect(orb2.coreMat.opacity).toBeCloseTo(freshOrb.coreMat.opacity, 10);
    expect(orb2.shardMat.opacity).toBeCloseTo(freshOrb.shardMat.opacity, 10);
    expect(orb2.trailMat.opacity).toBeCloseTo(freshOrb.trailMat.opacity, 10);
  });

  it('bounds each material pool at a fixed cap and reuses only the pooled survivors', () => {
    const scene = new THREE.Scene();
    const fx = new FrozenOrbFx(scene, () => 0);
    const CAP = 32;
    const OVERFLOW = 5;
    const duration = 1;
    for (let i = 0; i < CAP + OVERFLOW; i++) {
      fx.spawn({ sourceId: i, x: i, z: 0, dirX: 1, dirZ: 0, speed: 1, duration });
    }
    const firstBatch = orbs(fx).map((o) => o.shellMat);
    expect(firstBatch.length).toBe(CAP + OVERFLOW);
    const disposed = new Set<THREE.MeshStandardMaterial>();
    for (const mat of firstBatch) mat.addEventListener('dispose', () => disposed.add(mat));

    // Every orb shares the same duration and started at the same instant, so
    // one update past that duration removes all of them in a single pass.
    fx.update(duration + 0.01);
    expect(orbs(fx).length).toBe(0);
    // Only the excess over the cap is really disposed; the rest is pooled.
    expect(disposed.size).toBe(OVERFLOW);
    const pooled = new Set(firstBatch.filter((mat) => !disposed.has(mat)));
    expect(pooled.size).toBe(CAP);

    for (let i = 0; i < CAP; i++) {
      fx.spawn({ sourceId: 1000 + i, x: i, z: 50, dirX: 1, dirZ: 0, speed: 1, duration: 10 });
    }
    const secondBatch = orbs(fx).map((o) => o.shellMat);
    expect(secondBatch.length).toBe(CAP);
    // Every one of the CAP new orbs drew its shell material from the
    // surviving pool: no fresh allocation past the cap.
    for (const mat of secondBatch) expect(pooled.has(mat)).toBe(true);
  });
});
