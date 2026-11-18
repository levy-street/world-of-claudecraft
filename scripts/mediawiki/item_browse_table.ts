import { weaponTypeForItem } from '../../src/sim/content/weapon_skin_rules';
import { ITEMS } from '../../src/sim/data';
import { weaponHand } from '../../src/sim/equipment_rules';
import { requiredLevelFor } from '../../src/sim/item_level_req';
import type { ItemDef } from '../../src/sim/types';
import { t } from '../../src/ui/i18n';
import { weaponTypeLabelKey } from '../../src/ui/weapon_type_label';
import { itemArtPath } from './article_art';
import { offhandSection } from './item_catalog_groups';
import { type GearItem, gearStats } from './item_tables';
import { wikiArmorTypeName, wikiItemKind, wikiQualityName } from './wiki_item_kind';

// One item table for pages that mix every kind of item (a quality, a source, a
// dungeon's loot). Same markup as the slot tables, so the reader sorts and filters it.

export type GearFamily = 'weapons' | 'armor' | 'jewelry' | 'other';

const SLOT_NAMES: Record<string, string> = {
  helmet: 'Head',
  neck: 'Neck',
  shoulder: 'Shoulder',
  chest: 'Chest',
  waist: 'Waist',
  legs: 'Legs',
  gloves: 'Hands',
  feet: 'Feet',
  ring: 'Finger',
  ring1: 'Finger',
  ring2: 'Finger',
  trinket: 'Trinket',
  offhand: 'Off hand',
  mainhand: 'Main hand',
};
const HANDS = { mainhand: 'Main hand', onehand: 'One hand', twohand: 'Two hands' };
const JEWELRY = new Set(['neck', 'ring', 'ring1', 'ring2', 'trinket']);

/** Which split of a quality page an item belongs to. */
export function gearFamily(item: ItemDef): GearFamily {
  if (item.kind === 'weapon') return 'weapons';
  if (item.kind === 'armor' || item.kind === 'held_offhand')
    return JEWELRY.has(item.slot ?? '') ? 'jewelry' : 'armor';
  return 'other';
}

/** Where the item is worn, as the character sheet names the slot. Empty for non-gear. */
export function itemSlotName(item: ItemDef): string {
  if (item.kind === 'weapon') return HANDS[weaponHand(item) ?? 'onehand'];
  if (item.kind === 'armor' || item.kind === 'held_offhand')
    return SLOT_NAMES[item.slot ?? 'offhand'] ?? '';
  return '';
}

/** The tooltip's type word: Sword, Mail, Shield, Potion and so on. */
export function itemTypeName(item: ItemDef): string {
  if (item.kind === 'weapon') {
    const key = weaponTypeLabelKey(item.id);
    return key ? t(key) : '';
  }
  if (item.kind === 'armor' || item.kind === 'held_offhand')
    return offhandSection(item) || (item.armorType ? wikiArmorTypeName(item.armorType) : '');
  return wikiItemKind(item);
}

/** Heroic copies share their Normal item's name; the tables say which one a row is. */
export const browseName = (item: ItemDef) =>
  item.heroicOf || item.heroic ? item.name + ' (Heroic)' : item.name;

export interface ExtraColumn {
  heading: string;
  cell(id: string): string;
}

/**
 * The table: Item, Level, Quality, then only the columns at least one row fills (Slot,
 * Type, Armor, Damage, Speed, Damage per second, Stats), then any extra columns the
 * page asks for.
 */
export function browseTable(items: GearItem[], extra: ExtraColumn[] = []): string {
  const rows = [...items].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.title.localeCompare(b.title, 'en'),
  );
  const facts = rows.map((entry) => {
    const item = ITEMS[entry.id];
    const s = gearStats(item);
    return {
      entry,
      item,
      optional: [
        itemSlotName(item),
        itemTypeName(item),
        s.armor,
        s.damage,
        s.speed,
        s.dps,
        s.stats.join(', '),
      ],
    };
  });
  const optionalHeadings = [
    'Slot',
    'Type',
    'Armor',
    'Damage',
    'Speed',
    'Damage per second',
    'Stats',
  ];
  const keep = optionalHeadings.map((_, i) => facts.some((f) => f.optional[i]));
  const headings = [
    'Item',
    'Level',
    'Quality',
    ...optionalHeadings.filter((_, i) => keep[i]),
    ...extra.map((c) => c.heading),
  ];
  const lines = facts.map(({ entry, item, optional }) => {
    const art = itemArtPath(entry.id);
    const cell =
      (art ? '<woc-art path="' + art + '" size="icon" /> ' : '') +
      '[[' +
      entry.title +
      '|' +
      entry.name +
      ']]';
    return (
      '|-\n| ' +
      [
        cell,
        String(requiredLevelFor(item)),
        wikiQualityName(item.quality),
        ...optional.filter((_, i) => keep[i]),
        ...extra.map((c) => c.cell(entry.id)),
      ].join(' || ')
    );
  });
  return (
    '{| class="wikitable item-table"\n|-\n! ' +
    headings.join(' !! ') +
    '\n' +
    lines.join('\n') +
    '\n|}'
  );
}

/** Plural page names for each weapon type, in the order a player scans them. */
export const WEAPON_TYPE_PAGES: [type: string, plural: string][] = [
  ['sword', 'Swords'],
  ['axe', 'Axes'],
  ['mace', 'Maces'],
  ['dagger', 'Daggers'],
  ['polearm', 'Polearms'],
  ['staff', 'Staves'],
  ['wand', 'Wands'],
  ['bow', 'Bows'],
  ['crossbow', 'Crossbows'],
];
export const weaponTypePage = (item: ItemDef): string | undefined => {
  const type = item.kind === 'weapon' ? weaponTypeForItem(item.id) : null;
  return WEAPON_TYPE_PAGES.find(([id]) => id === type)?.[1];
};
