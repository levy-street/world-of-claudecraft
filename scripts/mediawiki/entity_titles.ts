import {
  ABILITIES,
  CLASSES,
  DUNGEON_LIST,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
  zoneContaining,
} from '../../src/sim/data';
import { questZoneName } from './quest_articles';
import { assignTitles, type TitleEntry } from './title_names';

type Kind = 'class' | 'ability' | 'zone' | 'dungeon' | 'npc' | 'quest' | 'mob' | 'item';

const present = (hints: (string | undefined | false)[]) => [
  ...new Set(hints.filter((h): h is string => typeof h === 'string')),
];

// Words of an id that are not a game name, so they never go into a title.
const SKIP_WORDS = new Set(['shadow', 'mistcaller', 'marrow', 'watch']);

/** Like idQualifier, but in game words: a class id becomes the class name, an internal
 *  event or old-name word is dropped, and "head left" reads "Left head". */
function gameQualifier(id: string, name: string): string {
  const said = new Set(name.toLowerCase().split(/[^a-z0-9]+/));
  let parts = id.split('_').filter((w) => w && !said.has(w) && !SKIP_WORDS.has(w));
  if (parts.length === 2 && parts[0] === 'head') parts = [parts[1], parts[0]];
  const text = parts.map((w) => CLASSES[w]?.name ?? w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The page title of every class, ability, zone, dungeon, NPC, quest, creature and item.
 *  A shared name is told apart by what the thing is, never by a bare number. */
export function entityTitles(used: Set<string>): Record<Kind, Map<string, string>> {
  const entries: TitleEntry[] = [];
  const add = (kind: Kind, id: string, base: string, hints: (string | undefined | false)[]) =>
    entries.push({ key: kind + '/' + id, base, hints: present(hints) });

  for (const [id, cls] of Object.entries(CLASSES)) add('class', id, cls.name, ['', 'Class']);
  for (const [id, ability] of Object.entries(ABILITIES))
    if (ability.hiddenFromPlayer !== true)
      add('ability', id, ability.name + ' (Ability)', [
        '',
        CLASSES[ability.class]?.name,
        CLASSES[ability.class]?.name +
          ', ' +
          (ability.castTime > 0 ? ability.castTime + ' sec cast' : 'instant'),
        gameQualifier(id, ability.name),
      ]);
  for (const zone of ZONES) add('zone', zone.id, zone.name, ['', 'Zone']);
  for (const dungeon of DUNGEON_LIST) add('dungeon', dungeon.id, dungeon.name, ['', 'Dungeon']);
  for (const [id, npc] of Object.entries(NPCS)) {
    const posted = npc.pos.x !== 0 || npc.pos.z !== 0;
    const place =
      (posted ? zoneContaining(npc.pos.x, npc.pos.z)?.name : undefined) ??
      DUNGEON_LIST.find((d) => d.npcs?.some((s) => s.npcId === id))?.name;
    const own = gameQualifier(id, npc.name);
    add('npc', id, npc.name + ' (NPC)', ['', place, place && own && place + ', ' + own, own]);
  }
  for (const [id, quest] of Object.entries(QUESTS)) {
    const zone = questZoneName(quest);
    const giver = NPCS[quest.giverNpcId]?.name;
    add('quest', id, quest.name, [
      'Quest',
      'Quest, ' + zone,
      giver && 'Quest, ' + zone + ', ' + giver,
    ]);
  }
  for (const [id, mob] of Object.entries(MOBS)) {
    const own = gameQualifier(id, mob.name);
    const levels =
      mob.minLevel === mob.maxLevel
        ? 'level ' + mob.minLevel
        : 'levels ' + mob.minLevel + ' to ' + mob.maxLevel;
    add('mob', id, mob.name + ' (Mob)', ['', own, levels, own && own + ', ' + levels]);
  }
  // An item with a Heroic twin of the same name is the Normal one; otherwise it is the Item.
  const heroicNames = new Set(
    Object.values(ITEMS)
      .filter((i) => i.heroicOf || i.heroic)
      .map((i) => i.name),
  );
  for (const [id, item] of Object.entries(ITEMS)) {
    const heroic = !!(item.heroicOf || item.heroic);
    add(
      'item',
      id,
      item.name,
      heroic
        ? ['Heroic', 'Heroic item', 'Heroic, ' + gameQualifier(id, item.name)]
        : [heroicNames.has(item.name) ? 'Normal' : 'Item', 'Item'],
    );
  }

  const titles = assignTitles(entries, used);
  const out: Record<Kind, Map<string, string>> = {
    class: new Map(),
    ability: new Map(),
    zone: new Map(),
    dungeon: new Map(),
    npc: new Map(),
    quest: new Map(),
    mob: new Map(),
    item: new Map(),
  };
  for (const e of entries) {
    const split = e.key.indexOf('/');
    out[e.key.slice(0, split) as Kind].set(e.key.slice(split + 1), titles.get(e.key)!);
  }
  return out;
}
