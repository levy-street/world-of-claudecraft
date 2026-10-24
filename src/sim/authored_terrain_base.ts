// The authored-map terrain BASE: what an authored (Studio) map's ground is
// before the maker's sculpt edits (terrain_edit_layer.ts) land on top. The
// editor writes these fields; the sim reads them here so world.ts (at its
// monolith ceiling) stays a thin consumer:
//   - a presentation map (blank, interior, ...) is a FLAT SLATE at
//     y 0, unless the maker ran Generate Terrain (`terrainBase`): then the base
//     is the shipped world's natural heightfield sampled at the picked offset
//     (raw baseHeight: zone shapes, lakes, coasts, without the built-in camps,
//     ridge walls or road shaping, which belong to the shipped content);
//   - a LINKED map (`linkedMap`, custom_map.ts linkedWorldContent) replaces the
//     overworld base inside its rect with its own slate or Generate Terrain
//     source, easing back into the shipped landscape across an edge band, and
//     its rect is never the lethal open sea (a map placed offshore is ground).
//
// Authored maps only: the built-in world (and a plain variant of it) has no
// presentation mode and no linkedMap, so every function here is a no-op there
// and the parity goldens are untouched. Pure and host-agnostic: no RNG, no DOM.
// world.ts passes its private baseHeight in as the sampler.

import { getActiveWorldContent } from './data';
import { isAuthoredMapPresentation } from './map_presentation';

/** world.ts's raw natural heightfield, (x, z, seed) to height. */
export type BaseHeightSampler = (x: number, z: number, seed: number) => number;

/** How far inside a linked map's rect the shipped terrain finishes easing
 *  into the map's own heightfield (yards). */
export const LINKED_MAP_EDGE_BAND = 14;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** An authored presentation map's base height before its sculpt edits, or
 *  undefined when the shipped overworld pipeline owns the ground. */
export function authoredSlateBase(
  x: number,
  z: number,
  seed: number,
  baseHeight: BaseHeightSampler,
): number | undefined {
  const active = getActiveWorldContent();
  if (!isAuthoredMapPresentation(active.presentationMode)) return undefined;
  const tb = active.terrainBase;
  return tb ? baseHeight(x + tb.x, z + tb.z, seed) : 0;
}

/** A linked map's own terrain over the finished overworld height `h`, blended
 *  in across LINKED_MAP_EDGE_BAND; `h` unchanged outside its rect. */
export function applyLinkedMapTerrain(
  x: number,
  z: number,
  seed: number,
  h: number,
  baseHeight: BaseHeightSampler,
): number {
  const lm = getActiveWorldContent().linkedMap;
  if (!lm) return h;
  const lx = x - lm.anchor.x;
  const lz = z - lm.anchor.z;
  const inset = Math.min(lx - lm.minX, lm.maxX - lx, lz - lm.minZ, lm.maxZ - lz);
  if (inset <= 0) return h;
  const tb = lm.terrainBase;
  const mapH = tb ? baseHeight(lx + tb.x, lz + tb.z, seed) : 0;
  const t = smoothstep(0, LINKED_MAP_EDGE_BAND, inset);
  return h * (1 - t) + mapH * t;
}

/** True inside a linked map's rect (edges included): the maker's ground, so
 *  never the lethal open sea even where it was placed beyond the coasts. */
export function inLinkedMapRect(x: number, z: number): boolean {
  const lm = getActiveWorldContent().linkedMap;
  if (!lm) return false;
  const lx = x - lm.anchor.x;
  const lz = z - lm.anchor.z;
  return lx >= lm.minX && lx <= lm.maxX && lz >= lm.minZ && lz <= lm.maxZ;
}
