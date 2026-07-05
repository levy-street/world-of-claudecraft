// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

const data = {
  rows: [
    {
      ip: '203.0.113.7',
      accountCount: 4,
      lastSeenAt: '2026-06-28T12:00:00Z',
      blocked: true,
    },
    {
      ip: '198.51.100.4',
      accountCount: 2,
      lastSeenAt: '2026-06-27T12:00:00Z',
      blocked: false,
    },
  ],
  total: 2,
  page: 1,
  limit: 25,
};

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

import { t } from '../../src/admin/i18n';
import SharedIps from '../../src/admin/pages/SharedIps.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockResolvedValue(data);
});

describe('Shared IPs', () => {
  it('shows multi-account IPs, account counts, and block state', async () => {
    render(SharedIps);

    const firstIp = await screen.findByText('203.0.113.7');
    const firstRow = firstIp.closest('a');

    expect(firstRow).toHaveAttribute('href', expect.stringContaining('page=ip'));
    expect(screen.getByText('198.51.100.4')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(firstIp.parentElement).toContainElement(screen.getByText(t('blockedIps.blockedBadge')));
    expect(screen.getByRole('note')).toHaveTextContent(t('sharedIps.warning'));
  });

  it('requests the in-memory online view and resets to the first page', async () => {
    render(SharedIps);
    await screen.findByText('203.0.113.7');

    const toggle = screen.getByRole('checkbox', { name: t('sharedIps.onlineOnly') });
    await fireEvent.click(toggle);

    expect(toggle).toBeChecked();
    await waitFor(() => {
      expect(mocks.apiGet.mock.calls.at(-1)?.[0]).toContain(
        '/admin/api/shared-ips?page=1&online=1',
      );
    });
  });
});
