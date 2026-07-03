// Housekeeping server logic (server/housekeeping.ts): patch merging, the
// restart-pending comparison, and the admin catalogs. DB-free by design (the
// module under test never imports db.ts).
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyGameConfigAtBoot,
  calendarCatalog,
  clearOverrides,
  housekeepingOverview,
  itemsCatalog,
  mergeOverridePatch,
  mobsCatalog,
  npcsCatalog,
  questsCatalog,
  ratesCatalog,
  spawnsCatalog,
  stableStringify,
  worldCatalog,
} from '../server/housekeeping';
import { CAMPS, MOBS, QUESTS } from '../src/sim/data';
import { applyGameConfig } from '../src/sim/game_config';

const anyMobId = Object.keys(MOBS)[0];
const anyQuestId = Object.keys(QUESTS)[0];

afterEach(() => {
  applyGameConfig({});
});

describe('stableStringify', () => {
  it('is key-order insensitive', () => {
    expect(stableStringify({ a: 1, b: [{ y: 2, x: 3 }] })).toBe(
      stableStringify({ b: [{ x: 3, y: 2 }], a: 1 }),
    );
  });
});

describe('mergeOverridePatch', () => {
  it('sets, replaces, and deletes an entity override', () => {
    const set = mergeOverridePatch({}, { domain: 'mobs', id: anyMobId, patch: { hpBase: 50 } });
    expect(set.errors).toEqual([]);
    expect(set.next?.mobs?.[anyMobId]).toEqual({ hpBase: 50 });

    const replaced = mergeOverridePatch(set.next, {
      domain: 'mobs',
      id: anyMobId,
      patch: { dmgBase: 9 },
    });
    expect(replaced.next?.mobs?.[anyMobId]).toEqual({ dmgBase: 9 });

    const deleted = mergeOverridePatch(replaced.next, {
      domain: 'mobs',
      id: anyMobId,
      patch: null,
    });
    expect(deleted.next?.mobs).toBeUndefined();
  });

  it('rejects an invalid patch without touching the document', () => {
    const result = mergeOverridePatch(
      { mobs: { [anyMobId]: { hpBase: 50 } } },
      { domain: 'mobs', id: anyMobId, patch: { hpBase: -1 } },
    );
    expect(result.next).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown domains and missing ids', () => {
    expect(mergeOverridePatch({}, { domain: 'nope', patch: {} }).errors).toEqual([
      'unknown override domain',
    ]);
    expect(mergeOverridePatch({}, { domain: 'mobs', patch: {} }).errors).toEqual([
      'an entry id is required',
    ]);
  });

  it('replaces the rates block wholesale and drops stale saved entries with warnings', () => {
    const stale = { mobs: { ghost_mob_gone: { hpBase: 5 } }, rates: { xpRate: 2 } };
    const result = mergeOverridePatch(stale, { domain: 'rates', patch: { goldDropRate: 3 } });
    expect(result.errors).toEqual([]);
    expect(result.next?.rates).toEqual({ goldDropRate: 3 });
    expect(result.next?.mobs).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('ghost_mob_gone'))).toBe(true);
  });

  it('replaces and clears the calendar block like rates', () => {
    const result = mergeOverridePatch({}, { domain: 'calendar', patch: { eventLimit: 5 } });
    expect(result.errors).toEqual([]);
    expect(result.next?.calendar).toEqual({ eventLimit: 5 });
    const cleared = clearOverrides(result.next, { domain: 'calendar' });
    expect(cleared.next?.calendar).toBeUndefined();
    const bad = mergeOverridePatch({}, { domain: 'calendar', patch: { eventLimit: 0 } });
    expect(bad.next).toBeNull();
    expect(bad.errors).toEqual(['calendar: invalid eventLimit']);
  });

  it('clearOverrides clears everything, a domain, or one entry', () => {
    const doc = {
      rates: { xpRate: 2 },
      mobs: { [anyMobId]: { hpBase: 50 } },
    };
    expect(clearOverrides(doc, {}).next).toEqual({});
    expect(clearOverrides(doc, { domain: 'rates' }).next?.rates).toBeUndefined();
    const entry = clearOverrides(doc, { domain: 'mobs', id: anyMobId });
    expect(entry.next?.mobs).toBeUndefined();
    expect(entry.next?.rates).toEqual({ xpRate: 2 });
  });
});

describe('boot apply + restart pending', () => {
  it('flags a restart only when saved differs from applied', () => {
    applyGameConfigAtBoot({ rates: { xpRate: 2 } }, '2026-01-01T00:00:00.000Z');
    const same = ratesCatalog({ rates: { xpRate: 2 } }, null);
    expect(same.status.restartPending).toBe(false);
    expect(same.applied.xpRate).toBe(2);
    const different = ratesCatalog({ rates: { xpRate: 3 } }, null);
    expect(different.status.restartPending).toBe(true);
    applyGameConfigAtBoot({}, '2026-01-01T00:00:00.000Z');
    expect(ratesCatalog({}, null).status.restartPending).toBe(false);
  });

  it('reports dropped entries as boot warnings on the overview', () => {
    applyGameConfigAtBoot({ mobs: { ghost_mob_gone: { hpBase: 5 } } }, '2026-01-01T00:00:00.000Z');
    const overview = housekeepingOverview({
      realm: 'TestRealm',
      worldSeed: 20061,
      devCommands: false,
      savedRaw: {},
      savedUpdatedAt: null,
    });
    expect(overview.bootWarnings.some((w) => w.includes('ghost_mob_gone'))).toBe(true);
    applyGameConfigAtBoot({}, '2026-01-01T00:00:00.000Z');
  });
});

describe('catalogs', () => {
  it('calendar catalog carries fields, defaults, applied, and the saved override', () => {
    const catalog = calendarCatalog({ calendar: { eventLimit: 5 } }, null);
    expect(catalog.fields.map((f) => f.key)).toEqual([
      'eventLimit',
      'titleMax',
      'noteMax',
      'horizonDays',
      'keepPastDays',
    ]);
    expect(catalog.defaults.eventLimit).toBe(25);
    expect(catalog.applied.eventLimit).toBe(25);
    expect(catalog.saved).toEqual({ eventLimit: 5 });
    expect(catalog.status.restartPending).toBe(true);
  });

  it('overview counts content and overrides', () => {
    const overview = housekeepingOverview({
      realm: 'TestRealm',
      worldSeed: 20061,
      devCommands: true,
      savedRaw: { mobs: { [anyMobId]: { hpBase: 50 } }, rates: { xpRate: 2 } },
      savedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(overview.realm).toBe('TestRealm');
    expect(overview.devCommands).toBe(true);
    expect(overview.counts.mobs).toBe(Object.keys(MOBS).length);
    expect(overview.counts.camps).toBe(CAMPS.length);
    expect(overview.overrideCounts.mobs).toBe(1);
    expect(overview.overrideCounts.rates).toBe(1);
    expect(overview.status.savedUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('mob rows carry defaults, live values, spawn sources, and the override', () => {
    const catalog = mobsCatalog({ mobs: { [anyMobId]: { hpBase: 55 } } }, null);
    const row = catalog.rows.find((r) => r.id === anyMobId);
    expect(row).toBeDefined();
    expect(row?.name).toBe(MOBS[anyMobId].name);
    expect(row?.defaults.hpBase).toBe(MOBS[anyMobId].hpBase);
    expect(row?.override).toEqual({ hpBase: 55 });
    const campMob = catalog.rows.find((r) => r.id === CAMPS[0].mobId);
    expect(campMob?.spawns.campCount).toBeGreaterThan(0);
    expect(campMob?.spawns.zones.length).toBeGreaterThan(0);
  });

  it('quest rows resolve giver npcs and objectives', () => {
    const catalog = questsCatalog({}, null);
    const row = catalog.rows.find((r) => r.id === anyQuestId);
    expect(row).toBeDefined();
    expect(row?.objectives.length).toBe(QUESTS[anyQuestId].objectives.length);
    for (const objective of row?.objectives ?? []) {
      expect(objective.countDefault).toBeGreaterThan(0);
    }
  });

  it('spawn rows are indexed camps with zone names', () => {
    const catalog = spawnsCatalog({ camps: { '0': { mobId: CAMPS[0].mobId, count: 9 } } }, null);
    expect(catalog.rows.length).toBe(CAMPS.length);
    expect(catalog.rows[0].mobName).toBe(MOBS[CAMPS[0].mobId].name);
    expect(catalog.rows[0].zone.length).toBeGreaterThan(0);
    expect(catalog.rows[0].override).toEqual({ mobId: CAMPS[0].mobId, count: 9 });
  });

  it('item, npc, and world catalogs produce rows', () => {
    expect(itemsCatalog({}, null).rows.length).toBeGreaterThan(0);
    const npcs = npcsCatalog({}, null);
    expect(npcs.rows.length).toBeGreaterThan(0);
    const world = worldCatalog({}, null);
    expect(world.zones.length).toBeGreaterThan(0);
    expect(world.dungeons.length).toBeGreaterThan(0);
    expect(world.delves.length).toBeGreaterThan(0);
    expect(world.zones[0].campCount).toBeGreaterThan(0);
  });
});
