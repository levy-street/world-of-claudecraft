import * as THREE from 'three';
import { programContentKeys } from './initial_scene_compile_units';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { materialProgramSignature } from './prewarm_policy';
import { setRenderCategory } from './renderer_diagnostics';
import { freezeStaticMatrices } from './static_matrix';

/** These permanently hidden compile recipes never animate. Force updates from
 * an explicit compile still work; ordinary frames skip the entire subtree. */
class ProgramAnchorGroup extends THREE.Group {
  override updateMatrixWorld(force?: boolean): void {
    if (force) super.updateMatrixWorld(true);
  }
}

/** A static stand-in catalog that must remain discoverable by restore, without
 * contributing matrix work to ordinary gameplay frames. */
export function freezePrewarmProgramRoot(root: THREE.Group): void {
  freezeStaticMatrices(root);
  const update = root.updateMatrixWorld;
  root.updateMatrixWorld = function (force?: boolean): void {
    if (force) update.call(this, true);
  };
}

interface Anchors {
  group: THREE.Group;
  materials: Map<string, THREE.Material>;
  keys: Set<unknown>;
  textures: THREE.Texture[];
}
// Ownership, not a GPU-readiness cache: these tiny CPU recipes survive a context
// loss. The restore's hold collector links them again before live materials.
const owners = new WeakMap<object, Anchors>();

function compactAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const source = attribute.array;
  const ArrayType = source.constructor as { new (length: number): typeof source };
  const result = new THREE.BufferAttribute(
    new ArrayType(attribute.itemSize * 3),
    attribute.itemSize,
    attribute.normalized,
  );
  if ('gpuType' in attribute) result.gpuType = attribute.gpuType;
  return result;
}

function compactGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = (source as THREE.InstancedBufferGeometry).isInstancedBufferGeometry
    ? new THREE.InstancedBufferGeometry()
    : new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    geometry.setAttribute(name, compactAttribute(attribute));
  for (const [name, attributes] of Object.entries(source.morphAttributes)) {
    geometry.morphAttributes[name as keyof typeof geometry.morphAttributes] =
      attributes.map(compactAttribute);
  }
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  return geometry;
}

/** Hidden shader recipes retain no animation hierarchy or full-size vertex buffers. */
export function buildPrewarmProgramAnchors(owner: object, source: THREE.Group): THREE.Group {
  let retained = owners.get(owner);
  if (!retained) {
    const group = new ProgramAnchorGroup();
    group.name = 'player-program-anchors';
    group.userData.prewarmProgramAnchor = true;
    group.visible = false;
    retained = { group, materials: new Map(), keys: new Set(), textures: [] };
    owners.set(owner, retained);
  }
  const materialFor = (sourceMaterial: THREE.Material): THREE.Material => {
    const signature = materialProgramSignature(sourceMaterial);
    let material = retained.materials.get(signature);
    if (!material) {
      material = cloneMaterialWithHooks(sourceMaterial);
      retained.materials.set(signature, material);
    }
    return material;
  };
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const keys = programContentKeys(mesh);
    if (keys.every((key) => retained.keys.has(key))) return;
    for (const key of keys) retained.keys.add(key);
    const geometry = compactGeometry(mesh.geometry);
    const material = Array.isArray(mesh.material)
      ? mesh.material.map(materialFor)
      : materialFor(mesh.material);
    let anchor: THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
      anchor = skinned;
    } else if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = new THREE.InstancedMesh(geometry, material, 1);
      if ((mesh as THREE.InstancedMesh).instanceColor)
        instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      if ((mesh as THREE.InstancedMesh).morphTexture) {
        instanced.morphTexture = new THREE.DataTexture(
          new Float32Array(4),
          1,
          1,
          THREE.RGBAFormat,
          THREE.FloatType,
        );
        retained.textures.push(instanced.morphTexture);
      }
      anchor = instanced;
    } else {
      anchor = new THREE.Mesh(geometry, material);
      // A BatchedMesh's program flag does not depend on its packed CPU buffers.
      if ((mesh as THREE.BatchedMesh).isBatchedMesh)
        (anchor as THREE.Mesh & { isBatchedMesh: boolean }).isBatchedMesh = true;
      if ((mesh as THREE.BatchedMesh).isBatchedMesh) {
        const batch = anchor as THREE.Mesh & { colorTexture: unknown };
        const sourceBatch = mesh as THREE.Mesh & { colorTexture: unknown };
        batch.colorTexture =
          sourceBatch.colorTexture === null ? null : new THREE.DataTexture(new Uint8Array(4), 1, 1);
        if (batch.colorTexture instanceof THREE.Texture) retained.textures.push(batch.colorTexture);
      }
    }
    anchor.castShadow = mesh.castShadow;
    anchor.receiveShadow = mesh.receiveShadow;
    anchor.name = mesh.name;
    retained.group.add(anchor);
  });
  freezeStaticMatrices(retained.group);
  setRenderCategory(retained.group, 'prewarm');
  return retained.group;
}

export function disposePrewarmProgramAnchors(owner: object): void {
  const retained = owners.get(owner);
  owners.delete(owner);
  if (!retained) return;
  retained.group.removeFromParent();
  for (const object of retained.group.children) {
    const mesh = object as THREE.Mesh;
    mesh.geometry.dispose();
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.dispose();
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
  }
  retained.group.clear();
  for (const material of retained.materials.values()) material.dispose();
  for (const texture of retained.textures) texture.dispose();
}
