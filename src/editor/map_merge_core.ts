// A change-only push of a Studio map into the repo map (map_push.ts): a
// three-way merge of three copies of one map document.
//
//   base   the repo map as it was when the maker opened it (MapDocMeta.basedOn)
//   mine   the maker's edited copy
//   theirs the repo map as it is now (other people may have pushed since)
//
// Only what the maker changed between base and mine is applied onto theirs,
// so everyone else's pushes survive. An item both sides changed differently
// is a CONFLICT: it is reported, theirs is kept, and the caller refuses the
// push until the maker resolves it (reopen the latest map and redo it).
//
// How each part of the document merges:
//  - placements and grass clearings: by permanent id (map_item_ids.ts);
//  - terrain stamps: by id, keeping order. Stamps depend on the ground they
//    were made on, so a new stamp of mine that overlaps a stamp someone else
//    added since the base is a conflict too (its result would differ from
//    what either maker saw). Mine are applied after theirs;
//  - NPCs, moved gameplay objects and moved or removed legacy roads: by key;
//  - authored roads: by id;
//  - painted ground: cell by cell when the paint grids line up;
//  - everything else (zones, camps, lighting, water, roads, ...): field by
//    field, whole values.
//
// Pure and DOM-free; equality is canonical JSON (key order ignored).

import { brushDistanceSquared } from '../sim/brush_shape';
import type { HeightStamp } from '../sim/types';
import type { CustomMap } from './custom_map';

export type MapChangeKind =
  | 'placement'
  | 'terrain'
  | 'grassClear'
  | 'npc'
  | 'objectMove'
  | 'road'
  | 'roadEdit'
  | 'paint'
  | 'field';

export interface MapMergeConflict {
  kind: MapChangeKind;
  /** The item's id or key, a field path, or a cell count for paint. */
  id: string;
  /** both: both sides changed it differently. deleted: one side deleted it,
   *  the other changed it. overlap: my new terrain stamp overlaps one someone
   *  else added since the base. */
  reason: 'both' | 'deleted' | 'overlap';
}

export interface MapChangeCounts {
  added: number;
  changed: number;
  removed: number;
}

export type MapMergeResult =
  | {
      ok: true;
      merged: CustomMap;
      conflicts: MapMergeConflict[];
      /** What of mine was applied, per kind (zero kinds omitted). */
      applied: Partial<Record<MapChangeKind, MapChangeCounts>>;
      /** Whether mine differed from the base at all. */
      changed: boolean;
    }
  | {
      ok: false;
      /** missingIds: base or theirs carries tracked items without ids (a
       *  repo map that predates permanent ids). */
      error: 'missingIds';
    };

/** JSON with object keys sorted, so key order never reads as a change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = (v as Record<string, unknown>)[k];
    return out;
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return canonicalJson(a) === canonicalJson(b);
}

class Tally {
  readonly conflicts: MapMergeConflict[] = [];
  readonly applied: Partial<Record<MapChangeKind, MapChangeCounts>> = {};
  changed = false;
  constructor(readonly mineWins: boolean) {}
  count(kind: MapChangeKind, what: keyof MapChangeCounts): void {
    const row = this.applied[kind] ?? { added: 0, changed: 0, removed: 0 };
    row[what]++;
    this.applied[kind] = row;
  }
  conflict(kind: MapChangeKind, id: string, reason: MapMergeConflict['reason']): void {
    this.conflicts.push({ kind, id, reason });
  }
}

/** One keyed collection, three ways. Theirs' order, then my additions in my
 *  order. */
function mergeKeyed<T>(
  kind: MapChangeKind,
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  key: (item: T) => string,
  tally: Tally,
): T[] {
  const bm = new Map(base.map((item) => [key(item), item]));
  const mm = new Map(mine.map((item) => [key(item), item]));
  const tm = new Map(theirs.map((item) => [key(item), item]));
  const out: T[] = [];
  for (const t of theirs) {
    const k = key(t);
    const b = bm.get(k);
    const m = mm.get(k);
    if (b === undefined) {
      // Theirs added it. A key both sides added (a record keyed by what it
      // edits: the same built-in object moved, the same legacy road
      // reshaped) differently is a clash, not theirs by default.
      if (m !== undefined && !same(m, t)) {
        tally.changed = true;
        if (tally.mineWins) {
          out.push(m);
          tally.count(kind, 'changed');
        } else {
          tally.conflict(kind, k, 'both');
          out.push(t);
        }
      } else out.push(t);
      continue;
    }
    if (m === undefined) {
      // I deleted it.
      tally.changed = true;
      if (same(t, b) || tally.mineWins) tally.count(kind, 'removed');
      else {
        tally.conflict(kind, k, 'deleted');
        out.push(t);
      }
      continue;
    }
    const mineChanged = !same(m, b);
    if (mineChanged) tally.changed = true;
    if (!mineChanged || same(m, t)) out.push(t);
    else if (same(t, b) || tally.mineWins) {
      out.push(m);
      tally.count(kind, 'changed');
    } else {
      tally.conflict(kind, k, 'both');
      out.push(t);
    }
  }
  for (const [k, b] of bm) {
    if (tm.has(k)) continue;
    // Theirs deleted it; a change of mine to it cannot land.
    const m = mm.get(k);
    if (m !== undefined && !same(m, b)) {
      tally.changed = true;
      tally.conflict(kind, k, 'deleted');
    }
  }
  for (const m of mine) {
    const k = key(m);
    if (bm.has(k) || tm.has(k)) continue;
    out.push(m);
    tally.changed = true;
    tally.count(kind, 'added');
  }
  return out;
}

/** One keyed record (NPCs, moved objects), three ways. */
function mergeRecord<T>(
  kind: MapChangeKind,
  base: Readonly<Record<string, T>> | undefined,
  mine: Readonly<Record<string, T>> | undefined,
  theirs: Readonly<Record<string, T>> | undefined,
  tally: Tally,
): Record<string, T> | undefined {
  const keyed = (r: Readonly<Record<string, T>> | undefined) =>
    Object.entries(r ?? {}).map(([k, v]) => ({ k, v }));
  const merged = mergeKeyed(kind, keyed(base), keyed(mine), keyed(theirs), (e) => e.k, tally);
  if (merged.length === 0 && theirs === undefined) return undefined;
  return Object.fromEntries(merged.map((e) => [e.k, e.v]));
}

/** Whether two stamps' footprints touch (square stamps by their bounds). */
function stampsOverlap(a: HeightStamp, b: HeightStamp): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const reach = a.radius + b.radius;
  if (a.shape === 'square' || b.shape === 'square') {
    return brushDistanceSquared(dx, dz, 'square') < reach * reach;
  }
  return dx * dx + dz * dz < reach * reach;
}

/** The stamps one side added, changed or removed since the base: the new
 *  shape for an added or changed stamp, the old one for a removed stamp. */
function touchedStamps(
  base: ReadonlyMap<string, HeightStamp>,
  side: readonly HeightStamp[],
): HeightStamp[] {
  const id = (s: HeightStamp) => s.id as string;
  const sideIds = new Set(side.map(id));
  const touched = side.filter((s) => {
    const b = base.get(id(s));
    return b === undefined || !same(s, b);
  });
  for (const [k, b] of base) if (!sideIds.has(k)) touched.push(b);
  return touched;
}

function mergeTerrain(
  base: readonly HeightStamp[],
  mine: readonly HeightStamp[],
  theirs: readonly HeightStamp[],
  tally: Tally,
): HeightStamp[] {
  const id = (s: HeightStamp) => s.id as string;
  const baseById = new Map(base.map((s) => [id(s), s]));
  const merged = mergeKeyed('terrain', base, mine, theirs, id, tally);
  // Stamps stack in order, and a level or smooth stamp samples the ground
  // under it: a stamp I added, changed or removed over one someone else
  // added, changed or removed since would come out as neither of us saw it.
  // (Both touching the SAME stamp is mergeKeyed's call above.)
  const theirsTouched = touchedStamps(baseById, theirs);
  const flagged = new Set<string>();
  for (const m of touchedStamps(baseById, mine)) {
    const k = id(m);
    if (flagged.has(k)) continue;
    if (theirsTouched.some((t) => id(t) !== k && stampsOverlap(m, t))) {
      flagged.add(k);
      tally.conflict('terrain', k, 'overlap');
    }
  }
  return merged;
}

type Paint = NonNullable<CustomMap['biomePaint']>;

function sameGrid(a: Paint, b: Paint): boolean {
  return (
    a.cell === b.cell &&
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.originX === b.originX &&
    a.originZ === b.originZ &&
    a.ids.length === b.ids.length
  );
}

function mergePaint(
  base: Paint | undefined,
  mine: Paint | undefined,
  theirs: Paint | undefined,
  tally: Tally,
): Paint | undefined {
  if (!base || !mine || !theirs || !sameGrid(base, mine) || !sameGrid(base, theirs)) {
    return mergeField('biomePaint', base, mine, theirs, tally);
  }
  const ids = theirs.ids.slice();
  let painted = 0;
  let clashes = 0;
  for (let i = 0; i < ids.length; i++) {
    const b = base.ids[i];
    const m = mine.ids[i];
    if (m === b) continue;
    tally.changed = true;
    if (theirs.ids[i] === b || theirs.ids[i] === m) {
      ids[i] = m;
      painted++;
    } else clashes++;
  }
  if (painted > 0) tally.count('paint', 'changed');
  if (clashes > 0) tally.conflict('paint', String(clashes), 'both');
  // The swatches and blend settings merge as one value.
  const { ids: _b, ...baseRest } = base;
  const { ids: _m, ...mineRest } = mine;
  const { ids: _t, ...theirsRest } = theirs;
  const rest = mergeField('biomePaint', baseRest, mineRest, theirsRest, tally);
  return { ...(rest ?? theirsRest), ids };
}

/** One whole value, three ways. */
function mergeField<T>(
  path: string,
  base: T | undefined,
  mine: T | undefined,
  theirs: T | undefined,
  tally: Tally,
): T | undefined {
  if (same(mine, base)) return theirs;
  tally.changed = true;
  if (same(theirs, base) || same(theirs, mine)) {
    tally.count('field', 'changed');
    return mine;
  }
  tally.conflict('field', path, 'both');
  return theirs;
}

/** The meta fields a maker edits; the rest is the file's identity. */
const MERGED_META_KEYS = ['name', 'description', 'seed'] as const;

/** Document keys merged by their own rules above; every other key merges as
 *  a whole value. */
const KEYED_DOC_KEYS = new Set([
  'version',
  'meta',
  'content',
  'placements',
  'terrainEdits',
  'grassClear',
  'objectMoves',
  'roadDefs',
  'roadEdits',
  'biomePaint',
]);

function idsClean(ids: readonly (string | undefined)[]): boolean {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** Whether every tracked item carries an id and no two share one: what the
 *  merge needs to tell items apart. */
export function hasCleanItemIds(map: CustomMap): boolean {
  return (
    idsClean(map.placements.map((p) => p.uid)) &&
    idsClean(map.terrainEdits.map((s) => s.id)) &&
    idsClean((map.grassClear ?? []).map((c) => c.id))
  );
}

/** Merge my changes (base to mine) onto theirs. `mine` must already carry
 *  its ids (ensureMapItemIds). `mineWins`: an item, NPC or moved object both
 *  sides changed (or I deleted and they changed) takes mine instead of
 *  conflicting; an item they deleted still conflicts, and so does everything
 *  merged as a whole (terrain overlap, paint cells, fields). */
export function mergeMapChanges(
  base: CustomMap,
  mine: CustomMap,
  theirs: CustomMap,
  options: { mineWins?: boolean } = {},
): MapMergeResult {
  if (!hasCleanItemIds(base) || !hasCleanItemIds(theirs) || !hasCleanItemIds(mine)) {
    return { ok: false, error: 'missingIds' };
  }
  const tally = new Tally(options.mineWins === true);
  const merged = structuredClone(theirs) as CustomMap & Record<string, unknown>;
  merged.placements = mergeKeyed(
    'placement',
    base.placements,
    mine.placements,
    theirs.placements,
    (p) => p.uid as string,
    tally,
  );
  merged.terrainEdits = mergeTerrain(
    base.terrainEdits,
    mine.terrainEdits,
    theirs.terrainEdits,
    tally,
  );
  const clear = mergeKeyed(
    'grassClear',
    base.grassClear ?? [],
    mine.grassClear ?? [],
    theirs.grassClear ?? [],
    (c) => c.id as string,
    tally,
  );
  if (clear.length > 0) merged.grassClear = clear;
  else delete merged.grassClear;
  const moves = mergeRecord(
    'objectMove',
    base.objectMoves,
    mine.objectMoves,
    theirs.objectMoves,
    tally,
  );
  if (moves && Object.keys(moves).length > 0) merged.objectMoves = moves;
  else delete merged.objectMoves;
  const roads = mergeKeyed(
    'road',
    base.roadDefs ?? [],
    mine.roadDefs ?? [],
    theirs.roadDefs ?? [],
    (r) => r.id,
    tally,
  );
  if (roads.length > 0) merged.roadDefs = roads;
  else delete merged.roadDefs;
  const roadEdits = mergeRecord(
    'roadEdit',
    base.roadEdits,
    mine.roadEdits,
    theirs.roadEdits,
    tally,
  );
  if (roadEdits && Object.keys(roadEdits).length > 0) merged.roadEdits = roadEdits;
  else delete merged.roadEdits;
  // Road edits name the legacy roads by index: if someone else changed that
  // table since the base, my edits could land on different roads.
  if (!same(base.roadEdits, mine.roadEdits) && !same(base.content.roads, theirs.content.roads)) {
    tally.conflict('roadEdit', 'content.roads', 'both');
  }
  const paint = mergePaint(base.biomePaint, mine.biomePaint, theirs.biomePaint, tally);
  if (paint) merged.biomePaint = paint;
  else delete merged.biomePaint;

  // Content: NPCs by id, every other part as a whole value.
  const content: Record<string, unknown> = { ...theirs.content };
  const baseContent = base.content as unknown as Record<string, unknown>;
  const mineContent = mine.content as unknown as Record<string, unknown>;
  const theirsContent = theirs.content as unknown as Record<string, unknown>;
  for (const key of new Set([
    ...Object.keys(baseContent),
    ...Object.keys(mineContent),
    ...Object.keys(theirsContent),
  ])) {
    const value =
      key === 'npcs'
        ? mergeRecord(
            'npc',
            baseContent.npcs as never,
            mineContent.npcs as never,
            theirsContent.npcs as never,
            tally,
          )
        : mergeField(
            `content.${key}`,
            baseContent[key],
            mineContent[key],
            theirsContent[key],
            tally,
          );
    if (value === undefined) delete content[key];
    else content[key] = value;
  }
  merged.content = content as unknown as CustomMap['content'];

  // Every other document key as a whole value.
  const b = base as unknown as Record<string, unknown>;
  const m = mine as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    if (KEYED_DOC_KEYS.has(key)) continue;
    const value = mergeField(key, b[key], m[key], t[key], tally);
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  // The repo file keeps its own identity (id, dates, lineage); the maker's
  // name, description and seed merge like any field. My copy's link back to
  // the file is mine alone.
  merged.meta = { ...theirs.meta };
  for (const key of MERGED_META_KEYS) {
    const value = mergeField(
      `meta.${key}`,
      base.meta[key],
      mine.meta[key],
      theirs.meta[key],
      tally,
    );
    if (value !== undefined) (merged.meta as unknown as Record<string, unknown>)[key] = value;
  }
  delete merged.meta.basedOn;
  return {
    ok: true,
    merged,
    conflicts: tally.conflicts,
    applied: tally.applied,
    changed: tally.changed,
  };
}
