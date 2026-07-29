// @vitest-environment happy-dom
import './_setup';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerfCaptureStatus } from '../../src/admin/types';

const noCaptureStatus: PerfCaptureStatus = {
  captureId: null,
  capturing: false,
  endsAt: null,
  last: null,
};

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

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

import { t } from '../../src/admin/i18n';
import TickPerf from '../../src/admin/pages/TickPerf.svelte';

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === '/admin/api/perf/tick') return noCaptureStatus;
    throw new Error(`unexpected path ${path}`);
  });
});

describe('TickPerf page', () => {
  it('renders the no-capture status once the fetch resolves', async () => {
    render(TickPerf);
    expect(await screen.findByText(t('tickPerf.noCapture'))).toBeInTheDocument();
    expect(screen.queryByText(t('tickPerf.loadFailed'))).not.toBeInTheDocument();
  });

  // A rejected status fetch must not swallow the error into console.error alone:
  // the panel renders a failed state instead of staying blank forever.
  it('reports a failed load instead of an empty panel', async () => {
    mocks.apiGet.mockRejectedValue(new Error('boom'));
    render(TickPerf);
    expect(await screen.findByText(t('tickPerf.loadFailed'))).toBeInTheDocument();
    expect(screen.queryByText(t('tickPerf.noCapture'))).not.toBeInTheDocument();
  });
});
