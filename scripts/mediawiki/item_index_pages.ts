import { ITEMS } from '../../src/sim/data';
import type { ItemDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { browseTable, gearFamily, itemTypeName } from './item_browse_table';
import type { GearItem } from './item_tables';

// Writes one browse page and, when it is useful, the narrower pages under it. A page
// splits by its first level always when that level says so (a quality into weapons,
// armor, jewelry and other items), and by any level when its table would be too long.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link'> & {
  reserve(title: string): string;
};
export interface SplitLevel {
  heading: string;
  /** The group an item goes in. */
  key(item: ItemDef): string;
  /** The page label for one group. */
  label(key: string): string;
  /** Group order; groups not named sort after, by name. */
  order?: string[];
  /** Split even when the table fits on one page. */
  always?: boolean;
}

/** Tables longer than this are split into the narrower pages instead of shown whole. */
export const TABLE_LIMIT = 300;

const FAMILY_ORDER = ['weapons', 'armor', 'jewelry', 'other'];

const FAMILY_PHRASE: Record<string, string> = {
  weapons: 'weapons',
  armor: 'armor and off-hands',
  jewelry: 'jewelry',
  other: 'other items',
};
// Armor types read "mail armor"; off-hand groups are already plural nouns.
const typePhrase = (type: string) =>
  ['Cloth', 'Leather', 'Mail', 'Plate', 'Other'].includes(type)
    ? type.toLowerCase() + ' armor'
    : type.toLowerCase();

/**
 * Splits by weapons, armor and off-hands, jewelry and other items, then (only when a
 * table is still too long) by type. `name` turns a phrase such as "jewelry" into a label.
 */
export function familyLevels(name: (phrase: string) => string, always: boolean): SplitLevel[] {
  return [
    {
      heading: 'By kind of item',
      key: gearFamily,
      label: (key) => name(FAMILY_PHRASE[key]),
      order: FAMILY_ORDER,
      always,
    },
    {
      heading: 'By type',
      key: (item) => itemTypeName(item) || 'Other',
      label: (key) => name(typePhrase(key)),
    },
  ];
}

export function writeIndexPage(
  w: Writer,
  page: { title: string; label: string; lead: string },
  parent: { title: string; label: string },
  items: GearItem[],
  levels: SplitLevel[],
): void {
  const children: string[] = [];
  let heading = '';
  for (let i = 0; i < levels.length && !children.length; i++) {
    const level = levels[i];
    if (!level.always && items.length <= TABLE_LIMIT) continue;
    const groups = new Map<string, GearItem[]>();
    for (const e of items) {
      const key = level.key(ITEMS[e.id]);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    if (groups.size < 2) continue;
    const rank = (key: string) => {
      const at = level.order?.indexOf(key) ?? -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    heading = level.heading;
    for (const [key, members] of [...groups].sort(
      ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'en'),
    )) {
      const label = level.label(key);
      const title = w.reserve(label + ' (Items index)');
      writeIndexPage(
        w,
        { title, label, lead: '' },
        { title: page.title, label: page.label.charAt(0).toLowerCase() + page.label.slice(1) },
        members,
        levels.slice(i + 1),
      );
      children.push(w.link(title, label) + ' (' + members.length + ')');
    }
  }
  const whole = items.length <= TABLE_LIMIT || !children.length;
  w.add(
    page.title,
    w.link(parent.title, 'Back to ' + parent.label) +
      '\n\n' +
      (page.lead ? page.lead + '\n\n' : '') +
      (children.length ? w.section(heading, w.bullets(children)) : '') +
      (whole
        ? w.section(
            'Item table',
            'Select a column heading to sort. Use the filters above the table to show only items with the stats you want.\n\n' +
              browseTable(items),
          )
        : w.section(
            'Item table',
            'There are ' +
              items.length +
              ' items here, too many for one table. Open one of the lists above to see a table you can sort and filter.',
          )),
    ['Portals'],
  );
}
