// @vitest-environment jsdom
import './_setup';
import { render, screen } from '@testing-library/svelte';
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
import DetectionCalibration from '../../src/admin/pages/DetectionCalibration.svelte';

const data = {
  histograms: [
    {
      id: 'metric_a_ms',
      count: 3,
      min: 12,
      max: 60,
      sum: 100,
      buckets: [
        { le: 10, count: 0 },
        { le: 25, count: 2 },
        { le: 100, count: 1 },
      ],
      overflowCount: 0,
    },
    {
      id: 'metric_b_count',
      count: 1,
      min: 1,
      max: 1,
      sum: 1,
      buckets: [{ le: 1, count: 1 }],
      overflowCount: 0,
    },
  ],
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockResolvedValue(data);
});

describe('Detection calibration', () => {
  it('renders one histogram section per metric with sample counts and summary stats', async () => {
    render(DetectionCalibration);

    expect(await screen.findByText('metric_a_ms')).toBeInTheDocument();
    expect(screen.getByText('metric_b_count')).toBeInTheDocument();
    expect(screen.getByText(t('calibration.samples', { count: '3' }))).toBeInTheDocument();
    expect(screen.getAllByText(t('calibration.statP95'))).toHaveLength(2);
  });

  it('shows the empty state when the detector has published nothing', async () => {
    mocks.apiGet.mockResolvedValue({ histograms: [] });
    render(DetectionCalibration);

    expect(await screen.findByText(t('calibration.empty'))).toBeInTheDocument();
  });

  it('shows the failure state when the endpoint errors', async () => {
    mocks.apiGet.mockRejectedValue(new Error('boom'));
    render(DetectionCalibration);

    expect(await screen.findByText(t('calibration.loadFailed'))).toBeInTheDocument();
  });
});
