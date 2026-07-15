export interface WeaponAuraFlowPlan {
  /** Full aura width as a fraction of the weapon's longest local axis. */
  envelopeWidth: number;
  envelopeOpacity: number;
  /** Normalized hilt-to-tip traversals per second. */
  speed: number;
  particleCount: number;
  /** World-relative particle diameter before perspective scaling. */
  particleSize: number;
}

export interface WeaponAuraPlan {
  id: 'sanguine_aura' | 'sword_aura_cast' | 'sword_aura';
  color: number;
  slots: readonly number[];
  opacity: number;
  scale: number;
  /** Optional authored flame envelope and hilt-to-tip particle stream. */
  flow?: WeaponAuraFlowPlan;
}

const SANGUINE_AURA_PLAN: WeaponAuraPlan = {
  id: 'sanguine_aura',
  color: 0x45ff9a,
  slots: [0],
  opacity: 0.42,
  scale: 1.08,
};

const SWORD_AURA_PLAN: WeaponAuraPlan = {
  id: 'sword_aura',
  color: 0x22d3ee,
  slots: [0, 1],
  opacity: 0.34,
  scale: 1.06,
  flow: {
    envelopeWidth: 0.46,
    envelopeOpacity: 0.86,
    speed: 0.82,
    particleCount: 10,
    particleSize: 0.18,
  },
};

const SWORD_AURA_CAST_PLAN: WeaponAuraPlan = {
  id: 'sword_aura_cast',
  color: 0x67e8f9,
  slots: [0, 1],
  opacity: 0.24,
  scale: 1.06,
  flow: {
    envelopeWidth: 0.3,
    envelopeOpacity: 0.52,
    speed: 0.56,
    particleCount: 6,
    particleSize: 0.13,
  },
};

/** Resolve the strongest authored held-weapon aura from live sim state. The
 * lighter cast shell gathers on both blades before the stronger lasting aura
 * replaces it. Sword Aura also wins over Sanguine if the two buffs overlap. */
export function weaponAuraPlan(
  auras: readonly { id: string }[],
  castingAbility?: string | null,
): WeaponAuraPlan | null {
  if (auras.some((aura) => aura.id === 'sword_aura')) return SWORD_AURA_PLAN;
  if (castingAbility === 'sword_aura') return SWORD_AURA_CAST_PLAN;
  if (auras.some((aura) => aura.id === 'sanguine_aura')) return SANGUINE_AURA_PLAN;
  return null;
}
