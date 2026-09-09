import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_PROP_ASSET_DEFS,
  nythraxisPropAsset,
  nythraxisPropAssetInternalsForTest,
  prepareNythraxisPropAsset,
} from '../src/render/nythraxis_prop_assets';

const ROOT = path.resolve(__dirname, '..');

/** A stand-in for a loaded GLB scene: one lit box, offset so normalization has work to do. */
function syntheticSource(width = 2, height = 4, depth = 2): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: 0xd9cfb4, name: 'bone' }),
  );
  mesh.position.set(10, 3, -7);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return group;
}

afterEach(() => {
  nythraxisPropAssetInternalsForTest.reset();
});

describe('Nythraxis prop assets', () => {
  it('point at committed models under public/', () => {
    for (const def of Object.values(NYTHRAXIS_PROP_ASSET_DEFS)) {
      expect(fs.existsSync(path.join(ROOT, 'public', def.url))).toBe(true);
    }
  });

  it('normalizes a model to its target height, foot at y 0, centred on XZ, as a lit surface', () => {
    const asset = prepareNythraxisPropAsset('cage', syntheticSource(2, 4, 2));
    const target = NYTHRAXIS_PROP_ASSET_DEFS.cage.targetHeight;
    expect(asset.parts).toHaveLength(1);
    expect(asset.height).toBeCloseTo(target, 5);
    expect(asset.width).toBeCloseTo(target / 2, 5);
    expect(asset.depth).toBeCloseTo(target / 2, 5);
    const box = asset.parts[0].geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
    const material = asset.parts[0].material;
    expect(
      material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshLambertMaterial,
    ).toBe(true);
    expect((material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd9cfb4);
  });

  it('expands normalized integer attributes before transforming them', () => {
    const geometry = new THREE.BufferGeometry();
    const raw = new Int16Array([
      -32767, -32767, -32767, 32767, -32767, -32767, 32767, 32767, -32767, -32767, 32767, -32767,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(raw, 3, true));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.scale.setScalar(5);
    const group = new THREE.Group();
    group.add(mesh);
    group.updateMatrixWorld(true);
    const asset = prepareNythraxisPropAsset('cage', group);
    expect(asset.parts[0].geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
    expect(asset.height).toBeCloseTo(NYTHRAXIS_PROP_ASSET_DEFS.cage.targetHeight, 5);
  });

  it('rejects a source with no mesh', () => {
    expect(() => prepareNythraxisPropAsset('cage', new THREE.Group())).toThrow(/no mesh/);
  });

  it('is null until a source is installed, then prepares it once and caches', () => {
    expect(nythraxisPropAsset('cage')).toBeNull();
    nythraxisPropAssetInternalsForTest.installSource('cage', syntheticSource());
    const first = nythraxisPropAsset('cage');
    expect(first).not.toBeNull();
    expect(nythraxisPropAsset('cage')).toBe(first);
  });
});
