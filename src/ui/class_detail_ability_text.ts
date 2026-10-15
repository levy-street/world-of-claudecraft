// The resolved description prose for one signature ability on the character-select
// class-detail panel.
//
// Extracted from main.ts (the monolith ratchet; main.ts is a firewall, not a home):
// the text depends on the authored AbilityDef alone, never on bootstrap state, so it
// is a pure sibling module the panel painter consumes and a vitest drives directly.
// It reuses the HUD tooltip's formatter instead of keeping a second placeholder
// filler: the panel's own copy filled only {damage} (Polymorph showed a raw
// {duration}, Life Tap printed blank amounts) and formatted any absorb from its raw
// `amount`, which reads 0% for a max-health shield (Ward of Faith, Iron Resolve).

import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef } from '../sim/types';
import { abilityDisplayDescription, abilityEffectText } from './ability_description';

/** The rank-1, talent-free view of `def`: what a character that has just learned
 *  it knows, built the same way abilitiesKnownAt resolves the base rank. */
function classDetailResolvedAbility(def: AbilityDef): ResolvedAbility {
  return {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: def.threat?.flat ?? 0,
    threatMult: def.threat?.mult ?? 1,
    bonusCharges: def.maxCharges === undefined ? 0 : Math.max(0, def.maxCharges - 1),
    ...(def.maxCharges === undefined ? {} : { charges: def.maxCharges }),
  };
}

/** The class-detail panel's description for `def`: every placeholder resolved at
 *  rank 1 through the HUD spellbook tooltip's formatter, talent-free and without
 *  Spell Power (a spec-locked ability reads its unspecced base values). */
export function classDetailAbilityDescription(def: AbilityDef): string {
  const res = classDetailResolvedAbility(def);
  return abilityDisplayDescription(res, abilityEffectText(res));
}
