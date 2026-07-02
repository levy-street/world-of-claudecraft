import { describe, expect, it } from 'vitest';
import {
  activeMountSpeedMult,
  BASIC_MOUNT_ID,
  BASIC_MOUNT_SPEED_MULT,
  emptyMountState,
  learnMount,
  normalizeMountState,
} from '../src/sim/mounts';
import { Sim, type PlayerMeta } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

function requireMeta(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.meta(pid);
  expect(meta).toBeTruthy();
  return meta as PlayerMeta;
}

function requireEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  expect(entity).toBeTruthy();
  return entity as Entity;
}

function readyMountedPlayer(sim: Sim, name = 'Rider'): number {
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, pid);
  expect(sim.learnMount(BASIC_MOUNT_ID, pid)).toBe(true);
  expect(sim.summonMount(BASIC_MOUNT_ID, pid)).toBe(true);
  return pid;
}

describe('mount core', () => {
  it('normalizes known mounts and only keeps valid active mounts', () => {
    expect(normalizeMountState(undefined)).toEqual(emptyMountState());
    expect(
      normalizeMountState({
        known: [BASIC_MOUNT_ID, 'unknown_mount', BASIC_MOUNT_ID],
        activeId: BASIC_MOUNT_ID,
      }),
    ).toEqual({ known: [BASIC_MOUNT_ID], activeId: BASIC_MOUNT_ID });
    expect(normalizeMountState({ known: [], activeId: BASIC_MOUNT_ID })).toEqual(emptyMountState());

    const state = emptyMountState();
    expect(learnMount(state, BASIC_MOUNT_ID)).toBe(true);
    expect(learnMount(state, BASIC_MOUNT_ID)).toBe(false);
    state.activeId = BASIC_MOUNT_ID;
    expect(activeMountSpeedMult(state)).toBe(BASIC_MOUNT_SPEED_MULT);
  });

  it('learns, summons, clones, and dismounts the basic mount', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Rider');
    expect(sim.summonMount(BASIC_MOUNT_ID, pid)).toBe(false);
    expect(sim.learnMount(BASIC_MOUNT_ID, pid)).toBe(true);
    expect(sim.learnMount(BASIC_MOUNT_ID, pid)).toBe(false);
    expect(sim.summonMount(BASIC_MOUNT_ID, pid)).toBe(false); // below min level

    sim.setPlayerLevel(20, pid);
    expect(sim.summonMount(BASIC_MOUNT_ID, pid)).toBe(true);
    const external = sim.mountsFor(pid);
    external.activeId = null;
    expect(sim.mountsFor(pid).activeId).toBe(BASIC_MOUNT_ID);
    expect(sim.dismountPlayer(pid)).toBe(true);
    expect(sim.dismountPlayer(pid)).toBe(false);
  });

  it('applies the mount movement-speed multiplier through the player movement tick', () => {
    const walking = makeWorld();
    const walker = walking.addPlayer('warrior', 'Walker');
    requireMeta(walking, walker).moveInput.forward = true;
    const walkStart = requireEntity(walking, walker).pos.z;
    walking.tick();
    const walkDelta = requireEntity(walking, walker).pos.z - walkStart;

    const mounted = makeWorld();
    const rider = readyMountedPlayer(mounted);
    requireMeta(mounted, rider).moveInput.forward = true;
    const rideStart = requireEntity(mounted, rider).pos.z;
    mounted.tick();
    const rideDelta = requireEntity(mounted, rider).pos.z - rideStart;

    expect(walkDelta).toBeGreaterThan(0);
    expect(rideDelta).toBeCloseTo(walkDelta * BASIC_MOUNT_SPEED_MULT, 5);
    expect(mounted.moveSpeedMult(requireEntity(mounted, rider))).toBe(BASIC_MOUNT_SPEED_MULT);
  });

  it('blocks summoning inside dungeons and active arena matches', () => {
    const dungeonSim = makeWorld();
    const dungeonPid = dungeonSim.addPlayer('warrior', 'Dungeon Rider');
    dungeonSim.setPlayerLevel(20, dungeonPid);
    expect(dungeonSim.learnMount(BASIC_MOUNT_ID, dungeonPid)).toBe(true);
    dungeonSim.enterDungeon('hollow_crypt', dungeonPid);
    expect(dungeonSim.summonMount(BASIC_MOUNT_ID, dungeonPid)).toBe(false);

    const arenaSim = makeWorld();
    const arenaPid = arenaSim.addPlayer('warrior', 'Arena Rider');
    arenaSim.setPlayerLevel(20, arenaPid);
    expect(arenaSim.learnMount(BASIC_MOUNT_ID, arenaPid)).toBe(true);
    arenaSim.arenaMatches.set(arenaPid, { state: 'active' } as never);
    expect(arenaSim.summonMount(BASIC_MOUNT_ID, arenaPid)).toBe(false);
  });

  it('dismounts mounted players when real damage starts combat', () => {
    const sim = makeWorld();
    const rider = readyMountedPlayer(sim, 'Rider');
    const attacker = readyMountedPlayer(sim, 'Attacker');
    const riderEntity = requireEntity(sim, rider);
    const attackerEntity = requireEntity(sim, attacker);

    sim.dealDamage(attackerEntity, riderEntity, 1, false, 'physical', null, 'hit');

    expect(sim.mountsFor(rider).activeId).toBeNull();
    expect(sim.mountsFor(attacker).activeId).toBeNull();
  });

  it('round-trips mount state through character persistence and defaults legacy saves', () => {
    const sim = makeWorld();
    const pid = readyMountedPlayer(sim);
    const saved = sim.serializeCharacter(pid);
    expect(saved?.mounts).toEqual({ known: [BASIC_MOUNT_ID], activeId: BASIC_MOUNT_ID });

    const restored = makeWorld();
    const restoredPid = restored.addPlayer('warrior', 'Rider', { state: saved ?? undefined });
    expect(restored.serializeCharacter(restoredPid)?.mounts).toEqual(saved?.mounts);

    const legacy = { ...(saved as unknown as Record<string, unknown>) };
    delete legacy.mounts;
    const legacyWorld = makeWorld();
    const legacyPid = legacyWorld.addPlayer('warrior', 'Legacy', { state: legacy as never });
    expect(legacyWorld.mountsFor(legacyPid)).toEqual(emptyMountState());
  });
});
