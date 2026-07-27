import { PROCEDURAL_LEGENDARY_POWERS } from './content/procedural_legendary_powers';
import { PROCEDURAL_AFFIXES } from './content/procedural_loot/affixes';
import type { ItemDef, ItemInstancePayload } from './types';

function rareWord(id: string): string {
  const word = id.replace('procedural.rare.', '');
  return word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word;
}

function affixName(fragmentId: string | undefined): string | undefined {
  if (!fragmentId) return undefined;
  return Object.values(PROCEDURAL_AFFIXES).find(
    (definition) => definition.nameFragmentId === fragmentId,
  )?.displayName;
}

/** English content-side name for server-owned text surfaces such as /bags.
 * Localized UI surfaces use procedural_item_presentation instead. */
export function proceduralItemContentName(
  def: Pick<ItemDef, 'name'>,
  instance?: ItemInstancePayload,
): string {
  const procedural = instance?.procedural;
  if (!procedural) return def.name;
  if (procedural.legendaryPowerId) {
    const power =
      PROCEDURAL_LEGENDARY_POWERS[
        procedural.legendaryPowerId as keyof typeof PROCEDURAL_LEGENDARY_POWERS
      ];
    if (power) return power.name;
  }
  if (procedural.generatedName.rareWordIds) {
    return procedural.generatedName.rareWordIds.map(rareWord).join(' ');
  }
  return [
    affixName(procedural.generatedName.prefixId),
    def.name,
    affixName(procedural.generatedName.suffixId),
  ]
    .filter(Boolean)
    .join(' ');
}
