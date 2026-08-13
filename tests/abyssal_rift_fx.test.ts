import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbyssalRiftFx } from '../src/render/abyssal_rift_fx';

describe('Abyssal Rift persistent singularity', () => {
  it('drapes the full eight-yard void field and visibly pulls its wisps inward', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.04 + Math.sin(z * 0.2) * 0.3;
    const fx = new AbyssalRiftFx(scene, heightAt);

    fx.spawn({ x: 6, z: 11, radius: 8, duration: 2.2 });

    const group = scene.getObjectByName('abyssal-rift') as THREE.Group;
    const field = group.getObjectByName('abyssal-rift-field') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const rim = group.getObjectByName('abyssal-rift-rim') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const wisps = group.getObjectByName('abyssal-rift-inward-wisps') as THREE.Points;
    const column = group.getObjectByName('abyssal-rift-column') as THREE.Mesh;

    expect(group).toBeInstanceOf(THREE.Group);
    expect(field).toBeInstanceOf(THREE.Mesh);
    expect(rim).toBeInstanceOf(THREE.Mesh);
    expect(wisps).toBeInstanceOf(THREE.Points);
    expect(column).toBeInstanceOf(THREE.Mesh);

    const fieldPositions = field.geometry.getAttribute('position') as THREE.BufferAttribute;
    let outerRadius = 0;
    for (let vertex = 0; vertex < fieldPositions.count; vertex++) {
      const x = fieldPositions.getX(vertex);
      const z = fieldPositions.getZ(vertex);
      expect(fieldPositions.getY(vertex)).toBeCloseTo(heightAt(x, z) + 0.055, 4);
      outerRadius = Math.max(outerRadius, Math.hypot(x - 6, z - 11));
    }
    expect(outerRadius).toBeCloseTo(8, 4);

    const positions = wisps.geometry.getAttribute('position') as THREE.BufferAttribute;
    const beforeRadius = Math.hypot(positions.getX(0) - 6, positions.getZ(0) - 11);
    fx.update(0.25);
    const afterRadius = Math.hypot(positions.getX(0) - 6, positions.getZ(0) - 11);
    expect(afterRadius).toBeLessThan(beforeRadius);
    expect(column.scale.x).not.toBe(1);
  });

  it('keeps the field static under reduced motion and disposes every resource on expiry', () => {
    const scene = new THREE.Scene();
    const fx = new AbyssalRiftFx(scene, () => 0);
    fx.spawn({ x: 2, z: 3, radius: 8, duration: 0.5 });
    const group = scene.getObjectByName('abyssal-rift') as THREE.Group;
    const wisps = group.getObjectByName('abyssal-rift-inward-wisps') as THREE.Points;
    const spiral = group.getObjectByName('abyssal-rift-spiral') as THREE.LineSegments;
    const column = group.getObjectByName('abyssal-rift-column') as THREE.Mesh;
    const core = group.getObjectByName('abyssal-rift-core') as THREE.Mesh;
    const halo = group.getObjectByName('abyssal-rift-halo') as THREE.Mesh;
    const beforeWisps = (
      wisps.geometry.getAttribute('position') as THREE.BufferAttribute
    ).array.slice();
    const beforeSpiral = (
      spiral.geometry.getAttribute('position') as THREE.BufferAttribute
    ).array.slice();
    const beforeColumnScale = column.scale.clone();
    const beforeColumnRotation = [column.rotation.x, column.rotation.y, column.rotation.z];
    const beforeCoreScale = core.scale.clone();
    const beforeHaloScale = halo.scale.clone();
    const beforeHaloRotation = [halo.rotation.x, halo.rotation.y, halo.rotation.z];

    fx.update(0.2, true);
    expect(
      Array.from((wisps.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(Array.from(beforeWisps));
    expect(
      Array.from((spiral.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(Array.from(beforeSpiral));
    expect(column.scale).toEqual(beforeColumnScale);
    expect([column.rotation.x, column.rotation.y, column.rotation.z]).toEqual(beforeColumnRotation);
    expect(core.scale).toEqual(beforeCoreScale);
    expect(halo.scale).toEqual(beforeHaloScale);
    expect([halo.rotation.x, halo.rotation.y, halo.rotation.z]).toEqual(beforeHaloRotation);

    const disposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      disposeSpies.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        disposeSpies.push(vi.spyOn(material, 'dispose'));
      }
    });

    fx.update(0.31, true);
    expect(scene.getObjectByName('abyssal-rift')).toBeUndefined();
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledOnce();
  });

  it('degrades ornaments with the adaptive VFX budget while preserving the area rim', () => {
    const scene = new THREE.Scene();
    const heightAt = vi.fn(() => 0);
    const fx = new AbyssalRiftFx(scene, heightAt);
    fx.setQuality(0);
    fx.spawn({ x: 0, z: 0, radius: 8 });
    const group = scene.getObjectByName('abyssal-rift') as THREE.Group;
    const field = group.getObjectByName('abyssal-rift-field') as THREE.Mesh;
    const rim = group.getObjectByName('abyssal-rift-rim') as THREE.Mesh;
    const core = group.getObjectByName('abyssal-rift-core') as THREE.Mesh;
    const column = group.getObjectByName('abyssal-rift-column') as THREE.Mesh;
    const halo = group.getObjectByName('abyssal-rift-halo') as THREE.Mesh;
    const wisps = group.getObjectByName('abyssal-rift-inward-wisps') as THREE.Points;
    const spiral = group.getObjectByName('abyssal-rift-spiral') as THREE.LineSegments;

    expect(field.visible).toBe(true);
    expect(rim.visible).toBe(true);
    expect(core.visible).toBe(true);
    expect(column.visible).toBe(false);
    expect(halo.visible).toBe(false);
    expect(wisps.visible).toBe(false);
    expect(spiral.visible).toBe(false);
    const groundSamplesAfterSpawn = heightAt.mock.calls.length;
    fx.update(0.1);
    expect(heightAt).toHaveBeenCalledTimes(groundSamplesAfterSpawn);

    fx.setQuality(1);
    expect(column.visible).toBe(true);
    expect(halo.visible).toBe(true);
    expect(wisps.visible).toBe(true);
    expect(spiral.visible).toBe(true);
    expect(wisps.geometry.drawRange.count).toBe(40);
    expect(spiral.geometry.drawRange.count).toBe(96);
  });

  it('disposes active rifts and their shared particle texture on teardown', () => {
    const scene = new THREE.Scene();
    const fx = new AbyssalRiftFx(scene, () => 0);
    fx.spawn({ x: 2, z: 3, radius: 8 });
    const group = scene.getObjectByName('abyssal-rift') as THREE.Group;
    const wisps = group.getObjectByName('abyssal-rift-inward-wisps') as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    const textureDispose = vi.spyOn(wisps.material.map as THREE.Texture, 'dispose');
    const resourceDispose: ReturnType<typeof vi.spyOn>[] = [];
    group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      resourceDispose.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        resourceDispose.push(vi.spyOn(material, 'dispose'));
      }
    });

    fx.dispose();

    expect(scene.getObjectByName('abyssal-rift')).toBeUndefined();
    expect(textureDispose).toHaveBeenCalledOnce();
    for (const spy of resourceDispose) expect(spy).toHaveBeenCalledOnce();
  });

  it('evicts and disposes the oldest visual when the four-rift cap is exceeded', () => {
    const scene = new THREE.Scene();
    const fx = new AbyssalRiftFx(scene, () => 0);
    fx.spawn({ x: 0, z: 0, radius: 8 });
    const oldest = scene.children[0] as THREE.Group;
    const resourceDispose: ReturnType<typeof vi.spyOn>[] = [];
    oldest.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments | THREE.Points;
      if (!renderable.geometry || !renderable.material) return;
      resourceDispose.push(vi.spyOn(renderable.geometry, 'dispose'));
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        resourceDispose.push(vi.spyOn(material, 'dispose'));
      }
    });

    for (let index = 1; index <= 4; index++) fx.spawn({ x: index * 3, z: 0, radius: 8 });

    expect(scene.children).toHaveLength(4);
    expect(scene.children).not.toContain(oldest);
    for (const spy of resourceDispose) expect(spy).toHaveBeenCalledOnce();
  });
});
