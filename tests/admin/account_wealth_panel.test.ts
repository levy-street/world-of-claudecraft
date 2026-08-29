// @vitest-environment happy-dom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountWealthData } from '../../src/admin/types';

// The account detail's gold panel: the large-movements half can degrade
// server-side (the ledger read is bounded and may time out after the
// breakdown was computed), and the panel must say so instead of showing the
// empty list as "no movements".
const BREAKDOWN = {
  accountId: 42,
  purseCopper: 1_000,
  mailCopper: 0,
  marketCopper: 0,
  totalCopper: 1_000,
  updatedAt: null,
  characters: [],
};

const apiGet = vi.fn(
  async (_path: string): Promise<AccountWealthData> => ({ ...BREAKDOWN, largeMovements: [] }),
);

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (path: string) => apiGet(path),
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import AccountWealthPanel from '../../src/admin/components/AccountWealthPanel.svelte';
import { t } from '../../src/admin/i18n';

beforeEach(() => {
  apiGet.mockClear();
});

describe('AccountWealthPanel large movements', () => {
  it('reports an empty list as no movements when the ledger read succeeded', async () => {
    render(AccountWealthPanel, { props: { accountId: 42 } });
    expect(await screen.findByText(t('wealth.noLargeMovements'))).toBeInTheDocument();
    expect(screen.queryByText(t('wealth.largeMovementsUnavailable'))).not.toBeInTheDocument();
  });

  it('shows the unavailable line, not the empty state, when the server flagged the read', async () => {
    apiGet.mockResolvedValueOnce({
      ...BREAKDOWN,
      largeMovements: [],
      largeMovementsUnavailable: true,
    });
    render(AccountWealthPanel, { props: { accountId: 42 } });
    expect(await screen.findByText(t('wealth.largeMovementsUnavailable'))).toBeInTheDocument();
    expect(screen.queryByText(t('wealth.noLargeMovements'))).not.toBeInTheDocument();
    // The breakdown itself still renders: the degradation is scoped to the list.
    expect(screen.getByText(t('wealth.largeMovementsHeader'))).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/admin/api/accounts/42/wealth');
  });
});
