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
// whether a harvested/crafted copy gets signed at all) can ever trickle. The
// rarity read is the instance's legacy rolled.quality when present, else the
// item DEF's static quality: Phase 2 deterministic crafts sign rare-plus-def
// outputs without writing rolled.quality, so the def fallback is what keeps
// the trickle alive for new crafted instances (legacy signed instances keep
// their old rolled.quality read).
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
import { ITEMS } from '../data';
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
  // The observer's active archetype (#1129/#1203: professions/archetype.ts
  // `archetypeStateFor`), or null before the acceptance quest. Threads the
  // manifesto's "active specialty only" gate below.
  observerActiveArchetype: string | null;
  // The observer's second major, ring-adjacent to `observerActiveArchetype`
  // (archetype.ts `pairedMajor`), or null/omitted exactly when that is. Under
  // #1129's actual pair model BOTH majors are the active specialty, so this
  // gate checks either, not just the title-quest craft. Optional (defaults to
  // null) so a pre-pair-model caller that only tracks the single title craft
  // still compiles and behaves exactly as it did before the pair model.
  observerPairedMajor?: string | null;
}

/** Resolve one Battlefield Experience observation into a skill-progress
 *  trickle applied to the signer's craft skill for whatever craft produced
 *  the observed item, self-observation only. Returns the amount actually
 *  granted (0 for every short-circuit below, i.e. a genuine no-op):
 *  - no instance payload (a plain fungible item was never signed): 0.
 *  - rarity (the instance's legacy rolled.quality, else the item def's
 *    static quality: see the module comment) is common/uncommon or
 *    unresolvable: 0, checked FIRST and cheaply, before any attribution
 *    work, per the issue's rare-tier gate.
 *  - the instance was not signed by the observer (someone else's item, or a
 *    bystander/party case): 0. Party/raid weighting for that case is a later
 *    issue; this PR never grants anything but the self-observation trickle.
 *  - the item was not produced by any known recipe (no craft to attribute
 *    to, e.g. a non-crafted drop that was somehow signed): 0.
 *  - the recipe's craft is not the observer's active archetype (the
 *    manifesto's anti alt/breadth lever, see the gate comment below): 0.
 *  Only ever mutates skill via gainCraftSkill (never a drain primitive). */
export function battlefieldExperienceTrickle(
  craftSkills: CraftSkills,
  observation: BattlefieldXpObservation,
): number {
  const {
    itemId,
    instance,
    observerName,
    observerActiveArchetype,
    observerPairedMajor = null,
  } = observation;
  // Phase 2 deterministic crafts no longer write rolled.quality, so a new
  // rare-plus-def crafted instance reads its def quality here; a legacy
  // instance's own rolled.quality still wins when present.
  const rarity = (instance?.rolled?.quality ?? ITEMS[itemId]?.quality) as
    | MaterialRarity
    | undefined;
  if (!rarity || !isSignableMaterialRarity(rarity)) return 0;
  if (!instance?.signer || instance.signer !== observerName) return 0;
  const recipe = recipeForResultItem(itemId);
  if (!recipe) return 0;
  // #1149/#1205 "active specialty only" gate: the manifesto scopes
  // Battlefield Experience to the observer's ACTIVE specialty only ("a potion
  // drunk or meal eaten feeds nothing unless alchemy or cooking is your
  // specialty"), the anti alt/breadth lever. This is deliberately a narrower,
  // BINARY "is this THE specialty" check, not the three-tier common/rare/
  // unlimited ceiling `craftCeiling` (archetype.ts) composes for ordinary
  // crafting: no archetype set, or the recipe's craft is neither of the
  // observer's two majors (including their hobby, which is NOT a major),
  // grants nothing here. Under #1129's pair model the active specialty is
  // BOTH majors, so either match qualifies.
  const isActiveSpecialty =
    recipe.professionId === observerActiveArchetype || recipe.professionId === observerPairedMajor;
  if (!isActiveSpecialty) return 0;
  gainCraftSkill(craftSkills, recipe.professionId, BATTLEFIELD_XP_TRICKLE);
  return BATTLEFIELD_XP_TRICKLE;
}
