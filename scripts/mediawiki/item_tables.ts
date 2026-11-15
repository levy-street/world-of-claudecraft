import { ITEMS } from '../../src/sim/data';
import { requiredLevelFor } from '../../src/sim/item_level_req';
import type { ItemDef } from '../../src/sim/types';
import { itemCombatTooltipLines } from '../../src/ui/item_combat_tooltip_view';
import { itemArtPath } from './article_art';
import type { ArticleTools } from './entity_format';
import { offhandSection } from './item_catalog_groups';

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
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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
    : offhandSection(item) || (item.armorType ? capital(item.armorType) : '');
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
      const common = [cell, String(requiredLevelFor(item)), capital(quality(item))];
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

export interface GearGroup {
  /** The slot page title, supplied by the catalog. */
  title: string;
  /** Plural label, such as "Belts". */
  slot: string;
  items: GearItem[];
  weapon: boolean;
}

const BOLD = "'''";

/**
 * Writes every gear page: one per slot, per type in a slot, and per quality at both
 * levels. Each page carries rows of links to switch slot, type or quality in place, so a
 * reader can go from epic mail belts to epic mail footwear without going back up.
 * Groups that share `weapon` are offered to each other as slots.
 */
export function addGearPages(w: Writer, groups: GearGroup[], back: string): void {
  const titles = new Map<string, string>();
  const members = new Map<string, GearItem[]>();
  const key = (slot: string, type: string, q: string) => slot + '|' + type + '|' + q;
  const typesOf = new Map<string, string[]>();
  const qualitiesOf = new Map<string, string[]>();
  const label = (slot: string, type: string, q: string) =>
    [q && capital(q), type, slot].filter(Boolean).reduce((a, b) => a + ' ' + lower(b));

  // Plan: decide which pages exist and reserve their titles before any is written.
  for (const g of groups) {
    const types = [...new Set(g.items.map((e) => gearType(ITEMS[e.id])))].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
    typesOf.set(g.slot, types.length > 1 ? types : []);
    for (const type of ['', ...typesOf.get(g.slot)!]) {
      const inType = g.items.filter((e) => !type || gearType(ITEMS[e.id]) === type);
      const qualities = QUALITY_ORDER.filter((q) => inType.some((e) => quality(ITEMS[e.id]) === q));
      qualitiesOf.set(g.slot + '|' + type, qualities.length > 1 ? qualities : []);
      for (const q of ['', ...qualitiesOf.get(g.slot + '|' + type)!]) {
        const k = key(g.slot, type, q);
        members.set(
          k,
          inType.filter((e) => !q || quality(ITEMS[e.id]) === q),
        );
        titles.set(k, !type && !q ? g.title : w.reserve(label(g.slot, type, q) + ' (Items index)'));
      }
    }
  }
  // The closest page that exists when the same type or quality is missing elsewhere.
  const nearest = (slot: string, type: string, q: string) =>
    titles.get(key(slot, type, q)) ??
    titles.get(key(slot, type, '')) ??
    titles.get(key(slot, '', q)) ??
    titles.get(key(slot, '', ''))!;
  const row = (name: string, options: [string, string][], current: string) =>
    BOLD +
    name +
    ':' +
    BOLD +
    ' ' +
    options
      .map(([text, title]) => (title === current ? BOLD + text + BOLD : w.link(title, text)))
      .join(' · ');
  const count = (n: number) => ' (' + n + ')';

  for (const g of groups) {
    const slots = groups.filter((other) => other.weapon === g.weapon);
    const types = typesOf.get(g.slot)!;
    for (const type of ['', ...types]) {
      const qualities = qualitiesOf.get(g.slot + '|' + type)!;
      for (const q of ['', ...qualities]) {
        const title = titles.get(key(g.slot, type, q))!;
        const list = members.get(key(g.slot, type, q))!;
        const parent =
          q !== ''
            ? { title: titles.get(key(g.slot, type, ''))!, label: lower(label(g.slot, type, '')) }
            : type !== ''
              ? { title: g.title, label: lower(g.slot) }
              : { title: back, label: 'items' };
        const switches = [
          row(
            g.weapon ? 'Weapon' : 'Slot',
            slots.map((other) => [other.slot, nearest(other.slot, type, q)]),
            title,
          ),
          ...(types.length
            ? [
                row(
                  'Type',
                  [
                    ['All', nearest(g.slot, '', q)],
                    ...types.map((t): [string, string] => [t || 'Other', nearest(g.slot, t, q)]),
                  ],
                  title,
                ),
              ]
            : []),
          ...(qualities.length
            ? [
                row(
                  'Quality',
                  [
                    ['All', titles.get(key(g.slot, type, ''))!],
                    ...qualities.map((x): [string, string] => [
                      capital(x),
                      titles.get(key(g.slot, type, x))!,
                    ]),
                  ],
                  title,
                ),
              ]
            : []),
        ];
        // Tiles to narrow down: by type from a slot page, by quality where there is one.
        const typeTiles =
          !type && !q
            ? types.map(
                (t) =>
                  w.link(titles.get(key(g.slot, t, ''))!, t || 'Other') +
                  count(members.get(key(g.slot, t, ''))!.length),
              )
            : [];
        const qualityTiles = !q
          ? qualities.map(
              (x) =>
                w.link(titles.get(key(g.slot, type, x))!, capital(x)) +
                count(members.get(key(g.slot, type, x))!.length),
            )
          : [];
        w.add(
          title,
          w.link(parent.title, 'Back to ' + parent.label) +
            '\n\n' +
            switches.join('\n\n') +
            '\n\n' +
            (typeTiles.length > 1 ? w.section('By type', w.bullets(typeTiles)) : '') +
            (qualityTiles.length > 1 ? w.section('By quality', w.bullets(qualityTiles)) : '') +
            w.section(
              'Item table',
              'Select a column heading to sort. Use the filters above the table to show only items with the stats you want.\n\n' +
                gearTable(list, g.weapon),
            ),
          ['Portals'],
        );
      }
    }
  }
}
