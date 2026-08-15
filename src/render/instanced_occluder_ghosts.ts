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
import * as THREE from 'three';

/** One live ghost: the stand-in mesh plus the source it must return to. */
export interface InstancedGhostHandle {
  mesh: THREE.Mesh;
  source: THREE.InstancedMesh;
  baseOpacity: number;
}

export class InstancedOccluderGhosts {
  private pools = new Map<THREE.InstancedMesh, InstancedGhostHandle[]>();
  private tint = new THREE.Color();

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
    const src = (
      Array.isArray(source.material) ? source.material[0] : source.material
    ) as THREE.Material;
    const mat = src.clone();
    mat.transparent = true;
    mat.depthWrite = false;
    const color = (mat as THREE.Material & { color?: THREE.Color }).color;
    if (color) mat.userData.ghostBaseColor = color.clone();
    const mesh = new THREE.Mesh(source.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { mesh, source, baseOpacity: src.opacity };
  }
}
