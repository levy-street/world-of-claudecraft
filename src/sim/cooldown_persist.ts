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
//
// Charge-limited abilities (Twinstrike, Double Charge, Frost's second Ice Block)
// ride the `Entity.abilityCharges` recharge model: stored uses plus one running
// recharge timer. Mid-recharge pools are persisted whole (counts + remaining
// recharge) so a relog can neither refill spent charges nor lose banked ones;
// a full pool carries no information and reconstructs lazily on the next cast.

/** One ability's recharge-model charge state (the `Entity.abilityCharges` value
 *  shape): stored uses, the resolved cap, and the running recharge timer. */
export interface AbilityChargeState {
  charges: number;
  maxCharges: number;
  recharge: number;
  rechargeLength: number;
  /** Per-spent-charge parallel timers; absent on legacy saves (converted on
   *  the first recharge tick from the sequential single timer). */
  recharges?: number[];
}

/** Cooldown snapshot stored inside CharacterState (JSONB). All times are remaining
 *  seconds, so they are independent of any particular Sim clock. */
export interface SavedCooldowns {
  /** abilityId -> remaining seconds */
  abilities?: Record<string, number>;
  /** remaining seconds on the shared combat-potion cooldown (#103) */
  potion?: number;
  /** abilityId -> recharge-model charge state. Only mid-recharge pools are
   *  stored (charges < maxCharges); a full pool reconstructs on the next cast. */
  abilityCharges?: Record<string, AbilityChargeState>;
  /** LEGACY (saves written by the retired sequential-recharge `Entity.charges`
   *  Map): abilityId -> spent count + per-charge recharge length. Read once on
   *  load for conversion onto `abilityCharges`; never written by new saves. */
  charges?: Record<string, { spent: number; cdMax: number }>;
}

/** The resolved charge caps a legacy save needs for conversion: the current
 *  max stored uses and recharge length per charge-limited ability id. */
export type LegacyChargeCaps = ReadonlyMap<string, { maxCharges: number; cooldown: number }>;

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

function validChargeState(state: AbilityChargeState): boolean {
  return (
    Number.isInteger(state.charges) &&
    state.charges >= 0 &&
    Number.isInteger(state.maxCharges) &&
    state.maxCharges > state.charges &&
    positive(state.recharge) &&
    positive(state.rechargeLength)
  );
}

/** Snapshot the live cooldown state as remaining-time deltas. Returns undefined when
 *  nothing is on cooldown so a clean character serializes without the field. */
export function serializeCooldowns(
  cooldowns: Map<string, number>,
  potionCooldownUntil: number,
  now: number,
  abilityCharges?: Readonly<Record<string, AbilityChargeState>>,
): SavedCooldowns | undefined {
  const abilities: Record<string, number> = {};
  for (const [id, remaining] of cooldowns) {
    if (positive(remaining)) abilities[id] = remaining;
  }
  const potion = potionCooldownUntil - now;
  const out: SavedCooldowns = {};
  if (Object.keys(abilities).length > 0) out.abilities = abilities;
  if (positive(potion)) out.potion = potion;
  if (abilityCharges) {
    const charges: Record<string, AbilityChargeState> = {};
    for (const [id, state] of Object.entries(abilityCharges)) {
      if (validChargeState(state)) {
        charges[id] = {
          charges: state.charges,
          maxCharges: state.maxCharges,
          recharge: state.recharge,
          rechargeLength: state.rechargeLength,
          ...(state.recharges && state.recharges.length > 0
            ? { recharges: [...state.recharges] }
            : {}),
        };
      }
    }
    if (Object.keys(charges).length > 0) out.abilityCharges = charges;
  }
  return out.abilities || out.potion !== undefined || out.abilityCharges ? out : undefined;
}

/** Convert one legacy `{spent, cdMax}` entry onto the recharge model using the
 *  CURRENT resolved cap. The legacy remaining recharge rode the plain cooldown
 *  entry (already restored into `cooldowns` by the caller). */
function convertLegacyCharge(
  id: string,
  legacy: { spent: number; cdMax: number },
  caps: LegacyChargeCaps,
  cooldowns: Map<string, number>,
): AbilityChargeState | null {
  const cap = caps.get(id);
  if (
    !cap ||
    cap.maxCharges <= 1 ||
    !positive(cap.cooldown) ||
    !cooldowns.has(id) ||
    !Number.isInteger(legacy.spent) ||
    legacy.spent <= 0 ||
    !positive(legacy.cdMax)
  ) {
    return null;
  }
  const spent = Math.min(legacy.spent, cap.maxCharges);
  const remaining = cooldowns.get(id) ?? cap.cooldown;
  return {
    charges: cap.maxCharges - spent,
    maxCharges: cap.maxCharges,
    recharge: Math.min(remaining, cap.cooldown),
    rechargeLength: cap.cooldown,
  };
}

/** Re-anchor a saved snapshot onto a fresh entity's (empty) cooldown map at the
 *  current clock. Mutates `cooldowns` (and, when given, `abilityCharges`) in place
 *  and returns the new `potionCooldownUntil` (the entity default, -1, when none was
 *  saved). Non-finite and non-positive entries are dropped defensively. The
 *  cooldown entry for a charge pool mirrors the recharge timer only while the pool
 *  is EMPTY (the cast gate + action bar contract, see combat/auras.ts updateTimers),
 *  so restoring re-derives that mirror from the restored counts. */
export function applyCooldowns(
  saved: SavedCooldowns | undefined,
  cooldowns: Map<string, number>,
  now: number,
  abilityCharges?: Record<string, AbilityChargeState>,
  legacyChargeCaps?: LegacyChargeCaps,
  isKnownAbility: (id: string) => boolean = () => true,
): number {
  if (!saved) return -1;
  if (saved.abilities) {
    for (const [id, remaining] of Object.entries(saved.abilities)) {
      if (isKnownAbility(id) && positive(remaining)) cooldowns.set(id, remaining);
    }
  }
  if (abilityCharges) {
    if (saved.abilityCharges) {
      for (const [id, state] of Object.entries(saved.abilityCharges)) {
        if (!isKnownAbility(id) || !validChargeState(state)) continue;
        const restored: AbilityChargeState = {
          charges: state.charges,
          maxCharges: state.maxCharges,
          recharge: Math.min(state.recharge, state.rechargeLength),
          rechargeLength: state.rechargeLength,
          // Parallel per-charge timers survive the relog whole; a legacy save
          // without them converts on the first recharge tick (combat/auras.ts).
          ...(state.recharges
            ? {
                recharges: state.recharges
                  .filter((t) => positive(t))
                  .map((t) => Math.min(t, state.rechargeLength))
                  .sort((a, b) => a - b),
              }
            : {}),
        };
        abilityCharges[id] = restored;
        if (restored.charges <= 0) cooldowns.set(id, restored.recharge);
        else cooldowns.delete(id);
      }
    } else if (saved.charges && legacyChargeCaps) {
      for (const [id, legacy] of Object.entries(saved.charges)) {
        if (!isKnownAbility(id)) continue;
        const converted = convertLegacyCharge(id, legacy, legacyChargeCaps, cooldowns);
        if (!converted) continue;
        abilityCharges[id] = converted;
        if (converted.charges > 0) cooldowns.delete(id);
      }
    }
  }
  return positive(saved.potion ?? -1) ? now + (saved.potion as number) : -1;
}
