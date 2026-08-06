// Pure presentation mapping for the death recap log line ("You have died. ...").
// Chooses among the four killer/ability combinations the sim's playerDeath event
// carries, and gives the two known environmental causes (fall damage, swim
// fatigue) their own sentence shape instead of the generic "Slain by X"
// construction, since a bare untranslatable cause name ('Falling', 'Fatigue')
// gives a translator nothing to inflect and is not an ABILITIES name or an
// AURA_NAME_KEY entry, so it would otherwise fall through abilityDisplayNameFromSource
// to raw English.
//
// Extracted from hud.ts (the playerDeath case) so the fallback ordering the
// player actually sees is host-agnostic and directly testable, following the
// unstuck_feedback.ts precedent.

import type { TranslationKey } from './i18n.catalog';

export interface DeathRecapFeedback {
  key: TranslationKey;
  values?: Record<string, string>;
}

// The raw English cause strings dealDamage passes as the killing "ability" for
// environmental damage: 'Falling' (src/sim/player_motion.ts) and 'Fatigue'
// (src/sim/fatigue.ts). Neither is a player ability or a registered aura/mechanic
// name, so they get a dedicated full-sentence key instead of being interpolated
// into deathRecapAbility. Both causes are unattributed (dealDamage is called with
// a null source), so a killer name never accompanies them.
const ENVIRONMENTAL_KEYS: Record<string, TranslationKey> = {
  Falling: 'hud.system.deathRecapFalling',
  Fatigue: 'hud.system.deathRecapDrowned',
};

/**
 * @param killerName Localized display name of the killer entity, if credited.
 * @param abilityRaw The raw English source string the sim emitted on the
 *   playerDeath event (`ev.killerAbility`), used only to detect an
 *   environmental cause.
 * @param abilityDisplay The already-localized ability/mechanic name
 *   (`abilityDisplayNameFromSource(abilityRaw)`), used for the generic cases.
 */
export function deathRecapFeedback(
  killerName: string | undefined,
  abilityRaw: string | undefined,
  abilityDisplay: string | undefined,
): DeathRecapFeedback {
  if (!killerName && abilityRaw) {
    const environmentalKey = ENVIRONMENTAL_KEYS[abilityRaw];
    if (environmentalKey) return { key: environmentalKey };
  }
  if (killerName && abilityDisplay) {
    return {
      key: 'hud.system.deathRecapKillerAbility',
      values: { killer: killerName, ability: abilityDisplay },
    };
  }
  if (killerName) {
    return { key: 'hud.system.deathRecapKiller', values: { killer: killerName } };
  }
  if (abilityDisplay) {
    return { key: 'hud.system.deathRecapAbility', values: { ability: abilityDisplay } };
  }
  return { key: 'hud.system.playerDeath' };
}
