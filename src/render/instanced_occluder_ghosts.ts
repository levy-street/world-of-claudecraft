// Ghost stand-ins that let one instance of an InstancedMesh fade while it
// occludes the chase camera (world trees, Yumi maze walls). An InstancedMesh
// cannot fade a single instance (its material is shared by every instance in
// the batch), so the occluded instance is zero-scaled and a pooled Mesh with
// a cloned transparent material renders in its place at the fade alpha.
// Ghosts parent under their source InstancedMesh: they inherit its cull
// visibility and their local matrix is the instance matrix verbatim, so
// placement is identical on the swap frame. Ghost materials clone lazily per
// source mesh and pool for reuse, so steady state allocates nothing;
// per-instance tints (leaf/bark colors) compose into the clone's color on
// acquire.
//
// The stand-in's program is GATED (occluder_fade_gate.ts): a hookless
// transparent clone is a program of its own, linked cold on the first frame
// a trunk blocked the camera. `ready` asks the gate before the first acquire
// for a source mesh, so the instance keeps drawing until the twin links.
import * as THREE from 'three';
import { type OccluderFadeConsult, occluderFadeTwinReady } from './occluder_fade_gate';
import { markOccluderGhostTwin, occluderGhostVariantKey } from './occluder_ghost_variant_key';

/** One live ghost: the stand-in mesh plus the source it must return to. */
export interface InstancedGhostHandle {
  mesh: THREE.Mesh;
  source: THREE.InstancedMesh;
  baseOpacity: number;
}

/** The material a source mesh's ghosts clone from (foliage buckets and the
 *  maze walls never use a material array, but three's type allows one). */
export function ghostSourceMaterial(source: THREE.InstancedMesh): THREE.Material {
  return (Array.isArray(source.material) ? source.material[0] : source.material) as THREE.Material;
}

/**
 * The ghost material recipe, in ONE place so a prewarm twin can be built from
 * the same call and land on the same program.
 *
 * The bare `clone()` is deliberate and load-bearing: it DROPS `onBeforeCompile`
 * and `customProgramCacheKey` (see material_clone_hooks.ts), so the ghost is a
 * hookless material whose key differs from the source bucket's by more than the
 * `transparent` flip. That is why nothing that prewarms the source program
 * covers the ghost, and why a twin must come through this same function rather
 * than reproduce the recipe: reproducing it is how the twin and the live ghost
 * drifted onto two programs in the first place.
 */
export function createInstancedGhostMaterial(src: THREE.Material): THREE.Material {
  const mat = src.clone();
  mat.transparent = true;
  mat.depthWrite = false;
  const color = (mat as THREE.Material & { color?: THREE.Color }).color;
  if (color) mat.userData.ghostBaseColor = color.clone();
  return mat;
}

/** The fade-gate key of a source mesh's ghost program. Keyed on the program
 *  IDENTITY (the source material's parameters, the geometry's attributes, a
 *  plain uninstanced mesh, and the empty custom key a bare clone is left
 *  with), never on the material's uuid: a consumer that rebuilds its meshes
 *  per match (the battleground placements) would otherwise mint a fresh key,
 *  and a retained twin, every time. Cached per mesh so a held consult
 *  allocates nothing per frame. */
const ghostKeys = new WeakMap<THREE.InstancedMesh, string>();

/** What `createInstancedGhostMaterial`'s bare clone reports as its custom
 *  program key: clone() drops every hook, so the default (a no-op
 *  onBeforeCompile) is the same for every source. */
const HOOKLESS_PROGRAM_KEY = new THREE.Material().customProgramCacheKey();

export function instancedGhostKey(source: THREE.InstancedMesh): string {
  let key = ghostKeys.get(source);
  if (key === undefined) {
    const identity = occluderGhostVariantKey(
      {
        material: ghostSourceMaterial(source),
        geometry: source.geometry,
        instanced: false,
        instanceColor: false,
      },
      HOOKLESS_PROGRAM_KEY,
    );
    key = `instanced-ghost:${identity}`;
    ghostKeys.set(source, key);
  }
  return key;
}

/** A hidden plain-Mesh twin on the ghost program, the gate's compile root:
 *  the same recipe as the live stand-in, never drawn, never disposed. */
export function instancedGhostTwin(source: THREE.InstancedMesh): THREE.Mesh {
  const src = ghostSourceMaterial(source);
  const material = createInstancedGhostMaterial(src);
  material.name = `${src.name || src.type}:ghost-fade-gate`;
  markOccluderGhostTwin(material);
  const mesh = new THREE.Mesh(source.geometry, material);
  mesh.name = material.name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export class InstancedOccluderGhosts {
  private pools = new Map<THREE.InstancedMesh, InstancedGhostHandle[]>();
  private tint = new THREE.Color();

  /** May a ghost of `source` draw now? False while the gate links its
   *  program; the caller keeps the instance visible and asks again next
   *  frame. An edge consult by default. */
  ready(source: THREE.InstancedMesh, consult: OccluderFadeConsult = 'edge'): boolean {
    return occluderFadeTwinReady(instancedGhostKey(source), consult, instancedGhostTwin, source);
  }

  /** `ready` over every part of one hideable, consulting ALL of them (never
   *  short-circuiting) so the whole tree's programs are requested at once. */
  allReady(parts: readonly { mesh: THREE.InstancedMesh }[]): boolean {
    let ready = true;
    for (let i = 0; i < parts.length; i++) if (!this.ready(parts[i].mesh)) ready = false;
    return ready;
  }

  /** Ask for `source`'s ghost program ahead of its first occlusion. */
  prefetch(source: THREE.InstancedMesh): void {
    this.ready(source, 'prefetch');
  }

  prefetchAll(parts: readonly { mesh: THREE.InstancedMesh }[]): void {
    for (let i = 0; i < parts.length; i++) this.prefetch(parts[i].mesh);
  }

  /** Attach a ghost for `source`'s instance at `index`, placed at `matrix`. */
  acquire(source: THREE.InstancedMesh, index: number, matrix: THREE.Matrix4): InstancedGhostHandle {
    const handle = this.pools.get(source)?.pop() ?? this.create(source);
    const mat = handle.mesh.material as THREE.Material & { color?: THREE.Color };
    const base = mat.userData.ghostBaseColor as THREE.Color | undefined;
    if (mat.color && base) {
      mat.color.copy(base);
      if (source.instanceColor) {
        source.getColorAt(index, this.tint);
        mat.color.multiply(this.tint);
      }
    }
    handle.mesh.matrix.copy(matrix);
    source.add(handle.mesh);
    handle.mesh.updateMatrixWorld(true);
    return handle;
  }

  /** Set a ghost's fade alpha (1 = the source material's authored opacity). */
  setAlpha(handle: InstancedGhostHandle, alpha: number): void {
    (handle.mesh.material as THREE.Material).opacity = handle.baseOpacity * alpha;
  }

  /** Detach a ghost and return it to the pool for its source mesh. */
  release(handle: InstancedGhostHandle): void {
    handle.source.remove(handle.mesh);
    let pool = this.pools.get(handle.source);
    if (!pool) {
      pool = [];
      this.pools.set(handle.source, pool);
    }
    pool.push(handle);
  }

  private create(source: THREE.InstancedMesh): InstancedGhostHandle {
    const src = ghostSourceMaterial(source);
    const mat = createInstancedGhostMaterial(src);
    const mesh = new THREE.Mesh(source.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { mesh, source, baseOpacity: src.opacity };
  }
}
