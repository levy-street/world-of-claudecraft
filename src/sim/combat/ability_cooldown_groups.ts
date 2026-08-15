const SHAMAN_SHOCK_COOLDOWN_IDS = ['earth_shock', 'flame_shock', 'frost_shock'] as const;

export function sharedCooldownIds(abilityId: string): readonly string[] | null {
  if (
    (SHAMAN_SHOCK_COOLDOWN_IDS as readonly string[]).includes(abilityId) ||
    abilityId === 'lightning_shock'
  ) {
    return SHAMAN_SHOCK_COOLDOWN_IDS;
  }
  return null;
}
