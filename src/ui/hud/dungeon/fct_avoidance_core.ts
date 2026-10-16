// The floating avoidance word over a body that took no damage from a hit: the
// classic words (Miss, Dodge, Parry, Evade, Resist). Pure and DOM-free: the
// HUD's floating combat text asks it for the word.

import { t } from '../../i18n';

/** The word a fully avoided hit floats over its target. */
export function fctAvoidanceText(kind: string): string {
  if (kind === 'miss') return t('hud.combat.floatingMiss');
  if (kind === 'dodge') return t('hud.combat.floatingDodge');
  if (kind === 'parry') return t('hud.combat.floatingParry');
  if (kind === 'evade') return t('hud.combat.floatingEvade');
  return t('hud.combat.floatingResist');
}
