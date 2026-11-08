import { describe, expect, it } from 'vitest';
import { addCatalogPortals } from '../scripts/mediawiki/catalog_portals';
import type { ArticleTools } from '../scripts/mediawiki/entity_format';
import { ABILITIES, ITEMS, MOBS, NPCS } from '../src/sim/data';

const ids = (kind: string, entries: Record<string, unknown>) =>
  new Map(Object.keys(entries).map((id) => [id, kind + '/' + id]));
const titleBy: ArticleTools['titleBy'] = {
  item: ids('item', ITEMS),
  mob: ids('mob', MOBS),
  npc: ids('npc', NPCS),
  ability: ids(
    'ability',
    Object.fromEntries(Object.entries(ABILITIES).filter(([, a]) => !a.hiddenFromPlayer)),
  ),
  class: new Map(),
  quest: new Map(),
  zone: new Map(),
  dungeon: new Map(),
};
const pages = new Map<string, string>();
// A prefix makes any child link built by guessing its title fail the reachability test.
addCatalogPortals({
  titleBy,
  reserve: (s) => 'reserved/' + s,
  add: (title, body) => {
    expect(pages.has(title)).toBe(false);
    pages.set(title, body);
  },
  link: (title, label = title) => '[[' + title + '|' + label + ']]',
  section: (title, body) => '\n== ' + title + ' ==\n' + body + '\n',
  bullets: (lines) => lines.join('\n'),
});
const targets = (s: string) => [...s.matchAll(/\[\[([^|\]]+)\|/g)].map((m) => m[1]);

describe('catalog portals', () => {
  it('reaches every registered destination in two clicks and keeps large directories off the root pages', () => {
    for (const [root, kind] of [
      ['Items', 'item'],
      ['Mobs', 'mob'],
      ['NPCs', 'npc'],
      ['Abilities', 'ability'],
    ] as const) {
      const hub = pages.get(root)!;
      const children = targets(hub);
      expect(children.length).toBeGreaterThan(4);
      expect(children.length).toBeLessThan(80);
      const reachable = new Set(
        children.flatMap((child) => {
          expect(pages.has(child), child).toBe(true);
          const listed = targets(pages.get(child)!);
          expect(listed, child).toContain(root);
          expect(listed.length, child).toBeGreaterThan(1);
          return listed.filter((title) => title !== root);
        }),
      );
      expect([...reachable].sort()).toEqual([...titleBy[kind].values()].sort());
    }
  });
  it('separates class-independent grants from the Warrior spellbook', () => {
    const bomb = 'ability/clockwork_shock_bomb',
      courier = 'ability/courier';
    expect(targets(pages.get('reserved/Item actions (Abilities index)')!)).toContain(bomb);
    expect(targets(pages.get('reserved/All classes (Abilities index)')!)).toContain(courier);
    const warrior = targets(pages.get('reserved/Warrior (Abilities index)')!);
    expect(warrior).not.toContain(bomb);
    expect(warrior).not.toContain(courier);
  });
  it('cross-lists materials, multi-role NPCs and dual-ranked enemies where players look for them', () => {
    const memberships = (root: string, member: string) =>
      targets(pages.get(root)!).filter((child) => targets(pages.get(child)!).includes(member));
    const shirt = Object.values(ITEMS).find((i) => i.kind === 'armor' && i.slot === 'chest')!;
    expect(memberships('Items', 'item/' + shirt.id).some((s) => s.includes('Chest armor'))).toBe(
      true,
    );
    expect(memberships('Items', 'item/wolf_fang').some((s) => s.includes('ingredients'))).toBe(
      true,
    );
    expect(memberships('Items', 'item/pvp_skull_bag')).toContain('reserved/Bags (Items index)');
    const goods = pages.get('reserved/Trade goods and junk (Items index)')!;
    expect(goods).toContain('== Fine Material ==');
    expect(goods).toContain('== Material ==');
    const odell = memberships('NPCs', 'npc/foreman_odell');
    expect(odell).toEqual(
      expect.arrayContaining([
        'reserved/Quest givers (NPCs index)',
        'reserved/Quest hand-ins (NPCs index)',
        'reserved/Eastbrook Vale (NPCs index)',
      ]),
    );
    const boss = Object.values(MOBS).find((m) => m.boss && m.elite)!;
    expect(memberships('Mobs', 'mob/' + boss.id)).toEqual(
      expect.arrayContaining([
        'reserved/Bosses (Enemies index)',
        'reserved/Elites (Enemies index)',
      ]),
    );
  });
});
