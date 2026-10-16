import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BUILDING_PREVIEW_LIMIT,
  BuildingPreview,
  buildingSurfaceSide,
} from '../src/editor/3d/building_preview';
import { MAX_BUILDING_GESTURE_PLACEMENTS } from '../src/editor/building_core';
import { cmBox } from '../src/editor/cm_mesh';
import { type MapPlacement, MODEL_ASSET_ID } from '../src/sim/map_doc';

const placement = (overrides: Partial<MapPlacement> = {}): MapPlacement => ({
  assetId: 'tidehold_parts/wall',
  x: 10,
  z: 20,
  rotY: 0,
  scale: 1,
  collide: true,
  ...overrides,
});

describe('building viewport preview', () => {
  it('fits normalized kit bounds and authored axis scale above a detached floor', () => {
    const material = new THREE.MeshBasicMaterial();
    const preview = new BuildingPreview(material);
    const ground = vi.fn(() => -20);
    preview.update(
      [placement({ detached: true, groundY: 12, y: 1, scale: 2, scaleX: 3, rotY: Math.PI / 2 })],
      ground,
      () => ({ sizeX: 4, sizeY: 3, sizeZ: 0.5 }),
    );
    const mesh = preview.group.children[0] as THREE.Mesh;
    expect(mesh.position.toArray()).toEqual([10, 16, 20]);
    expect(mesh.scale.toArray()).toEqual([24, 6, 1]);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(mesh.material).toBe(material);
    expect(ground).not.toHaveBeenCalled();
    preview.dispose();
    material.dispose();
  });

  it('keeps procedural floor slabs below their walk surface, including negative local Y', () => {
    const material = new THREE.MeshBasicMaterial();
    const preview = new BuildingPreview(material);
    preview.update(
      [
        placement({
          assetId: MODEL_ASSET_ID,
          detached: true,
          groundY: 8,
          meshes: [cmBox(2, 0.1, 3, -0.1)],
        }),
      ],
      () => 0,
    );
    preview.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(preview.group);
    expect(bounds.max.y).toBeCloseTo(8);
    expect(bounds.min.y).toBeCloseTo(7.8);
    expect(bounds.min.x).toBeCloseTo(8);
    expect(bounds.max.z).toBeCloseTo(23);
    preview.dispose();
    material.dispose();
  });

  it('caps long runs, reuses geometry and meshes, and clears all visible preview pieces', () => {
    expect(BUILDING_PREVIEW_LIMIT).toBe(256);
    expect(MAX_BUILDING_GESTURE_PLACEMENTS).toBe(256);
    const material = new THREE.MeshBasicMaterial();
    const preview = new BuildingPreview(material);
    const placements = Array.from({ length: BUILDING_PREVIEW_LIMIT + 20 }, (_, i) =>
      placement({ x: i }),
    );
    preview.update(placements, () => 2);
    expect(preview.group.children).toHaveLength(BUILDING_PREVIEW_LIMIT);
    const first = preview.group.children[0] as THREE.Mesh;
    const geometry = first.geometry;
    expect(
      preview.group.children.every((child) => (child as THREE.Mesh).geometry === geometry),
    ).toBe(true);
    preview.update([placement({ x: 34 })], () => 3);
    expect(preview.group.children[0]).toBe(first);
    expect(first.position.x).toBe(34);
    expect(preview.group.children.filter((child) => child.visible)).toHaveLength(1);
    preview.update([], () => 0);
    expect(preview.group.children.every((child) => !child.visible)).toBe(true);
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    geometry.addEventListener('dispose', geometryDisposed);
    material.addEventListener('dispose', materialDisposed);
    const scene = new THREE.Scene();
    scene.add(preview.group);
    preview.dispose();
    preview.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    preview.update(placements, () => 0);
    expect(preview.group.children).toHaveLength(0);
    material.dispose();
  });
});

describe('building wall finish side picking', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'keeps front and back stable after yaw %s',
    (rotY) => {
      const p = placement({ rotY });
      const outward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      expect(buildingSurfaceSide(p, outward.clone().negate())).toBe('front');
      expect(buildingSurfaceSide(p, outward)).toBe('back');
    },
  );

  it('uses the full authored rotation for tilted wall pieces', () => {
    const p = placement({ rotX: 0.7, rotY: 1.2, rotZ: -0.3 });
    const outward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(p.rotX, p.rotY, p.rotZ));
    expect(buildingSurfaceSide(p, outward.clone().negate())).toBe('front');
    expect(buildingSurfaceSide(p, outward)).toBe('back');
  });

  it.each([0, Math.PI / 2, 1.2])(
    'picks opposite broad sides of a long-Z kit wall after yaw %s',
    (rotY) => {
      const p = placement({
        rotY,
        building: { id: 'castle', level: 0, kind: 'wall', wallAxis: 'x' },
      });
      const outward = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      expect(buildingSurfaceSide(p, outward.clone().negate())).toBe('front');
      expect(buildingSurfaceSide(p, outward)).toBe('back');
    },
  );
});
