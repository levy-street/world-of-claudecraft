import * as THREE from 'three';

export interface CrowdBatchVariant {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  capacity: number;
  ownsMaterial?: boolean;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  capacity: number;
  ownedMaterials: THREE.Material[];
}

function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) capacity *= 2;
  return capacity;
}

function configureMesh(mesh: THREE.InstancedMesh): void {
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

export class CharacterCrowdBatch {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly matrix = new THREE.Matrix4();

  registerVariant(key: string, variant: CrowdBatchVariant): void {
    if (this.batches.has(key)) throw new Error(`crowd variant already registered: ${key}`);
    if (!Number.isInteger(variant.capacity) || variant.capacity < 1) {
      throw new RangeError('crowd variant capacity must be a positive integer');
    }
    const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, variant.capacity);
    configureMesh(mesh);
    const materials = Array.isArray(variant.material) ? variant.material : [variant.material];
    this.batches.set(key, {
      mesh,
      capacity: variant.capacity,
      ownedMaterials: variant.ownsMaterial ? materials : [],
    });
    this.group.add(mesh);
  }

  /** Ensure a variant can accept `required` instances this frame. Call only
   * after beginFrame(), before addMatrix(). Growth is high-water-only, so the
   * steady-state render loop performs no buffer allocations. */
  reserve(key: string, required: number): boolean {
    const batch = this.batches.get(key);
    if (!batch) return false;
    if (!Number.isInteger(required) || required < 0) {
      throw new RangeError('crowd reserve must be a non-negative integer');
    }
    if (required <= batch.capacity) return true;
    const capacity = nextCapacity(batch.capacity, required);
    const mesh = new THREE.InstancedMesh(batch.mesh.geometry, batch.mesh.material, capacity);
    configureMesh(mesh);
    this.group.remove(batch.mesh);
    batch.mesh.dispose();
    batch.mesh = mesh;
    batch.capacity = capacity;
    this.group.add(mesh);
    return true;
  }

  beginFrame(): void {
    for (const batch of this.batches.values()) batch.mesh.count = 0;
  }

  addMatrix(key: string, elements: ArrayLike<number>): boolean {
    const batch = this.batches.get(key);
    if (!batch || batch.mesh.count >= batch.capacity) return false;
    this.matrix.fromArray(elements);
    batch.mesh.setMatrixAt(batch.mesh.count++, this.matrix);
    return true;
  }

  endFrame(): void {
    for (const batch of this.batches.values()) {
      const attribute = batch.mesh.instanceMatrix;
      attribute.clearUpdateRanges();
      if (batch.mesh.count > 0) {
        attribute.addUpdateRange(0, batch.mesh.count * 16);
        attribute.needsUpdate = true;
      }
      batch.mesh.visible = batch.mesh.count > 0;
    }
  }

  countFor(key: string): number {
    return this.batches.get(key)?.mesh.count ?? 0;
  }

  get variantCount(): number {
    return this.batches.size;
  }

  get instanceCount(): number {
    let count = 0;
    for (const batch of this.batches.values()) count += batch.mesh.count;
    return count;
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      batch.mesh.dispose();
      for (const material of batch.ownedMaterials) material.dispose();
    }
    this.group.remove(...this.group.children);
    this.batches.clear();
  }
}
