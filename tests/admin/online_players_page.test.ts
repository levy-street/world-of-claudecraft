// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import App from '../../src/admin/App.svelte';
import { ApiError } from '../../src/admin/api';
import { localizeAdminError, t } from '../../src/admin/i18n';
import OnlinePlayers from '../../src/admin/pages/OnlinePlayers.svelte';
import { auth } from '../../src/admin/state/auth.svelte';
import type { LivePlayer } from '../../src/admin/types';
import { grantPermissions } from './_grant';

function player(overrides: Partial<LivePlayer> & { pid: number }): LivePlayer {
  return {
    accountId: overrides.pid + 100,
    characterId: overrides.pid + 200,
    name: `Player${overrides.pid}`,
    class: 'warrior',
    level: 10,
    hp: 100,
    maxHp: 100,
    x: 12,
    z: 34,
    zone: 'greenhollow',
    sessionSeconds: 600,
    lastSaveSecondsAgo: 5,
    moveSpeedMultiplier: 1,
    runSpeed: 7,
    swimming: false,
    auras: [],
    ...overrides,
  };
}

const roster = {
  players: [
    player({ pid: 1, name: 'Aragorn', class: 'warrior', level: 60, hp: 90, accountId: 77 }),
    player({
      pid: 2,
      name: 'Belegorn',
      class: 'mage',
      level: 12,
      zone: 'eastbrook',
      accountId: 78,
    }),
  ],
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === '/admin/api/online') return roster;
    throw new Error(`unexpected path ${path}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Online players page', () => {
  it('renders every column the Overview panel carried', async () => {
    render(OnlinePlayers);
    expect(await screen.findByText('Aragorn')).toBeInTheDocument();

    for (const key of [
      'online.colCharacter',
      'online.colClass',
      'online.colLevel',
      'online.colZone',
      'online.colPos',
      'online.colHp',
      'online.colSession',
      'online.colLastSave',
      'online.colAcct',
    ]) {
      expect(screen.getByRole('columnheader', { name: new RegExp(t(key)) })).toBeInTheDocument();
    }
    const row = screen.getByText('Aragorn').closest('tr');
    if (!row) throw new Error('player row not found');
    expect(within(row).getByText('90/100')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '77' })).toBeInTheDocument();
    expect(screen.getByText(t('onlinePlayers.count', { count: '2' }))).toBeInTheDocument();
  });

  it('filters the roster as the operator types', async () => {
    render(OnlinePlayers);
    await screen.findByText('Aragorn');

    const search = screen.getByRole('searchbox', { name: t('onlinePlayers.searchLabel') });
    await fireEvent.input(search, { target: { value: 'Belegorn' } });
    expect(screen.queryByText('Aragorn')).not.toBeInTheDocument();
    expect(screen.getByText('Belegorn')).toBeInTheDocument();
    // A filtered header naming only the roster size would read "2 online" above one
    // row, so it names both numbers instead.
    expect(screen.queryByText(t('onlinePlayers.count', { count: '2' }))).not.toBeInTheDocument();
    expect(
      screen.getByText(t('onlinePlayers.countFiltered', { shown: '1', total: '2' })),
    ).toBeInTheDocument();

    await fireEvent.input(search, { target: { value: 'nobody-here' } });
    expect(screen.getByText(t('onlinePlayers.filteredEmpty'))).toBeInTheDocument();
    expect(
      screen.getByText(t('onlinePlayers.countFiltered', { shown: '0', total: '2' })),
    ).toBeInTheDocument();
    // Filtering is local: no extra request goes out for a keystroke.
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('sorts on a column header and reverses on the second click', async () => {
    render(OnlinePlayers);
    await screen.findByText('Aragorn');

    const levelHeader = screen.getByRole('columnheader', {
      name: new RegExp(t('online.colLevel')),
    });
    await fireEvent.click(within(levelHeader).getByRole('button'));
    expect(levelHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(within(screen.getAllByRole('row')[1]).getByText('Belegorn')).toBeInTheDocument();

    await fireEvent.click(within(levelHeader).getByRole('button'));
    expect(levelHeader).toHaveAttribute('aria-sort', 'descending');
    expect(within(screen.getAllByRole('row')[1]).getByText('Aragorn')).toBeInTheDocument();
  });

  it('auto-refreshes once a minute, and stops when the operator switches it off', async () => {
    vi.useFakeTimers();
    render(OnlinePlayers);
    await vi.advanceTimersByTimeAsync(0);

    const toggle = screen.getByRole('checkbox', {
      name: t('onlinePlayers.autoRefresh', { minutes: 1 }),
    });
    expect(toggle).toBeChecked();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);

    await fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('claudecraft_admin_online_players_auto_refresh')).toBe('0');

    // With polling off, the manual button is the way to get fresh rows.
    await fireEvent.click(screen.getByRole('button', { name: t('onlinePlayers.refresh') }));
    expect(mocks.apiGet).toHaveBeenCalledTimes(3);
  });

  it('starts with auto-refresh off when the operator opted out earlier', async () => {
    localStorage.setItem('claudecraft_admin_online_players_auto_refresh', '0');
    vi.useFakeTimers();
    render(OnlinePlayers);
    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByRole('checkbox', { name: t('onlinePlayers.autoRefresh', { minutes: 1 }) }),
    ).not.toBeChecked();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load instead of an empty roster', async () => {
    mocks.apiGet.mockRejectedValue(new Error('boom'));
    render(OnlinePlayers);
    expect(await screen.findByText(t('onlinePlayers.loadFailed'))).toBeInTheDocument();
  });

  it('hides the Kick action from an operator without moderation.act', async () => {
    grantPermissions(['accounts.read', 'moderation.read']);
    render(OnlinePlayers);
    await screen.findByText('Aragorn');

    expect(screen.queryByText(t('online.kick'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: t('online.colActions') }),
    ).not.toBeInTheDocument();
  });

  it('kicks a player after the operator confirms with a reason, then refreshes', async () => {
    grantPermissions(['accounts.read', 'moderation.act']);
    mocks.apiPost.mockResolvedValue({ ok: true });
    render(OnlinePlayers);
    await screen.findByText('Aragorn');

    const row = screen.getByText('Aragorn').closest('tr');
    if (!row) throw new Error('player row not found');
    await fireEvent.click(
      within(row).getByRole('button', { name: t('online.kickPlayer', { name: 'Aragorn' }) }),
    );

    // The standard confirm prompt names the character, the account, and the
    // action, and requires a reason before anything is sent.
    expect(screen.getByRole('heading', { name: t('dialog.confirmKick') })).toBeInTheDocument();
    expect(screen.getByText('#77')).toBeInTheDocument();
    expect(screen.getByText(t('dialog.actionKick'))).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();

    const reason = screen.getByLabelText(t('dialog.reason'));
    await fireEvent.input(reason, { target: { value: 'AFK for two hours' } });
    const form = reason.closest('form');
    if (!form) throw new Error('prompt form not found');
    await fireEvent.submit(form);

    expect(mocks.apiPost).toHaveBeenCalledWith('/admin/api/moderation/accounts/77/kick', {
      reason: 'AFK for two hours',
    });
    expect(
      await screen.findByText(t('onlinePlayers.kicked', { name: 'Aragorn' })),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t('dialog.confirmKick') }),
    ).not.toBeInTheDocument();
    // The roster is re-read so the row reflects the server's answer.
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('reports a stale target (the player already left) inline, localized from its code', async () => {
    grantPermissions(['accounts.read', 'moderation.act']);
    mocks.apiPost.mockRejectedValue(new ApiError(409, 'kick.target_offline'));
    render(OnlinePlayers);
    await screen.findByText('Belegorn');

    const row = screen.getByText('Belegorn').closest('tr');
    if (!row) throw new Error('player row not found');
    await fireEvent.click(
      within(row).getByRole('button', { name: t('online.kickPlayer', { name: 'Belegorn' }) }),
    );
    const reason = screen.getByLabelText(t('dialog.reason'));
    await fireEvent.input(reason, { target: { value: 'AFK' } });
    const form = reason.closest('form');
    if (!form) throw new Error('prompt form not found');
    await fireEvent.submit(form);

    expect(
      await screen.findByText(
        t('onlinePlayers.kickFailed', {
          name: 'Belegorn',
          error: t('error.kickTargetOffline'),
        }),
      ),
    ).toBeInTheDocument();
    // A refusal keeps the prompt (and the typed reason) open, and a 409 is never
    // a session loss: the operator stays signed in.
    expect(screen.getByRole('heading', { name: t('dialog.confirmKick') })).toBeInTheDocument();
    expect(auth.token).toBe('tok');
  });

  it('reports an operator target refusal and a mid-session permission loss inline', async () => {
    grantPermissions(['accounts.read', 'moderation.act']);
    mocks.apiPost.mockRejectedValueOnce(new ApiError(400, 'kick.admin_target'));
    render(OnlinePlayers);
    await screen.findByText('Aragorn');

    const row = screen.getByText('Aragorn').closest('tr');
    if (!row) throw new Error('player row not found');
    const submitKick = async (): Promise<void> => {
      const reason = screen.getByLabelText(t('dialog.reason'));
      await fireEvent.input(reason, { target: { value: 'AFK' } });
      const form = reason.closest('form');
      if (!form) throw new Error('prompt form not found');
      await fireEvent.submit(form);
    };
    await fireEvent.click(
      within(row).getByRole('button', { name: t('online.kickPlayer', { name: 'Aragorn' }) }),
    );
    await submitKick();
    expect(
      await screen.findByText(
        t('onlinePlayers.kickFailed', { name: 'Aragorn', error: t('error.kickAdminTarget') }),
      ),
    ).toBeInTheDocument();

    // A 403 (the permission was revoked since the page loaded) is an inline
    // error too, never a logout: only a 401 ends the session.
    mocks.apiPost.mockRejectedValueOnce(new ApiError(403, 'insufficient permissions'));
    await submitKick();
    expect(
      await screen.findByText(
        t('onlinePlayers.kickFailed', {
          name: 'Aragorn',
          error: localizeAdminError('insufficient permissions'),
        }),
      ),
    ).toBeInTheDocument();
    expect(auth.token).toBe('tok');
  });

  it('is reachable from the Players nav with accounts.read', async () => {
    history.replaceState(null, '', '/admin?page=online-players');
    auth.token = 'tok';
    auth.name = 'admin';
    grantPermissions(['accounts.read']);
    render(App);

    expect(await screen.findByText('Aragorn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('online.title') })).toHaveAttribute(
      'href',
      '/admin?page=online-players',
    );
    expect(screen.getByRole('heading', { name: t('online.title') })).toBeInTheDocument();
  });
});
