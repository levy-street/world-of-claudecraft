// Which hotbar buttons a WATCHED proc lights up.
//
// The action bar already paints a proc glow (action_bar_view's `procGlow`), but it
// is a hand-curated OR of per-class predicates plus the generic `requiresAuraKind`
// window. Neither knows anything about the spells a player picked in the Auras
// panel, so a watched proc could light a ground ring, a crescent and a sound while
// the bar stayed dark. This core closes that gap and nothing else: it never
// suppresses an existing glow, it only contributes more ids to light.
//
// Pure: no DOM, no world access. The controller supplies the live rows.

/** One watched proc's contribution, as the controller knows it. */
export interface ReadyGlowSignal {
  /** The ability whose button represents this proc (the overlay's iconAbilityId). */
  abilityId: string;
  /** Whether the proc's aura is up right now. */
  active: boolean;
  /** Whether the player chose the hotbar channel for this proc. */
  enabled: boolean;
}

/**
 * The ability ids to glow this frame. Returns a REUSED set so a steady frame
 * allocates nothing; callers must read it before the next tick rather than
 * retaining it.
 */
export function createReadyGlowPlan(): {
  tick(signals: readonly ReadyGlowSignal[]): ReadonlySet<string>;
} {
  const ids = new Set<string>();
  return {
    tick(signals) {
      ids.clear();
      for (const signal of signals) {
        if (signal.enabled && signal.active && signal.abilityId) ids.add(signal.abilityId);
      }
      return ids;
    },
  };
}

/** One-shot form, for callers with no per-frame budget (tests, cold paths). */
export function readyGlowAbilityIds(signals: readonly ReadyGlowSignal[]): ReadonlySet<string> {
  return createReadyGlowPlan().tick(signals);
}
