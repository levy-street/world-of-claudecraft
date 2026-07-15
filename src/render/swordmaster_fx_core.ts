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

export interface SwordmasterDashVisualPlan {
  abilityId: 'wind_lunge' | 'azure_rush';
  kind: 'dash';
  color: number;
  width: number;
  duration: number;
  particleCount: number;
  afterimages: number;
}

export type SwordmasterVisualPlan = SwordmasterDamageVisualPlan | SwordmasterDashVisualPlan;

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

const DASH_PLANS: Readonly<
  Record<SwordmasterDashVisualPlan['abilityId'], Omit<SwordmasterDashVisualPlan, 'abilityId'>>
> = {
  wind_lunge: {
    kind: 'dash',
    color: SWORDMASTER_VFX_COLOR,
    width: 1.25,
    duration: 0.42,
    particleCount: 18,
    afterimages: 3,
  },
  azure_rush: {
    kind: 'dash',
    color: 0x67e8f9,
    width: 1.65,
    duration: 0.52,
    particleCount: 26,
    afterimages: 3,
  },
};

/** Stable presentation routing for the SwordMaster's authored blade effects. */
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

/** Area arcs belong to the activation event, so they remain visible on a miss
 * or an empty cast and never multiply once per damaged target. */
export function swordmasterSpellVisualPlan(
  fx: string,
  abilityId: string | undefined,
): SwordmasterVisualPlan | null {
  if (fx !== 'flourish' || !abilityId) return null;
  if (abilityId === 'wind_lunge' || abilityId === 'azure_rush') {
    return { abilityId, ...DASH_PLANS[abilityId] };
  }
  return swordmasterDamageVisualPlan(abilityId);
}

/** Paired single-target cuts originate from damage events. Area plans are
 * intentionally excluded because their activation event already painted them. */
export function swordmasterDamageEventVisualPlan(
  abilityId: string | undefined,
): SwordmasterDamageVisualPlan | null {
  const plan = swordmasterDamageVisualPlan(abilityId);
  return plan?.kind === 'twin-cut' ? plan : null;
}
