import { CLASSES, ITEMS } from '../../src/sim/data';
import { canEquipItem, classesThatCanEquipArmorType } from '../../src/sim/equipment_rules';
import type { ArmorType, ItemDef, PlayerClass } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { browseName, itemTypeName } from './item_browse_table';
import { type SplitLevel, writeIndexPage } from './item_index_pages';
import type { GearItem } from './item_tables';
import { wikiArmorTypeName } from './wiki_item_kind';

// "The gear my class can use": one Items index page per class, split into weapons,
// armor, jewelry and off-hands. Membership is the game's own equip gate, never a copy.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
};
type Member = { title: string; name: string; section: string; key?: string; id?: string };
interface Catalog {
  file(facet: string, label: string, member: Member): void;
  build(facet: string, label: string, builder: (title: string, members: Member[]) => void): void;
  order(facet: string, labels: string[]): void;
}

export const BY_CLASS = 'By class';

/**
 * Whether a character of this class can put the item on: the same checks the equip
 * command runs (src/sim/items.ts), an equipment slot, a gear kind, then canEquipItem.
 */
export function classCanEquip(cls: PlayerClass, item: ItemDef): boolean {
  if (!item.slot) return false;
  if (item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'held_offhand') return false;
  return canEquipItem(cls, item);
}

export const classGearLabel = (cls: PlayerClass) => CLASSES[cls].name + ' gear';

const JEWELRY = new Set(['neck', 'ring', 'ring1', 'ring2', 'trinket']);
export type ClassGearGroup = 'weapons' | 'armor' | 'jewelry' | 'offhands';
const GROUP_ORDER: ClassGearGroup[] = ['weapons', 'armor', 'jewelry', 'offhands'];
const GROUP_PHRASE: Record<ClassGearGroup, string> = {
  weapons: 'weapons',
  armor: 'armor',
  jewelry: 'jewelry',
  offhands: 'off-hands',
};

/** Which part of a class gear page an item goes in. */
export function classGearGroup(item: ItemDef): ClassGearGroup {
  if (item.kind === 'weapon') return 'weapons';
  if (JEWELRY.has(item.slot ?? '')) return 'jewelry';
  if (item.slot === 'offhand') return 'offhands';
  return 'armor';
}

// Armor that is still too long for one table splits by where it is worn.
const ARMOR_SLOT_PHRASE: Record<string, string> = {
  helmet: 'head armor',
  shoulder: 'shoulder armor',
  chest: 'chest armor',
  waist: 'belts',
  legs: 'leg armor',
  gloves: 'gloves',
  feet: 'footwear',
};
const ARMOR_SLOT_ORDER = Object.keys(ARMOR_SLOT_PHRASE);

function classLevels(cls: PlayerClass): SplitLevel[] {
  const name = CLASSES[cls].name;
  return [
    {
      heading: 'By kind of gear',
      key: classGearGroup,
      label: (key) => name + ' ' + GROUP_PHRASE[key as ClassGearGroup],
      order: GROUP_ORDER,
      always: true,
    },
    {
      heading: 'By slot or type',
      key: (item) =>
        classGearGroup(item) === 'armor'
          ? (item.slot ?? 'other')
          : (itemTypeName(item) || 'Other').toLowerCase(),
      label: (key) => name + ' ' + (ARMOR_SLOT_PHRASE[key] ?? key),
      order: ARMOR_SLOT_ORDER,
    },
  ];
}

/** The armor types a class can wear, lightest first, from the game's armor rule. */
export function classArmorTypes(cls: PlayerClass): ArmorType[] {
  return (['cloth', 'leather', 'mail'] as ArmorType[]).filter((t) =>
    classesThatCanEquipArmorType(t).includes(cls),
  );
}

function armorWords(cls: PlayerClass): string {
  const names = classArmorTypes(cls).map((t) => wikiArmorTypeName(t).toLowerCase());
  return names.length < 2
    ? (names[0] ?? 'no')
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

const lead = (cls: PlayerClass, count: number) => {
  const name = CLASSES[cls].name;
  return (
    'Every piece of gear a ' +
    name.toLowerCase() +
    ' can put on: ' +
    count +
    ' in all. A ' +
    name.toLowerCase() +
    ' can wear ' +
    armorWords(cls) +
    ' armor. Some pieces here are made for other classes, but a ' +
    name.toLowerCase() +
    ' can still wear them. Gear locked to other classes is left out. Each item still needs you to reach its level.'
  );
};

/** Files every equippable item under each class that can wear it; returns class id to page title. */
export function addClassGearViews(w: Writer, c: Catalog): Map<PlayerClass, string> {
  const classes = Object.keys(CLASSES) as PlayerClass[];
  for (const [id, title] of w.titleBy.item) {
    const item = ITEMS[id];
    if (!item) continue;
    for (const cls of classes)
      if (classCanEquip(cls, item))
        c.file(BY_CLASS, classGearLabel(cls), { title, name: browseName(item), section: '', id });
  }
  c.order(BY_CLASS, classes.map(classGearLabel));
  const titles = new Map<PlayerClass, string>();
  for (const cls of classes)
    c.build(BY_CLASS, classGearLabel(cls), (title, members) => {
      titles.set(cls, title);
      const gear: GearItem[] = members.map((m) => ({ id: m.id!, title: m.title, name: m.name }));
      writeIndexPage(
        w,
        { title, label: classGearLabel(cls), lead: lead(cls, gear.length) },
        { title: 'Items', label: 'items' },
        gear,
        classLevels(cls),
      );
    });
  return titles;
}

/** The class article's Gear section, linking its gear page. Empty when there is none. */
export function classGearSection(
  cls: PlayerClass,
  titles: Map<PlayerClass, string>,
  w: Pick<ArticleTools, 'section' | 'link'>,
): string {
  const title = titles.get(cls);
  if (!title) return '';
  const name = CLASSES[cls].name;
  return w.section(
    'Gear',
    'A ' +
      name.toLowerCase() +
      ' can wear ' +
      armorWords(cls) +
      ' armor. ' +
      w.link(title, name + ' gear') +
      ' lists every weapon, armor piece, piece of jewelry and off-hand a ' +
      name.toLowerCase() +
      ' can put on, in tables you can sort and filter.',
  );
}
