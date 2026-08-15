// Auto-acquire on cast with no target (issue #2787): when a player casts an
// offensive, target-requiring ability while nothing is targeted at all, the
// sim picks the nearest mob that is already attacking them instead of just
// erroring "You have no target." A cluttered pull with several mobs (some
// already dead corpses) makes re-selecting the one live attacker fiddly by
// hand, so casting into the fight should just work.
//
// Priority: nearest attacker; ties break on facing (the mob more nearly in
// front of the player wins over one behind at the same range), then entity
// id, so the pick is fully deterministic and replay-safe.
//
// Pure leaf, same shape as tab_target.ts/dead_target.ts: the caller
// (casting_lifecycle.ts) builds the candidate list from live sim state
// (Entity.aggroTargetId, "this mob is currently attacking me"); this file
// only ranks it, so a Vitest exercises the selection rule with no
// SimContext. src/sim-pure (no DOM/Three/rng), enforced by
// tests/architecture.test.ts.

export interface AttackerCandidate {
  id: number;
  /** Planar distance to the player, in yards. */
  d: number;
  /** abs(angle between the player's facing and the direction to this mob), radians. */
  facingDiff: number;
}

/** Nearest candidate id, tie-broken by facing then id; null when the list is empty. */
export function nearestAttackerId(candidates: readonly AttackerCandidate[]): number | null {
  let best: AttackerCandidate | null = null;
  for (const c of candidates) {
    if (
      !best ||
      c.d < best.d ||
      (c.d === best.d &&
        (c.facingDiff < best.facingDiff || (c.facingDiff === best.facingDiff && c.id < best.id)))
    ) {
      best = c;
    }
  }
  return best?.id ?? null;
}
