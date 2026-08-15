import { describe, expect, it } from 'vitest';
import { TOOL_EFFECT_IDS, TOOL_EFFECTS } from '../src/sim/content/professions';
import type { MaterialRarity } from '../src/sim/professions/gathering';
import {
  applyToolEffectUse,
  depleteEffect,
  RARITY_DURABILITY_BONUS,
  RECHARGE_CHARGES_PER_MATERIAL,
  rechargeDiscountFor,
  slotEffect,
  startingDurabilityFor,
} from '../src/sim/professions/tools';

// Effect charge consumption. This file used to pin a PROBABILISTIC curve: a
// slotted effect rolled `Rng.chance` per use at a rate scaled by how far the
// tool's rarity outclassed the target's, and the roll happened even at zero
// durability so the depletion sequence stayed independent of remaining
// charges.
//
// That model could not be wired. The live harvest path draws exactly twice per
// granted harvest and is golden-pinned there, so a depletion roll would have
// been a THIRD draw for every player who owned a slot, and the pinned contract
// would have held only for players who owned none. The rarity intent moved to
// where it costs nothing: rarity now buys CHARGES up front instead of
// discounting a hidden per-use rate.
//
// So the assertions below are about a deterministic ladder and a draw-free
// decrement. The draw-count contract itself is pinned where it can actually be
// observed, against the real harvest path, in tests/gathering.test.ts.
const RARITY_LADDER: readonly MaterialRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

describe('rarity buys charges, and spending one draws nothing', () => {
  it('starting charges are the catalog base plus one rarity step per rung', () => {
    for (const effectId of TOOL_EFFECT_IDS) {
      const base = TOOL_EFFECTS[effectId].startingDurability;
      RARITY_LADDER.forEach((rarity, rung) => {
        expect(startingDurabilityFor(effectId, rarity), `${effectId} at ${rarity}`).toBe(
          base + RARITY_DURABILITY_BONUS * rung,
        );
      });
    }
  });

  it('the ladder is strictly increasing, so a rarer tool is never a downgrade', () => {
    for (const effectId of TOOL_EFFECT_IDS) {
      for (let i = 1; i < RARITY_LADDER.length; i++) {
        expect(
          startingDurabilityFor(effectId, RARITY_LADDER[i]),
          `${effectId}: ${RARITY_LADDER[i]} vs ${RARITY_LADDER[i - 1]}`,
        ).toBeGreaterThan(startingDurabilityFor(effectId, RARITY_LADDER[i - 1]));
      }
    }
    // The step is load-bearing rather than decorative: a zero bonus would
    // satisfy every "is a number" check above while flattening the ladder.
    expect(RARITY_DURABILITY_BONUS).toBeGreaterThan(0);
  });

  it('slotEffect mints at the tool rarity it was given, and defaults to common', () => {
    const epic = slotEffect('gatherers_cache', { toolRarity: 'epic' });
    expect(epic.durability).toBe(startingDurabilityFor('gatherers_cache', 'epic'));
    expect(epic.maxDurability).toBe(epic.durability);
    const defaulted = slotEffect('gatherers_cache');
    expect(defaulted.durability).toBe(startingDurabilityFor('gatherers_cache', 'common'));
    // The default is the BOTTOM of the ladder, not merely some rung: a default
    // of 'epic' would also pass a "has a default" check.
    expect(defaulted.durability).toBeLessThan(epic.durability);
  });

  it('spends exactly one charge per fire, with no rng parameter to spend', () => {
    const slot = slotEffect('gatherers_cache', { toolRarity: 'rare' });
    const start = slot.durability;
    // depleteEffect takes ONE argument. A depletion roll cannot be
    // reintroduced without changing this call, which is the point: the
    // draw-free contract is enforced by the signature, not by discipline.
    expect(depleteEffect.length).toBe(1);
    for (let i = 1; i <= 5; i++) {
      expect(depleteEffect(slot)).toBe(true);
      expect(slot.durability).toBe(start - i);
    }
  });

  it('a depleted slot stops decrementing and reports that it did not', () => {
    const slot = slotEffect('gatherers_cache');
    slot.durability = 1;
    expect(depleteEffect(slot)).toBe(true);
    expect(slot.durability).toBe(0);
    expect(depleteEffect(slot)).toBe(false);
    expect(slot.durability).toBe(0); // never negative
    expect(depleteEffect(undefined)).toBe(false);
  });

  it('an unconfirmed prompt slot applies nothing and changes nothing', () => {
    const slot = slotEffect('gatherers_cache', { confirmMode: 'prompt', toolRarity: 'epic' });
    const before = slot.durability;
    const outcome = { quantity: 2, gradeToolTier: 3 };
    const result = applyToolEffectUse(slot, outcome, false);
    expect(result.applied).toBe(false);
    expect(result.outcome).toEqual(outcome);
    expect(slot.durability).toBe(before);
    // Confirming it fires, so the arm above is a refusal rather than a slot
    // that never worked at all. The apply half never spends (R42): the
    // charge settle lives at the command boundary, against the granted
    // outcome, and is pinned in tests/gather_node_harvest.test.ts.
    const confirmed = applyToolEffectUse(slot, outcome, true);
    expect(confirmed.applied).toBe(true);
    expect(confirmed.outcome.quantity).toBe(outcome.quantity + 1);
    expect(slot.durability).toBe(before);
  });

  it('the recharge scale and discount ladder hold the R39 shape at the leaf', () => {
    // The scale factor is what turns a fill size into a material count; the
    // shipped rungs (20..50 charges) divide into the ruling's stated 2..5
    // band exactly when it is 10. The full behavioral pricing pins (material
    // identity per rung, partial fills, the R30 re-derive) live in
    // tests/professions_tools.test.ts and the command suite; this leaf pin is
    // the constant itself, so a both-sides retune cannot drift silently.
    expect(RECHARGE_CHARGES_PER_MATERIAL).toBe(10);
    const original = slotEffect('gatherers_cache', { craftedBy: 'p1' });
    expect(rechargeDiscountFor(original, 'p1')).toBe(0.5);
    expect(rechargeDiscountFor(original, 'p2')).toBe(1);
    const anonymous = slotEffect('gatherers_cache');
    expect(rechargeDiscountFor(anonymous, 'p1')).toBe(1);
  });
});
