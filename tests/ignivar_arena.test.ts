import { describe, expect, it } from 'vitest';
import { arenaWallSegmentHits } from '../src/render/arena_wall_occlusion_core';
import {
  dungeonDaisHasRaisedPlatform,
  dungeonVariantKeepsFightingFloorClear,
} from '../src/render/dungeon';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { dungeonFloorLift, dungeonInstanceAt, INTERIOR_LAYOUTS } from '../src/sim/dungeon_floor';
import { IGNIVAR_LAYOUT, layoutColliders } from '../src/sim/dungeon_layout';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  IGNIVAR_BOSS_SPAWN_Z,
  IGNIVAR_CONDUITS,
  IGNIVAR_FRONTAL_HALF_ANGLE,
  IGNIVAR_FRONTAL_RANGE,
  IGNIVAR_ROTATING_RAYS_COUNT,
  IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
  IGNIVAR_ROTATING_RAYS_INNER_RANGE,
  IGNIVAR_ROTATING_RAYS_RANGE,
  IGNIVAR_WATER_CONDUIT_TEMPLATES,
  ignivarConduitHitByFrontal,
  ignivarPointInRotatingRay,
} from '../src/sim/ignivar_arena';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

describe('Ignivar raid arena', () => {
  it('authors an open octagonal room with every conduit inside the shared shell', () => {
    expect(IGNIVAR_LAYOUT.shellPolygon).toHaveLength(8);
    const shell = IGNIVAR_LAYOUT.shellPolygon;
    if (!shell) throw new Error('Ignivar arena requires an octagonal shell');
    expect(IGNIVAR_LAYOUT.shellPole).toEqual({ x: 0, z: 0 });
    expect(shell).toEqual([
      { x: -14, z: -33 },
      { x: 14, z: -33 },
      { x: 33, z: -14 },
      { x: 33, z: 14 },
      { x: 14, z: 33 },
      { x: -14, z: 33 },
      { x: -33, z: 14 },
      { x: -33, z: -14 },
    ]);
    expect(IGNIVAR_LAYOUT.zMax - IGNIVAR_LAYOUT.zMin).toBe(66);
    expect((IGNIVAR_LAYOUT.wallX ?? 0) * 2).toBe(66);
    expect(IGNIVAR_LAYOUT.doorZ).toBe(-33);
    expect(IGNIVAR_LAYOUT.dais).toEqual({ x: 0, z: 0, r: 8 });
    expect(IGNIVAR_LAYOUT.pillars).toEqual([]);
    expect(IGNIVAR_LAYOUT.tombs).toEqual([]);
    expect(IGNIVAR_LAYOUT.stubs).toEqual([]);

    for (const conduit of IGNIVAR_CONDUITS) {
      expect(polygonContainsPoint(shell, conduit.x, conduit.z), conduit.id).toBe(true);
    }

    expect(polygonContainsPoint(shell, 0, -27)).toBe(true);
    expect(polygonContainsPoint(shell, 0, -34)).toBe(false);
    expect(layoutColliders(IGNIVAR_LAYOUT).length).toBeGreaterThanOrEqual(8);
  });

  it('routes the production floor and render policies to the same flat arena', () => {
    expect(INTERIOR_LAYOUTS.ignivar).toBe(IGNIVAR_LAYOUT);
    expect(dungeonDaisHasRaisedPlatform('ignivar')).toBe(false);
    expect(dungeonVariantKeepsFightingFloorClear('ignivar')).toBe(true);

    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    expect(dungeonInstanceAt(origin.x, origin.z)).toMatchObject({
      interior: 'ignivar',
      layout: IGNIVAR_LAYOUT,
    });
    expect(dungeonFloorLift(origin.x, origin.z)).toBe(0);
    expect(dungeonFloorLift(origin.x + 6, origin.z)).toBe(0);
  });

  it('fades a diagonal octagon wall when it crosses the chase-camera sightline', () => {
    expect(
      arenaWallSegmentHits(
        {
          x: 19,
          z: 19,
          hw: Math.hypot(16, 16) / 2,
          hd: 1,
          topY: 7,
          ry: Math.PI / 4,
        },
        0,
        1.8,
        0,
        32,
        4,
        32,
      ),
    ).toBe(true);
    expect(
      arenaWallSegmentHits(
        {
          x: 19,
          z: 19,
          hw: Math.hypot(16, 16) / 2,
          hd: 1,
          topY: 7,
          ry: Math.PI / 4,
        },
        0,
        1.8,
        0,
        0,
        4,
        20,
      ),
    ).toBe(false);
  });

  it('places four diagonal conductors on the placed water pumps', () => {
    // Anchored on the baked water_pump dressing placements (the pumps ARE the
    // conduits), so these mirror the four water_pump entries in the arena pass.
    expect(IGNIVAR_CONDUITS).toEqual([
      { id: 'north_west', x: -16.2, z: 16.4 },
      { id: 'north_east', x: 17.1, z: 16.8 },
      { id: 'south_east', x: 16.6, z: -16.5 },
      { id: 'south_west', x: -17.4, z: -17.1 },
    ]);
  });

  it('resolves a tank frontal against the aimed available conduit only', () => {
    expect(IGNIVAR_FRONTAL_RANGE).toBe(36);
    expect(IGNIVAR_FRONTAL_HALF_ANGLE).toBe(Math.PI / 15);
    const northWestFacing = Math.atan2(-22, 22);
    expect(ignivarConduitHitByFrontal({ x: 0, z: 0 }, northWestFacing)).toBe('north_west');
    expect(
      ignivarConduitHitByFrontal({ x: 0, z: 0 }, northWestFacing, new Set(['north_east'])),
    ).toBeNull();
    expect(ignivarConduitHitByFrontal({ x: 0, z: 0 }, 0)).toBeNull();
    for (const conduit of IGNIVAR_CONDUITS) {
      const facing = Math.atan2(conduit.x, conduit.z);
      expect(ignivarConduitHitByFrontal({ x: 0, z: 0 }, facing)).toBe(conduit.id);
    }
    expect(ignivarConduitHitByFrontal({ x: -18, z: 18 }, 0)).not.toBe('north_west');
  });

  it('resolves three narrow rotating rays with a safe gap between every pair', () => {
    expect(IGNIVAR_ROTATING_RAYS_COUNT).toBe(3);
    expect(IGNIVAR_ROTATING_RAYS_RANGE).toBe(34);
    expect(IGNIVAR_ROTATING_RAYS_INNER_RANGE).toBe(2.5);
    expect(IGNIVAR_ROTATING_RAYS_HALF_WIDTH).toBe(1);
    const origin = { x: 0, z: 0 };

    for (let ray = 0; ray < IGNIVAR_ROTATING_RAYS_COUNT; ray++) {
      const facing = (ray * Math.PI * 2) / IGNIVAR_ROTATING_RAYS_COUNT;
      expect(
        ignivarPointInRotatingRay(origin, 0, {
          x: Math.sin(facing) * 20,
          z: Math.cos(facing) * 20,
        }),
      ).toBe(true);
      const safeFacing = facing + Math.PI / IGNIVAR_ROTATING_RAYS_COUNT;
      expect(
        ignivarPointInRotatingRay(origin, 0, {
          x: Math.sin(safeFacing) * 20,
          z: Math.cos(safeFacing) * 20,
        }),
      ).toBe(false);
    }
    expect(ignivarPointInRotatingRay(origin, 0, { x: 0, z: 1 })).toBe(false);
    expect(ignivarPointInRotatingRay(origin, 0, { x: 0, z: 35 })).toBe(false);
  });

  it('registers the hidden raid room with four conductors and its sealed inner gate', () => {
    const dungeon = DUNGEONS.ignivar_raid_arena;
    expect(dungeon).toMatchObject({
      id: 'ignivar_raid_arena',
      interior: 'ignivar',
      overworldDoor: false,
      suggestedPlayers: 10,
      spawns: [{ mobId: 'ignivar_herald_of_the_last_flame', x: 0, z: IGNIVAR_BOSS_SPAWN_Z }],
      entry: { x: 0, z: -27 },
      exitOffset: { x: 0, z: -30 },
    });
    expect(dungeon.objects?.slice(0, IGNIVAR_CONDUITS.length)).toEqual(
      IGNIVAR_CONDUITS.map((conduit) => ({
        itemId: '',
        name: expect.any(String),
        x: conduit.x,
        z: conduit.z,
        templateId: IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
        lootable: false,
      })),
    );
    expect(dungeon.objects?.at(-1)).toMatchObject({
      name: 'Sealed Assembly Gate',
      templateId: 'ignivar_raid_gate_locked',
      dungeonId: 'ignivar_molten_assembly',
      lootable: false,
    });
  });

  it('places Ignivar beyond automatic aggro range from the room entrance', () => {
    const dungeon = DUNGEONS.ignivar_raid_arena;
    const spawn = dungeon.spawns.find(
      (candidate) => candidate.mobId === 'ignivar_herald_of_the_last_flame',
    );
    if (!spawn) throw new Error('Ignivar spawn is missing');

    expect(Math.hypot(spawn.x - dungeon.entry.x, spawn.z - dungeon.entry.z)).toBeGreaterThan(
      MOBS.ignivar_herald_of_the_last_flame.aggroRadius,
    );
    expect(
      Math.hypot(spawn.x - IGNIVAR_LAYOUT.dais.x, spawn.z - IGNIVAR_LAYOUT.dais.z),
    ).toBeLessThan(IGNIVAR_LAYOUT.dais.r);
  });

  it('keeps the hidden raid room behind an explicit dev bypass for solo testing', () => {
    const production = new Sim({ seed: 42, playerClass: 'warrior' });
    expect(enterDungeon(production.ctx, 'ignivar_raid_arena', production.player.id, true)).toBe(
      false,
    );

    const dev = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
    });
    expect(enterDungeon(dev.ctx, 'ignivar_raid_arena', dev.player.id)).toBe(false);
  });

  it('claims the room through the real instance path and spawns inert conduit entities', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
    });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);

    const slot = sim.instanceSlotAt(sim.player.pos);
    expect(slot).not.toBeNull();
    if (slot === null) throw new Error('Ignivar arena claim did not resolve an instance slot');
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, slot);
    const conduits = [...sim.entities.values()].filter((entity) =>
      entity.templateId.startsWith('ignivar_water_conduit_'),
    );

    expect(conduits).toHaveLength(4);
    expect(conduits.every((conduit) => conduit.kind === 'object' && !conduit.lootable)).toBe(true);
    // World coords carry a large instance origin (116800+), so reconstructing
    // the local offset reintroduces float error at the non-integer pump
    // anchors; compare with tolerance rather than exact equality. Gameplay is
    // unaffected: the cleanse check uses world-space differences directly.
    expect(conduits).toHaveLength(IGNIVAR_CONDUITS.length);
    for (let index = 0; index < IGNIVAR_CONDUITS.length; index++) {
      expect(conduits[index].pos.x - origin.x).toBeCloseTo(IGNIVAR_CONDUITS[index].x, 5);
      expect(conduits[index].pos.z - origin.z).toBeCloseTo(IGNIVAR_CONDUITS[index].z, 5);
    }
  });
});
