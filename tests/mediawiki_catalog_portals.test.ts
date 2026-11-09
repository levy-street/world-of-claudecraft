import { describe, expect, it } from 'vitest';
import { addCatalogPortals } from '../scripts/mediawiki/catalog_portals';
import { classAbilityGroup } from '../scripts/mediawiki/class_ability_sections';
import { creatureRole } from '../scripts/mediawiki/creature_role';
import type { ArticleTools } from '../scripts/mediawiki/entity_format';
import { ABILITIES, CLASSES, DUNGEONS, ITEMS, MOBS, NPCS } from '../src/sim/data';

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
      // Enemies lists only hostile creatures; companions, pets, dummies and escorts are
      // friendly characters, so they are reachable from NPCs instead.
      const isEnemy = (id: string) => creatureRole(id) === 'enemy';
      const friendly = [...titleBy.mob].filter(([id]) => !isEnemy(id)).map(([, t]) => t);
      const expected =
        kind === 'mob'
          ? [...titleBy.mob].filter(([id]) => isEnemy(id)).map(([, t]) => t)
          : kind === 'npc'
            ? [...titleBy.npc.values(), ...friendly]
            : [...titleBy[kind].values()];
      expect([...reachable].sort()).toEqual(expected.sort());
    }
  });
  it('keeps companions, pets, practice targets and escorts out of Enemies', () => {
    const enemyPages = targets(pages.get('Mobs')!).flatMap((child) => targets(pages.get(child)!));
    for (const id of [
      'buddy_horse',
      'emberkin',
      'acolyte_tessa',
      'training_dummy',
      'stable_horse',
      'fisher_bram',
      'yumi_cat',
      'muster_footman',
      'vision_aldren_warrior',
    ]) {
      expect(creatureRole(id), id).not.toBe('enemy');
      expect(enemyPages, id).not.toContain('mob/' + id);
    }
    // Encounter objects and bosses are fought, so they stay enemies.
    for (const id of ['spider_egg', 'nythraxis_bone_spike', 'tolling_bell'])
      expect(creatureRole(id), id).toBe('enemy');
    expect(creatureRole(Object.values(MOBS).find((m) => m.boss)!.id)).toBe('enemy');
    expect(pages.get('Mobs')).not.toContain('Friendly creatures');
    expect(pages.get('NPCs')).toContain('== Friendly creatures ==');
  });
  it('separates class-independent grants from the Warrior spellbook', () => {
    const bomb = 'ability/clockwork_shock_bomb',
      courier = 'ability/courier';
    expect(targets(pages.get('reserved/Item actions (Abilities index)')!)).toContain(bomb);
    expect(targets(pages.get('reserved/Membership actions (Abilities index)')!)).toContain(courier);
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
    const goods = pages.get('reserved/Materials (Items index)')!;
    expect(goods).toContain('== Fine Material ==');
    expect(goods).toContain('== Material ==');
    // Catch-alls are split by what the item does.
    expect(memberships('Items', 'item/harvest_feast')).toContain('reserved/Feasts (Items index)');
    expect(memberships('Items', 'item/heroic_mark')).toContain(
      'reserved/Currencies and tokens (Items index)',
    );
    expect(memberships('Items', 'item/sigil_anvil_helmet')).toContain(
      'reserved/Armor sigils (Items index)',
    );
    expect(memberships('Items', 'item/reins_mech_bird')).toContain(
      'reserved/Legacy mount keys (Items index)',
    );
    expect(pages.has('reserved/Trade goods and junk (Items index)')).toBe(false);
    expect(pages.has('reserved/Tools and supplies (Items index)')).toBe(false);
    const odell = memberships('NPCs', 'npc/foreman_odell');
    expect(odell).toEqual(
      expect.arrayContaining([
        'reserved/Quest givers (NPCs index)',
        'reserved/Quest hand-ins (NPCs index)',
        'reserved/Eastbrook Vale (NPCs index)',
      ]),
    );
    // A system-spawned NPC at a fixed post is listed in its zone, not an activity bucket.
    expect(memberships('NPCs', 'npc/innkeeper_maudie')).toContain(
      'reserved/Mirefen Marsh (NPCs index)',
    );
    const boss = Object.values(MOBS).find((m) => m.boss && m.elite)!;
    expect(memberships('Mobs', 'mob/' + boss.id)).toEqual(
      expect.arrayContaining([
        'reserved/Bosses (Enemies index)',
        'reserved/Elites (Enemies index)',
      ]),
    );
  });
  it('lists a raid creature under every room it spawns in', () => {
    const raidPages = targets(pages.get('Mobs')!)
      .map((child) => pages.get(child)!)
      .filter((body) => body.includes('mob/ignivar_crucible_warden'));
    const raid = raidPages.find((body) =>
      body.includes(DUNGEONS.ignivar_forge_approach.name + ' =='),
    )!;
    for (const room of ['ignivar_forge_approach', 'ignivar_molten_assembly']) {
      const section = raid.split('== ' + DUNGEONS[room].name + ' ==')[1].split('\n== ')[0];
      expect(section, room).toContain('mob/ignivar_crucible_warden');
    }
  });
  it('labels spellbook extras in the index the same way the class pages do', () => {
    const extras: Record<string, string> = {
      'Talent choices': 'Talent abilities',
      'Specialization abilities': 'Specialization abilities',
      'Quest abilities': 'Quest abilities',
      'Conditional replacements': 'Conditional replacements',
    };
    for (const def of Object.values(ABILITIES)) {
      if (def.hiddenFromPlayer || !(def.class in CLASSES)) continue;
      const want = extras[classAbilityGroup(def)];
      if (!want || CLASSES[def.class as keyof typeof CLASSES].abilities.includes(def.id)) continue;
      const index = pages.get(
        'reserved/' + CLASSES[def.class as keyof typeof CLASSES].name + ' (Abilities index)',
      )!;
      const section = index.split('== ' + want + ' ==')[1]?.split('\n== ')[0] ?? '';
      expect(section, def.id).toContain('ability/' + def.id);
    }
  });
});
