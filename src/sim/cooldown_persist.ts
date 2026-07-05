// Persisting ability cooldowns across save/load.
//
// An Entity's `cooldowns` map holds REMAINING seconds per ability (decremented by
// DT each tick in combat/auras.ts), and `potionCooldownUntil` is an ABSOLUTE
// sim-time. Neither used to be serialized, so a logout dropped them and a relog
// reset every cooldown, letting a player bypass long cooldowns (Sprint, Shield
// Wall, the shared combat-potion timer) by reconnecting.
//
// The sim is clock-agnostic (no Date.now), so we persist REMAINING-time deltas, not
// wall-clock expiry: cooldowns freeze for the duration of the logout and resume on
// load. That fully removes the reset exploit while staying deterministic. (Hours-long
// raid lockouts keep their own absolute-ms scheme; short combat cooldowns do not need
// real-time decay.) This is a pure leaf so a Vitest drives it without a live Sim.

/** Cooldown snapshot stored inside CharacterState (JSONB). All times are remaining
 *  seconds, so they are independent of any particular Sim clock. */
export interface SavedCooldowns {
  /** abilityId -> remaining seconds */
  abilities?: Record<string, number>;
  /** remaining seconds on the shared combat-potion cooldown (#103) */
  potion?: number;
}

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Snapshot the live cooldown state as remaining-time deltas. Returns undefined when
 *  nothing is on cooldown so a clean character serializes without the field. */
export function serializeCooldowns(
  cooldowns: Map<string, number>,
  potionCooldownUntil: number,
  now: number,
): SavedCooldowns | undefined {
  const abilities: Record<string, number> = {};
  for (const [id, remaining] of cooldowns) {
    if (positive(remaining)) abilities[id] = remaining;
  }
  const potion = potionCooldownUntil - now;
  const out: SavedCooldowns = {};
  if (Object.keys(abilities).length > 0) out.abilities = abilities;
  if (positive(potion)) out.potion = potion;
  return out.abilities || out.potion !== undefined ? out : undefined;
}

/** Re-anchor a saved snapshot onto a fresh entity's (empty) cooldown map at the
 *  current clock. Mutates `cooldowns` in place and returns the new
 *  `potionCooldownUntil` (the entity default, -1, when none was saved). Non-finite
 *  and non-positive entries are dropped defensively. */
export function applyCooldowns(
  saved: SavedCooldowns | undefined,
  cooldowns: Map<string, number>,
  now: number,
): number {
  if (!saved) return -1;
  if (saved.abilities) {
    for (const [id, remaining] of Object.entries(saved.abilities)) {
      if (positive(remaining)) cooldowns.set(id, remaining);
    }
  }
  return positive(saved.potion ?? -1) ? now + (saved.potion as number) : -1;
}
