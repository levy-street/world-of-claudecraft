// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = {
  rows: [
    {
      accountId: 1,
      username: 'troll',
      isAdmin: true,
      status: 'active',
      suspendedUntil: null,
      openReports: 2,
      latestReportAt: '2026-06-01T00:00:00Z',
      latestReason: 'spam',
      characterNames: ['Troll'],
      online: true,
    },
  ],
};
const modDetail = {
  account: {
    id: 1,
    username: 'troll',
    createdAt: '2026-01-01T00:00:00Z',
    lastLogin: '2026-06-01T00:00:00Z',
    isAdmin: false,
    bannedAt: null,
    suspendedUntil: null,
    moderationReason: '',
    chatMutedUntil: null,
    chatMuteReason: '',
    chatStrikes: 0,
    lastLoginIp: '1.2.3.4',
    playtimeSeconds: 3600,
    characters: [],
    recentSessions: [],
    moderationHistory: [],
  },
  reports: [],
  chat: { chatMutedUntil: null, chatStrikes: 0, violations: [] },
  blockedIps: [],
};

const apiPost = vi.fn();
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: vi.fn(async (path: string) => {
    if (path.includes('/moderation/queue')) return queue;
    if (path.includes('/moderation/accounts/')) return modDetail;
    throw new Error(`unexpected ${path}`);
  }),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import Moderation from '../../src/admin/pages/Moderation.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  grantPermissions();
});

describe('Moderation', () => {
  it('opens an account from the queue and bans it through the confirm dialog', async () => {
    render(Moderation);
    expect(await screen.findByText(t('accounts.badgeAdmin'))).toBeInTheDocument();
    await fireEvent.click(await screen.findByText('troll'));
    // detail loaded
    expect(await screen.findByText(t('report.openReports'))).toBeInTheDocument();

    // The reason field appears only after selecting an action.
    await fireEvent.click(screen.getByText(t('detail.ban')));
    const noteInput = screen.getByPlaceholderText(t('detail.notePlaceholder'));
    await fireEvent.input(noteInput, { target: { value: 'persistent spam' } });
    expect(await screen.findByText(t('dialog.confirmBan'))).toBeInTheDocument();
    await fireEvent.click(screen.getByText(t('dialog.confirm')));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/moderation/accounts/1/ban', {
      reason: 'persistent spam',
    });
  });
});
