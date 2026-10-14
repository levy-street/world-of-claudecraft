// The authored-map placement lane of the static collider build: every
// editor placement with a collide footprint, resolved to the most specific
// shape the asset has (hand-edited hitboxes, Collision Master prisms, ramp
// decks, the baked per-asset boxes, then the legacy circle or square), plus
// the editor's own collider volumes. Extracted out of colliders.ts, whose
// staticWorldColliders calls the two push functions at the same point in its
// emit order it used to run the loops inline. Pure: content and seed in,
// colliders appended; no rng, no grid state.

import {
  authoredPrismsForPath,
  authoredRampsForPath,
  type BakedCollisionBox,
  bakedBoxesForPath,
} from '../asset_collision';
import { type Collider, rotY, type TopSlope } from '../collider_shapes';
import { FENCE_END_PAD, FENCE_HALF_DEPTH, FENCE_RAIL_HEIGHT } from '../fence_dims';
import type { CollisionPrism } from '../mesh_prisms';
import { AUTHORED_TRAVERSAL_BAND } from '../traversal_band';
import type { PlacedAsset, WorldContent } from '../types';
import { groundHeight, terrainHeight } from '../world';
import {
  applyMat,
  convexHullXZ,
  eulerMatrix,
  outlineWinding,
  type Point3,
} from './placement_geometry';

function topY(seed: number, x: number, z: number, height: number): number {
  return groundHeight(x, z, seed) + height;
}

const NO_AUTHORED_PRISMS: readonly CollisionPrism[] = [];

/**
 * Emit one banded PRISM per authored Collision Master volume of a placement.
 *
 * The outline MUST come out counter-clockwise: pushOutPrism reads the interior
 * as "left of every edge", so a reversed one inverts the collider and makes the
 * whole world solid except inside it. Rotation preserves winding; a mirroring
 * scale would not, hence the explicit re-check.
 */
export function emitPlacementPrisms(
  out: Collider[],
  p: PlacedAsset,
  prisms: readonly CollisionPrism[],
  base: number,
): void {
  const lift = p.y ?? 0;
  const s = p.scale > 0 ? p.scale : 1;
  const sx = s * (p.scaleX ?? 1);
  const sy = s * (p.scaleY ?? 1);
  const sz = s * (p.scaleZ ?? 1);
  const tiltX = p.rotX ?? 0;
  const tiltZ = p.rotZ ?? 0;
  // A tilted placement leans its collision with the model: every outline corner
  // goes through the FULL rotation and the leaned prism becomes the convex
  // shadow of that, banded by the corners' Y span.
  const m = tiltX !== 0 || tiltZ !== 0 ? eulerMatrix(tiltX, p.rotY, tiltZ) : null;
  for (const prism of prisms) {
    const flat: [number, number][] = [];
    let loY = Infinity;
    let hiYLocal = -Infinity;
    for (let i = 0; i < prism.poly.length; i += 2) {
      const mx = prism.poly[i] * sx;
      const mz = prism.poly[i + 1] * sz;
      if (m) {
        for (const py of [prism.y0 * sy, prism.y1 * sy]) {
          const w = applyMat(m, mx, py, mz);
          flat.push([w.x, w.z]);
          if (w.y < loY) loY = w.y;
          if (w.y > hiYLocal) hiYLocal = w.y;
        }
      } else {
        const w = rotY(mx, mz, p.rotY);
        flat.push([w.x, w.z]);
      }
    }
    if (!m) {
      loY = prism.y0 * sy;
      hiYLocal = prism.y1 * sy;
    }
    const hull = m ? convexHullXZ(flat) : flat;
    if (hull.length < 3) continue;
    const flipped = outlineWinding(hull) < 0;
    if (flipped) hull.reverse();
    const poly: number[] = [];
    let br = 0;
    for (const [hx, hz] of hull) {
      poly.push(hx, hz);
      br = Math.max(br, Math.hypot(hx, hz));
    }
    // LOFT outlines ride through the same scale + yaw (never the tilt path:
    // the leaned shadow hull re-orders vertices, breaking the index
    // correspondence the loft interpolation depends on). Reversed together
    // with poly so index i keeps matching across all three.
    let polyLo: number[] | undefined;
    let polyHi: number[] | undefined;
    if (!m && prism.polyLo && prism.polyHi && prism.polyLo.length === prism.poly.length) {
      const mapOutline = (src: readonly number[]): number[] => {
        const o: number[] = [];
        for (let i = 0; i < src.length; i += 2) {
          const w = rotY(src[i] * sx, src[i + 1] * sz, p.rotY);
          o.push(w.x, w.z);
        }
        if (flipped) {
          const r: number[] = [];
          for (let i = o.length - 2; i >= 0; i -= 2) r.push(o[i], o[i + 1]);
          return r;
        }
        return o;
      };
      polyLo = mapOutline(prism.polyLo);
      polyHi = mapOutline(prism.polyHi);
      for (let i = 0; i < polyLo.length; i += 2) {
        br = Math.max(
          br,
          Math.hypot(polyLo[i], polyLo[i + 1]),
          Math.hypot(polyHi[i], polyHi[i + 1]),
        );
      }
    }
    const lo = base + lift + loY;
    const hi = base + lift + hiYLocal;
    out.push({
      type: 'prism',
      x: p.x,
      z: p.z,
      poly,
      br,
      polyLo,
      polyHi,
      cameraTopY: hi,
      baseY: lo,
      moveTopY: hi,
      standable: true,
    });
  }
}

/**
 * Only a box that can actually be mounted is a support surface. A TALL sliver
 * (a wall panel, a fence picket) still BLOCKS, blocksAt reads moveTopY, but
 * it leaves the standable set: supportFromCandidates and floorHeightAt walk
 * every standable candidate per query, and on a dressed map many baked boxes
 * are exactly this kind of never-stood-on shape. A LOW box stays standable
 * whatever its footprint: step-up/mantle onto the top IS how a body crosses a
 * doorstep course or vaults a rail, and both gates require standable.
 */
const STANDABLE_MIN_HALF_EXTENT = 0.22;
// Placement boxes exist only on authored maps, so they read the Studio band.
const STANDABLE_LOW_TOP = AUTHORED_TRAVERSAL_BAND + 0.35;
function standableSurface(hw: number, hd: number, topAboveGround: number): boolean {
  return Math.min(hw, hd) >= STANDABLE_MIN_HALF_EXTENT || topAboveGround <= STANDABLE_LOW_TOP;
}

/**
 * Emit one banded OBB per baked box of a placement.
 *
 * `baseY` gates walking underneath (a cave tube, the floor below an authored
 * storey) and `moveTopY`+`standable` make the band's top a real surface, the
 * same treatment the shipped world gives crates, benches and hut roofs. A box
 * carries its own `ry` on top of the placement's yaw (hand-edited hitboxes).
 */
export function emitPlacementBoxes(
  out: Collider[],
  p: PlacedAsset,
  baked: readonly BakedCollisionBox[],
  base: number,
): void {
  const lift = p.y ?? 0;
  const s = p.scale > 0 ? p.scale : 1;
  const sx = s * (p.scaleX ?? 1);
  const sy = s * (p.scaleY ?? 1);
  const sz = s * (p.scaleZ ?? 1);
  const tiltX = p.rotX ?? 0;
  const tiltZ = p.rotZ ?? 0;
  if (tiltX === 0 && tiltZ === 0) {
    for (const b of baked) {
      const off = rotY(b.x * sx, b.z * sz, p.rotY);
      const lo = base + lift + (b.y - b.hy) * sy;
      const hi = base + lift + (b.y + b.hy) * sy;
      // A box with its OWN yaw (hand-edited hitboxes, Collision Master
      // volumes) has its local axes rotated off the model's, so a per-axis
      // model scale must be measured through that rotation: hw is the box's
      // local-X extent as the scaled model actually stretches it, not
      // b.hx * sx (which silently swapped width and depth on a 90-degree
      // authored box under a fitted building's scaleX != scaleZ).
      const bry = (b as { ry?: number }).ry ?? 0;
      let hw = b.hx * sx;
      let hd = b.hz * sz;
      if (bry !== 0 && Math.abs(sx - sz) > 1e-6) {
        const bc = Math.cos(bry);
        const bs = Math.sin(bry);
        hw = b.hx * Math.hypot(bc * sx, bs * sz);
        hd = b.hz * Math.hypot(bs * sx, bc * sz);
      }
      hw = Math.max(0.05, hw);
      hd = Math.max(0.05, hd);
      // a shaped top (MapHitbox.slope): pitches are drops per yard, so they
      // scale by height over the placed run they are measured along
      const sl = b as { slope?: 'ridge' | 'cone'; pitch?: number; fall?: number; eave?: number };
      const topSlope: TopSlope | undefined =
        sl.slope && sl.pitch !== undefined
          ? {
              kind: sl.slope,
              axis: 'x',
              pitch:
                (sl.pitch * sy) /
                (sl.slope === 'ridge' ? hd / b.hz : Math.sqrt((hw / b.hx) * (hd / b.hz))),
              eaveY: base + lift + (sl.eave ?? b.y - b.hy) * sy,
              ...(sl.fall ? { fall: (sl.fall * sy) / (hw / b.hx) } : {}),
            }
          : undefined;
      out.push({
        type: 'obb',
        x: p.x + off.x,
        z: p.z + off.z,
        hw,
        hd,
        rot: p.rotY + bry,
        cameraTopY: hi,
        baseY: lo,
        moveTopY: hi,
        standable: standableSurface(hw, hd, hi - base),
        ...(topSlope ? { topSlope } : {}),
      });
    }
    return;
  }
  // Tilted (the gizmo's X/Z rings): each box's 8 corners go through the model's
  // FULL rotation, then a yaw-OBB is fitted over their XZ shadow with the
  // corners' Y span as the band, the closest shape this engine's yaw-banded
  // colliders can represent.
  const m = eulerMatrix(tiltX, p.rotY, tiltZ);
  for (const b of baked) {
    const bry = (b as { ry?: number }).ry ?? 0;
    const bc = Math.cos(bry);
    const bs = Math.sin(bry);
    const corners: Point3[] = [];
    for (let i = 0; i < 8; i++) {
      const cxl = (i & 1 ? 1 : -1) * b.hx;
      const cyl = (i & 2 ? 1 : -1) * b.hy;
      const czl = (i & 4 ? 1 : -1) * b.hz;
      const mx = (b.x + cxl * bc + czl * bs) * sx;
      const mz = (b.z - cxl * bs + czl * bc) * sz;
      corners.push(applyMat(m, mx, (b.y + cyl) * sy, mz));
    }
    // Frame yaw from the box's longest rotated axis shadow (a vertical axis
    // casts none; the fence convention is rot = atan2(-dz, dx)).
    const axisX = applyMat(m, bc, 0, -bs);
    const axisZ = applyMat(m, bs, 0, bc);
    const dir =
      Math.hypot(axisX.x, axisX.z) * b.hx >= Math.hypot(axisZ.x, axisZ.z) * b.hz ? axisX : axisZ;
    const rot = Math.hypot(dir.x, dir.z) > 1e-6 ? Math.atan2(-dir.z, dir.x) : p.rotY;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let loY = Infinity;
    let hiY = -Infinity;
    for (const c of corners) {
      const local = rotY(c.x, c.z, -rot);
      if (local.x < minU) minU = local.x;
      if (local.x > maxU) maxU = local.x;
      if (local.z < minV) minV = local.z;
      if (local.z > maxV) maxV = local.z;
      if (c.y < loY) loY = c.y;
      if (c.y > hiY) hiY = c.y;
    }
    const center = rotY((minU + maxU) / 2, (minV + maxV) / 2, rot);
    const lo = base + lift + loY;
    const hi = base + lift + hiY;
    const hw = Math.max(0.05, (maxU - minU) / 2);
    const hd = Math.max(0.05, (maxV - minV) / 2);
    out.push({
      type: 'obb',
      x: p.x + center.x,
      z: p.z + center.z,
      hw,
      hd,
      rot,
      cameraTopY: hi,
      baseY: lo,
      moveTopY: hi,
      standable: standableSurface(hw, hd, hi - base),
    });
  }
}

// Editor-placed assets with a collide footprint (custom maps only; the
// built-in world has no placements). The ONE placement record drives both the
// renderer and this collider, so what you see is what you collide with.
//
// Shape resolution, most specific first. A bare circle is the LAST resort:
// it is what a placement gets when nothing knows the asset's real footprint,
// and for a long stretch it was the only thing emitted here, so every house,
// wall and market stall a maker placed blocked as a disc the size of its
// widest point. Everything below exists to stop that.
//
//   p.hitboxes        hand-edited boxes / the fine mesh bake on THIS
//                     placement. The maker's own edit, so it wins outright.
//   p.collideCustom   the maker deliberately kept the simple radius/shape.
//   ramp decks        a walkable deck carries the floor (placement_ramps.ts),
//                     so the body must NOT also wall the ramp it belongs to.
//   baked boxes       the per-asset table (asset_collision.generated.ts) or a
//                     Collision Master override, which is what gives all 1300+
//                     catalogue assets a real shape.
//   circle / square   the legacy footprint.
export function pushPlacementColliders(out: Collider[], content: WorldContent, seed: number): void {
  for (const p of content.placements ?? []) {
    // The opt-in gate, and it must stay FIRST. custom_map.ts only writes
    // collideRadius when the placement's collision mode is not 'none', so an
    // absent radius IS the maker's "this one is decoration", and every shape
    // below (baked boxes especially) would otherwise hand it collision anyway,
    // silently breaking the editor's collide toggle and decorationsMode.
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    // Everything this placement emits gets a dev attribution stamp (see
    // Collider.src) naming the model path and which lane produced the shape.
    const srcMark = out.length;
    const stamp = (lane: string): void => {
      const src = `${p.path}#${lane}`;
      for (let i = srcMark; i < out.length; i++) out[i].src = src;
    };
    // Detached placements anchor at their frozen ground (they can sit INSIDE a
    // cave); grounded ones stand on the TERRAIN, the same seat the renderer
    // (placed_assets.ts) and the asset's own ramp decks (placement_ramps.ts)
    // use. Not groundHeight: that already includes this placement's own floor
    // deck, so a building with a walkable ground floor had every box lifted by
    // the deck height (the tavern's 2F floor boxes sat 0.37yd above the stair
    // summit and walled the landing). Either way the base gates the pass-under
    // check, so tubes run beneath surface decor but a rock placed down in the
    // cave still blocks.
    const base = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, seed);
    if (p.worldPropKind === 'fence' && p.worldPropWidth) {
      const width = p.worldPropWidth * p.scale * (p.scaleX ?? 1);
      const depth = (p.worldPropDepth ?? 0.1) * p.scale * (p.scaleZ ?? 1);
      out.push({
        type: 'obb',
        x: p.x,
        z: p.z,
        hw: width / 2 + FENCE_END_PAD,
        hd: Math.max(FENCE_HALF_DEPTH, depth / 2),
        rot: p.rotY,
        cameraTopY: base + (p.y ?? 0) + FENCE_RAIL_HEIGHT,
        baseY: base + (p.y ?? 0),
        isFence: true,
      });
      stamp('fence');
      continue;
    }
    // Collision Master VOLUMES come first, ahead of every derived shape: the
    // maker modelled them and the editor draws them as the collision outline,
    // so they ARE the contract. This takes exactly the placements the baked-box
    // branch below would have taken (`derived`), hand-edited hitboxes, a
    // hand-picked simple footprint and live session ramps still outrank the
    // asset default, and swaps the rectangle FITTED to each band for the
    // band's real outline.
    const derived = !(
      (p.hitboxes && p.hitboxes.length > 0) ||
      p.collideCustom ||
      (p.ramps && p.ramps.length > 0)
    );
    const prisms = derived
      ? authoredPrismsForPath(p.path, p.scale > 0 ? p.scale : 1)
      : NO_AUTHORED_PRISMS;
    if (prisms.length > 0) {
      emitPlacementPrisms(out, p, prisms, base);
      stamp('prism');
      continue;
    }
    const baked =
      p.hitboxes && p.hitboxes.length > 0
        ? p.hitboxes
        : p.collideCustom || (p.ramps && p.ramps.length > 0)
          ? null
          : bakedBoxesForPath(p.path, content.assetCollision);
    if (baked) {
      emitPlacementBoxes(out, p, baked, base);
      stamp(p.hitboxes && p.hitboxes.length > 0 ? 'hitboxes' : 'baked');
      continue;
    }
    // A placement with walkable ramp DECKS is walk-through except for the deck
    // floor it raises (placement_ramps.ts): the legacy circle below would wall
    // the player off their own ramp.
    //
    // BOTH deck sources count. `p.ramps` is a live Collision Master session
    // (pre-Lock-In); `authoredRampsForPath` is the SAVED override, and it has to
    // be checked here too, a stairs placement stamped with a simple footprint
    // before its ramp was authored reaches this line with `baked` null and used
    // to pick up a solid circle ("I can't walk up my own ramp, I get stuck").
    // Hand-edited `hitboxes` are deliberate blockers (a railing) and returned
    // above, so this never swallows one.
    if (p.ramps && p.ramps.length > 0) continue;
    if (authoredRampsForPath(p.path).length > 0) continue;
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    const legacyTop = base + Math.max(2.5, p.collideRadius * 2);
    if (p.collideShape === 'square') {
      out.push({
        type: 'obb',
        x: p.x,
        z: p.z,
        hw: p.collideRadius,
        hd: p.collideRadius,
        rot: p.rotY,
        cameraTopY: legacyTop,
        baseY: base,
      });
      stamp('square');
      continue;
    }
    out.push({
      type: 'circle',
      x: p.x,
      z: p.z,
      r: p.collideRadius,
      cameraTopY: legacyTop,
      baseY: base,
    });
    stamp('circle');
  }
}

// Editor-authored collider volumes (custom maps only): the editor's own
// collision primitives, placed as reserved 'collider/<kind>' placements and
// resolved by sim/collider_volumes.ts. Boxes and walls are full-height OBBs
// (a jump never clears one) and spheres are circles. PLANES deliberately emit
// nothing here: they do not block, they raise the walkable floor, which
// world.groundHeight reads straight off content.colliderVolumes.
export function pushColliderVolumeColliders(
  out: Collider[],
  content: WorldContent,
  seed: number,
): void {
  for (const v of content.colliderVolumes ?? []) {
    if (v.kind === 'box' || v.kind === 'wall') {
      out.push({
        type: 'obb',
        x: v.x,
        z: v.z,
        hw: v.sizeX / 2,
        hd: v.sizeZ / 2,
        rot: v.rotY,
        cameraTopY: topY(seed, v.x, v.z, Math.max(1, v.sizeY)),
        underY: topY(seed, v.x, v.z, 0),
      });
    } else if (v.kind === 'sphere') {
      out.push({
        type: 'circle',
        x: v.x,
        z: v.z,
        r: v.sizeX / 2,
        cameraTopY: topY(seed, v.x, v.z, Math.max(1, v.sizeX)),
        underY: topY(seed, v.x, v.z, 0),
      });
    }
  }
}
