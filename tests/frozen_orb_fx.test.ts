import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FrozenOrbFx, handleFrozenOrbSpellfxEvent } from '../src/render/frozen_orb_fx';

interface OrbInternals {
  shellMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshBasicMaterial;
  shardMat: THREE.MeshStandardMaterial;
  trailMat: THREE.PointsMaterial;
}

function orbs(fx: FrozenOrbFx): OrbInternals[] {
  return (fx as unknown as { orbs: OrbInternals[] }).orbs;
}

describe('Frostglobe visual', () => {
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

describe('handleFrozenOrbSpellfxEvent (the renderer orb dispatch, moved verbatim)', () => {
  function stub() {
    return { spawn: vi.fn(), halt: vi.fn(), resume: vi.fn() };
  }

  it('routes the three flight moments and applies the release defaults', () => {
    const fx = stub();
    const orb = fx as unknown as FrozenOrbFx;
    expect(handleFrozenOrbSpellfxEvent(orb, { fx: 'orb', x: 3, z: 4, sourceId: 9 })).toBe(true);
    expect(fx.spawn).toHaveBeenCalledWith({
      sourceId: 9,
      x: 3,
      z: 4,
      dirX: 0,
      dirZ: 1,
      speed: 2.5,
      duration: 8,
    });
    expect(
      handleFrozenOrbSpellfxEvent(orb, { fx: 'orb', phase: 'halt', x: 5, z: 6, sourceId: 9 }),
    ).toBe(true);
    expect(fx.halt).toHaveBeenCalledWith(9, 5, 6);
    expect(handleFrozenOrbSpellfxEvent(orb, { fx: 'orb', phase: 'resume', x: 7, z: 8 })).toBe(true);
    // A missing sourceId keys the shared -1 slot, exactly the old inline default.
    expect(fx.resume).toHaveBeenCalledWith(-1, 7, 8);
  });

  it('leaves every non-orb cue unclaimed for the arms behind it', () => {
    const fx = stub();
    const orb = fx as unknown as FrozenOrbFx;
    expect(handleFrozenOrbSpellfxEvent(orb, { fx: 'snowZone', x: 1, z: 2 })).toBe(false);
    expect(handleFrozenOrbSpellfxEvent(orb, { fx: 'burst', x: 1, z: 2 })).toBe(false);
    expect(fx.spawn).not.toHaveBeenCalled();
    expect(fx.halt).not.toHaveBeenCalled();
    expect(fx.resume).not.toHaveBeenCalled();
  });
});

describe('Frostglobe teardown (renderer_resource_lifecycle.ts)', () => {
  it('dispose() removes every live orb, disposes the pooled materials and the shared geometries, and stays reusable', () => {
    const scene = new THREE.Scene();
    const fx = new FrozenOrbFx(scene, () => 0);
    fx.spawn({ sourceId: 1, x: 0, z: 0, dirX: 1, dirZ: 0, speed: 5, duration: 10 });
    fx.spawn({ sourceId: 2, x: 4, z: 4, dirX: 0, dirZ: 1, speed: 5, duration: 10 });
    const [orb1, orb2] = orbs(fx);
    const materials = [
      orb1.shellMat,
      orb1.coreMat,
      orb1.shardMat,
      orb1.trailMat,
      orb2.shellMat,
      orb2.coreMat,
      orb2.shardMat,
      orb2.trailMat,
    ];
    const materialSpies = materials.map((mat) => vi.spyOn(mat, 'dispose'));
    const internals = fx as unknown as {
      shellGeo: THREE.BufferGeometry | null;
      coreGeo: THREE.BufferGeometry | null;
      shardGeo: THREE.BufferGeometry | null;
      shellPool: unknown[];
      corePool: unknown[];
      shardPool: unknown[];
      trailPool: unknown[];
    };
    const geometries = [internals.shellGeo, internals.coreGeo, internals.shardGeo];
    for (const geo of geometries) expect(geo).not.toBeNull();
    const geometrySpies = geometries.map((geo) => vi.spyOn(geo as THREE.BufferGeometry, 'dispose'));
    // Two orbs: a group and a trail each, all in the scene.
    expect(scene.children).toHaveLength(4);

    fx.dispose();

    expect(orbs(fx)).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    // Every material went through the pool on remove and was then disposed
    // ONCE by the pool drain (the pool is emptied, so nothing is reacquired).
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledOnce();
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledOnce();
    for (const pool of [
      internals.shellPool,
      internals.corePool,
      internals.shardPool,
      internals.trailPool,
    ]) {
      expect(pool).toHaveLength(0);
    }
    expect(internals.shellGeo).toBeNull();
    expect(internals.coreGeo).toBeNull();
    expect(internals.shardGeo).toBeNull();

    // Idempotent: a second dispose neither throws nor double-disposes.
    fx.dispose();
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledOnce();
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledOnce();

    // ...and a spawn afterwards rebuilds the geometries lazily, exactly like
    // the first spawn did, with fresh (never the disposed) materials.
    fx.spawn({ sourceId: 3, x: 1, z: 1, dirX: 1, dirZ: 0, speed: 5, duration: 10 });
    const [orb3] = orbs(fx);
    expect(internals.shellGeo).not.toBeNull();
    expect(materials).not.toContain(orb3.shellMat);
    expect(scene.children).toHaveLength(2);
  });
});
