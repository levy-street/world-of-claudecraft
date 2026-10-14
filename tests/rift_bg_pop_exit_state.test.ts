// A Thornhollow Fields seat must take the online client OUT of a rift.
//
// bgQueueJoin holds a spot through anything but a live match, so a fighter can be
// standing on a rift floor when the queue pops (or a backfill seat is offered).
// The seat teleports them onto the field, and the pop only ever detached DUNGEON
// fighters: a rift member got no riftState exit, so online the client kept its
// floor and the world map and minimap stayed locked on the rift plan for the whole
// match (mapWindowMode and minimapMode lead with `world.riftFloor`). The match
// also stored the interior rift coordinates as the return point, sending the
// fighter back onto a floor whose run may be gone by match end. The seat now
// detaches a rift member the way it detaches a dungeon one (rift/runs.ts
// detachFromRift): the exit is emitted and the return point is the portal side.
import { describe, expect, it, vi } from 'vitest';
import { isBgPos, isRiftPos } from '../src/sim/data';
import { riftInstanceAtPos } from '../src/sim/rift/runs';
import type { Sim } from '../src/sim/sim';
import {
  BG_MIN_LEVEL,
  type BgMatch,
  bgAllPids,
  bgResolveDesertion,
  bgRespond,
  endBgMatch,
} from '../src/sim/social/battleground';
import type { SimEvent } from '../src/sim/types';
import {
  enterNaturalRift,
  makeRiftSim,
  onlineMapModes,
  type RiftStateEvent,
  riftStates,
} from './rift_online_shared';

// Ten fighters plus a rift floor: the same raised budget as battleground.test.ts.
vi.setConfig({ testTimeout: 30000 });

function must<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(label);
  return value;
}

function acceptAllBgOffers(sim: Sim): void {
  for (const proposal of [...sim.ctx.bgProposals]) {
    for (const pid of [...proposal.teams[0], ...proposal.teams[1]]) bgRespond(sim.ctx, true, pid);
  }
}

/** Ten queued level-20 fighters, one tick short of the pop. */
function tenQueued(): { sim: Sim; pids: number[] } {
  const sim = makeRiftSim();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `Q${i}`);
    sim.setPlayerLevel(BG_MIN_LEVEL, pid);
    pids.push(pid);
  }
  for (const pid of pids) sim.bgQueueJoin(pid);
  return { sim, pids };
}

/** tenQueued, with one of them (`diver`) standing on floor 0 of a natural rift. */
function tenQueuedOneInRift(): {
  sim: Sim;
  pids: number[];
  diver: number;
  entry: RiftStateEvent;
} {
  const { sim, pids } = tenQueued();
  const diver = pids[6];
  const entry = enterNaturalRift(sim, diver);
  expect(must(sim.bgInfoFor(diver), 'bg info').queued, 'a rift run must not cost the spot').toBe(
    true,
  );
  return { sim, pids, diver, entry };
}

describe('a battleground seat clears the online rift floor', () => {
  it('the queue pop emits the rift exit and returns the fighter to the portal side', () => {
    const { sim, diver, entry } = tenQueuedOneInRift();
    const e = must(sim.entities.get(diver), 'entity');
    const inst = must(riftInstanceAtPos(sim.ctx, e.pos), 'rift instance');
    const events: SimEvent[] = [...sim.tick()]; // the pop, as an OFFER
    acceptAllBgOffers(sim);
    events.push(...sim.drainEvents());
    const match = must(sim.bgMatchFor(diver), 'bg match');
    expect(isBgPos(e.pos.x), 'seated on the field').toBe(true);

    const exits = riftStates(events, diver);
    expect(exits.map((ev) => ev.active)).toEqual([false]);
    expect(exits[0].instanceId).toBe(entry.instanceId);

    const modes = onlineMapModes([entry, ...exits], e.pos);
    expect(modes.riftFloor).toBeNull();
    expect(modes.map).toBe('battleground');
    expect(modes.minimap).toBe('battleground');

    // The return point is the rift's own exit spot outside the portal, never the
    // floor coordinates the fighter was pulled from.
    const ret = must(match.returns.get(diver), 'return point');
    expect(isRiftPos(ret.x)).toBe(false);
    expect({ x: ret.x, z: ret.z }).toEqual(inst.returnPos);

    sim.drainEvents();
    endBgMatch(sim.ctx, match, 0, 'caps');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(isRiftPos(e.pos.x), 'match end must not send the fighter back onto the floor').toBe(
      false,
    );
    expect(isBgPos(e.pos.x)).toBe(false);
    expect(riftStates(sim.drainEvents(), diver), 'nor re-enter the rift on landing').toEqual([]);
  });

  it('clears an ice-slide pose, so it is not carried onto the field', () => {
    const { sim, diver } = tenQueuedOneInRift();
    const e = must(sim.entities.get(diver), 'entity');
    e.riftSliding = true;
    e.riftSlideDirX = 1;
    sim.tick();
    acceptAllBgOffers(sim);
    expect(isBgPos(e.pos.x), 'seated on the field').toBe(true);
    expect(e.riftSliding).toBe(false);
    expect(e.riftSlideDirX).toBe(0);
  });

  it('a non-member standing on the floor goes home outside it, with no exit event', () => {
    // No entry event ever reached a non-member's client, so it gets no exit
    // either (emitRiftDeparture's rule); the return point still leaves the floor.
    const { sim, pids, diver } = tenQueuedOneInRift();
    const stray = pids[7];
    const d = must(sim.entities.get(diver), 'entity');
    const s = must(sim.entities.get(stray), 'entity');
    s.pos = { ...d.pos };
    s.prevPos = { ...d.pos };
    sim.ctx.rebucket(s);
    const inst = must(riftInstanceAtPos(sim.ctx, s.pos), 'rift instance');
    expect(inst.memberIds.has(stray), 'the arrangement: not a member').toBe(false);
    const events: SimEvent[] = [...sim.tick()];
    acceptAllBgOffers(sim);
    events.push(...sim.drainEvents());
    const match = must(sim.bgMatchFor(stray), 'bg match');
    expect(riftStates(events, stray)).toEqual([]);
    const ret = must(match.returns.get(stray), 'return point');
    expect({ x: ret.x, z: ret.z }).toEqual(inst.returnPos);
  });

  it('control: fighters who were not in a rift get no riftState from the pop', () => {
    const { sim, pids, diver } = tenQueuedOneInRift();
    const events: SimEvent[] = [...sim.tick()];
    acceptAllBgOffers(sim);
    events.push(...sim.drainEvents());
    const match = must(sim.bgMatchFor(diver), 'bg match');
    for (const pid of bgAllPids(match).filter((p) => p !== diver)) {
      expect(riftStates(events, pid)).toEqual([]);
    }
    expect(pids.every((pid) => sim.bgMatchFor(pid) === match)).toBe(true);
  });

  it('a backfill seat emits the rift exit too', () => {
    const { sim, pids } = tenQueued();
    // Start the match, then send a fresh queued spare into a rift and let a
    // desertion open the seat for them.
    sim.tick();
    acceptAllBgOffers(sim);
    const match: BgMatch = must(sim.bgMatchFor(pids[0]), 'bg match');
    for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
    const spare = sim.addPlayer('warrior', 'Spare');
    sim.setPlayerLevel(BG_MIN_LEVEL, spare);
    sim.bgQueueJoin(spare);
    const entry = enterNaturalRift(sim, spare);
    const e = must(sim.entities.get(spare), 'entity');
    const inst = must(riftInstanceAtPos(sim.ctx, e.pos), 'rift instance');

    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const events: SimEvent[] = [...sim.tick()]; // opens the OFFER
    bgRespond(sim.ctx, true, spare);
    events.push(...sim.drainEvents());
    expect(match.teams[0], 'the arrangement needs the seat actually filled').toContain(spare);
    expect(isBgPos(e.pos.x)).toBe(true);

    const exits = riftStates(events, spare);
    expect(exits.map((ev) => ev.active)).toEqual([false]);
    expect(onlineMapModes([entry, ...exits], e.pos).map).toBe('battleground');
    const ret = must(match.returns.get(spare), 'return point');
    expect({ x: ret.x, z: ret.z }).toEqual(inst.returnPos);
  });
});
