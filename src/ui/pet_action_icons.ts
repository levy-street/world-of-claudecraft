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
  feed: 'pet_feed', // hunter: feed food to heal the pet (not magic)
  healDemon: 'pet_mend', // warlock: mend the demon
  passive: 'pet_passive',
  defensive: 'pet_defensive',
  aggressive: 'pet_aggressive',
} as const;

export type PetActionIconKey = keyof typeof PET_ACTION_ICONS;
