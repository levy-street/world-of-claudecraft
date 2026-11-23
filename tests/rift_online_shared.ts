// Shared fixtures for the "a teleport off a rift floor must clear the ONLINE rift
// floor" suites (rift_release_exit_state.test.ts, rift_bg_pop_exit_state.test.ts,
// rift_hearth_exit_state.test.ts, rift_moderation_exit_state.test.ts).
//
// ClientWorld mirrors `riftFloor` from riftState events alone (no snapshot field),
// while mapWindowMode and minimapMode both lead with `world.riftFloor`. These
// helpers enter one player into a natural rift and replay a riftState stream into
// a bare ClientWorld, so a suite can ask which plan the online map would paint.
import { expect } from 'vitest';
import type { ClientWorld } from '../src/net/online';
import { allocRiftCollisionToken } from '../src/sim/colliders';
import { BUILTIN_WORLD, isRiftPos } from '../src/sim/data';
import { spawnNaturalRiftPortal } from '../src/sim/rift/portals';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';
import { mapWindowMode } from '../src/ui/map_window_view';
import { minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

export const RIFT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

export type RiftStateEvent = Extract<SimEvent, { type: 'riftState' }>;

export function riftStates(events: SimEvent[], pid: number): RiftStateEvent[] {
  return events.filter((e): e is RiftStateEvent => e.type === 'riftState' && e.pid === pid);
}

export function makeRiftSim(): Sim {
  return new Sim({
    seed: 99117,
    playerClass: 'warrior',
    noPlayer: true,
    autoEquip: true,
    devCommands: true,
    riftPortals: true,
    world: RIFT_TEST_WORLD,
  });
}

/** Walk `pid` onto floor 0 of a freshly spawned natural rift and return the
 *  drained entry event. */
export function enterNaturalRift(sim: Sim, pid: number): RiftStateEvent {
  expect(spawnNaturalRiftPortal(sim.ctx, 0)).toBe(true);
  const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
  sim.drainEvents();
  sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
  const [entry] = riftStates(sim.drainEvents(), pid);
  expect(entry?.active, 'sanity: entering emits the active floor').toBe(true);
  expect(isRiftPos(sim.entities.get(pid)!.pos.x), 'sanity: standing in the rift band').toBe(true);
  return entry;
}

// The sanctioned bare client, with a real collision token so applyRiftStateEvent
// registers (and clears) a floor region the way a constructed ClientWorld does.
function riftReadyClient(pid: number): ClientWorld {
  return bareClient(pid, { riftCollisionToken: allocRiftCollisionToken() });
}

/** Replay a player's riftState stream into a client, then ask both map surfaces
 *  which mode they would paint with the player standing at `pos`. */
export function onlineMapModes(
  events: RiftStateEvent[],
  pos: { x: number; y: number; z: number },
): { riftFloor: unknown; map: string; minimap: string } {
  const client = riftReadyClient(events[0]?.pid ?? 1);
  for (const ev of events) (client as any).applyRiftStateEvent(ev);
  const world = { riftFloor: client.riftFloor, delveRun: null, player: { pos } } as IWorld;
  return { riftFloor: client.riftFloor, map: mapWindowMode(world), minimap: minimapMode(world) };
}
