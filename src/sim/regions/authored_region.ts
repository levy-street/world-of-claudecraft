// Authored regions: a map the editor exported IS the region.
//
// Everything outside the overworld - the Ravenrift battleground first, with
// dungeons, delves and the arena sharing its fixed-origin shape - is defined in
// code. That makes it editable only by whoever is willing to edit consts, and
// it caps how good those places can look: there is no way to put a catalogue
// asset, a light or a sound into one.
//
// A region can instead be opened in the map editor (editor/shipped_maps.ts),
// dressed with the whole toolset, and exported back as a generated module that
// this layer mounts. The exported map carries two things:
//
//   layout      the handful of anchors the GAME MODE reasons about - where each
//               team's flag, respawn ring, spawn banner and graveyard sit, and
//               where the rune pads are. The mode logic, the minimap and the
//               spirit/graveyard code all read these, so they stay a record
//               rather than being guessed back out of models.
//   placements  everything you see and bump into, in the region's own local
//               coordinates. Collision comes from the placements themselves, so
//               what you walk into is what was drawn - the same contract every
//               other map in this editor has.
//
// A region with no generated module behaves exactly as it did before: the
// shipped consts stay in charge. Nothing here runs in that case.

import { autoCollideRadius, boxesForAssetId } from '../asset_collision';
/** Game-mode anchors of an authored region. The writer that fills this record lives
 *  in the Studio tooling, so the runtime keeps it opaque. */
export type BgLayoutRecord = Readonly<Record<string, unknown>>;

import { colliderVolumeFromPlacement, isColliderAssetId } from '../collider_volumes';
import type { LayoutCollider } from '../colliders';
import { dungeonKitModuleScale } from '../dungeon_kit_dims';
import { effectiveCollisionMode, type MapPlacement } from '../map_doc';

export interface AuthoredRegion {
  /** Game-mode anchors, in the region's local space. */
  layout: BgLayoutRecord;
  /** Everything the region is built from, in the region's local space. */
  placements: readonly MapPlacement[];
}

/** Kit-module namespace the region builders can instantiate today. A placement
 *  outside it exports fine but has nothing to build it with, so the editor
 *  refuses the export rather than shipping an invisible object. */
export const REGION_KIT_PREFIX = 'dungeon/';

/** True when a region builder can actually render this placement. */
export function regionCanBuild(p: MapPlacement): boolean {
  return isColliderAssetId(p.assetId) || p.assetId.startsWith(REGION_KIT_PREFIX);
}

/** Kit module kinds an authored region needs loaded before it can build. */
export function authoredKitKinds(region: AuthoredRegion | null): string[] {
  if (!region) return [];
  const kinds = new Set<string>();
  for (const p of region.placements) {
    if (p.assetId.startsWith(REGION_KIT_PREFIX)) {
      kinds.add(p.assetId.slice(REGION_KIT_PREFIX.length));
    }
  }
  return [...kinds];
}

/** One kit module to instance, in the region's local space. Structurally the
 *  render layer's BgModulePlacement, restated here so the sim layer keeps no
 *  dependency on it. */
export interface RegionModulePlacement {
  kind: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  scale: [number, number, number];
}

/** An authored region's placements as kit modules the region builders can
 *  instance. Collider volumes and anything outside the kit are skipped: they
 *  are collision and authoring markers, not geometry. */
export function authoredRegionModules(region: AuthoredRegion | null): RegionModulePlacement[] {
  const out: RegionModulePlacement[] = [];
  if (!region) return out;
  for (const p of region.placements) {
    if (!p.assetId.startsWith(REGION_KIT_PREFIX)) continue;
    const kind = p.assetId.slice(REGION_KIT_PREFIX.length);
    const s = p.scale > 0 ? p.scale : 1;
    // Back from normalized placement units into the module units the region
    // builders instance at (sim/dungeon_kit_dims). The editor multiplied by the
    // same factor on the way in, so an untouched round trip is the identity.
    const m = (axis: number): number => dungeonKitModuleScale(kind, s * axis);
    out.push({
      kind,
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      ry: p.rotY,
      scale: [m(p.scaleX ?? 1), m(p.scaleY ?? 1), m(p.scaleZ ?? 1)],
    });
  }
  return out;
}

function rotate(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/**
 * Region-local colliders for an authored region's placements.
 *
 * A region's ground is flat at y=0, so these need none of the terrain sampling
 * the open world's collider build does - the `cameraTopY` values are the
 * object's own height and nothing else.
 */
export function authoredRegionColliders(region: AuthoredRegion | null): LayoutCollider[] {
  const out: LayoutCollider[] = [];
  if (!region) return out;
  for (const p of region.placements) {
    // Editor collider volumes (the invisible box/sphere/wall primitives) resolve
    // through the one shared resolver, so a region blocks exactly where the
    // editor drew the volume.
    if (isColliderAssetId(p.assetId)) {
      const v = colliderVolumeFromPlacement(p);
      if (!v) continue;
      if (v.kind === 'box' || v.kind === 'wall') {
        out.push({
          type: 'obb',
          x: v.x,
          z: v.z,
          hw: v.sizeX / 2,
          hd: v.sizeZ / 2,
          rot: v.rotY,
          cameraTopY: Math.max(1, v.sizeY),
          baseY: 0,
        });
      } else if (v.kind === 'sphere') {
        out.push({
          type: 'circle',
          x: v.x,
          z: v.z,
          r: v.sizeX / 2,
          cameraTopY: Math.max(1, v.sizeX),
          baseY: 0,
        });
      }
      continue;
    }
    if (!p.collide) continue;
    const mode = effectiveCollisionMode(p);
    if (mode === 'none') continue;
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    const lift = p.y ?? 0;
    const boxes = mode === 'baked' ? (p.hitboxes ?? boxesForAssetId(p.assetId)) : null;
    if (boxes && boxes.length > 0) {
      for (const b of boxes) {
        const off = rotate(b.x * sx, b.z * sz, p.rotY);
        out.push({
          type: 'obb',
          x: p.x + off.x,
          z: p.z + off.z,
          hw: Math.max(0.05, b.hx * sx),
          hd: Math.max(0.05, b.hz * sz),
          // Hand-edited hitboxes may carry a per-box yaw on top of the
          // placement's; a generated bake never does.
          rot: p.rotY + ((b as { ry?: number }).ry ?? 0),
          cameraTopY: lift + (b.y + b.hy) * sy,
          baseY: lift + (b.y - b.hy) * sy,
        });
      }
      continue;
    }
    // No bake (or a hand-picked simple footprint): the legacy circle/square.
    const r = p.collideRadius ?? autoCollideRadius(p.assetId, s, mode);
    if (!(r > 0)) continue;
    if (p.collideShape === 'square') {
      out.push({
        type: 'obb',
        x: p.x,
        z: p.z,
        hw: r,
        hd: r,
        rot: p.rotY,
        cameraTopY: lift + Math.max(2.5, r * 2),
        baseY: lift,
      });
    } else {
      out.push({
        type: 'circle',
        x: p.x,
        z: p.z,
        r,
        cameraTopY: lift + Math.max(2.5, r * 2),
        baseY: lift,
      });
    }
  }
  return out;
}
