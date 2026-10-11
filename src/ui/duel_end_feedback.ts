import type { SimEvent } from '../sim/types';
import { t } from './i18n';

export function duelEndFeedback(ev: Extract<SimEvent, { type: 'duelEnd' }>): {
  banner: string;
  log: string;
} {
  const values = { winner: ev.winnerName, loser: ev.loserName };
  return {
    banner: t('hud.system.duelEndBanner', values),
    log: t('hud.system.duelEndLog', values),
  };
}
