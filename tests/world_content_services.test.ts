import { afterEach, describe, expect, it } from 'vitest';
import { LADDER_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import {
  BUILTIN_WORLD,
  getActiveWorldContent,
  STATIONS,
  setActiveWorldContent,
} from '../src/sim/data';
import { isAtStation, stationsOfType } from '../src/sim/professions/stations';
import { Sim } from '../src/sim/sim';
import { VALE_CUP_BRAM_ID } from '../src/sim/social/vale_cup';
import {
  assertCanonicalEastbrookNoticeboardDef,
  emptyZoneProps,
  type NoticeboardDef,
  STATIC_WORLD_SERVICE_ENTITY_ID_MIN,
  type WorldContent,
} from '../src/sim/types';

function worldWithoutServices(): WorldContent {
  return {
    zones: BUILTIN_WORLD.zones,
    camps: [],
    npcs: {},
    groundObjects: [],
    roads: [],
    props: emptyZoneProps(),
    playerStart: { x: 123, z: 45 },
  };
}

function entitiesWithTemplate(sim: Sim, templateId: string) {
  return [...sim.entities.values()].filter((entity) => entity.templateId === templateId);
}

function canonicalNoticeboard(): NoticeboardDef {
  const definition = BUILTIN_WORLD.services?.noticeboards?.[0];
  if (!definition) throw new Error('missing built-in noticeboard fixture');
  return definition;
}

afterEach(() => setActiveWorldContent(null));

describe('WorldContent static gameplay services', () => {
  it('reserves noticeboard ids from the static world-service namespace boundary', () => {
    const definition = canonicalNoticeboard();
    expect(STATIC_WORLD_SERVICE_ENTITY_ID_MIN).toBe(2_000_000_001);

    expect(() =>
      assertCanonicalEastbrookNoticeboardDef({
        ...definition,
        entityId: STATIC_WORLD_SERVICE_ENTITY_ID_MIN - 1,
      }),
    ).toThrow('Invalid canonical Eastbrook noticeboard entityId');
    expect(() =>
      assertCanonicalEastbrookNoticeboardDef({
        ...definition,
        entityId: STATIC_WORLD_SERVICE_ENTITY_ID_MIN,
      }),
    ).not.toThrow();
  });

  it('rejects a custom noticeboard id before the next dynamic spawn can overwrite it', () => {
    const empty = worldWithoutServices();
    setActiveWorldContent(empty);
    const probe = new Sim({ seed: 71, playerClass: 'warrior', noPlayer: true, world: empty });
    const collidingEntityId = probe.nextId;
    expect(collidingEntityId).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    expect(probe.entities.has(collidingEntityId)).toBe(false);
    // The rejection below is a pure range check, so it only guards something real if
    // this id is one the sequential allocator genuinely hands out. Assert live
    // OCCUPANCY in a player-bearing sim rather than equality with playerId: the
    // constructor spawns entities on both sides of the player's own allocation, so
    // the slot the serviceless probe left free is taken by an ordinary world spawn.
    const playerProbe = new Sim({ seed: 71, playerClass: 'warrior', world: empty });
    expect(playerProbe.entities.has(collidingEntityId)).toBe(true);
    expect(playerProbe.playerId).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);

    const world: WorldContent = {
      ...empty,
      services: {
        noticeboards: [
          {
            ...canonicalNoticeboard(),
            id: 'custom_colliding_noticeboard',
            entityId: collidingEntityId,
          },
        ],
      },
    };
    setActiveWorldContent(world);

    expect(() => new Sim({ seed: 71, playerClass: 'warrior', world })).toThrow(
      'Invalid canonical Eastbrook noticeboard entityId',
    );
  });

  it('uses cfg.world graveyards and start while noticeboards follow the active world authority', () => {
    const world = worldWithoutServices();
    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);

    const sim = new Sim({ seed: 71, playerClass: 'warrior', world });

    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
    expect(sim.stationPlacements).toEqual([]);
    expect(entitiesWithTemplate(sim, 'mailbox')).toEqual([]);
    expect(entitiesWithTemplate(sim, 'noticeboard_eastbrook')).toHaveLength(
      BUILTIN_WORLD.services?.noticeboards?.length ?? 0,
    );
    expect(entitiesWithTemplate(sim, 'spirit_healer')).toEqual([]);
    expect(entitiesWithTemplate(sim, 'groundskeeper_bram')).toEqual([]);
    expect({ x: sim.player.pos.x, z: sim.player.pos.z }).toEqual(world.playerStart);

    sim.player.dead = true;
    sim.player.hp = 0;
    sim.releaseSpirit();

    expect(sim.player.ghost).toBe(true);
    expect({ x: sim.player.pos.x, z: sim.player.pos.z }).toEqual(world.playerStart);
  });

  it('honors a cfg.world-only custom graveyard for healer spawn and spirit release', () => {
    const world = worldWithoutServices();
    const graveyard = { id: 'custom_rest', name: 'Custom Rest', x: 115, z: 45 };
    world.services = { graveyards: [graveyard] };

    const sim = new Sim({ seed: 71, playerClass: 'warrior', world });
    const healer = entitiesWithTemplate(sim, 'spirit_healer');

    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
    expect(healer).toHaveLength(1);
    expect({ x: healer[0].pos.x, z: healer[0].pos.z }).toEqual({
      x: graveyard.x,
      z: graveyard.z,
    });

    sim.player.dead = true;
    sim.player.hp = 0;
    sim.releaseSpirit();

    expect({ x: sim.player.pos.x, z: sim.player.pos.z }).toEqual({
      x: graveyard.x,
      z: graveyard.z,
    });
  });

  it('does not inherit built-in station gates when cfg.world omits services', () => {
    const world = worldWithoutServices();
    const sim = new Sim({ seed: 71, playerClass: 'warrior', world });

    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
    expect(sim.stationPlacements).toEqual([]);
    expect(stationsOfType(sim.stationPlacements, 'forge')).toEqual([]);
    expect(isAtStation(sim.stationPlacements, STATIONS[0].pos, STATIONS[0].type)).toBe(false);

    const toolworks = STATIONS.find((station) => station.type === TOOL_RECIPES[0].stationType);
    const trainer = STATIONS.find((station) => station.type === LADDER_RECIPES[0].stationType);
    if (!toolworks || !trainer) throw new Error('built-in station fixture missing');
    sim.player.pos.x = toolworks.pos.x;
    sim.player.pos.z = toolworks.pos.z;
    sim.craftItem(TOOL_RECIPES[0].id);
    expect(sim.lastCraftResult).toMatchObject({ ok: false, reason: 'station_required' });

    sim.player.pos.x = trainer.pos.x;
    sim.player.pos.z = trainer.pos.z;
    sim.trainRecipe(LADDER_RECIPES[0].id);
    expect(sim.players.get(sim.playerId)?.lastTrainResult).toMatchObject({
      ok: false,
      reason: 'train_out_of_range',
    });

    sim.addItemInstance(
      'eastbrook_arming_sword',
      { bindOnTrade: true, boundTo: 999 },
      sim.playerId,
    );
    const meta = sim.players.get(sim.playerId);
    if (meta) meta.copper = 100_000;
    sim.unbindItem('eastbrook_arming_sword');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'unbindResult',
        ok: false,
        reason: 'unbind_out_of_range',
      }),
    );
  });

  it('authorizes cfg.world stations without consulting the built-in active registry', () => {
    const world = worldWithoutServices();
    const toolworks = STATIONS.find((station) => station.type === TOOL_RECIPES[0].stationType);
    const trainer = STATIONS.find((station) => station.type === LADDER_RECIPES[0].stationType);
    if (!toolworks || !trainer) throw new Error('built-in station fixture missing');
    world.services = {
      stations: [
        { ...toolworks, id: 'custom_toolworks', pos: { ...world.playerStart } },
        { ...trainer, id: 'custom_trainer', pos: { ...world.playerStart } },
      ],
    };

    const sim = new Sim({ seed: 71, playerClass: 'warrior', world });
    expect(getActiveWorldContent()).toBe(BUILTIN_WORLD);
    expect(isAtStation(sim.stationPlacements, world.playerStart, toolworks.type)).toBe(true);

    sim.craftItem(TOOL_RECIPES[0].id);
    expect(sim.lastCraftResult).toMatchObject({ ok: false, reason: 'insufficient_materials' });

    sim.trainRecipe(LADDER_RECIPES[0].id);
    expect(sim.players.get(sim.playerId)?.lastTrainResult).toMatchObject({ ok: true });

    sim.addItemInstance(
      'eastbrook_arming_sword',
      { bindOnTrade: true, boundTo: 999 },
      sim.playerId,
    );
    const meta = sim.players.get(sim.playerId);
    if (meta) meta.copper = 100_000;
    sim.unbindItem('eastbrook_arming_sword');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'unbindResult', ok: true }),
    );
  });

  it('spawns the groundskeeper definition from cfg.world rather than built-in data', () => {
    const world = worldWithoutServices();
    world.npcs = {
      groundskeeper_bram: {
        ...BUILTIN_WORLD.npcs.groundskeeper_bram,
        name: 'Custom Groundskeeper',
        pos: { x: 40, z: 40 },
        facing: Math.PI / 3,
      },
    };

    const sim = new Sim({ seed: 71, playerClass: 'warrior', world });
    const bram = sim.entities.get(VALE_CUP_BRAM_ID);

    expect(bram).toMatchObject({
      kind: 'npc',
      name: 'Custom Groundskeeper',
      facing: Math.PI / 3,
    });
    expect({ x: bram?.pos.x, z: bram?.pos.z }).toEqual(world.npcs.groundskeeper_bram.pos);
  });

  it('keeps built-in services unchanged after restoring the default world', () => {
    setActiveWorldContent(worldWithoutServices());
    setActiveWorldContent(null);
    const sim = new Sim({ seed: 71, playerClass: 'warrior' });

    expect(sim.stationPlacements).toBe(STATIONS);
    expect(entitiesWithTemplate(sim, 'mailbox')).toHaveLength(
      BUILTIN_WORLD.services?.mailboxes?.length ?? 0,
    );
    expect(entitiesWithTemplate(sim, 'noticeboard_eastbrook')).toHaveLength(
      BUILTIN_WORLD.services?.noticeboards?.length ?? 0,
    );
    expect(entitiesWithTemplate(sim, 'spirit_healer')).toHaveLength(
      BUILTIN_WORLD.services?.graveyards?.length ?? 0,
    );
  });

  it('keeps each running Sim bound to its construction world after active-registry swaps', () => {
    setActiveWorldContent(null);
    const builtin = new Sim({
      seed: 71,
      playerClass: 'warrior',
      noPlayer: true,
    });

    const custom = worldWithoutServices();
    const builtinInn = BUILTIN_WORLD.props.buildings.find((building) => building.kind === 'inn');
    if (!builtinInn) throw new Error('missing built-in inn fixture');
    custom.props.buildings.push({
      ...builtinInn,
      id: 'custom_inn',
      x: custom.playerStart.x,
      z: custom.playerStart.z,
    });
    const customStation = {
      ...STATIONS[0],
      id: 'custom_station',
      pos: { ...custom.playerStart },
    };
    custom.services = {
      stations: [customStation],
      graveyards: [{ id: 'custom_rest', name: 'Custom Rest', ...custom.playerStart }],
    };
    const explicit = new Sim({
      seed: 71,
      playerClass: 'warrior',
      noPlayer: true,
      world: custom,
    });

    // The editor/render registry is mutable, but it cannot retarget gameplay
    // authorization, later joins, or release destinations in an existing Sim.
    setActiveWorldContent(custom);
    expect(builtin.stationPlacements).toBe(STATIONS);
    const builtinPid = builtin.addPlayer('warrior', 'Builtin');
    const builtinPlayer = builtin.entities.get(builtinPid);
    expect(builtinPlayer && { x: builtinPlayer.pos.x, z: builtinPlayer.pos.z }).toEqual(
      BUILTIN_WORLD.playerStart,
    );
    if (!builtinPlayer) throw new Error('missing built-in player');
    builtinPlayer.pos.x = builtinInn.x;
    builtinPlayer.pos.z = builtinInn.z;
    builtin.rebucket(builtinPlayer);
    builtin.tick();
    expect(builtin.meta(builtinPid)?.restedXp).toBeGreaterThan(0);

    setActiveWorldContent(null);
    expect(explicit.stationPlacements).toEqual([customStation]);
    const customPid = explicit.addPlayer('warrior', 'Custom');
    const customPlayer = explicit.entities.get(customPid);
    expect(customPlayer && { x: customPlayer.pos.x, z: customPlayer.pos.z }).toEqual(
      custom.playerStart,
    );
    if (!customPlayer) throw new Error('missing custom-world player');
    explicit.tick();
    expect(explicit.meta(customPid)?.restedXp).toBeGreaterThan(0);
    customPlayer.dead = true;
    customPlayer.hp = 0;
    explicit.releaseSpirit(customPid);
    expect({ x: customPlayer.pos.x, z: customPlayer.pos.z }).toEqual(custom.playerStart);
  });
});
