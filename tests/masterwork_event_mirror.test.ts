// Masterwork event mirror parity (Professions 2.0 Phase 2, the #2033 liveness
// class): the `masterwork` SimEvent must be a LIVE mirror on both hosts. The
// offline Sim stashes PlayerMeta.lastMasterwork when a craft procs, and the
// online ClientWorld rebuilds lastMasterwork from the event stream alone, so
// a dead stub (an applyMasterworkEvent the events loop never calls, or a
// mirror field nothing assigns) fails here.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// Hunted proc seed, pinned: with a fresh warrior (tailoring 0, no archetype,
// no self-signed reagent, not specialized) the first craft of
// recipe_eastbrook_ritual_vestments draws under the 3 percent base masterwork
// chance at this seed. Pre-verified against this exact grant order (3x
// linen_scrap then 1x spider_leg, then the craft); seeds 41, 46, 81, and 109
// also land, kept on record here as spares.
const PROC_SEED = 18;
const RECIPE_ID = 'recipe_eastbrook_ritual_vestments';
const ITEM_ID = 'eastbrook_ritual_vestments';

// One craft at the pinned seed: returns the sim, its player id, and every
// masterwork event that craft emitted.
function craftMasterwork() {
  const sim = new Sim({ seed: PROC_SEED, playerClass: 'warrior', autoEquip: false });
  const pid = sim.playerId;
  for (let i = 0; i < 3; i++) sim.addItem('linen_scrap', 1, pid);
  sim.addItem('spider_leg', 1, pid);
  sim.craftItem(RECIPE_ID, pid);
  const events = sim.drainEvents().filter((ev) => ev.type === 'masterwork');
  return { sim, pid, events };
}

// A ClientWorld with no constructor run (Object.create, the established
// bareClient pattern from tests/snapshots.test.ts). Class-field initializers
// do NOT run under Object.create, which is exactly the liveness point: the
// lastMasterwork property only comes to exist when the real event-apply path
// assigns it, so an unwired mirror cannot pass by initializer default.
function bareClient(): ClientWorld {
  const c = Object.create(ClientWorld.prototype) as ClientWorld;
  (c as unknown as { eventQueue: SimEvent[] }).eventQueue = [];
  return c;
}

// Feed one event through the real wire entry point (onMessage -> the
// 'events' branch -> applyMasterworkEvent), never by poking the field.
function feed(client: ClientWorld, ev: unknown): void {
  (client as unknown as { onMessage(raw: string): void }).onMessage(
    JSON.stringify({ t: 'events', list: [ev] }),
  );
}

describe('offline Sim host', () => {
  it('a procced craft emits the id-exact masterwork event and the getter reflects it (seed 18)', () => {
    const { sim, pid, events } = craftMasterwork();
    // Exactly one proc event, ids only, pid = crafter entity id on both keys.
    expect(events).toEqual([
      { type: 'masterwork', recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: pid, pid },
    ]);
    // The IWorld getter (sim.ts, next to lastCraftResult) reflects the stash.
    expect(sim.lastMasterwork).toEqual({ recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: pid });
    // The same craft's craftResult stash stays field-complete on the new flag.
    expect(sim.lastCraftResult?.masterwork).toBe(true);
  });
});

describe('online ClientWorld host', () => {
  it('mirrors lastMasterwork through the real event-apply path and updates on the next event', () => {
    const client = bareClient();
    // No initializer ran: the mirror must be ASSIGNED by the events loop.
    expect((client as unknown as { lastMasterwork?: unknown }).lastMasterwork).toBeUndefined();
    feed(client, { type: 'masterwork', recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: 7, pid: 7 });
    expect(client.lastMasterwork).toEqual({ recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: 7 });
    // Not a one-shot: a later proc replaces the mirror wholesale.
    feed(client, {
      type: 'masterwork',
      recipeId: 'recipe_eastbrook_druids_hide',
      itemId: 'eastbrook_druids_hide',
      crafter: 7,
      pid: 7,
    });
    expect(client.lastMasterwork).toEqual({
      recipeId: 'recipe_eastbrook_druids_hide',
      itemId: 'eastbrook_druids_hide',
      crafter: 7,
    });
    // A non-masterwork event never disturbs the mirror.
    feed(client, { type: 'craftResult', ok: true, recipeId: RECIPE_ID, pid: 7 });
    expect(client.lastMasterwork).toEqual({
      recipeId: 'recipe_eastbrook_druids_hide',
      itemId: 'eastbrook_druids_hide',
      crafter: 7,
    });
    // Both masterwork events still flowed on to the HUD drain untouched.
    const queued = (client as unknown as { eventQueue: SimEvent[] }).eventQueue;
    expect(queued.map((ev) => ev.type)).toEqual(['masterwork', 'masterwork', 'craftResult']);
  });

  it('the craftResult mirror carries the masterwork flag and rebuilds it per event', () => {
    // applyCraftResultEvent (online.ts) must copy the Phase 2 `masterwork`
    // field into the lastCraftResult mirror: a dropped field here would leave
    // the online HUD unable to distinguish a proc, with every other test
    // (Sim-side only) still green.
    const client = bareClient();
    feed(client, {
      type: 'craftResult',
      ok: true,
      recipeId: RECIPE_ID,
      itemId: ITEM_ID,
      count: 1,
      quality: 'uncommon',
      masterwork: true,
      pid: 7,
    });
    expect(client.lastCraftResult?.ok).toBe(true);
    expect(client.lastCraftResult?.quality).toBe('uncommon');
    expect(client.lastCraftResult?.masterwork).toBe(true);
    // The mirror is rebuilt wholesale per event: a later non-proc craft must
    // not inherit the flag from the previous proc.
    feed(client, {
      type: 'craftResult',
      ok: true,
      recipeId: RECIPE_ID,
      itemId: ITEM_ID,
      count: 1,
      quality: 'uncommon',
      pid: 7,
    });
    expect(client.lastCraftResult?.ok).toBe(true);
    expect(client.lastCraftResult?.masterwork).toBeUndefined();
  });
});

describe('host parity', () => {
  it('both hosts expose the identical lastMasterwork view for the same emitted payload', () => {
    const { sim, pid, events } = craftMasterwork();
    const client = bareClient();
    feed(client, events[0]);
    // Field-for-field: pinned literal on each host, then the cross-host check.
    const expected = { recipeId: RECIPE_ID, itemId: ITEM_ID, crafter: pid };
    expect(sim.lastMasterwork).toEqual(expected);
    expect(client.lastMasterwork).toEqual(expected);
    expect(client.lastMasterwork).toEqual(sim.lastMasterwork);
  });
});
