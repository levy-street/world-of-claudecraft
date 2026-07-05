import { describe, expect, it } from 'vitest';
import { buildDetectionCalibrationSnapshot } from '../server/calibration_snapshot';

describe('buildDetectionCalibrationSnapshot', () => {
  it('identifies the server run and timestamps the cumulative histograms', () => {
    const histograms = [
      {
        id: 'metric_a_ms',
        count: 1,
        min: 25,
        max: 25,
        sum: 25,
        buckets: [{ le: 25, count: 1 }],
        overflowCount: 0,
      },
    ];

    expect(
      buildDetectionCalibrationSnapshot(
        histograms,
        Date.parse('2026-07-03T08:15:30.000Z'),
        Date.parse('2026-07-03T10:15:30.999Z'),
      ),
    ).toEqual({
      schemaVersion: 1,
      capturedAt: '2026-07-03T10:15:30.999Z',
      serverStartedAt: '2026-07-03T08:15:30.000Z',
      uptimeSeconds: 7200,
      histograms,
    });
  });
});
