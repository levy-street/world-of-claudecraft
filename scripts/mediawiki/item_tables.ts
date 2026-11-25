import { ITEMS } from '../../src/sim/data';
import { requiredLevelFor } from '../../src/sim/item_level_req';
import type { ItemDef } from '../../src/sim/types';
import { itemCombatTooltipLines } from '../../src/ui/item_combat_tooltip_view';
import { itemArtPath } from './article_art';
import type { ArticleTools } from './entity_format';
import { offhandSection } from './item_catalog_groups';
import { wikiArmorTypeName, wikiQualityName } from './wiki_item_kind';

// Gear is browsed in layers: slot, then armor type, then quality. Every layer lists its
// items in a table of stats that the reader can sort and filter.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link'> & {
  reserve(title: string): string;
};
export interface GearItem {
  id: string;
  title: string;
  name: string;
}

const QUALITY_ORDER = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plain = (html: string) =>
  html
    .split('</div>')
    .map((x) =>
      x
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .trim(),
    )
    .filter(Boolean);

/** The numbers a player compares gear by, read from the same lines as the game tooltip. */
export function gearStats(item: ItemDef) {
  const lines = plain(itemCombatTooltipLines(item));
  const armor = lines.map((l) => /^(\d+) Armor$/.exec(l)?.[1]).find(Boolean) ?? '';
  const damage = lines.map((l) => /^(\d+) - (\d+) Damage Speed ([\d.]+)$/.exec(l)).find(Boolean);
  const dps = lines.map((l) => /^\(([\d.]+) damage per second\)$/.exec(l)?.[1]).find(Boolean) ?? '';
  return {
    armor,
    damage: damage ? damage[1] + ' to ' + damage[2] : '',
    speed: damage ? damage[3] : '',
    dps,
    stats: lines.filter((l) => /^\+\d/.test(l)),
  };
}

export const gearType = (item: ItemDef) =>
  item.kind === 'weapon'
    ? ''
    : offhandSection(item) || (item.armorType ? wikiArmorTypeName(item.armorType) : '');
const quality = (item: ItemDef) => item.quality ?? 'common';

export function gearTable(items: GearItem[], weapon: boolean): string {
  const header = weapon
    ? '! Item !! Level !! Quality !! Damage !! Speed !! Damage per second !! Stats'
    : '! Item !! Level !! Quality !! Type !! Armor !! Stats';
  const rows = [...items]
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.title.localeCompare(b.title, 'en'))
    .map((entry) => {
      const item = ITEMS[entry.id];
      const s = gearStats(item);
      const art = itemArtPath(entry.id);
      const cell =
        (art ? '<woc-art path="' + art + '" size="icon" /> ' : '') +
        '[[' +
        entry.title +
        '|' +
        entry.name +
        ']]';
      const common = [cell, String(requiredLevelFor(item)), wikiQualityName(item.quality)];
      return (
        '|-\n| ' +
        (weapon
          ? [...common, s.damage, s.speed, s.dps, s.stats.join(', ')]
          : [...common, gearType(item), s.armor, s.stats.join(', ')]
        ).join(' || ')
      );
    });
  return '{| class="wikitable item-table"\n|-\n' + header + '\n' + rows.join('\n') + '\n|}';
}

/**
 * Writes the page for one slot and the pages under it, and returns nothing: the slot
 * page title is supplied by the catalog. `slot` is the plural label, such as "Belts".
 */
export function addGearPages(
  w: Writer,
  title: string,
  slot: string,
  items: GearItem[],
  weapon: boolean,
  back: string,
): void {
  const page = (
    pageTitle: string,
    parent: { title: string; label: string },
    list: GearItem[],
    childHeading: string,
    children: string[],
  ) =>
    w.add(
      pageTitle,
      w.link(parent.title, 'Back to ' + parent.label) +
        '\n\n' +
        (children.length > 1 ? w.section(childHeading, w.bullets(children)) : '') +
        w.section(
          'Item table',
          'Select a column heading to sort. Use the filters above the table to show only items with the stats you want.\n\n' +
            gearTable(list, weapon),
        ),
      ['Portals'],
    );
  const count = (n: number) => ' (' + n + ')';
  const byQuality = (
    list: GearItem[],
    label: string,
    parent: { title: string; label: string },
  ): string[] => {
    const groups = new Map<string, GearItem[]>();
    for (const e of list) {
      const q = quality(ITEMS[e.id]);
      groups.set(q, [...(groups.get(q) ?? []), e]);
    }
    if (groups.size < 2) return [];
    return [...groups]
      .sort(([a], [b]) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b))
      .map(([q, members]) => {
        const child = w.reserve(
          wikiQualityName(q as ItemDef['quality']) + ' ' + lower(label) + ' (Items index)',
        );
        page(child, parent, members, '', []);
        return w.link(child, wikiQualityName(q as ItemDef['quality'])) + count(members.length);
      });
  };
  const types = new Map<string, GearItem[]>();
  for (const e of items) {
    const t = gearType(ITEMS[e.id]);
    types.set(t, [...(types.get(t) ?? []), e]);
  }
  const self = { title, label: lower(slot) };
  if (types.size > 1) {
    const children = [...types]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([type, members]) => {
        const label = (type || 'Other') + ' ' + lower(slot);
        const child = w.reserve(label + ' (Items index)');
        page(
          child,
          self,
          members,
          'By quality',
          byQuality(members, label, { title: child, label: lower(label) }),
        );
        return w.link(child, type || 'Other') + count(members.length);
      });
    page(title, { title: back, label: 'items' }, items, 'By type', children);
  } else
    page(title, { title: back, label: 'items' }, items, 'By quality', byQuality(items, slot, self));
}
