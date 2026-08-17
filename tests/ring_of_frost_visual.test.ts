import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RingOfFrostVisuals } from '../src/render/ring_of_frost_visual';

describe('Ring of Frost visual', () => {
  it('drapes both danger edges onto terrain and fills them with ice shards', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number =>
      Math.sin(x * 0.27) * 0.8 + Math.cos(z * 0.31) * 0.6;
    const visuals = new RingOfFrostVisuals(scene, heightAt);

    visuals.spawn({ x: 10, z: 20, radius: 6, innerRadius: 4.5, duration: 10 });

    const root = scene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    const outer = root.getObjectByName('ring-of-frost-outer-edge') as THREE.LineLoop;
    const inner = root.getObjectByName('ring-of-frost-inner-edge') as THREE.LineLoop;
    const band = root.getObjectByName('ring-of-frost-band') as THREE.Mesh;
    const shards = root.getObjectByName('ring-of-frost-shards') as THREE.InstancedMesh;
    const motes = root.getObjectByName('ring-of-frost-motes') as THREE.Points;

    expect(band).toBeInstanceOf(THREE.Mesh);
    expect(shards.count).toBeGreaterThanOrEqual(24);
    expect(motes).toBeInstanceOf(THREE.Points);
    const bandPositions = band.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bandPositions.count; i++) {
      const x = bandPositions.getX(i);
      const y = bandPositions.getY(i);
      const z = bandPositions.getZ(i);
      const radius = Math.hypot(x - 10, z - 20);
      expect(Math.abs(radius - 4.5) < 0.0001 || Math.abs(radius - 6) < 0.0001).toBe(true);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.055, 4);
    }
    const motePositions = motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < motePositions.count; i++) {
      const x = motePositions.getX(i);
      const y = motePositions.getY(i);
      const z = motePositions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeGreaterThanOrEqual(4.5);
      expect(Math.hypot(x - 10, z - 20)).toBeLessThanOrEqual(6);
      expect(y).toBeGreaterThan(heightAt(x, z));
    }
    for (const [line, radius] of [
      [outer, 6],
      [inner, 4.5],
    ] as const) {
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(radius, 4);
        expect(y).toBeCloseTo(heightAt(x, z) + 0.08, 4);
      }
    }
  });

  it('grows in, remains for its full lifetime, and disposes every per-ring resource except pooled materials', () => {
    const scene = new THREE.Scene();
    const visuals = new RingOfFrostVisuals(scene, () => 2);
    visuals.spawn({ x: 3, z: 7, radius: 6, innerRadius: 4.5, duration: 10 });
    const root = scene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    const shards = root.getObjectByName('ring-of-frost-shards') as THREE.InstancedMesh;
    const outer = root.getObjectByName('ring-of-frost-outer-edge') as THREE.LineLoop;
    const startOpacity = (outer.material as THREE.LineBasicMaterial).opacity;
    expect(startOpacity).toBeGreaterThan(0.5);
    const disposedMaterials = new Set<THREE.Material>();
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    root.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Line | THREE.Points;
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const material of materials) {
          material.addEventListener('dispose', () => disposedMaterials.add(material));
        }
      }
      if (renderable.geometry && object !== shards) {
        renderable.geometry.addEventListener('dispose', () =>
          disposedGeometries.add(renderable.geometry),
        );
      }
    });
    let instancesDisposed = false;
    let sharedGeometryDisposed = false;
    shards.addEventListener('dispose', () => {
      instancesDisposed = true;
    });
    shards.geometry.addEventListener('dispose', () => {
      sharedGeometryDisposed = true;
    });

    visuals.update(0.3);
    expect((outer.material as THREE.LineBasicMaterial).opacity).toBeGreaterThan(0.5);
    visuals.update(9);
    expect(scene.getObjectByName('ring-of-frost-fx')).toBe(root);
    expect((outer.material as THREE.LineBasicMaterial).opacity).toBeGreaterThan(0.5);
    visuals.update(0.7);

    expect(scene.getObjectByName('ring-of-frost-fx')).toBeUndefined();
    // Per-ring geometries and the InstancedMesh instance buffer still dispose
    // on expiry exactly as before; materials do NOT (they return to a pool
    // for the next ring instead, see the reuse test below).
    expect(disposedMaterials.size).toBe(0);
    expect(disposedGeometries.size).toBeGreaterThanOrEqual(4);
    expect(instancesDisposed).toBe(true);
    expect(sharedGeometryDisposed).toBe(false);
    visuals.dispose();
    // A full teardown drains every pool, so the ring's materials are
    // eventually disposed too, just not on the ring's own expiry.
    expect(disposedMaterials.size).toBeGreaterThanOrEqual(5);
    expect(sharedGeometryDisposed).toBe(true);
  });

  it('reuses a released ring materials for the next spawn and resets its faded opacity', () => {
    const scene = new THREE.Scene();
    const visuals = new RingOfFrostVisuals(scene, () => 0);
    visuals.spawn({ x: 0, z: 0, radius: 6, innerRadius: 4.5, duration: 1 });
    const root1 = scene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    const outer1 = root1.getObjectByName('ring-of-frost-outer-edge') as THREE.LineLoop;
    const band1 = root1.getObjectByName('ring-of-frost-band') as THREE.Mesh;
    const outerMat1 = outer1.material as THREE.LineBasicMaterial;
    const bandMat1 = band1.material as THREE.MeshBasicMaterial;

    // Run the ring almost to the end of its life so the band's fade-out
    // has driven its opacity close to zero before it is released.
    visuals.update(0.9);
    expect(bandMat1.opacity).toBeLessThan(0.05);
    visuals.update(0.15); // crosses duration: releases into the pool
    expect(scene.getObjectByName('ring-of-frost-fx')).toBeUndefined();

    visuals.spawn({ x: 10, z: 10, radius: 6, innerRadius: 4.5, duration: 1 });
    const root2 = scene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    const outer2 = root2.getObjectByName('ring-of-frost-outer-edge') as THREE.LineLoop;
    const band2 = root2.getObjectByName('ring-of-frost-band') as THREE.Mesh;

    // The pooled material object comes back, not a freshly allocated one...
    expect(outer2.material).toBe(outerMat1);
    expect(band2.material).toBe(bandMat1);

    // ...and its opacity is reset to a fresh spawn's starting value, not
    // left at the stale, nearly-invisible value it faded to before release.
    // The ground truth for "a fresh spawn's starting value" is a brand-new
    // RingOfFrostVisuals that never touches a pool at all.
    const freshScene = new THREE.Scene();
    const freshVisuals = new RingOfFrostVisuals(freshScene, () => 0);
    freshVisuals.spawn({ x: 10, z: 10, radius: 6, innerRadius: 4.5, duration: 1 });
    const freshRoot = freshScene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    const freshOuter = freshRoot.getObjectByName('ring-of-frost-outer-edge') as THREE.LineLoop;
    const freshBand = freshRoot.getObjectByName('ring-of-frost-band') as THREE.Mesh;

    expect((outer2.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(
      (freshOuter.material as THREE.LineBasicMaterial).opacity,
      10,
    );
    expect((band2.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(
      (freshBand.material as THREE.MeshBasicMaterial).opacity,
      10,
    );

    visuals.dispose();
    freshVisuals.dispose();
  });

  it('bounds each material pool at a fixed cap and reuses only the pooled survivors', () => {
    const scene = new THREE.Scene();
    const visuals = new RingOfFrostVisuals(scene, () => 0);
    const CAP = 32;
    const OVERFLOW = 5;
    const duration = 1;
    for (let i = 0; i < CAP + OVERFLOW; i++) {
      visuals.spawn({ x: i, z: 0, radius: 6, innerRadius: 4.5, duration });
    }

    const collectBandMats = (): THREE.MeshBasicMaterial[] => {
      const mats: THREE.MeshBasicMaterial[] = [];
      scene.traverse((object) => {
        if (object.name === 'ring-of-frost-band') {
          mats.push((object as THREE.Mesh).material as THREE.MeshBasicMaterial);
        }
      });
      return mats;
    };

    const firstBatch = collectBandMats();
    expect(firstBatch.length).toBe(CAP + OVERFLOW);
    const disposed = new Set<THREE.MeshBasicMaterial>();
    for (const mat of firstBatch) mat.addEventListener('dispose', () => disposed.add(mat));

    // Every ring shares the same duration and started at the same instant,
    // so one update past that duration expires all of them in a single pass.
    visuals.update(duration + 0.01);
    expect(scene.children.length).toBe(0);
    // Only the excess over the cap is really disposed; the rest is pooled.
    expect(disposed.size).toBe(OVERFLOW);
    const pooled = new Set(firstBatch.filter((mat) => !disposed.has(mat)));
    expect(pooled.size).toBe(CAP);

    for (let i = 0; i < CAP; i++) {
      visuals.spawn({ x: i, z: 50, radius: 6, innerRadius: 4.5, duration: 10 });
    }
    const secondBatch = collectBandMats();
    expect(secondBatch.length).toBe(CAP);
    // Every one of the CAP new rings drew its band material from the
    // surviving pool: no fresh allocation past the cap.
    for (const mat of secondBatch) expect(pooled.has(mat)).toBe(true);

    visuals.dispose();
  });

  it('reconciles authoritative ids and remaining lifetime without replaying a fresh ring', () => {
    const scene = new THREE.Scene();
    const visuals = new RingOfFrostVisuals(scene, () => 0);
    const active = {
      id: '7:100',
      x: 2,
      z: 4,
      radius: 6,
      innerRadius: 4.5,
      duration: 10,
      remaining: 2,
    };

    visuals.sync([active]);
    const root = scene.getObjectByName('ring-of-frost-fx') as THREE.Group;
    expect(root).toBeDefined();
    const shards = root.getObjectByName('ring-of-frost-shards') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    shards.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.y).toBeGreaterThan(0.2);

    visuals.sync([]);
    expect(scene.getObjectByName('ring-of-frost-fx')).toBeUndefined();
    visuals.dispose();
  });
});
