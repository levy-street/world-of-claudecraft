import { describe, expect, it } from 'vitest';
import { addCatalogPortals } from '../scripts/mediawiki/catalog_portals';
import { classGearGroup, classGearSection } from '../scripts/mediawiki/class_gear';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { TABLE_LIMIT } from '../scripts/mediawiki/item_index_pages';
import { npcServices } from '../scripts/mediawiki/npc_service';
import { questClosed } from '../scripts/mediawiki/quest_closed';
import { addQuestDirectory } from '../scripts/mediawiki/quest_directory';
import { ANY_LEVEL, questChains, questLevelBand } from '../scripts/mediawiki/quest_level_views';
import { CLASSES, DUNGEONS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { canEquipItem, weaponHand } from '../src/sim/equipment_rules';
import { computeQuestState } from '../src/sim/quests/quest_commands';
import type { PlayerClass } from '../src/sim/types';

// Gear by class, quests by level and quest chains, and the NPCs and Enemies hub sections.

const titleBy = Object.fromEntries(
  ['class', 'ability', 'item', 'npc', 'mob', 'quest', 'dungeon', 'zone'].map((kind) => [
    kind,
    new Map<string, string>(),
  ]),
) as Record<ArticleKind, Map<string, string>>;
for (const [kind, records] of Object.entries({
  item: ITEMS,
  mob: MOBS,
  npc: NPCS,
  quest: QUESTS,
  dungeon: DUNGEONS,
  class: CLASSES,
  zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
}))
  for (const id of Object.keys(records)) titleBy[kind as ArticleKind].set(id, kind + '/' + id);

const pages = new Map<string, string>();
const w: ArticleTools & { reserve(title: string): string } = {
  titleBy,
  reserve: (title) => title,
  link: (title, label = title) => '[[' + title + '|' + label + ']]',
  section: (title, body) => '\n== ' + title + ' ==\n' + body + '\n',
  bullets: (lines) => lines.map((s) => '* ' + s).join('\n'),
  table: (rows) => rows.map(([name, value]) => name + ': ' + value).join('\n'),
  add: (title, body) => {
    expect(pages.has(title), title).toBe(false);
    pages.set(title, body);
  },
  money: (value) => String(value),
};
const { classGear, enemyIndex } = addCatalogPortals(w);
addQuestDirectory(w);

const links = (title: string) =>
  [...(pages.get(title) ?? '').matchAll(/\[\[([^|\]]+)\|(?!Back to )/g)].map((m) => m[1]);
/** Every page reachable from a hub by following its links down. */
function reachable(root: string): Set<string> {
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length)
    for (const t of links(queue.shift()!))
      if (!seen.has(t) && pages.has(t)) {
        seen.add(t);
        queue.push(t);
      }
  return seen;
}
/** Every item linked from a page or any Items index page under it. */
function itemsUnder(title: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(title)) return out;
  seen.add(title);
  for (const target of links(title)) {
    if (target.startsWith('item/')) out.add(target.slice('item/'.length));
    else if (target.endsWith('(Items index)'))
      for (const id of itemsUnder(target, seen)) out.add(id);
  }
  return out;
}
const section = (body: string, heading: string) =>
  body.split('== ' + heading + ' ==\n')[1]?.split('\n== ')[0] ?? '';
const classes = Object.keys(CLASSES) as PlayerClass[];
const gearPages = [...pages.keys()].filter((t) =>
  classes.some((c) => t.startsWith(CLASSES[c].name + ' ') && t.endsWith(' (Items index)')),
);
const NO_DASH = /[–—]|\p{Extended_Pictographic}/u;

describe('gear by class', () => {
  it('lists one gear page per class on the Items hub, in class order', () => {
    const hub = section(pages.get('Items')!, 'By class');
    expect([...hub.matchAll(/\[\[([^|\]]+)\|/g)].map((m) => m[1])).toEqual(
      classes.map((c) => CLASSES[c].name + ' gear (Items index)'),
    );
    expect([...classGear.keys()]).toEqual(classes);
    for (const c of classes) expect(classGear.get(c)).toBe(CLASSES[c].name + ' gear (Items index)');
  });

  it('lists exactly the gear the equip rule lets each class put on', () => {
    for (const c of classes) {
      // The equip command's own gate: a slot, a gear kind, then canEquipItem.
      const expected = Object.values(ITEMS)
        .filter(
          (i) =>
            !!i.slot &&
            (i.kind === 'weapon' || i.kind === 'armor' || i.kind === 'held_offhand') &&
            canEquipItem(c, i),
        )
        .map((i) => i.id)
        .sort();
      expect([...itemsUnder(classGear.get(c)!)].sort(), c).toEqual(expected);
      expect(hubCount(c), c).toBe(expected.length);
    }
  });

  it('follows the rule where it bites: armor weight, class locks, shields and two-handers', () => {
    const under = (c: PlayerClass) => itemsUnder(classGear.get(c)!);
    const mage = [...under('mage')].map((id) => ITEMS[id]);
    expect(mage.some((i) => i.kind === 'armor' && i.armorType === 'mail')).toBe(false);
    expect(mage.some((i) => i.kind === 'armor' && i.armorType === 'cloth')).toBe(true);
    const rogue = [...under('rogue')].map((i) => ITEMS[i]);
    // A rogue never wields a two-hander, except a quest implement anyone can hold.
    const twoHanders = rogue.filter((i) => i.kind === 'weapon' && weaponHand(i) === 'twohand');
    expect(twoHanders.length).toBeGreaterThan(0);
    for (const i of twoHanders) expect(i.questTool, i.id).toBe(true);
    expect(
      Object.values(ITEMS).some(
        (i) => i.kind === 'weapon' && weaponHand(i) === 'twohand' && !i.questTool,
      ),
    ).toBe(true);
    const locked = Object.values(ITEMS).filter((i) => i.classLocked && i.requiredClass?.length);
    expect(locked.length).toBeGreaterThan(0);
    for (const item of locked)
      for (const c of classes)
        expect(under(c).has(item.id), item.id + ' ' + c).toBe(
          item.requiredClass!.includes(c) && canEquipItem(c, item),
        );
    // Gear made for other classes but not locked still shows (a mail piece for a shaman
    // also suits a warrior), and non-gear never shows.
    const meant = Object.values(ITEMS).find(
      (i) =>
        i.kind === 'armor' &&
        i.armorType === 'cloth' &&
        !i.classLocked &&
        i.requiredClass?.length &&
        !i.requiredClass.includes('warrior'),
    );
    if (meant) expect(under('warrior').has(meant.id)).toBe(true);
    expect(under('warrior').has('wolf_fang')).toBe(false);
  });

  it('splits each class into weapons, armor, jewelry and off-hands, with tables the reader can use', () => {
    for (const c of classes) {
      const name = CLASSES[c].name;
      const top = pages.get(classGear.get(c)!)!;
      expect(top.startsWith('[[Items|Back to items]]')).toBe(true);
      for (const [group, label] of [
        ['weapons', 'weapons'],
        ['armor', 'armor'],
        ['jewelry', 'jewelry'],
        ['offhands', 'off-hands'],
      ] as const) {
        const title = name + ' ' + label + ' (Items index)';
        const has = [...itemsUnder(classGear.get(c)!)].some(
          (id) => classGearGroup(ITEMS[id]) === group,
        );
        expect(top.includes('[[' + title + '|'), title).toBe(has);
        if (has)
          for (const id of itemsUnder(title)) expect(classGearGroup(ITEMS[id]), id).toBe(group);
      }
    }
    for (const title of gearPages) {
      const body = pages.get(title)!;
      const rows = (body.match(/^\|-\n\| /gm) ?? []).length;
      expect(rows, title).toBeLessThanOrEqual(TABLE_LIMIT);
      if (body.includes('{| class="wikitable item-table"'))
        expect(body, title).toContain('! Item !! Level !! Quality');
      else expect(body, title).toMatch(/== By (kind of gear|slot or type) ==/);
    }
  });

  it('links each class article to its gear page', () => {
    for (const c of classes) {
      const text = classGearSection(c, classGear, w);
      expect(text).toContain('== Gear ==');
      expect(text).toContain('[[' + classGear.get(c) + '|' + CLASSES[c].name + ' gear]]');
    }
    expect(classGearSection('mage', new Map(), w)).toBe('');
    expect(classGearSection('mage', classGear, w)).toContain('can wear cloth armor');
    expect(classGearSection('warrior', classGear, w)).toContain(
      'can wear cloth, leather and mail armor',
    );
  });
});

function hubCount(c: PlayerClass): number {
  const line = section(pages.get('Items')!, 'By class')
    .split('\n')
    .find((l) => l.includes('[[' + classGear.get(c) + '|'))!;
  return Number(/\((\d+)\)$/.exec(line)![1]);
}

/** The rows of every table on a page, keyed by the section they sit in. */
function tableRows(title: string): { heading: string; cells: string[] }[] {
  const out: { heading: string; cells: string[] }[] = [];
  let heading = '';
  for (const line of pages.get(title)!.split('\n')) {
    const h = /^== (.+) ==$/.exec(line);
    if (h) heading = h[1];
    else if (line.startsWith('| ')) out.push({ heading, cells: line.slice(2).split(' || ') });
  }
  return out;
}
const questLink = (id: string) => w.link('quest/' + id, QUESTS[id].name);
const questOf = (cell: string) => /^\[\[quest\/([^|\]]+)\|/.exec(cell)?.[1];

describe('quests by level', () => {
  const rows = tableRows('Quests by level');

  it('is linked from the Quests hub with its count', () => {
    const more = section(pages.get('Quests')!, 'More ways to browse');
    const open = Object.values(QUESTS).filter((q) => !questClosed(q)).length;
    expect(more).toContain('* [[Quests by level|By level]] · ' + open + ' quests');
    expect(more).toContain('* [[Quest chains|Quest chains]] · ' + questChains().length + ' chains');
    for (const t of ['Quests by level', 'Quest chains'])
      expect(reachable('Quests').has(t)).toBe(true);
  });

  it('lists every quest once, under its own level, with its zone and the quest before it', () => {
    const ids = rows.map((r) => questOf(r.cells[0]));
    expect(ids.slice().sort()).toEqual(Object.keys(QUESTS).sort());
    for (const { heading, cells } of rows) {
      const q = QUESTS[questOf(cells[0])!];
      expect(heading, q.id).toBe(questClosed(q) ? 'Closed to new players' : questLevelBand(q));
      const level = q.minLevel
        ? q.maxLevel
          ? q.minLevel + ' to ' + q.maxLevel
          : String(q.minLevel)
        : q.maxLevel
          ? 'Up to ' + q.maxLevel
          : 'Any';
      expect(cells[2], q.id).toBe(level);
      expect(cells[3], q.id).toBe(q.requiresQuest ? questLink(q.requiresQuest) : 'None');
      const zone = ZONES.find((z) => cells[1] === '[[zone/' + z.id + '|' + z.name + ']]');
      expect(zone || cells[1] === 'Inside a raid', q.id + ' ' + cells[1]).toBeTruthy();
    }
    // The Any level group is exactly the quests with no lowest level.
    expect(
      rows
        .filter((r) => r.heading === ANY_LEVEL)
        .map((r) => questOf(r.cells[0]))
        .sort(),
    ).toEqual(
      Object.values(QUESTS)
        .filter((q) => !q.minLevel && !questClosed(q))
        .map((q) => q.id)
        .sort(),
    );
    // Bands run from low to high.
    const bands = [...new Set(rows.map((r) => r.heading))];
    expect(bands[0]).toBe(ANY_LEVEL);
    const lows = bands.slice(1, -1).map((b) => Number(/^Levels (\d+) to/.exec(b)![1]));
    expect(lows).toEqual([...lows].sort((a, b) => a - b));
  });

  it('only calls a quest Any level when the game lets a level 1 character take it', () => {
    // A first quest with no other gate: the game's own check at level 1.
    const plain = Object.values(QUESTS).filter(
      (q) =>
        !q.minLevel &&
        !q.requiresQuest &&
        !q.requiredClass &&
        !q.requiresUsableHealAbility &&
        !q.completionEffect &&
        !questClosed(q),
    );
    expect(plain.length).toBeGreaterThan(10);
    for (const q of plain)
      expect(computeQuestState(q.id, new Map(), new Set(), 1), q.id).toBe('available');
    // A quest with a lowest level is not open below it.
    const gated = Object.values(QUESTS).find((q) => (q.minLevel ?? 0) > 1 && !q.requiresQuest)!;
    expect(computeQuestState(gated.id, new Map(), new Set(), gated.minLevel! - 1)).toBe(
      'unavailable',
    );
  });
});

describe('quest chains', () => {
  it('lists every quest in a chain once, each after the quest that opens it', () => {
    const rows = tableRows('Quest chains');
    const inChains = Object.values(QUESTS).filter(
      (q) => q.requiresQuest || Object.values(QUESTS).some((o) => o.requiresQuest === q.id),
    );
    expect(rows.map((r) => questOf(r.cells[1])).sort()).toEqual(inChains.map((q) => q.id).sort());
    const step = new Map<string, { heading: string; step: number }>();
    for (const { heading, cells } of rows) {
      const q = QUESTS[questOf(cells[1])!];
      const n = Number(cells[0]);
      if (q.requiresQuest) {
        const parent = step.get(q.requiresQuest);
        expect(parent, q.id).toBeDefined();
        expect(parent!.heading, q.id).toBe(heading);
        expect(n, q.id).toBe(parent!.step + 1);
        expect(cells[4], q.id).toBe(questLink(q.requiresQuest));
      } else {
        expect(n, q.id).toBe(1);
        expect(heading.startsWith(q.name + ' ('), q.id).toBe(true);
      }
      step.set(q.id, { heading, step: n });
    }
  });
});

describe('NPCs and Enemies hub sections', () => {
  it('lists the weekly emissary and the world quest taskmaster under Services, named as their pages name them', () => {
    const services = section(pages.get('NPCs')!, 'Services');
    for (const [id, label] of [
      ['weekly_emissary', 'Weekly quests'],
      ['npc_wq_taskmaster', 'World quests'],
    ] as const) {
      const npc = NPCS[id];
      expect(npcServices(npc, w).map((s) => s.label)).toContain(label);
      const title = label + ' (NPCs index)';
      expect(services).toContain('[[' + title + '|' + label + ']]');
      expect(links(title)).toContain('npc/' + id);
    }
    expect(NPCS.weekly_emissary.name).toBe('Cham Pete');
    expect(NPCS.npc_wq_taskmaster.name).toBe('Taskmaster Kaelen');
    expect(links('Weekly quests (NPCs index)').filter((t) => t.startsWith('npc/'))).toEqual(
      Object.values(NPCS)
        .filter((n) => n.weeklyEmissary)
        .map((n) => 'npc/' + n.id),
    );
  });

  it('puts Vendors and enemies by zone in their own hub sections, last so breadcrumbs keep their place', () => {
    const npcs = pages.get('NPCs')!;
    expect(section(npcs, 'Shops')).toMatch(/^\* \[\[Vendors\|All vendors\]\] \(\d+\)/);
    expect(npcs.lastIndexOf('\n== ')).toBe(npcs.indexOf('\n== Shops =='));
    const mobs = pages.get('Mobs')!;
    expect(mobs.lastIndexOf('\n== ')).toBe(mobs.indexOf('\n== By zone =='));
    const byZone = section(mobs, 'By zone');
    expect(enemyIndex.size).toBeGreaterThan(3);
    for (const [id, title] of enemyIndex) {
      const zone = ZONES.find((z) => z.id === id)!;
      expect(byZone).toContain('[[' + title + '|' + zone.name + ']] (');
      expect(pages.get(title)!.startsWith('[[Mobs|Browse enemies]]')).toBe(true);
    }
    expect(enemyIndex.get('eastbrook_vale')).toBe('Eastbrook Vale (Enemies index)');
  });
});

describe('every new page', () => {
  const fresh = [
    ...gearPages,
    'Quests by level',
    'Quest chains',
    'Weekly quests (NPCs index)',
    'World quests (NPCs index)',
    'Vendors',
    ...enemyIndex.values(),
  ];

  it('is reachable from its hub', () => {
    const hubs = new Set([
      ...reachable('Items'),
      ...reachable('Quests'),
      ...reachable('NPCs'),
      ...reachable('Mobs'),
    ]);
    for (const t of fresh) {
      expect(pages.has(t), t).toBe(true);
      expect(hubs.has(t), t).toBe(true);
    }
  });

  it('uses no em or en dashes and no emojis', () => {
    for (const t of fresh) expect(NO_DASH.test(t + pages.get(t)!), t).toBe(false);
    for (const c of classes) expect(NO_DASH.test(classGearSection(c, classGear, w))).toBe(false);
  });
});
