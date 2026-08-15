/**
 * Whether an entity needs the full character presentation path this frame.
 * Hidden cosmetic rigs may advance only their bounded clocks, but actionable
 * actors stay live so camera re-entry cannot delay a telegraph.
 */
export function shouldRunCharacterPresentationWork(
  onScreen: boolean,
  actionable: boolean,
): boolean {
  return onScreen || actionable;
}

/** Final render-side cast state, including spellfx-driven channel visuals. */
export function characterPresentationCasting(
  castingAbility: string | null,
  waterJetVisualChannel: boolean,
  visuallyDead: boolean,
): boolean {
  return (castingAbility !== null || waterJetVisualChannel) && !visuallyDead;
}

/**
 * Advance the one-shot Recklessness skull latch. A hidden activation stays
 * unlatched until presentation can run, camera re-entry preserves a completed
 * latch, and the real aura end re-arms the next activation.
 */
export function nextRecklessnessSkullsLatch(
  hasRecklessness: boolean,
  runPresentation: boolean,
  alreadySpawned: boolean,
): boolean {
  return hasRecklessness && (alreadySpawned || runPresentation);
}
