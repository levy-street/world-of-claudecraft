import * as THREE from 'three';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import type { SeqPoint } from './sequencer';

/** Retain the resolved equipment and one frame scratch for a short effect.
 * Sampling never repeats the mesh search or creates vectors in a live frame. */
export function weaponFaceSampler(
  sample: WeaponAnchorSampler | null,
): ((out: SeqPoint, normal: SeqPoint) => boolean) | null {
  if (!sample?.frame) return null;
  const frame = new THREE.Matrix4();
  return (out, normal) => {
    if (!sample.frame?.(frame)) return false;
    const e = frame.elements;
    out.x = e[12];
    out.y = e[13];
    out.z = e[14];
    normal.x = e[8];
    normal.y = e[9];
    normal.z = e[10];
    return true;
  };
}
