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
import { assignTitles, idQualifier, type TitleEntry } from './title_names';

type Kind = 'class' | 'ability' | 'zone' | 'dungeon' | 'npc' | 'quest' | 'mob' | 'item';

const present = (hints: (string | undefined | false)[]) => [
  ...new Set(hints.filter((h): h is string => typeof h === 'string')),
];

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
        idQualifier(id, ability.name),
      ]);
  for (const zone of ZONES) add('zone', zone.id, zone.name, ['', 'Zone']);
  for (const dungeon of DUNGEON_LIST) add('dungeon', dungeon.id, dungeon.name, ['', 'Dungeon']);
  for (const [id, npc] of Object.entries(NPCS)) {
    const posted = npc.pos.x !== 0 || npc.pos.z !== 0;
    const place =
      (posted ? zoneContaining(npc.pos.x, npc.pos.z)?.name : undefined) ??
      DUNGEON_LIST.find((d) => d.npcs?.some((s) => s.npcId === id))?.name;
    const own = idQualifier(id, npc.name);
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
    const own = idQualifier(id, mob.name);
    const levels =
      mob.minLevel === mob.maxLevel
        ? 'level ' + mob.minLevel
        : 'levels ' + mob.minLevel + ' to ' + mob.maxLevel;
    add('mob', id, mob.name + ' (Mob)', ['', own, levels, own && own + ', ' + levels]);
  }
  for (const [id, item] of Object.entries(ITEMS)) {
    const heroic = !!(item.heroicOf || item.heroic);
    add(
      'item',
      id,
      item.name,
      heroic ? ['Heroic', 'Heroic item', 'Heroic, ' + idQualifier(id, item.name)] : ['', 'Item'],
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
