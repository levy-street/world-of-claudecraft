// Spirit-driven mana regeneration, the classic Spirit + "mp5" model.
//
// The out-of-combat side is the long-standing five-second-rule regen (#103): a
// caster who has not spent mana for FIVE_SECOND_RULE_SECONDS regenerates the FULL
// Spirit-based amount every 2-second tick. Historically Spirit did NOTHING while
// the rule was active (mid-fight, casting), so the stat was dead weight in combat.
// WoW's answer was the "mana per 5 sec" (mp5) stat and the Meditation talent: a
// share of Spirit regen that keeps flowing even while casting. This module folds
// that idea into the base stat: while the five-second rule is active, Spirit still
// regenerates COMBAT_SPIRIT_REGEN_FRACTION of its full amount, so Spirit is worth
// something in combat.
//
// Pure leaf: no SimContext, no rng, no DOM, no Math.random/Date.now. It is the
// SINGLE source of the Spirit regen formula, imported by combat/auras.ts
// (updateRegen, the sim tick), src/sim/social/chat_readouts.ts (the /manaregen
// readout), and the character-sheet stat tooltip (src/ui/stat_tooltip.ts). Unit
// tested directly in tests/mana_regen.test.ts.

// Seconds a caster must go without spending mana before the five-second rule lifts
// and full Spirit regen resumes. Named here so the tick, the readout, and the
// tooltip cannot disagree on the threshold.
export const FIVE_SECOND_RULE_SECONDS = 5;

// While the five-second rule is active (casting / in combat), Spirit still
// regenerates this fraction of its full out-of-combat amount, the "mp5"/Meditation
// share. 0 reproduces the old behavior (Spirit dead in combat); 1 would remove the
// rule entirely. Set to the classic max-Meditation value (30%): enough that Spirit
// clearly matters in a fight, while out-of-combat drinking stays meaningfully faster
// and the mana economy still bites (a caster nuking flat out still runs dry).
export const COMBAT_SPIRIT_REGEN_FRACTION = 0.3;

/** Full Spirit-based mana restored per 2-second regen tick, out of combat. Mirrors
 *  the historical inline formula in updateRegen: a Spirit term, a flat floor, and a
 *  small per-level floor so low-Spirit casters still recover at a reasonable pace.
 *  `manaRegenPct` is the summed additive bonus from talents/effects
 *  (playerMods.global.manaRegenPct); pass 0 where it does not apply. Not rounded:
 *  callers round the amount they actually apply. */
export function spiritRegenPer2s(spi: number, level: number, manaRegenPct: number): number {
  return (spi / 3 + 4 + Math.floor(level / 5)) * (1 + manaRegenPct);
}

/** Mana restored this 2-second tick, rounded as the engine applies it. Out of
 *  combat (five-second rule elapsed) it is the full Spirit regen; in combat (rule
 *  still active) it is COMBAT_SPIRIT_REGEN_FRACTION of the full amount. `fiveSecondRule`
 *  is Entity.fiveSecondRule: the seconds since the player last spent mana. */
export function manaRegenPer2s(
  spi: number,
  level: number,
  manaRegenPct: number,
  fiveSecondRule: number,
): number {
  const full = spiritRegenPer2s(spi, level, manaRegenPct);
  const inCombat = fiveSecondRule < FIVE_SECOND_RULE_SECONDS;
  return Math.round(inCombat ? full * COMBAT_SPIRIT_REGEN_FRACTION : full);
}
