import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFrostIceFields,
  frostIcePreloadInternalsForTest,
  prepareFrostIceParts,
} from '../src/render/frost_ice_fields';
import { planFrostIceSpireSites } from '../src/render/frost_ice_fields_core';
import { terrainHeight } from '../src/sim/world';
import { expectDefined } from './helpers/defined';

afterEach(() => frostIcePreloadInternalsForTest.reset());

function sourceSpire(): THREE.Group {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0xbfe8ff }),
  );
  mesh.position.set(2, 3, -1);
  source.add(mesh);
  return source;
}

describe('modeled Frostveil ice fields', () => {
  it('normalizes a loaded spire without mutating the loader source', () => {
    const source = sourceSpire();
    const original = source.children[0].position.clone();
    const parts = prepareFrostIceParts(source);
    const bounds = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      bounds.union(expectDefined(part.geometry.boundingBox));
    }
    expect(source.children[0].position).toEqual(original);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(
      frostIcePreloadInternalsForTest.targetHeight,
      6,
    );
    expect((bounds.min.x + bounds.max.x) * 0.5).toBeCloseTo(0, 6);
    expect((bounds.min.z + bounds.max.z) * 0.5).toBeCloseTo(0, 6);
  });

  it('expands normalized integer positions before applying shipping scale', () => {
    const source = sourceSpire();
    const mesh = source.children[0] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const scale = Math.max(
      ...Array.from({ length: positions.count }, (_, index) =>
        Math.max(
          Math.abs(positions.getX(index)),
          Math.abs(positions.getY(index)),
          Math.abs(positions.getZ(index)),
        ),
      ),
    );
    const quantized = new Int16Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      quantized[index * 3] = Math.round((positions.getX(index) / scale) * 32_767);
      quantized[index * 3 + 1] = Math.round((positions.getY(index) / scale) * 32_767);
      quantized[index * 3 + 2] = Math.round((positions.getZ(index) / scale) * 32_767);
    }
    mesh.geometry.setAttribute('position', new THREE.Int16BufferAttribute(quantized, 3, true));
    mesh.scale.setScalar(scale);

    const parts = prepareFrostIceParts(source);
    const bounds = new THREE.Box3();
    for (const part of parts) bounds.union(expectDefined(part.geometry.boundingBox));
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(
      frostIcePreloadInternalsForTest.targetHeight,
      3,
    );
    expect(parts[0].geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
  });

  it('instances a modeled body at every accepted deterministic site', () => {
    frostIcePreloadInternalsForTest.installSource(sourceSpire());
    const group = buildFrostIceFields(0);
    const expected = planFrostIceSpireSites((x, z) => terrainHeight(x, z, 0)).length;
    let instances = 0;
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.userData.frostIceSpire) {
        instances += object.count;
      }
    });
    expect(instances).toBe(expected);
    expect(instances).toBeGreaterThan(30);
  });
});
