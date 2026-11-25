import { canEquipItem } from '../../src/sim/equipment_rules';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../../src/sim/types';
import { requiredClassesForTooltip } from '../../src/ui/item_class_restriction';
import { type ArticleTools, ref } from './entity_format';
import type { RoutePoint } from './quest_map';
import { wikiArmorTypeName } from './wiki_item_kind';

export interface ItemAcquisition {
  title: string;
  steps: string[];
  details?: string[];
  points?: RoutePoint[];
}

export function addAcquisition(
  index: Map<string, ItemAcquisition[]>,
  id: string,
  source: ItemAcquisition,
) {
  const sources = index.get(id) ?? [];
  sources.push(source);
  index.set(id, sources);
}

/**
 * The `requiredClass` list on an item means two different things in the game.
 *
 * For shields, orbs, tomes, quivers, class-locked sets and weapons it is the real rule:
 * `canEquipItem` (src/sim/equipment_rules.ts) lets only those classes equip it.
 * For ordinary cloth, leather, mail and plate armor `canEquipItem` ignores it and
 * lets every class that can wear the armor type equip the piece. There the list only
 * says who the piece is meant for (loot targeting, Emissary's Cache, and the class
 * lock on soulbound drops in src/sim/loot/class_locked_drop.ts).
 *
 * `requiredClassesForTooltip` (the in-game tooltip) already makes this split, so
 * the wiki reuses it. Returns null when the item names no classes.
 */
export function classUseNote(w: ArticleTools, item: ItemDef): string | null {
  const meant = item.requiredClass;
  if (!meant?.length) return null;
  const list = (cs: readonly PlayerClass[]) => cs.map((c) => ref(w, 'class', c)).join(', ');
  const enforced = requiredClassesForTooltip(item);
  if (enforced) return 'Only these classes can use it: ' + list(enforced) + '.';
  const canEquip = ALL_CLASSES.filter((c) => canEquipItem(c, item));
  const extra = canEquip.filter((c) => !meant.includes(c));
  if (!extra.length) return 'Only these classes can use it: ' + list(canEquip) + '.';
  const wear = item.kind === 'armor' && item.armorType ? wikiArmorTypeName(item.armorType) : 'this';
  return (
    'This piece is made for these classes: ' +
    list(meant) +
    '. It is not locked to them. ' +
    (canEquip.length === ALL_CLASSES.length
      ? 'Every class can wear ' + wear + ' armor, so every class can equip it.'
      : 'Every class that can wear ' + wear + ' armor can equip it: ' + list(canEquip) + '.')
  );
}
