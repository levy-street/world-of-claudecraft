import { ITEM_SETS, ITEMS } from '../../src/sim/data';
import type { ItemSet } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { instanceLoot } from './instance_loot';
import { itemTypeName } from './item_browse_table';
import {
  itemSourceGroups,
  SOURCE_ORDER,
  type SourceGroup,
  type SourceWriter,
} from './item_source_groups';

// Equipment sets grouped by where their pieces come from: the dungeon or raid that
// drops most of them, or else the most common way to get a piece (a vendor, a craft,
// the Crucible sigil exchange). The A to Z list stays on the Equipment sets page.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  usedTitles?: Set<string>;
};
export interface SetEntry {
  set: ItemSet;
  pieces: string[];
  /** The armor type most pieces share, such as Mail. */
  type: string;
}

const mostCommon = <T>(values: T[], rank: (v: T) => number = () => 0): T | undefined => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || rank(a) - rank(b))[0]?.[0];
};

/** Group heading to the sets in it. Dungeons and raids come first, in Finder order. */
export function equipmentSetGroups(w: SourceWriter): Map<string, SetEntry[]> {
  const loot = instanceLoot(w);
  const sources = itemSourceGroups(w);
  const groups = new Map<string, SetEntry[]>();
  const order = [...loot.map((l) => l.name), ...SOURCE_ORDER, 'Not available now'];
  // A Heroic copy of a piece counts toward the dungeon its Normal piece drops in.
  const copies = new Map<string, string[]>();
  for (const i of Object.values(ITEMS))
    if (i.heroicOf) copies.set(i.heroicOf, [...(copies.get(i.heroicOf) ?? []), i.id]);
  const family = (id: string) => [id, ...(copies.get(id) ?? [])];
  for (const set of Object.values(ITEM_SETS)) {
    const pieces = Object.values(ITEMS)
      .filter((i) => i.set === set.id && !i.heroicOf)
      .map((i) => i.id);
    const places = pieces.flatMap((id) =>
      loot
        .filter((l) => family(id).some((f) => l.normal.has(f) || l.heroic.has(f)))
        .map((l) => l.name),
    );
    const group =
      mostCommon(places, (v) => order.indexOf(v)) ??
      mostCommon(
        pieces.flatMap((id) => [...(sources.get(id) ?? [])]),
        (v: SourceGroup) => order.indexOf(v),
      ) ??
      'Not available now';
    const entry = {
      set,
      pieces,
      type: mostCommon(pieces.map((id) => itemTypeName(ITEMS[id])).filter(Boolean)) ?? '',
    };
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  return new Map(
    [...groups]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([g, sets]) => [g, sets.sort((a, b) => a.set.name.localeCompare(b.set.name, 'en'))]),
  );
}

const HEADINGS: Partial<Record<string, string>> = {
  'Creature drops': 'Creature drops in the open world',
  Vendors: 'Sold by vendors',
  Crafted: 'Crafted sets',
};

export function writeEquipmentSetGroups(w: Writer, title: string): void {
  const groups = equipmentSetGroups(w);
  const total = [...groups.values()].reduce((n, sets) => n + sets.length, 0);
  const setLink = (set: ItemSet) => {
    const article = set.name + ' (Equipment set)';
    return !w.usedTitles || w.usedTitles.has(article) ? w.link(article, set.name) : set.name;
  };
  const sections = [...groups].map(([group, sets]) =>
    w.section(
      HEADINGS[group] ?? group,
      w.bullets(
        sets.map((e) => {
          const related = e.set.lineage
            ? Object.values(ITEM_SETS).filter(
                (s) => s.lineage === e.set.lineage && s.id !== e.set.id,
              )
            : [];
          return (
            setLink(e.set) +
            ' · ' +
            e.pieces.length +
            (e.pieces.length === 1 ? ' piece' : ' pieces') +
            (e.type ? ' · ' + e.type : '') +
            ' · Bonuses at ' +
            e.set.bonuses.map((b) => b.pieces).join(', ') +
            ' pieces' +
            (related.length
              ? '. Its pieces count toward the same bonuses as ' +
                related.map((s) => s.name).join(', ')
              : '')
          );
        }),
      ),
    ),
  );
  w.add(
    title,
    w.link('Items', 'Back to items') +
      '\n\n' +
      'All ' +
      total +
      ' equipment sets, grouped by where most of their pieces come from. A set that drops in a dungeon or raid is listed under it; open a set to see every piece and where to get it. For one list from A to Z, see [[Equipment sets]].\n\n' +
      sections.join(''),
    ['Portals'],
  );
}
