import type { BotDetector, BotTrackingContext } from './contract';

// No-op implementation of the BotDetector interface.
const HANDLE = {} as unknown as BotTrackingContext;

export function createBotDetector(): BotDetector {
  return {
    createTrackingContext: (_ref, _meta) => HANDLE,
    releaseTrackingContext: () => {},
    observeCommand: () => {},
    observeEvent: () => {},
    observeInput: () => {},
    observeProtocolAnomaly: () => {},
    handleTick: () => 'none',
  };
}
