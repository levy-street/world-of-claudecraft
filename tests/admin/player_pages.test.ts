// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const accountsPage = {
  rows: [
    {
      id: 1,
      username: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
      lastLogin: '2026-06-01T00:00:00Z',
      isAdmin: false,
      bannedAt: null,
      suspendedUntil: null,
      characterCount: 2,
      maxLevel: 60,
      playtimeSeconds: 3600,
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

const accountDetail = {
  id: 1,
  username: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  lastLogin: '2026-06-01T00:00:00Z',
  isAdmin: false,
  online: true,
  bannedAt: null,
  suspendedUntil: null,
  moderationReason: '',
  chatMutedUntil: null,
  chatMuteReason: '',
  chatStrikes: 0,
  lastLoginIp: '203.0.113.7',
  playtimeSeconds: 3600,
  characters: [
    {
      id: 7,
      name: 'Merlin',
      class: 'mage',
      level: 42,
      copper: 456,
      xp: 123,
      pos: { x: 1, z: 2 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
  ],
  recentSessions: [
    {
      id: 10,
      characterName: 'Merlin',
      startedAt: '2026-05-31T00:00:00Z',
      endedAt: '2026-05-31T01:00:00Z',
      seconds: 3600,
      ip: '198.51.100.4',
    },
  ],
  moderationHistory: [
    {
      id: 3,
      action: 'suspend',
      reason: 'harassment',
      createdAt: '2026-06-01T02:00:00Z',
      expiresAt: '2026-06-02T02:00:00Z',
      adminAccountId: 2,
      adminUsername: 'moderator',
    },
  ],
};

const charactersPage = {
  rows: [
    {
      id: 7,
      name: 'Merlin',
      class: 'mage',
      level: 42,
      xp: 123,
      copper: 456,
      accountId: 1,
      username: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
  ],
  total: 1,
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
  apiGet: vi.fn(async (path: string) => {
    if (path.startsWith('/admin/api/accounts?')) return accountsPage;
    if (path === '/admin/api/accounts/1') return accountDetail;
    if (path.startsWith('/admin/api/characters?')) return charactersPage;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'alice',
  clearSession: () => {},
}));

import App from '../../src/admin/App.svelte';
import { t } from '../../src/admin/i18n';
import Characters from '../../src/admin/pages/Characters.svelte';
import { auth } from '../../src/admin/state/auth.svelte';
import { grantPermissions } from './_grant';

describe('Players pages', () => {
  it('opens account details from the searchable accounts directory', async () => {
    history.replaceState(null, '', '/admin?page=accounts');
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions();
    render(App);

    await screen.findByText('alice');
    const accountLink = screen.getByRole('button', { name: '1' });
    const accountRow = accountLink.closest('tr');
    if (!accountRow) throw new Error('account row not found');
    expect(screen.getByPlaceholderText(t('accounts.searchPlaceholder'))).toBeInTheDocument();
    await fireEvent.click(accountRow);

    expect(
      await screen.findByRole('dialog', {
        name: t('accountModal.title', { username: 'alice' }),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t('detail.notePlaceholder'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('detail.ban') })).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(accountLink).toHaveFocus());
  });

  it('renders the sortable characters directory', async () => {
    render(Characters);
    expect(await screen.findByText('Merlin')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t('characters.searchPlaceholder'))).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: new RegExp(t('characters.colLevel')) }),
    ).toBeInTheDocument();
  });

  it('opens account details from a character and restores focus after Escape', async () => {
    history.replaceState(null, '', '/admin?page=characters');
    auth.token = 'tok';
    auth.name = 'alice';
    grantPermissions();
    render(App);

    expect(await screen.findByText('Merlin')).toBeInTheDocument();
    const accountLink = screen.getByRole('button', { name: 'alice' });
    accountLink.focus();
    await fireEvent.click(accountLink);

    const dialog = await screen.findByRole('dialog', {
      name: t('accountModal.title', { username: 'alice' }),
    });
    const title = within(dialog).getByRole('heading', {
      name: t('accountModal.title', { username: 'alice' }),
    });
    const summary = within(dialog).getByText(t('accounts.colRegistered')).closest('dl');

    expect(title.parentElement).toContainElement(screen.getByText(t('detail.statusActive')));
    if (!summary) throw new Error('account summary not found');
    expect(within(summary).getByText(t('accounts.colId'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('detail.forceNameChange') })).toHaveClass(
      'btn-sm',
    );
    expect(screen.getByText(t('moderation.badgeOnline'))).toBeInTheDocument();
    expect(screen.getByText(t('detail.statusActive'))).toBeInTheDocument();
    expect(screen.queryByText(t('detail.status'))).not.toBeInTheDocument();
    expect(screen.getByText(t('accountModal.recentIps'))).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.4')).toBeInTheDocument();
    expect(screen.getByText(t('moderationHistory.title'))).toBeInTheDocument();
    expect(screen.getByText('harassment')).toBeInTheDocument();
    expect(screen.getByText(t('moderationHistory.by', { name: 'moderator' }))).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(accountLink).toHaveFocus());
  });
});
