// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
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
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import SuspiciousPlayers from '../../src/admin/pages/SuspiciousPlayers.svelte';

const data = {
  players: [
    {
      ref: { accountId: 2, characterId: 20, name: 'LowScore', ip: '203.0.113.2' },
      score: 0.7,
      evidence: [
        {
          kind: 'review_signal_a',
          weight: 0.4,
          detail: 'Public-safe synthetic evidence A.',
          expiresAt: 1,
        },
        {
          kind: 'review_signal_b',
          weight: 0.3,
          detail: 'Public-safe synthetic evidence B.',
          expiresAt: 2,
        },
      ],
    },
    {
      ref: { accountId: 1, characterId: 10, name: 'HighScore', ip: '203.0.113.1' },
      score: 1.5,
      evidence: [
        {
          kind: 'review_signal_c',
          weight: 1.5,
          detail: 'Public-safe synthetic evidence C.',
          expiresAt: 3,
        },
      ],
    },
  ],
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockResolvedValue(data);
});

describe('Suspicious players', () => {
  it('lists player identity, score, and evidence details in score order', async () => {
    render(SuspiciousPlayers);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('HighScore')).toBeInTheDocument();
    expect(within(rows[3]).getByText('LowScore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HighScore' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '203.0.113.1' })).toHaveAttribute(
      'href',
      expect.stringContaining('page=ip'),
    );
    expect(screen.getByText('Public-safe synthetic evidence C.')).toBeInTheDocument();
    expect(screen.getByText('Public-safe synthetic evidence B.')).toBeInTheDocument();
  });

  it('sorts by evidence count when its header is selected', async () => {
    render(SuspiciousPlayers);
    await screen.findByText('HighScore');

    await fireEvent.click(screen.getByRole('button', { name: t('suspiciousPlayers.colEvidence') }));

    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('LowScore')).toBeInTheDocument();
    expect(within(rows[3]).getByText('HighScore')).toBeInTheDocument();
  });

  it('persists the auto-refresh preference in this browser', async () => {
    const first = render(SuspiciousPlayers);
    const toggle = await screen.findByRole('checkbox', {
      name: t('suspiciousPlayers.autoRefresh', { seconds: 5 }),
    });
    expect(toggle).toBeChecked();

    await fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('claudecraft_admin_suspicious_auto_refresh')).toBe('0');

    first.unmount();
    render(SuspiciousPlayers);
    expect(
      await screen.findByRole('checkbox', {
        name: t('suspiciousPlayers.autoRefresh', { seconds: 5 }),
      }),
    ).not.toBeChecked();
  });
});
