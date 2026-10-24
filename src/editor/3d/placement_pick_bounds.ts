import * as THREE from 'three';
import type { MapPlacement } from '../../sim/map_doc';

export interface PickScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const boundsByTemplate = new WeakMap<THREE.Object3D, THREE.Box3>();

/** Cache only immutable source bounds; no geometry clones or GPU resources. */
export function placementTemplateBounds(object: THREE.Object3D): THREE.Box3 {
  let box = boundsByTemplate.get(object);
  if (!box) {
    box = new THREE.Box3().setFromObject(object);
    boundsByTemplate.set(object, box);
  }
  return box;
}

export function projectPlacementPickBounds(
  box: THREE.Box3,
  placement: MapPlacement,
  norm: number,
  minY: number,
  terrainY: number,
  camera: THREE.Camera,
  width: number,
  height: number,
): PickScreenBox | null {
  if (box.isEmpty() || width <= 0 || height <= 0) return null;
  const p = placement;
  const scale = p.scale * norm;
  const sy = scale * (p.scaleY ?? 1);
  const ground = p.detached ? (p.groundY ?? 0) : terrainY;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, ground - minY * sy + (p.y ?? 0), p.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0)),
    new THREE.Vector3(scale * (p.scaleX ?? 1), sy, scale * (p.scaleZ ?? 1)),
  );
  const projected: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(matrix).project(camera);
        // A box crossing the camera plane cannot yield a meaningful frame.
        if (point.z < -1 || point.z > 1 || !Number.isFinite(point.x + point.y)) return null;
        projected.push(point);
      }
    }
  }
  const xs = projected.map((p) => ((p.x + 1) * width) / 2);
  const ys = projected.map((p) => ((1 - p.y) * height) / 2);
  const left = Math.max(2, Math.min(...xs));
  const top = Math.max(2, Math.min(...ys));
  const right = Math.min(width - 2, Math.max(...xs));
  const bottom = Math.min(height - 2, Math.max(...ys));
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

const PLACEMENT_POSE_KEYS = [
  'x',
  'z',
  'y',
  'groundY',
  'detached',
  'scale',
  'scaleX',
  'scaleY',
  'scaleZ',
  'rotX',
  'rotY',
  'rotZ',
] as const;

/** A steady selected frame must not trigger DOM layout or source-model work. */
export class PlacementPickProjectionCache {
  private pose: Partial<MapPlacement> = {};
  private cameraWorld: number[] = [];
  private cameraProjection: number[] = [];
  private index = -1;
  private front: number | undefined;
  private width = -1;
  private height = -1;

  update(
    index: number,
    front: number | undefined,
    placement: MapPlacement,
    camera: THREE.Camera,
    width: number,
    height: number,
    force: boolean,
  ): boolean {
    const world = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    if (
      !force &&
      this.index === index &&
      this.front === front &&
      this.width === width &&
      this.height === height &&
      PLACEMENT_POSE_KEYS.every((key) => this.pose[key] === placement[key]) &&
      world.every((value, position) => value === this.cameraWorld[position]) &&
      projection.every((value, position) => value === this.cameraProjection[position])
    )
      return false;
    this.index = index;
    this.front = front;
    this.width = width;
    this.height = height;
    this.pose = { ...placement };
    this.cameraWorld = world.slice();
    this.cameraProjection = projection.slice();
    return true;
  }
}
