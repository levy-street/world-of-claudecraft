import type { DetectionCalibrationData } from './types';

export interface CalibrationExportFile {
  filename: string;
  contents: string;
}

export function buildCalibrationExport(data: DetectionCalibrationData): CalibrationExportFile {
  const timestamp = data.capturedAt.replace(/[:.]/g, '-');
  return {
    filename: `bot-detector-calibration-${timestamp}.json`,
    contents: `${JSON.stringify(data, null, 2)}\n`,
  };
}
