import type { AbilityDef } from '../types';

// Trinket: the class-neutral ability every character knows. It carries no
// effects of its own: castAbility hands it to the trinket system
// (src/sim/combat/trinkets.ts castTrinketSpell) before any cast-path rule runs,
// so a press is exactly a click on the trinket the player wears, with that
// trinket's own gates and cooldown and no global cooldown. On the action bar it
// borrows the worn trinket's icon, tooltip and cooldown
// (src/ui/hud/action_bar/trinket_spell_core.ts), so swapping trinkets never
// needs the bar rearranged. `class` is a placeholder, like the Courier's: the
// grant lives outside every class kit (src/sim/trinket_spell.ts).
export const TRINKET_SPELL_ID = 'use_trinket';

export const TRINKET_SPELL: AbilityDef = {
  id: TRINKET_SPELL_ID,
  name: 'Trinket',
  class: 'warrior',
  learnLevel: 1,
  cost: 0,
  castTime: 0,
  cooldown: 0,
  range: 0,
  school: 'physical',
  requiresTarget: false,
  offGcd: true,
  effects: [],
  description:
    "Use the trinket you are wearing. This button takes that trinket's icon, effect and cooldown, and changes when you equip a different trinket. It does nothing while you wear no trinket, or one with no use effect.",
};
