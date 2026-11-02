import * as THREE from 'three';
import { GHOST_HIDE_ATTRIBUTE } from './instanced_dither_fade';

interface Pool {
  mesh: THREE.InstancedMesh;
  parent: THREE.Object3D;
  children: THREE.InstancedMesh[];
  owners: THREE.Object3D[];
  ownerIndices: Int32Array;
  hideAttrs: (THREE.InstancedBufferAttribute | undefined)[];
  poolHide: THREE.InstancedBufferAttribute | undefined;
  selected: boolean[];
  versions: number[];
  frustumPass: (boolean | undefined)[];
}

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

/** Combine compatible cell draws without baking transforms into vertices or
 * changing shader inputs. Source parents remain the shadow/reveal owners. */
export class SceneryDetailBatches {
  private pools: Pool[] = [];
  private uniqueOwners: THREE.Object3D[] = [];
  private ownerVisible: Uint8Array = new Uint8Array(0);
  private ownerFrustumPass: Int8Array = new Int8Array(0);
  private ownerSphereKey: Float64Array = new Float64Array(0);
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private lastProjection = new THREE.Matrix4();
  private hasLastProjection = false;
  private sphere = new THREE.Sphere();
  private disposed = false;
  private ready = false;
  private preparing = false;
  private retired = false;
  private detached = false;
  private restoreCells = true;
  private ownedAttributes: ReadonlySet<THREE.BufferAttribute> = new Set();

  constructor(
    children: readonly THREE.InstancedMesh[],
    owners: ReadonlyMap<THREE.InstancedMesh, THREE.Object3D> = new Map(
      children.filter((child) => child.parent).map((child) => [child, child.parent!]),
    ),
  ) {
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const id = (value: object | null): number => {
      if (!value) return -1;
      let result = ids.get(value);
      if (result === undefined) {
        result = nextId++;
        ids.set(value, result);
      }
      return result;
    };
    const ownerIndexMap = new Map<THREE.Object3D, number>();
    const getOwnerIndex = (owner: THREE.Object3D): number => {
      let idx = ownerIndexMap.get(owner);
      if (idx === undefined) {
        idx = this.uniqueOwners.length;
        this.uniqueOwners.push(owner);
        ownerIndexMap.set(owner, idx);
      }
      return idx;
    };
    const groups = new Map<string, THREE.InstancedMesh[]>();
    for (const child of children) {
      const owner = owners.get(child);
      const parent = owner?.parent;
      if (!owner || !parent || Array.isArray(child.material)) continue;
      const attributes = Object.entries(child.geometry.attributes)
        .filter(([name]) => name !== GHOST_HIDE_ATTRIBUTE)
        .map(([name, attribute]) => `${name}:${id(attribute)}`)
        .sort();
      const key = [
        id(parent),
        id(child.material),
        id(child.geometry.index),
        ...attributes,
        owner.matrix.elements.join(','),
        child.receiveShadow,
        child.layers.mask,
        child.renderOrder,
        !!child.instanceColor,
        child.geometry.hasAttribute(GHOST_HIDE_ATTRIBUTE),
      ].join('|');
      const group = groups.get(key);
      if (group) group.push(child);
      else groups.set(key, [child]);
    }
    for (const groupChildren of groups.values()) {
      if (groupChildren.length < 2) continue;
      const source = groupChildren[0];
      const owner = owners.get(source)!;
      const capacity = groupChildren.reduce((sum, child) => sum + child.instanceMatrix.count, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.attributes = { ...source.geometry.attributes };
      geometry.index = source.geometry.index;
      geometry.userData.sharedRendererResource = true;
      let poolHide: THREE.InstancedBufferAttribute | undefined;
      if (geometry.hasAttribute(GHOST_HIDE_ATTRIBUTE)) {
        poolHide = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        geometry.setAttribute(GHOST_HIDE_ATTRIBUTE, poolHide);
      }
      const mesh = new THREE.InstancedMesh(geometry, source.material, capacity);
      mesh.name = 'scenery-batched';
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(owner.matrix);
      mesh.receiveShadow = source.receiveShadow;
      mesh.castShadow = false;
      mesh.layers.mask = source.layers.mask;
      mesh.renderOrder = source.renderOrder;
      // Cell bounds are tested before packing, retaining native rejection.
      mesh.frustumCulled = false;
      if (source.instanceColor)
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.count = 1;
      mesh.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, 16));
      const poolOwners = groupChildren.map((child) => owners.get(child)!);
      const ownerIndices = new Int32Array(poolOwners.map(getOwnerIndex));
      const hideAttrs = groupChildren.map(
        (child) =>
          child.geometry.getAttribute(GHOST_HIDE_ATTRIBUTE) as
            | THREE.InstancedBufferAttribute
            | undefined,
      );
      this.pools.push({
        mesh,
        parent: owner.parent!,
        children: groupChildren,
        owners: poolOwners,
        ownerIndices,
        hideAttrs,
        poolHide,
        selected: [],
        versions: [],
        frustumPass: [],
      });
    }
    const ownerCount = this.uniqueOwners.length;
    this.ownerVisible = new Uint8Array(ownerCount);
    this.ownerFrustumPass = new Int8Array(ownerCount);
    this.ownerSphereKey = new Float64Array(ownerCount * 4);
  }

  async prepare(gate: (root: THREE.Object3D) => Promise<unknown>): Promise<void> {
    this.preparing = true;
    try {
      // Gate outside a queue unit: the gate schedules its own upload/touch tail.
      for (const pool of this.pools) {
        if (this.disposed) return;
        await gate(pool.mesh);
      }
      if (this.disposed) return;
      for (const pool of this.pools) {
        pool.mesh.visible = false;
        pool.parent.add(pool.mesh);
        // The gate may have baked this mesh before it had its final parent.
        pool.mesh.updateMatrixWorld(true);
      }
      this.ready = true;
    } finally {
      this.preparing = false;
      if (this.retired) this.detach();
      if (this.disposed) this.release();
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.ready || this.disposed) return;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const cameraMoved = !this.hasLastProjection || !this.projection.equals(this.lastProjection);
    if (cameraMoved) {
      this.lastProjection.copy(this.projection);
      this.hasLastProjection = true;
      this.frustum.setFromProjectionMatrix(this.projection);
      this.ownerFrustumPass.fill(-1);
    }
    const uniqueOwners = this.uniqueOwners;
    const ownerVisible = this.ownerVisible;
    for (let o = 0; o < uniqueOwners.length; o++) {
      ownerVisible[o] = visible(uniqueOwners[o]) ? 1 : 0;
    }
    for (const pool of this.pools) {
      if (cameraMoved) pool.frustumPass.length = 0;
      let changed = false;
      let count = 0;
      const poolMaterial = pool.mesh.material;
      const poolIndex = pool.mesh.geometry.index;
      const poolPosition = pool.mesh.geometry.attributes.position;
      const poolMatrix = pool.mesh.matrix;
      const poolParent = pool.parent;
      const ownerIndices = pool.ownerIndices;
      const hideAttrs = pool.hideAttrs;
      for (let i = 0; i < pool.children.length; i++) {
        const child = pool.children[i];
        const owner = pool.owners[i];
        if (child.count === 0) {
          // Most prepared levels are empty. They cannot contribute a draw;
          // defer material, transform and frustum checks until populated.
          changed ||= pool.selected[i] === true;
          pool.selected[i] = false;
          child.visible = false;
          if (child.parent === owner) child.removeFromParent();
          continue;
        }
        child.visible = child.count > 0;
        const oIdx = ownerIndices[i];
        const compatible =
          child.material === poolMaterial &&
          child.geometry.index === poolIndex &&
          child.geometry.attributes.position === poolPosition &&
          owner.parent === poolParent &&
          (owner.matrixAutoUpdate === false || owner.matrix.equals(poolMatrix));
        let selected = compatible && child.count > 0 && ownerVisible[oIdx] === 1;
        if (selected && child.frustumCulled && child.boundingSphere) {
          let pass = pool.frustumPass[i];
          if (pass === undefined) {
            const bs = child.boundingSphere;
            const kBase = oIdx * 4;
            const cachedPass = this.ownerFrustumPass[oIdx];
            if (
              cachedPass !== -1 &&
              this.ownerSphereKey[kBase] === bs.center.x &&
              this.ownerSphereKey[kBase + 1] === bs.center.y &&
              this.ownerSphereKey[kBase + 2] === bs.center.z &&
              this.ownerSphereKey[kBase + 3] === bs.radius
            ) {
              pass = cachedPass === 1;
            } else {
              this.sphere.copy(bs).applyMatrix4(owner.matrixWorld);
              pass = this.frustum.intersectsSphere(this.sphere);
              this.ownerFrustumPass[oIdx] = pass ? 1 : 0;
              this.ownerSphereKey[kBase] = bs.center.x;
              this.ownerSphereKey[kBase + 1] = bs.center.y;
              this.ownerSphereKey[kBase + 2] = bs.center.z;
              this.ownerSphereKey[kBase + 3] = bs.radius;
            }
            pool.frustumPass[i] = pass;
          }
          selected = pass;
        }
        const version =
          child.instanceMatrix.version +
          (child.instanceColor?.version ?? 0) +
          (hideAttrs[i]?.version ?? 0);
        changed ||= selected !== pool.selected[i] || version !== pool.versions[i];
        pool.selected[i] = selected;
        pool.versions[i] = version;
        if (compatible) {
          // The pooled draw owns these placements. Keeping the dormant cell
          // children attached still taxes both colour and shadow traversal.
          child.visible = false;
          if (child.parent) child.removeFromParent();
        } else if (child.parent !== owner) owner.add(child);
        if (selected) count += child.count;
      }
      changed ||= count !== pool.mesh.count;
      pool.mesh.count = count;
      pool.mesh.visible = count > 0;
      if (!changed || !count) continue;
      let offset = 0;
      const hide = pool.poolHide;
      for (let i = 0; i < pool.children.length; i++) {
        if (!pool.selected[i]) continue;
        const child = pool.children[i];
        pool.mesh.instanceMatrix.array.set(
          child.instanceMatrix.array.subarray(0, child.count * 16),
          offset * 16,
        );
        if (child.instanceColor && pool.mesh.instanceColor)
          pool.mesh.instanceColor.array.set(
            child.instanceColor.array.subarray(0, child.count * 3),
            offset * 3,
          );
        const sourceHide = hideAttrs[i];
        if (hide && sourceHide) hide.array.set(sourceHide.array.subarray(0, child.count), offset);
        offset += child.count;
      }
      pool.mesh.instanceMatrix.clearUpdateRanges();
      pool.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.mesh.instanceColor) {
        pool.mesh.instanceColor.clearUpdateRanges();
        pool.mesh.instanceColor.addUpdateRange(0, count * 3);
        pool.mesh.instanceColor.needsUpdate = true;
      }
      if (hide) {
        hide.clearUpdateRanges();
        hide.addUpdateRange(0, count);
        hide.needsUpdate = true;
      }
    }
  }

  snapshot(): { pools: number; draws: number; ready: boolean } {
    return {
      pools: this.pools.length,
      draws: this.pools.filter((pool) => pool.mesh.visible).length,
      ready: this.ready,
    };
  }

  /** Retain a rendered geometry listener until shared reduced buffers can
   * finally be freed. A source child may never have reached the GPU itself. */
  retire(): void {
    this.retired = true;
    this.ready = false;
    if (!this.preparing) this.detach();
  }

  dispose(
    ownedAttributes: ReadonlySet<THREE.BufferAttribute> = new Set(),
    restoreChildren = true,
  ): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ownedAttributes = ownedAttributes;
    this.restoreCells = restoreChildren;
    this.retire();
    if (!this.preparing) this.release();
  }

  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    for (const pool of this.pools) {
      for (let i = 0; i < pool.children.length; i++) {
        const child = pool.children[i];
        if (this.restoreCells) {
          child.visible = child.count > 0;
          if (child.parent !== pool.owners[i]) pool.owners[i].add(child);
        }
      }
      pool.mesh.removeFromParent();
      pool.mesh.dispose();
      // The retained geometry listener does not need the retired CPU instance
      // arrays. Streaming generations must not accumulate packed transforms.
      pool.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(0), 16);
      pool.mesh.instanceColor = null;
      pool.mesh.count = 0;
      pool.mesh.visible = false;
    }
  }

  private release(): void {
    for (const pool of this.pools) {
      const geometry = pool.mesh.geometry;
      for (const name of Object.keys(geometry.attributes))
        if (
          name !== GHOST_HIDE_ATTRIBUTE &&
          !this.ownedAttributes.has(geometry.attributes[name] as THREE.BufferAttribute)
        )
          geometry.deleteAttribute(name);
      if (!geometry.index || !this.ownedAttributes.has(geometry.index)) geometry.index = null;
      geometry.dispose();
    }
    this.pools.length = 0;
  }
}
