export const PROTECTION_PALADIN_BLOCK_DAMAGE_REDUCTION = 0.2;

export function blockedMeleeDamage(
  damage: number,
  blockValue: number,
  protectionPaladin: boolean,
): number {
  const damageAfterPercentage = protectionPaladin
    ? damage * (1 - PROTECTION_PALADIN_BLOCK_DAMAGE_REDUCTION)
    : damage;
  return Math.max(1, damageAfterPercentage - blockValue);
}
