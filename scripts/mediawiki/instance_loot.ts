import { FINDER_ACTIVITIES, type FinderActivity } from '../../src/sim/content/dungeon_finder';
import { DUNGEONS, ITEMS, MOBS } from '../../src/sim/data';
import type { DungeonDef } from '../../src/sim/types';
import { raidName, raidRooms } from './dungeon_catalog';
import type { ArticleTools } from './entity_format';
import { browseName, browseTable } from './item_browse_table';
import { acquisitionRows, type SourceWriter } from './item_source_groups';
import type { GearItem } from './item_tables';

// Every item a dungeon or raid gives, on Normal and on Heroic, read from the same drop
// rows the item pages print (creature loot tables, Heroic swaps and Heroic-only boss
// loot) plus the items you pick up inside. One page per dungeon and raid.

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
};
export type InstanceKind = 'Five-player dungeons' | 'Raids' | 'Attunement adventures';
export interface InstanceLoot {
  /** The Finder activity's dungeon id: the dungeon, or a raid's first room. */
  id: string;
  name: string;
  kind: InstanceKind;
  rooms: DungeonDef[];
  /** Item id to the creatures that drop it. */
  normal: Map<string, Set<string>>;
  heroic: Map<string, Set<string>>;
  /** Items picked up inside (not from a creature). */
  found: Set<string>;
}

const KINDS: Record<FinderActivity['kind'], InstanceKind> = {
  dungeon: 'Five-player dungeons',
  raid: 'Raids',
  solo: 'Attunement adventures',
};
const DROP = /^Defeat \[\[([^\]|]+).*\((Normal and Heroic|Normal|Heroic|ordinary) drop\)$/;
const FOUND = /^Collect inside (.+)$/;

/** Each Finder dungeon, raid and attunement adventure with the loot found in it. */
export function instanceLoot(w: SourceWriter) {
  const activities = new Map<string, FinderActivity>();
  for (const a of FINDER_ACTIVITIES)
    if (!activities.has(a.dungeonId)) activities.set(a.dungeonId, a);
  // A raid's route can pass through a place that is its own activity (the Abandoned
  // Crypt); that place keeps its own loot list.
  const owned = new Set(
    [...activities.values()].filter((a) => a.kind !== 'raid').map((a) => a.dungeonId),
  );
  const list: InstanceLoot[] = [...activities.values()].map((a) => ({
    id: a.dungeonId,
    name: a.kind === 'raid' ? raidName(a) : DUNGEONS[a.dungeonId].name,
    kind: KINDS[a.kind],
    rooms:
      a.kind === 'raid' ? raidRooms(a).filter((r) => !owned.has(r.id)) : [DUNGEONS[a.dungeonId]],
    normal: new Map(),
    heroic: new Map(),
    found: new Set(),
  }));
  const byRoomName = new Map<string, InstanceLoot>();
  for (const loot of list) for (const room of loot.rooms) byRoomName.set(room.name, loot);
  const mobByTitle = new Map([...w.titleBy.mob].map(([id, title]) => [title, id]));
  const add = (map: Map<string, Set<string>>, item: string, mob: string) =>
    map.set(item, (map.get(item) ?? new Set()).add(mob));
  for (const [itemId, rows] of acquisitionRows(w))
    for (const row of rows) {
      const found = FOUND.exec(row.title);
      if (found) byRoomName.get(found[1])?.found.add(itemId);
      const drop = DROP.exec(row.title);
      const mob = drop && mobByTitle.get(drop[1]);
      if (!drop || !mob) continue;
      // Where the drop row's map says to loot the body: the rooms that hold it.
      const places = new Set(
        (row.points ?? [])
          .filter((p) => p.step === 2 && p.frame !== 'Overworld')
          .map((p) => byRoomName.get(p.frame))
          .filter((l): l is InstanceLoot => !!l),
      );
      for (const loot of places) {
        if (drop[2] !== 'Heroic') add(loot.normal, itemId, mob);
        if (drop[2] === 'Heroic' || drop[2] === 'Normal and Heroic') add(loot.heroic, itemId, mob);
      }
    }
  return list.filter((l) => l.normal.size || l.heroic.size || l.found.size);
}

// Pages each dungeon and raid article links to, filled when the pages are written.
const lootPages = new Map<string, { title: string; name: string }>();
const lootByTitle = new Map<string, { title: string; name: string; kind: InstanceKind }>();

/** The loot page for a dungeon, raid or raid room, once the pages have been written. */
export function instanceLootPage(dungeonId: string) {
  return lootPages.get(dungeonId);
}
/** Every loot page by kind, in Finder order, for the Dungeons and raids hub. */
export function instanceLootPages(): { title: string; name: string; kind: InstanceKind }[] {
  return [...lootByTitle.values()];
}

export function addInstanceLootPages(w: Writer) {
  lootPages.clear();
  lootByTitle.clear();
  const mobLink = (id: string) => {
    const title = w.titleBy.mob.get(id);
    return title ? w.link(title, MOBS[id].name) : MOBS[id].name;
  };
  const rows = (ids: Iterable<string>): GearItem[] =>
    [...ids]
      .filter((id) => w.titleBy.item.has(id))
      .map((id) => ({ id, title: w.titleBy.item.get(id)!, name: browseName(ITEMS[id]) }));
  for (const loot of instanceLoot(w)) {
    const title = w.reserve(loot.name + ' loot (Items index)');
    const dropTable = (map: Map<string, Set<string>>) =>
      browseTable(rows(map.keys()), [
        {
          heading: 'Dropped by',
          cell: (id) =>
            [...map.get(id)!]
              .sort((a, b) => MOBS[a].name.localeCompare(MOBS[b].name, 'en'))
              .map(mobLink)
              .join(', '),
        },
      ]);
    const room = DUNGEONS[loot.id];
    const guide = w.titleBy.dungeon.get(loot.id);
    const sections = [
      loot.normal.size
        ? w.section(
            'Normal',
            'These ' +
              rows(loot.normal.keys()).length +
              ' items can drop on Normal difficulty.\n\n' +
              dropTable(loot.normal),
          )
        : '',
      loot.heroic.size
        ? w.section(
            'Heroic',
            'These ' +
              rows(loot.heroic.keys()).length +
              ' items can drop on Heroic difficulty. Some are stronger Heroic copies of Normal items and carry the same name.\n\n' +
              dropTable(loot.heroic),
          )
        : '',
      loot.found.size
        ? w.section(
            'Found inside',
            'You pick these up inside rather than from a creature.\n\n' +
              browseTable(rows(loot.found)),
          )
        : '',
    ];
    w.add(
      title,
      w.link('Dungeons', 'Back to dungeons and raids') +
        '\n\n' +
        'Every item that can drop in ' +
        loot.name +
        ', on each difficulty. Select a column heading to sort, or use the filters above a table. ' +
        (guide
          ? 'For the way in and the boss fights, see ' + w.link(guide, room.name) + '. '
          : '') +
        'Drop chances are on each item page. See [[Party loot]] for how loot is shared.\n\n' +
        sections.join(''),
      ['Portals'],
    );
    const page = { title, name: loot.name, kind: loot.kind };
    lootByTitle.set(title, page);
    lootPages.set(loot.id, page);
    for (const room of loot.rooms) if (!lootPages.has(room.id)) lootPages.set(room.id, page);
  }
}
