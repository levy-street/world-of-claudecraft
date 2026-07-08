// Battlefield Experience (issue #1149, professions epic #1152): a small
// adventuring-xp trickle to the CRAFT that produced an item, granted when
// that specific item instance is observed in a tracked combat/loot moment
// (a potion drunk, a killing blow landed, armor worn at a kill). This module
// resolves exactly the SELF-OBSERVATION case per the issue's own spec: the
// wielder/user of the item is also the crafter who signed it. That is the
// simplest slice and needs no radius/party logic at all, just the per-item
// attribution below; party/raid observation-scope weighting (a grouped
// member or bystander in the ~90 yd player interest radius, INTEREST_RADIUS,
// also earning a partial trickle) is a later, separate issue, not resolved
// here.
//
// Gate (per the issue's rare-tier requirement): common/uncommon instances
// short-circuit to zero trickle before any other work, as a single cheap
// comparison at the top of the handler. Only a rare-or-better instance
// (isSignableMaterialRarity, the same threshold #1145 already uses to decide
// whether a harvested/crafted copy gets signed at all) can ever trickle.
//
// Additive-only by construction: the only skill-mutating call this module
// ever makes is gainCraftSkill (professions/wheel.ts), the exact same
// primitive ordinary crafting xp uses (see crafting.ts's CRAFT_SKILL_GAIN).
// There is no drain/subtract primitive in this file, and none is imported:
// the "never reduces any craft's skill" acceptance criterion holds
// structurally (by the absence of a drain call), not by a runtime check that
// a future edit could quietly violate.
//
// The "original crafter benefits most on later improving that same item"
// requirement is satisfied for free by signer-based attribution: a later
// re-craft simply re-signs the instance (crafting.ts), so the credited
// crafter always tracks whoever signed the CURRENT copy. No separate
// per-item tracking table exists or is needed.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/
// game/net imports, no Math.random/Date.now, host-agnostic so it runs
// offline, on the server, and in the headless RL env unchanged. It draws no
// rng at all (attribution and the rarity gate are pure lookups).

import { recipeForResultItem } from '../content/recipes';
import { isSignableMaterialRarity, type MaterialRarity } from './gathering';
import type { CraftSkills } from './wheel';
import { gainCraftSkill } from './wheel';

// A small trickle: deliberately much smaller than the flat point ordinary
// crafting grants per craft (crafting.ts's CRAFT_SKILL_GAIN = 1), since this
// channel is a passive bonus off USING gear, not the crafting action itself.
export const BATTLEFIELD_XP_TRICKLE = 0.25;

// The subset of ItemInstancePayload this module actually reads. Kept narrow
// (rather than importing the full ItemInstancePayload) so a caller can pass
// exactly what it has resolved off an inventory/equipment slot without
// needing to thread the whole payload shape through every call site.
export interface BattlefieldXpInstance {
  signer?: string;
  rolled?: { quality?: string };
}

/** One observed tracked event a caller may report: which item instance was
 *  involved (drunk, delivered the killing blow, or was worn at a kill) and
 *  who observed it. Self-observation only in this PR: `observerName` is
 *  compared against `instance.signer` with no radius/party weighting. */
export interface BattlefieldXpObservation {
  itemId: string;
  instance: BattlefieldXpInstance | undefined;
  observerName: string;
}

/** Resolve one Battlefield Experience observation into a skill-progress
 *  trickle applied to the signer's craft skill for whatever craft produced
 *  the observed item, self-observation only. Returns the amount actually
 *  granted (0 for every short-circuit below, i.e. a genuine no-op):
 *  - no instance payload (a plain fungible item was never signed): 0.
 *  - instance rarity is common/uncommon (or unrolled): 0, checked FIRST and
 *    cheaply, before any attribution work, per the issue's rare-tier gate.
 *  - the instance was not signed by the observer (someone else's item, or a
 *    bystander/party case): 0. Party/raid weighting for that case is a later
 *    issue; this PR never grants anything but the self-observation trickle.
 *  - the item was not produced by any known recipe (no craft to attribute
 *    to, e.g. a non-crafted drop that was somehow signed): 0.
 *  Only ever mutates skill via gainCraftSkill (never a drain primitive). */
export function battlefieldExperienceTrickle(
  craftSkills: CraftSkills,
  observation: BattlefieldXpObservation,
): number {
  const { itemId, instance, observerName } = observation;
  const rarity = instance?.rolled?.quality as MaterialRarity | undefined;
  if (!rarity || !isSignableMaterialRarity(rarity)) return 0;
  if (!instance?.signer || instance.signer !== observerName) return 0;
  const recipe = recipeForResultItem(itemId);
  if (!recipe) return 0;
  // TODO(#1149/#1205): the manifesto scopes Battlefield Experience to the
  // observer's ACTIVE archetype/specialty only ("a potion drunk or meal
  // eaten feeds nothing unless alchemy or cooking is your specialty"), the
  // anti alt/breadth lever. That active-specialty state lives on #1205's
  // branch and is not available here; whichever of this module / #1205
  // merges second must add a gate here (recipe.professionId must be one of
  // the observer's currently-active/empowered crafts) before this trickle
  // fires for a non-specialty craft. Not gating today is a known gap, not a
  // design decision: no such gate exists ANYWHERE in this stack yet.
  gainCraftSkill(craftSkills, recipe.professionId, BATTLEFIELD_XP_TRICKLE);
  return BATTLEFIELD_XP_TRICKLE;
}
