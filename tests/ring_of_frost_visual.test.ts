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

  it('grows in, remains for its full lifetime, and disposes every owned resource', () => {
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
    expect(disposedMaterials.size).toBeGreaterThanOrEqual(5);
    expect(disposedGeometries.size).toBeGreaterThanOrEqual(4);
    expect(instancesDisposed).toBe(true);
    expect(sharedGeometryDisposed).toBe(false);
    visuals.dispose();
    expect(sharedGeometryDisposed).toBe(true);
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
