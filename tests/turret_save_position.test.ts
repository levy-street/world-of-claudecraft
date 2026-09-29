import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TRANSPORT_ROUTES } from '../src/sim/content/transport_ships';
import { DUNGEONS, dungeonAt, instanceOrigin, PLAYER_START } from '../src/sim/data';
import { resolveSavedPosExit } from '../src/sim/saved_pos_exit';
import { type CharacterState, Sim } from '../src/sim/sim';
import { ferrySavePosition } from '../src/sim/transport_ferry';
import { turretSavePosition } from '../src/sim/turret_save_position';
import type { Entity, TurretSession, VehicleSession } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const AMBERFALL = { x: -340, z: 1945 };
const ARENA = instanceOrigin(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index, 0);
const FACING = 1.234;
const MID_WAVE_BOUND = 20 * 60 * 2;

function livePlayer(): Entity {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
  const e = sim.player;
  e.pos = { x: AMBERFALL.x, y: 30, z: AMBERFALL.z };
  e.facing = -0.5;
  return e;
}

function turretStub(): TurretSession {
  return {
    kind: 'turret',
    returnTo: { x: 12.5, y: 40, z: -7.25, facing: 2.5 },
  } as unknown as TurretSession;
}

describe('turretSavePosition', () => {
  it('saves the return point and its facing while seated in the arena', () => {
    const e = livePlayer();
    e.pos = { x: ARENA.x, y: 0, z: ARENA.z };
    expect(dungeonAt(e.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(turretSavePosition(turretStub(), e)).toEqual({
      pos: { x: 12.5, z: -7.25 },
      facing: 2.5,
    });
  });

  it('saves the live position of a seated player already taken out of the arena', () => {
    const e = livePlayer();
    expect(turretSavePosition(turretStub(), e)).toEqual({
      pos: { x: AMBERFALL.x, z: AMBERFALL.z },
      facing: -0.5,
    });
  });

  it('saves the live position and facing when not seated', () => {
    const e = livePlayer();
    const live = { pos: { x: AMBERFALL.x, z: AMBERFALL.z }, facing: -0.5 };
    expect(turretSavePosition(null, e)).toEqual(live);
    expect(turretSavePosition(undefined, e)).toEqual(live);
  });

  it('saves the live position in another vehicle kind', () => {
    const e = livePlayer();
    const cannon = { kind: 'cannon' } as unknown as VehicleSession;
    expect(turretSavePosition(cannon, e)).toEqual({
      pos: { x: AMBERFALL.x, z: AMBERFALL.z },
      facing: -0.5,
    });
  });

  it('keeps the ferry rule when not seated: a ride saves its destination pier', () => {
    const e = livePlayer();
    const route = TRANSPORT_ROUTES[0];
    e.ferryRide = { route: route.id, from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    const pier = route.berths[1].landing;
    expect(ferrySavePosition(e)).toEqual({ x: pier.x, z: pier.z });
    expect(turretSavePosition(null, e).pos).toEqual({ x: pier.x, z: pier.z });
  });
});

function entityOf(sim: Sim, pid: number): Entity {
  const e = sim.ctx.entities.get(pid);
  if (!e) throw new Error('expected the player entity');
  return e;
}

function saveOf(sim: Sim, pid: number): CharacterState {
  const save = sim.serializeCharacter(pid);
  if (!save) throw new Error('expected a character save');
  return save;
}

function tickToMidWave(sim: Sim, pid: number): void {
  for (let i = 0; i < MID_WAVE_BOUND; i++) {
    const seat = sim.meta(pid)?.vehicle;
    if (seat?.kind !== 'turret') throw new Error('expected a turret seat');
    if (seat.defense.phase === 'wave' && seat.defense.monsters.length > 0) return;
    sim.tick();
  }
  throw new Error('no wave within the bound');
}

function expectSavedAtReturnPoint(sim: Sim, pid: number, before: { x: number; z: number }): void {
  const player = entityOf(sim, pid);
  expect(dungeonAt(player.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
  player.facing = -FACING;
  const save = saveOf(sim, pid);
  expect(save.pos).toEqual({ x: before.x, z: before.z });
  expect(save.facing).toBe(FACING);
  expect(save).not.toHaveProperty('vehicle');
  expect(JSON.stringify(save)).not.toContain('returnTo');
  expect(resolveSavedPosExit(save.pos)).toEqual({
    pos: { x: before.x, z: before.z },
    instanceExit: false,
  });
  expect(Math.hypot(before.x - PLAYER_START.x, before.z - PLAYER_START.z)).toBeGreaterThan(100);
}

describe('a save taken while seated', () => {
  it('records the return point mid-wave, then the live position once left', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    const player = sim.player;
    sim.chat(`/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`);
    player.facing = FACING;
    const before = { ...player.pos };
    sim.chat('/dev turret');
    tickToMidWave(sim, player.id);
    expectSavedAtReturnPoint(sim, player.id, before);

    sim.leaveVehicle();
    const save = saveOf(sim, player.id);
    expect(save.pos).toEqual({ x: player.pos.x, z: player.pos.z });
    expect(save.facing).toBe(player.facing);
  });

  it('records where a teleport out of the arena put a still-seated player', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    const player = sim.player;
    sim.chat(`/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`);
    const before = { ...player.pos };
    sim.chat('/dev turret');
    tickToMidWave(sim, player.id);

    sim.chat(`/dev tp ${AMBERFALL.x + 60} ${AMBERFALL.z}`);
    expect(sim.meta(player.id)?.vehicle?.kind).toBe('turret');
    const away = { x: player.pos.x, z: player.pos.z };
    expect(Math.hypot(away.x - before.x, away.z - before.z)).toBeGreaterThan(50);
    expect(saveOf(sim, player.id).pos).toEqual(away);

    sim.tick();
    expect(sim.meta(player.id)?.vehicle).toBeNull();
    expect({ x: player.pos.x, z: player.pos.z }).toEqual(away);
  });

  it('does the same for a server character', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
    });
    const pid = sim.addPlayer('warrior', 'Durable', { characterId: 7 });
    sim.chat(`/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`, pid);
    const player = entityOf(sim, pid);
    player.facing = FACING;
    const before = { ...player.pos };
    sim.chat('/dev turret', pid);
    tickToMidWave(sim, pid);
    expectSavedAtReturnPoint(sim, pid, before);
  });
});
