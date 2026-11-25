import { HEROIC_DUNGEON_TUNING } from '../../src/sim/content/dungeon_difficulty';
import { FINDER_ACTIVITIES } from '../../src/sim/content/dungeon_finder';
import type { DungeonDef } from '../../src/sim/types';
import { instanceLootPage } from './instance_loot';

interface Writer {
  section(name: string, text: string): string;
  table(rows: string[][]): string;
  bullets(lines: string[]): string;
  mob(id: string): string;
}

// Heroic multipliers are stored as raw ratios (1.6666666666666667); show them rounded.
const times = (value: number) => String(Number(value.toFixed(3)));
const levelBand = (min: number, max: number) => (min === max ? String(min) : min + ' to ' + max);

export function dungeonDetails(dungeon: DungeonDef, { section, bullets, table, mob }: Writer) {
  // The Dungeon Finder's own list for this dungeon (five-player dungeons and the solo crypt;
  // a raid's rooms are covered by the raid guide).
  const finder = FINDER_ACTIVITIES.filter((a) => a.dungeonId === dungeon.id && a.kind !== 'raid');
  const rows = [
    [
      'Suggested group',
      dungeon.suggestedPlayers + (dungeon.suggestedPlayers === 1 ? ' player' : ' players'),
    ],
    ...(finder.length
      ? [
          [
            'Finder levels',
            finder
              .map(
                (a) =>
                  (a.difficulty === 'heroic' ? 'Heroic' : 'Normal') +
                  ': ' +
                  levelBand(a.minLevel, a.maxLevel),
              )
              .join('; '),
          ],
        ]
      : []),
    [
      'Entrance',
      dungeon.overworldDoor === false
        ? 'Enter it from a connected dungeon area.'
        : 'Entrance in the outside world at (' +
          dungeon.doorPos.x +
          ', ' +
          dungeon.doorPos.z +
          ').',
    ],
  ];
  let text = section('Entry', table(rows));
  if (finder.length) {
    const encounters = finder[0].encounters;
    text += section(
      'Encounters',
      'The Dungeon Finder lists ' +
        encounters.length +
        (encounters.length === 1 ? ' encounter' : ' encounters') +
        ' here, in this order.\n\n' +
        bullets(
          encounters.map(
            (e, i) =>
              mob(e.mobId) +
              ' · Encounter ' +
              (i + 1) +
              (e.final ? ', the final boss' : '') +
              (e.summoned ? ', appears when you set it off' : ''),
          ),
        ),
    );
  }
  if (dungeon.bossChainPull)
    text += section(
      'Pulling the final boss',
      'If you attack the final boss while other enemies are still alive and not fighting, they join the fight too.',
    );
  if (dungeon.gates?.length)
    text += section(
      'Doors and encounter seals',
      bullets(
        dungeon.gates.map((g) => {
          const enemies = new Set(g.bosses);
          for (const s of dungeon.spawns)
            if (s.packId && g.packs?.includes(s.packId)) enemies.add(s.mobId);
          return [
            g.name + '.',
            enemies.size
              ? 'Defeat these enemies and bosses to open it: ' +
                [...enemies].map(mob).join(', ') +
                '.'
              : '',
            g.sealWhileEngaged
              ? 'It closes while you are fighting ' + mob(g.sealWhileEngaged) + '.'
              : '',
          ]
            .filter(Boolean)
            .join(' ');
        }),
      ),
    );
  const h = HEROIC_DUNGEON_TUNING[dungeon.id];
  if (h)
    text += section(
      'Heroic difficulty',
      table([
        ['Final boss', mob(h.finalBossId)],
        [
          'Heroic Marks',
          h.marksPerParticipant + ' for each player who can get them, given at the final boss.',
        ],
        ['Enemy level', String(h.level)],
        ['Default health', times(h.healthMultiplier) + ' × base'],
        ['Default melee damage', times(h.damageMultiplier) + ' × base'],
        ['Summoned add melee damage', times(h.addDamageMultiplier) + ' × base'],
        ['Armor', times(h.armorMultiplier) + ' × base'],
        ...Object.keys({
          ...h.healthMultiplierByMob,
          ...h.damageMultiplierByMob,
          ...h.mechanicDamageMultiplierByMob,
          ...h.burnDamageMultiplierByMob,
        }).map((id) => [
          mob(id),
          [
            ['Health', h.healthMultiplierByMob?.[id]],
            ['Melee damage', h.damageMultiplierByMob?.[id]],
            ['Mechanic damage', h.mechanicDamageMultiplierByMob?.[id]],
            ['Burn damage', h.burnDamageMultiplierByMob?.[id]],
          ]
            .filter((pair) => pair[1] != null)
            .map(
              ([name, value]) => name + ' × ' + times(value as number) + ' instead of the default',
            )
            .join(', '),
        ]),
      ]),
    );
  const loot = instanceLootPage(dungeon.id);
  if (loot)
    text += section(
      'Loot',
      'Every item that drops in ' +
        loot.name +
        ', on Normal and on Heroic, is listed on [[' +
        loot.title +
        '|' +
        loot.name +
        ' loot]].',
    );
  return text;
}
