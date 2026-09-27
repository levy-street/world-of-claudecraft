/** Live Warrior readiness only. Names shared with other classes are gated by
 * the painter's actual living-Warrior check before entering this owner. */
export const WARRIOR_READINESS = {
  battle: 1,
  berserker: 2,
  guarded: 4,
  suddenDeath: 8,
  battleTrance: 16,
  revenge: 32,
  wideningArc: 64,
  pursuit: 128,
} as const;

export function warriorReadinessBit(aura: {
  id: string;
  kind?: string;
  remaining?: number;
  value?: number;
}): number {
  if (!((aura.remaining ?? 0) > 0)) return 0;
  switch (aura.id) {
    case 'battle_stance':
      return aura.kind === 'battle_stance' ? WARRIOR_READINESS.battle : 0;
    case 'berserker_stance':
      return aura.kind === 'berserker_stance' ? WARRIOR_READINESS.berserker : 0;
    case 'defensive_stance':
      return aura.kind === 'defensive_stance' ? WARRIOR_READINESS.guarded : 0;
    case 'sudden_death':
      return aura.kind === 'sudden_death' ? WARRIOR_READINESS.suddenDeath : 0;
    case 'battle_trance':
      return aura.kind === 'battle_trance' ? WARRIOR_READINESS.battleTrance : 0;
    case 'revenge_free':
      return aura.kind === 'revenge_free' ? WARRIOR_READINESS.revenge : 0;
    case 'sweeping_strikes':
      return aura.kind === 'sweeping_strikes' ? WARRIOR_READINESS.wideningArc : 0;
    case 'pursuit':
      return aura.kind === 'buff_speed' && (aura.value ?? 0) > 1 ? WARRIOR_READINESS.pursuit : 0;
    default:
      return 0;
  }
}
