// Road editing in City Build: which road a click lands on, which waypoint or
// segment of it, and the document edits that move, insert or delete a
// waypoint or remove a whole road. Two kinds of road are editable:
//
//  - authored roads (MapDoc.roadDefs), drawn in the Roads tab, edited in place
//    by id;
//  - legacy roads (MapDoc.content.roads, the shipped world's dirt roads on a
//    map seeded from it), which the document never rewrites: a change is a
//    MapDoc.roadEdits entry keyed by the road's index, so the change-only push
//    merges road by road and Reset is just dropping the entry.
//
// Pure and DOM-free. Every edit returns fresh arrays and records and never
// mutates its inputs, so an undo step can hold the before and after states.

import { MAX_ROAD_POINTS, type RoadDef, type RoadEdit, type RoadEdits } from '../sim/map_doc';

export interface RoadPoint {
  x: number;
  z: number;
}

export type Polyline = readonly RoadPoint[];

/** One editable road: an authored def by id, or a legacy road by index. */
export type RoadRef = { kind: 'authored'; id: string } | { kind: 'builtin'; index: number };

/** The road layers of one document. `legacy` is content.roads as stored. */
export interface RoadLayers {
  legacy: readonly Polyline[];
  edits: RoadEdits | undefined;
  defs: RoadDef[] | undefined;
}

/** The two layers an edit writes. A write that leaves a layer alone hands
 *  back the same reference, so the app's other roadDefs undo steps (which
 *  hold the array) keep pointing at the live one. */
export interface RoadWrite {
  edits: RoadEdits | undefined;
  defs: RoadDef[] | undefined;
}

/** The decimal key a legacy road's edit is stored under. */
export function roadEditKey(index: number): string {
  return String(index);
}

export function sameRoadRef(a: RoadRef | null, b: RoadRef | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'authored') return b.kind === 'authored' && a.id === b.id;
  return b.kind === 'builtin' && a.index === b.index;
}

/** The legacy roads with this map's edits applied: moved roads take their
 *  new waypoints and removed roads drop out. The SAME table the editor's
 *  active world, the playtest and Publish to Game project. With no edits the
 *  input comes back as is. */
export function applyRoadEdits(
  legacy: readonly Polyline[],
  edits: RoadEdits | undefined,
): readonly Polyline[] {
  if (!edits || Object.keys(edits).length === 0) return legacy;
  const out: Polyline[] = [];
  for (let i = 0; i < legacy.length; i++) {
    const edit = edits[roadEditKey(i)];
    if (!edit) out.push(legacy[i]);
    else if (!('removed' in edit)) out.push(edit.points);
  }
  return out;
}

/** A legacy road's edit state, for the road list and the inspector. */
export function builtinRoadState(
  edits: RoadEdits | undefined,
  index: number,
): 'default' | 'edited' | 'removed' {
  const edit = edits?.[roadEditKey(index)];
  if (!edit) return 'default';
  return 'removed' in edit ? 'removed' : 'edited';
}

/** The road's current waypoints, or null when it does not exist (or, for a
 *  legacy road, was removed on this map). */
export function roadPoints(layers: RoadLayers, ref: RoadRef): Polyline | null {
  if (ref.kind === 'authored') return layers.defs?.find((d) => d.id === ref.id)?.points ?? null;
  const base = layers.legacy[ref.index];
  if (!base) return null;
  const edit = layers.edits?.[roadEditKey(ref.index)];
  if (!edit) return base;
  return 'removed' in edit ? null : edit.points;
}

export function samePolyline(a: Polyline, b: Polyline): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].z !== b[i].z) return false;
  }
  return true;
}

function withEdit(
  edits: RoadEdits | undefined,
  key: string,
  edit: RoadEdit | null,
): RoadEdits | undefined {
  const next: RoadEdits = { ...(edits ?? {}) };
  if (edit) next[key] = edit;
  else delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Give a road new waypoints. A legacy road set back to exactly its stored
 *  shape drops its edit entry, so an undone drag leaves no trace in the
 *  document. Returns null when the road does not exist or the points are
 *  not a road (fewer than two). */
export function withRoadPoints(
  layers: RoadLayers,
  ref: RoadRef,
  points: Polyline,
): RoadWrite | null {
  if (points.length < 2 || points.length > MAX_ROAD_POINTS) return null;
  const copy = points.map((p) => ({ x: p.x, z: p.z }));
  if (ref.kind === 'authored') {
    const defs = layers.defs ?? [];
    const at = defs.findIndex((d) => d.id === ref.id);
    if (at < 0) return null;
    const next = defs.slice();
    next[at] = { ...defs[at], points: copy };
    return { edits: layers.edits, defs: next };
  }
  const base = layers.legacy[ref.index];
  if (!base || builtinRoadState(layers.edits, ref.index) === 'removed') return null;
  const key = roadEditKey(ref.index);
  const edit = samePolyline(base, copy) ? null : { points: copy };
  return { edits: withEdit(layers.edits, key, edit), defs: layers.defs };
}

/** Add an authored road (the Draw mode's Finish). Always a fresh array, so
 *  every roadDefs write goes through the same snapshot undo. */
export function withRoadAdded(layers: RoadLayers, def: RoadDef): RoadWrite {
  return { edits: layers.edits, defs: [...(layers.defs ?? []), def] };
}

/** Remove a road from this map: an authored def is deleted outright, a
 *  legacy road gets a removed entry. Null when there is nothing to remove. */
export function withRoadRemoved(layers: RoadLayers, ref: RoadRef): RoadWrite | null {
  if (ref.kind === 'authored') {
    const defs = layers.defs ?? [];
    if (!defs.some((d) => d.id === ref.id)) return null;
    const next = defs.filter((d) => d.id !== ref.id);
    return { edits: layers.edits, defs: next.length > 0 ? next : undefined };
  }
  if (!layers.legacy[ref.index]) return null;
  if (builtinRoadState(layers.edits, ref.index) === 'removed') return null;
  return {
    edits: withEdit(layers.edits, roadEditKey(ref.index), { removed: true }),
    defs: layers.defs,
  };
}

/** Put a legacy road back as the map stores it (undoes a move or a
 *  removal). Null when it already is. */
export function withBuiltinRoadReset(layers: RoadLayers, index: number): RoadWrite | null {
  if (builtinRoadState(layers.edits, index) === 'default') return null;
  return { edits: withEdit(layers.edits, roadEditKey(index), null), defs: layers.defs };
}

// ---------------------------------------------------------------------------
// Waypoint edits on one polyline (null = refused).
// ---------------------------------------------------------------------------

export function withWaypointMoved(
  points: Polyline,
  index: number,
  to: RoadPoint,
): RoadPoint[] | null {
  if (index < 0 || index >= points.length) return null;
  const next = points.map((p) => ({ x: p.x, z: p.z }));
  next[index] = { x: to.x, z: to.z };
  return next;
}

/** Insert a waypoint so it becomes index `at` (1 to length - 1: on a segment,
 *  never past either end). */
export function withWaypointInserted(
  points: Polyline,
  at: number,
  p: RoadPoint,
): RoadPoint[] | null {
  if (at < 1 || at > points.length - 1 || points.length >= MAX_ROAD_POINTS) return null;
  const next = points.map((q) => ({ x: q.x, z: q.z }));
  next.splice(at, 0, { x: p.x, z: p.z });
  return next;
}

/** Delete one waypoint; a road keeps at least two. */
export function withWaypointDeleted(points: Polyline, index: number): RoadPoint[] | null {
  if (points.length <= 2 || index < 0 || index >= points.length) return null;
  const next = points.map((p) => ({ x: p.x, z: p.z }));
  next.splice(index, 1);
  return next;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/** The waypoint nearest `at` within `tolerance` yards, or null. */
export function nearestWaypoint(points: Polyline, at: RoadPoint, tolerance: number): number | null {
  let best: number | null = null;
  let bestD = tolerance * tolerance;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i].x - at.x) ** 2 + (points[i].z - at.z) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The closest point on segment ab to p, and its squared distance. */
function closestOnSegment(
  a: RoadPoint,
  b: RoadPoint,
  p: RoadPoint,
): { point: RoadPoint; d2: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  const point = { x: a.x + dx * t, z: a.z + dz * t };
  return { point, d2: (point.x - p.x) ** 2 + (point.z - p.z) ** 2 };
}

/** The segment nearest `at` within `tolerance`: `insertAt` is where a new
 *  waypoint on it goes (withWaypointInserted) and `point` the spot on the
 *  centerline under the cursor. */
export function nearestSegment(
  points: Polyline,
  at: RoadPoint,
  tolerance: number,
): { insertAt: number; point: RoadPoint } | null {
  let best: { insertAt: number; point: RoadPoint } | null = null;
  let bestD = tolerance * tolerance;
  for (let i = 0; i + 1 < points.length; i++) {
    const hit = closestOnSegment(points[i], points[i + 1], at);
    if (hit.d2 <= bestD) {
      bestD = hit.d2;
      best = { insertAt: i + 1, point: hit.point };
    }
  }
  return best;
}

function polylineDistance2(points: Polyline, at: RoadPoint): number {
  if (points.length === 1) return (points[0].x - at.x) ** 2 + (points[0].z - at.z) ** 2;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const d2 = closestOnSegment(points[i], points[i + 1], at).d2;
    if (d2 < best) best = d2;
  }
  return best;
}

/** Every editable road with its current waypoints: authored first (they sit
 *  on top), then the legacy roads not removed on this map. */
export function editableRoads(layers: RoadLayers): { ref: RoadRef; points: Polyline }[] {
  const out: { ref: RoadRef; points: Polyline }[] = [];
  for (const def of layers.defs ?? [])
    out.push({ ref: { kind: 'authored', id: def.id }, points: def.points });
  for (let i = 0; i < layers.legacy.length; i++) {
    const points = roadPoints(layers, { kind: 'builtin', index: i });
    if (points) out.push({ ref: { kind: 'builtin', index: i }, points });
  }
  return out;
}

/** The road whose centerline passes nearest `at` within `tolerance`. An
 *  authored road wins a tie, since it is drawn over the legacy one. */
export function pickRoad(layers: RoadLayers, at: RoadPoint, tolerance: number): RoadRef | null {
  let best: RoadRef | null = null;
  let bestD = tolerance * tolerance;
  for (const road of editableRoads(layers)) {
    const d2 = polylineDistance2(road.points, at);
    if (d2 < bestD || (best === null && d2 <= bestD)) {
      bestD = d2;
      best = road.ref;
    }
  }
  return best;
}

/** The waypoints an edit from `before` to `after` touched, plus one
 *  neighbor each side from both shapes: the stretch of road whose curve
 *  (and so whose terrain flattening and splat) can have changed. Catmull-Rom
 *  smoothing reads one more waypoint each side, so the neighbors matter.
 *  Empty when nothing changed. */
export function touchedRoadStretch(before: Polyline | null, after: Polyline | null): RoadPoint[] {
  const a = before ?? [];
  const b = after ?? [];
  let head = 0;
  while (head < a.length && head < b.length && a[head].x === b[head].x && a[head].z === b[head].z) {
    head++;
  }
  if (head === a.length && head === b.length) return [];
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail].x === b[b.length - 1 - tail].x &&
    a[a.length - 1 - tail].z === b[b.length - 1 - tail].z
  ) {
    tail++;
  }
  const out: RoadPoint[] = [];
  const take = (side: Polyline): void => {
    const from = Math.max(0, head - 2);
    const to = Math.min(side.length - 1, side.length - tail + 1);
    for (let i = from; i <= to; i++) out.push({ x: side[i].x, z: side[i].z });
  };
  take(a);
  take(b);
  return out;
}
