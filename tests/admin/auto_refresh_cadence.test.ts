// @vitest-environment happy-dom
import './_setup';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every `.svelte` under `dir`, recursively, with its source text. */
function sveltePagesUnder(dir: string): Array<{ name: string; source: string }> {
  const out: Array<{ name: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sveltePagesUnder(full));
    else if (entry.name.endsWith('.svelte')) {
      out.push({ name: entry.name.replace('.svelte', ''), source: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

// The cadence pin for every polling admin surface, driven rather than read.
//
// Collapsing five pages onto one shared auto-refresh composition
// (src/admin/state/auto_refresh.svelte.ts) had exactly one hard requirement:
// no page's poll interval may move. A source-text pin over the constants would
// not say that, because the constant and the interval it is passed to are two
// different things and the whole point of the collapse was to separate them.
// So each row below RUNS its page on fake timers and asserts the refetch lands
// on the stated millisecond and not one tick earlier.
//
// Overview is in the table but deliberately NOT converted: it has no operator
// toggle and two independent cadences, and `poll()` already collapses it. It
// is pinned here because its two cadences (5s live, 60s activity) are the ones
// the shared constants LIVE_REFRESH_MS / ACTIVITY_REFRESH_MS carry, and
// DetectionCalibration now polls on the first of them.

const OVERVIEW = {
  accounts: 12,
  characters: 30,
  accountsToday: 2,
  accountsWeek: 5,
  accountsMonth: 8,
  sessionsToday: 8,
  activeAccountsToday: 4,
  activeAccountsWeek: 7,
  activeAccountsMonth: 10,
  returningAccountsToday: 2,
  avgPlaytimeSeconds: 900,
  peakOnlineToday: 9,
  peakOnlineAllTime: 14,
  playersCap: 512,
  siteUsersNow: 6,
  server: {
    online: 3,
    onlineAccounts: 2,
    peakOnline: 9,
    uptimeSeconds: 3600,
    tickMsAvg: 2,
    simEntities: 5,
    rssBytes: 1048576,
    heapUsedBytes: 524288,
  },
};
const ACTIVITY = { days: 7, registrations: [], sessions: [], classes: [], levels: [] };
const ONLINE_HISTORY = { range: '24h', bucket: 'hour', points: [] };

const PAYLOADS: Record<string, unknown> = {
  '/admin/api/overview': OVERVIEW,
  '/admin/api/activity': ACTIVITY,
  '/admin/api/online-history': ONLINE_HISTORY,
  '/admin/api/market/metrics': { realm: 'eastbrook', buckets: [] },
  '/admin/api/wealth/top': { rows: [] },
  '/admin/api/online': { players: [] },
  '/admin/api/suspicious-players': { players: [] },
  '/admin/api/detection-calibration': { histograms: [] },
  '/admin/api/provider-usage': { providers: [] },
  '/admin/api/perf/tick': { running: false, capture: null },
};

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import DetectionCalibration from '../../src/admin/pages/DetectionCalibration.svelte';
import MarketMetrics from '../../src/admin/pages/MarketMetrics.svelte';
import OnlinePlayers from '../../src/admin/pages/OnlinePlayers.svelte';
import Overview from '../../src/admin/pages/Overview.svelte';
import SuspiciousPlayers from '../../src/admin/pages/SuspiciousPlayers.svelte';
import TickPerf from '../../src/admin/pages/TickPerf.svelte';
import TopHolders from '../../src/admin/pages/TopHolders.svelte';
import Usage from '../../src/admin/pages/Usage.svelte';
import {
  ACTIVITY_REFRESH_MS,
  LIVE_REFRESH_MS,
  ONLINE_REFRESH_MS,
} from '../../src/admin/state/poll';

// One row per polled endpoint: the page file that owns it, the path it
// re-reads, and the cadence in milliseconds. The cadence is written as a
// LITERAL, never as the constant the page imports, so re-pointing a page at a
// different constant fails here instead of agreeing with itself.
const CADENCES: Array<{
  name: string;
  page: string;
  // biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of Svelte components
  component: any;
  path: string;
  intervalMs: number;
}> = [
  {
    name: 'Overview live stats',
    page: 'Overview',
    component: Overview,
    path: '/admin/api/overview',
    intervalMs: 5_000,
  },
  {
    name: 'Overview activity',
    page: 'Overview',
    component: Overview,
    path: '/admin/api/activity',
    intervalMs: 60_000,
  },
  {
    name: 'Overview online history',
    page: 'Overview',
    component: Overview,
    path: '/admin/api/online-history',
    intervalMs: 60_000,
  },
  {
    name: 'MarketMetrics',
    page: 'MarketMetrics',
    component: MarketMetrics,
    path: '/admin/api/market/metrics',
    intervalMs: 30_000,
  },
  {
    name: 'TopHolders',
    page: 'TopHolders',
    component: TopHolders,
    path: '/admin/api/wealth/top',
    intervalMs: 30_000,
  },
  {
    name: 'SuspiciousPlayers',
    page: 'SuspiciousPlayers',
    component: SuspiciousPlayers,
    path: '/admin/api/suspicious-players',
    intervalMs: 30_000,
  },
  {
    name: 'OnlinePlayers',
    page: 'OnlinePlayers',
    component: OnlinePlayers,
    path: '/admin/api/online',
    intervalMs: 60_000,
  },
  {
    name: 'DetectionCalibration',
    page: 'DetectionCalibration',
    component: DetectionCalibration,
    path: '/admin/api/detection-calibration',
    intervalMs: 5_000,
  },
  // The other two `poll()` pages. Neither carries an operator toggle, so
  // neither is converted; both are pinned because the coverage arm below
  // refuses to let a polling page go unpinned.
  {
    name: 'Usage',
    page: 'Usage',
    component: Usage,
    path: '/admin/api/provider-usage',
    intervalMs: 5_000,
  },
  {
    name: 'TickPerf',
    page: 'TickPerf',
    component: TickPerf,
    path: '/admin/api/perf/tick',
    intervalMs: 1_000,
  },
];

function callsTo(path: string): number {
  return mocks.apiGet.mock.calls.filter((call) => String(call[0]).startsWith(path)).length;
}

describe('admin polling cadences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.apiGet.mockReset();
    mocks.apiGet.mockImplementation(async (path: string) => {
      for (const [prefix, payload] of Object.entries(PAYLOADS)) {
        if (path.startsWith(prefix)) return payload;
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(CADENCES)('$name re-reads $path every $intervalMs ms', async (row) => {
    render(row.component);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsTo(row.path), 'the mount read did not fire exactly once').toBe(1);
    // Not one tick early.
    await vi.advanceTimersByTimeAsync(row.intervalMs - 1);
    expect(callsTo(row.path), 'polled before the cadence elapsed').toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callsTo(row.path), 'did not poll on the cadence').toBe(2);
    // ...and keeps that cadence rather than firing once and stopping.
    await vi.advanceTimersByTimeAsync(row.intervalMs * 2);
    expect(callsTo(row.path), 'the cadence did not repeat').toBe(4);
  });

  it('pins the shared cadence constants the pages read', () => {
    // The table above uses literals on purpose; this row is what ties those
    // literals back to the constants, so moving a constant fails loudly here
    // instead of quietly re-timing a page that imports it.
    expect(LIVE_REFRESH_MS).toBe(5_000);
    expect(ACTIVITY_REFRESH_MS).toBe(60_000);
    expect(ONLINE_REFRESH_MS).toBe(60_000);
  });

  it('covers every polling page in src/admin/pages', () => {
    // A new polling page that forgets a row above would leave its cadence
    // unpinned, which is exactly the regression this file exists to catch.
    // Recursive (the `svelteFiles` shape of tests/svelte_typography.test.ts):
    // pages/ is flat today, and a single-level read would silently stop
    // covering the day it is not.
    const polling = sveltePagesUnder('src/admin/pages')
      // `createAutoRefresh<T>(...)` carries a type argument at every call site,
      // so the open bracket is either `<` or `(`.
      .filter(({ source }) => /createAutoRefresh[<(]|\bpoll\(/.test(source))
      .map(({ name }) => name)
      .sort();
    const pinned = [...new Set(CADENCES.map((row) => row.page))].sort();
    expect(polling).toEqual(pinned);
    // Vacuity floor: an it.each over an empty list registers no cases at all,
    // and an empty scan would make the equality above trivially true.
    expect(polling.length).toBeGreaterThanOrEqual(6);
  });
});
