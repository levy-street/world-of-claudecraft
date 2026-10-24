// City Build Roads tab, Edit mode: select a road (authored or legacy), drag
// its waypoints, insert one on a segment, delete one, remove the whole road,
// and Reset or Restore a legacy road, with one undo step per gesture.
// DOM-free; app.ts composes it over the document and the 3D viewport, and
// city_build_panel.ts paints the inspector half.
//
// A drag only moves the preview and the document: the road's terrain
// flattening and splat are rebuilt once, on release, over the stretch of road
// the gesture touched (road_edit_core.ts touchedRoadStretch).

import type { RoadDef } from '../sim/map_doc';
import {
  nearestSegment,
  nearestWaypoint,
  type Polyline,
  pickRoad,
  type RoadLayers,
  type RoadPoint,
  type RoadRef,
  type RoadWrite,
  roadPoints,
  samePolyline,
  sameRoadRef,
  touchedRoadStretch,
  withBuiltinRoadReset,
  withRoadAdded,
  withRoadPoints,
  withRoadRemoved,
  withWaypointDeleted,
  withWaypointInserted,
  withWaypointMoved,
} from './road_edit_core';

export interface RoadEditUndoEntry {
  label: string;
  undo(): void;
  redo(): void;
}

export interface RoadEditDeps {
  /** The document's road layers as they are now. */
  layers(): RoadLayers;
  /** Store both layers on the document (no rebuild). */
  write(next: RoadWrite): void;
  /** Rebuild the active world's roads and re-flatten the terrain over the
   *  touched stretch. */
  refresh(region: readonly RoadPoint[]): void;
  /** Draw the selected road's handles (null clears), with one waypoint
   *  highlighted. */
  preview(points: Polyline | null, highlight: number | null): void;
  pushUndo(entry: RoadEditUndoEntry): void;
  /** A committed change: mark the document dirty, refresh the inspector. */
  committed(): void;
}

/** Pick reach in yards: a waypoint handle, and a road's centerline (a road
 *  is about 8 yd across, so a click anywhere on it lands). */
export interface RoadPickTolerance {
  waypoint: number;
  road: number;
}

export type RoadEditRefusal = 'none' | 'tooShort' | 'tooLong';

export class RoadEditController {
  private ref: RoadRef | null = null;
  private point: number | null = null;
  /** The layers before the open drag (a waypoint move, or a bend dragged
   *  out of the line). insertAt: the bend's waypoint is not inserted yet. */
  private gesture: {
    ref: RoadRef;
    before: RoadWrite;
    label: string;
    insertAt?: number;
  } | null = null;

  constructor(private readonly deps: RoadEditDeps) {}

  get selected(): RoadRef | null {
    return this.ref;
  }

  get selectedWaypoint(): number | null {
    return this.point;
  }

  /** The selected road's current waypoints (null when none is selected). */
  selectedPoints(): Polyline | null {
    return this.ref ? roadPoints(this.deps.layers(), this.ref) : null;
  }

  select(ref: RoadRef | null, waypoint: number | null = null): void {
    this.endDrag();
    this.ref = ref && roadPoints(this.deps.layers(), ref) ? ref : null;
    this.point = this.ref ? waypoint : null;
    this.syncPreview();
  }

  /** A press in the viewport. On the selected road: a waypoint starts its
   *  drag, and a press on the line starts dragging out a new bend. Elsewhere it
   *  selects the road under the cursor, or clears the selection. Returns
   *  whether the press landed on a road (refusal says why an insert did
   *  not happen). */
  press(at: RoadPoint, tol: RoadPickTolerance): { hit: boolean; refusal: RoadEditRefusal } {
    this.endDrag();
    const layers = this.deps.layers();
    const ref = this.ref;
    const points = ref ? roadPoints(layers, ref) : null;
    if (ref && points) {
      const wp = nearestWaypoint(points, at, tol.waypoint);
      if (wp !== null) {
        this.point = wp;
        this.gesture = { ref, before: snapshot(layers), label: 'road-move-point' };
        this.syncPreview();
        return { hit: true, refusal: 'none' };
      }
      const seg = nearestSegment(points, at, tol.road);
      if (seg) {
        // The bend waits for the drag: a plain click on the line adds nothing.
        if (!withWaypointInserted(points, seg.insertAt, seg.point)) {
          this.point = null;
          this.syncPreview();
          return { hit: true, refusal: 'tooLong' };
        }
        this.gesture = {
          ref,
          before: snapshot(layers),
          label: 'road-insert-point',
          insertAt: seg.insertAt,
        };
        this.point = null;
        this.syncPreview();
        return { hit: true, refusal: 'none' };
      }
    }
    const picked = pickRoad(layers, at, tol.road);
    if (!sameRoadRef(picked, this.ref)) {
      this.ref = picked;
      this.point = null;
    }
    this.syncPreview();
    return { hit: picked !== null, refusal: 'none' };
  }

  /** One drag sample: the held waypoint follows the cursor (a drag that
   *  started on the line first inserts its waypoint there). */
  dragTo(at: RoadPoint): void {
    const g = this.gesture;
    if (!g) return;
    const layers = this.deps.layers();
    const points = roadPoints(layers, g.ref);
    if (!points) return;
    if (g.insertAt !== undefined) {
      const inserted = withWaypointInserted(points, g.insertAt, at);
      const write = inserted ? withRoadPoints(layers, g.ref, inserted) : null;
      if (!write) return;
      this.point = g.insertAt;
      g.insertAt = undefined;
      this.deps.write(write);
      this.syncPreview();
      return;
    }
    if (this.point === null) return;
    const moved = withWaypointMoved(points, this.point, at);
    const write = moved ? withRoadPoints(layers, g.ref, moved) : null;
    if (!write) return;
    this.deps.write(write);
    this.syncPreview();
  }

  /** Close the open drag as ONE undo step (a no-op when nothing changed). */
  endDrag(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const layers = this.deps.layers();
    const after = snapshot(layers);
    if (after.edits === g.before.edits && after.defs === g.before.defs) return;
    // Dragged back to exactly where it started: no change, no undo step.
    const was = roadPoints({ ...layers, ...g.before }, g.ref);
    const now = roadPoints(layers, g.ref);
    if (was && now && samePolyline(was, now)) {
      this.deps.write(g.before);
      this.syncPreview();
      return;
    }
    this.commit(g.label, g.ref, g.before, after);
  }

  /** Delete the selected waypoint (a road keeps at least two). */
  deleteWaypoint(): RoadEditRefusal {
    this.endDrag();
    const ref = this.ref;
    const layers = this.deps.layers();
    const points = ref ? roadPoints(layers, ref) : null;
    if (!ref || !points || this.point === null) return 'none';
    const next = withWaypointDeleted(points, this.point);
    const write = next ? withRoadPoints(layers, ref, next) : null;
    if (!write) return 'tooShort';
    const before = snapshot(layers);
    this.deps.write(write);
    this.point = null;
    this.commit('road-delete-point', ref, before, snapshot(this.deps.layers()));
    return 'none';
  }

  /** Add a drawn authored road (one undo step). */
  addAuthored(def: RoadDef): void {
    this.endDrag();
    const layers = this.deps.layers();
    const before = snapshot(layers);
    this.deps.write(withRoadAdded(layers, def));
    this.commit(
      'city-road',
      { kind: 'authored', id: def.id },
      before,
      snapshot(this.deps.layers()),
    );
  }

  /** Remove the selected road from this map (one undo step). */
  removeSelected(): boolean {
    return this.ref ? this.remove(this.ref) : false;
  }

  /** Remove a road from this map (one undo step); clears the selection when
   *  it was the selected road. */
  remove(ref: RoadRef): boolean {
    this.endDrag();
    const layers = this.deps.layers();
    const write = withRoadRemoved(layers, ref);
    if (!write) return false;
    const before = snapshot(layers);
    this.deps.write(write);
    if (sameRoadRef(ref, this.ref)) {
      this.ref = null;
      this.point = null;
    }
    this.commit('road-remove', ref, before, snapshot(this.deps.layers()));
    return true;
  }

  /** Put a legacy road back as the map stores it: undoes a move or brings a
   *  removed road back (one undo step). */
  resetBuiltin(index: number): boolean {
    this.endDrag();
    const layers = this.deps.layers();
    const write = withBuiltinRoadReset(layers, index);
    if (!write) return false;
    const before = snapshot(layers);
    this.deps.write(write);
    this.point = null;
    this.commit('road-reset', { kind: 'builtin', index }, before, snapshot(this.deps.layers()));
    return true;
  }

  /** Drop the selection and any open drag WITHOUT an undo step (a map load
   *  or leaving the tool; the document it belonged to may be gone). */
  reset(): void {
    this.gesture = null;
    this.ref = null;
    this.point = null;
  }

  /** Redraw the selection (after an undo, a load, or a camera change). A
   *  selection whose road is gone clears. */
  syncPreview(): void {
    const points = this.ref ? roadPoints(this.deps.layers(), this.ref) : null;
    if (!points) {
      this.ref = null;
      this.point = null;
      this.deps.preview(null, null);
      return;
    }
    if (this.point !== null && this.point >= points.length) this.point = null;
    this.deps.preview(points, this.point);
  }

  private commit(label: string, ref: RoadRef, before: RoadWrite, after: RoadWrite): void {
    const region = touchedRoadStretch(
      roadPoints({ ...this.deps.layers(), ...before }, ref),
      roadPoints({ ...this.deps.layers(), ...after }, ref),
    );
    const restore = (to: RoadWrite): void => {
      this.deps.write(to);
      this.deps.refresh(region);
      this.syncPreview();
      this.deps.committed();
    };
    this.deps.pushUndo({ label, undo: () => restore(before), redo: () => restore(after) });
    this.deps.refresh(region);
    this.syncPreview();
    this.deps.committed();
  }
}

function snapshot(layers: RoadLayers): RoadWrite {
  return { edits: layers.edits, defs: layers.defs };
}
