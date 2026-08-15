// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const directory = {
  rows: [
    {
      id: 7,
      username: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
      lastLogin: '2026-06-01T00:00:00Z',
      isAdmin: false,
      isAi: false,
      isStreamer: false,
      bannedAt: null,
      suspendedUntil: null,
      characterCount: 2,
      maxLevel: 12,
      playtimeSeconds: 3600,
    },
  ],
  total: 50,
  page: 1,
  limit: 25,
};

vi.mock('../../src/admin/api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path.startsWith('/admin/api/accounts?')) {
      const url = new URL(path, 'http://admin.test');
      return { ...directory, page: Number(url.searchParams.get('page') ?? '1') };
    }
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { apiGet } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import Accounts from '../../src/admin/pages/Accounts.svelte';

describe('Accounts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the account list with the default id/desc sort', async () => {
    render(Accounts);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
      '/admin/api/accounts?page=1&search=&sort=id&dir=desc',
    );

    const idHeader = screen.getByRole('button', { name: t('accounts.colId') });
    expect(idHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by username ascending on first click, and flips direction on a second click', async () => {
    render(Accounts);
    await screen.findByText('alice');

    const usernameHeader = screen.getByRole('button', { name: t('accounts.colUsername') });
    await fireEvent.click(usernameHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=username&dir=asc',
      ),
    );
    expect(usernameHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await fireEvent.click(usernameHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=username&dir=desc',
      ),
    );
    expect(usernameHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('defaults a freshly clicked numeric/date column to descending and resets the id column', async () => {
    render(Accounts);
    await screen.findByText('alice');

    const idHeader = screen.getByRole('button', { name: t('accounts.colId') });
    expect(idHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');

    const playtimeHeader = screen.getByRole('button', { name: t('accounts.colPlaytime') });
    await fireEvent.click(playtimeHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=playtime_seconds&dir=desc',
      ),
    );
    expect(playtimeHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
    // Sorting away from id resets the previously active header back to none.
    expect(idHeader.closest('th')).toHaveAttribute('aria-sort', 'none');
  });

  it('resets to page 1 when changing sort away from a later page', async () => {
    render(Accounts);
    await screen.findByText('alice');

    await fireEvent.click(screen.getByRole('button', { name: t('accounts.next') }));
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=2&search=&sort=id&dir=desc',
      ),
    );

    const createdHeader = screen.getByRole('button', { name: t('accounts.colRegistered') });
    await fireEvent.click(createdHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=created_at&dir=desc',
      ),
    );
  });

  it('ignores a stale response that resolves after a later sort request already won', async () => {
    render(Accounts);
    await screen.findByText('alice');

    // The username/asc request stalls (simulating an in-flight response that outlives a
    // later, faster request), while the following id/desc click resolves immediately.
    let resolveUsername: ((value: typeof directory) => void) | undefined;
    const stale = new Promise<typeof directory>((resolve) => {
      resolveUsername = resolve;
    });
    vi.mocked(apiGet).mockImplementationOnce(() => stale as Promise<unknown>);

    const usernameHeader = screen.getByRole('button', { name: t('accounts.colUsername') });
    await fireEvent.click(usernameHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=username&dir=asc',
      ),
    );

    const idHeader = screen.getByRole('button', { name: t('accounts.colId') });
    await fireEvent.click(idHeader);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/accounts?page=1&search=&sort=id&dir=desc',
      ),
    );
    expect(idHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');

    // The stale username/asc request finally resolves after id/desc already won the race.
    resolveUsername?.(directory);
    await Promise.resolve();
    await Promise.resolve();

    // The header still reflects the winning (later) sort, not the stale response.
    expect(idHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(usernameHeader.closest('th')).toHaveAttribute('aria-sort', 'none');
  });
});
