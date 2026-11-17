// What the Trinket spell (src/sim/content/trinket_spell.ts) shows wherever an
// ability is drawn: the trinket a press would use (src/sim/trinket_spell.ts
// trinketSpellItemId, the same answer the sim cast reads), so the button, its
// tooltip and the spellbook row take that trinket's icon, name and cooldown and
// change the moment a different trinket is equipped. Null for every other
// ability, and for the Trinket spell while nothing usable is worn, when the
// spell's own icon and description stand in.
//
// Pure and allocation-free (the action bar asks once per slot per frame);
// registered in tests/architecture.test.ts UI_PURE_CORES and driven directly by
// tests/trinket_spell_core.test.ts.

import { TRINKET_SPELL_ID } from '../../../sim/content/trinket_spell';
import { ITEMS } from '../../../sim/data';
import { trinketSpellItemId } from '../../../sim/trinket_spell';
import type { ItemDef } from '../../../sim/types';

/** The worn trinket an ability presents as, or null when it presents as itself. */
export function trinketSpellItem(
  abilityId: string | null | undefined,
  wornTrinketId: string | null | undefined,
): ItemDef | null {
  if (abilityId !== TRINKET_SPELL_ID) return null;
  const itemId = trinketSpellItemId(wornTrinketId);
  return itemId ? (ITEMS[itemId] ?? null) : null;
}
