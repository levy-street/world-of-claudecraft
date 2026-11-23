// City Build road editing (src/editor/road_edit_core.ts, road_edit_controller.ts):
// reshaping authored roads (MapDoc.roadDefs) and moving or removing the legacy
// roads a map carries (content.roads, the shipped world's dirt roads) through
// the per-map MapDoc.roadEdits record. Pinned here:
//  - waypoint move / insert / delete, with the two-waypoint floor and the
//    MAX_ROAD_POINTS ceiling, never mutating their input;
//  - a legacy road edit lands in roadEdits keyed by index, a road dragged back
//    to its stored shape drops its entry, Reset and Restore drop it too;
//  - picking: waypoint, segment, road (authored wins a tie), removed roads unpickable;
//  - the touched stretch covers the moved waypoint plus the Catmull-Rom reach;
//  - the controller makes ONE undo step per gesture, a plain click on the
//    line adds nothing, undo/redo restore both layers and the region refresh;
//  - the sanitizer keeps valid entries and drops hostile keys and shapes;
//  - the playtest/publish projection applies the edits (standalone and
//    linked), and leaves an unedited map's roads byte-identical;
//  - the change-only push merges legacy road edits by key and authored
//    roads by id.
import { describe, expect, it } from 'vitest';
import {
  type CustomMap,
  customMapToWorldContent,
  newFlatCustomMap,
} from '../src/editor/custom_map';
import { ensureMapItemIdsFromContent } from '../src/editor/map_item_ids';
import { mergeMapChanges } from '../src/editor/map_merge_core';
import { parseMap, serializeMap } from '../src/editor/persist';
import { RoadEditController, type RoadEditUndoEntry } from '../src/editor/road_edit_controller';
import {
  applyRoadEdits,
  builtinRoadState,
  nearestSegment,
  nearestWaypoint,
  pickRoad,
  type RoadLayers,
  type RoadPoint,
  roadPoints,
  touchedRoadStretch,
  withBuiltinRoadReset,
  withRoadPoints,
  withRoadRemoved,
  withWaypointDeleted,
  withWaypointInserted,
  withWaypointMoved,
} from '../src/editor/road_edit_core';
import { MAX_ROAD_POINTS, type RoadDef, sanitizeMapDoc } from '../src/sim/map_doc';

const line = (z: number, xs: number[]): RoadPoint[] => xs.map((x) => ({ x, z }));
const legacy = (): RoadPoint[][] => [line(0, [0, 10, 20, 30]), line(100, [0, 50])];
const def = (id: string, z: number): RoadDef => ({
  id,
  points: line(z, [0, 10, 20]),
  kind: 'road',
});

describe('waypoint edits', () => {
  const pts = line(0, [0, 10, 20]);

  it('moves, inserts and deletes without touching the input', () => {
    const frozen = JSON.stringify(pts);
    expect(withWaypointMoved(pts, 1, { x: 11, z: 5 })).toEqual([
      { x: 0, z: 0 },
      { x: 11, z: 5 },
      { x: 20, z: 0 },
    ]);
    expect(withWaypointInserted(pts, 1, { x: 5, z: 1 })?.map((p) => p.x)).toEqual([0, 5, 10, 20]);
    expect(withWaypointDeleted(pts, 1)?.map((p) => p.x)).toEqual([0, 20]);
    expect(JSON.stringify(pts)).toBe(frozen);
  });

  it('refuses out-of-range indices, an insert past either end, and a road under two', () => {
    expect(withWaypointMoved(pts, 3, { x: 0, z: 0 })).toBeNull();
    expect(withWaypointInserted(pts, 0, { x: 0, z: 0 })).toBeNull();
    expect(withWaypointInserted(pts, 3, { x: 0, z: 0 })).toBeNull();
    expect(withWaypointDeleted(line(0, [0, 10]), 0)).toBeNull();
    const full = Array.from({ length: MAX_ROAD_POINTS }, (_, i) => ({ x: i, z: 0 }));
    expect(withWaypointInserted(full, 1, { x: 0.5, z: 1 })).toBeNull();
  });
});

describe('road layers', () => {
  const layers = (over: Partial<RoadLayers> = {}): RoadLayers => ({
    legacy: legacy(),
    edits: undefined,
    defs: undefined,
    ...over,
  });

  it('a legacy road edit is an index-keyed entry; its stored shape drops it again', () => {
    const base = layers();
    const moved = withRoadPoints(base, { kind: 'builtin', index: 0 }, line(0, [0, 12, 20, 30]));
    expect(moved?.edits).toEqual({ '0': { points: line(0, [0, 12, 20, 30]) } });
    expect(builtinRoadState(moved?.edits, 0)).toBe('edited');
    const back = withRoadPoints(
      layers({ edits: moved?.edits }),
      { kind: 'builtin', index: 0 },
      legacy()[0],
    );
    expect(back?.edits).toBeUndefined();
  });

  it('an authored road edit replaces that def only, in a fresh array', () => {
    const defs = [def('road_1', 50), def('road_2', 60)];
    const write = withRoadPoints(
      layers({ defs }),
      { kind: 'authored', id: 'road_2' },
      line(61, [0, 9]),
    );
    expect(write?.defs).not.toBe(defs);
    expect(write?.defs?.[0]).toBe(defs[0]);
    expect(write?.defs?.[1]).toEqual({ id: 'road_2', points: line(61, [0, 9]), kind: 'road' });
    expect(defs[1].points).toHaveLength(3);
    expect(write?.edits).toBeUndefined();
  });

  it('a legacy edit leaves the authored array reference alone', () => {
    const defs = [def('road_1', 50)];
    const write = withRoadPoints(
      layers({ defs }),
      { kind: 'builtin', index: 1 },
      line(100, [0, 60]),
    );
    expect(write?.defs).toBe(defs);
  });

  it('removes, resets and restores; a removed legacy road has no points', () => {
    const removed = withRoadRemoved(layers(), { kind: 'builtin', index: 1 });
    expect(removed?.edits).toEqual({ '1': { removed: true } });
    const after = layers({ edits: removed?.edits });
    expect(roadPoints(after, { kind: 'builtin', index: 1 })).toBeNull();
    expect(withRoadRemoved(after, { kind: 'builtin', index: 1 })).toBeNull();
    expect(withRoadPoints(after, { kind: 'builtin', index: 1 }, line(0, [0, 1]))).toBeNull();
    expect(withBuiltinRoadReset(after, 1)?.edits).toBeUndefined();
    expect(withBuiltinRoadReset(layers(), 1)).toBeNull();
    const defs = [def('road_1', 50)];
    expect(
      withRoadRemoved(layers({ defs }), { kind: 'authored', id: 'road_1' })?.defs,
    ).toBeUndefined();
    expect(withRoadRemoved(layers({ defs }), { kind: 'authored', id: 'nope' })).toBeNull();
  });

  it('applies edits for the projection, ignoring keys past the table', () => {
    const roads = legacy();
    expect(applyRoadEdits(roads, undefined)).toBe(roads);
    expect(applyRoadEdits(roads, {})).toBe(roads);
    const out = applyRoadEdits(roads, {
      '0': { removed: true },
      '1': { points: line(101, [0, 50]) },
      '9': { removed: true },
    });
    expect(out).toEqual([line(101, [0, 50])]);
  });
});

describe('picking', () => {
  const pts = line(0, [0, 10, 20]);

  it('finds the nearest waypoint and segment within reach', () => {
    expect(nearestWaypoint(pts, { x: 10.5, z: 0.5 }, 1.5)).toBe(1);
    expect(nearestWaypoint(pts, { x: 5, z: 0 }, 1.5)).toBeNull();
    expect(nearestSegment(pts, { x: 15, z: 2 }, 4)).toEqual({
      insertAt: 2,
      point: { x: 15, z: 0 },
    });
    expect(nearestSegment(pts, { x: 15, z: 9 }, 4)).toBeNull();
  });

  it('picks the closest road, the authored one on a tie, never a removed one', () => {
    const base: RoadLayers = { legacy: legacy(), edits: undefined, defs: [def('road_1', 0)] };
    expect(pickRoad(base, { x: 5, z: 1 }, 4)).toEqual({ kind: 'authored', id: 'road_1' });
    expect(pickRoad(base, { x: 25, z: 1 }, 4)).toEqual({ kind: 'builtin', index: 0 });
    expect(pickRoad(base, { x: 25, z: 99 }, 4)).toEqual({ kind: 'builtin', index: 1 });
    const removed = { ...base, edits: { '1': { removed: true as const } } };
    expect(pickRoad(removed, { x: 25, z: 99 }, 4)).toBeNull();
  });
});

describe('touchedRoadStretch', () => {
  const pts = line(0, [0, 10, 20, 30, 40, 50, 60]);

  it('covers a moved waypoint and two neighbors each side, from both shapes', () => {
    const moved = withWaypointMoved(pts, 3, { x: 31, z: 40 }) ?? [];
    const stretch = touchedRoadStretch(pts, moved);
    expect(stretch.map((p) => p.x)).toEqual([10, 20, 30, 40, 50, 10, 20, 31, 40, 50]);
    expect(stretch.some((p) => p.z === 40)).toBe(true);
    expect(stretch.some((p) => p.x === 0 || p.x === 60)).toBe(false);
  });

  it('covers an inserted and a deleted waypoint with their neighbors', () => {
    const inserted = withWaypointInserted(pts, 3, { x: 25, z: 9 }) ?? [];
    expect(touchedRoadStretch(pts, inserted).map((p) => p.x)).toEqual([
      10, 20, 30, 40, 10, 20, 25, 30, 40,
    ]);
    const deleted = withWaypointDeleted(pts, 3) ?? [];
    expect(touchedRoadStretch(pts, deleted).map((p) => p.x)).toEqual([
      10, 20, 30, 40, 50, 10, 20, 40, 50,
    ]);
  });

  it('is empty for no change and the whole road for a removal', () => {
    expect(touchedRoadStretch(pts, pts)).toEqual([]);
    expect(touchedRoadStretch(pts, null)).toEqual(pts);
  });
});

/** A controller over an in-memory document with a real undo stack. */
function harness(defs?: RoadDef[]) {
  const doc: RoadLayers = { legacy: legacy(), edits: undefined, defs };
  const undo: RoadEditUndoEntry[] = [];
  const refreshed: RoadPoint[][] = [];
  const previews: { points: readonly RoadPoint[] | null; highlight: number | null }[] = [];
  const controller = new RoadEditController({
    layers: () => doc,
    write: (next) => {
      doc.edits = next.edits;
      doc.defs = next.defs;
    },
    refresh: (region) => refreshed.push([...region]),
    preview: (points, highlight) => previews.push({ points, highlight }),
    pushUndo: (entry) => undo.push(entry),
    committed: () => {},
  });
  return { doc, undo, refreshed, previews, controller };
}

const TOL = { waypoint: 1.5, road: 4 };

describe('RoadEditController', () => {
  it('a waypoint drag is ONE undo step, refreshed once on release, and undoes cleanly', () => {
    const h = harness();
    h.controller.press({ x: 15, z: 1 }, TOL); // selects legacy road 0
    expect(h.controller.selected).toEqual({ kind: 'builtin', index: 0 });
    h.controller.press({ x: 10, z: 0.5 }, TOL); // grabs waypoint 1
    expect(h.controller.selectedWaypoint).toBe(1);
    h.controller.dragTo({ x: 11, z: 3 });
    h.controller.dragTo({ x: 12, z: 6 });
    expect(h.refreshed).toHaveLength(0);
    h.controller.endDrag();
    expect(h.undo).toHaveLength(1);
    expect(h.refreshed).toHaveLength(1);
    expect(h.doc.edits).toEqual({
      '0': { points: [{ x: 0, z: 0 }, { x: 12, z: 6 }, ...line(0, [20, 30])] },
    });
    h.undo[0].undo();
    expect(h.doc.edits).toBeUndefined();
    h.undo[0].redo();
    expect(roadPoints(h.doc, { kind: 'builtin', index: 0 })?.[1]).toEqual({ x: 12, z: 6 });
    expect(h.refreshed).toHaveLength(3);
    expect(h.previews.at(-1)?.points?.[1]).toEqual({ x: 12, z: 6 });
  });

  it('a press on a waypoint with no drag records nothing', () => {
    const h = harness();
    h.controller.select({ kind: 'builtin', index: 0 });
    h.controller.press({ x: 20, z: 0 }, TOL);
    h.controller.endDrag();
    expect(h.undo).toHaveLength(0);
    expect(h.doc.edits).toBeUndefined();
  });

  it('dragging the line inserts a bend there; a plain click on it adds nothing', () => {
    const h = harness();
    h.controller.select({ kind: 'builtin', index: 0 });
    h.controller.press({ x: 15, z: 2 }, TOL);
    h.controller.endDrag();
    expect(h.undo).toHaveLength(0);
    expect(roadPoints(h.doc, { kind: 'builtin', index: 0 })).toHaveLength(4);
    h.controller.press({ x: 15, z: 2 }, TOL);
    h.controller.dragTo({ x: 15, z: 8 });
    h.controller.dragTo({ x: 16, z: 9 });
    h.controller.endDrag();
    expect(h.undo.map((u) => u.label)).toEqual(['road-insert-point']);
    expect(roadPoints(h.doc, { kind: 'builtin', index: 0 })?.map((p) => [p.x, p.z])).toEqual([
      [0, 0],
      [10, 0],
      [16, 9],
      [20, 0],
      [30, 0],
    ]);
    expect(h.controller.selectedWaypoint).toBe(2);
    h.undo[0].undo();
    expect(h.doc.edits).toBeUndefined();
  });

  it('a drag that ends where it started records nothing', () => {
    const h = harness([def('road_1', 50)]);
    h.controller.select({ kind: 'authored', id: 'road_1' });
    const defs = h.doc.defs;
    h.controller.press({ x: 10, z: 50 }, TOL);
    h.controller.dragTo({ x: 14, z: 55 });
    h.controller.dragTo({ x: 10, z: 50 });
    h.controller.endDrag();
    expect(h.undo).toHaveLength(0);
    expect(h.doc.defs).toBe(defs);
    expect(h.refreshed).toHaveLength(0);
  });

  it('a drawn road survives redo after a remove of the last road was undone and redone', () => {
    const h = harness();
    h.controller.addAuthored(def('road_1', 50));
    h.controller.remove({ kind: 'authored', id: 'road_1' });
    expect(h.doc.defs).toBeUndefined();
    h.controller.addAuthored(def('road_2', 60));
    const [, removeStep, drawStep] = h.undo;
    drawStep.undo();
    removeStep.undo();
    removeStep.redo();
    drawStep.redo();
    expect(h.doc.defs?.map((d) => d.id)).toEqual(['road_2']);
    expect(h.undo.map((u) => u.label)).toEqual(['city-road', 'road-remove', 'city-road']);
  });

  it('Reset puts a moved legacy road back as one undo step', () => {
    const h = harness();
    h.controller.select({ kind: 'builtin', index: 1 });
    h.controller.press({ x: 50, z: 100 }, TOL);
    h.controller.dragTo({ x: 55, z: 110 });
    h.controller.endDrag();
    expect(builtinRoadState(h.doc.edits, 1)).toBe('edited');
    expect(h.controller.resetBuiltin(1)).toBe(true);
    expect(h.doc.edits).toBeUndefined();
    expect(h.controller.resetBuiltin(1)).toBe(false);
    h.undo[1].undo();
    expect(roadPoints(h.doc, { kind: 'builtin', index: 1 })?.[1]).toEqual({ x: 55, z: 110 });
  });

  it('deletes the held waypoint, refuses below two, removes and resets roads', () => {
    const h = harness([def('road_1', 50)]);
    h.controller.select({ kind: 'authored', id: 'road_1' });
    h.controller.press({ x: 10, z: 50 }, TOL);
    expect(h.controller.deleteWaypoint()).toBe('none');
    expect(h.doc.defs?.[0].points.map((p) => p.x)).toEqual([0, 20]);
    expect(h.controller.selectedWaypoint).toBeNull();
    h.controller.press({ x: 20, z: 50 }, TOL);
    expect(h.controller.deleteWaypoint()).toBe('tooShort');
    expect(h.controller.removeSelected()).toBe(true);
    expect(h.doc.defs).toBeUndefined();
    expect(h.controller.selected).toBeNull();
    expect(h.controller.remove({ kind: 'builtin', index: 1 })).toBe(true);
    expect(builtinRoadState(h.doc.edits, 1)).toBe('removed');
    expect(h.controller.resetBuiltin(1)).toBe(true);
    expect(h.doc.edits).toBeUndefined();
    expect(h.undo.map((u) => u.label)).toEqual([
      'road-delete-point',
      'road-remove',
      'road-remove',
      'road-reset',
    ]);
    for (const step of [...h.undo].reverse()) step.undo();
    expect(h.doc.defs?.[0]).toEqual(def('road_1', 50));
    expect(h.doc.edits).toBeUndefined();
  });

  it('a waypoint an undo takes away, or a removed road, clears the selection', () => {
    const h = harness();
    h.controller.select({ kind: 'builtin', index: 0 });
    h.controller.press({ x: 15, z: 2 }, TOL);
    h.controller.dragTo({ x: 15, z: 8 });
    h.controller.endDrag();
    h.controller.press({ x: 30, z: 0 }, TOL);
    expect(h.controller.selectedWaypoint).toBe(4);
    h.undo[0].undo();
    expect(h.controller.selectedWaypoint).toBeNull();
    h.controller.remove({ kind: 'builtin', index: 0 });
    expect(h.controller.selected).toBeNull();
  });
});

describe('roadEdits in the map document', () => {
  function worldMap(): CustomMap {
    const map = newFlatCustomMap('Roads', 'roads', 7);
    map.content.roads = legacy();
    return map;
  }

  it('round-trips through the sanitizer and drops hostile keys and shapes', () => {
    const map = worldMap();
    map.roadEdits = { '0': { points: line(0, [0, 15, 30]) }, '1': { removed: true } };
    expect(parseMap(JSON.parse(serializeMap(map)))?.roadEdits).toEqual(map.roadEdits);
    const raw = JSON.parse(serializeMap(map));
    raw.roadEdits = {
      '0': {
        points: [
          { x: 0, z: 0 },
          { x: 1e9, z: 'a' },
          { x: 2, z: 2 },
        ],
      },
      '1': { removed: 'yes' },
      '2': { points: [{ x: 0, z: 0 }] },
      '07': { removed: true },
      '-1': { removed: true },
      '255': { removed: true },
      '256': { removed: true },
      __proto__x: { removed: true },
      '3': { removed: true, points: line(0, [0, 1]) },
    };
    // A real own __proto__ key, as JSON.parse makes one.
    raw.roadEdits = { ...raw.roadEdits, ...JSON.parse('{"__proto__": {"removed": true}}') };
    expect(Object.hasOwn(raw.roadEdits, '__proto__')).toBe(true);
    expect(sanitizeMapDoc(raw)?.roadEdits).toEqual({
      '255': { removed: true },
      '0': {
        points: [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
        ],
      },
      '3': { removed: true },
    });
    raw.roadEdits = [{ removed: true }];
    expect(sanitizeMapDoc(raw)?.roadEdits).toBeUndefined();
  });

  it('projects edits into the playtest world; an unedited map keeps its roads', () => {
    const plain = worldMap();
    expect(customMapToWorldContent(plain).roads).toEqual(legacy());
    const map = worldMap();
    map.roadEdits = { '0': { removed: true }, '1': { points: line(101, [0, 50]) } };
    map.roadDefs = [def('road_1', 200)];
    expect(customMapToWorldContent(map).roads).toEqual([
      line(101, [0, 50]),
      line(200, [0, 10, 20]),
    ]);
  });

  it('a linked map applies its edits to its own roads, offset into the world', () => {
    const map = worldMap();
    map.worldAnchor = { x: -200, z: 800 };
    map.roadEdits = { '0': { removed: true } };
    const roads = customMapToWorldContent(map).roads;
    const offset = line(100, [0, 50]).map((p) => ({ x: p.x - 200, z: p.z + 800 }));
    expect(roads.slice(-1)).toEqual([offset]);
    expect(roads.some((r) => r[0].x === -200 && r[0].z === 800)).toBe(false);
  });

  it('the change-only push merges legacy road edits by key and authored roads by id', () => {
    const base = worldMap();
    ensureMapItemIdsFromContent(base);
    base.roadDefs = [def('road_1', 50)];
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    mine.roadEdits = { '0': { points: line(0, [0, 15, 30]) } };
    mine.roadDefs = [{ ...def('road_1', 50), points: line(51, [0, 20]) }];
    theirs.roadEdits = { '1': { removed: true } };
    theirs.roadDefs = [def('road_1', 50), def('road_2', 70)];
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('merge refused');
    expect(result.conflicts).toEqual([]);
    expect(result.merged.roadEdits).toEqual({
      '1': { removed: true },
      '0': { points: line(0, [0, 15, 30]) },
    });
    expect(result.merged.roadDefs?.map((r) => r.id)).toEqual(['road_1', 'road_2']);
    expect(result.merged.roadDefs?.[0].points).toEqual(line(51, [0, 20]));
    expect(result.applied.roadEdit).toEqual({ added: 1, changed: 0, removed: 0 });
    expect(result.applied.road).toEqual({ added: 0, changed: 1, removed: 0 });
  });

  it('my road edits conflict when someone else changed the legacy road table', () => {
    const base = worldMap();
    ensureMapItemIdsFromContent(base);
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    mine.roadEdits = { '1': { removed: true } };
    theirs.content.roads = [line(-50, [0, 5]), ...legacy()];
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('merge refused');
    expect(result.conflicts).toEqual([{ kind: 'roadEdit', id: 'content.roads', reason: 'both' }]);
    // No edits of mine: their new table merges quietly.
    const quiet = mergeMapChanges(base, structuredClone(base), theirs);
    if (!quiet.ok) throw new Error('merge refused');
    expect(quiet.conflicts).toEqual([]);
  });

  it('both sides changing one legacy road differently is a conflict that keeps theirs', () => {
    const base = worldMap();
    ensureMapItemIdsFromContent(base);
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    mine.roadEdits = { '0': { removed: true } };
    theirs.roadEdits = { '0': { points: line(0, [0, 30]) } };
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('merge refused');
    expect(result.conflicts).toEqual([{ kind: 'roadEdit', id: '0', reason: 'both' }]);
    expect(result.merged.roadEdits).toEqual(theirs.roadEdits);
    const forced = mergeMapChanges(base, mine, theirs, { mineWins: true });
    if (!forced.ok) throw new Error('merge refused');
    expect(forced.conflicts).toEqual([]);
    expect(forced.merged.roadEdits).toEqual(mine.roadEdits);
    // The same both-added clash for a moved gameplay object (same shared
    // keyed merge); the same edit on both sides is no clash.
    mine.objectMoves = { 'farmBed:bed_a': { x: 1, z: 1 } };
    theirs.objectMoves = { 'farmBed:bed_a': { x: 2, z: 2 } };
    theirs.roadEdits = mine.roadEdits;
    const objects = mergeMapChanges(base, mine, theirs);
    if (!objects.ok) throw new Error('merge refused');
    expect(objects.conflicts).toEqual([
      { kind: 'objectMove', id: 'farmBed:bed_a', reason: 'both' },
    ]);
  });
});
