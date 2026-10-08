import type { SimEvent } from '../sim/types';
import { chatBubbleKind, isCombatFlavorLog } from './log_event_route';

export const REPORT_REWARD_TEXT = 'An account you reported has been banned';
export const REPORT_REWARD_KEY = 'hudChrome.reportReward.banned';

/** Shared routing and banner policy for system log events. Chat messages never enter here. */
export function logEventFeedback(event: Extract<SimEvent, { type: 'log' }>): {
  combat: boolean;
  bubble: 'yell' | 'speech' | null;
  bannerKey: typeof REPORT_REWARD_KEY | null;
} {
  return {
    combat: isCombatFlavorLog(event.entityId, event.pid, event.telegraph),
    bubble: event.entityId === undefined ? null : chatBubbleKind(event.text),
    bannerKey: event.text === REPORT_REWARD_TEXT ? REPORT_REWARD_KEY : null,
  };
}
