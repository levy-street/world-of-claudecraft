// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
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
import DetectionCalibration from '../../src/admin/pages/DetectionCalibration.svelte';

const data = {
  schemaVersion: 1,
  capturedAt: '2026-07-03T10:15:30.123Z',
  serverStartedAt: '2026-07-03T08:15:30.000Z',
  uptimeSeconds: 7200,
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

afterEach(() => vi.restoreAllMocks());

describe('Detection calibration', () => {
  it('renders one histogram section per metric with sample counts and summary stats', async () => {
    render(DetectionCalibration);

    expect(await screen.findByText('metric_a_ms')).toBeInTheDocument();
    expect(screen.getByText('metric_b_count')).toBeInTheDocument();
    expect(screen.getByText(t('calibration.samples', { count: '3' }))).toBeInTheDocument();
    expect(screen.getAllByText(t('calibration.statP95'))).toHaveLength(2);
  });

  it('downloads the complete server snapshot as JSON', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:calibration');
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
      expect(this.download).toBe('bot-detector-calibration-2026-07-03T10-15-30-123Z.json');
      expect(this.href).toBe('blob:calibration');
    });
    render(DetectionCalibration);

    await screen.findByText('metric_a_ms');
    await fireEvent.click(screen.getByRole('button', { name: t('calibration.downloadJson') }));

    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:calibration');
  });

  it('shows the empty state when the detector has published nothing', async () => {
    mocks.apiGet.mockResolvedValue({ ...data, histograms: [] });
    render(DetectionCalibration);

    expect(await screen.findByText(t('calibration.empty'))).toBeInTheDocument();
  });

  it('shows the failure state when the endpoint errors', async () => {
    mocks.apiGet.mockRejectedValue(new Error('boom'));
    render(DetectionCalibration);

    expect(await screen.findByText(t('calibration.loadFailed'))).toBeInTheDocument();
  });
});
