import * as THREE from 'three';
import type { CharacterSurfaceResponse } from './surface_response';

export interface SurfacePreparationTicket {
  root: THREE.Group;
  settle(prepared?: boolean): void;
}

/** Hidden twins ride the receiver's existing view preparation. They never
 * activate a response or replace its ordinary visible materials. */
export class SurfaceResponsePreparation {
  private epoch = 0;
  private pending: SurfacePreparationTicket | null = null;

  begin(
    parent: THREE.Object3D,
    sources: Iterable<[THREE.Mesh, THREE.Material | THREE.Material[]]>,
    response: CharacterSurfaceResponse,
    linked: WeakSet<THREE.Material>,
    farMesh?: THREE.Mesh | null,
    farMaterials?: THREE.Material | THREE.Material[] | null,
  ): SurfacePreparationTicket | null {
    if (this.pending) return this.pending;
    const root = new THREE.Group();
    root.name = 'character_surface_prepare';
    root.visible = false;
    const materials = new Set<THREE.Material>();
    const add = (source: THREE.Mesh, original: THREE.Material | THREE.Material[]) => {
      if (!source.geometry || source.userData.weaponVfxMesh) return;
      for (const base of Array.isArray(original) ? original : [original]) {
        const material = response.material(base);
        if (material === base || linked.has(material)) continue;
        const twin = (source as THREE.SkinnedMesh).isSkinnedMesh
          ? new THREE.SkinnedMesh(source.geometry, material)
          : new THREE.Mesh(source.geometry, material);
        twin.castShadow = source.castShadow;
        twin.receiveShadow = source.receiveShadow;
        twin.frustumCulled = false;
        twin.visible = false;
        root.add(twin);
        materials.add(material);
      }
    };
    for (const [source, original] of sources) add(source, original);
    if (farMesh && farMaterials) add(farMesh, farMaterials);
    if (!root.children.length) return null;
    const epoch = ++this.epoch;
    const ticket: SurfacePreparationTicket = {
      root,
      settle: (prepared = false) => {
        if (epoch !== this.epoch || this.pending !== ticket) return;
        if (prepared) for (const material of materials) linked.add(material);
        this.clear();
      },
    };
    this.pending = ticket;
    parent.add(root);
    return ticket;
  }

  clear(): void {
    ++this.epoch;
    this.pending?.root.removeFromParent();
    this.pending?.root.clear();
    this.pending = null;
    // Shared geometry and cached materials remain owned by CharacterVisual.
  }
}
