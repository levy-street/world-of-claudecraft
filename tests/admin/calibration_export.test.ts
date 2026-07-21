import { describe, expect, it } from 'vitest';
import { buildCalibrationExport } from '../../src/admin/calibration_export';
import type { DetectionCalibrationData } from '../../src/admin/types';

describe('buildCalibrationExport', () => {
  it('exports the complete server snapshot as readable JSON', () => {
    const data: DetectionCalibrationData = {
      schemaVersion: 1,
      capturedAt: '2026-07-03T10:15:30.123Z',
      serverStartedAt: '2026-07-03T08:15:30.000Z',
      uptimeSeconds: 7200,
      histograms: [],
    };

    const file = buildCalibrationExport(data);

    expect(file.filename).toBe('bot-detector-calibration-2026-07-03T10-15-30-123Z.json');
    expect(JSON.parse(file.contents)).toEqual(data);
    expect(file.contents).toContain('\n  "serverStartedAt"');
    expect(file.contents.endsWith('\n')).toBe(true);
  });
});
