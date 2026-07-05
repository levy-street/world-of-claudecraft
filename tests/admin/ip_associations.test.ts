// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = {
  ip: '203.0.113.7',
  blocked: true,
  total: 2,
  page: 1,
  limit: 25,
  accounts: [
    {
      accountId: 7,
      username: 'alice',
      isAdmin: true,
      online: true,
      status: 'suspended',
      suspendedUntil: '2026-06-03T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      createdWithIp: true,
      lastLoginWithIp: true,
      hasSession: true,
      lastSeenAt: '2026-06-02T00:00:00Z',
      characters: [
        {
          characterId: 42,
          characterName: 'Alicia',
          realm: 'main',
          lastSeenAt: '2026-06-02T00:00:00Z',
          sessionCount: 4,
        },
      ],
    },
    {
      accountId: 8,
      username: 'creation-only',
      isAdmin: false,
      online: false,
      status: 'banned',
      suspendedUntil: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdWithIp: true,
      lastLoginWithIp: false,
      hasSession: false,
      lastSeenAt: '2026-05-01T00:00:00Z',
      characters: [],
    },
  ],
};

let currentData = data;
const apiGet = vi.fn(async (_path: string) => currentData);
const apiPost = vi.fn();
const accountModalOpen = vi.fn();

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (path: string) => apiGet(path),
  apiPost: (...args: unknown[]) => apiPost(...args),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

vi.mock('../../src/admin/account_modal', () => ({
  getAccountModalController: () => ({
    open: accountModalOpen,
    close: vi.fn(),
  }),
}));

import { fmtDate } from '../../src/admin/format';
import { t } from '../../src/admin/i18n';
import IpAssociations from '../../src/admin/pages/IpAssociations.svelte';

beforeEach(() => {
  currentData = data;
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  accountModalOpen.mockReset();
});

describe('IP associations', () => {
  it('groups one character row per account and identifies every association source', async () => {
    render(IpAssociations, { ip: '203.0.113.7' });

    const accountLink = await screen.findByRole('button', { name: 'alice' });
    await fireEvent.click(accountLink);
    expect(accountModalOpen).toHaveBeenCalledWith(7, expect.any(Function));
    const onChanged = accountModalOpen.mock.calls[0]?.[1] as (() => void) | undefined;
    onChanged?.();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const title = screen.getByRole('heading', {
      name: t('ipAssociations.title', { ip: '203.0.113.7' }),
    });
    expect(title.parentElement).toContainElement(screen.getByText(t('ipAssociations.blocked')));
    expect(screen.getByRole('link', { name: t('ipAssociations.back') })).toHaveAttribute(
      'href',
      expect.stringContaining('page=shared-ips'),
    );
    expect(screen.getByText('Alicia')).toBeInTheDocument();
    expect(screen.getByText(t('ipAssociations.blocked'))).toBeInTheDocument();
    expect(screen.getByText(t('accounts.badgeAdmin'))).toBeInTheDocument();
    expect(screen.getByText(t('moderation.badgeOnline'))).toBeInTheDocument();
    expect(
      screen.getByText(t('detail.suspendedUntil', { value: fmtDate('2026-06-03T00:00:00Z') })),
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: t('blockedIps.unblock') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/blocked-ips/delete', {
      ip: '203.0.113.7',
    });

    const rows = screen.getAllByRole('row');
    expect(rows.some((row) => within(row).queryByText('Alicia') !== null)).toBe(true);
  });

  it('keeps creation-only accounts without adding a character row', async () => {
    render(IpAssociations, { ip: '203.0.113.7' });

    expect(await screen.findByText('creation-only')).toBeInTheDocument();
    expect(screen.getByText(t('ipAssociations.noCharacters'))).toBeInTheDocument();
    expect(screen.getByText(t('ipAssociations.matchedCreation'))).toBeInTheDocument();
    expect(screen.getByText(t('accounts.badgeBanned'))).toBeInTheDocument();
  });

  it('collects a reason and expiration before blocking the IP', async () => {
    currentData = { ...data, blocked: false };
    render(IpAssociations, { ip: '203.0.113.7' });

    await screen.findByText('alice');
    await fireEvent.click(screen.getByRole('button', { name: t('ipAssociations.blockAction') }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText(t('dialog.reason')), {
      target: { value: 'investigation' },
    });
    await fireEvent.change(screen.getByLabelText(t('blockedIps.expiresLabel')), {
      target: { value: '7d' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('blockedIps.add') }));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/blocked-ips', {
      ip: '203.0.113.7',
      reason: 'investigation',
      expiresAt: expect.any(String),
    });
  });
});
