// @vitest-environment happy-dom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderUsageResponse } from '../../src/admin/types';

const usageResponse: ProviderUsageResponse = {
  usage: {
    generatedAt: '2026-06-01T00:00:00Z',
    windows: [{ key: 'm1', labelKey: 'usage.colMetric', milliseconds: 60000 }],
    metrics: [{ key: 'rpc', labelKey: 'usage.colMetric', counts: { m1: 7, m5: 0, h1: 0, h24: 0 } }],
    caches: [],
  },
};

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

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
import Usage from '../../src/admin/pages/Usage.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === '/admin/api/provider-usage') return usageResponse;
    throw new Error(`unexpected path ${path}`);
  });
});

describe('Usage page', () => {
  it('renders the provider usage panel once the fetch resolves', async () => {
    render(Usage);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.queryByText(t('usage.loadFailed'))).not.toBeInTheDocument();
  });

  // A rejected fetch must not swallow the error into console.error alone: the
  // panel renders a failed state instead of staying blank forever.
  it('reports a failed load instead of an empty panel', async () => {
    mocks.apiGet.mockRejectedValue(new Error('boom'));
    render(Usage);
    expect(await screen.findByText(t('usage.loadFailed'))).toBeInTheDocument();
  });
});
