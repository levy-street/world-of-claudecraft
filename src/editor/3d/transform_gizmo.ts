// The Blender-style 3-axis transform gizmo drawn over the selected placement:
// move arrows (X red / Y green / Z blue, plus a free-move quad), rotation
// rings, and per-axis scale handles. Pure presentation + handle picking: it
// knows nothing about the document; the viewport positions it, raycasts the
// fat invisible pick meshes, and turns handle drags into placement edits.

import * as THREE from 'three';

export type GizmoMode = 'move' | 'rotate' | 'scale';
export type GizmoAxis = 'x' | 'y' | 'z' | 'xz' | 'uniform';

export interface GizmoConfig {
  mode: GizmoMode;
  /** Show the vertical move arrow (floor planes: moves the floor offset). */
  moveY: boolean;
  /** Show the X/Z rotation rings (model tilt; collider volumes are yaw-only). */
  rotateXZ: boolean;
  /** Which per-axis scale handles to show. */
  scaleAxes: readonly ('x' | 'y' | 'z')[];
}

const AXIS_COLOR: Record<'x' | 'y' | 'z', number> = { x: 0xe5533f, y: 0x6fd457, z: 0x3f7fe5 };
const FREE_COLOR = 0xf0d75a;
const RING_RADIUS = 1.0;
const ARROW_LEN = 1.1;
const TARGET_RADIUS_PX = 76;

/**
 * World scale that keeps the unit-radius gizmo at a stable screen-space size.
 * Perspective uses the anchor's forward depth (not Euclidean distance, which
 * grows toward the screen edges); orthographic projection has one constant
 * world-units-per-pixel value across the whole view.
 */
export function gizmoScaleForScreen(
  viewDepth: number,
  verticalFovDeg: number,
  viewportHeightPx: number,
  orthographicViewHeight?: number,
): number {
  const heightPx = Math.max(1, viewportHeightPx);
  const worldPerPixel =
    orthographicViewHeight !== undefined
      ? Math.max(1e-4, orthographicViewHeight) / heightPx
      : (2 * Math.max(0.02, viewDepth) * Math.tan(THREE.MathUtils.degToRad(verticalFovDeg) / 2)) /
        heightPx;
  return Math.max(0.002, worldPerPixel * TARGET_RADIUS_PX);
}

/** Unit direction of a gizmo axis in world space. */
export function gizmoAxisDir(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  return axis === 'x'
    ? new THREE.Vector3(1, 0, 0)
    : axis === 'y'
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
}

function sameConfig(a: GizmoConfig, b: GizmoConfig): boolean {
  return (
    a.mode === b.mode &&
    a.moveY === b.moveY &&
    a.rotateXZ === b.rotateXZ &&
    a.scaleAxes.length === b.scaleAxes.length &&
    a.scaleAxes.every((v, i) => v === b.scaleAxes[i])
  );
}

/** Rotate a +Y-built handle group so it points along the given axis. */
function orientToAxis(obj: THREE.Object3D, axis: 'x' | 'y' | 'z'): void {
  if (axis === 'x') obj.rotation.z = -Math.PI / 2;
  else if (axis === 'z') obj.rotation.x = Math.PI / 2;
}

export class TransformGizmo {
  readonly group = new THREE.Group();
  private config: GizmoConfig | null = null;
  private pickMeshes: THREE.Mesh[] = [];
  private readonly handleMats = new Map<string, THREE.MeshBasicMaterial>();
  // Invisible fat pick volumes. DoubleSide is LOAD-BEARING: the low-segment
  // pick prisms have a vertex seam exactly on the axis plane, and a front-side
  // culled ray aligned with that seam can miss the entry face by floating
  // point while its exit face is a culled backface; double-sided picking
  // accepts either wall of the convex volume.
  private readonly pickMat = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  });

  constructor() {
    this.group.name = 'editor-transform-gizmo';
    this.group.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Position/scale the gizmo (and rebuild its handles if the config changed). */
  show(config: GizmoConfig, position: THREE.Vector3, scale: number): void {
    if (!this.config || !sameConfig(this.config, config)) this.rebuild(config);
    this.group.position.copy(position);
    this.group.scale.setScalar(scale);
    this.group.visible = true;
  }

  /** The handle under the pointer ray, or null. */
  pick(raycaster: THREE.Raycaster): GizmoAxis | null {
    if (!this.group.visible) return null;
    const hits = raycaster.intersectObjects(this.pickMeshes, false);
    return hits.length > 0 ? (hits[0].object.userData.axis as GizmoAxis) : null;
  }

  dispose(): void {
    this.clearHandles();
    for (const m of this.handleMats.values()) m.dispose();
    this.handleMats.clear();
    this.pickMat.dispose();
  }

  // ---- construction ----------------------------------------------------------

  private mat(color: number, opacity = 0.92): THREE.MeshBasicMaterial {
    const key = `${color}:${opacity}`;
    let m = this.handleMats.get(key);
    if (!m) {
      // depthTest off so the gizmo reads on top of the model, like Blender.
      m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.handleMats.set(key, m);
    }
    return m;
  }

  private clearHandles(): void {
    for (const child of [...this.group.children]) {
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      this.group.remove(child);
    }
    this.pickMeshes = [];
  }

  private addPick(parent: THREE.Object3D, geo: THREE.BufferGeometry, axis: GizmoAxis): void {
    const pick = new THREE.Mesh(geo, this.pickMat);
    pick.userData.axis = axis;
    parent.add(pick);
    this.pickMeshes.push(pick);
  }

  private rebuild(config: GizmoConfig): void {
    this.config = { ...config, scaleAxes: [...config.scaleAxes] };
    this.clearHandles();
    if (config.mode === 'move') this.buildMove(config.moveY);
    else if (config.mode === 'rotate') this.buildRotate(config.rotateXZ);
    else this.buildScale(config.scaleAxes);
  }

  /** A +Y arrow (shaft + cone tip) with a fat pick cylinder, then oriented. */
  private arrow(axis: 'x' | 'y' | 'z'): THREE.Group {
    const g = new THREE.Group();
    const m = this.mat(AXIS_COLOR[axis]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ARROW_LEN - 0.2, 8), m);
    shaft.position.y = (ARROW_LEN - 0.2) / 2;
    shaft.renderOrder = 10;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 12), m);
    tip.position.y = ARROW_LEN - 0.1;
    tip.renderOrder = 10;
    g.add(shaft, tip);
    const pickGeo = new THREE.CylinderGeometry(0.14, 0.14, ARROW_LEN + 0.2, 6);
    pickGeo.translate(0, (ARROW_LEN + 0.2) / 2, 0);
    this.addPick(g, pickGeo, axis);
    orientToAxis(g, axis);
    return g;
  }

  /** A cube-tipped +Y bar (scale handle) with a fat pick cylinder, oriented. */
  private scaleBar(axis: 'x' | 'y' | 'z'): THREE.Group {
    const g = new THREE.Group();
    const m = this.mat(AXIS_COLOR[axis]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ARROW_LEN - 0.14, 8), m);
    shaft.position.y = (ARROW_LEN - 0.14) / 2;
    shaft.renderOrder = 10;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), m);
    tip.position.y = ARROW_LEN - 0.07;
    tip.renderOrder = 10;
    g.add(shaft, tip);
    const pickGeo = new THREE.CylinderGeometry(0.14, 0.14, ARROW_LEN + 0.2, 6);
    pickGeo.translate(0, (ARROW_LEN + 0.2) / 2, 0);
    this.addPick(g, pickGeo, axis);
    orientToAxis(g, axis);
    return g;
  }

  private buildMove(moveY: boolean): void {
    this.group.add(this.arrow('x'), this.arrow('z'));
    if (moveY) this.group.add(this.arrow('y'));
    // Free XZ move: a flat center quad.
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), this.mat(FREE_COLOR, 0.45));
    quad.rotation.x = -Math.PI / 2;
    quad.position.set(0.28, 0.02, 0.28);
    quad.renderOrder = 10;
    this.group.add(quad);
    const pickGeo = new THREE.BoxGeometry(0.4, 0.14, 0.4);
    pickGeo.translate(0.28, 0.02, 0.28);
    this.addPick(this.group, pickGeo, 'xz');
  }

  private ring(axis: 'x' | 'y' | 'z'): THREE.Group {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 0.025, 8, 56),
      this.mat(AXIS_COLOR[axis]),
    );
    torus.renderOrder = 10;
    g.add(torus);
    const pickGeo = new THREE.TorusGeometry(RING_RADIUS, 0.12, 6, 32);
    this.addPick(g, pickGeo, axis);
    // TorusGeometry lies in the XY plane (normal +Z): orient per rotation axis.
    if (axis === 'y') g.rotation.x = Math.PI / 2;
    else if (axis === 'x') g.rotation.y = Math.PI / 2;
    return g;
  }

  private buildRotate(ringsXZ: boolean): void {
    this.group.add(this.ring('y'));
    if (ringsXZ) this.group.add(this.ring('x'), this.ring('z'));
  }

  private buildScale(axes: readonly ('x' | 'y' | 'z')[]): void {
    for (const axis of axes) this.group.add(this.scaleBar(axis));
    // Uniform scale: the center cube.
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), this.mat(FREE_COLOR));
    center.position.y = 0.1;
    center.renderOrder = 10;
    this.group.add(center);
    const pickGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    pickGeo.translate(0, 0.12, 0);
    this.addPick(this.group, pickGeo, 'uniform');
  }
}
