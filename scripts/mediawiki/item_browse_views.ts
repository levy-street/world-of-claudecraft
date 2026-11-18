import { ITEM_SETS, ITEMS } from '../../src/sim/data';
import type { ItemDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { writeEquipmentSetGroups } from './equipment_set_groups';
import { WEAPON_TYPE_PAGES, weaponTypePage } from './item_browse_table';
import { familyLevels, writeIndexPage } from './item_index_pages';
import { itemSourceGroups, SOURCE_ORDER } from './item_source_groups';
import { addGearPages, type GearItem } from './item_tables';
import { wikiQualityName } from './wiki_item_kind';

// The Items hub's cross-slot views: every item of one quality, every weapon of one
// type, every item from one kind of source, and the equipment sets by where they drop.
// The catalog files the members; these builders write the pages under each hub link.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
  usedTitles?: Set<string>;
};
type Member = { title: string; name: string; section: string; key?: string; id?: string };
interface Catalog {
  file(facet: string, label: string, member: Member): void;
  build(facet: string, label: string, builder: (title: string, members: Member[]) => void): void;
  order(facet: string, labels: string[]): void;
}

export const BY_QUALITY = 'By quality';
export const BY_WEAPON_TYPE = 'Weapons by type';
export const MORE_WAYS = 'More ways to browse';
export const SOURCES_LABEL = 'Items by source';
export const SETS_LABEL = 'Equipment sets by group';

const QUALITIES: NonNullable<ItemDef['quality']>[] = [
  'legendary',
  'epic',
  'rare',
  'uncommon',
  'common',
  'poor',
];
const qualityLabel = (q: NonNullable<ItemDef['quality']>) => wikiQualityName(q) + ' items';
const gear = (members: Member[]): GearItem[] =>
  members.map((m) => ({ id: m.id!, title: m.title, name: m.name }));
const items = { title: 'Items', label: 'items' };

/** Files every item into the cross-slot views and registers the pages that list them. */
export function addItemBrowseViews(w: Writer, c: Catalog): void {
  const sources = itemSourceGroups(w);
  for (const [id, title] of w.titleBy.item) {
    const item = ITEMS[id];
    const entry = {
      title,
      name: item.heroicOf || item.heroic ? item.name + ' (Heroic)' : item.name,
      section: '',
      id,
    };
    c.file(BY_QUALITY, qualityLabel(item.quality ?? 'common'), entry);
    const type = weaponTypePage(item);
    if (type) c.file(BY_WEAPON_TYPE, type, entry);
    if (sources.has(id)) c.file(MORE_WAYS, SOURCES_LABEL, entry);
  }
  for (const set of Object.values(ITEM_SETS))
    c.file(MORE_WAYS, SETS_LABEL, { title: set.id, name: set.name, section: '', key: set.id });

  c.order(BY_QUALITY, QUALITIES.map(qualityLabel));
  for (const q of QUALITIES) {
    const label = qualityLabel(q);
    const word = wikiQualityName(q);
    c.build(BY_QUALITY, label, (title, members) =>
      writeIndexPage(
        w,
        {
          title,
          label,
          lead:
            'Every ' +
            word.toLowerCase() +
            ' item in the game, whatever its slot or where it comes from: ' +
            members.length +
            ' in all.',
        },
        items,
        gear(members),
        familyLevels(
          (phrase) =>
            phrase === 'other items'
              ? 'Other ' + word.toLowerCase() + ' items'
              : word + ' ' + phrase,
          true,
        ),
      ),
    );
  }
  c.order(
    BY_WEAPON_TYPE,
    WEAPON_TYPE_PAGES.map(([, plural]) => plural),
  );
  for (const [, plural] of WEAPON_TYPE_PAGES)
    c.build(BY_WEAPON_TYPE, plural, (title, members) =>
      addGearPages(w, title, plural, gear(members), true, 'Items'),
    );
  c.order(MORE_WAYS, [SOURCES_LABEL, SETS_LABEL]);
  c.build(MORE_WAYS, SOURCES_LABEL, (title, members) => {
    const self = { title, label: SOURCES_LABEL.toLowerCase() };
    const lines = SOURCE_ORDER.flatMap((source) => {
      const list = gear(members.filter((m) => sources.get(m.id!)?.has(source)));
      if (!list.length) return [];
      const page = w.reserve(source + ' (Items index)');
      writeIndexPage(
        w,
        {
          title: page,
          label: source,
          lead: 'Every item you can get this way. Open an item to see exactly where and how. An item with more than one source is also listed under its other sources.',
        },
        self,
        list,
        familyLevels((phrase) => source + ': ' + phrase, false),
      );
      return [w.link(page, source) + ' (' + list.length + ')'];
    });
    w.add(
      title,
      w.link('Items', 'Back to items') +
        '\n\n' +
        'Find items by how you get them. An item you can get more than one way is in every list that fits. Each item page gives the full steps.\n\n' +
        w.section('Sources', w.bullets(lines)),
      ['Portals'],
    );
  });
  c.build(MORE_WAYS, SETS_LABEL, (title) => writeEquipmentSetGroups(w, title));
}
