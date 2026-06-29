// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const blockedData = {
  rows: [
    {
      id: 1,
      ip: '203.0.113.7',
      reason: 'spam',
      createdAt: '2026-06-01T00:00:00Z',
      expiresAt: null,
      createdByUsername: 'admin',
    },
  ],
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
  apiGet: vi.fn(async () => blockedData),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import BlockedIps from '../../src/admin/pages/BlockedIps.svelte';

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('BlockedIps', () => {
  it('lists current blocks with a permanent badge', async () => {
    render(BlockedIps);
    const ipLink = await screen.findByRole('link', { name: '203.0.113.7' });
    expect(ipLink).toHaveAttribute('href', expect.stringContaining('ip=203.0.113.7'));
    expect(screen.getByText(t('blockedIps.permanent'))).toBeInTheDocument();
  });

  it('unblocks an IP via the delete endpoint', async () => {
    render(BlockedIps);
    await screen.findByText('203.0.113.7');
    await fireEvent.click(screen.getByText(t('blockedIps.remove')));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/blocked-ips/delete', { ip: '203.0.113.7' });
  });
});
