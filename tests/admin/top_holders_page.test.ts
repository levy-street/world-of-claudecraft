// @vitest-environment happy-dom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const board = {
  rows: [
    {
      accountId: 7,
      username: 'midas',
      purseCopper: 900_000,
      mailCopper: 50_000,
      marketCopper: 50_000,
      totalCopper: 1_000_000,
      maxLevel: 60,
      lastLogin: '2026-08-18T00:00:00Z',
      bannedAt: null,
      suspendedUntil: null,
      activeFlagCount: 2,
      updatedAt: '2026-08-18T00:00:00Z',
    },
    {
      accountId: 8,
      username: 'pauper',
      purseCopper: 5,
      mailCopper: 0,
      marketCopper: 0,
      totalCopper: 5,
      maxLevel: 3,
      lastLogin: null,
      bannedAt: '2026-08-01T00:00:00Z',
      suspendedUntil: null,
      activeFlagCount: 0,
      updatedAt: '2026-08-18T00:00:00Z',
    },
  ],
};

vi.mock('../../src/admin/api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path === '/admin/api/wealth/top') return board;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { apiGet } from '../../src/admin/api';
import { fmtCopper } from '../../src/admin/format';
import { t } from '../../src/admin/i18n';
import TopHolders from '../../src/admin/pages/TopHolders.svelte';

describe('Top Holders page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the rich list from the wealth endpoint, ranked in order', async () => {
    render(TopHolders);
    expect(await screen.findByText('midas')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/wealth/top');
    expect(screen.getByText(fmtCopper(1_000_000))).toBeInTheDocument();
    // Rank order follows the server order.
    const cells = screen.getAllByRole('cell');
    const midasIndex = cells.findIndex((cell) => cell.textContent?.includes('midas'));
    const pauperIndex = cells.findIndex((cell) => cell.textContent?.includes('pauper'));
    expect(midasIndex).toBeGreaterThan(-1);
    expect(midasIndex).toBeLessThan(pauperIndex);
  });

  it('badges flagged and banned accounts on the board', async () => {
    render(TopHolders);
    await screen.findByText('midas');
    expect(screen.getByText(t('flags.badgeFlagged', { n: '2' }))).toBeInTheDocument();
    expect(screen.getByText(t('accounts.badgeBanned'))).toBeInTheDocument();
  });
});
