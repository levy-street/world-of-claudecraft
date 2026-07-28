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
    mesh.count = 0;
    // The instance bounds move every frame. Rebuilding a union sphere over the
    // whole crowd costs more than submitting the handful of batch draws.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const materials = Array.isArray(variant.material) ? variant.material : [variant.material];
    this.batches.set(key, {
      mesh,
      capacity: variant.capacity,
      ownedMaterials: variant.ownsMaterial ? materials : [],
    });
    this.group.add(mesh);
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
      if (batch.mesh.count > 0) batch.mesh.instanceMatrix.needsUpdate = true;
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
      for (const material of batch.ownedMaterials) material.dispose();
    }
    this.group.remove(...this.group.children);
    this.batches.clear();
  }
}
