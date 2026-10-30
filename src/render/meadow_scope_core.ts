// WHERE the painted-meadow treatment applies: the one predicate the Eastbrook
// grass patch field (meadow_patch_core.ts) and the clustered vale bushes
// (meadow_bush_core.ts) share, plus the scope's decoration set (its rocks and
// tree trunks), which both read and which is costly enough to build once.
//
// The scope is a zone by id on the BUILT-IN world (a live-world preview counts):
// an authored map keeps the shipped carpet everywhere. Its weight feathers in
// from every border the zone shares with a neighbour, along a line that wanders,
// so the patchy meadow never meets the full carpet next door on a straight edge.
// A side on the world rim needs no feather (nothing grows past it).
//
// Pure and tier-blind: sim reads only (no Three, no DOM, no GFX), so every
// graphics tier resolves the same scope, the same weight and the same rocks.

import {
  getActiveWorldContent,
  getContentGeneration,
  isBuiltinWorldContent,
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
} from '../sim/data';
import { noise2 } from '../sim/rng';
import type { WorldContent } from '../sim/types';
import { type Decoration, generateDecorationsInBounds } from '../sim/world';

/** The zone the patchy meadow and its clustered bushes are scoped to. */
export const MEADOW_PATCH_ZONE_ID = 'eastbrook_vale';

/** Yards over which the treatment fades in from a shared zone border. */
export const MEADOW_SCOPE_FEATHER = 30;

/** How far (yards, each way) the fade's start wanders along a border. */
export const MEADOW_SCOPE_WANDER = 8;

/** Yards past the scope rect the decoration set reaches, so a rock just
 *  outside still rings the grass and bushes just inside. */
const DECORATION_PAD = 6;

export interface MeadowScope {
  readonly zoneId: string;
  readonly hub: { readonly x: number; readonly z: number; readonly radius: number };
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Which sides feather: false where the side is the world rim. */
  readonly featherMinX: boolean;
  readonly featherMaxX: boolean;
  readonly featherMinZ: boolean;
  readonly featherMaxZ: boolean;
  readonly seed: number;
  readonly content: WorldContent;
}

export function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

let scopeKey: { content: WorldContent; generation: number; seed: number } | null = null;
let scopeValue: MeadowScope | null = null;

/**
 * The meadow scope for `content` at `seed`, or null where the treatment does not
 * apply (an authored map, or a world without the zone). Cached on (content,
 * content generation, seed), so every consumer of one world shares one object.
 */
export function meadowScopeFor(
  seed: number,
  content: WorldContent = getActiveWorldContent(),
): MeadowScope | null {
  const generation = getContentGeneration();
  if (
    scopeKey &&
    scopeKey.content === content &&
    scopeKey.generation === generation &&
    scopeKey.seed === seed
  ) {
    return scopeValue;
  }
  scopeKey = { content, generation, seed };
  scopeValue = null;
  if (!isBuiltinWorldContent(content)) return null;
  const zone = content.zones.find((candidate) => candidate.id === MEADOW_PATCH_ZONE_ID);
  if (!zone) return null;
  const minX = zone.xMin ?? STRIP_MIN_X;
  const maxX = zone.xMax ?? STRIP_MAX_X;
  scopeValue = {
    zoneId: zone.id,
    hub: { x: zone.hub.x, z: zone.hub.z, radius: zone.hub.radius },
    minX,
    maxX,
    minZ: zone.zMin,
    maxZ: zone.zMax,
    featherMinX: minX > -WORLD_MAX_X,
    featherMaxX: maxX < WORLD_MAX_X,
    featherMinZ: zone.zMin > WORLD_MIN_Z,
    featherMaxZ: zone.zMax < WORLD_MAX_Z,
    seed,
    content,
  };
  return scopeValue;
}

/** True when (x, z) lies inside the scope rect at all (weight may still be 0
 *  on the feathered border). */
export function insideMeadowScopeRect(scope: MeadowScope | null, x: number, z: number): boolean {
  return !!scope && x >= scope.minX && x < scope.maxX && z >= scope.minZ && z < scope.maxZ;
}

/**
 * The treatment's weight at (x, z): 0 outside the scope and right at a shared
 * border, 1 once a feather's depth inside it. The fade starts somewhere within
 * two wander widths of the border, chosen by a slow noise, so its line meanders.
 */
export function meadowScopeWeight(scope: MeadowScope | null, x: number, z: number): number {
  if (!scope || !insideMeadowScopeRect(scope, x, z)) return 0;
  let inside = Number.POSITIVE_INFINITY;
  if (scope.featherMinX) inside = Math.min(inside, x - scope.minX);
  if (scope.featherMaxX) inside = Math.min(inside, scope.maxX - x);
  if (scope.featherMinZ) inside = Math.min(inside, z - scope.minZ);
  if (scope.featherMaxZ) inside = Math.min(inside, scope.maxZ - z);
  if (inside >= MEADOW_SCOPE_FEATHER + 2 * MEADOW_SCOPE_WANDER) return 1;
  const wander = (noise2(x * 0.041, z * 0.041, scope.seed + 0x3c1) - 0.5) * 2 * MEADOW_SCOPE_WANDER;
  return smoothstep01((inside - MEADOW_SCOPE_WANDER + wander) / MEADOW_SCOPE_FEATHER);
}

export interface MeadowScopeDecorations {
  readonly rocks: readonly Decoration[];
  readonly trees: readonly Decoration[];
}

const decorationCache = new WeakMap<MeadowScope, MeadowScopeDecorations>();

/** The scope's rocks and tree trunks (the sim's deterministic decoration field,
 *  the same records the renderer draws and the colliders stand), built once per
 *  scope. */
export function meadowScopeDecorations(scope: MeadowScope): MeadowScopeDecorations {
  const cached = decorationCache.get(scope);
  if (cached) return cached;
  const all = generateDecorationsInBounds(scope.seed, {
    minX: scope.minX - DECORATION_PAD,
    maxX: scope.maxX + DECORATION_PAD,
    minZ: scope.minZ - DECORATION_PAD,
    maxZ: scope.maxZ + DECORATION_PAD,
  });
  const out: MeadowScopeDecorations = {
    rocks: all.filter((d) => d.kind === 'rock'),
    trees: all.filter((d) => d.kind !== 'rock'),
  };
  decorationCache.set(scope, out);
  return out;
}
