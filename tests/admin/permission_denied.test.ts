// @vitest-environment happy-dom
import './_setup';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Keep the real module so ApiError is the real class: classifyAdminLoadFailure
// judges by `instanceof`, and a stand-in class would make every arm here pass
// for the wrong reason.
vi.mock('../../src/admin/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/admin/api')>()),
  apiGet: vi.fn(async () => ({})),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { ApiError, apiGet } from '../../src/admin/api';
import AccountWealthPanel from '../../src/admin/components/AccountWealthPanel.svelte';
import PermissionDenied from '../../src/admin/components/PermissionDenied.svelte';
import { t } from '../../src/admin/i18n';
import Accounts from '../../src/admin/pages/Accounts.svelte';
import MarketMetrics from '../../src/admin/pages/MarketMetrics.svelte';
import Overview from '../../src/admin/pages/Overview.svelte';
import TopHolders from '../../src/admin/pages/TopHolders.svelte';

const apiGetMock = apiGet as unknown as Mock<(path: string) => Promise<unknown>>;

/** Every `.svelte` under `dir`, recursively, with its source text. */
function svelteFiles(dir: string): Array<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...svelteFiles(full));
    else if (entry.name.endsWith('.svelte')) {
      out.push({ file: full, source: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

describe('PermissionDenied', () => {
  it('renders the shared title and detail through t()', () => {
    render(PermissionDenied);
    expect(screen.getByText(t('loadFailure.forbiddenTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('loadFailure.forbiddenDetail'))).toBeInTheDocument();
  });

  it('mounts an empty polite sink before announcing the asynchronously inserted message', async () => {
    // A polling surface re-renders this on every refused refresh; role="alert"
    // would interrupt a screen reader each time.
    vi.useFakeTimers();
    try {
      render(PermissionDenied);
      const region = screen.getByRole('status');
      expect(region).toBeEmptyDOMElement();
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');

      await vi.runOnlyPendingTimersAsync();

      expect(region).toHaveTextContent(t('loadFailure.forbiddenTitle'));
      expect(region).toHaveTextContent(t('loadFailure.forbiddenDetail'));
    } finally {
      vi.useRealTimers();
    }
  });
});

// One row per surface driven end to end: the real component, the real catch
// arm, the real classifier. Each names its own generic line so both directions
// are checked: a 403 must NOT paint it, and a 500 must.
const SURFACES: Array<{
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of Svelte components
  component: any;
  // biome-ignore lint/suspicious/noExplicitAny: per-component props, none shared
  props?: any;
  genericKey: string;
}> = [
  { name: 'Overview (live stats)', component: Overview, genericKey: 'stats.loadFailed' },
  { name: 'TopHolders', component: TopHolders, genericKey: 'topHolders.loadFailed' },
  { name: 'MarketMetrics', component: MarketMetrics, genericKey: 'marketMetrics.loadFailed' },
  { name: 'Accounts', component: Accounts, genericKey: 'accounts.loadFailed' },
  {
    name: 'AccountWealthPanel',
    component: AccountWealthPanel,
    props: { accountId: 1 },
    genericKey: 'wealth.loadFailed',
  },
];

describe('the family-wide 403 treatment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(SURFACES)('$name paints permission denied on a 403', async (surface) => {
    apiGetMock.mockRejectedValue(new ApiError(403, 'you do not have permission to do this'));
    render(surface.component, surface.props);
    expect(await screen.findByText(t('loadFailure.forbiddenTitle'))).toBeInTheDocument();
    // ...and NOT the generic line: collapsing both into one panel is the
    // defect this treatment exists to fix.
    expect(screen.queryByText(t(surface.genericKey))).not.toBeInTheDocument();
  });

  it.each(SURFACES)('$name paints its generic line on a 500', async (surface) => {
    apiGetMock.mockRejectedValue(new ApiError(500, 'internal error'));
    render(surface.component, surface.props);
    expect(await screen.findByText(t(surface.genericKey))).toBeInTheDocument();
    expect(screen.queryByText(t('loadFailure.forbiddenTitle'))).not.toBeInTheDocument();
  });

  it.each(SURFACES)('$name paints its generic line on a transport failure', async (surface) => {
    // A rejected fetch carries no status at all. It must read as a generic
    // failure, never as a permission verdict.
    apiGetMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(surface.component, surface.props);
    expect(await screen.findByText(t(surface.genericKey))).toBeInTheDocument();
    expect(screen.queryByText(t('loadFailure.forbiddenTitle'))).not.toBeInTheDocument();
  });

  it('leaves the Overview charts half unaffected when only the stats read is refused', async () => {
    // Two reads, two verdicts. An operator with the live-stats permission but
    // not the analytics one (or the reverse) must see exactly one panel.
    apiGetMock.mockImplementation(async (requested: string) => {
      if (requested.startsWith('/admin/api/overview')) {
        throw new ApiError(403, 'you do not have permission to do this');
      }
      if (requested.startsWith('/admin/api/online-history')) {
        return { range: '24h', bucket: 'hour', points: [] };
      }
      return { days: 7, registrations: [], sessions: [], classes: [], levels: [] };
    });
    render(Overview);
    await screen.findByText(t('loadFailure.forbiddenTitle'));
    await waitFor(() =>
      expect(screen.getAllByText(t('loadFailure.forbiddenTitle'))).toHaveLength(1),
    );
    expect(screen.queryByText(t('charts.loadFailed'))).not.toBeInTheDocument();
  });
});

describe('family completeness', () => {
  it('gives every load-failure surface in src/admin a forbidden arm', () => {
    // This is what "family-wide" means operationally, and the only check that
    // can say it: a new surface rendering a `*.loadFailed` key without the
    // forbidden arm would silently reintroduce the collapsed panel this work
    // removed. Recursive so a future subdirectory cannot leave the scan.
    const offenders = svelteFiles('src/admin')
      .filter(({ source }) => /\.loadFailed'\)/.test(source))
      .filter(({ source }) => !source.includes("=== 'forbidden'"))
      .map(({ file }) => file);
    expect(offenders, 'these surfaces render a generic loadFailed with no 403 arm').toEqual([]);
  });

  it('scans a non-trivial number of surfaces', () => {
    // Vacuity floor: an empty or mis-rooted scan makes the assertion above
    // trivially true, which is exactly how a coverage guard dies quietly.
    const withLoadFailed = svelteFiles('src/admin').filter(({ source }) =>
      /\.loadFailed'\)/.test(source),
    );
    expect(withLoadFailed.length).toBeGreaterThanOrEqual(25);
  });

  it('routes every forbidden arm through the one shared component', () => {
    // Reuse-before-bespoke, enforced: a surface that hand-rolled its own 403
    // copy would defeat the point of a family-wide treatment.
    const offenders = svelteFiles('src/admin')
      .filter(({ source }) => source.includes("=== 'forbidden'"))
      .filter(({ source }) => !source.includes('<PermissionDenied />'))
      .map(({ file }) => file);
    expect(offenders, 'these surfaces branch on forbidden without the shared arm').toEqual([]);
  });
});
