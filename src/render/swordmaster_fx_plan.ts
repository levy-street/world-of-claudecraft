export const SWORDMASTER_VFX_COLOR = 0x22d3ee;

export interface SwordmasterDamageVisualPlan {
  abilityId: string;
  kind: 'twin-cut' | 'sweep' | 'cyclone';
  anchor: 'source' | 'target';
  color: number;
  arcs: number;
  radius: number;
  duration: number;
  spinRate: number;
}

const TWIN_CUT: Omit<SwordmasterDamageVisualPlan, 'abilityId'> = {
  kind: 'twin-cut',
  anchor: 'target',
  color: SWORDMASTER_VFX_COLOR,
  arcs: 2,
  radius: 1.15,
  duration: 0.26,
  spinRate: 0,
};

const AOE_PLANS: Readonly<Record<string, Omit<SwordmasterDamageVisualPlan, 'abilityId'>>> = {
  crescent_sweep: {
    kind: 'sweep',
    anchor: 'source',
    color: SWORDMASTER_VFX_COLOR,
    arcs: 1,
    radius: 6,
    duration: 0.42,
    spinRate: 5.5,
  },
  blade_dance: {
    kind: 'cyclone',
    anchor: 'source',
    color: SWORDMASTER_VFX_COLOR,
    arcs: 2,
    radius: 7,
    duration: 0.55,
    spinRate: 8,
  },
  blade_cyclone: {
    kind: 'cyclone',
    anchor: 'source',
    color: SWORDMASTER_VFX_COLOR,
    arcs: 3,
    radius: 9,
    duration: 0.68,
    spinRate: 10,
  },
};

/** Stable presentation routing for the SwordMaster's physical damage events. */
export function swordmasterDamageVisualPlan(
  abilityId: string | undefined,
): SwordmasterDamageVisualPlan | null {
  if (!abilityId) return null;
  if (
    abilityId === 'twin_slash' ||
    abilityId === 'twin_finisher' ||
    abilityId === 'duelist_flurry'
  ) {
    return { abilityId, ...TWIN_CUT };
  }
  const plan = AOE_PLANS[abilityId];
  return plan ? { abilityId, ...plan } : null;
}
