// What a built set piece (a dungeon entrance: a gatehouse, a chapel) puts
// between the chase camera and the character, as plain numbers (pure,
// Three-free). A set piece hands its own collider rows; each becomes one box
// the eye-to-camera segment is tested against with the occluder-fade family's
// own test (occluder_fade_core.ts occluderSegmentHitsObb), so a set piece
// fades by the same rule as a building or a Duskfall gate rock.
// src/render/set_piece_occluders.ts is the registry that fades the meshes.
import { occluderSegmentHitsObb } from './occluder_fade_core';

/** A solid of the set piece in WORLD coordinates: a collider row's footprint
 *  and its visual top (the collider's cameraTopY). */
export interface SetPieceSolid {
  readonly type: 'obb' | 'circle';
  readonly x: number;
  readonly z: number;
  readonly hw?: number;
  readonly hd?: number;
  /** three.js rotation.y, the colliders' own convention. */
  readonly rot?: number;
  readonly r?: number;
  readonly topY: number;
  /** The underside of a solid that begins over the ground (a jaw over a way
   *  in, a skull wider than its foot): a sight line under it passes. Absent,
   *  the solid stands on the ground. */
  readonly baseY?: number;
}

export interface SetPieceOccluderBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  topY: number;
  baseY?: number;
}

/** One occluder box per solid: an obb as it is, a round one (a tower drum, a
 *  heap) as the square round it, which errs toward fading a moment early. */
export function setPieceOccluderBox(solid: SetPieceSolid): SetPieceOccluderBox {
  if (solid.type === 'circle') {
    const r = solid.r ?? 0;
    return { x: solid.x, z: solid.z, hw: r, hd: r, rot: 0, topY: solid.topY, baseY: solid.baseY };
  }
  return {
    x: solid.x,
    z: solid.z,
    hw: solid.hw ?? 0,
    hd: solid.hd ?? 0,
    rot: solid.rot ?? 0,
    topY: solid.topY,
    baseY: solid.baseY,
  };
}

/** Whether any of the boxes stands between the eye and the camera (or holds
 *  either of them under its top). */
export function setPieceBoxesBlock(
  boxes: readonly SetPieceOccluderBox[],
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let ex = eyeX;
    let ey = eyeY;
    let ez = eyeZ;
    let cx = camX;
    let cy = camY;
    let cz = camZ;
    if (b.baseY !== undefined) {
      // an overhang: only the part of the sight line at or over its underside
      // can meet it, so the segment is cut there before the family's test
      if (ey < b.baseY && cy < b.baseY) continue;
      if (ey < b.baseY) {
        const t = (b.baseY - ey) / (cy - ey);
        ex += (cx - ex) * t;
        ez += (cz - ez) * t;
        ey = b.baseY;
      } else if (cy < b.baseY) {
        const t = (b.baseY - cy) / (ey - cy);
        cx += (ex - cx) * t;
        cz += (ez - cz) * t;
        cy = b.baseY;
      }
    }
    if (occluderSegmentHitsObb(b.x, b.z, b.hw, b.hd, b.rot, b.topY, ex, ey, ez, cx, cy, cz)) {
      return true;
    }
  }
  return false;
}

/** The reach of a set of boxes from `centre`: no point of any footprint lies
 *  farther out. With setPieceSegmentWithin it is the per-frame early-out: a
 *  segment that stays outside the circle cannot touch a box. */
export function setPieceBoxesRadius(
  boxes: readonly SetPieceOccluderBox[],
  centre: { readonly x: number; readonly z: number },
): number {
  let radius = 0;
  for (const b of boxes) {
    const reach = Math.hypot(b.x - centre.x, b.z - centre.z) + Math.hypot(b.hw, b.hd);
    if (reach > radius) radius = reach;
  }
  return radius;
}

/** Whether the ground segment a to b comes within `radius` of (cx, cz). Plain
 *  arithmetic, no allocation: it runs for every set on every frame. */
export function setPieceSegmentWithin(
  cx: number,
  cz: number,
  radius: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz <= radius * radius;
}

/** The middle of a set of boxes: where its fade programs are asked for ahead
 *  of the first occlusion (the family's prefetch radius is measured from it). */
export function setPieceBoxesCentre(
  boxes: readonly SetPieceOccluderBox[],
  out: { x: number; z: number },
): { x: number; z: number } {
  out.x = 0;
  out.z = 0;
  for (const b of boxes) {
    out.x += b.x / boxes.length;
    out.z += b.z / boxes.length;
  }
  return out;
}
