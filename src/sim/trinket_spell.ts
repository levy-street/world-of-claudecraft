// The Trinket spell's grant and its target (content/trinket_spell.ts). Every
// character knows the spell, outside every class kit, so it is appended to the
// known list at the two presentation seams (progression/known_abilities.ts for
// the sim, net/ability_presentation.ts for the client mirror) and wherever a
// mode rebuilds the list by hand. Appended after the class kit: known order is
// the RL action slot order, and the kit's slots must not shift.
//
// trinketSpellItemId is the one answer to "what does a press use?", shared by
// the sim cast (combat/trinkets.ts castTrinketSpell) and the action bar
// (src/ui/hud/action_bar/trinket_spell_core.ts), so the button never shows a
// trinket a press would not use.

import type { KnownAbility } from './content/classes';
import { TRINKET_SPELL, TRINKET_SPELL_ID } from './content/trinket_spell';
import { trinketSpec } from './content/trinkets';

/** `known` with the Trinket spell on the end, exactly once. */
export function withTrinketSpell(known: KnownAbility[]): KnownAbility[] {
  const result = known.filter((ability) => ability.def.id !== TRINKET_SPELL_ID);
  result.push({
    def: TRINKET_SPELL,
    rank: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    effects: [],
    threatFlat: 0,
    threatMult: 1,
  });
  return result;
}

/** The worn trinket a Trinket spell press uses, or null when the trinket slot
 *  is empty or holds a plain stat trinket (no TRINKET_SPECS entry). A trinket
 *  that only works on its own still counts: the button shows it, and a press
 *  answers the way clicking that trinket does. */
export function trinketSpellItemId(wornTrinketId: string | null | undefined): string | null {
  return wornTrinketId && trinketSpec(wornTrinketId) ? wornTrinketId : null;
}
