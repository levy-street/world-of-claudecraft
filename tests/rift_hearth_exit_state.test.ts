// An Allied Hearthstone used on a rift floor must take the online client OUT of
// the rift.
//
// The hearthstone has no instance refusal (it works out of a dungeon the classic
// way), so it is reachable from a rift floor, and its completion moves the player
// through displacement.ts displacePlayer. That recipe sent no riftState exit, so
// online the client kept its rift floor at the faction hub: the world map and
// minimap stayed on the rift plan (both lead with `world.riftFloor`). The shared
// recipe now emits the exit (ctx.emitRiftDeparture) before the move, and drops
// any ice-slide pose that only the in-band rift trigger would otherwise clear.
import { describe, expect, it } from 'vitest';
import { completeAlliedHearthstoneCast } from '../src/sim/content/faction_rewards';
import { isRiftPos } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import {
  enterNaturalRift,
  makeRiftSim,
  onlineMapModes,
  type RiftStateEvent,
  riftStates,
} from './rift_online_shared';

function hearth(sim: Sim, pid: number): void {
  const meta = sim.ctx.players.get(pid)!;
  meta.alliedHearthstoneAttunement = 'church_order';
  completeAlliedHearthstoneCast(sim.ctx, sim.entities.get(pid)!, meta);
}

function riftRunner(): { sim: Sim; pid: number; entry: RiftStateEvent } {
  const sim = makeRiftSim();
  const pid = sim.addPlayer('warrior', 'Hearther');
  sim.setPlayerLevel(20, pid);
  return { sim, pid, entry: enterNaturalRift(sim, pid) };
}

describe('a hearthstone off a rift floor clears the online rift floor', () => {
  it('emits the rift exit, so the hub landing shows the overworld map', () => {
    const { sim, pid, entry } = riftRunner();
    hearth(sim, pid);
    const p = sim.entities.get(pid)!;
    expect(isRiftPos(p.pos.x), 'landed at the hub').toBe(false);

    const exits = riftStates(sim.drainEvents(), pid);
    expect(exits.map((e) => e.active)).toEqual([false]);
    expect(exits[0].instanceId).toBe(entry.instanceId);
    const modes = onlineMapModes([entry, ...exits], p.pos);
    expect(modes.riftFloor).toBeNull();
    expect(modes.map).toBe('overworld');
    expect(modes.minimap).toBe('overworld');
  });

  it('does not carry an ice-slide pose to the landing', () => {
    const { sim, pid } = riftRunner();
    const p = sim.entities.get(pid)!;
    p.riftSliding = true;
    p.riftSlideDirZ = -1;
    hearth(sim, pid);
    expect(isRiftPos(p.pos.x)).toBe(false);
    expect(p.riftSliding).toBe(false);
    expect(p.riftSlideDirZ).toBe(0);
  });

  it('an overworld hearth emits no riftState at all', () => {
    const { sim } = riftRunner();
    const home = sim.addPlayer('warrior', 'Homebody');
    expect(isRiftPos(sim.entities.get(home)!.pos.x)).toBe(false);
    sim.drainEvents();
    hearth(sim, home);
    expect(riftStates(sim.drainEvents(), home)).toEqual([]);
  });
});
