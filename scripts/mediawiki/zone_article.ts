import { FINDER_ACTIVITIES } from '../../src/sim/content/dungeon_finder';
import {
  DELVE_LIST,
  DUNGEON_LIST,
  gatherNodesInActiveWorld,
  MOBS,
  NPCS,
  PORTALS,
  QUESTS,
  ZONES,
  zoneContaining,
} from '../../src/sim/data';
import { worldPvpZonePolicyOf } from '../../src/sim/pvp/world_pvp_zones';
import type { GatherNodeType, ZoneDef } from '../../src/sim/types';
import { ROLE_SECTIONS } from './creature_role';
import { questZoneName } from './entity_articles';
import type { ArticleTools } from './entity_format';
import { homeZones } from './npc_article';
import { levelText, rankWord, zoneCreatures } from './zone_creatures';

/** What the zone article needs from the seed writer. */
export type ZoneWriter = Pick<ArticleTools, 'link' | 'section' | 'bullets' | 'titleBy'> & {
  /** Every page title the seed has reserved, to link a page only when it exists. */
  usedTitles: Set<string>;
  /** Raid room id to its raid guide title (addDungeonCatalog's result). */
  raidParents: Map<string, string>;
  /** Zone id to its enemies-by-zone index page, when one was written. */
  enemyIndex?: Map<string, string>;
};

const at = (p: { x: number; z: number }) => '(' + p.x + ', ' + p.z + ')';
const band = (min: number, max: number) => (min === max ? String(min) : min + ' to ' + max);

// src/sim/pvp/world_pvp_zones.ts: a zone with no worldPvp field is contested.
const PVP_TEXT = {
  sanctuary: 'Sanctuary. Players cannot fight each other here, flagged or not.',
  contested: 'Contested. Two players can fight here only if both have their PvP flag on.',
  ffa: 'Free for all. Every player here can be attacked, with or without a PvP flag.',
} as const;

/** Extra rows for the zone's Facts table. */
export function zoneFactRows(zone: ZoneDef, w: Pick<ZoneWriter, 'link'>): [string, string][] {
  return [
    ['World PvP', PVP_TEXT[worldPvpZonePolicyOf(zone)] + ' See ' + w.link('World PvP') + '.'],
  ];
}

/** Dungeon, raid, interior and delve doors that stand in this zone. */
export function zoneEntrances(zone: ZoneDef, w: ZoneWriter): string[] {
  const rows: string[] = [];
  const raidsListed = new Set<string>();
  for (const d of DUNGEON_LIST) {
    if (d.overworldDoor === false) continue;
    if (zoneContaining(d.doorPos.x, d.doorPos.z)?.id !== zone.id) continue;
    const raid = w.raidParents.get(d.id);
    if (raid) {
      if (raidsListed.has(raid)) continue;
      raidsListed.add(raid);
      const modes = FINDER_ACTIVITIES.filter(
        (a) => a.kind === 'raid' && w.raidParents.get(a.dungeonId) === raid,
      );
      const size = modes[0]?.size;
      rows.push(
        [
          w.link(raid, raid.replace(/ \(Raid\)(?: \(\d+\))?$/, '')),
          'Raid' + (size ? ' for ' + size + ' players' : ''),
          ...(modes.length
            ? [
                'Level ' +
                  band(
                    Math.min(...modes.map((a) => a.minLevel)),
                    Math.max(...modes.map((a) => a.maxLevel)),
                  ),
              ]
            : []),
          'Entrance at ' + at(d.doorPos),
        ].join(' · '),
      );
      continue;
    }
    const title = w.titleBy.dungeon.get(d.id);
    const name = title ? w.link(title, d.name) : d.name;
    const modes = FINDER_ACTIVITIES.filter((a) => a.dungeonId === d.id && a.kind === 'dungeon');
    const normal = modes.find((a) => a.difficulty === 'normal');
    const heroic = modes.find((a) => a.difficulty === 'heroic');
    const kind = modes.length
      ? [
          'Dungeon',
          ...(normal ? ['Level ' + band(normal.minLevel, normal.maxLevel)] : []),
          ...(heroic ? ['Heroic at level ' + band(heroic.minLevel, heroic.maxLevel)] : []),
        ]
      : ['Quest and exploring location'];
    rows.push([name, ...kind, 'Entrance at ' + at(d.doorPos)].join(' · '));
  }
  for (const d of DELVE_LIST) {
    if (zoneContaining(d.doorPos.x, d.doorPos.z)?.id !== zone.id) continue;
    const title = d.name + ' (Delve)';
    rows.push(
      [
        w.usedTitles.has(title) ? w.link(title, d.name) : d.name,
        'Delve from level ' + d.minLevel,
        'Entrance at ' + at(d.doorPos),
      ].join(' · '),
    );
  }
  return rows;
}

/** Enemies and other creatures from the zone's camps, with the levels they spawn at here. */
function creatureSections(zone: ZoneDef, w: ZoneWriter): string {
  const all = zoneCreatures(zone.id);
  const mobLink = (id: string, name: string) => {
    const title = w.titleBy.mob.get(id);
    return title ? w.link(title, name) : name;
  };
  const enemies = all
    .filter((c) => c.role === 'enemy')
    .map((c) =>
      [mobLink(c.mobId, c.name), levelText(c.min, c.max), rankWord(MOBS[c.mobId])]
        .filter(Boolean)
        .join(' · '),
    );
  const others = all
    .filter((c) => c.role !== 'enemy')
    .map((c) =>
      [
        mobLink(c.mobId, c.name),
        levelText(c.min, c.max),
        ROLE_SECTIONS[c.role as Exclude<typeof c.role, 'enemy'>],
      ].join(' · '),
    );
  const index = w.enemyIndex?.get(zone.id);
  return (
    (enemies.length
      ? w.section(
          'Enemies',
          'These enemies live out in ' +
            zone.name +
            '. The levels are the ones they have in this zone.' +
            (index ? ' ' + w.link(index, 'See them sorted by rank') + '.' : '') +
            '\n\n' +
            w.bullets(enemies),
        )
      : '') + (others.length ? w.section('Other creatures', w.bullets(others)) : '')
  );
}

/** Two-way portals with one side in this zone. */
export function zonePortals(zone: ZoneDef, w: ZoneWriter): string[] {
  const rows: string[] = [];
  const zoneLink = (z: ZoneDef | null) =>
    z ? w.link(w.titleBy.zone.get(z.id) ?? z.name, z.name) : 'another place';
  for (const p of PORTALS) {
    const a = zoneContaining(p.a.x, p.a.z);
    const b = zoneContaining(p.b.x, p.b.z);
    if (a?.id === zone.id)
      rows.push(
        'A portal at ' + at(p.a) + ' takes you to ' + zoneLink(b) + ' ' + at(p.b.landing) + '.',
      );
    if (b?.id === zone.id)
      rows.push(
        'A portal at ' + at(p.b) + ' takes you to ' + zoneLink(a) + ' ' + at(p.a.landing) + '.',
      );
  }
  return rows;
}

const GATHER: Record<GatherNodeType, { what: string; page: string }> = {
  ore: { what: 'ore', page: 'Mining' },
  wood: { what: 'wood', page: 'Logging' },
  herb: { what: 'herb', page: 'Herbalism' },
};

/** Gathering nodes in the zone, counted by kind and tier. */
export function zoneGathering(zone: ZoneDef, w: Pick<ZoneWriter, 'link'>): string[] {
  const counts = new Map<GatherNodeType, Map<number, number>>();
  for (const n of gatherNodesInActiveWorld()) {
    if (n.zoneId !== zone.id) continue;
    const tiers = counts.get(n.type) ?? new Map<number, number>();
    tiers.set(n.tier, (tiers.get(n.tier) ?? 0) + 1);
    counts.set(n.type, tiers);
  }
  return (['ore', 'wood', 'herb'] as const)
    .filter((type) => counts.has(type))
    .map((type) => {
      const tiers = [...counts.get(type)!].sort(([a], [b]) => a - b);
      const total = tiers.reduce((sum, [, n]) => sum + n, 0);
      const { what, page } = GATHER[type];
      return (
        w.link(page) +
        ': ' +
        total +
        ' ' +
        what +
        (total === 1 ? ' node' : ' nodes') +
        ' (' +
        tiers.map(([tier, n]) => n + ' at tier ' + tier).join(', ') +
        ').'
      );
    });
}

/** The whole zone article. The first sections are the ones build_seed always wrote. */
export function zoneArticle(
  zone: ZoneDef,
  w: ZoneWriter & Pick<ArticleTools, 'table'> & { zoneDirectories: Map<string, string> },
): string {
  const npcs = Object.keys(NPCS)
    .filter((id) => homeZones(id).some((z) => z.id === zone.id))
    .map((id) => w.titleBy.npc.get(id)!);
  const quests = Object.keys(QUESTS)
    .filter((id) => !QUESTS[id].seasonalEvent && questZoneName(QUESTS[id]) === zone.name)
    .map((id) => w.titleBy.quest.get(id)!);
  const [low, high] = zone.levelRange;
  const directory = w.zoneDirectories.get(zone.name);
  return (
    w.section('Overview', zone.welcome) +
    w.section(
      'Facts',
      w.table([
        ['Level range', low === high ? String(low) : low + '-' + high],
        ['Hub', zone.hub.name],
        ['Graveyard', zone.graveyard.x + ', ' + zone.graveyard.z],
        ...zoneFactRows(zone, w),
      ]),
    ) +
    w.section('Points of interest', w.bullets(zone.pois.map((poi) => poi.label))) +
    w.section('NPCs', w.bullets(npcs.map((title) => w.link(title)))) +
    w.section(
      'Quests starting here',
      (directory ? w.link(directory, 'See all quests in ' + zone.name) + '\n\n' : '') +
        w.bullets(quests.map((title) => w.link(title))),
    ) +
    zoneArticleSections(zone, w)
  );
}

/** The data sections a zone article adds after its NPC and quest lists. */
export function zoneArticleSections(zone: ZoneDef, w: ZoneWriter): string {
  const entrances = zoneEntrances(zone, w);
  const portals = zonePortals(zone, w);
  const gathering = zoneGathering(zone, w);
  return (
    (entrances.length ? w.section('Dungeons, raids and delves', w.bullets(entrances)) : '') +
    creatureSections(zone, w) +
    (portals.length ? w.section('Portals', w.bullets(portals)) : '') +
    (gathering.length
      ? w.section(
          'Gathering',
          'Nodes you can gather from in this zone. A higher tier node needs a better gathering tool.\n\n' +
            w.bullets(gathering),
        )
      : '')
  );
}

/** Zones in the order the Zones hub lists them: by level, then name. */
export function zonesByLevel(): ZoneDef[] {
  return [...ZONES].sort(
    (a, b) =>
      a.levelRange[0] - b.levelRange[0] ||
      a.levelRange[1] - b.levelRange[1] ||
      a.name.localeCompare(b.name, 'en'),
  );
}
