// The Gravewyrm Sanctum's ground: the authored field's walkable tops in their
// own families (wind-packed snow with sastrugi, blue glacier and lake ice,
// Thornpeak slate, the moraine's packed earth on the Sledge Road) and every
// terrace edge dropping into the crevasses as a GLACIER wall: a dark slate
// lip crusted with rime, then clear blue ice that deepens to near-black blue
// at the crevasse depth (field_mesh_core.ts glacierCliffColor over the
// glacierWallDetail relief). The void is ice going down, never a sea or a
// fog bank.
//
// The tops are graded by vertex paint only (the shared materials stay
// untouched): the deep bowl a shade bluer than the high pass (less of the
// western afterglow reaches it), and the snow round the cult's fires trodden
// to slush and sooted. Built once per interior; the geometry belongs to the
// interior group, the materials and textures are shared.

import type * as THREE from 'three';
import {
  GRAVEWYRM_HEIGHTS,
  GRAVEWYRM_SANCTUM_FIELD,
} from '../../sim/content/gravewyrm_sanctum_layout';
import { glacierCliffColor } from '../authored_field/field_mesh_core';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';

/** Fires whose heat melts and soots the snow round them (prop kind, radius). */
const SOOTING_FIRES: Readonly<Record<string, number>> = {
  gs_soul_pyre: 6.5,
  gs_cult_brazier: 3.2,
  gs_soul_brazier: 3.2,
};

/** The sooted, slushy ring round a fire: 0 outside, 1 at its heart. */
function sootAt(x: number, z: number): number {
  let s = 0;
  for (const p of GRAVEWYRM_SANCTUM_FIELD.props) {
    const r = SOOTING_FIRES[p.kind];
    if (!r) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < r) s = Math.max(s, (1 - d / r) ** 1.3);
  }
  return s;
}

/** Grade one top mesh's vertex paint for the bowl's depth and the fires. */
function gradeTop(mesh: THREE.Mesh, family: string): void {
  const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  const pos = mesh.geometry.getAttribute('position');
  if (!col || !pos) return;
  const high = GRAVEWYRM_HEIGHTS.landing;
  for (let i = 0; i < col.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Height share: 1 on the pass, 0 on the lake. Low ground loses warmth.
    const up = Math.max(0, Math.min(1, y / high));
    let r = col.getX(i) * (0.94 + up * 0.08);
    let g = col.getY(i) * (0.97 + up * 0.04);
    let b = col.getZ(i) * (1.02 - up * 0.02);
    const soot = family === 'snow' || family === 'soil' ? sootAt(x, z) : 0;
    if (soot > 0) {
      // Trodden slush going grey-brown, then black ash at the fire's foot.
      const k = 1 - soot * 0.72;
      r = r * k + soot * 0.02;
      g = g * k + soot * 0.016;
      b = b * k + soot * 0.012;
    }
    col.setXYZ(i, Math.min(1, r), Math.min(1, g), Math.min(1, b));
  }
  col.needsUpdate = true;
}

/** The Sanctum's whole ground (instance-local frame). */
export function buildSanctumTerrain(lowGfx: boolean): THREE.Group {
  const terrain = buildAuthoredFieldTerrain(GRAVEWYRM_SANCTUM_FIELD, {
    lowGfx,
    cliffRock: 'glacier',
    cliffPaint: glacierCliffColor,
  });
  terrain.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.name.startsWith('fieldTop:')) return;
    gradeTop(mesh, o.name.slice('fieldTop:'.length));
  });
  return terrain;
}
