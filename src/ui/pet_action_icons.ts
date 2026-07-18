// Dedicated icon ids for the pet action bar.
//
// The pet bar renders each button with `iconDataUrl('ability', id)`, which returns a
// class ability's real art whenever `id` is an ability id. Reusing ability ids here
// (rejuvenation, defensive_stance, rapid_fire, growl, prowl, drain_life) made the pet
// buttons borrow other classes' spell art, so a hunter's "aggressive" stance rendered
// the SAME icon as their own Rapid Fire, and "Heal Pet" showed the druid's green magic
// heal. These ids are deliberately NOT ability ids; each has its own recipe in
// `icons.ts` (`ABILITY_RECIPES`). Guarded by `tests/pet_action_icons.test.ts`.
export const PET_ACTION_ICONS = {
  attack: 'pet_attack',
  taunt: 'pet_growl',
  waterJet: 'pet_water_jet',
  feed: 'pet_feed', // hunter: feed food to heal the pet (not magic)
  healDemon: 'pet_mend', // warlock: mend the demon
  passive: 'pet_passive',
  defensive: 'pet_defensive',
  aggressive: 'pet_aggressive',
} as const;

export type PetActionIconKey = keyof typeof PET_ACTION_ICONS;

// Pure decision for the hunter Feed Pet button's disabled state. Previously
// the button always looked identically clickable, but clicking it with no
// eligible food just popped an error toast, and there was no way to tell in
// advance the pet did not need feeding at all: the button "looked broken"
// instead of explaining itself. This keeps the button ALWAYS visible while
// the pet is summoned (never hidden), greyed out with a reason tooltip when
// it cannot currently be used.
export type PetFeedDisabledReasonKey =
  | 'hudChrome.petFeed.disabledFullHp'
  | 'hudChrome.petFeed.disabledNoFood';

export interface PetFeedButtonState {
  disabled: boolean;
  reasonKey: PetFeedDisabledReasonKey | null;
}

/**
 * `petHp`/`petMaxHp`: the summoned pet's current/max HP. `hasFood`: true when
 * the player's bags hold at least one stack of eligible (healing) food.
 * Pet full HP is checked first: even with food on hand, there is nothing to
 * heal, so that reason takes priority over "no food".
 */
export function petFeedButtonState(
  petHp: number,
  petMaxHp: number,
  hasFood: boolean,
): PetFeedButtonState {
  if (petMaxHp > 0 && petHp >= petMaxHp) {
    return { disabled: true, reasonKey: 'hudChrome.petFeed.disabledFullHp' };
  }
  if (!hasFood) {
    return { disabled: true, reasonKey: 'hudChrome.petFeed.disabledNoFood' };
  }
  return { disabled: false, reasonKey: null };
}
