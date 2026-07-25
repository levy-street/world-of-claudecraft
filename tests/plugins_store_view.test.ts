import { describe, expect, it } from 'vitest';
import type {
  CatalogRowWire,
  InstalledRowWire,
  MineRowWire,
} from '../src/ui/plugins/plugins_client';
import {
  buildPluginsStoreView,
  type PluginsStoreState,
} from '../src/ui/plugins/plugins_store_view';

let nextId = 1;

function catalogRow(overrides: Partial<CatalogRowWire> = {}): CatalogRowWire {
  const id = nextId++;
  return {
    id,
    slug: `plugin-${id}`,
    name: `Plugin ${id}`,
    summary: 'does things',
    category: 'tools',
    author: null,
    version: 1,
    installs: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function installedRow(overrides: Partial<InstalledRowWire> = {}): InstalledRowWire {
  const id = nextId++;
  return {
    id,
    slug: `plugin-${id}`,
    name: `Plugin ${id}`,
    summary: 'does things',
    category: 'tools',
    version: 1,
    enabled: true,
    source: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mineRow(overrides: Partial<MineRowWire> = {}): MineRowWire {
  const id = nextId++;
  return {
    id,
    slug: `mine-${id}`,
    name: `Mine ${id}`,
    summary: 'my plugin',
    description: 'longer text',
    category: 'tools',
    author: 'Aki',
    status: 'listed',
    liveVersion: 1,
    latest: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<PluginsStoreState> = {}): PluginsStoreState {
  return {
    tab: 'browse',
    catalog: [],
    installed: [],
    mine: [],
    search: '',
    category: 'all',
    loading: false,
    online: true,
    ...overrides,
  };
}

describe('buildPluginsStoreView browse tab', () => {
  it('keeps only rows matching the category filter', () => {
    const combat = catalogRow({ slug: 'dps', category: 'combat' });
    const economy = catalogRow({ slug: 'gold', category: 'economy' });
    const view = buildPluginsStoreView(state({ catalog: [combat, economy], category: 'combat' }));
    expect(view.browse.map((r) => r.slug)).toEqual(['dps']);
    expect(view.browse[0].categoryKey).toBe('hudChrome.plugins.catCombat');
  });

  it('matches search against name OR summary, case-insensitively', () => {
    const byName = catalogRow({ slug: 'by-name', name: 'DPS Meter', summary: 'numbers' });
    const bySummary = catalogRow({ slug: 'by-summary', name: 'Meter', summary: 'a dps tracker' });
    const miss = catalogRow({ slug: 'miss', name: 'Gold Ledger', summary: 'coins' });
    const view = buildPluginsStoreView(
      state({ catalog: [byName, bySummary, miss], search: '  dPs ' }),
    );
    expect(view.browse.map((r) => r.slug).sort()).toEqual(['by-name', 'by-summary']);
  });

  it('sorts by installs desc, breaking ties on updatedAt desc', () => {
    const older = catalogRow({
      slug: 'older',
      installs: 50,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const newer = catalogRow({
      slug: 'newer',
      installs: 50,
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    const popular = catalogRow({
      slug: 'popular',
      installs: 900,
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    const view = buildPluginsStoreView(state({ catalog: [older, newer, popular] }));
    expect(view.browse.map((r) => r.slug)).toEqual(['popular', 'newer', 'older']);
  });

  it('derives installed/enabled flags from the installed list by slug', () => {
    const running = catalogRow({ slug: 'running' });
    const paused = catalogRow({ slug: 'paused' });
    const fresh = catalogRow({ slug: 'fresh' });
    const view = buildPluginsStoreView(
      state({
        catalog: [running, paused, fresh],
        installed: [
          installedRow({ slug: 'running', enabled: true }),
          installedRow({ slug: 'paused', enabled: false }),
        ],
      }),
    );
    const bySlug = new Map(view.browse.map((r) => [r.slug, r]));
    expect(bySlug.get('running')).toMatchObject({ installed: true, enabled: true });
    expect(bySlug.get('paused')).toMatchObject({ installed: true, enabled: false });
    expect(bySlug.get('fresh')).toMatchObject({ installed: false, enabled: false });
  });

  it('sets filteredOut only when a non-empty catalog is emptied by the filter', () => {
    const rows = [catalogRow({ name: 'Solo', summary: 'one' })];
    expect(buildPluginsStoreView(state({ catalog: rows, search: 'zzz' })).filteredOut).toBe(true);
    expect(buildPluginsStoreView(state({ catalog: rows })).filteredOut).toBe(false);
    expect(buildPluginsStoreView(state({ catalog: [], search: 'zzz' })).filteredOut).toBe(false);
  });
});

describe('buildPluginsStoreView installed tab', () => {
  it('carries enabled flags and category label keys', () => {
    const view = buildPluginsStoreView(
      state({
        tab: 'installed',
        installed: [
          installedRow({ slug: 'on', category: 'interface', enabled: true, version: 3 }),
          installedRow({ slug: 'off', category: 'social', enabled: false }),
        ],
      }),
    );
    expect(view.installedRows).toMatchObject([
      { slug: 'on', enabled: true, version: 3, categoryKey: 'hudChrome.plugins.catInterface' },
      { slug: 'off', enabled: false, categoryKey: 'hudChrome.plugins.catSocial' },
    ]);
  });
});

describe('buildPluginsStoreView develop tab', () => {
  it('maps plugin status to its label key', () => {
    const view = buildPluginsStoreView(
      state({
        tab: 'develop',
        mine: [
          mineRow({ slug: 'p', status: 'pending', liveVersion: null }),
          mineRow({ slug: 'l', status: 'listed' }),
          mineRow({ slug: 'd', status: 'delisted' }),
        ],
      }),
    );
    expect(view.mineRows.map((r) => r.statusKey)).toEqual([
      'hudChrome.plugins.statusPending',
      'hudChrome.plugins.statusListed',
      'hudChrome.plugins.statusDelisted',
    ]);
  });

  it('maps the latest submission status and surfaces reviewNote only when rejected', () => {
    const rejected = mineRow({
      status: 'listed',
      latest: {
        version: 4,
        status: 'rejected',
        reviewNote: 'uses innerHTML on raw chat',
        submittedAt: '2026-06-01T00:00:00.000Z',
      },
    });
    const approved = mineRow({
      status: 'listed',
      latest: { version: 2, status: 'approved', reviewNote: 'looks fine', submittedAt: '' },
    });
    const pending = mineRow({
      status: 'pending',
      liveVersion: null,
      latest: { version: 1, status: 'pending', reviewNote: '', submittedAt: '' },
    });
    const none = mineRow({ status: 'listed', latest: null });
    const view = buildPluginsStoreView(
      state({ tab: 'develop', mine: [rejected, approved, pending, none] }),
    );
    expect(view.mineRows[0]).toMatchObject({
      latestVersion: 4,
      latestStatusKey: 'hudChrome.plugins.statusRejected',
      reviewNote: 'uses innerHTML on raw chat',
    });
    // An approved latest never surfaces its note.
    expect(view.mineRows[1]).toMatchObject({
      latestStatusKey: 'hudChrome.plugins.statusApproved',
      reviewNote: '',
    });
    expect(view.mineRows[2]).toMatchObject({
      latestStatusKey: 'hudChrome.plugins.statusPending',
      reviewNote: '',
    });
    expect(view.mineRows[3]).toMatchObject({
      latestVersion: null,
      latestStatusKey: null,
      reviewNote: '',
    });
  });
});
