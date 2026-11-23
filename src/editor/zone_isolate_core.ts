// Zone isolate mode + the Scene tab's zone tree: every decision with no DOM.
// The viewport/renderer consume the rect predicates; the inspector consumes
// the tree. tests/editor_zone_isolate.test.ts pins the behaviour.

import { STRIP_MAX_X, STRIP_MIN_X } from '../sim/data';

export interface ZoneRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A zone's world rect: the strip extents fill in absent x columns, exactly
 *  the sim `zoneAt` convention. */
export function zoneRectOf(zone: {
  xMin?: number;
  xMax?: number;
  zMin: number;
  zMax: number;
}): ZoneRect {
  return {
    minX: zone.xMin ?? STRIP_MIN_X,
    maxX: zone.xMax ?? STRIP_MAX_X,
    minZ: zone.zMin,
    maxZ: zone.zMax,
  };
}

/**
 * The rect covering every named zone: the residency rect of a multi-zone
 * stream. Zones are z-bands of the same strip, so their union is a rect in
 * practice; an id with no zone is skipped, and an empty set gives null (which
 * every residency consumer already reads as "Full Build").
 */
export function zonesUnionRect(
  zones: readonly { id: string; xMin?: number; xMax?: number; zMin: number; zMax: number }[],
  ids: readonly string[],
): ZoneRect | null {
  let out: ZoneRect | null = null;
  for (const id of ids) {
    const zone = zones.find((q) => q.id === id);
    if (!zone) continue;
    const r = zoneRectOf(zone);
    out = out
      ? {
          minX: Math.min(out.minX, r.minX),
          maxX: Math.max(out.maxX, r.maxX),
          minZ: Math.min(out.minZ, r.minZ),
          maxZ: Math.max(out.maxZ, r.maxZ),
        }
      : r;
  }
  return out;
}

export function pointInRect(rect: ZoneRect, x: number, z: number): boolean {
  return x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
}

export function rectsIntersect(a: ZoneRect, b: ZoneRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// Isolate view distance: see across the whole zone with headroom, never so far
// that the fog invites the (deliberately unbuilt) rest of the world into view
// as popping vista. Clamped by the caller against the renderer's own limits.
const ISOLATE_VIEW_MARGIN = 80;
export function isolateViewDistance(rect: ZoneRect): number {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  return Math.ceil(Math.hypot(w, d) / 2 + ISOLATE_VIEW_MARGIN);
}

/**
 * The zone owning a point, by the sim's rect walk: containment first, else the
 * southmost band whose zMax lies beyond the point (the same clamp `zoneAt`
 * applies, so a placement nudged past an edge still files under a zone).
 * Null only when the map has no zones at all.
 */
export function zoneIdForPoint(
  zones: readonly { id: string; xMin?: number; xMax?: number; zMin: number; zMax: number }[],
  x: number,
  z: number,
): string | null {
  let fallback: string | null = null;
  let fallbackZMax = Infinity;
  for (const zone of zones) {
    if (z >= zone.zMax) continue;
    if (zone.zMax < fallbackZMax) {
      fallback = zone.id;
      fallbackZMax = zone.zMax;
    }
    if (z >= zone.zMin && x >= (zone.xMin ?? STRIP_MIN_X) && x < (zone.xMax ?? STRIP_MAX_X)) {
      return zone.id;
    }
  }
  if (fallback !== null) return fallback;
  // North of every band: file under the northmost zone rather than nowhere.
  let north: string | null = null;
  let northZMax = -Infinity;
  for (const zone of zones) {
    if (zone.zMax > northZMax) {
      north = zone.id;
      northZMax = zone.zMax;
    }
  }
  return north;
}

// ---- world props ------------------------------------------------------------

/**
 * Restrict a world's static prop dressing to `rect`.
 *
 * Placements are filtered at the view (they are the document's own objects),
 * but the built-in dressing, buildings, wells, great trees, campfires, fences
 *, is built ONCE for the whole world by `render/props.ts buildProps` straight
 * into one scene group with no per-zone cull. Isolate mode therefore has to cut
 * it at the SOURCE (the active WorldContent) and rebuild the engine, or every
 * building in the world stays standing while its terrain unloads underneath.
 *
 * Shape-agnostic on purpose: props is a bag of differently-shaped arrays, and a
 * key this does not recognise passes through untouched rather than vanishing.
 * Point-like entries ({x, z}) keep their position; segment-like entries
 * ({x1, z1, x2, z2}) survive if either end is inside.
 */
export function propsWithinRect<T extends object>(props: T, rect: ZoneRect): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    out[key] = value.filter((entry) => {
      if (entry === null || typeof entry !== 'object') return true;
      const e = entry as Record<string, unknown>;
      if (typeof e.x === 'number' && typeof e.z === 'number') {
        return pointInRect(rect, e.x, e.z);
      }
      if (
        typeof e.x1 === 'number' &&
        typeof e.z1 === 'number' &&
        typeof e.x2 === 'number' &&
        typeof e.z2 === 'number'
      ) {
        return pointInRect(rect, e.x1, e.z1) || pointInRect(rect, e.x2, e.z2);
      }
      // An entry with no position at all is configuration, not dressing.
      return true;
    });
  }
  return out as T;
}

// ---- Scene tree -------------------------------------------------------------

/** One placement row as the app reports it, plus its world position. */
export interface SceneRowInput {
  index: number;
  name: string;
  hidden: boolean;
  selected: boolean;
  x: number;
  z: number;
  /** Category-ish group key, e.g. the assetId's first path segment. */
  group: string;
}

export interface SceneTreeGroup {
  group: string;
  rows: SceneRowInput[];
}

export interface SceneTreeZone {
  zoneId: string;
  zoneName: string;
  count: number;
  groups: SceneTreeGroup[];
}

/**
 * zone → group → placement, in zone document order; groups by descending size
 * then name; rows keep document order. Zones with no placements still appear
 * (that is where the current-zone radio for an empty zone lives).
 */
export function buildSceneTree(
  rows: readonly SceneRowInput[],
  zones: readonly {
    id: string;
    name: string;
    xMin?: number;
    xMax?: number;
    zMin: number;
    zMax: number;
  }[],
): SceneTreeZone[] {
  const byZone = new Map<string, Map<string, SceneRowInput[]>>();
  for (const zone of zones) byZone.set(zone.id, new Map());
  for (const row of rows) {
    const zoneId = zoneIdForPoint(zones, row.x, row.z);
    if (zoneId === null) continue;
    const groups = byZone.get(zoneId);
    if (!groups) continue;
    const list = groups.get(row.group);
    if (list) list.push(row);
    else groups.set(row.group, [row]);
  }
  return zones.map((zone) => {
    const groups = [...(byZone.get(zone.id) ?? new Map<string, SceneRowInput[]>()).entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([group, groupRows]) => ({ group, rows: groupRows }));
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      count: groups.reduce((s, g) => s + g.rows.length, 0),
      groups,
    };
  });
}
