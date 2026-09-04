import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NYTHRAXIS_FIRE_BRIGHTNESS,
  NYTHRAXIS_PROP_ASSET_DEFS,
  NythraxisFireInstances,
  type NythraxisPropKind,
  nythraxisFireAssetInternalsForTest,
  nythraxisPropAsset,
  prepareNythraxisPropAsset,
} from '../src/render/nythraxis_fire_assets';
import { NYTHRAXIS_FLAME_TONGUE_GEOMETRY } from '../src/render/nythraxis_flame_tongue';
import {
  NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME,
  NythraxisGraveFlameVisuals,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_GRAVEFIRE_TONGUES_NAME,
  NythraxisGravefireVisuals,
} from '../src/render/nythraxis_gravefire_visual';

const ROOT = path.resolve(__dirname, '..');

/** A stand-in for a loaded GLB scene: one lit box, offset so normalization has work to do. */
function syntheticSource(
  width = 2,
  height = 4,
  depth = 2,
  parts = 1,
): { group: THREE.Group; geometries: THREE.BufferGeometry[] } {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  for (let index = 0; index < parts; index++) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometries.push(geometry);
    const material = new THREE.MeshStandardMaterial({ color: 0x40ff80, name: `part${index}` });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(10 + index * width, 3, -7);
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return { group, geometries };
}

afterEach(() => {
  nythraxisFireAssetInternalsForTest.reset();
});

describe('Nythraxis prop asset defs', () => {
  it('point at committed models under public/', () => {
    for (const def of Object.values(NYTHRAXIS_PROP_ASSET_DEFS)) {
      expect(fs.existsSync(path.join(ROOT, 'public', def.url))).toBe(true);
    }
  });

  it('marks the three flames as fire and the cage as a lit prop', () => {
    expect(NYTHRAXIS_PROP_ASSET_DEFS.grave.surface).toBe('fire');
    expect(NYTHRAXIS_PROP_ASSET_DEFS.soul.surface).toBe('fire');
    expect(NYTHRAXIS_PROP_ASSET_DEFS.gravefire.surface).toBe('fire');
    expect(NYTHRAXIS_PROP_ASSET_DEFS.cage.surface).toBe('prop');
  });
});

describe('prepareNythraxisPropAsset', () => {
  it('normalizes a fire model to its target height, foot at y 0, centred on XZ, unlit and saturated', () => {
    const { group } = syntheticSource(2, 4, 2);
    const asset = prepareNythraxisPropAsset('soul', group);
    expect(asset.parts).toHaveLength(1);
    const target = NYTHRAXIS_PROP_ASSET_DEFS.soul.targetHeight;
    expect(asset.height).toBeCloseTo(target, 5);
    expect(asset.width).toBeCloseTo(target / 2, 5);
    expect(asset.depth).toBeCloseTo(target / 2, 5);
    const box = asset.parts[0].geometry.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
    const material = asset.parts[0].material as THREE.MeshBasicMaterial;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    // The albedo is over-driven so it glows unlit: every channel of the
    // authored (linear-space) colour is multiplied by the boost.
    const authored = new THREE.Color(0x40ff80);
    expect(material.color.r).toBeCloseTo(authored.r * NYTHRAXIS_FIRE_BRIGHTNESS, 5);
    expect(material.color.g).toBeCloseTo(authored.g * NYTHRAXIS_FIRE_BRIGHTNESS, 5);
    expect(material.color.b).toBeCloseTo(authored.b * NYTHRAXIS_FIRE_BRIGHTNESS, 5);
  });

  it('keeps the cage a lit surface at its own target height', () => {
    const { group } = syntheticSource(3, 3, 3);
    const asset = prepareNythraxisPropAsset('cage', group);
    expect(asset.height).toBeCloseTo(NYTHRAXIS_PROP_ASSET_DEFS.cage.targetHeight, 5);
    const material = asset.parts[0].material;
    expect(
      material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshLambertMaterial,
    ).toBe(true);
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
    const asset = prepareNythraxisPropAsset('grave', group);
    const attribute = asset.parts[0].geometry.getAttribute('position');
    expect(attribute.array).toBeInstanceOf(Float32Array);
    expect(asset.height).toBeCloseTo(NYTHRAXIS_PROP_ASSET_DEFS.grave.targetHeight, 5);
  });

  it('rejects a source with no mesh', () => {
    expect(() => prepareNythraxisPropAsset('soul', new THREE.Group())).toThrow(/no mesh/);
  });
});

describe('nythraxisPropAsset', () => {
  it('is null until a source is installed, then prepares it once and caches', () => {
    expect(nythraxisPropAsset('soul')).toBeNull();
    const { group } = syntheticSource();
    nythraxisFireAssetInternalsForTest.installSource('soul', group);
    const first = nythraxisPropAsset('soul');
    expect(first).not.toBeNull();
    expect(nythraxisPropAsset('soul')).toBe(first);
    expect(nythraxisPropAsset('grave')).toBeNull();
  });
});

describe('NythraxisFireInstances', () => {
  const fallback = { color: 0xd9b8ff, opacity: 0.75, unitHeight: 1.3 };

  it('draws the procedural tongue while the model is missing', () => {
    const fire = new NythraxisFireInstances('gravefire', 12, fallback, 'fire-test', 15);
    expect(fire.usesAsset).toBe(false);
    expect(fire.meshes).toHaveLength(1);
    expect(fire.meshes[0].geometry).toBe(NYTHRAXIS_FLAME_TONGUE_GEOMETRY);
    expect(fire.meshes[0].count).toBe(12);
    expect(fire.meshes[0].name).toBe('fire-test');
    expect(fire.meshes[0].renderOrder).toBe(15);
    expect(fire.unitHeight).toBe(1.3);
    const material = fire.materials[0] as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xd9b8ff);
    expect(material.opacity).toBe(0.75);
    expect(material.blending).toBe(THREE.AdditiveBlending);
  });

  it('draws one instanced mesh per prepared part, on the shared geometry with cloned materials', () => {
    const { group, geometries } = syntheticSource(2, 4, 2, 2);
    nythraxisFireAssetInternalsForTest.installSource('soul', group);
    const asset = nythraxisPropAsset('soul');
    if (!asset) throw new Error('asset should be prepared');
    const fire = new NythraxisFireInstances('soul', 8, fallback, 'soul-test', 13);
    expect(fire.usesAsset).toBe(true);
    expect(fire.meshes).toHaveLength(2);
    expect(fire.unitHeight).toBeCloseTo(asset.height, 5);
    for (const [index, mesh] of fire.meshes.entries()) {
      expect(mesh.geometry).toBe(asset.parts[index].geometry);
      expect(mesh.material).not.toBe(asset.parts[index].material);
      expect(mesh.count).toBe(8);
    }
    expect(fire.meshes[0].name).toBe('soul-test');
    expect(fire.meshes[1].name).toBe('soul-test-1');
    fire.setOpacity(0.2);
    for (const material of fire.materials) expect(material.opacity).toBe(0.2);

    const matrix = new THREE.Matrix4().makeTranslation(1, 2, 3);
    fire.setMatrixAt(3, matrix);
    fire.commit();
    const read = new THREE.Matrix4();
    for (const mesh of fire.meshes) {
      mesh.getMatrixAt(3, read);
      expect(read.equals(matrix)).toBe(true);
      expect(mesh.instanceMatrix.needsUpdate || mesh.instanceMatrix.version > 0).toBe(true);
    }

    const center = new THREE.Vector3(4, 0, 4);
    fire.setBoundingSphere(center, 9);
    for (const mesh of fire.meshes) {
      expect(mesh.boundingSphere?.center.equals(center)).toBe(true);
      expect(mesh.boundingSphere?.radius).toBe(9);
    }

    // Disposal drops this visual's clones and buffers, never the shared geometry.
    const geometryDisposes = asset.parts.map((part) => vi.spyOn(part.geometry, 'dispose'));
    const sourceDisposes = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialDisposes = fire.materials.map((material) => vi.spyOn(material, 'dispose'));
    const meshDisposes = fire.meshes.map((mesh) => vi.spyOn(mesh, 'dispose'));
    const parent = new THREE.Group();
    fire.addTo(parent);
    expect(parent.children).toHaveLength(2);
    fire.dispose();
    expect(parent.children).toHaveLength(0);
    for (const spy of geometryDisposes) expect(spy).not.toHaveBeenCalled();
    for (const spy of sourceDisposes) expect(spy).not.toHaveBeenCalled();
    for (const spy of materialDisposes) expect(spy).toHaveBeenCalledOnce();
    for (const spy of meshDisposes) expect(spy).toHaveBeenCalledOnce();
  });
});

describe('painters swap to the model once it loads', () => {
  const gravefireRow = {
    id: 'gf-1',
    sourceId: 1,
    x: 0,
    z: 0,
    dirX: 1,
    dirZ: 0,
    tail: 0,
    head: 10,
    halfWidth: 1.5,
    remaining: 5,
  };
  const flameRow = {
    id: 'fl-1',
    sourceId: 1,
    kind: 'soul' as const,
    x: 3,
    z: 4,
    radius: 4,
    duration: 15,
    remaining: 15,
  };

  function install(kind: NythraxisPropKind): void {
    nythraxisFireAssetInternalsForTest.installSource(kind, syntheticSource().group);
  }

  it('gravefire: a line built on the procedural tongue re-fires on the model at the next sync', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisGravefireVisuals(scene, () => 0);
    painter.sync([gravefireRow]);
    const before = scene.children[0].getObjectByName(
      NYTHRAXIS_GRAVEFIRE_TONGUES_NAME,
    ) as THREE.InstancedMesh;
    expect(before.geometry).toBe(NYTHRAXIS_FLAME_TONGUE_GEOMETRY);
    const beforeDispose = vi.spyOn(before, 'dispose');

    install('gravefire');
    painter.sync([gravefireRow]);
    expect(scene.children).toHaveLength(1);
    const after = scene.children[0].getObjectByName(
      NYTHRAXIS_GRAVEFIRE_TONGUES_NAME,
    ) as THREE.InstancedMesh;
    expect(after).not.toBe(before);
    expect(after.geometry).not.toBe(NYTHRAXIS_FLAME_TONGUE_GEOMETRY);
    expect(after.geometry).toBe(nythraxisPropAsset('gravefire')?.parts[0].geometry);
    expect(beforeDispose).toHaveBeenCalledOnce();
    expect(before.parent).toBeNull();

    // A third sync with the model already in place leaves the fire alone.
    painter.sync([gravefireRow]);
    expect(scene.children[0].getObjectByName(NYTHRAXIS_GRAVEFIRE_TONGUES_NAME)).toBe(after);
    painter.dispose();
  });

  it('grave flame: a patch swaps to its own kind only', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisGraveFlameVisuals(scene, () => 0);
    painter.sync([flameRow]);
    const before = scene.children[0].getObjectByName(
      NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME,
    ) as THREE.InstancedMesh;
    expect(before.geometry).toBe(NYTHRAXIS_FLAME_TONGUE_GEOMETRY);

    // The grave (green) model arriving does nothing for a soul (red) patch.
    install('grave');
    painter.sync([flameRow]);
    expect(scene.children[0].getObjectByName(NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME)).toBe(before);

    install('soul');
    painter.sync([flameRow]);
    const after = scene.children[0].getObjectByName(
      NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME,
    ) as THREE.InstancedMesh;
    expect(after).not.toBe(before);
    expect(after.geometry).toBe(nythraxisPropAsset('soul')?.parts[0].geometry);
    expect(after.boundingSphere?.radius).toBeGreaterThanOrEqual(flameRow.radius);
    painter.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('a patch built after the model loaded starts on the model with its foot on the ground', () => {
    install('grave');
    const scene = new THREE.Scene();
    const painter = new NythraxisGraveFlameVisuals(scene, () => 2);
    painter.sync([{ ...flameRow, id: 'fl-2', kind: 'grave' as const }]);
    const tongues = scene.children[0].getObjectByName(
      NYTHRAXIS_GRAVE_FLAME_TONGUES_NAME,
    ) as THREE.InstancedMesh;
    expect(tongues.geometry).toBe(nythraxisPropAsset('grave')?.parts[0].geometry);
    // Instance y is the group-local foot: zero for the modelled cluster (the
    // procedural quad is centred and would sit at half its height).
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let index = 0; index < tongues.count; index++) {
      tongues.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(0, 5);
    }
    painter.dispose();
  });
});
