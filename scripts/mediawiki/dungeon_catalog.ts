import { FINDER_ACTIVITIES, type FinderActivity } from '../../src/sim/content/dungeon_finder';
import {
  DELVE_LIST,
  DUNGEON_LIST,
  DUNGEONS,
  MOBS,
  QUESTS,
  zoneContaining,
} from '../../src/sim/data';
import { IGNIVAR_LIFT_RIDE_SECONDS } from '../../src/sim/ignivar_forge_lift';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_TRASH_AUTOMATON_IDS,
} from '../../src/sim/ignivar_raid_ids';
import { RIFT_MIN_LEVEL } from '../../src/sim/rift/portals';
import { RIFT_RANK_BASE_LEVEL } from '../../src/sim/rift/ranks';
import type { DungeonDef } from '../../src/sim/types';
import { activitySceneUrl } from '../../src/ui/dungeon_activity_art';
import type { ArticleTools } from './entity_format';
import { instanceLootPage, instanceLootPages } from './instance_loot';
import { questMap, type RoutePoint } from './quest_map';
import { entranceRoute } from './rotating_routes';

type Writer = Pick<ArticleTools, 'titleBy' | 'link' | 'section' | 'table' | 'bullets' | 'add'> & {
  reserve(title: string): string;
};
export interface RaidGuide {
  title: string;
  name: string;
  activity: FinderActivity;
  rooms: DungeonDef[];
}

/** The name players know a raid by (Nythraxis is named for its boss, not its arena). */
/** Instances outside the Finder and raids: quest and exploration interiors, listed with zones. */
export function questInteriors(): DungeonDef[] {
  const finder = new Set(FINDER_ACTIVITIES.map((a) => a.dungeonId));
  const raid = new Set(
    FINDER_ACTIVITIES.filter((a) => a.kind === 'raid').flatMap((a) =>
      raidRooms(a).map((r) => r.id),
    ),
  );
  return DUNGEON_LIST.filter((d) => !finder.has(d.id) && !raid.has(d.id));
}

export function raidName(activity: FinderActivity): string {
  return activity.dungeonId === 'nythraxis_boss_arena'
    ? 'Nythraxis'
    : DUNGEONS[activity.dungeonId].name;
}

export function raidRooms(activity: FinderActivity): DungeonDef[] {
  const rooms = new Map<string, DungeonDef>();
  for (const id of [activity.dungeonId, ...(activity.lockoutDungeonIds ?? [])]) {
    for (const room of entranceRoute(DUNGEONS[id])) rooms.set(room.id, room);
  }
  return [...rooms.values()];
}

const lootLine = (dungeonId: string) => {
  const page = instanceLootPage(dungeonId);
  return page
    ? '\n\nSee every item it drops on [[' + page.title + '|' + page.name + ' loot]].'
    : '';
};
const band = (a: FinderActivity) =>
  a.minLevel === a.maxLevel ? String(a.minLevel) : a.minLevel + ' to ' + a.maxLevel;
const tier = (a: FinderActivity) => (a.difficulty === 'heroic' ? 'Heroic' : 'Normal');

export function addDungeonCatalog(w: Writer): Map<string, string> {
  const parentByRoom = new Map<string, string>();
  const raidGuides: RaidGuide[] = [];
  const roomLink = (room: DungeonDef) => w.link(w.titleBy.dungeon.get(room.id)!, room.name);
  const mobLink = (id: string) => w.link(w.titleBy.mob.get(id)!, MOBS[id].name);
  const variants = (id: string) => FINDER_ACTIVITIES.filter((a) => a.dungeonId === id);
  for (const activity of FINDER_ACTIVITIES.filter(
    (a) => a.kind === 'raid' && a.difficulty === 'normal',
  )) {
    const name = raidName(activity);
    const title = w.reserve(name + ' (Raid)');
    const rooms = raidRooms(activity);
    raidGuides.push({ title, name, activity, rooms });
    for (const room of rooms) parentByRoom.set(room.id, title);
    const entrance = DUNGEONS[activity.entranceDungeonId];
    const zone = zoneContaining(entrance.doorPos.x, entrance.doorPos.z);
    const zoneLink = zone ? w.link(w.titleBy.zone.get(zone.id)!, zone.name) : 'the overworld';
    const location = zoneLink + ' at (' + entrance.doorPos.x + ', ' + entrance.doorPos.z + ')';
    const steps = [
      'Form a raid group. Open the [[Dungeon Finder]] and choose this raid and a difficulty. The Finder puts together a group of ' +
        activity.size +
        ' players. To join through the Finder, your level must be ' +
        band(activity) +
        '.',
      activity.attunementQuestId
        ? 'Complete ' +
          w.link(
            w.titleBy.quest.get(activity.attunementQuestId)!,
            QUESTS[activity.attunementQuestId].name,
          ) +
          ' on this character before you go through the sealed raid door. Being allowed to join the queue does not count as finishing it.'
        : 'The Dungeon Finder lists no attunement quest for this raid. To enter, you still need a raid group, and you must not be locked out.',
      'Go to ' +
        location +
        ' and enter ' +
        roomLink(entrance) +
        '. Then go through the rooms in the order below.',
    ];
    const points: RoutePoint[] = [
      { step: 'Start', frame: 'Overworld', label: 'Entrance to ' + name, ...entrance.doorPos },
    ];
    const roomRows = rooms.map((room, i) => {
      const next = rooms[i + 1];
      const door = next && room.objects?.find((object) => object.dungeonId === next.id);
      const bosses = activity.encounters.filter((e) =>
        room.spawns.some((spawn) => spawn.mobId === e.mobId),
      );
      for (const boss of bosses) {
        const spawn = room.spawns.find((s) => s.mobId === boss.mobId)!;
        points.push({
          step: 'Reward',
          frame: room.name,
          label: MOBS[boss.mobId].name + ' starting area; loot the defeated boss',
          x: spawn.x,
          z: spawn.z,
        });
      }
      if (door)
        points.push({
          step: i + 1,
          frame: room.name,
          label: door.name + ' to ' + next.name,
          x: door.x,
          z: door.z,
        });
      const unlock =
        room.id === IGNIVAR_LIFT_ROOM_ID
          ? 'On a new run, wait ' +
            IGNIVAR_LIFT_RIDE_SECONDS +
            ' seconds for the forge-lift to arrive and its gate to open'
          : room.id === IGNIVAR_FORGE_APPROACH_ID || room.id === IGNIVAR_MOLTEN_ASSEMBLY_ID
            ? 'Defeat every ' +
              IGNIVAR_TRASH_AUTOMATON_IDS.map(mobLink).join(' and ') +
              ' in this room to open the next gate'
            : room.id === IGNIVAR_RAID_ARENA_ID
              ? 'Defeat ' +
                mobLink(activity.encounters[0].mobId) +
                ' to open the gate to the Molten Assembly'
              : '';
      return (
        roomLink(room) +
        (bosses.length ? ' · ' + bosses.map((b) => mobLink(b.mobId)).join(', ') : '') +
        (unlock ? '. ' + unlock : '') +
        (door
          ? '. Go through ' + door.name + ' at (' + door.x + ', ' + door.z + ') in this room.'
          : '.')
      );
    });
    const art = activitySceneUrl(activity.dungeonId);
    const modes = variants(activity.dungeonId);
    w.add(
      title,
      (art ? '<woc-art path="' + art + '" />\n' : '') +
        name +
        ' is a ' +
        activity.size +
        '-player raid with ' +
        activity.encounters.length +
        ' boss encounter' +
        (activity.encounters.length === 1 ? '' : 's') +
        '. This guide covers the whole raid, including the way in and every connected room.\n\n' +
        w.section(
          'Entry',
          w.table([
            [
              'Group',
              activity.size +
                ' players. A Finder group has ' +
                activity.composition!.tank +
                ' tanks, ' +
                activity.composition!.healer +
                ' healers and ' +
                activity.composition!.dps +
                ' damage dealers.',
            ],
            ['Difficulties', modes.map(tier).join(' and ')],
            ['Finder levels', modes.map((a) => tier(a) + ': ' + band(a)).join('; ')],
            ['Entrance', roomLink(entrance) + ' in ' + location],
            [
              'Lockout',
              activity.lockout === 'weekly'
                ? 'Weekly; the two boss rooms track their lockouts separately.'
                : 'Daily, after defeating the final boss.',
            ],
          ]),
        ) +
        w.section('Getting there and requirements', steps.map((s) => '# ' + s).join('\n')) +
        w.section('Route through the raid', roomRows.map((s) => '# ' + s).join('\n')) +
        w.section(
          'Boss encounters',
          w.bullets(
            activity.encounters.map(
              (encounter, i) =>
                mobLink(encounter.mobId) +
                ' · Encounter ' +
                (i + 1) +
                '. Open the boss page to see how the fight works on Normal and Heroic, tips for each role, and loot.',
            ),
          ),
        ) +
        w.section(
          'Rewards and repeat runs',
          'Each boss page lists what it drops. Click an item to see exactly how to get it. Normal and Heroic rewards can be different. See [[Party loot]] for how loot is shared, and [[Weekly Vault]] for weekly rewards.\n\n' +
            (activity.lockout === 'weekly'
              ? 'In the Crucible, each boss room has its own lockout. It lasts until the weekly reset. Beating the first boss does not count as beating the second.'
              : 'Nythraxis has a daily lockout that starts when you defeat the final boss. Check your saved run before you plan another clear.') +
            lootLine(activity.dungeonId),
        ) +
        questMap({ points }, 'system', [
          'Boss markers show where each boss starts. After the fight, loot the boss where its body lies.',
        ]) +
        w.section('Room reference', w.bullets(rooms.map(roomLink))),
      ['Raids'],
    );
  }
  const raidRows = raidGuides.map(
    (g) =>
      w.link(g.title, g.name) +
      ' · ' +
      g.activity.size +
      ' players · Normal and Heroic · ' +
      g.activity.encounters.length +
      ' boss encounter' +
      (g.activity.encounters.length === 1 ? '' : 's'),
  );
  w.add(
    'Raids',
    'Raids are adventures for big groups. Each entry below is one whole raid. Its connected rooms are covered inside its guide.\n\n' +
      w.bullets(raidRows),
    ['Portals'],
  );
  const fivePlayer = FINDER_ACTIVITIES.filter(
    (a) => a.kind === 'dungeon' && a.difficulty === 'normal',
  );
  w.add(
    'Dungeons',
    'Find the entrance, route, boss tips and rewards for every dungeon and raid.\n\n' +
      w.section(
        'Five-player dungeons',
        'The levels below are for the [[Dungeon Finder]]. You must be level 20 to be matched for Heroic. Each guide lists its own entrance rules.\n\n' +
          w.bullets(
            fivePlayer.map(
              (a) =>
                roomLink(DUNGEONS[a.dungeonId]) +
                ' · Normal Finder levels ' +
                band(a) +
                ' · Heroic available · ' +
                a.encounters.length +
                ' encounters',
            ),
          ),
      ) +
      w.section(
        'Raids',
        'Raids for ten players, on Normal or Heroic. Each guide covers the whole raid, from the entrance to the final boss.\n\n' +
          w.bullets(raidRows),
      ) +
      w.section(
        'Attunement adventures',
        w.bullets(
          FINDER_ACTIVITIES.filter((a) => a.kind === 'solo').map(
            (a) =>
              roomLink(DUNGEONS[a.dungeonId]) +
              ' · Attunement adventure for ' +
              w.link(parentByRoom.get(a.dungeonId)!) +
              '. Made to be played alone, but social listings allow up to ' +
              a.size +
              ' players.',
          ),
        ),
      ) +
      w.section(
        'Loot by dungeon and raid',
        'Every item each dungeon and raid can drop, on Normal and on Heroic, in one table you can sort.\n\n' +
          w.bullets(
            instanceLootPages().map(
              (p) => w.link(p.title, p.name) + ' · ' + p.kind.toLowerCase().replace(/s$/, ''),
            ),
          ),
      ) +
      w.section(
        'Delves',
        'Short runs in your own private copy, for a small group or for one player with a companion. See [[Delves]] for rewards and [[Delve companions]] for helpers you can hire.\n\n' +
          w.bullets(
            DELVE_LIST.map(
              (d) =>
                w.link(d.name + ' (Delve)', d.name) +
                ' · From level ' +
                d.minLevel +
                ' · Up to ' +
                d.maxPlayers +
                ' players',
            ),
          ),
      ) +
      w.section(
        'Rifts',
        'Portals with ranks, for level ' +
          RIFT_MIN_LEVEL +
          ' characters. You clear them one floor at a time. See [[Rifts]] to learn how to open one.\n\n' +
          w.bullets(
            (['C', 'B', 'A', 'S'] as const).map(
              (rank) =>
                w.link('Rank ' + rank + ' (Rift)', 'Rank ' + rank) +
                ' · Enemies from level ' +
                RIFT_RANK_BASE_LEVEL[rank],
            ),
          ),
      ) +
      w.section(
        'Before you enter',
        'Use the [[Dungeon Finder]] to form a group. Read [[Heroic difficulty]] before a Heroic run. See [[Party loot]] for how loot works, and [[Death and recovery]] for what happens when you die.',
      ),
    ['Portals'],
  );
  return parentByRoom;
}
