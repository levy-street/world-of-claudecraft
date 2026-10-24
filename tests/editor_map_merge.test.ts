// Change-only pushes of a Studio map into the repo map: permanent item ids
// (src/editor/map_item_ids.ts), the three-way merge (src/editor/
// map_merge_core.ts) and the repo file layout (src/editor/persist.ts
// serializeMapForRepo). Pinned here:
//  - ids are minted once, kept, and a duplicated item's copy gets a fresh one;
//  - only my changes land: theirs' own additions, moves and deletions survive;
//  - both sides changing one item differently, or one deleting what the
//    other changed, is a conflict that keeps theirs;
//  - new terrain stamps append after theirs in my order, and one overlapping
//    a stamp someone else added since the base is a conflict;
//  - painted ground merges cell by cell, other fields as whole values;
//  - a map without ids is refused, not guessed at;
//  - a rename, description or seed merges like a field; the file's id, dates
//    and lineage stay its own; terrain clashes cover stamps either side
//    added, changed or erased; mineWins; twins in a file are refused;
//  - the repo file puts each placement and stamp on its own line, drops the
//    editing copy's base link, and parses back to the same map;
//  - the game-ready projection never carries the ids.
import { describe, expect, it } from 'vitest';
import {
  type CustomMap,
  customMapToWorldContent,
  newFlatCustomMap,
} from '../src/editor/custom_map';
import { ensureMapItemIds } from '../src/editor/map_item_ids';
import { canonicalJson, hasCleanItemIds, mergeMapChanges } from '../src/editor/map_merge_core';
import { parseMap, serializeMapForRepo } from '../src/editor/persist';
import type { MapPlacement } from '../src/sim/map_doc';
import type { HeightStamp } from '../src/sim/types';

const place = (uid: string, x: number): MapPlacement => ({
  uid,
  assetId: 'props/well',
  x,
  z: 0,
  rotY: 0,
  scale: 1,
  collide: true,
});
const stamp = (id: string, x: number, z = 0): HeightStamp => ({
  id,
  x,
  z,
  radius: 4,
  delta: 2,
  falloff: 'smooth',
});

function baseMap(): CustomMap {
  const map = newFlatCustomMap('Repo map', 'repo', 7);
  map.placements = [place('a1', 0), place('b2', 10), place('c3', 20)];
  map.terrainEdits = [stamp('s1', 0), stamp('s2', 100)];
  map.grassClear = [{ id: 'g1', x: 0, z: 0, r: 3 }];
  return map;
}
const copy = (map: CustomMap) => structuredClone(map);
const uids = (map: CustomMap) => map.placements.map((p) => p.uid);

describe('permanent item ids', () => {
  it('mints missing ids once, keeps existing ones, and splits a duplicated item', () => {
    const map = baseMap();
    map.placements.push({ ...place('', 30), uid: undefined }, { ...map.placements[0], x: 2 });
    map.terrainEdits.push({ ...stamp('', 5), id: undefined });
    let n = 0;
    const mint = () => `new${++n}`;
    expect(ensureMapItemIds(map, mint)).toBe(3);
    expect(uids(map)).toEqual(['a1', 'b2', 'c3', 'new1', 'new2']);
    expect(map.terrainEdits.map((s) => s.id)).toEqual(['s1', 's2', 'new3']);
    expect(ensureMapItemIds(map, mint)).toBe(0);
  });
});

describe('the three-way merge', () => {
  it('lands only my changes and keeps everything else they pushed', () => {
    const base = baseMap();
    const mine = copy(base);
    mine.placements[0].x = 5; // I moved a1
    mine.placements.splice(2, 1); // I deleted c3
    mine.placements.push(place('m1', 40)); // I added m1
    const theirs = copy(base);
    theirs.placements[1].rotY = 1; // they turned b2
    theirs.placements.push(place('t1', 50)); // they added t1
    theirs.terrainEdits.push(stamp('t9', 500));
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(true);
    expect(uids(result.merged)).toEqual(['a1', 'b2', 't1', 'm1']);
    expect(result.merged.placements[0].x).toBe(5);
    expect(result.merged.placements[1].rotY).toBe(1);
    expect(result.merged.terrainEdits.map((s) => s.id)).toEqual(['s1', 's2', 't9']);
    expect(result.applied.placement).toEqual({ added: 1, changed: 1, removed: 1 });
  });

  it('reports both-changed and deleted-changed items as conflicts, keeping theirs', () => {
    const base = baseMap();
    const mine = copy(base);
    const theirs = copy(base);
    mine.placements[0].x = 5;
    theirs.placements[0].x = 7;
    mine.placements[1].x = 11; // I changed b2...
    theirs.placements.splice(1, 1); // ...they deleted it
    mine.placements.splice(2, 1); // I deleted c3...
    theirs.placements[1].rotY = 2; // ...they changed it (c3 is index 1 now)
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        { kind: 'placement', id: 'a1', reason: 'both' },
        { kind: 'placement', id: 'b2', reason: 'deleted' },
        { kind: 'placement', id: 'c3', reason: 'deleted' },
      ]),
    );
    expect(result.merged.placements.find((p) => p.uid === 'a1')?.x).toBe(7);
  });

  it('appends my new stamps after theirs, and flags one that overlaps their new stamp', () => {
    const base = baseMap();
    const mine = copy(base);
    const theirs = copy(base);
    mine.terrainEdits.push(stamp('m1', 300), stamp('m2', 1000));
    theirs.terrainEdits.push(stamp('t1', 1003));
    mine.terrainEdits.splice(0, 1); // I erased s1
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.merged.terrainEdits.map((s) => s.id)).toEqual(['s2', 't1', 'm1', 'm2']);
    expect(result.conflicts).toEqual([{ kind: 'terrain', id: 'm2', reason: 'overlap' }]);
    expect(result.applied.terrain).toEqual({ added: 2, changed: 0, removed: 1 });
  });

  it('merges painted ground cell by cell and other fields as whole values', () => {
    const base = baseMap();
    base.biomePaint = {
      cell: 4,
      cols: 4,
      rows: 1,
      originX: 0,
      originZ: 0,
      ids: [255, 255, 255, 255],
    };
    const mine = copy(base);
    const theirs = copy(base);
    mine.biomePaint!.ids[0] = 1;
    theirs.biomePaint!.ids[3] = 2;
    mine.biomePaint!.ids[2] = 1;
    theirs.biomePaint!.ids[2] = 2; // the same cell, two different paints
    mine.waterLevel = 3;
    theirs.skybox = 'night';
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.merged.biomePaint?.ids).toEqual([1, 255, 2, 2]);
    expect(result.conflicts).toEqual([{ kind: 'paint', id: '1', reason: 'both' }]);
    expect(result.merged.waterLevel).toBe(3);
    expect(result.merged.skybox).toBe('night');
  });

  it('merges NPCs and moved gameplay objects by key', () => {
    const base = baseMap();
    const mine = copy(base);
    const theirs = copy(base);
    mine.objectMoves = { 'farmBed:bed_a': { x: 1, z: 1 } };
    theirs.objectMoves = { 'gatherNode:n1': { x: 2, z: 2 } };
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.merged.objectMoves).toEqual({
      'gatherNode:n1': { x: 2, z: 2 },
      'farmBed:bed_a': { x: 1, z: 1 },
    });
  });

  it('notices when I changed nothing, and refuses a map without ids', () => {
    const base = baseMap();
    const theirs = copy(base);
    theirs.placements.push(place('t1', 9));
    const result = mergeMapChanges(base, copy(base), theirs);
    expect(result.ok && result.changed).toBe(false);
    const old = copy(base);
    delete old.placements[0].uid;
    expect(mergeMapChanges(old, copy(base), copy(base))).toEqual({
      ok: false,
      error: 'missingIds',
    });
  });

  it('keeps the repo file identity and never writes my base link into it', () => {
    const base = baseMap();
    const mine = copy(base);
    mine.meta = {
      ...mine.meta,
      id: 'my-copy-id',
      createdAt: 1,
      basedOn: { slug: 'repo', base: 'a'.repeat(40) },
    };
    const result = mergeMapChanges(base, mine, copy(base));
    if (!result.ok) throw new Error('refused');
    expect(result.merged.meta.id).toBe(base.meta.id);
    expect(result.merged.meta.createdAt).toBe(base.meta.createdAt);
    expect(result.merged.meta.basedOn).toBeUndefined();
  });
});

describe('the repo file layout', () => {
  it('puts each placement and stamp on its own line and parses back unchanged', () => {
    const map = baseMap();
    map.meta = { ...map.meta, basedOn: { slug: 'repo', base: 'b'.repeat(40) } };
    const text = serializeMapForRepo(map);
    const lines = text.split('\n');
    expect(lines.filter((l) => l.includes('"uid":"a1"'))).toHaveLength(1);
    // One item per line: the line holding an item is that whole item.
    const itemLine = (needle: string) => lines.filter((l) => l.includes(needle));
    expect(itemLine('"uid":"b2"')).toHaveLength(1);
    expect(itemLine('"uid":"b2"')[0]).toMatch(/^\{"[^{]*\},?$/);
    expect(itemLine('"id":"s1"')).toHaveLength(1);
    expect(itemLine('"id":"s1"')[0]).toMatch(/^\{"[^{]*\},?$/);
    expect(text).not.toContain('basedOn');
    const back = parseMap(text);
    const { basedOn: _drop, ...meta } = map.meta;
    expect(canonicalJson(back)).toBe(canonicalJson({ ...map, meta }));
  });

  it('keeps ids out of the game-ready world', () => {
    const world = customMapToWorldContent(baseMap());
    expect(JSON.stringify(world.terrainEdits)).not.toContain('"id"');
    expect(JSON.stringify(world.grassClear)).not.toContain('"id"');
  });
});

describe('the merge, after review', () => {
  it('merges a rename, keeps the file identity, and conflicts two renames', () => {
    const base = baseMap();
    const mine = copy(base);
    mine.meta = { ...mine.meta, name: 'Renamed', id: 'my-local-id', updatedAt: 99 };
    const theirs = copy(base);
    theirs.meta = { ...theirs.meta, description: 'Theirs', updatedAt: 50 };
    const result = mergeMapChanges(base, mine, theirs);
    if (!result.ok) throw new Error('refused');
    expect(result.changed).toBe(true);
    expect(result.merged.meta.name).toBe('Renamed');
    expect(result.merged.meta.description).toBe('Theirs');
    expect(result.merged.meta.id).toBe(theirs.meta.id);
    expect(result.merged.meta.updatedAt).toBe(50);
    theirs.meta.name = 'Other name';
    const clash = mergeMapChanges(base, mine, theirs);
    if (!clash.ok) throw new Error('refused');
    expect(clash.conflicts).toEqual([{ kind: 'field', id: 'meta.name', reason: 'both' }]);
  });

  it('flags my stamp over one they changed or erased, and my changed stamp under their new one', () => {
    const base = baseMap(); // s1 at x 0, s2 at x 100
    const overChanged = copy(base);
    overChanged.terrainEdits.push(stamp('m1', 3));
    const theirsChanged = copy(base);
    theirsChanged.terrainEdits[0].delta = 9;
    const a = mergeMapChanges(base, overChanged, theirsChanged);
    if (!a.ok) throw new Error('refused');
    expect(a.conflicts).toEqual([{ kind: 'terrain', id: 'm1', reason: 'overlap' }]);

    const theirsErased = copy(base);
    theirsErased.terrainEdits.splice(0, 1);
    const b = mergeMapChanges(base, overChanged, theirsErased);
    if (!b.ok) throw new Error('refused');
    expect(b.conflicts).toEqual([{ kind: 'terrain', id: 'm1', reason: 'overlap' }]);

    const mineChanged = copy(base);
    mineChanged.terrainEdits[1].delta = -3; // s2
    const theirsNew = copy(base);
    theirsNew.terrainEdits.push(stamp('t1', 104));
    const c = mergeMapChanges(base, mineChanged, theirsNew);
    if (!c.ok) throw new Error('refused');
    expect(c.conflicts).toEqual([{ kind: 'terrain', id: 's2', reason: 'overlap' }]);

    // Far apart, no clash.
    const far = copy(base);
    far.terrainEdits.push(stamp('t2', 600));
    const d = mergeMapChanges(base, mineChanged, far);
    if (!d.ok) throw new Error('refused');
    expect(d.conflicts).toEqual([]);
  });

  it('mineWins takes my item where both changed it or I deleted what they changed', () => {
    const base = baseMap();
    const mine = copy(base);
    const theirs = copy(base);
    mine.placements[0].x = 5;
    theirs.placements[0].x = 7;
    mine.placements.splice(2, 1); // I deleted c3...
    theirs.placements[2].rotY = 2; // ...they changed it
    const result = mergeMapChanges(base, mine, theirs, { mineWins: true });
    if (!result.ok) throw new Error('refused');
    expect(result.conflicts).toEqual([]);
    expect(uids(result.merged)).toEqual(['a1', 'b2']);
    expect(result.merged.placements[0].x).toBe(5);
    // Something they deleted still cannot take my change.
    const gone = copy(base);
    gone.placements.splice(0, 1);
    const refused = mergeMapChanges(base, mine, gone, { mineWins: true });
    if (!refused.ok) throw new Error('refused');
    expect(refused.conflicts).toContainEqual({ kind: 'placement', id: 'a1', reason: 'deleted' });
  });

  it('refuses maps whose items share an id', () => {
    const base = baseMap();
    const twins = copy(base);
    twins.placements[1].uid = 'a1';
    expect(hasCleanItemIds(base)).toBe(true);
    expect(hasCleanItemIds(twins)).toBe(false);
    expect(mergeMapChanges(base, copy(base), twins)).toEqual({ ok: false, error: 'missingIds' });
  });
});
