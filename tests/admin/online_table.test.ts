// @vitest-environment happy-dom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountModalOpen = vi.fn();

vi.mock('../../src/admin/account_modal', () => ({
  getAccountModalController: () => ({
    open: accountModalOpen,
    close: vi.fn(),
  }),
}));

import OnlineTable from '../../src/admin/components/OnlineTable.svelte';
import { t } from '../../src/admin/i18n';
import type { LivePlayer } from '../../src/admin/types';

const players: LivePlayer[] = [
  {
    pid: 1,
    accountId: 77,
    characterId: 42,
    name: 'Aragorn',
    class: 'warrior',
    level: 60,
    hp: 90,
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
  },
];

beforeEach(() => {
  accountModalOpen.mockReset();
});

describe('OnlineTable', () => {
  it('renders the player row with the account column as an account link', () => {
    render(OnlineTable, { players });
    expect(screen.getByText('Aragorn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '77' })).toBeInTheDocument();
  });

  it('opens the account detail modal when the account link is clicked', async () => {
    render(OnlineTable, { players });
    await fireEvent.click(screen.getByRole('button', { name: '77' }));
    expect(accountModalOpen).toHaveBeenCalledWith(77, undefined);
  });

  it('shows the empty message for no players', () => {
    render(OnlineTable, { players: [] });
    expect(screen.getByText(t('online.empty'))).toBeInTheDocument();
  });

  it('renders plain headers without a sort handler and sort buttons with one', async () => {
    const { unmount } = render(OnlineTable, { players });
    const plainHeader = screen.getByRole('columnheader', { name: t('online.colLevel') });
    expect(plainHeader).not.toHaveAttribute('aria-sort');
    expect(within(plainHeader).queryByRole('button')).not.toBeInTheDocument();
    unmount();

    const onSort = vi.fn();
    render(OnlineTable, { players, sort: 'level', dir: 'desc', onSort });
    const sortableHeader = screen.getByRole('columnheader', {
      name: new RegExp(t('online.colLevel')),
    });
    expect(sortableHeader).toHaveAttribute('aria-sort', 'descending');
    // Position has no meaningful order, so it stays a plain header even when sorting.
    expect(screen.getByRole('columnheader', { name: t('online.colPos') })).not.toHaveAttribute(
      'aria-sort',
    );

    await fireEvent.click(within(sortableHeader).getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('level');
  });
});
