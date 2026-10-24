// Blender-style sub-element editing for Collision Master hitboxes: the
// selected box grows vertex / edge / face handles, and dragging one reshapes
// the box (a face slides along its normal, an edge moves its two adjacent
// faces, a corner moves three). Everything is expressed as box-parameter
// edits, center + half extents in the box's local yaw frame, so the result
// is always a valid sim OBB. The drag math is pure (applyHandleDrag) and
// Vitest-covered; this class only adds the three.js handles + ray plumbing.

import * as THREE from 'three';
import type { MapHitbox } from '../../sim/map_doc';

export type HitboxSubMode = 'vertex' | 'edge' | 'face';

/** One handle = a corner/edge/face of the unit box, as axis signs. Vertices
 *  have all three signs, edges exactly one zero, faces exactly two zeros. */
export interface HandleDef {
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
  sz: -1 | 0 | 1;
}

const MIN_HALF = 0.02;
const MAX_HALF = 60;
const MAX_CENTER = 100;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** All handles for a mode: 8 vertices / 12 edges / 6 faces. */
export function handleDefs(mode: HitboxSubMode): HandleDef[] {
  const out: HandleDef[] = [];
  const signs: (-1 | 0 | 1)[] = [-1, 0, 1];
  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const zeros = (sx === 0 ? 1 : 0) + (sy === 0 ? 1 : 0) + (sz === 0 ? 1 : 0);
        if (mode === 'vertex' && zeros === 0) out.push({ sx, sy, sz });
        else if (mode === 'edge' && zeros === 1) out.push({ sx, sy, sz });
        else if (mode === 'face' && zeros === 2) out.push({ sx, sy, sz });
      }
    }
  }
  return out;
}

/**
 * Apply a handle drag to a box: `local` is the pointer delta expressed in the
 * box's local yaw frame (x along the box's rotated X, z along its rotated Z).
 * Each nonzero handle axis moves ITS side's face by the delta component: the
 * half extent grows/shrinks by half the component and the center shifts by
 * the other half, so the opposite face stays planted (Blender semantics).
 */
export function applyHandleDrag(
  box: MapHitbox,
  def: HandleDef,
  local: { x: number; y: number; z: number },
): MapHitbox {
  const out: MapHitbox = { ...box };
  const ry = box.ry ?? 0;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const apply = (axis: 'x' | 'y' | 'z', sign: number, d: number): void => {
    if (sign === 0 || d === 0) return;
    const key = axis === 'x' ? 'hx' : axis === 'y' ? 'hy' : 'hz';
    const grown = clamp(out[key] + (sign * d) / 2, MIN_HALF, MAX_HALF);
    const used = (grown - out[key]) * 2 * sign; // the delta that survived clamping
    out[key] = grown;
    const shift = used / 2;
    if (axis === 'y') {
      out.y = clamp(out.y + shift, -MAX_CENTER, MAX_CENTER);
    } else if (axis === 'x') {
      // local X in model space: (cos ry, -sin ry), matches the sim's rotY().
      out.x = clamp(out.x + shift * c, -MAX_CENTER, MAX_CENTER);
      out.z = clamp(out.z - shift * s, -MAX_CENTER, MAX_CENTER);
    } else {
      // local Z in model space: (sin ry, cos ry)
      out.x = clamp(out.x + shift * s, -MAX_CENTER, MAX_CENTER);
      out.z = clamp(out.z + shift * c, -MAX_CENTER, MAX_CENTER);
    }
  };
  apply('x', def.sx, local.x);
  apply('y', def.sy, local.y);
  apply('z', def.sz, local.z);
  return out;
}

interface HandleEntry {
  mesh: THREE.Mesh;
  def: HandleDef;
}

const HANDLE_COLOR = 0x37c5ff;
const HANDLE_HOVER = 0xffd23d;

export class HitboxHandles {
  readonly group = new THREE.Group();
  private entries: HandleEntry[] = [];
  private target: { box: MapHitbox; baseY: number; mode: HitboxSubMode } | null = null;
  private drag: {
    def: HandleDef;
    startBox: MapHitbox;
    plane: THREE.Plane;
    start: THREE.Vector3;
    axisLine: THREE.Vector3 | null; // face drags constrain to this world axis
  } | null = null;
  private readonly mat = new THREE.MeshBasicMaterial({
    color: HANDLE_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });
  private readonly hoverMat = this.mat.clone();
  private hovered: THREE.Mesh | null = null;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();

  constructor() {
    this.group.renderOrder = 1000;
    this.group.visible = false;
    this.hoverMat.color.setHex(HANDLE_HOVER);
    this.hoverMat.opacity = 1;
  }

  get active(): boolean {
    return this.group.visible && this.entries.length > 0;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Rebuild the handle set for a box (world seat baseY) in a sub mode; null
   *  hides everything. Ignored mid-drag: the drag's own live updates rebuild
   *  positions without tearing down the grabbed handle. */
  setTarget(box: MapHitbox | null, baseY: number, mode: HitboxSubMode | null): void {
    if (this.drag) {
      if (box && this.target) {
        this.target.box = box;
        this.layout();
      }
      return;
    }
    this.disposeEntries();
    if (!box || !mode) {
      this.target = null;
      this.group.visible = false;
      return;
    }
    this.target = { box, baseY, mode };
    // Handle scale follows the box so tiny colliders stay grabbable.
    const dim = Math.max(0.35, Math.min(box.hx, box.hy, box.hz) * 0.4);
    for (const def of handleDefs(mode)) {
      let geo: THREE.BufferGeometry;
      if (mode === 'vertex') {
        geo = new THREE.SphereGeometry(Math.min(0.055, dim * 0.18), 10, 8);
      } else if (mode === 'edge') {
        // Sized/oriented per handle in layout(): unit box scaled there.
        geo = new THREE.BoxGeometry(1, 1, 1);
      } else {
        geo = new THREE.PlaneGeometry(1, 1);
      }
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.renderOrder = 1000;
      this.entries.push({ mesh, def });
      this.group.add(mesh);
    }
    this.group.visible = true;
    this.layout();
  }

  /** Position/orient every handle from the current target box. */
  private layout(): void {
    const t = this.target;
    if (!t) return;
    const { box, baseY, mode } = t;
    const ry = box.ry ?? 0;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const ax = this.tmpV.set(c, 0, -s); // local X in world
    const az = this.tmpV2.set(s, 0, c); // local Z in world
    const cx = box.x;
    const cy = baseY + box.y;
    const cz = box.z;
    const thin = Math.min(0.035, Math.max(0.015, Math.min(box.hx, box.hy, box.hz) * 0.05));
    for (const { mesh, def } of this.entries) {
      const px = cx + ax.x * def.sx * box.hx + az.x * def.sz * box.hz;
      const py = cy + def.sy * box.hy;
      const pz = cz + ax.z * def.sx * box.hx + az.z * def.sz * box.hz;
      mesh.position.set(px, py, pz);
      mesh.rotation.set(0, ry, 0);
      if (mode === 'edge') {
        // The zero axis is the edge direction: stretch the unit box along it.
        const lx = def.sx === 0 ? box.hx * 2 * 0.9 : thin;
        const ly = def.sy === 0 ? box.hy * 2 * 0.9 : thin;
        const lz = def.sz === 0 ? box.hz * 2 * 0.9 : thin;
        mesh.scale.set(lx, ly, lz);
      } else if (mode === 'face') {
        // Face the quad outward along its normal axis, sized to the face.
        const pad = 0.55;
        if (def.sx !== 0) {
          mesh.scale.set(box.hz * 2 * pad, box.hy * 2 * pad, 1);
          mesh.rotation.set(0, ry + (def.sx > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        } else if (def.sy !== 0) {
          mesh.scale.set(box.hx * 2 * pad, box.hz * 2 * pad, 1);
          mesh.rotation.set(def.sy > 0 ? -Math.PI / 2 : Math.PI / 2, ry, 0, 'YXZ');
        } else {
          mesh.scale.set(box.hx * 2 * pad, box.hy * 2 * pad, 1);
          mesh.rotation.set(0, ry + (def.sz > 0 ? 0 : Math.PI), 0);
        }
      }
    }
    // Picking can run before the next render frame: bake the matrices now.
    this.group.updateMatrixWorld(true);
  }

  /** Hover feedback: highlight the handle under the ray (outside a drag). */
  hover(raycaster: THREE.Raycaster): boolean {
    if (!this.active || this.drag) return false;
    const hit = raycaster.intersectObjects(
      this.entries.map((e) => e.mesh),
      false,
    )[0];
    const mesh = (hit?.object as THREE.Mesh) ?? null;
    if (this.hovered && this.hovered !== mesh) this.hovered.material = this.mat;
    this.hovered = mesh;
    if (mesh) mesh.material = this.hoverMat;
    return mesh !== null;
  }

  /** Begin a drag if the ray hits a handle. Returns true when claimed. */
  beginDrag(raycaster: THREE.Raycaster): boolean {
    if (!this.active || !this.target) return false;
    const hit = raycaster.intersectObjects(
      this.entries.map((e) => e.mesh),
      false,
    )[0];
    if (!hit) return false;
    const entry = this.entries.find((e) => e.mesh === hit.object);
    if (!entry) return false;
    const { box, baseY, mode } = this.target;
    const start = hit.point.clone();
    let axisLine: THREE.Vector3 | null = null;
    let plane: THREE.Plane;
    if (mode === 'face') {
      // Constrain to the face normal's world axis.
      const ry = box.ry ?? 0;
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      axisLine =
        entry.def.sx !== 0
          ? new THREE.Vector3(c * entry.def.sx, 0, -s * entry.def.sx)
          : entry.def.sy !== 0
            ? new THREE.Vector3(0, entry.def.sy, 0)
            : new THREE.Vector3(s * entry.def.sz, 0, c * entry.def.sz);
      // Drag plane: contains the axis, faces the camera as much as possible.
      const camDir = raycaster.ray.direction.clone().negate();
      const planeNormal = camDir.sub(axisLine.clone().multiplyScalar(camDir.dot(axisLine)));
      if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 1, 0);
      planeNormal.normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, start);
    } else {
      // Vertex/edge: free drag on a camera-facing plane through the handle.
      const normal = raycaster.ray.direction.clone().negate().normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
    }
    this.drag = { def: entry.def, startBox: { ...box }, plane, start, axisLine };
    void baseY;
    return true;
  }

  /** One drag sample: returns the reshaped box, or null while off-plane. */
  moveDrag(raycaster: THREE.Raycaster): MapHitbox | null {
    const d = this.drag;
    const t = this.target;
    if (!d || !t) return null;
    const hit = raycaster.ray.intersectPlane(d.plane, this.tmpV);
    if (!hit) return null;
    let delta = this.tmpV.clone().sub(d.start);
    if (d.axisLine) {
      delta = d.axisLine.clone().multiplyScalar(delta.dot(d.axisLine));
    }
    // World delta -> the box's local yaw frame.
    const ry = d.startBox.ry ?? 0;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const local = {
      x: delta.x * c - delta.z * s,
      y: delta.y,
      z: delta.x * s + delta.z * c,
    };
    const next = applyHandleDrag(d.startBox, d.def, local);
    t.box = next;
    this.layout();
    return next;
  }

  endDrag(): void {
    this.drag = null;
  }

  private disposeEntries(): void {
    for (const { mesh } of this.entries) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.entries = [];
    this.hovered = null;
  }

  dispose(): void {
    this.disposeEntries();
    this.mat.dispose();
    this.hoverMat.dispose();
  }
}
