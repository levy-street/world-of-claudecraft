// Pure view core for the Plugin Store window (registered in UI_PURE_CORES):
// maps the fetched wire data + local UI state to a render model. DOM-free and
// i18n-free: every label crosses as a TranslationKey-shaped string constant
// the painter resolves through t(). Cold window (rebuilt per open/interaction),
// so allocation per build is fine.

import type {
  CatalogRowWire,
  InstalledRowWire,
  MineRowWire,
  PluginCategoryWire,
} from './plugins_client';

export type PluginsStoreTab = 'browse' | 'installed' | 'develop';

export const PLUGIN_CATEGORY_KEYS: Record<PluginCategoryWire, string> = {
  combat: 'hudChrome.plugins.catCombat',
  economy: 'hudChrome.plugins.catEconomy',
  social: 'hudChrome.plugins.catSocial',
  interface: 'hudChrome.plugins.catInterface',
  tools: 'hudChrome.plugins.catTools',
};

export const PLUGIN_CATEGORY_ORDER: readonly (PluginCategoryWire | 'all')[] = [
  'all',
  'combat',
  'economy',
  'social',
  'interface',
  'tools',
];

/** Review-state label keys for the develop tab. */
export const MINE_STATUS_KEYS = {
  pendingReview: 'hudChrome.plugins.statusPending',
  approved: 'hudChrome.plugins.statusApproved',
  rejected: 'hudChrome.plugins.statusRejected',
  listed: 'hudChrome.plugins.statusListed',
  delisted: 'hudChrome.plugins.statusDelisted',
} as const;

export interface PluginsStoreState {
  tab: PluginsStoreTab;
  catalog: CatalogRowWire[];
  installed: InstalledRowWire[];
  mine: MineRowWire[];
  search: string;
  category: PluginCategoryWire | 'all';
  /** True while the initial data fetch for the active tab is in flight. */
  loading: boolean;
  /** True when the player is signed in online (installs need an account). */
  online: boolean;
}

export interface BrowseRowModel {
  id: number;
  slug: string;
  name: string;
  summary: string;
  categoryKey: string;
  author: string | null;
  version: number;
  installs: number;
  installed: boolean;
  enabled: boolean;
}

export interface InstalledRowModel {
  id: number;
  slug: string;
  name: string;
  summary: string;
  categoryKey: string;
  version: number;
  enabled: boolean;
}

export interface MineRowModel {
  id: number;
  slug: string;
  name: string;
  statusKey: string;
  liveVersion: number | null;
  latestVersion: number | null;
  latestStatusKey: string | null;
  reviewNote: string;
}

export interface PluginsStoreViewModel {
  tab: PluginsStoreTab;
  online: boolean;
  loading: boolean;
  browse: BrowseRowModel[];
  installedRows: InstalledRowModel[];
  mineRows: MineRowModel[];
  /** True when browse is non-empty before filtering but empty after. */
  filteredOut: boolean;
}

function matchesSearch(row: { name: string; summary: string }, needle: string): boolean {
  if (!needle) return true;
  const hay = `${row.name}\n${row.summary}`.toLowerCase();
  return hay.includes(needle);
}

function mineStatusKey(row: MineRowWire): string {
  if (row.status === 'delisted') return MINE_STATUS_KEYS.delisted;
  if (row.status === 'listed') return MINE_STATUS_KEYS.listed;
  return MINE_STATUS_KEYS.pendingReview;
}

function latestStatusKey(row: MineRowWire): string | null {
  if (!row.latest) return null;
  if (row.latest.status === 'pending') return MINE_STATUS_KEYS.pendingReview;
  if (row.latest.status === 'approved') return MINE_STATUS_KEYS.approved;
  return MINE_STATUS_KEYS.rejected;
}

export function buildPluginsStoreView(state: PluginsStoreState): PluginsStoreViewModel {
  const needle = state.search.trim().toLowerCase();
  const installedBySlug = new Map(state.installed.map((row) => [row.slug, row]));

  const catalogFiltered = state.catalog
    .filter((row) => state.category === 'all' || row.category === state.category)
    .filter((row) => matchesSearch(row, needle));
  // Most-installed first; ties break on the newest update so fresh work is
  // discoverable before it has installs.
  const browse = [...catalogFiltered]
    .sort((a, b) => b.installs - a.installs || b.updatedAt.localeCompare(a.updatedAt))
    .map((row) => {
      const install = installedBySlug.get(row.slug);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        summary: row.summary,
        categoryKey: PLUGIN_CATEGORY_KEYS[row.category],
        author: row.author,
        version: row.version,
        installs: row.installs,
        installed: install !== undefined,
        enabled: install?.enabled === true,
      };
    });

  const installedRows = state.installed
    .filter((row) => matchesSearch(row, needle))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      categoryKey: PLUGIN_CATEGORY_KEYS[row.category],
      version: row.version,
      enabled: row.enabled,
    }));

  const mineRows = state.mine.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    statusKey: mineStatusKey(row),
    liveVersion: row.liveVersion,
    latestVersion: row.latest?.version ?? null,
    latestStatusKey: latestStatusKey(row),
    reviewNote: row.latest?.status === 'rejected' ? row.latest.reviewNote : '',
  }));

  return {
    tab: state.tab,
    online: state.online,
    loading: state.loading,
    browse,
    installedRows,
    mineRows,
    filteredOut: state.catalog.length > 0 && browse.length === 0,
  };
}
