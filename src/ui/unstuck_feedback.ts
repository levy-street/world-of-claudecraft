// Pure presentation mapping for structured unstuck events. The authoritative
// sim supplies phases and stable reason codes; this leaf chooses localized HUD
// keys without matching or leaking server English.

import type { SimEvent } from '../sim/types';
import { formatNumber } from './i18n';
import type { TranslationKey } from './i18n.catalog';

export interface UnstuckFeedback {
  key: TranslationKey;
  bannerKey?: TranslationKey;
  values?: Record<string, string | number>;
  kind: 'progress' | 'success' | 'error';
  banner: boolean;
  log: boolean;
  clearBanner: boolean;
}

type Event = Extract<SimEvent, { type: 'unstuck' }>;

const error = (key: TranslationKey): UnstuckFeedback => ({
  key,
  kind: 'error',
  banner: false,
  log: false,
  clearBanner: false,
});

const seconds = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/**
 * The two live outcomes both end at the graveyard under Unstuck Sickness and differ only in
 * whether a revive happened, so they get their own keys. The retired reasons keep their
 * shipped keys: 'nearest_safe_position' (short-range teleport, historical telemetry) and
 * 'nearest_graveyard' (the pre-0.32.1 kill-and-release outcome, still emitted by a
 * not-yet-updated server when an OTA bundle runs ahead of it).
 */
function completedKey(reason: Extract<Event, { phase: 'completed' }>['reason']): TranslationKey {
  switch (reason) {
    case 'moved_to_graveyard':
      return 'hudChrome.unstuck.movedToGraveyard';
    case 'revived_at_graveyard':
      return 'hudChrome.unstuck.revivedAtGraveyardUnstuck';
    case 'nearest_graveyard':
      return 'hudChrome.unstuck.completedAtGraveyard';
    case 'nearest_safe_position':
      return 'hudChrome.unstuck.completed';
  }
}

export function unstuckFeedback(event: Event): UnstuckFeedback {
  if (event.phase === 'started') {
    return {
      key: 'hudChrome.unstuck.started',
      bannerKey: 'hudChrome.unstuck.countdown',
      values: { seconds: seconds(event.seconds) },
      kind: 'progress',
      banner: true,
      log: true,
      clearBanner: false,
    };
  }
  if (event.phase === 'countdown') {
    return {
      key: 'hudChrome.unstuck.countdown',
      values: { seconds: seconds(event.seconds) },
      kind: 'progress',
      banner: true,
      log: false,
      clearBanner: false,
    };
  }
  if (event.phase === 'completed') {
    return {
      key: completedKey(event.reason),
      kind: 'success',
      banner: true,
      log: true,
      clearBanner: true,
    };
  }
  if (event.phase === 'failed') {
    return { ...error('hudChrome.unstuck.noSafePosition'), clearBanner: true };
  }
  if (event.phase === 'cancelled') {
    switch (event.reason) {
      case 'moved':
        return { ...error('hudChrome.unstuck.cancelledMoved'), clearBanner: true };
      case 'damaged':
        return { ...error('hudChrome.unstuck.cancelledDamaged'), clearBanner: true };
      case 'combat':
        return { ...error('hudChrome.unstuck.cancelledCombat'), clearBanner: true };
      case 'busy':
        return { ...error('hudChrome.unstuck.cancelledBusy'), clearBanner: true };
      case 'state_changed':
        return { ...error('hudChrome.unstuck.cancelledState'), clearBanner: true };
      case 'disconnected':
        return { ...error('hudChrome.unstuck.cancelledDisconnected'), clearBanner: true };
    }
  }
  if (event.phase !== 'blocked') {
    const exhaustive: never = event;
    return exhaustive;
  }
  switch (event.reason) {
    case 'already_active':
      return error('hudChrome.unstuck.alreadyActive');
    case 'already_safe':
      return error('hudChrome.unstuck.alreadySafe');
    case 'cooldown':
      return {
        ...error('hudChrome.unstuck.cooldown'),
        values: { seconds: seconds(event.seconds ?? 1) },
      };
    case 'dead':
    case 'ghost':
      return error('hudChrome.unstuck.dead');
    case 'combat':
      return error('hudChrome.unstuck.combat');
    case 'controlled':
      return error('hudChrome.unstuck.controlled');
    case 'falling':
      return error('hudChrome.unstuck.standStill');
    case 'moving':
      return error('hudChrome.unstuck.standStillAnywhere');
    case 'busy':
      return error('hudChrome.unstuck.busy');
    case 'jailed':
    case 'spectating':
    case 'competitive':
    case 'trading':
    case 'invalid_area':
      return error('hudChrome.unstuck.unavailable');
  }
}
