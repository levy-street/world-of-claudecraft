// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      snapshot: { capturedAt: Date.UTC(2026, 6, 3, 11) },
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
          occurrences: 1,
          firstAt: Date.now() - 12_000,
          lastAt: Date.now() - 12_000,
        },
      ],
    },
    {
      ref: { accountId: 1, characterId: 10, name: 'HighScore', ip: '203.0.113.1' },
      snapshot: { capturedAt: Date.UTC(2026, 6, 3, 10) },
      score: 1.5,
      evidence: [
        {
          kind: 'review_signal_c',
          weight: 1.5,
          detail: 'Public-safe synthetic evidence C.',
          expiresAt: 3,
          occurrences: 4,
          firstAt: Date.now() - 40 * 60_000,
          lastAt: Date.now() - 12_000,
        },
      ],
    },
  ],
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockResolvedValue(data);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Suspicious players', () => {
  it('lists sessions in latest-observation order by default', async () => {
    render(SuspiciousPlayers);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('LowScore')).toBeInTheDocument();
    expect(within(rows[3]).getByText('HighScore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HighScore' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '203.0.113.1' })).toHaveAttribute(
      'href',
      expect.stringContaining('page=ip'),
    );
    expect(screen.getByText('Public-safe synthetic evidence C.')).toBeInTheDocument();
    expect(screen.getByText('Public-safe synthetic evidence B.')).toBeInTheDocument();
    const observedSort = screen.getByRole('button', { name: 'Last observed' });
    expect(observedSort).toBeInTheDocument();
    expect(observedSort.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveTextContent('2 results');
    expect(screen.getByRole('status')).toHaveTextContent('2 results');
  });

  it('shows the recurrence history only on evidence that carries it', async () => {
    render(SuspiciousPlayers);
    await screen.findByText('HighScore');

    // review_signal_c: a repeating episode shows the count plus both endpoints.
    const repeating = screen.getByText(/seen x4/);
    expect(repeating).toHaveTextContent('first');
    expect(repeating).toHaveTextContent('latest');
    // review_signal_b: a single occurrence shows the count and the latest, no "first".
    const single = screen.getByText(/seen x1/);
    expect(single).toHaveTextContent('latest');
    expect(single).not.toHaveTextContent('first');
    // review_signal_a and review_signal_c's siblings without history render nothing.
    expect(screen.getAllByText(/seen x/)).toHaveLength(2);
  });

  it('sorts by evidence count when its header is selected', async () => {
    render(SuspiciousPlayers);
    await screen.findByText('HighScore');

    await fireEvent.click(screen.getByRole('button', { name: t('suspiciousPlayers.colEvidence') }));

    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('LowScore')).toBeInTheDocument();
    expect(within(rows[3]).getByText('HighScore')).toBeInTheDocument();
  });

  it('reverses the last-observed order when its header is selected', async () => {
    render(SuspiciousPlayers);
    await screen.findByText('HighScore');

    await fireEvent.click(screen.getByRole('button', { name: /Last observed/ }));

    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('HighScore')).toBeInTheDocument();
    expect(within(rows[3]).getByText('LowScore')).toBeInTheDocument();
  });

  it('refreshes automatically every 30 seconds', async () => {
    vi.useFakeTimers();
    render(SuspiciousPlayers);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('checkbox', {
        name: t('suspiciousPlayers.autoRefresh', { seconds: 30 }),
      }),
    ).toBeChecked();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('filters dynamically by player name, IP, evidence kind, and evidence detail', async () => {
    render(SuspiciousPlayers);
    const search = await screen.findByRole('searchbox', {
      name: t('suspiciousPlayers.searchLabel'),
    });

    await fireEvent.input(search, { target: { value: 'HighScore' } });
    expect(screen.getByText('HighScore')).toBeInTheDocument();
    expect(screen.queryByText('LowScore')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 result');

    await fireEvent.input(search, { target: { value: 'review_signal_b' } });
    expect(screen.getByText('LowScore')).toBeInTheDocument();
    expect(screen.queryByText('HighScore')).not.toBeInTheDocument();

    await fireEvent.input(search, { target: { value: '203.0.113.1' } });
    expect(screen.getByText('HighScore')).toBeInTheDocument();
    expect(screen.queryByText('LowScore')).not.toBeInTheDocument();

    await fireEvent.input(search, { target: { value: 'synthetic evidence C' } });
    expect(screen.getByText('HighScore')).toBeInTheDocument();
    expect(screen.queryByText('LowScore')).not.toBeInTheDocument();

    await fireEvent.input(search, { target: { value: 'no matching session' } });
    expect(screen.getByRole('status')).toHaveTextContent('0 results');
    expect(screen.getByText(t('suspiciousPlayers.filteredEmpty'))).toBeInTheDocument();
  });

  it('downloads the complete unfiltered session dataset as JSON', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:suspicious-sessions');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toMatch(/^bot-detector-suspicious-sessions-.*\.json$/);
      expect(this.href).toBe('blob:suspicious-sessions');
    });
    render(SuspiciousPlayers);

    const search = await screen.findByRole('searchbox', {
      name: t('suspiciousPlayers.searchLabel'),
    });
    await fireEvent.input(search, { target: { value: 'HighScore' } });
    await fireEvent.click(
      screen.getByRole('button', { name: t('suspiciousPlayers.downloadJson') }),
    );

    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:suspicious-sessions');
  });
});
