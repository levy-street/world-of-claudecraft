// Fire and Fly: the red ground marker under every living monster, drawn. One
// instanced disc per marker (a soft fill, a crisp bright ring and a thin dark
// rim that keeps the ring apart from pale ground) on ONE named material, so
// the whole field is a single draw. Minted at the commitment and attached
// behind the compile gate, while the monsters' own rigs or capsules show where
// they are. Unlit and fogless so it reads in the dusk light and across the
// clearing; the same on every graphics tier (a player aims by it); never
// frustum-culled (a pool rewritten every frame has no stable bounds). It
// paints over the cannon's dust and under the strike ring's band. A frame
// rewrites the matrices in place and queues one reused upload range; nothing
// is allocated after the build. The pure half is turret_ground_marker_core.ts.
import * as THREE from 'three';
import { BufferUpdateRange } from './buffer_update_range';
import { CLICK_MARKER_COLOR_HOSTILE } from './click_marker';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  newTurretGroundMarker,
  TURRET_MARKER_MATRIX_FLOATS,
  type TurretMarkerBody,
  type TurretMarkerGround,
  type TurretMarkerPose,
  turretGroundMarkerInto,
  turretGroundMarkerMatrixInto,
} from './turret_ground_marker_core';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;

export const TURRET_MARKER_NAME = 'fireAndFly:groundMarker';
/** Over the cannon's puff draw (the player band's rung 4), under the encounter band's strike ring. */
export const TURRET_MARKER_ORDER = floorVfxRenderOrder('player', 5);

const SEGMENTS = 40;
/** Radii of the disc's bands, as shares of the marker radius. */
const FILL_EDGE = 0.72;
const RING_EDGE = 0.9;
/** Per band: a multiplier on the hostile red, and the opacity. */
const FILL_CENTER = { tint: 0.85, alpha: 0.3 };
const FILL_OUTER = { tint: 0.85, alpha: 0.5 };
const RING = { tint: 1.4, alpha: 0.95 };
const RIM = { tint: 0.1, alpha: 0.6 };

interface Parts {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshBasicMaterial;
  readonly upload: BufferUpdateRange;
}

/**
 * The marker disc, flat on y = 0 with a radius of 1, every triangle facing up
 * (FrontSide: a transparent DoubleSide material would draw twice). Colours are
 * RGBA multipliers on the material's hostile red.
 */
export function turretMarkerGeometry(): THREE.BufferGeometry {
  const rings = [FILL_EDGE, FILL_EDGE, RING_EDGE, RING_EDGE, 1];
  const looks = [FILL_OUTER, RING, RING, RIM, RIM];
  const vertices = 1 + rings.length * SEGMENTS;
  const position = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 4);
  const setColor = (v: number, look: { tint: number; alpha: number }): void => {
    color[v * 4] = look.tint;
    color[v * 4 + 1] = look.tint;
    color[v * 4 + 2] = look.tint;
    color[v * 4 + 3] = look.alpha;
  };
  setColor(0, FILL_CENTER);
  rings.forEach((r, band) => {
    for (let k = 0; k < SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2;
      const v = 1 + band * SEGMENTS + k;
      position[v * 3] = r * Math.cos(a);
      position[v * 3 + 2] = -r * Math.sin(a);
      setColor(v, looks[band]);
    }
  });
  const index: number[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const next = (k + 1) % SEGMENTS;
    index.push(0, 1 + k, 1 + next);
  }
  // Bands 1 to 2 (the ring) and 3 to 4 (the rim): a quad strip each, the
  // duplicated radii letting a band change colour on a hard edge.
  for (const [inner, outer] of [
    [1, 2],
    [3, 4],
  ]) {
    for (let k = 0; k < SEGMENTS; k++) {
      const next = (k + 1) % SEGMENTS;
      const a = 1 + inner * SEGMENTS + k;
      const b = 1 + inner * SEGMENTS + next;
      const c = 1 + outer * SEGMENTS + k;
      const d = 1 + outer * SEGMENTS + next;
      index.push(a, c, d, a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 4));
  geometry.setIndex(index);
  geometry.name = TURRET_MARKER_NAME;
  return geometry;
}

export class TurretGroundMarkers {
  readonly root = new THREE.Group();
  private parts: Parts | null = null;
  private count = 0;
  private disposed = false;
  private readonly marker = newTurretGroundMarker();

  constructor(
    private readonly probe: { ground(x: number, z: number): number },
    private readonly compileGate?: CompileGate,
  ) {
    this.root.name = 'fire-and-fly-ground-markers';
  }

  /** Markers drawn by the last frame (read by tests and diagnostics). */
  get drawn(): number {
    return this.parts?.mesh.visible ? this.parts.mesh.count : 0;
  }

  get capacity(): number {
    return this.parts?.mesh.instanceMatrix.count ?? 0;
  }

  /**
   * The commitment: mints the draw for `capacity` markers and attaches it
   * under `parent` behind the compile gate, once. A later plan that fields
   * more bodies swaps in a larger pool on the same (linked) material.
   */
  prepare(parent: THREE.Object3D, capacity: number): void {
    if (this.disposed) return;
    const parts = this.parts;
    if (!parts) {
      const geometry = turretMarkerGeometry();
      const material = new THREE.MeshBasicMaterial({
        name: TURRET_MARKER_NAME,
        color: CLICK_MARKER_COLOR_HOSTILE,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      const mesh = this.mint(geometry, material, capacity);
      this.parts = { mesh, geometry, material, upload: new BufferUpdateRange(mesh.instanceMatrix) };
      void attachSceneGroupGated(parent, this.root, this.compileGate, () => this.disposed).catch(
        () => {},
      );
      return;
    }
    if (capacity <= this.capacity) return;
    parts.mesh.removeFromParent();
    parts.mesh.dispose();
    const mesh = this.mint(parts.geometry, parts.material, capacity);
    this.parts = { ...parts, mesh, upload: new BufferUpdateRange(mesh.instanceMatrix) };
  }

  begin(): void {
    this.count = 0;
  }

  /** One monster's marker, if it shows one and the pool has room; `slope` is the body's own, kept across frames. */
  push(
    body: TurretMarkerBody,
    pose: TurretMarkerPose,
    bodyRadius: number,
    slope: TurretMarkerGround,
  ): void {
    const parts = this.parts;
    if (!parts || this.count >= this.capacity) return;
    const m = turretGroundMarkerInto(this.marker, body, pose, bodyRadius, this.probe, slope);
    if (!m.visible) return;
    const array = parts.mesh.instanceMatrix.array as Float32Array;
    turretGroundMarkerMatrixInto(array, this.count * TURRET_MARKER_MATRIX_FLOATS, m);
    this.count++;
  }

  end(): void {
    const parts = this.parts;
    if (!parts) return;
    parts.mesh.count = this.count;
    parts.mesh.visible = this.count > 0;
    if (this.count > 0) parts.upload.mark(0, this.count * TURRET_MARKER_MATRIX_FLOATS);
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    const parts = this.parts;
    if (!parts) return;
    this.parts = null;
    parts.mesh.dispose();
    parts.geometry.dispose();
    parts.material.dispose();
  }

  private mint(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
    mesh.name = TURRET_MARKER_NAME;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = TURRET_MARKER_ORDER;
    mesh.userData.renderCategory = 'ui3d';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }
}
