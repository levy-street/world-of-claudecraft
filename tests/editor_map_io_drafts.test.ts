import { describe, expect, it } from 'vitest';
import { newCustomMap } from '../src/editor/custom_map';
import { MapIO } from '../src/editor/map_io';
import type { KeyValueStore } from '../src/editor/persist';

const LEGACY_DRAFT_KEY = 'woc_editor_draft';
const draftKey = (id: string): string => `woc_editor_draft:${id}`;
const LINKS_KEY = 'woc_editor_server_links';

interface MemStorage extends KeyValueStore {
  data: Map<string, string>;
}

function memStorage(): MemStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('MapIO drafts (one slot per map id)', () => {
  it('REGRESSION: clearing map B draft leaves map A draft alone', () => {
    // Audit D: one global draft slot meant finishing a save of map B
    // destroyed map A's only autosave.
    const s = memStorage();
    const io = new MapIO(s);
    const a = newCustomMap('Alpha', 'a', 100);
    const b = newCustomMap('Beta', 'b', 200);
    expect(io.draftSave(a)).toBe(true);
    expect(io.draftSave(b)).toBe(true);
    io.draftClear(b.meta.id); // what finishSave does after saving B
    expect(s.data.has(draftKey('a'))).toBe(true);
    expect(io.draftLoad()?.meta.id).toBe('a');
  });

  it('draftLoad returns the most recently updated draft', () => {
    const s = memStorage();
    const io = new MapIO(s);
    io.draftSave(newCustomMap('Old', 'old', 100));
    io.draftSave(newCustomMap('New', 'new', 200));
    expect(io.draftLoad()?.meta.id).toBe('new');
  });

  it('drafts are stored compact', () => {
    const s = memStorage();
    const io = new MapIO(s);
    io.draftSave(newCustomMap('Alpha', 'a', 100));
    expect(s.data.get(draftKey('a'))).not.toContain('\n');
  });

  it('migrates the legacy single draft slot into a per-map slot', () => {
    const s = memStorage();
    const legacy = newCustomMap('Legacy', 'leg', 50);
    s.data.set(LEGACY_DRAFT_KEY, JSON.stringify(legacy));
    const io = new MapIO(s);
    expect(io.draftLoad()?.meta.id).toBe('leg');
    expect(s.data.has(LEGACY_DRAFT_KEY)).toBe(false);
    expect(s.data.has(draftKey('leg'))).toBe(true);
  });

  it('draftSave reports failure instead of pretending the backup exists', () => {
    const s = memStorage();
    s.setItem = () => {
      throw new Error('quota');
    };
    const io = new MapIO(s);
    expect(io.draftSave(newCustomMap('Alpha', 'a', 100))).toBe(false);
  });

  it('degrades gracefully with no storage', () => {
    const io = new MapIO(null);
    expect(io.draftSave(newCustomMap('A', 'a', 1))).toBe(false);
    expect(io.draftLoad()).toBeNull();
    io.draftClear('a'); // must not throw
  });
});

describe('MapIO server links (two-tab version race)', () => {
  it('REGRESSION: a stale tab keeps its own optimistic version', () => {
    // Audit K: linkFor re-read the shared localStorage key on every save, so
    // a stale tab silently adopted the other tab's version and never got the
    // 409 that triggers the save-as-copy flow.
    const s = memStorage();
    s.data.set(LINKS_KEY, JSON.stringify({ m1: { serverId: 7, version: 1 } }));
    const io = new MapIO(s);
    expect(io.linkFor('m1')?.version).toBe(1); // this tab opened the map at v1
    // Another tab saves: shared storage now says v2.
    s.data.set(LINKS_KEY, JSON.stringify({ m1: { serverId: 7, version: 2 } }));
    expect(io.linkFor('m1')?.version).toBe(1); // memory wins; the server 409s
  });

  it('setLink updates both memory and storage', () => {
    const s = memStorage();
    const io = new MapIO(s);
    io.setLink('m1', { serverId: 7, version: 3 });
    expect(io.linkFor('m1')).toEqual({ serverId: 7, version: 3 });
    expect(JSON.parse(s.data.get(LINKS_KEY) ?? '{}').m1.version).toBe(3);
    io.setLink('m1', null);
    expect(io.linkFor('m1')).toBeNull();
    expect(JSON.parse(s.data.get(LINKS_KEY) ?? '{}').m1).toBeUndefined();
  });

  it('storage stays the seed for maps this tab has not touched', () => {
    const s = memStorage();
    s.data.set(LINKS_KEY, JSON.stringify({ fresh: { serverId: 9, version: 4 } }));
    const io = new MapIO(s);
    expect(io.linkFor('fresh')).toEqual({ serverId: 9, version: 4 });
  });
});
