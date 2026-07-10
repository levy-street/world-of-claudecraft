import type { BotDetector, BotTrackingContext } from './contract';

// No-op implementation of the BotDetector interface.
const HANDLE = {} as unknown as BotTrackingContext;

export function createBotDetector(): BotDetector {
  return {
    // The stub inspects nothing, so the host can skip the per-player-per-tick
    // runtime-snapshot allocation entirely.
    wantsTickSnapshots: false,
    createTrackingContext: (_ref, _meta) => HANDLE,
    setTrackingConnection: () => {},
    releaseTrackingContext: () => {},
    observeCommand: () => {},
    observeEvent: () => {},
    observeInput: () => {},
    observeProtocolAnomaly: () => {},
    handleTick: () => 'none',
    listSuspiciousPlayers: () => [],
    listCalibrationHistograms: () => [],
    describeConfig: () => [],
    applyConfig: () => ({ errors: [] }),
  };
}
