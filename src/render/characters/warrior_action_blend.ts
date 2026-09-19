/** Native wind-ups peak at 60 to 95ms. A 100ms entry fade blended most of that
 * pose back toward idle. Keep the full loading silhouette before acceleration;
 * the instant hammer's 40ms release needs its shorter entry. */
export function warriorActionBlend(key: string, name: string, fallback: number): number {
  if (key !== 'player_warrior') return fallback;
  if (name === 'Warrior_Storm_Bolt' || name === 'Signature_storm_bolt') return 0.012;
  if (name.startsWith('Warrior_') || name.startsWith('Signature_')) return 0.035;
  return fallback;
}
