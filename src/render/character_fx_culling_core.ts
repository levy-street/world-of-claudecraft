/**
 * Whether a character's cosmetic effect systems need a frame of work.
 *
 * Off-screen rigs may let their aura bands, body glows, and particles expire
 * until they re-enter the view. Actionable entities stay live even when the
 * frustum cull hides them, so cast and combat-linked telegraphs never sleep.
 */
export function shouldRunCharacterFx(onScreen: boolean, actionable: boolean): boolean {
  return onScreen || actionable;
}
