// The pending Town Focus re-spec (#1144) as a thing the player can SEE and
// KEEP. Before this, a 'time'/'timeAndPartial' re-spec was queued on
// PlayerMeta only: the panel kept showing the old committed allocation for the
// whole wait (60 s per point on the free tier, so 10 points is 10 minutes),
// every re-save of the same allocation replaced the queue and restarted its
// clock, and the queue was never serialized, so a logout, an expired linkdead
// grace or an instance handoff dropped it silently. Players read all of that
// as "Town Focus does nothing".
//
// Contract pinned here:
//   1. professions/town_focus_pending.ts, the pure leaf: the save encoding
//      (remaining seconds, never an absolute sim time), the strict load, and
//      the read view both hosts hand the panel.
//   2. Sim persistence: a queued re-spec round-trips serializeCharacter ->
//      addPlayer with its remaining wait intact, and resolves on the new Sim.
//   3. Re-saving the SAME allocation never pushes the clock back; a faster
//      tier still re-queues sooner, and the instant tier still supersedes.
//   4. IWorld `townFocusPending` on Sim, and the online mirror through the
//      `tfpend` self-wire key (server/gathering_self_wire.ts ->
//      src/net/professions_self_mirror.ts).
import { describe, expect, it } from 'vitest';
import { appendGatheringSelfWire } from '../server/gathering_self_wire';
import { applyProfessionsSelfMirror } from '../src/net/professions_self_mirror';
import { ZONES } from '../src/sim/data';
import { POINTS_PER_TIER_BONUS, RESPEC_TIER_CONFIG } from '../src/sim/professions/focus';
import {
  loadPendingTownFocus,
  type PendingTownFocus,
  parseTownFocusPendingView,
  serializePendingTownFocus,
  townFocusPendingView,
} from '../src/sim/professions/town_focus_pending';
import type { CharacterState, PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { UNMAPPED_FAMILY } from './helpers/unmapped_family';

type SimInternals = { entities: Map<number, Entity>; players: Map<number, PlayerMeta> };

const ZONE1 = ZONES[0];
const TIME_PER_POINT_S = RESPEC_TIER_CONFIG.time.durationMsPerPoint / 1000;

function inTown(seed = 21) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const pid = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  const e = requireEntity(internals, pid);
  e.pos = { x: ZONE1.hub.x, y: 0, z: ZONE1.hub.z };
  e.prevPos = { ...e.pos };
  sim.drainEvents();
  return { sim, internals, pid, meta: requirePlayerMeta(internals, pid) };
}

function noticesOf(sim: Sim): string[] {
  return sim
    .drainEvents()
    .filter((ev) => ev.type === 'log' || ev.type === 'error')
    .map((ev) => (ev as { text: string }).text);
}

function requirePendingTownFocus(meta: PlayerMeta): PendingTownFocus {
  const pending = meta.pendingTownFocus;
  expect(pending).not.toBeNull();
  if (!pending) throw new Error('expected pending Town Focus re-spec');
  return pending;
}

function requireEntity(internals: SimInternals, pid: number): Entity {
  const entity = internals.entities.get(pid);
  expect(entity).toBeDefined();
  if (!entity) throw new Error(`expected entity ${pid}`);
  return entity;
}

function requirePlayerMeta(internals: SimInternals, pid: number): PlayerMeta {
  const meta = internals.players.get(pid);
  expect(meta).toBeDefined();
  if (!meta) throw new Error(`expected player meta ${pid}`);
  return meta;
}

function requireCharacterState(state: CharacterState | null | undefined): CharacterState {
  expect(state).toBeDefined();
  if (!state) throw new Error('expected serialized character state');
  return state;
}

function requirePendingTownFocusView(
  view: ReturnType<typeof townFocusPendingView>,
): NonNullable<ReturnType<typeof townFocusPendingView>> {
  expect(view).not.toBeNull();
  if (!view) throw new Error('expected pending Town Focus view');
  return view;
}

// ---------------------------------------------------------------------------
// 1. The pure leaf.
// ---------------------------------------------------------------------------

describe('town_focus_pending leaf', () => {
  const pending: PendingTownFocus = {
    allocation: { silk: 10 },
    readyAtTime: 700,
    coin: 5,
    materials: 1,
  };

  it('serializes the wait as REMAINING seconds, never the absolute sim time', () => {
    // Sim time restarts from 0 on every process and every instance, so an
    // absolute readyAtTime would either resolve instantly or never.
    expect(serializePendingTownFocus(pending, 100)).toEqual({
      pendingTownFocus: { allocation: { silk: 10 }, remainingSeconds: 600, coin: 5, materials: 1 },
    });
    // Sparse: nothing queued writes no key at all, so a pre-feature save and
    // an idle player read byte-identical.
    expect(serializePendingTownFocus(undefined, 100)).toEqual({});
    // Past due (the tick loop has not resolved it yet) clamps to zero, never
    // negative, so the reload resolves it on its first tick.
    expect(serializePendingTownFocus(pending, 900).pendingTownFocus?.remainingSeconds).toBe(0);
  });

  it('loads back onto the NEW clock, coin and material charge intact', () => {
    const saved = serializePendingTownFocus(pending, 100).pendingTownFocus;
    expect(loadPendingTownFocus(saved, 5)).toEqual({
      allocation: { silk: 10 },
      readyAtTime: 605,
      coin: 5,
      materials: 1,
    });
    expect(loadPendingTownFocus(undefined, 5)).toBeUndefined();
  });

  it('normalizes the queued allocation the same way the committed one is on load', () => {
    // A junk key (#2511) or a non-integer point count never rides back out
    // through updateTownFocusRespec onto meta.townFocus.
    expect(
      loadPendingTownFocus(
        {
          allocation: { hide: 3, eastbrook: 4, [UNMAPPED_FAMILY]: 2, fang: 1.5, silk: 0 },
          remainingSeconds: 10,
          coin: 0,
          materials: 0,
        },
        0,
      ),
    ).toEqual({ allocation: { hide: 3 }, readyAtTime: 10, coin: 0, materials: 0 });
  });

  const malformed: unknown[] = [
    null,
    42,
    'silk',
    [],
    {},
    { allocation: { silk: 1 } },
    { allocation: { silk: 1 }, remainingSeconds: -1, coin: 0, materials: 0 },
    { allocation: { silk: 1 }, remainingSeconds: Number.NaN, coin: 0, materials: 0 },
    { allocation: { silk: 1 }, remainingSeconds: Number.POSITIVE_INFINITY, coin: 0, materials: 0 },
    { allocation: 'silk', remainingSeconds: 10, coin: 0, materials: 0 },
    { allocation: null, remainingSeconds: 10, coin: 0, materials: 0 },
  ];
  for (const saved of malformed) {
    it(`refuses a malformed persisted queue to nothing: ${JSON.stringify(saved)}`, () => {
      expect(loadPendingTownFocus(saved, 0)).toBeUndefined();
      expect(parseTownFocusPendingView(saved)).toBeNull();
    });
  }
  // The charge fields are the LOAD's concern only: the wire view never
  // carries them, so the shared parse must not refuse over them.
  for (const saved of [
    { allocation: { silk: 1 }, remainingSeconds: 10, coin: -1, materials: 0 },
    { allocation: { silk: 1 }, remainingSeconds: 10, coin: 0, materials: 'one' },
  ]) {
    it(`refuses a malformed CHARGE on load only: ${JSON.stringify(saved)}`, () => {
      expect(loadPendingTownFocus(saved, 0)).toBeUndefined();
      expect(parseTownFocusPendingView(saved)).toEqual({
        allocation: { silk: 1 },
        remainingSeconds: 10,
      });
    });
  }

  it('projects the read view with whole remaining seconds, rounded up, floored at zero', () => {
    expect(townFocusPendingView(pending, 100)).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 600,
    });
    expect(townFocusPendingView(pending, 699.2)).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 1,
    });
    expect(townFocusPendingView(pending, 900)?.remainingSeconds).toBe(0);
    expect(townFocusPendingView(undefined, 100)).toBeNull();
    // Cloned, never the live allocation: a panel draft mutating its rows
    // must not reach into the queue.
    const view = requirePendingTownFocusView(townFocusPendingView(pending, 100));
    expect(view.allocation).not.toBe(pending.allocation);
  });

  it('parses a wire view strictly, and the parse is what the mirror trusts', () => {
    expect(parseTownFocusPendingView({ allocation: { silk: 10 }, remainingSeconds: 3 })).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 3,
    });
    expect(
      parseTownFocusPendingView({ allocation: { silk: 10, junk: 1 }, remainingSeconds: 3.7 }),
    ).toEqual({ allocation: { silk: 10 }, remainingSeconds: 4 });
    expect(parseTownFocusPendingView({ allocation: {}, remainingSeconds: 0 })).toEqual({
      allocation: {},
      remainingSeconds: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Sim persistence.
// ---------------------------------------------------------------------------

describe('a queued town-focus re-spec through real Sim persistence', () => {
  it('survives serializeCharacter -> addPlayer with its remaining wait intact', () => {
    const { sim, pid } = inTown();
    sim.time = 0;
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    expect(sim.townFocusFor(pid)).toEqual({});
    // Wait out part of it on the first Sim.
    sim.time = 200;
    const state = requireCharacterState(sim.serializeCharacter(pid));
    expect(state.pendingTownFocus).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 10 * TIME_PER_POINT_S - 200,
      coin: 0,
      materials: 0,
    });

    // A fresh process: sim time restarts from 0.
    const reloaded = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true });
    const pid2 = reloaded.addPlayer('warrior', 'Alpha', { state });
    expect(reloaded.townFocusFor(pid2)).toEqual({});
    expect(reloaded.townFocusPendingFor(pid2)).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 400,
    });
    // Not yet: the remaining 400 s have to elapse on THIS clock.
    reloaded.time = 399;
    reloaded.tick();
    expect(reloaded.townFocusFor(pid2)).toEqual({});
    reloaded.time = 401;
    reloaded.tick();
    expect(reloaded.townFocusFor(pid2)).toEqual({ silk: 10 });
    expect(reloaded.townFocusPendingFor(pid2)).toBeNull();
    // Resolved on the new Sim exactly once: a second save carries nothing.
    expect(
      Object.hasOwn(requireCharacterState(reloaded.serializeCharacter(pid2)), 'pendingTownFocus'),
    ).toBe(false);
  });

  it('a JSON round trip (the JSONB column shape) keeps the queue', () => {
    const { sim, pid } = inTown();
    sim.setTownFocus({ hide: 2 }, 'time', pid);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid))) as CharacterState;
    const reloaded = new Sim({ seed: 4, playerClass: 'warrior', noPlayer: true });
    const pid2 = reloaded.addPlayer('warrior', 'Alpha', { state });
    expect(reloaded.townFocusPendingFor(pid2)).toEqual({
      allocation: { hide: 2 },
      remainingSeconds: 2 * TIME_PER_POINT_S,
    });
  });

  it('a pre-feature save (no key) and an idle player both load with nothing queued', () => {
    const { sim, pid } = inTown();
    const state = requireCharacterState(sim.serializeCharacter(pid));
    expect(Object.hasOwn(state, 'pendingTownFocus')).toBe(false);
    const reloaded = new Sim({ seed: 5, playerClass: 'warrior', noPlayer: true });
    const pid2 = reloaded.addPlayer('warrior', 'Alpha', { state });
    expect(reloaded.townFocusPendingFor(pid2)).toBeNull();
  });

  it('a malformed persisted queue loads as nothing queued and does not poison the save', () => {
    const { sim, pid } = inTown();
    const junk = {
      ...requireCharacterState(sim.serializeCharacter(pid)),
      pendingTownFocus: { allocation: { silk: 1 }, remainingSeconds: 'soon' },
    } as unknown as CharacterState;
    const reloaded = new Sim({ seed: 6, playerClass: 'warrior', noPlayer: true });
    const pid2 = reloaded.addPlayer('warrior', 'Alpha', { state: junk });
    expect(reloaded.townFocusPendingFor(pid2)).toBeNull();
    expect(
      Object.hasOwn(requireCharacterState(reloaded.serializeCharacter(pid2)), 'pendingTownFocus'),
    ).toBe(false);
  });

  it('a reloaded paid queue still re-checks affordability at resolution', () => {
    const { sim, pid, meta } = inTown();
    meta.copper = 1000;
    sim.addItem('arcane_dust', 10, pid);
    sim.setTownFocus({ hide: 2 }, 'timeAndPartial', pid);
    const state = requireCharacterState(sim.serializeCharacter(pid));
    expect(state.pendingTownFocus).toMatchObject({ coin: 10, materials: 2 });

    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid2 = reloaded.addPlayer('warrior', 'Alpha', { state });
    // Spend the purse before it resolves: the reload must cancel, not charge
    // into the negative.
    requirePlayerMeta(reloaded as unknown as SimInternals, pid2).copper = 0;
    reloaded.time = 1000;
    reloaded.drainEvents();
    const ticked = reloaded.tick().map((ev) => (ev as { text?: string }).text);
    expect(reloaded.townFocusFor(pid2)).toEqual({});
    expect(reloaded.townFocusPendingFor(pid2)).toBeNull();
    expect(ticked).toContain(
      'You could not afford your pending focus re-spec, so it was cancelled.',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Re-saving never pushes the clock back.
// ---------------------------------------------------------------------------

describe('re-saving a queued allocation', () => {
  it('the SAME allocation on the same tier keeps the original clock and says so', () => {
    const { sim, pid, meta } = inTown();
    sim.time = 0;
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    const readyAt = requirePendingTownFocus(meta).readyAtTime;
    expect(readyAt).toBe(10 * TIME_PER_POINT_S);
    sim.drainEvents();

    sim.time = 300;
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    expect(requirePendingTownFocus(meta).readyAtTime).toBe(readyAt);
    // The notice reports the wait actually LEFT, not a fresh full duration.
    expect(noticesOf(sim)).toEqual([`Your focus re-spec will complete in ${readyAt - 300}s.`]);
  });

  it('re-saving the same allocation with the rows in another order is still the same allocation', () => {
    const { sim, pid, meta } = inTown();
    sim.setTownFocus({ silk: 4, hide: 6 }, 'time', pid);
    const readyAt = requirePendingTownFocus(meta).readyAtTime;
    sim.time = 50;
    sim.setTownFocus({ hide: 6, silk: 4 }, 'time', pid);
    expect(requirePendingTownFocus(meta).readyAtTime).toBe(readyAt);
  });

  it('a FASTER tier for the same allocation re-queues sooner (and re-prices)', () => {
    const { sim, pid, meta } = inTown();
    meta.copper = 1000;
    sim.addItem('arcane_dust', 20, pid);
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    const slow = requirePendingTownFocus(meta).readyAtTime;
    sim.setTownFocus({ silk: 10 }, 'timeAndPartial', pid);
    const fast = requirePendingTownFocus(meta);
    expect(fast.readyAtTime).toBeLessThan(slow);
    expect(fast.readyAtTime).toBe(
      sim.time + (10 * RESPEC_TIER_CONFIG.timeAndPartial.durationMsPerPoint) / 1000,
    );
    expect(fast.coin).toBe(10 * RESPEC_TIER_CONFIG.timeAndPartial.coinPerPoint);
    expect(fast.materials).toBe(10 * RESPEC_TIER_CONFIG.timeAndPartial.materialsPerPoint);
  });

  it('a SLOWER tier for the same allocation keeps the faster clock already running', () => {
    const { sim, pid, meta } = inTown();
    meta.copper = 1000;
    sim.addItem('arcane_dust', 20, pid);
    sim.setTownFocus({ silk: 10 }, 'timeAndPartial', pid);
    const fast = requirePendingTownFocus(meta);
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    expect(meta.pendingTownFocus).toEqual(fast);
  });

  it('a DIFFERENT allocation replaces the queue as before', () => {
    const { sim, pid, meta } = inTown();
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    sim.time = 100;
    sim.setTownFocus({ silk: 9, hide: 1 }, 'time', pid);
    const pending = requirePendingTownFocus(meta);
    expect(pending.allocation).toEqual({ silk: 9, hide: 1 });
    expect(pending.readyAtTime).toBe(100 + 10 * TIME_PER_POINT_S);
  });

  it('the instant tier still supersedes a queued re-spec', () => {
    const { sim, pid, meta } = inTown();
    meta.copper = 100000;
    sim.addItem('arcane_dust', 100, pid);
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    sim.setTownFocus({ silk: 10 }, 'instant', pid);
    expect(sim.townFocusFor(pid)).toEqual({ silk: 10 });
    expect(meta.pendingTownFocus).toBeUndefined();
    expect(sim.townFocusPendingFor(pid)).toBeNull();
  });

  it('re-saving the committed allocation itself is still the free no-op it always was', () => {
    const { sim, pid, meta } = inTown();
    meta.copper = 100000;
    sim.addItem('arcane_dust', 100, pid);
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, 'instant', pid);
    const copper = meta.copper;
    sim.drainEvents();
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, 'time', pid);
    expect(meta.copper).toBe(copper);
    expect(sim.townFocusFor(pid)).toEqual({ hide: POINTS_PER_TIER_BONUS });
  });
});

// ---------------------------------------------------------------------------
// 4. The read on both hosts.
// ---------------------------------------------------------------------------

describe('IWorld townFocusPending', () => {
  it('the Sim primary-player getter mirrors the per-pid reader', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior' });
    const pid = sim.playerId;
    const e = requireEntity(sim as unknown as SimInternals, pid);
    e.pos = sim.groundPos(ZONE1.hub.x, ZONE1.hub.z);
    e.prevPos = { ...e.pos };
    expect(sim.townFocusPending).toBeNull();
    sim.setTownFocus({ meat: 3 }, 'time', pid);
    expect(sim.townFocusPending).toEqual(sim.townFocusPendingFor(pid));
    expect(sim.townFocusPending).toEqual({
      allocation: { meat: 3 },
      remainingSeconds: 3 * TIME_PER_POINT_S,
    });
    expect(sim.townFocusPendingFor(999999)).toBeNull();
  });

  it('rides the self wire as tfpend and lands on the online mirror through the shared parse', () => {
    const { sim, pid } = inTown();
    sim.setTownFocus({ silk: 10 }, 'time', pid);
    const written = new Map<string, unknown>();
    appendGatheringSelfWire(
      sim,
      pid,
      (key, value) => written.set(key, value),
      (key, serialized) => written.set(key, JSON.parse(serialized)),
    );
    expect(written.get('tfpend')).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 10 * TIME_PER_POINT_S,
    });

    const target = { townFocusPending: null } as Parameters<typeof applyProfessionsSelfMirror>[0];
    // A JSON hop, the real wire shape.
    applyProfessionsSelfMirror(
      target,
      JSON.parse(JSON.stringify({ tfpend: written.get('tfpend') })),
    );
    expect(target.townFocusPending).toEqual({
      allocation: { silk: 10 },
      remainingSeconds: 10 * TIME_PER_POINT_S,
    });
    // Delta-omitted: an absent key keeps the prior mirror.
    applyProfessionsSelfMirror(target, {});
    expect(target.townFocusPending).not.toBeNull();
    // Explicit null (the queue resolved or was cancelled) clears it.
    applyProfessionsSelfMirror(target, { tfpend: null });
    expect(target.townFocusPending).toBeNull();
    // A malformed frame refuses to null rather than rendering a partial view.
    applyProfessionsSelfMirror(target, { tfpend: { allocation: 'silk', remainingSeconds: 1 } });
    expect(target.townFocusPending).toBeNull();
  });

  it('the wire key reads null while nothing is queued', () => {
    const { sim, pid } = inTown();
    const written = new Map<string, unknown>();
    appendGatheringSelfWire(
      sim,
      pid,
      (key, value) => written.set(key, value),
      (key, serialized) => written.set(key, JSON.parse(serialized)),
    );
    expect(written.has('tfpend')).toBe(true);
    expect(written.get('tfpend')).toBeNull();
  });
});
