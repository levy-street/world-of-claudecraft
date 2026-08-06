// Pure combat-log key selection for a landed shield block, the sibling of
// heal_landing_feedback_core.ts for the block half of the damage-event switch. A block
// still deals real (reduced) damage (see fct_event.ts / fct_core.ts for the FCT shape +
// colour half of this split), so unlike the plain avoidance words (miss/dodge/parry/
// resist/evade), it needs its own combat-log sentence in BOTH directions: the player's
// own attack getting blocked, and the player blocking an incoming attack. Host-agnostic
// and DOM/clock/i18n-free (registered in UI_PURE_CORES): the localized text (the t() call
// itself) stays at the hud.ts call site, consistent with the heal_landing_feedback_core
// pattern this mirrors.

export type BlockLandingLogKey = 'hud.combat.blockedDone' | 'hud.combat.blockedTaken';

/**
 * Resolve which combat-log sentence a landed block gets, or null when neither role
 * applies (a block between two non-player entities logs nothing, matching the plain-hit
 * branch it sits beside). isPlayerTarget wins over isPlayerSource on a self-inflicted
 * block, mirroring the `if (isPlayerSource && !isPlayerTarget) ... else if (isPlayerTarget)`
 * priority fctSpawnShape uses for the plain-hit / block FCT shape.
 */
export function blockLandingLogKey(
  isPlayerSource: boolean,
  isPlayerTarget: boolean,
): BlockLandingLogKey | null {
  if (isPlayerSource && !isPlayerTarget) return 'hud.combat.blockedDone';
  if (isPlayerTarget) return 'hud.combat.blockedTaken';
  return null;
}
