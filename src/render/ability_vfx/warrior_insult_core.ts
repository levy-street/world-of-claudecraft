/** The caster's two audible challenges, once at their authoritative release.
 * Recipient control state remains responsible for whether a victim obeys. */
export function warriorInsultCue(fx: string, ability?: string): boolean {
  return (
    (fx === 'selfCast' && ability === 'taunt') || (fx === 'shout' && ability === 'defiant_bellow')
  );
}
