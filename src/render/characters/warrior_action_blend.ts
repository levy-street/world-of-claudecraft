/** Preserve the silhouette of short authored loading poses at action entry. */
export function warriorActionBlend(key: string, name: string, fallback: number): number {
  if (key !== 'player_warrior') return fallback;
  if (name === 'Warrior_Storm_Bolt' || name === 'Signature_storm_bolt') return 0.025;
  if (name.startsWith('Warrior_') || name.startsWith('Signature_')) return 0.035;
  return fallback;
}
