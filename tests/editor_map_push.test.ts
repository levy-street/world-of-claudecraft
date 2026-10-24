// Change-only push end to end on a real repo map (src/editor/map_push.ts),
// against a stand-in for the dev server's /__studio_map routes. Pinned here:
//  - the editor's open-time upgrades (map_load_upgrades.ts) change a repo
//    map, and a push re-runs them on its base, so opening and pushing with
//    no edit pushes nothing;
//  - one edit pushed over a teammate's newer file lands as exactly that edit,
//    with the teammate's changes and the raw file's other items untouched;
//    an edited item an upgrade repaired lands as that one upgraded item, and
//    only an edit to an item an upgrade ADDED writes the upgrades too;
//  - the upgrades come out the same whichever world was active before (they
//    sample the map's own terrain and zones), and leave that world active;
//  - content-derived ids name the same item alike on two copies and never
//    take an id another item already holds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CustomMap,
  customMapToWorldContent,
  newFlatCustomMap,
} from '../src/editor/custom_map';
import { ensureMapItemIdsFromContent } from '../src/editor/map_item_ids';
import { upgradeLoadedMap } from '../src/editor/map_load_upgrades';
import { canonicalJson } from '../src/editor/map_merge_core';
import { MAP_BASE_HEADER, pushMapChanges } from '../src/editor/map_push';
import { parseMap } from '../src/editor/persist';
import { getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';

const SLUG = 'eastbrook_rebuild';
const BASE_ID = 'a'.repeat(40);
const NOW_ID = 'b'.repeat(40);
const fileText = readFileSync(`data/maps/${SLUG}.map.json`, 'utf8');

/** The dev server: the base version by id, and the repo file as it is now. */
function devServer(nowText: string) {
  return async (url: string): Promise<Response> => {
    if (url === `/__studio_map/base?id=${BASE_ID}`) return new Response(fileText);
    if (url === `/__studio_map/doc?slug=${SLUG}`) {
      return new Response(nowText, { headers: { [MAP_BASE_HEADER]: NOW_ID } });
    }
    return new Response('', { status: 404 });
  };
}

/** The repo map as the editor opens it (EditorApp.loadMap). */
function openInEditor() {
  const map = parseMap(fileText);
  if (!map) throw new Error('unreadable fixture');
  upgradeLoadedMap(map);
  map.meta.basedOn = { slug: SLUG, base: BASE_ID };
  return map;
}

describe('change-only push over the editor open-time upgrades', () => {
  it('the upgrades really change this map (the guard below is not vacuous)', () => {
    const raw = parseMap(fileText);
    expect(raw).not.toBeNull();
    expect(canonicalJson(openInEditor().placements)).not.toBe(canonicalJson(raw?.placements));
  });

  it('pushes nothing when the maker opened the map and edited nothing', async () => {
    let published = false;
    const outcome = await pushMapChanges(
      openInEditor(),
      async () => {
        published = true;
        return true;
      },
      devServer(fileText),
    );
    expect(outcome.status).toBe('nothing');
    expect(published).toBe(false);
  });

  /** Push `edit` (made on the opened map) over a file a teammate changed:
   *  they moved one building and deleted another since the base. */
  async function pushOverTeammate(edit: (mine: CustomMap) => void) {
    const theirs = parseMap(fileText);
    if (!theirs) throw new Error('unreadable fixture');
    theirs.placements[10].x += 3;
    const theirDelete = theirs.placements[20].uid;
    theirs.placements = theirs.placements.filter((p) => p.uid !== theirDelete);
    const mine = openInEditor();
    edit(mine);
    let written: CustomMap | null = null;
    const outcome = await pushMapChanges(
      mine,
      async (merged) => {
        written = merged;
        return true;
      },
      devServer(JSON.stringify(theirs)),
    );
    return { outcome, theirs, mine, written: written as CustomMap | null };
  }

  /** The raw file's placements, split by what the open-time upgrades do. */
  function upgradeSplit() {
    const raw = parseMap(fileText);
    if (!raw) throw new Error('unreadable fixture');
    const opened = openInEditor();
    const byUid = new Map(opened.placements.map((p) => [p.uid, p]));
    const rawUids = new Set(raw.placements.map((p) => p.uid));
    const untouched = raw.placements.findIndex(
      (p, i) => i > 30 && canonicalJson(byUid.get(p.uid)) === canonicalJson(p),
    );
    const repaired = raw.placements.findIndex((p, i) => {
      const o = byUid.get(p.uid);
      return i > 30 && o !== undefined && canonicalJson(o) !== canonicalJson(p);
    });
    const added = opened.placements.find((p) => !rawUids.has(p.uid));
    return { raw, untouched, repaired, added };
  }

  it('pushes an edit to an item the upgrades leave alone as exactly that edit', async () => {
    const { raw, untouched } = upgradeSplit();
    expect(untouched).toBeGreaterThan(0);
    const uid = raw.placements[untouched].uid;
    const { outcome, theirs, written } = await pushOverTeammate((mine) => {
      const p = mine.placements.find((q) => q.uid === uid);
      if (p) p.x += 5;
    });
    expect(outcome.status).toBe('pushed');
    if (outcome.status === 'pushed') expect(outcome.withUpgrades).toBe(false);
    if (!written) throw new Error('nothing written');
    const out: CustomMap = written;
    // Every item but mine is the teammate's raw item, in their order.
    const expected = theirs.placements.map((p) =>
      p.uid === uid ? { ...p, x: raw.placements[untouched].x + 5 } : p,
    );
    expect(canonicalJson(out.placements)).toBe(canonicalJson(expected));
    const { placements: _a, meta: _b, ...outRest } = out;
    const { placements: _c, meta: _d, ...theirRest } = theirs;
    expect(canonicalJson(outRest)).toBe(canonicalJson(theirRest));
  });

  it('pushes an edit to an item an upgrade repaired as that one item, upgraded', async () => {
    const { raw, repaired } = upgradeSplit();
    expect(repaired).toBeGreaterThan(0);
    const uid = raw.placements[repaired].uid;
    let mineItem: unknown = null;
    const { outcome, theirs, written } = await pushOverTeammate((mine) => {
      const p = mine.placements.find((q) => q.uid === uid);
      if (!p) return;
      p.x += 5;
      mineItem = structuredClone(p);
    });
    expect(outcome.status).toBe('pushed');
    if (outcome.status === 'pushed') expect(outcome.withUpgrades).toBe(false);
    if (!written) throw new Error('nothing written');
    const out: CustomMap = written;
    const expected = theirs.placements.map((p) => (p.uid === uid ? mineItem : p));
    expect(canonicalJson(out.placements)).toBe(canonicalJson(expected));
  });

  it('writes the upgrades too when an edit is to an item an upgrade added', async () => {
    const { added } = upgradeSplit();
    if (!added) throw new Error('the fixture upgrades add no item');
    const { outcome, mine, written } = await pushOverTeammate((m) => {
      const p = m.placements.find((q) => q.uid === added.uid);
      if (p) p.x += 5;
    });
    expect(outcome.status).toBe('pushed');
    if (outcome.status === 'pushed') expect(outcome.withUpgrades).toBe(true);
    if (!written) throw new Error('nothing written');
    const out: CustomMap = written;
    const edited = out.placements.find((p) => p.uid === added.uid);
    expect(edited?.x).toBe(mine.placements.find((p) => p.uid === added.uid)?.x);
    expect(canonicalJson(out.promotedScenery)).toBe(canonicalJson(mine.promotedScenery));
  });
});

describe('a refused push writes nothing', () => {
  async function pushOver(now: CustomMap, edit: (mine: CustomMap) => void) {
    const mine = openInEditor();
    edit(mine);
    let published = false;
    const outcome = await pushMapChanges(
      mine,
      async () => {
        published = true;
        return true;
      },
      devServer(JSON.stringify(now)),
    );
    return { outcome, published };
  }

  it('refuses a repo file with items lacking ids, or sharing one', async () => {
    const noIds = parseMap(fileText);
    if (!noIds) throw new Error('unreadable fixture');
    delete noIds.placements[5].uid;
    const a = await pushOver(noIds, (m) => {
      m.placements[40].x += 1;
    });
    expect(a.outcome.status).toBe('missingIds');
    expect(a.published).toBe(false);
    const twins = parseMap(fileText);
    if (!twins) throw new Error('unreadable fixture');
    twins.placements[6].uid = twins.placements[7].uid;
    const b = await pushOver(twins, (m) => {
      m.placements[40].x += 1;
    });
    expect(b.outcome.status).toBe('missingIds');
    expect(b.published).toBe(false);
  });

  it('refuses when they and I moved the same item', async () => {
    const theirs = parseMap(fileText);
    if (!theirs) throw new Error('unreadable fixture');
    const uid = theirs.placements[3].uid;
    theirs.placements[3].x += 7;
    const { outcome, published } = await pushOver(theirs, (m) => {
      const p = m.placements.find((q) => q.uid === uid);
      if (p) p.x -= 7;
    });
    expect(outcome.status).toBe('conflicts');
    if (outcome.status === 'conflicts') {
      expect(outcome.conflicts).toContainEqual({ kind: 'placement', id: uid, reason: 'both' });
    }
    expect(published).toBe(false);
  });
});

describe('the open-time upgrades', () => {
  it('give the same map whichever world was active before, and restore it', () => {
    const other = parseMap(readFileSync('data/maps/world_of_claudecraft.map.json', 'utf8'));
    if (!other) throw new Error('unreadable fixture');
    const underBuiltin = openInEditor();
    const otherWorld = customMapToWorldContent(other);
    setActiveWorldContent(otherWorld);
    try {
      const underOther = openInEditor();
      expect(getActiveWorldContent()).toBe(otherWorld);
      expect(canonicalJson(underOther)).toBe(canonicalJson(underBuiltin));
    } finally {
      setActiveWorldContent(null);
    }
  });
});

describe('content-derived item ids', () => {
  const twoProps = () => {
    const map = newFlatCustomMap('m', 'm', 0);
    map.placements = [
      { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: true },
      { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: true },
      { assetId: 'props/barrel', x: 4, z: 2, rotY: 0, scale: 1, collide: true },
    ];
    return map;
  };

  it('names the same items alike on two copies, twins apart', () => {
    const a = twoProps();
    const b = twoProps();
    ensureMapItemIdsFromContent(a);
    ensureMapItemIdsFromContent(b);
    const ids = a.placements.map((p) => p.uid);
    expect(b.placements.map((p) => p.uid)).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('never takes an id an item further down still holds', () => {
    const probe = twoProps();
    ensureMapItemIdsFromContent(probe);
    const clash = probe.placements[0].uid;
    const map = twoProps();
    map.placements[2].uid = clash;
    ensureMapItemIdsFromContent(map);
    expect(map.placements[2].uid).toBe(clash);
    expect(new Set(map.placements.map((p) => p.uid)).size).toBe(3);
  });
});
