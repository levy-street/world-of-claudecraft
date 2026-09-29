import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TURRET_ARENA } from '../src/sim/content/turret_defense';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { CRYPT_LAYOUT } from '../src/sim/dungeon_layout';
import {
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TREES,
  FIRE_AND_FLY_WALL_RADIUS,
} from '../src/sim/fire_and_fly_field';
import {
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import { horizontalAt, type MotionSegment } from '../src/sim/minigames/thrown_body';
import type { TurretMonster, TurretMonsterState } from '../src/sim/minigames/turret_defense';
import { Sim } from '../src/sim/sim';
import { PLAYER_INTEREST_RADIUS } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  buildDungeonMinimapModel,
  buildDungeonWorldMapModel,
  type DungeonMapMarker,
  DungeonMapViewCore,
  dungeonMapActive,
  dungeonMapLocal,
} from '../src/ui/dungeon_map_view';
import { mapWindowMode } from '../src/ui/map_window_view';
import { minimapMode } from '../src/ui/minimap_markers';
import { MINIMAP_SIZE } from '../src/ui/minimap_painter';
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

  it("draws a party member's dungeon from OUTSIDE via the anchor: party marker, no player arrow", () => {
    const origin = instanceOrigin(DUNGEONS.hollow_crypt.index, 2);
    const outside = worldIn('hollow_crypt') as unknown as {
      player: { pos: { x: number; y: number; z: number } };
      partyInfo: unknown;
    };
    outside.player.pos = { x: 0, y: 0, z: 0 };
    outside.partyInfo = {
      members: [{ pid: 7, name: 'Ally', cls: 'mage', dead: 0, x: origin.x + 3, z: origin.z + 2 }],
    };
    const world = outside as unknown as IWorld;
    expect(dungeonMapActive(world)).toBe(false);
    expect(buildDungeonWorldMapModel(world, 560, 34)).toBeNull();
    const model = buildDungeonWorldMapModel(world, 560, 34, { x: origin.x + 3, z: origin.z + 2 });
    expect(model).not.toBeNull();
    expect(model?.dungeonId).toBe('hollow_crypt');
    expect(model?.markers.map((m) => m.kind)).toEqual(['party']);
    // A member in ANOTHER copy of the same dungeon shares the local coordinates
    // but not the origin: never a marker on this plan (both builders).
    const other = instanceOrigin(DUNGEONS.hollow_crypt.index, 4);
    outside.partyInfo = {
      members: [
        { pid: 7, name: 'Ally', cls: 'mage', dead: 0, x: origin.x + 3, z: origin.z + 2 },
        { pid: 8, name: 'Elsewhere', cls: 'rogue', dead: 0, x: other.x + 3, z: other.z + 2 },
      ],
    };
    const filtered = buildDungeonWorldMapModel(world, 560, 34, {
      x: origin.x + 3,
      z: origin.z + 2,
    });
    expect(filtered?.markers.map((m) => m.kind)).toEqual(['party']);
    // The stateful core takes the same anchor and agrees.
    const core = new DungeonMapViewCore();
    const hot = core.worldMap(world, 560, 34, { x: origin.x + 3, z: origin.z + 2 });
    expect(hot?.dungeonId).toBe('hollow_crypt');
    expect(hot?.markers.map((m) => m.kind)).toEqual(['party']);
    expect(core.worldMap(world, 560, 34)).toBeNull();
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

describe('the Fire and Fly arena map', () => {
  // The sim frame has no room plan for the arena and falls back to the crypt's;
  // both HUD surfaces must draw the arena itself instead.
  it('draws the round field, its trunks and rocks and the tower, never the crypt plan', () => {
    const world = worldIn(FIRE_AND_FLY_DUNGEON_ID);
    expect(dungeonMapActive(world)).toBe(true);
    const local = dungeonMapLocal(world.player.pos.x, world.player.pos.z);
    expect(local?.dungeonId).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(local?.layout).not.toBe(CRYPT_LAYOUT);
    const model = buildDungeonWorldMapModel(world, 560, 34);
    expect(model?.sourceLayout).toBe(local?.layout);
    expect(model?.floors).toHaveLength(1);
    expect(model?.floors[0].points.length).toBeGreaterThanOrEqual(32);
    expect(model?.walls.length).toBe(model?.floors[0].points.length);
    expect(model?.obstacles).toHaveLength(FIRE_AND_FLY_ROCKS.length + FIRE_AND_FLY_TREES.length);
    expect(model?.dais?.r).toBeGreaterThan(0);
    // The plan fits the whole walled field: its span is the wall's diameter.
    expect(model?.bounds.maxX).toBeGreaterThanOrEqual(FIRE_AND_FLY_WALL_RADIUS);
    expect(model?.markers.at(-1)).toMatchObject({ kind: 'player' });
  });

  it('keeps the hot-path core on the arena plan too', () => {
    const core = new DungeonMapViewCore();
    const world = worldIn(FIRE_AND_FLY_DUNGEON_ID);
    const minimap = core.minimap(world, 162, 1.7);
    expect(minimap?.staticGeometry.sourceLayout).not.toBe(CRYPT_LAYOUT);
    expect(core.minimap(world, 162, 1.7)).toBe(minimap);
    const worldMap = core.worldMap(world, 560, 34);
    expect(worldMap?.sourceLayout).toBe(minimap?.staticGeometry.sourceLayout);
  });
});

describe('the Fire and Fly monsters on the arena map', () => {
  const MINIMAP = MINIMAP_SIZE;
  const HALF = MINIMAP / 2;
  // The dungeon minimap painter's zoom-1 scale (private to src/ui/dungeon_map_painter.ts).
  const PX = 1.7;
  const CLOCK = 120;
  const KOBOLD = 'deeprock_kobold';

  function monster(
    id: number,
    state: TurretMonsterState,
    hp: number,
    seg: Omit<MotionSegment, 'y'>,
  ): unknown {
    return { id, kind: 0, hp, maxHp: 10, state, seg: { y: 0, ...seg }, facing: 0 };
  }

  /** A seated arena world: the session's tower on the player, monsters in local yards. */
  function seated(monsters: unknown[], origin?: { x: number; z: number }): IWorld {
    const world = worldIn(FIRE_AND_FLY_DUNGEON_ID) as unknown as {
      player: { pos: { x: number; y: number; z: number } };
      turretSession: unknown;
      turretClock: number | null;
    };
    const at = origin ?? world.player.pos;
    world.turretSession = {
      origin: { x: at.x, y: 0, z: at.z },
      defense: {
        startTick: 0,
        aimX: 0,
        aimZ: 1,
        plan: { kinds: [{ templateId: KOBOLD }] },
        monsters: (monsters as { seg: { x: number; z: number } }[]).map((m) => ({
          ...m,
          seg: { ...m.seg, x: at.x + m.seg.x, z: at.z + m.seg.z },
        })),
      },
    };
    world.turretClock = CLOCK;
    return world as unknown as IWorld;
  }

  function mobs(markers: readonly DungeonMapMarker[] | undefined) {
    return (markers ?? []).flatMap((m) =>
      m.kind === 'mob'
        ? [{ cx: m.cx, cy: m.cy, templateId: m.templateId, aggro: m.aggro, boss: m.boss }]
        : [],
    );
  }

  const march = { kind: 'march', start: 100, end: 400, dx: -1, dz: 0, speed: 5 } as const;
  const still = { kind: 'still', start: 100, end: 400 } as const;
  const field = [
    monster(1, 'march', 10, { ...march, x: 20, z: 0 }),
    monster(2, 'windup', 4, { ...still, x: 0, z: 8 }),
    monster(3, 'dead', 0, { ...still, x: 5, z: 5 }),
    monster(4, 'fly', 0, {
      kind: 'fly',
      start: 110,
      end: 140,
      x: -6,
      z: 0,
      vx: -3,
      vy: 6,
      vz: 0,
      g: 20,
      contact: 'ground',
      nx: 0,
      nz: 0,
    } as Omit<MotionSegment, 'y'>),
    monster(5, 'gone', 0, { ...still, x: 3, z: -3 }),
    monster(6, 'fly', 6, {
      kind: 'fly',
      start: 110,
      end: 140,
      x: -10,
      z: -10,
      vx: 0,
      vy: 6,
      vz: -2,
      g: 20,
      contact: 'ground',
      nx: 0,
      nz: 0,
    } as Omit<MotionSegment, 'y'>),
  ];

  it('draws each live monster as the hostile mob marker at the seat clock, never a corpse or a gone one', () => {
    const world = seated(field);
    const hot = new DungeonMapViewCore().minimap(world, MINIMAP, PX);
    const drawn = mobs(hot?.markers);
    // The marcher walked 20 ticks at 5 yd/s: 5 yd toward the tower. The thrown
    // survivor is sampled on its flight at the same clock.
    const flying = horizontalAt(
      (world.turretSession?.defense.monsters[5].seg ?? null) as MotionSegment,
      CLOCK,
    );
    const p = world.player.pos;
    const expected = [
      { cx: HALF - 15 * PX, cy: HALF, aggro: false },
      { cx: HALF, cy: HALF - 8 * PX, aggro: true },
      { cx: HALF - (flying.x - p.x) * PX, cy: HALF - (flying.z - p.z) * PX, aggro: false },
    ];
    expect(drawn).toHaveLength(expected.length);
    drawn.forEach((m, i) => {
      expect(m.cx).toBeCloseTo(expected[i].cx, 9);
      expect(m.cy).toBeCloseTo(expected[i].cy, 9);
      expect(m).toMatchObject({ templateId: KOBOLD, aggro: expected[i].aggro, boss: false });
    });
    // The cold builder and the hot core agree, and the arrow still paints last.
    expect(mobs(buildDungeonMinimapModel(world, MINIMAP, PX)?.markers)).toEqual(drawn);
    expect(hot?.markers.at(-1)).toMatchObject({ kind: 'player', cx: HALF, cy: HALF });
  });

  it('reuses the marker containers across redraws as the monsters move', () => {
    const world = seated(field);
    const core = new DungeonMapViewCore();
    const first = core.minimap(world, MINIMAP, PX);
    const markers = first?.markers;
    const slots = markers?.slice();
    (world as unknown as { turretClock: number }).turretClock = CLOCK + 2;
    const next = core.minimap(world, MINIMAP, PX);
    expect(next).toBe(first);
    expect(next?.markers).toBe(markers);
    expect(next?.markers).toHaveLength(slots?.length ?? -1);
    for (const [i, m] of (next?.markers ?? []).entries()) expect(m).toBe(slots?.[i]);
    expect(mobs(next?.markers)[0].cx).toBeCloseTo(HALF - 14.5 * PX, 9);
  });

  it('clips a monster on the spawn ring at the zoom 1 minimap rim, and the M-map shows it', () => {
    const world = seated([
      monster(1, 'march', 10, { ...still, x: 0, z: TURRET_ARENA.spawnRadius }),
    ]);
    expect(mobs(new DungeonMapViewCore().minimap(world, MINIMAP, PX)?.markers)).toEqual([]);
    expect(mobs(new DungeonMapViewCore().worldMap(world, 560, 34)?.markers)).toHaveLength(1);
    expect(mobs(buildDungeonWorldMapModel(world, 560, 34)?.markers)).toHaveLength(1);
  });

  it('draws no turret monster when the session comes without its clock', () => {
    const world = seated(field);
    (world as unknown as { turretClock: number | null }).turretClock = null;
    expect(mobs(buildDungeonMinimapModel(world, MINIMAP, PX)?.markers)).toEqual([]);
    expect(mobs(new DungeonMapViewCore().minimap(world, MINIMAP, PX)?.markers)).toEqual([]);
    expect(mobs(new DungeonMapViewCore().worldMap(world, 560, 34)?.markers)).toEqual([]);
  });

  it('changes nothing without a session, or with a session in another copy', () => {
    const plain = worldIn(FIRE_AND_FLY_DUNGEON_ID, [
      { id: 9, kind: 'mob', templateId: KOBOLD, x: 6, z: 0, hostile: true },
    ]);
    const before = buildDungeonMinimapModel(plain, MINIMAP, PX)?.markers;
    expect(mobs(before)).toHaveLength(1);
    (plain as unknown as { turretSession: null }).turretSession = null;
    expect(buildDungeonMinimapModel(plain, MINIMAP, PX)?.markers).toEqual(before);
    const hot = new DungeonMapViewCore().minimap(plain, MINIMAP, PX);
    expect(mobs(hot?.markers)).toEqual(mobs(before));

    const elsewhere = instanceOrigin(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index, 4);
    const other = seated(field, elsewhere);
    expect(mobs(buildDungeonMinimapModel(other, MINIMAP, PX)?.markers)).toEqual([]);
    expect(mobs(new DungeonMapViewCore().minimap(other, MINIMAP, PX)?.markers)).toEqual([]);
  });

  it('seated for real: the minimap draws exactly the live monsters, never a corpse, and the arrow follows the aim', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev turret');
    expect(sim.turretSession).not.toBeNull();
    const core = new DungeonMapViewCore();
    const p = sim.player.pos;
    // Well inside the zoom 1 rim, so every live monster this close must be drawn.
    const IN_VIEW_YD = 40;
    const monsters = () => (sim.turretSession?.defense.monsters ?? []) as readonly TurretMonster[];
    const at = (m: TurretMonster) => horizontalAt(m.seg, sim.turretClock ?? Number.NaN);
    const range = (m: TurretMonster) => {
      const q = at(m);
      return Math.hypot(q.x - p.x, q.z - p.z);
    };
    const key = (cx: number, cy: number) => `${cx.toFixed(3)},${cy.toFixed(3)}`;
    const keyOf = (m: TurretMonster) => {
      const q = at(m);
      return key(HALF - (q.x - p.x) * PX, HALF - (q.z - p.z) * PX);
    };
    const live = () =>
      monsters().filter((m) => m.hp > 0 && m.state !== 'dead' && m.state !== 'gone');
    const corpsesInView = () =>
      monsters().filter((m) => m.hp <= 0 && m.state !== 'gone' && range(m) < IN_VIEW_YD);
    const liveInView = () => live().filter((m) => range(m) < IN_VIEW_YD);
    const fireAt = (m: TurretMonster) => {
      const q = at(m);
      return sim.useVehicleAction('turret_fire', { x: q.x, z: q.z });
    };

    for (let i = 0; i < 6000; i++) {
      if (corpsesInView().length > 0 && liveInView().length > 0) break;
      const target = live()
        .filter((m) => range(m) < 25)
        .sort((a, b) => range(a) - range(b))[0];
      if (target) fireAt(target);
      sim.tick();
    }
    const corpses = corpsesInView();
    expect(corpses.length).toBeGreaterThan(0);
    expect(liveInView().length).toBeGreaterThan(0);

    const drawn = mobs(core.minimap(sim, MINIMAP, PX)?.markers);
    const liveByKey = new Map(live().map((m) => [keyOf(m), m]));
    for (const m of drawn) {
      const owner = liveByKey.get(key(m.cx, m.cy));
      expect(owner).toBeDefined();
      expect(m.aggro).toBe(owner?.state === 'windup');
    }
    const drawnKeys = new Set(drawn.map((m) => key(m.cx, m.cy)));
    for (const m of liveInView()) expect(drawnKeys.has(keyOf(m))).toBe(true);
    for (const m of corpses) expect(drawnKeys.has(keyOf(m))).toBe(false);

    let fired = false;
    for (let i = 0; i < 40 && !fired; i++) {
      const target = live()[0];
      fired = target !== undefined && fireAt(target);
      if (!fired) sim.tick();
    }
    expect(fired).toBe(true);
    const defense = sim.turretSession?.defense;
    const arrow = core.minimap(sim, MINIMAP, PX)?.markers.at(-1);
    expect(arrow?.kind).toBe('player');
    const angle = arrow?.kind === 'player' ? arrow.angle : Number.NaN;
    expect(Math.sin(-angle)).toBeCloseTo(defense?.aimX ?? Number.NaN, 9);
    expect(Math.cos(-angle)).toBeCloseTo(defense?.aimZ ?? Number.NaN, 9);
  });
});
