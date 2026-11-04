import { ABILITIES, ITEMS } from '../../src/sim/data';
import { itemActionSource } from './ability_access';
import { abilityHover } from './ability_hover';
import { itemHover } from './item_hover';

/** Key by the reserved article title so that a display-name collision never opens the wrong card. */
export function tooltipCatalog(titles: {
  item: Map<string, string>;
  ability: Map<string, string>;
}) {
  const cards: Record<string, string> = Object.create(null);
  for (const [id, title] of titles.item) cards[title] = itemHover(ITEMS[id]);
  for (const [id, title] of titles.ability) {
    const def = ABILITIES[id];
    const item = itemActionSource(def);
    cards[title] = item ? cards[titles.item.get(item.id)!] : abilityHover(def);
  }
  return cards;
}
