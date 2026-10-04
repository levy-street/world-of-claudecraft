// Fire and Fly's limited-weapon charges, counted from the plan's arsenal and the run's
// stats alone. A leaf with no imports: the result and the ladder bounds read it without
// pulling in the content tables the plan resolver reads.

/** Limited-weapon charges per run, 0 for none. */
export interface TurretArsenal {
  readonly shockwave: number;
  readonly fragmentation: number;
}

/**
 * The charges a run has been given once `resupplies` resupplies came: the arsenal,
 * plus one per resupply for every weapon the arsenal holds (a weapon it starts
 * without never gets any).
 */
export function turretChargesGiven(
  plan: { readonly arsenal: TurretArsenal },
  resupplies: number,
): TurretArsenal {
  const { arsenal } = plan;
  return {
    shockwave: arsenal.shockwave > 0 ? arsenal.shockwave + resupplies : 0,
    fragmentation: arsenal.fragmentation > 0 ? arsenal.fragmentation + resupplies : 0,
  };
}

/**
 * Limited-weapon charges left: the charges given less the charges spent (the run's
 * `shockwaves` and `frags` stats), so a reader of the view counts them exactly
 * as the engine does, from the plan and the stats it already holds.
 */
export function turretChargesLeft(run: {
  readonly plan: { readonly arsenal: TurretArsenal };
  readonly stats: {
    readonly shockwaves: number;
    readonly frags: number;
    readonly resupplies: number;
  };
}): TurretArsenal {
  const given = turretChargesGiven(run.plan, run.stats.resupplies);
  return {
    shockwave: Math.max(0, given.shockwave - run.stats.shockwaves),
    fragmentation: Math.max(0, given.fragmentation - run.stats.frags),
  };
}
