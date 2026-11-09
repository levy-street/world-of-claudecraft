import { FINDER_ACTIVITIES, type FinderActivity } from '../../src/sim/content/dungeon_finder';
import { DUNGEON_LIST, DUNGEONS, MOBS, QUESTS, zoneContaining } from '../../src/sim/data';
import { IGNIVAR_LIFT_RIDE_SECONDS } from '../../src/sim/ignivar_forge_lift';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_TRASH_AUTOMATON_IDS,
} from '../../src/sim/ignivar_raid_ids';
import type { DungeonDef } from '../../src/sim/types';
import { activitySceneUrl } from '../../src/ui/dungeon_activity_art';
import type { ArticleTools } from './entity_format';
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
      'Form a raid group. In [[Dungeon Finder]], choose this raid and your difficulty. Automatic matching forms a group of ' +
        activity.size +
        ' players; the Finder level requirement is ' +
        band(activity) +
        '.',
      activity.attunementQuestId
        ? 'Complete ' +
          w.link(
            w.titleBy.quest.get(activity.attunementQuestId)!,
            QUESTS[activity.attunementQuestId].name,
          ) +
          ' on your character before crossing the sealed raid door. Queue eligibility does not replace this entry requirement.'
        : 'This raid has no attunement quest listed by the Dungeon Finder. Entry still requires a raid group and an eligible lockout.',
      'Travel to ' +
        location +
        ' and enter ' +
        roomLink(entrance) +
        '. Follow the room route below.',
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
          ? 'On a fresh run, wait ' +
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
          ? '. Continue through ' +
            door.name +
            ' at room coordinates (' +
            door.x +
            ', ' +
            door.z +
            ').'
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
        '. This guide covers the whole raid, including its approach and connected rooms.\n\n' +
        w.section(
          'Entry',
          w.table([
            [
              'Group',
              activity.size +
                ' players. Finder composition: ' +
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
                '. Open the boss guide for Normal and Heroic mechanics, role advice and loot.',
            ),
          ),
        ) +
        w.section(
          'Rewards and repeat runs',
          'Open each boss guide for its drops and follow an item link for exact acquisition conditions. Normal and Heroic rewards can differ. See [[Party loot]] for distribution rules and [[Weekly Vault]] for weekly reward progress.\n\n' +
            (activity.lockout === 'weekly'
              ? 'Crucible boss-room lockouts last until the weekly reset. Clearing the first boss does not by itself mean the second boss is cleared.'
              : 'Nythraxis uses a daily final-boss lockout. Check your saved run before arranging another clear.'),
        ) +
        questMap({ points }, 'system', [
          'Boss markers show their starting areas. Collect loot from the actual corpse after the fight.',
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
    'Raids are larger group adventures. Each entry below covers one complete raid; its connected rooms are described inside the guide.\n\n' +
      w.bullets(raidRows),
    ['Portals'],
  );
  const fivePlayer = FINDER_ACTIVITIES.filter(
    (a) => a.kind === 'dungeon' && a.difficulty === 'normal',
  );
  const listed = new Set(fivePlayer.map((a) => a.dungeonId));
  const others = DUNGEON_LIST.filter((d) => !listed.has(d.id) && !parentByRoom.has(d.id));
  w.add(
    'Dungeons',
    'Entrances, boss strategies, routes and rewards for every dungeon and raid.\n\n' +
      w.section(
        'Five-player dungeons',
        'The levels below apply to [[Dungeon Finder]]. Heroic matching requires level 20; individual entrance requirements are listed in each guide.\n\n' +
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
        'Ten-player encounters with Normal and Heroic difficulties. Each guide covers the full raid from entrance to final boss.\n\n' +
          w.bullets(raidRows),
      ) +
      w.section(
        'Attunement and other interiors',
        w.bullets([
          ...FINDER_ACTIVITIES.filter((a) => a.kind === 'solo').map(
            (a) =>
              roomLink(DUNGEONS[a.dungeonId]) +
              ' · Attunement adventure leading to ' +
              w.link(parentByRoom.get(a.dungeonId)!) +
              '. Designed for solo play; social listings allow up to ' +
              a.size +
              ' players.',
          ),
          ...others.map(
            (d) =>
              roomLink(d) +
              (d.guideVisible === false
                ? ' · Unlisted in the in-game Guide.'
                : ' · Exploration and quest location.'),
          ),
        ]),
      ) +
      w.section(
        'Before you enter',
        'Use [[Dungeon Finder]] to form a group, check [[Heroic difficulty]] before a Heroic run, and read [[Party loot]] and [[Death and recovery]] for loot and recovery rules.',
      ),
    ['Portals'],
  );
  return parentByRoom;
}
