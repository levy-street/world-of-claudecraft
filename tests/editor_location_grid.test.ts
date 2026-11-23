import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createLocationGrid,
  createLocationGridMaterial,
  disposeLocationGrids,
} from '../src/editor/3d/location_grid';

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected a location grid');
  return value;
}

describe('named location grid guides', () => {
  it('draws only neutral lines and a border at the existing flat guide height', () => {
    const material = createLocationGridMaterial();
    const bounds = { minX: 10, maxX: 30, minZ: -10, maxZ: 0 };
    const grid = required(createLocationGrid(bounds, 7, material));
    expect(grid.isLineSegments).toBe(true);
    expect((grid as unknown as THREE.Mesh).isMesh).toBeUndefined();
    expect(grid.material).toBe(material);
    expect(grid.position.toArray()).toEqual([20, 7.25, -5]);
    expect(grid.renderOrder).toBe(2);
    expect(material.color.r).toBe(material.color.g);
    expect(material.color.g).toBe(material.color.b);
    expect(material.opacity).toBe(0.4);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    const positions = grid.geometry.getAttribute('position');
    expect(positions.count).toBe(16); // Five vertical + three horizontal lines.
    for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBe(0);
    grid.geometry.computeBoundingBox();
    expect(grid.geometry.boundingBox?.min.toArray()).toEqual([-10, 0, -5]);
    expect(grid.geometry.boundingBox?.max.toArray()).toEqual([10, 0, 5]);
    grid.geometry.dispose();
    material.dispose();
  });

  it('caps huge guides at 64 intervals on each axis without truncating their border', () => {
    const material = createLocationGridMaterial();
    const grid = required(
      createLocationGrid({ minX: -10_000, maxX: 10_000, minZ: -8000, maxZ: 8000 }, 0, material),
    );
    const positions = grid.geometry.getAttribute('position');
    expect(positions.count).toBe(260);
    grid.geometry.computeBoundingBox();
    expect(grid.geometry.boundingBox?.min.toArray()).toEqual([-10_000, 0, -8000]);
    expect(grid.geometry.boundingBox?.max.toArray()).toEqual([10_000, 0, 8000]);
    grid.geometry.dispose();
    material.dispose();
  });

  it('keeps a border for areas smaller than one target grid cell', () => {
    const material = createLocationGridMaterial();
    const grid = required(
      createLocationGrid({ minX: 0, maxX: 2, minZ: 0, maxZ: 1 }, -10, material),
    );
    expect(grid.geometry.getAttribute('position').count).toBe(8);
    expect(grid.position.y).toBe(-9.75);
    grid.geometry.dispose();
    material.dispose();
  });

  it.each([
    { minX: 0, maxX: 0, minZ: 0, maxZ: 3 },
    { minX: 1, maxX: -1, minZ: 0, maxZ: 3 },
    { minX: NaN, maxX: 4, minZ: 0, maxZ: 3 },
    { minX: 0, maxX: 4, minZ: 0, maxZ: Infinity },
  ])('declines invalid location bounds without changing them: %j', (bounds) => {
    const material = createLocationGridMaterial();
    const before = { ...bounds };
    expect(createLocationGrid(bounds, 0, material)).toBeNull();
    expect(bounds).toEqual(before);
    material.dispose();
  });

  it('disposes every old line geometry and detaches the group while preserving its shared material', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const material = createLocationGridMaterial();
    const first = required(createLocationGrid({ minX: 0, maxX: 8, minZ: 0, maxZ: 8 }, 0, material));
    const second = required(
      createLocationGrid({ minX: 8, maxX: 16, minZ: 0, maxZ: 8 }, 0, material),
    );
    group.add(first, second);
    scene.add(group);
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const disposeMaterial = vi.fn();
    first.geometry.addEventListener('dispose', disposeFirst);
    second.geometry.addEventListener('dispose', disposeSecond);
    material.addEventListener('dispose', disposeMaterial);
    expect(disposeLocationGrids(group)).toBeNull();
    expect(group.parent).toBeNull();
    expect(group.children).toHaveLength(0);
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(disposeMaterial).not.toHaveBeenCalled();
    disposeLocationGrids(group);
    expect(disposeFirst).toHaveBeenCalledOnce();
    material.dispose();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});
