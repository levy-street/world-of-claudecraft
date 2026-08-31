import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { CRYPT_LAYOUT } from '../src/sim/dungeon_layout';
import {
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import { PLAYER_INTEREST_RADIUS } from '../src/sim/types';
import {
  buildDungeonMinimapModel,
  buildDungeonWorldMapModel,
  DungeonMapViewCore,
  dungeonMapActive,
  dungeonMapLocal,
} from '../src/ui/dungeon_map_view';
import { mapWindowMode } from '../src/ui/map_window_view';
import { minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';

interface EntityInput {
  id: number;
  kind: 'mob' | 'npc' | 'object';
  templateId: string;
  x: number;
  z: number;
  hostile?: boolean;
  dead?: boolean;
  lootable?: boolean;
  aggroTargetId?: number | null;
}

function worldIn(
  dungeonId: string,
  entities: readonly EntityInput[] = [],
  shape: 'sim' | 'client' = 'client',
): IWorld {
  const origin = instanceOrigin(DUNGEONS[dungeonId].index, 2);
  const player = {
    id: 1,
    kind: 'player',
    templateId: 'warrior',
    name: 'Mapper',
    pos: { x: origin.x, y: 0, z: origin.z },
    facing: Math.PI / 4,
  };
  const roster = new Map<number, unknown>([[player.id, player]]);
  for (const entity of entities) {
    roster.set(entity.id, {
      ...entity,
      name: entity.templateId,
      pos: { x: origin.x + entity.x, y: 0, z: origin.z + entity.z },
      hostile: entity.hostile ?? false,
      dead: entity.dead ?? false,
      lootable: entity.lootable ?? false,
      aggroTargetId: entity.aggroTargetId ?? null,
      ...(shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {}),
    });
  }
  return {
    player,
    entities: roster,
    partyInfo: null,
    riftFloor: null,
    delveRun: null,
  } as unknown as IWorld;
}

describe('generic dungeon map view', () => {
  it('uses the live entity-entry radius rather than the wider retention edge', () => {
    expect(PLAYER_INTEREST_RADIUS).toBe(90);
  });

  it.each(['hollow_crypt', IGNIVAR_MOLTEN_ASSEMBLY_ID])(
    'routes %s to the interior map on both HUD surfaces',
    (dungeonId) => {
      const world = worldIn(dungeonId);
      expect(dungeonMapActive(world)).toBe(true);
      expect(mapWindowMode(world)).toBe('dungeon');
      expect(minimapMode(world)).toBe('dungeon');
      expect(dungeonMapLocal(world.player.pos.x, world.player.pos.z)?.dungeonId).toBe(dungeonId);
    },
  );

  it('projects the authoritative generic layout instead of an Ignivar-only copy', () => {
    const model = buildDungeonWorldMapModel(worldIn('hollow_crypt'), 560, 34);
    expect(model).not.toBeNull();
    expect(model?.sourceLayout).toBe(CRYPT_LAYOUT);
    expect(model?.floors.length).toBeGreaterThan(0);
    expect(model?.walls.length).toBeGreaterThan(0);
    expect(model?.markers.at(-1)).toMatchObject({ kind: 'player' });
  });

  it('shows exits, sealed gates, bosses, NPCs, loot, party, and the player without host drift', () => {
    const entities: EntityInput[] = [
      {
        id: 2,
        kind: 'mob',
        templateId: VARKHUL_BOSS_ID,
        x: 4,
        z: 0,
        hostile: true,
        aggroTargetId: 1,
      },
      { id: 3, kind: 'object', templateId: 'dungeon_exit', x: 0, z: -5 },
      { id: 4, kind: 'object', templateId: IGNIVAR_GATE_LOCKED_TEMPLATE, x: 0, z: 5 },
      { id: 5, kind: 'object', templateId: 'raid_cache', x: -4, z: 0, lootable: true },
      { id: 6, kind: 'npc', templateId: 'archivist_maelin_emberward', x: 0, z: 4 },
    ];
    const sim = worldIn(IGNIVAR_MOLTEN_ASSEMBLY_ID, entities, 'sim');
    const client = worldIn(IGNIVAR_MOLTEN_ASSEMBLY_ID, entities, 'client');
    const partyInfo = {
      members: [
        { pid: 1, x: sim.player.pos.x, z: sim.player.pos.z, cls: 'warrior', dead: 0 },
        { pid: 20, x: sim.player.pos.x + 2, z: sim.player.pos.z + 2, cls: 'mage', dead: 0 },
      ],
    };
    (sim as unknown as { partyInfo: unknown }).partyInfo = partyInfo;
    (client as unknown as { partyInfo: unknown }).partyInfo = partyInfo;

    const expected = buildDungeonMinimapModel(sim, 162, 2);
    expect(buildDungeonMinimapModel(client, 162, 2)).toEqual(expected);
    expect(expected?.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'mob', boss: true, aggro: true }),
        expect.objectContaining({ kind: 'exit' }),
        expect.objectContaining({ kind: 'gate' }),
        expect.objectContaining({ kind: 'loot' }),
        expect.objectContaining({ kind: 'npc' }),
        expect.objectContaining({ kind: 'party', cls: 'mage' }),
        expect.objectContaining({ kind: 'player' }),
      ]),
    );
  });

  it('reuses hot-path containers for a generic dungeon and Molten Assembly', () => {
    for (const dungeonId of ['hollow_crypt', IGNIVAR_MOLTEN_ASSEMBLY_ID]) {
      const core = new DungeonMapViewCore();
      const world = worldIn(dungeonId);
      const minimap = core.minimap(world, 162, 1.7);
      const worldMap = core.worldMap(world, 560, 34);
      expect(core.minimap(world, 162, 1.7)).toBe(minimap);
      expect(core.worldMap(world, 560, 34)).toBe(worldMap);
      expect(core.minimap(world, 162, 1.7)?.markers).toBe(minimap?.markers);
      expect(core.worldMap(world, 560, 34)?.markers).toBe(worldMap?.markers);
    }
  });
});
