import * as THREE from 'three';
import { type MapPlacement, MODEL_ASSET_ID } from '../../sim/map_doc';

export const BUILDING_PREVIEW_LIMIT = 256;

export interface BuildingAssetFootprint {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export type BuildingFootprintLookup = (assetId: string) => BuildingAssetFootprint | null;

/** The side facing the camera, in the same placement-local frame as wall finishes. */
export function buildingSurfaceSide(
  placement: Pick<MapPlacement, 'rotX' | 'rotY' | 'rotZ' | 'building'>,
  rayDirection: { x: number; y: number; z: number },
): 'front' | 'back' {
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(placement.rotX ?? 0, placement.rotY, placement.rotZ ?? 0),
  );
  const localDirection = new THREE.Vector3(
    rayDirection.x,
    rayDirection.y,
    rayDirection.z,
  ).applyQuaternion(rotation.invert());
  const wallAxis = placement.building?.wallAxis ?? 'z';
  return localDirection[wallAxis] <= 0 ? 'front' : 'back';
}

/** Bounded boxes, sharing the viewport's already-owned editor overlay material.
 * Geometry is allocated once, transforms update only on pointer/UI changes.
 * This adds no shader variant, texture, asynchronous load, or frame callback. */
export class BuildingPreview {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly meshes: THREE.Mesh[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly center = new THREE.Vector3();
  private readonly size = new THREE.Vector3();
  private readonly vertex = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly material: THREE.MeshBasicMaterial) {
    this.group.name = 'editor-building-preview';
  }

  update(
    placements: readonly MapPlacement[],
    groundAt: (x: number, z: number) => number,
    footprintFor?: BuildingFootprintLookup,
  ): void {
    if (this.disposed) return;
    const count = Math.min(BUILDING_PREVIEW_LIMIT, placements.length);
    for (let i = 0; i < count; i++) {
      const p = placements[i];
      let mesh = this.meshes[i];
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        mesh.renderOrder = 2;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
      this.bounds.makeEmpty();
      if (p.assetId === MODEL_ASSET_ID && p.meshes) {
        for (const volume of p.meshes) {
          for (let v = 0; v + 2 < volume.verts.length; v += 3) {
            this.vertex.fromArray(volume.verts, v);
            this.bounds.expandByPoint(this.vertex);
          }
        }
      }
      if (this.bounds.isEmpty()) {
        const footprint = footprintFor?.(p.assetId);
        const x = footprint?.sizeX ?? 1;
        const y = footprint?.sizeY ?? 1;
        const z = footprint?.sizeZ ?? 1;
        this.bounds.min.set(-x / 2, 0, -z / 2);
        this.bounds.max.set(x / 2, y, z / 2);
      }
      this.bounds.getCenter(this.center);
      this.bounds.getSize(this.size);
      const sx = p.scale * (p.scaleX ?? 1);
      const sy = p.scale * (p.scaleY ?? 1);
      const sz = p.scale * (p.scaleZ ?? 1);
      mesh.rotation.set(p.rotX ?? 0, p.rotY, p.rotZ ?? 0);
      this.center.set(this.center.x * sx, this.center.y * sy, this.center.z * sz);
      this.center.applyQuaternion(mesh.quaternion);
      // Procedural model templates keep minY=0; their vertices can sit below
      // the authored floor. GLB footprints are already normalized/base-seated.
      const baseY = p.detached ? (p.groundY ?? 0) : groundAt(p.x, p.z);
      mesh.position.set(p.x, baseY + (p.y ?? 0), p.z).add(this.center);
      mesh.scale.set(this.size.x * sx, this.size.y * sy, this.size.z * sz);
      mesh.visible = true;
    }
    for (let i = count; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    this.meshes.length = 0;
    this.geometry.dispose();
    // The viewport owns the shared material and its other overlay consumers.
  }
}
