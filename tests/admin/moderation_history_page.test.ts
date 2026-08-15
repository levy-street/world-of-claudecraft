// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const page = {
  rows: [
    {
      source: 'account',
      id: 20,
      accountId: 9,
      username: 'target',
      ip: null,
      action: 'note',
      reason: 'follow up',
      createdAt: '2026-06-03T02:00:00Z',
      expiresAt: null,
      adminAccountId: 7,
      adminUsername: 'moderator',
    },
    {
      source: 'ip',
      id: 4,
      accountId: null,
      username: null,
      ip: '203.0.113.7',
      action: 'block',
      reason: 'bot burst',
      createdAt: '2026-06-03T01:00:00Z',
      expiresAt: null,
      adminAccountId: 7,
      adminUsername: 'moderator',
    },
    {
      source: 'account',
      id: 21,
      accountId: 12,
      username: 'rogue',
      ip: null,
      action: 'kick',
      reason: 'afk in raid',
      createdAt: '2026-06-03T00:30:00Z',
      expiresAt: null,
      adminAccountId: 7,
      adminUsername: 'moderator',
    },
    {
      source: 'guild',
      id: 5,
      accountId: null,
      username: null,
      ip: null,
      guildId: 42,
      guildName: 'Ashen Vale',
      action: 'guild_rename',
      reason: 'offensive guild name',
      createdAt: '2026-06-03T00:15:00Z',
      expiresAt: null,
      adminAccountId: 7,
      adminUsername: 'moderator',
    },
  ],
  total: 4,
  page: 1,
  limit: 100,
};

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async () => page),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { apiGet } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import ModerationHistoryPage from '../../src/admin/pages/ModerationHistoryPage.svelte';

describe('ModerationHistoryPage', () => {
  it('lists audit actions and fetches the personal notes tab with a 100 row page', async () => {
    render(ModerationHistoryPage);

    expect(await screen.findByText('follow up')).toBeInTheDocument();
    expect(screen.getAllByText(t('moderationHistory.actionNote')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'target' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'moderator' })).toHaveLength(4);
    expect(screen.getByText(t('moderationHistory.actionIpBlock'))).toBeInTheDocument();
    // In-game kick/kill actions land in the same audit feed and must be labeled, not "Other action".
    expect(screen.getByText(t('moderationHistory.actionKick'))).toBeInTheDocument();
    expect(screen.queryByText(t('moderationHistory.actionUnknown'))).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '203.0.113.7' })).toBeInTheDocument();
    // A guild rename is realm-scoped, not account-scoped: it has no account target,
    // so the row must link the guild instead of degrading to "unknown".
    expect(screen.getByText(t('moderationHistory.actionGuildRename'))).toBeInTheDocument();
    expect(screen.getByText('offensive guild name')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ashen Vale' })).toHaveAttribute(
      'href',
      expect.stringContaining('42'),
    );
    expect(screen.queryByText(t('common.unknown'))).not.toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: t('moderationHistoryPage.colReason') }),
    ).toBeInTheDocument();
    expect(vi.mocked(apiGet).mock.calls[0][0]).toBe(
      '/admin/api/moderation/history?tab=all&page=1&limit=100',
    );

    const notesFilter = screen.getByRole('button', { name: t('moderationHistoryPage.tabNotes') });
    await fireEvent.click(notesFilter);
    expect(notesFilter).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet).mock.calls.at(-1)?.[0]).toBe(
        '/admin/api/moderation/history?tab=notes&page=1&limit=100',
      ),
    );
  });
});
