// A spirit released in a rift must take the online client OUT of the rift.
//
// ClientWorld mirrors `riftFloor` from riftState events alone (no snapshot field),
// and only enterRift / descendRift / the rift exit emitted them. A death on a rift
// floor followed by a spirit release teleports the ghost to an overworld graveyard
// (spirit.ts ghostGraveyard) without any exit event, so online the client kept its
// floor: mapWindowMode and minimapMode both lead with `world.riftFloor`, which locked
// the world map and minimap on the rift plan for the whole corpse run. The offline
// Sim never showed it because its riftFloor is derived from position. The two
// /unstuck graveyard moves had the same hole. Every graveyard move now emits the
// exit (spirit.ts graveyardForMove -> rift/runs.ts emitRiftDeparture).
import { describe, expect, it } from 'vitest';
import { dungeonAt, isRiftPos } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { moveToGraveyardForUnstuck, reviveAtGraveyardForUnstuck } from '../src/sim/spirit';
import {
  enterNaturalRift,
  makeRiftSim,
  onlineMapModes,
  type RiftStateEvent,
  riftStates,
} from './rift_online_shared';

/** One player standing on floor 0 of a natural rift, with the entry events drained. */
function enterRiftSolo(): { sim: Sim; pid: number; entry: RiftStateEvent } {
  const sim = makeRiftSim();
  const pid = sim.addPlayer('warrior', 'Runner');
  sim.setPlayerLevel(20, pid);
  const entry = enterNaturalRift(sim, pid);
  return { sim, pid, entry };
}

function kill(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid)!;
  e.hp = 0;
  e.dead = true;
}

describe('leaving a rift through a graveyard move clears the online rift floor', () => {
  it('a spirit release emits the rift exit, so the corpse run shows the overworld map', () => {
    const { sim, pid, entry } = enterRiftSolo();
    kill(sim, pid);
    sim.releaseSpirit(pid);
    const ghost = sim.entities.get(pid)!;
    expect(ghost.ghost, 'the spirit released').toBe(true);
    expect(isRiftPos(ghost.pos.x), 'the ghost stands at an overworld graveyard').toBe(false);

    const exits = riftStates(sim.drainEvents(), pid);
    expect(exits.map((e) => e.active)).toEqual([false]);
    expect(exits[0].instanceId).toBe(entry.instanceId);

    const modes = onlineMapModes([entry, ...exits], ghost.pos);
    expect(modes.riftFloor).toBeNull();
    expect(modes.map).toBe('overworld');
    expect(modes.minimap).toBe('overworld');
  });

  it('a graveyard move out of rift ice clears the latched slide state', () => {
    const { sim, pid } = enterRiftSolo();
    const p = sim.entities.get(pid)!;
    p.riftSliding = true;
    p.riftSlideDirX = 0;
    p.riftSlideDirZ = 1;
    kill(sim, pid);
    sim.releaseSpirit(pid);
    expect(p.riftSliding).toBe(false);
    expect(p.riftSlideDirX).toBe(0);
    expect(p.riftSlideDirZ).toBe(0);
  });

  it('the ghost walking back in rebuilds the rift floor on the client', () => {
    const { sim, pid, entry } = enterRiftSolo();
    const portal = sim.entities.get(sim.naturalRiftPortals[0].id)!;
    kill(sim, pid);
    sim.releaseSpirit(pid);
    const exits = riftStates(sim.drainEvents(), pid);
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
    const ghost = sim.entities.get(pid)!;
    expect(isRiftPos(ghost.pos.x), 'the ghost is back on the floor').toBe(true);
    const reentry = riftStates(sim.drainEvents(), pid);
    expect(reentry.map((e) => e.active)).toEqual([true]);
    const modes = onlineMapModes([entry, ...exits, ...reentry], ghost.pos);
    expect(modes.riftFloor).not.toBeNull();
    expect(modes.map).toBe('rift');
    expect(modes.minimap).toBe('rift');
  });

  // Control: replays only the entry, so it passes with or without the fix. It pins
  // the mechanism the fix relies on (the client holds its floor until an exit).
  it('control: a client that never receives an exit stays on the rift plan', () => {
    const { sim, pid, entry } = enterRiftSolo();
    kill(sim, pid);
    sim.releaseSpirit(pid);
    const modes = onlineMapModes([entry], sim.entities.get(pid)!.pos);
    expect(modes.map).toBe('rift');
    expect(modes.minimap).toBe('rift');
  });

  it('a living /unstuck out of a rift emits the rift exit', () => {
    const { sim, pid, entry } = enterRiftSolo();
    moveToGraveyardForUnstuck(sim.ctx, pid, 'none');
    const p = sim.entities.get(pid)!;
    expect(isRiftPos(p.pos.x)).toBe(false);
    const exits = riftStates(sim.drainEvents(), pid);
    expect(exits.map((e) => e.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...exits], p.pos).map).toBe('overworld');
  });

  it('a dead /unstuck out of a rift emits the rift exit', () => {
    const { sim, pid, entry } = enterRiftSolo();
    kill(sim, pid);
    reviveAtGraveyardForUnstuck(sim.ctx, pid, 'none');
    const p = sim.entities.get(pid)!;
    expect(p.dead).toBe(false);
    expect(isRiftPos(p.pos.x)).toBe(false);
    const exits = riftStates(sim.drainEvents(), pid);
    expect(exits.map((e) => e.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...exits], p.pos).map).toBe('overworld');
  });

  it('a release outside any rift emits no riftState at all', () => {
    const { sim } = enterRiftSolo();
    const outside = sim.addPlayer('warrior', 'Outsider');
    expect(isRiftPos(sim.entities.get(outside)!.pos.x)).toBe(false);
    sim.drainEvents();
    kill(sim, outside);
    sim.releaseSpirit(outside);
    expect(sim.entities.get(outside)!.ghost).toBe(true);
    expect(riftStates(sim.drainEvents(), outside)).toEqual([]);
  });

  it('a ghost already at the graveyard using /unstuck emits no second exit', () => {
    const { sim, pid } = enterRiftSolo();
    kill(sim, pid);
    sim.releaseSpirit(pid);
    sim.drainEvents();
    reviveAtGraveyardForUnstuck(sim.ctx, pid, 'none');
    expect(sim.entities.get(pid)!.dead).toBe(false);
    expect(riftStates(sim.drainEvents(), pid)).toEqual([]);
  });

  it('a dungeon release emits no riftState (dungeon maps are position-derived)', () => {
    const { sim } = enterRiftSolo();
    const delver = sim.addPlayer('warrior', 'Delver');
    sim.setPlayerLevel(20, delver);
    sim.enterDungeon('hollow_crypt', delver);
    expect(dungeonAt(sim.entities.get(delver)!.pos.x), 'sanity: inside the dungeon').not.toBeNull();
    sim.drainEvents();
    kill(sim, delver);
    sim.releaseSpirit(delver);
    const ghost = sim.entities.get(delver)!;
    expect(ghost.ghost).toBe(true);
    expect(dungeonAt(ghost.pos.x), 'the ghost is outside the dungeon').toBeNull();
    expect(riftStates(sim.drainEvents(), delver)).toEqual([]);
  });
});
