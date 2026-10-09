// VisualDef.smoothNormals: swap a faceted rig's geometries for copies whose
// normals are creased-smooth (smooth_normals_core.ts). Each source geometry is
// rebuilt once and shared by every clone of the def (a WeakMap keyed by the
// source and the crease), so a pack of four pays one pass at its first load
// and nothing after. Only the normal attribute differs from the source: the
// skin attributes, index and groups are the source's, so the rig, its clips,
// the far-LOD bake and the cull centre (keyed by the swapped geometry) all
// follow it unchanged. Other defs on the same GLB keep the faceted original.

import * as THREE from 'three';
import { creasedNormals } from './smooth_normals_core';

const smoothed = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

/** The creased-smooth twin of `source` (built once per crease angle). */
export function smoothedGeometry(
  source: THREE.BufferGeometry,
  creaseDegrees: number,
): THREE.BufferGeometry {
  let byCrease = smoothed.get(source);
  if (!byCrease) {
    byCrease = new Map();
    smoothed.set(source, byCrease);
  }
  const hit = byCrease.get(creaseDegrees);
  if (hit) return hit;
  const pos = source.getAttribute('position');
  const nrm = source.getAttribute('normal');
  if (!pos || !nrm) {
    byCrease.set(creaseDegrees, source);
    return source;
  }
  const p = new Float32Array(pos.count * 3);
  const n = new Float32Array(nrm.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
  }
  for (let i = 0; i < nrm.count; i++) {
    n[i * 3] = nrm.getX(i);
    n[i * 3 + 1] = nrm.getY(i);
    n[i * 3 + 2] = nrm.getZ(i);
  }
  // A shallow twin: every attribute but the normal is the source's own buffer.
  const twin = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    if (name !== 'normal') twin.setAttribute(name, attr);
  }
  twin.setAttribute('normal', new THREE.BufferAttribute(creasedNormals(p, n, creaseDegrees), 3));
  twin.setIndex(source.index);
  for (const g of source.groups) twin.addGroup(g.start, g.count, g.materialIndex);
  twin.morphAttributes = source.morphAttributes;
  twin.morphTargetsRelative = source.morphTargetsRelative;
  twin.drawRange = { ...source.drawRange };
  twin.name = source.name;
  twin.userData = source.userData;
  byCrease.set(creaseDegrees, twin);
  return twin;
}

/** Give every mesh under `root` its creased-smooth geometry. */
export function applySmoothNormals(root: THREE.Object3D, creaseDegrees: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = smoothedGeometry(mesh.geometry, creaseDegrees);
  });
}
