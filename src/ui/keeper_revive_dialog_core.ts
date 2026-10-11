// The Pale Keeper's two-step revive: talking to the Keeper opens its dialogue,
// and choosing Revive Me there opens a second confirmation that says again what
// the raise will cost THIS character. Both steps are level-aware: a character the
// Toll will land on hears only the price and the free walk back (never that a
// waiver exists), a character below RES_SICKNESS_MIN_LEVEL is told the Toll
// exists but that they are spared it as a newcomer. Pure key selection; the HUD
// resolves the keys through t() and owns the dialog DOM (Hud.confirmDialog).

import { RES_SICKNESS_MIN_LEVEL } from '../sim/resurrection';
import type { TranslationKey } from './i18n';

export interface KeeperDialogStep {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  okKey: TranslationKey;
  cancelKey: TranslationKey;
}

/** Whether a character of this level is spared the Toll (nothing is charged
 *  below RES_SICKNESS_MIN_LEVEL). */
export function keeperTollSpared(
  level: number,
  minLevel: number = RES_SICKNESS_MIN_LEVEL,
): boolean {
  return level < minLevel;
}

/** Step one: the Keeper's own words, chosen for whether the Toll would land. */
export function keeperReviveDialogue(
  level: number,
  minLevel: number = RES_SICKNESS_MIN_LEVEL,
): KeeperDialogStep {
  return {
    titleKey: 'hudChrome.death.keeperTalkTitle',
    bodyKey: keeperTollSpared(level, minLevel)
      ? 'hudChrome.death.keeperTalkSparedBody'
      : 'hudChrome.death.keeperTalkBody',
    okKey: 'hudChrome.death.keeperTalkAccept',
    cancelKey: 'hudChrome.death.keeperTalkLeave',
  };
}

/** Step two: the confirmation, worded for whether the Toll will land on a
 *  character of this level (nothing is charged below RES_SICKNESS_MIN_LEVEL). */
export function keeperReviveConfirm(
  level: number,
  minLevel: number = RES_SICKNESS_MIN_LEVEL,
): KeeperDialogStep {
  const spared = keeperTollSpared(level, minLevel);
  return {
    titleKey: spared
      ? 'hudChrome.death.keeperConfirmSparedTitle'
      : 'hudChrome.death.healerConfirmTitle',
    bodyKey: spared
      ? 'hudChrome.death.keeperConfirmSparedBody'
      : 'hudChrome.death.keeperConfirmBody',
    okKey: 'hudChrome.death.healerConfirmAccept',
    cancelKey: 'hudChrome.death.healerConfirmCancel',
  };
}
