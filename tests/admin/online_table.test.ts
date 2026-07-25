// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
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
});
