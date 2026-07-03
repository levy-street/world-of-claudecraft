import type { CalibrationHistogram } from './bot_detector/contract';

export interface DetectionCalibrationSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  serverStartedAt: string;
  uptimeSeconds: number;
  histograms: CalibrationHistogram[];
}

export function buildDetectionCalibrationSnapshot(
  histograms: CalibrationHistogram[],
  serverStartedAtMs: number,
  capturedAtMs: number,
): DetectionCalibrationSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: new Date(capturedAtMs).toISOString(),
    serverStartedAt: new Date(serverStartedAtMs).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((capturedAtMs - serverStartedAtMs) / 1000)),
    histograms,
  };
}
