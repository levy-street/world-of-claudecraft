// Collision Master mesh-volume view: renders the session's editable volumes
// as translucent solids with Blender-style feature-edge wireframes, plus the
// sub-element overlays (vertex dots / edge lines / face fills, selection in
// yellow), and answers component picking for the viewport. Pure presentation:
// the app owns the meshes; every edit routes back through viewport hooks.

import * as THREE from 'three';
import { type CmComponentMode, type CmMesh, faceVerts, featureEdges, polyFaces } from '../cm_mesh';

export interface CmMeshViewState {
  meshes: readonly CmMesh[];
  /** Selected volume (object mode + the sub-mode editing target). */
  selected: number | null;
  /** null = object mode. */
  mode: CmComponentMode | null;
  /** Selected vertex indices of the selected volume (sub modes). */
  selVerts: readonly number[];
}

export interface CmComponentPick {
  mesh: number;
  /** The component's vertex indices (1 vertex, 2 edge ends, or a face's). */
  verts: number[];
}

export interface CmSurfacePick {
  mesh: number;
  /** Model-space surface point and normal. */
  point: [number, number, number];
  normal: [number, number, number];
}

const VOLUME_COLOR = 0x37c5ff;
const VOLUME_SEL_COLOR = 0x63d6ff;
// Walkable ramp volumes read green: they raise the ground, they don't block.
const RAMP_COLOR = 0x3fd68a;
const RAMP_SEL_COLOR = 0x6ee8a8;
const EDGE_COLOR = 0x1d78a8;
const SEL_COLOR = 0xffd23d;
// Bright vertex dots: the old near-black Blender look vanished against dark
// models; white dots with the yellow selection read at a glance.
const VERT_COLOR = 0xf3f7fa;
/** Vertex dot size in px (sizeAttenuation off). */
const VERT_DOT_PX = 12;

export class CmMeshView {
  readonly group = new THREE.Group();
  private state: CmMeshViewState | null = null;
  private volumeMeshes: THREE.Mesh[] = [];
  private overlay: THREE.Object3D[] = [];
  private baseY = 0;
  private originX = 0;
  private originZ = 0;
  private readonly volMat = new THREE.MeshBasicMaterial({
    color: VOLUME_COLOR,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly volSelMat = this.volMat.clone();
  private readonly rampMat = this.volMat.clone();
  private readonly rampSelMat = this.volMat.clone();
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private readonly edgeSelMat = new THREE.LineBasicMaterial({ color: SEL_COLOR });
  private readonly faceSelMat = new THREE.MeshBasicMaterial({
    color: SEL_COLOR,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  constructor() {
    this.group.name = 'editor-cm-meshes';
    this.group.renderOrder = 6;
    this.volSelMat.color.setHex(VOLUME_SEL_COLOR);
    this.volSelMat.opacity = 0.3;
    this.rampMat.color.setHex(RAMP_COLOR);
    this.rampSelMat.color.setHex(RAMP_SEL_COLOR);
    this.rampSelMat.opacity = 0.3;
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Rebuild everything from the app's session state. baseY = the model's
   *  world seat; originX/originZ = the world x/z its local origin sits at (0/0
   *  for the Collision Master scratch scene, the model's map position for a
   *  Build session editing in the live map). */
  setState(state: CmMeshViewState | null, baseY: number, originX = 0, originZ = 0): void {
    this.state = state;
    this.baseY = baseY;
    this.originX = originX;
    this.originZ = originZ;
    this.rebuild();
  }

  private disposeAll(): void {
    for (const mesh of this.volumeMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.volumeMeshes = [];
    for (const o of this.overlay) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material | THREE.Material[];
        // Points materials are built per-rebuild (size scales with selection);
        // the shared volume/edge materials must survive.
        if (mat instanceof THREE.PointsMaterial) mat.dispose();
      }
    }
    this.overlay = [];
  }

  private rebuild(): void {
    this.disposeAll();
    const st = this.state;
    if (!st) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(this.originX, this.baseY, this.originZ);
    for (let mi = 0; mi < st.meshes.length; mi++) {
      const m = st.meshes[mi];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.verts, 3));
      geo.setIndex(m.tris);
      const sel = st.selected === mi;
      const mesh = new THREE.Mesh(
        geo,
        m.ramp ? (sel ? this.rampSelMat : this.rampMat) : sel ? this.volSelMat : this.volMat,
      );
      mesh.renderOrder = 6;
      mesh.userData.cmMeshIndex = mi;
      this.group.add(mesh);
      this.volumeMeshes.push(mesh);
      // Feature-edge wireframe (quad diagonals hidden, Blender-style).
      const edges = featureEdges(m);
      const epos: number[] = [];
      for (const [a, b] of edges) {
        epos.push(
          m.verts[a * 3],
          m.verts[a * 3 + 1],
          m.verts[a * 3 + 2],
          m.verts[b * 3],
          m.verts[b * 3 + 1],
          m.verts[b * 3 + 2],
        );
      }
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
      const lines = new THREE.LineSegments(egeo, this.edgeMat);
      lines.renderOrder = 7;
      this.group.add(lines);
      this.overlay.push(lines);
    }
    this.buildComponentOverlay();
    this.group.updateMatrixWorld(true);
  }

  /** Vertex dots / selected-edge lines / selected-face fill for the selected
   *  volume in a sub mode. */
  private buildComponentOverlay(): void {
    const st = this.state;
    if (!st || st.mode === null || st.selected === null) return;
    const m = st.meshes[st.selected];
    if (!m) return;
    const selSet = new Set(st.selVerts);
    if (st.mode === 'vertex') {
      // Every vertex as a square dot (Blender look); selected in yellow.
      const pos: number[] = [];
      const col: number[] = [];
      const base = new THREE.Color(VERT_COLOR);
      const sel = new THREE.Color(SEL_COLOR);
      for (let i = 0; i < m.verts.length / 3; i++) {
        pos.push(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]);
        const c = selSet.has(i) ? sel : base;
        col.push(c.r, c.g, c.b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size: VERT_DOT_PX,
        sizeAttenuation: false,
        vertexColors: true,
        depthTest: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = 20;
      this.group.add(pts);
      this.overlay.push(pts);
    } else if (st.mode === 'edge' && selSet.size >= 2) {
      // Selected feature edges (both ends selected) highlighted.
      const pos: number[] = [];
      for (const [a, b] of featureEdges(m)) {
        if (selSet.has(a) && selSet.has(b)) {
          pos.push(
            m.verts[a * 3],
            m.verts[a * 3 + 1],
            m.verts[a * 3 + 2],
            m.verts[b * 3],
            m.verts[b * 3 + 1],
            m.verts[b * 3 + 2],
          );
        }
      }
      if (pos.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const lines = new THREE.LineSegments(geo, this.edgeSelMat);
        lines.renderOrder = 20;
        this.group.add(lines);
        this.overlay.push(lines);
      }
    } else if (st.mode === 'face' && selSet.size >= 3) {
      // Faces whose every vertex is selected get the yellow fill.
      const tris: number[] = [];
      for (const group of polyFaces(m)) {
        const verts = faceVerts(m, group);
        if (verts.every((v) => selSet.has(v))) {
          for (const t of group) tris.push(m.tris[t * 3], m.tris[t * 3 + 1], m.tris[t * 3 + 2]);
        }
      }
      if (tris.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(this.state?.meshes[st.selected]?.verts ?? [], 3),
        );
        geo.setIndex(tris);
        const mesh = new THREE.Mesh(geo, this.faceSelMat);
        mesh.renderOrder = 19;
        this.group.add(mesh);
        this.overlay.push(mesh);
      }
    }
  }

  /** The volume index under the ray (object mode picking), or null. */
  pickVolume(raycaster: THREE.Raycaster): number | null {
    if (!this.active) return null;
    const hits = raycaster.intersectObjects(this.volumeMeshes, false);
    for (const h of hits) {
      const idx = h.object.userData?.cmMeshIndex;
      if (typeof idx === 'number') return idx;
    }
    return null;
  }

  /** The component under the ray in the current sub mode, on the SELECTED
   *  volume (Blender edits one object at a time). Vertices and edges pick by
   *  ray distance with a camera-scaled threshold; faces by triangle hit. */
  pickComponent(raycaster: THREE.Raycaster, camera: THREE.Camera): CmComponentPick | null {
    const st = this.state;
    if (!st || st.mode === null || st.selected === null) return null;
    const m = st.meshes[st.selected];
    if (!m) return null;
    const mi = st.selected;
    const ray = raycaster.ray;
    const v = new THREE.Vector3();
    if (st.mode === 'vertex') {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < m.verts.length / 3; i++) {
        v.set(
          m.verts[i * 3] + this.originX,
          m.verts[i * 3 + 1] + this.baseY,
          m.verts[i * 3 + 2] + this.originZ,
        );
        const d = ray.distanceToPoint(v);
        const camD = camera.position.distanceTo(v);
        // Matches the bigger vertex dots: what looks clickable IS clickable.
        const threshold = Math.max(0.07, camD * 0.02);
        if (d < threshold && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 ? { mesh: mi, verts: [best] } : null;
    }
    if (st.mode === 'edge') {
      const a3 = new THREE.Vector3();
      const b3 = new THREE.Vector3();
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (const [a, b] of featureEdges(m)) {
        a3.set(
          m.verts[a * 3] + this.originX,
          m.verts[a * 3 + 1] + this.baseY,
          m.verts[a * 3 + 2] + this.originZ,
        );
        b3.set(
          m.verts[b * 3] + this.originX,
          m.verts[b * 3 + 1] + this.baseY,
          m.verts[b * 3 + 2] + this.originZ,
        );
        const d = Math.sqrt(ray.distanceSqToSegment(a3, b3));
        const camD = camera.position.distanceTo(a3.clone().add(b3).multiplyScalar(0.5));
        const threshold = Math.max(0.04, camD * 0.011);
        if (d < threshold && d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
      return best ? { mesh: mi, verts: [best[0], best[1]] } : null;
    }
    // Face mode: raycast the selected volume's solid, map the tri to its
    // coplanar poly group.
    const target = this.volumeMeshes[mi];
    if (!target) return null;
    const hit = raycaster.intersectObject(target, false)[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    for (const group of polyFaces(m)) {
      if (group.includes(hit.faceIndex)) return { mesh: mi, verts: faceVerts(m, group) };
    }
    return null;
  }

  /** The face (coplanar poly group) under the ray on ANY volume, for Poly
   *  Build, which extrudes whatever face is clicked regardless of sub-mode or
   *  which volume is selected. Returns the volume index, its verts, and the
   *  tri-group (needed to retarget the extruded cap). */
  pickFaceGroup(
    raycaster: THREE.Raycaster,
  ): { mesh: number; verts: number[]; tris: number[] } | null {
    const st = this.state;
    if (!st) return null;
    const hits = raycaster.intersectObjects(this.volumeMeshes, false);
    const hit = hits.find((h) => h.faceIndex !== undefined && h.faceIndex !== null);
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    const mi = hit.object.userData?.cmMeshIndex;
    if (typeof mi !== 'number') return null;
    const m = st.meshes[mi];
    if (!m) return null;
    for (const group of polyFaces(m)) {
      if (group.includes(hit.faceIndex))
        return { mesh: mi, verts: faceVerts(m, group), tris: group };
    }
    return null;
  }

  /** Nearest editable surface under the ray, returned in model space for the
   *  pure sculpt core. */
  pickSurface(raycaster: THREE.Raycaster): CmSurfacePick | null {
    if (!this.state) return null;
    const hit = raycaster.intersectObjects(this.volumeMeshes, false)[0];
    if (!hit?.face) return null;
    const mi = hit.object.userData?.cmMeshIndex;
    if (typeof mi !== 'number') return null;
    const local = hit.object.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone().normalize();
    return {
      mesh: mi,
      point: [local.x, local.y, local.z],
      normal: [n.x, n.y, n.z],
    };
  }

  /** The nearest feature edge on the SELECTED volume, regardless of sub-mode ,
   *  Poly Build's fallback when no face is under the cursor (extrude an edge). */
  pickEdgeAny(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
  ): { mesh: number; a: number; b: number } | null {
    const st = this.state;
    if (!st || st.selected === null) return null;
    const m = st.meshes[st.selected];
    if (!m) return null;
    const ray = raycaster.ray;
    const a3 = new THREE.Vector3();
    const b3 = new THREE.Vector3();
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [a, b] of featureEdges(m)) {
      a3.set(
        m.verts[a * 3] + this.originX,
        m.verts[a * 3 + 1] + this.baseY,
        m.verts[a * 3 + 2] + this.originZ,
      );
      b3.set(
        m.verts[b * 3] + this.originX,
        m.verts[b * 3 + 1] + this.baseY,
        m.verts[b * 3 + 2] + this.originZ,
      );
      const d = Math.sqrt(ray.distanceSqToSegment(a3, b3));
      const camD = camera.position.distanceTo(a3.clone().add(b3).multiplyScalar(0.5));
      const threshold = Math.max(0.04, camD * 0.011);
      if (d < threshold && d < bestD) {
        bestD = d;
        best = [a, b];
      }
    }
    return best ? { mesh: st.selected, a: best[0], b: best[1] } : null;
  }

  dispose(): void {
    this.disposeAll();
    this.volMat.dispose();
    this.volSelMat.dispose();
    this.rampMat.dispose();
    this.rampSelMat.dispose();
    this.edgeMat.dispose();
    this.edgeSelMat.dispose();
    this.faceSelMat.dispose();
  }
}
