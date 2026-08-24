// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantPermissions } from './_grant';

const FLAG = {
  id: 11,
  accountId: 42,
  username: 'suspect',
  bannedAt: null,
  suspendedUntil: null,
  source: 'bot_detector',
  kind: 'session_automation',
  severity: 'high' as const,
  details: 'Bot detector confirmed (Botly): score 12; evidence: input_cadence x3',
  relatedAccounts: [{ accountId: 41, username: 'sibling' }],
  status: 'new' as const,
  copperAtFlag: 10_000,
  copperNow: 260_000,
  occurrences: 3,
  firstSeenAt: '2026-08-01T00:00:00Z',
  lastSeenAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
};

const list = {
  rows: [FLAG],
  total: 1,
  page: 1,
  limit: 25,
  counts: { new: 1, under_review: 0, cleared: 2, actioned: 0 },
  truncated: false,
};

const accountFlags = {
  flags: [FLAG],
  events: [
    {
      id: 1,
      flagId: 11,
      adminAccountId: 7,
      adminUsername: 'op',
      fromStatus: null,
      toStatus: null,
      note: 'watching this one',
      createdAt: '2026-08-17T00:00:00Z',
    },
  ],
};

vi.mock('../../src/admin/api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path.startsWith('/admin/api/flags?')) return list;
    if (path === '/admin/api/accounts/42/flags') return accountFlags;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { apiGet, apiPost } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import Flags from '../../src/admin/pages/Flags.svelte';

describe('Flags page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantPermissions();
  });

  it('loads the active tab by default and shows severity, status, and gold trend', async () => {
    render(Flags);
    expect(await screen.findByText('suspect')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/flags?status=active&page=1');
    expect(screen.getByText(t('flags.severityHigh'))).toBeInTheDocument();
    // 'New' appears both as the filter tab and the row's status badge.
    expect(screen.getAllByText(t('flags.statusNew')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(t('flags.sourceBotDetector'))).toBeInTheDocument();
    // +25g since flagging (260000 - 10000 = 250000 copper).
    expect(screen.getByText(/\+25g/)).toBeInTheDocument();
  });

  it('switches status filters through the tab strip', async () => {
    render(Flags);
    await screen.findByText('suspect');
    await fireEvent.click(screen.getByRole('tab', { name: /Cleared/ }));
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/flags?status=cleared&page=1'),
    );
  });

  it('expands a flag to its audit trail and posts a workflow transition with the note', async () => {
    render(Flags);
    await screen.findByText('suspect');

    await fireEvent.click(screen.getByText(t('flags.sourceBotDetector')));
    // The expanded detail loads the per-account history for the audit trail.
    expect(await screen.findByText('watching this one')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/accounts/42/flags');
    expect(screen.getByText(/sibling/)).toBeInTheDocument();

    const note = screen.getByPlaceholderText(t('flags.notePlaceholder'));
    await fireEvent.input(note, { target: { value: 'reviewed the trade log' } });
    await fireEvent.click(screen.getByRole('button', { name: t('flags.actionReview') }));
    await vi.waitFor(() =>
      expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/admin/api/flags/11/status', {
        status: 'under_review',
        note: 'reviewed the trade log',
      }),
    );
  });

  it('hides the workflow controls without moderation.act', async () => {
    grantPermissions(['moderation.read']);
    render(Flags);
    await screen.findByText('suspect');
    await fireEvent.click(screen.getByText(t('flags.sourceBotDetector')));
    await screen.findByText('watching this one');
    expect(screen.queryByRole('button', { name: t('flags.actionReview') })).toBeNull();
    expect(screen.queryByPlaceholderText(t('flags.notePlaceholder'))).toBeNull();
  });
});
