// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detail = {
  guild: {
    id: 12,
    name: 'Old Guild',
    realm: 'vale-1',
    createdAt: '2026-01-01T00:00:00Z',
    memberCount: 1,
  },
  members: [
    {
      characterId: 22,
      characterName: 'Merlin',
      accountId: 7,
      username: 'alice',
      class: 'mage',
      level: 42,
      rank: 'officer',
      joinedAt: '2026-02-01T00:00:00Z',
      lastLogin: '2026-07-01T00:00:00Z',
      online: true,
    },
  ],
};

const historyData = {
  rows: [
    {
      id: 4,
      oldName: 'Older Guild',
      newName: 'Old Guild',
      reason: 'previous moderation',
      createdAt: '2026-03-01T00:00:00Z',
      adminAccountId: 2,
      adminUsername: 'moderator',
    },
  ],
};

// The guild bank panel rides the same detail page (its own coverage lives in
// tests/admin/guild_bank_panel.test.ts); this fixture keeps the page coherent
// and lets the gating assertions below stay honest.
const bankState = {
  guildId: 12,
  treasury: 12_345,
  capacity: 24,
  purchasedSlots: 24,
  usedSlots: 0,
  dormantSlots: 0,
  slots: [],
};

const directory = {
  rows: [
    {
      id: 12,
      name: 'Old Guild',
      realm: 'vale-1',
      createdAt: '2026-01-01T00:00:00Z',
      memberCount: 1,
      leaderName: 'Gandalf',
    },
  ],
  total: 50,
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
    if (path.startsWith('/admin/api/guilds?')) {
      const url = new URL(path, 'http://admin.test');
      return { ...directory, page: Number(url.searchParams.get('page') ?? '1') };
    }
    if (path === '/admin/api/guilds/12') return detail;
    // Guild 13 is the legacy oversized roster: the server counts every member but
    // pages the rows at the cap, so the dashboard must say the list is partial.
    if (path === '/admin/api/guilds/13') {
      return { ...detail, guild: { ...detail.guild, id: 13, memberCount: 137 } };
    }
    if (path === '/admin/api/guilds/12/history') return historyData;
    if (path === '/admin/api/guilds/12/bank') return bankState;
    throw new Error(`unexpected path ${path}`);
  }),
  apiPost: vi.fn(async () => ({})),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { ApiError, apiGet, apiPost } from '../../src/admin/api';
import { t } from '../../src/admin/i18n';
import Guilds from '../../src/admin/pages/Guilds.svelte';
import { grantPermissions } from './_grant';

describe('Guilds page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState(null, '', '/admin?page=guilds&guildId=12');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the realm guild directory and links each row to its URL-backed detail', async () => {
    grantPermissions(['accounts.read']);
    render(Guilds);

    const guildLink = await screen.findByRole('link', { name: 'Old Guild' });
    const search = screen.getByRole('textbox', { name: t('guilds.searchLabel') });
    expect(search).toHaveAttribute('aria-label', 'Guild name starts with');
    expect(search).toHaveAttribute('placeholder', 'Guild name starts with...');
    expect(guildLink).toHaveAttribute('href', expect.stringContaining('page=guilds&guildId=12'));
    expect(screen.getByText('Gandalf')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
      '/admin/api/guilds?page=1&search=&sort=name&dir=asc',
    );
  });

  it('sorts the complete directory by created date or member count', async () => {
    grantPermissions(['accounts.read']);
    render(Guilds);
    await screen.findByRole('link', { name: 'Old Guild' });

    const name = screen.getByRole('button', { name: t('guilds.colName') });
    expect(name.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await fireEvent.click(screen.getAllByRole('button', { name: t('accounts.next') })[0]);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=2&search=&sort=name&dir=asc',
      ),
    );

    const created = screen.getByRole('button', { name: t('guilds.colCreated') });
    await fireEvent.click(created);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=created_at&dir=desc',
      ),
    );
    expect(created.closest('th')).toHaveAttribute('aria-sort', 'descending');

    await fireEvent.click(created);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=created_at&dir=asc',
      ),
    );
    expect(created.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    const members = screen.getByRole('button', { name: t('guilds.colMembers') });
    await fireEvent.click(members);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=member_count&dir=desc',
      ),
    );
    expect(members.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(created.closest('th')).toHaveAttribute('aria-sort', 'none');
    expect(name.closest('th')).toHaveAttribute('aria-sort', 'none');

    await fireEvent.click(members);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=member_count&dir=asc',
      ),
    );
    expect(members.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await fireEvent.click(name);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=name&dir=asc',
      ),
    );
    expect(name.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await fireEvent.click(name);
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=&sort=name&dir=desc',
      ),
    );
    expect(name.closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('keeps interior spaces while typing and trims only the directory request', async () => {
    grantPermissions(['accounts.read']);
    render(Guilds);
    const search = await screen.findByRole('textbox', { name: t('guilds.searchLabel') });

    await fireEvent.input(search, { target: { value: ' Silver ' } });
    expect(search).toHaveValue(' Silver ');
    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=Silver&sort=name&dir=asc',
      ),
    );

    await fireEvent.input(search, { target: { value: 'Silver H' } });
    expect(search).toHaveValue('Silver H');

    await vi.waitFor(() =>
      expect(vi.mocked(apiGet)).toHaveBeenCalledWith(
        '/admin/api/guilds?page=1&search=Silver+H&sort=name&dir=asc',
      ),
    );
  });

  it('retries one busy directory response instead of leaving the view failed', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(503, 'guild list busy, try again'));

    render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('link', { name: 'Old Guild' })).toBeInTheDocument();
    expect(screen.queryByText(t('guilds.loadFailed'))).not.toBeInTheDocument();
  });

  it('surfaces a repeated busy response after the one automatic retry', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError(503, 'guild list busy, try again'))
      .mockRejectedValueOnce(new ApiError(503, 'guild list busy, try again'));

    render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2));

    expect(screen.getByText(t('guilds.loadFailed'))).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2);
  });

  it('clears a previous failure while retrying a busy directory response', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError(500, 'database unavailable'))
      .mockRejectedValueOnce(new ApiError(503, 'guild list busy, try again'));

    const view = render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t('guilds.loadFailed'))).toBeInTheDocument();

    await fireEvent.input(screen.getByRole('textbox', { name: t('guilds.searchLabel') }), {
      target: { value: 'Old' },
    });
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(t('guilds.loadFailed'))).not.toBeInTheDocument();
    view.unmount();
  });

  it('does not retry an error other than a busy response', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(500, 'database unavailable'));

    render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);

    expect(vi.mocked(apiGet)).toHaveBeenCalledOnce();
    expect(screen.getByText(t('guilds.loadFailed'))).toBeInTheDocument();
  });

  it('does not retry an unexpected directory error', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    vi.mocked(apiGet).mockRejectedValueOnce(
      Object.assign(new Error('network unavailable'), { status: 503 }),
    );

    render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);

    expect(vi.mocked(apiGet)).toHaveBeenCalledOnce();
    expect(screen.getByText(t('guilds.loadFailed'))).toBeInTheDocument();
  });

  it('does not schedule a busy retry when a request rejects after unmount', async () => {
    vi.useFakeTimers();
    grantPermissions(['accounts.read']);
    let rejectRequest: (reason?: unknown) => void = () => {};
    vi.mocked(apiGet).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );

    const view = render(Guilds);
    await vi.waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(1));
    view.unmount();
    rejectRequest(new ApiError(503, 'guild list busy, try again'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(vi.mocked(apiGet)).toHaveBeenCalledOnce();
  });

  it('shows a lightweight roster without requesting moderation history for accounts readers', async () => {
    grantPermissions(['accounts.read']);
    render(Guilds, { guildId: 12 });

    expect(await screen.findByText('Merlin')).toBeInTheDocument();
    expect(screen.getByText(t('guilds.rank.officer'))).toBeInTheDocument();
    expect(screen.getByText(t('guilds.online'))).toBeInTheDocument();
    expect(screen.queryByText(t('guilds.historyTitle'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('guilds.renameAction') }),
    ).not.toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/guilds/12');
    expect(vi.mocked(apiGet)).not.toHaveBeenCalledWith('/admin/api/guilds/12/history');
    // The bank panel is a guild's private property, gated with the audit panel:
    // an accounts.read operator neither sees it nor reads the live book.
    expect(screen.queryByText(t('guilds.bankTitle'))).not.toBeInTheDocument();
    expect(vi.mocked(apiGet)).not.toHaveBeenCalledWith('/admin/api/guilds/12/bank');
  });

  it('says the roster is partial when the guild is above the paged member cap', async () => {
    // adminGuildDetail counts the whole roster but pages the rows at the cap, so a
    // legacy guild above it would otherwise render "Members: 137" next to 100 rows
    // with nothing saying the list stops there.
    grantPermissions(['accounts.read']);
    render(Guilds, { guildId: 13 });

    expect(
      await screen.findByText(t('guilds.membersTruncated', { shown: '1', total: '137' })),
    ).toBeInTheDocument();
  });

  it('leaves the roster unannotated when every member is listed', async () => {
    grantPermissions(['accounts.read']);
    render(Guilds, { guildId: 12 });

    expect(await screen.findByText('Merlin')).toBeInTheDocument();
    expect(
      screen.queryByText(t('guilds.membersTruncated', { shown: '1', total: '1' })),
    ).not.toBeInTheDocument();
  });

  it('loads the audit only with moderation.read and submits a confirmed rename with moderation.act', async () => {
    grantPermissions(['accounts.read', 'moderation.read', 'moderation.act']);
    render(Guilds, { guildId: 12 });

    expect(await screen.findByText('previous moderation')).toBeInTheDocument();
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/admin/api/guilds/12/history');

    await fireEvent.click(screen.getByRole('button', { name: t('guilds.renameAction') }));
    const dialog = screen.getByRole('dialog', { name: t('guilds.renameTitle') });
    expect(within(dialog).getByText('Old Guild')).toBeInTheDocument();

    await fireEvent.input(within(dialog).getByLabelText(t('guilds.renameNameLabel')), {
      target: { value: 'Better Guild' },
    });
    await fireEvent.input(within(dialog).getByLabelText(t('dialog.reason')), {
      target: { value: 'offensive name' },
    });
    expect(within(dialog).getByRole('button', { name: t('guilds.renameConfirm') })).toBeDisabled();
    await fireEvent.click(within(dialog).getByLabelText(t('guilds.renameConfirmation')));
    await fireEvent.click(within(dialog).getByRole('button', { name: t('guilds.renameConfirm') }));

    await vi.waitFor(() =>
      expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/admin/api/guilds/12/rename', {
        name: 'Better Guild',
        reason: 'offensive name',
      }),
    );
  });

  it('keeps history and rename permissions independent', async () => {
    grantPermissions(['accounts.read', 'moderation.read']);
    const historyView = render(Guilds, { guildId: 12 });
    expect(await screen.findByText('previous moderation')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('guilds.renameAction') }),
    ).not.toBeInTheDocument();
    historyView.unmount();

    vi.clearAllMocks();
    grantPermissions(['accounts.read', 'moderation.act']);
    render(Guilds, { guildId: 12 });
    expect(
      await screen.findByRole('button', { name: t('guilds.renameAction') }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t('guilds.historyTitle'))).not.toBeInTheDocument();
    expect(vi.mocked(apiGet)).not.toHaveBeenCalledWith('/admin/api/guilds/12/history');
  });

  it('ignores an older directory response that resolves after a newer search', async () => {
    grantPermissions(['accounts.read']);
    let resolveOld!: (value: typeof directory) => void;
    let resolveNew!: (value: typeof directory) => void;
    const oldRequest = new Promise<typeof directory>((resolve) => {
      resolveOld = resolve;
    });
    const newRequest = new Promise<typeof directory>((resolve) => {
      resolveNew = resolve;
    });
    vi.mocked(apiGet)
      .mockImplementationOnce(() => oldRequest as never)
      .mockImplementationOnce(() => newRequest as never);

    render(Guilds);
    await fireEvent.input(screen.getByRole('textbox', { name: t('guilds.searchLabel') }), {
      target: { value: 'new' },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    resolveNew({
      ...directory,
      rows: [{ ...directory.rows[0], id: 13, name: 'New Result' }],
    });
    expect(await screen.findByRole('link', { name: 'New Result' })).toBeInTheDocument();

    resolveOld(directory);
    await vi.waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Old Guild' })).not.toBeInTheDocument(),
    );
  });
});
