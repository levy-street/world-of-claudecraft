import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/vfx', () => ({
  SCHOOL_COLORS: { fire: 0xff5a16, frost: 0x72cfff, arcane: 0xa86cff },
}));

import { MageGroundFx } from '../src/render/mage_ground_fx';

describe('Mage meteor visual', () => {
  it('builds an irregular molten rock with a terrain-draped flame telegraph', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number =>
      Math.sin(x * 0.31) * 0.8 + Math.cos(z * 0.27) * 0.55;
    const fx = new MageGroundFx(scene, heightAt, vi.fn());

    fx.spawnMeteor({ x: 10, z: 20, radius: 8, duration: 2 });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const rock = root.getObjectByName('mage-meteor-rock') as THREE.Mesh;
    const cracks = root.getObjectByName('mage-meteor-cracks') as THREE.Group;
    const trail = root.getObjectByName('mage-meteor-trail') as THREE.Group;
    const telegraph = root.getObjectByName('mage-meteor-telegraph') as THREE.Group;
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const innerRing = root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop;
    const veins = root.getObjectByName('mage-meteor-telegraph-veins') as THREE.LineSegments;
    const flames = root.getObjectByName('mage-meteor-telegraph-flames') as THREE.InstancedMesh;

    expect(rock).toBeInstanceOf(THREE.Mesh);
    expect(rock.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect(cracks.children.length).toBeGreaterThanOrEqual(3);
    expect(trail.children.length).toBeGreaterThanOrEqual(2);
    expect(flames.count).toBeGreaterThanOrEqual(12);

    const positions = boundary.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(8, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.08, 4);
    }
    const innerPositions = innerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < innerPositions.count; i++) {
      const x = innerPositions.getX(i);
      const y = innerPositions.getY(i);
      const z = innerPositions.getZ(i);
      expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(8 * 0.62, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.075, 4);
    }
    const veinPositions = veins.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(veinPositions.count).toBeGreaterThan(20);
    for (let i = 0; i < veinPositions.count; i++) {
      const x = veinPositions.getX(i);
      const y = veinPositions.getY(i);
      const z = veinPositions.getZ(i);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.07, 4);
    }
    const flameMatrix = new THREE.Matrix4();
    const flamePosition = new THREE.Vector3();
    for (let i = 0; i < flames.count; i++) {
      flames.getMatrixAt(i, flameMatrix);
      flamePosition.setFromMatrixPosition(flameMatrix);
      expect(flamePosition.y).toBeCloseTo(heightAt(flamePosition.x, flamePosition.z) + 0.46, 4);
    }
    const rockPositions = rock.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minRadius = Number.POSITIVE_INFINITY;
    let maxRadius = 0;
    for (let i = 0; i < rockPositions.count; i++) {
      const radius = Math.hypot(
        rockPositions.getX(i),
        rockPositions.getY(i),
        rockPositions.getZ(i),
      );
      minRadius = Math.min(minRadius, radius);
      maxRadius = Math.max(maxRadius, radius);
    }
    expect(maxRadius - minRadius).toBeGreaterThan(0.12);
    expect(telegraph.parent).toBe(root);
  });

  it('lands on schedule, leaves a fading central fire, then removes every transient mesh', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 3, landed);
    fx.spawnMeteor({ x: 4, z: 7, radius: 8, duration: 2 });

    const root = scene.getObjectByName('mage-meteor-fx') as THREE.Group;
    const boundary = root.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const material = boundary.material as THREE.LineBasicMaterial;
    const initialOpacity = material.opacity;
    const disposedMaterials = new Set<THREE.Material>();
    const disposedGeometries = new Set<THREE.BufferGeometry>();
    root.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Line | THREE.Points;
      if (renderable.material) {
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        for (const ownedMaterial of materials) {
          ownedMaterial.addEventListener('dispose', () => disposedMaterials.add(ownedMaterial));
        }
      }
      if (
        object.name === 'mage-meteor-telegraph-boundary' ||
        object.name === 'mage-meteor-telegraph-inner-ring' ||
        object.name === 'mage-meteor-telegraph-veins' ||
        object.name === 'mage-meteor-trail-embers'
      ) {
        const ownedGeometry = renderable.geometry;
        ownedGeometry.addEventListener('dispose', () => disposedGeometries.add(ownedGeometry));
      }
    });

    fx.update(1.6);
    expect(material.opacity).toBeGreaterThan(initialOpacity);
    expect(landed).not.toHaveBeenCalled();

    fx.update(0.4);
    expect(landed).toHaveBeenCalledWith(4, 7);
    expect(scene.getObjectByName('mage-meteor-fx')).toBe(root);
    expect(material.opacity).toBe(0);
    const impactFireOpacity = (
      root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop<
        THREE.BufferGeometry,
        THREE.LineBasicMaterial
      >
    ).material.opacity;
    expect(impactFireOpacity).toBeGreaterThan(0);

    fx.update(1);
    expect(scene.getObjectByName('mage-meteor-fx')).toBe(root);
    expect(
      (
        root.getObjectByName('mage-meteor-telegraph-inner-ring') as THREE.LineLoop<
          THREE.BufferGeometry,
          THREE.LineBasicMaterial
        >
      ).material.opacity,
    ).toBeLessThan(impactFireOpacity);

    fx.update(1.3);
    expect(scene.getObjectByName('mage-meteor-fx')).toBeUndefined();
    expect(disposedMaterials.size).toBeGreaterThanOrEqual(10);
    expect(disposedGeometries.size).toBe(4);
  });

  it('keeps the Blizzard boundary visible until the zone expires', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 3, vi.fn());
    fx.spawnSnow({ x: 4, z: 7, radius: 7, duration: 6.5 });

    const ring = scene.getObjectByName('mage-blizzard-boundary') as THREE.Mesh<
      THREE.RingGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(ring).toBeInstanceOf(THREE.Mesh);
    const initialOpacity = ring.material.opacity;

    fx.update(5.95);
    expect(ring.material.opacity).toBeGreaterThan(0);
    expect(ring.material.opacity).not.toBe(initialOpacity);

    fx.update(0.54);
    expect(scene.getObjectByName('mage-blizzard-boundary')).toBe(ring);
    expect(ring.material.opacity).toBeGreaterThan(0);

    fx.update(0.01);
    expect(scene.getObjectByName('mage-blizzard-boundary')).toBeUndefined();
  });

  it('drapes Rune of Power over uneven terrain instead of clipping through it', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.08 + Math.sin(z * 0.4) * 0.7;
    const fx = new MageGroundFx(scene, heightAt, vi.fn());

    fx.spawnRune({ x: 10, z: 20, radius: 6, duration: 12 });

    const rune = scene.getObjectByName('mage-rune-power') as THREE.Group;
    expect(rune).toBeInstanceOf(THREE.Group);
    const surfaces = [
      'mage-rune-power-outer-ring',
      'mage-rune-power-inner-ring',
      'mage-rune-power-glow',
      ...Array.from({ length: 4 }, (_, index) => `mage-rune-power-spoke-${index}`),
    ];
    for (const name of surfaces) {
      const surface = rune.getObjectByName(name) as THREE.Mesh;
      expect(surface).toBeInstanceOf(THREE.Mesh);
      const positions = surface.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(y).toBeCloseTo(heightAt(x, z) + 0.08, 4);
      }
    }

    fx.update(12);
    expect(scene.getObjectByName('mage-rune-power')).toBeUndefined();
  });
});
