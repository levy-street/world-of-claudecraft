import { HEROIC_DUNGEON_TUNING } from '../../src/sim/content/dungeon_difficulty';
import type { DungeonDef } from '../../src/sim/types';

interface Writer {
  section(name: string, text: string): string;
  table(rows: string[][]): string;
  bullets(lines: string[]): string;
  mob(id: string): string;
}

export function dungeonDetails(dungeon: DungeonDef, { section, bullets, table, mob }: Writer) {
  const rows = [
    ['Suggested group', dungeon.suggestedPlayers + ' players'],
    [
      'Entrance',
      dungeon.overworldDoor === false
        ? 'Enter from a connected instance.'
        : 'Overworld entrance at (' + dungeon.doorPos.x + ', ' + dungeon.doorPos.z + ').',
    ],
  ];
  let text = section('Entry', table(rows));
  if (dungeon.bossChainPull)
    text += section(
      'Pulling the final boss',
      'Engaging the final boss while other enemies are alive and idle pulls those enemies into the fight.',
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
              ? 'Clear the required groups and bosses: ' + [...enemies].map(mob).join(', ') + '.'
              : '',
            g.sealWhileEngaged
              ? 'Seals during the fight with ' + mob(g.sealWhileEngaged) + '.'
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
        ['Heroic Marks', h.marksPerParticipant + ' per eligible participant at the final boss.'],
        ['Enemy level', String(h.level)],
        ['Default health', h.healthMultiplier + ' × base'],
        ['Default melee damage', h.damageMultiplier + ' × base'],
        ['Summoned add melee damage', h.addDamageMultiplier + ' × base'],
        ['Armor', h.armorMultiplier + ' × base'],
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
            .map(([name, value]) => name + ' × ' + value + ' instead of the default')
            .join(', '),
        ]),
      ]),
    );
  return text;
}
