// The Perfecting stage over the real online path (Masterwrought phase 12):
// the perfect_item frames ClientWorld emits, fed verbatim into the real
// GameServer dispatch; a bagged and a worn attempt resolving SERVER-SIDE (the
// sim spends the materials and mutates the copy, never the client); the
// HEAVY_SELF_CMDS arm proven by the inv/einst self mirrors actually updating
// on the next broadcast with every other freshness input held off; the
// malformed-frame matrix dropping before any sim call; the sim's own denial
// drawing nothing; and the shared-builder parity claim, ClientWorld's
// perfectingInfo over the mirrored state against the server sim's own.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { HEAVY_SELF_CMDS } from '../server/heavy_self';
import type { ClientWorld } from '../src/net/online';
import {
  PERFECTING_ATTEMPT_COST,
  PERFECTING_RANKS,
  PERFECTING_SKILL_REQ,
} from '../src/sim/professions/perfecting';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import type { InvSlot, ItemInstancePayload, SimEvent } from '../src/sim/types';
import type { PerfectItemRef } from '../src/world_api/professions';
import {
  bareClient,
  broadcast,
  type FakeClient,
  fakeWs,
  joinServer,
  lastSnap,
} from './helpers/bare_client';

const APEX_NECK = 'wyrmfall_pendant'; // apex jewelry, no class gate (jewelcrafting)
const NON_APEX = 'eastbrook_arming_sword';
const MATERIALS = 8;

type SelfFrame = {
  inv?: InvSlot[];
  einst?: Partial<Record<string, ItemInstancePayload>>;
};

function serverMeta(server: GameServer, pid: number): PlayerMeta {
  const meta = server.sim.meta(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

/** A skill-125 jewelcrafter holding several of every attempt material and one
 *  apex neck in the bags, so no arm below can deny for want of skill or
 *  materials instead of what it tests. */
function seedPerfecter(server: GameServer, pid: number): void {
  const meta = serverMeta(server, pid);
  meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  for (const c of PERFECTING_ATTEMPT_COST) server.sim.addItem(c.itemId, MATERIALS, pid);
  server.sim.addItem(APEX_NECK, 1, pid);
}

/** Stamp `perfected` on a bagged copy, the ONE payload field Sim.perfectItemAs
 *  routes on: a perfected copy goes to the promotion ladder (which consumes
 *  the legendary name), every other copy to the ordinary attempt (which
 *  ignores it). The phase 18 name screen asks exactly this question, so the
 *  refusal arm needs a copy that really answers yes. */
function markPerfected(server: GameServer, pid: number, bag: number): void {
  const slot = serverMeta(server, pid).inventory[bag];
  expect(slot, `bag ${bag} holds a copy to perfect`).toBeTruthy();
  slot.instance = { ...(slot.instance ?? {}), perfected: true };
}

function bagRefOf(
  server: GameServer,
  pid: number,
  itemId: string,
): { bag: number; itemId: string } {
  const bag = serverMeta(server, pid).inventory.findIndex((s) => s.itemId === itemId);
  expect(bag, `${itemId} is really in the bags`).toBeGreaterThanOrEqual(0);
  return { bag, itemId };
}

/** The facet ref as the WIRE spells it (online.ts perfectItem: `item`, not
 *  `itemId`), for the raw-frame arms that bypass ClientWorld. */
function wireOf(ref: { bag: number; itemId: string }): { bag: number; item: string } {
  return { bag: ref.bag, item: ref.itemId };
}

function materialCounts(server: GameServer, pid: number): number[] {
  return PERFECTING_ATTEMPT_COST.map((c) => server.sim.countItem(c.itemId, pid));
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

/** A Date.now spy that steps the wall clock a whole second per tick(), so a
 *  run of NAMED perfect_item frames refills the name-screen lane between
 *  frames (server/msg_lanes.ts: burst 5, two tokens per second) instead of
 *  tripping it: the dispatch tests here are about the halves after the lane. */
function namedFrameClock(): { tick(): void; restore(): void } {
  let now = Date.now();
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    tick: () => {
      now += 1000;
    },
    restore: () => spy.mockRestore(),
  };
}

/** Route the sim's pending events to the sessions WITHOUT a tick, so an
 *  attempt's own error/log lines reach the client with the world clock held. */
function routePending(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.drainEvents());
}

/** Force the sim's next draws to `value` for the duration of `run` (the
 *  professions_masterwork forced-roll idiom), restoring the live stream after. */
function withForcedRoll(sim: Sim, value: number, run: () => void): number {
  const rng = sim.rng as { next: () => number };
  const live = rng.next;
  let draws = 0;
  rng.next = () => {
    draws += 1;
    return value;
  };
  try {
    run();
  } finally {
    rng.next = live;
  }
  return draws;
}

/** Draw count over one action through the untouched live stream. */
function drawsDuring(sim: Sim, run: () => void): number {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws += 1;
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return draws;
}

function textEvents(sent: FakeClient['sent']): string[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => (m.list ?? []) as SimEvent[])
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'log' | 'error' }> =>
        ev.type === 'log' || ev.type === 'error',
    )
    .map((ev) => ev.text);
}

function selfOf(frame: unknown): SelfFrame | undefined {
  return (frame as { self?: SelfFrame } | null)?.self;
}

/** Hold every OTHER heavy-self freshness input off, so what the next broadcast
 *  carries is the receipt-time HEAVY_SELF_CMDS mark's doing alone: the wireRev
 *  the sim bumped is re-synced, and the sim is ticked past any tick whose
 *  staggered modulo refresh would fire for this pid. */
function holdOtherFreshnessOff(server: GameServer, session: ClientSession, pid: number): void {
  while ((server.sim.tickCount + pid) % 40 === 0) {
    (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
  }
  (session as unknown as { lastWireRev: number }).lastWireRev = serverMeta(server, pid).wireRev;
}

function heavyDirty(session: ClientSession): boolean {
  return (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty;
}

function setHeavyDirty(session: ClientSession, value: boolean): void {
  (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = value;
}

/** A ClientWorld that can SEND: canSendCommand() reads WebSocket.OPEN off the
 *  global (stubbed for the file) and the fixture's `connected` default. */
function sendingClient(pid: number): { client: ClientWorld; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const client = bareClient(pid, {
    ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
  });
  return { client, sent };
}

let oldWebSocket: unknown;
beforeAll(() => {
  oldWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = { OPEN: 1 };
});
afterAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = oldWebSocket;
});
// A namedFrameClock left un-restored by a failing assertion would freeze
// Date.now for every later test in the file; restore every spy per test.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientWorld emits the perfect_item frames the protocol declares', () => {
  it('a worn ref rides as `slot` alone and a bagged ref as `bag` plus `item`, nothing else', () => {
    const { client, sent } = sendingClient(1);
    client.perfectItem({ slot: 'neck' });
    client.perfectItem({ bag: 3, itemId: APEX_NECK });
    expect(sent).toEqual([
      { t: 'cmd', cmd: 'perfect_item', slot: 'neck' },
      { t: 'cmd', cmd: 'perfect_item', bag: 3, item: APEX_NECK },
    ]);
  });

  it('perfect_item is a HEAVY_SELF_CMDS member (the membership the arms below prove)', () => {
    expect(HEAVY_SELF_CMDS.has('perfect_item')).toBe(true);
  });
});

describe('perfect_item over the real online dispatch path', () => {
  it('a bagged ref resolves server-side and the inv mirror re-diffs on the next broadcast', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 901, 'Perfecter');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    // The join-time full self snapshot, so the mirror below is a DIFF.
    broadcast(server);
    const ref = bagRefOf(server, pid, APEX_NECK);
    const before = materialCounts(server, pid);
    expect(before).toEqual([MATERIALS, MATERIALS, MATERIALS]);

    // The frame ClientWorld emits, verbatim, into the real dispatch.
    const { client, sent } = sendingClient(pid);
    client.perfectItem(ref);
    setHeavyDirty(session, false);
    fc.sent.length = 0; // drop the join notice, so the lines below are the attempt's alone
    const draws = withForcedRoll(server.sim, 0, () => {
      server.handleMessage(session, JSON.stringify(sent[0]));
    });
    // Resolved ON THE SERVER: exactly one draw, the bill spent, the copy bound
    // and advanced to rank 1 (a forced success).
    expect(draws).toBe(1);
    expect(materialCounts(server, pid)).toEqual(before.map((n) => n - 1));
    const copy = serverMeta(server, pid).inventory[ref.bag];
    expect(copy.itemId).toBe(APEX_NECK);
    expect(copy.instance?.boundTo).toBe(serverMeta(server, pid).entityId);
    expect(copy.instance?.perfecting).toBe(1);
    // The sim's own feedback lines reach this client as routed events.
    routePending(server);
    expect(textEvents(fc.sent)).toEqual([
      'Perfecting begins: Wyrmfall Pendant is now bound to you.',
      'Perfecting: Wyrmfall Pendant advances to rank 1 of 4.',
    ]);

    // The membership claim, behaviorally: receipt alone marked the self
    // mirror dirty (drop perfect_item from HEAVY_SELF_CMDS and this reads
    // false while the sim still resolved perfectly).
    expect(heavyDirty(session)).toBe(true);
    // ...and that mark ALONE ships the heavy block: every other freshness
    // input is held off before the broadcast.
    holdOtherFreshnessOff(server, session, pid);
    fc.sent.length = 0;
    broadcast(server);
    const self = selfOf(lastSnap(fc.sent));
    expect(self?.inv, 'the inv mirror re-diffed').toBeDefined();
    const mirrored = (self?.inv ?? []).find((s) => s.itemId === APEX_NECK);
    expect(mirrored?.instance).toEqual(copy.instance);
    for (const c of PERFECTING_ATTEMPT_COST) {
      const held = (self?.inv ?? [])
        .filter((s) => s.itemId === c.itemId)
        .reduce((sum, s) => sum + s.count, 0);
      expect(held, `${c.itemId} in the mirror`).toBe(MATERIALS - 1);
    }
    // The negative control on the same fixture: with the mark cleared and
    // nothing else dirty, the next broadcast omits the heavy block entirely.
    holdOtherFreshnessOff(server, session, pid);
    setHeavyDirty(session, false);
    fc.sent.length = 0;
    broadcast(server);
    expect(selfOf(lastSnap(fc.sent))?.inv).toBeUndefined();
  });

  it('a worn ref resolves in place and the einst mirror re-diffs, bind included', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 902, 'Wearer');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    server.sim.setPlayerLevel(20, pid);
    server.sim.equipItem(APEX_NECK, pid);
    expect(serverMeta(server, pid).equipment.neck).toBe(APEX_NECK);
    broadcast(server);

    const { client, sent } = sendingClient(pid);
    client.perfectItem({ slot: 'neck' });
    setHeavyDirty(session, false);
    const draws = withForcedRoll(server.sim, 0, () => {
      server.handleMessage(session, JSON.stringify(sent[0]));
    });
    expect(draws).toBe(1);
    const worn = serverMeta(server, pid).equipmentInstance.neck;
    expect(worn?.perfecting).toBe(1);
    expect(worn?.boundTo).toBe(serverMeta(server, pid).entityId);
    expect(materialCounts(server, pid)).toEqual([MATERIALS - 1, MATERIALS - 1, MATERIALS - 1]);

    expect(heavyDirty(session)).toBe(true);
    holdOtherFreshnessOff(server, session, pid);
    fc.sent.length = 0;
    broadcast(server);
    const self = selfOf(lastSnap(fc.sent));
    // The einst self mirror is WHOLE (never the trimmed eqi peer projection):
    // the owner sees the rank and the bind on their own worn copy.
    expect(self?.einst?.neck).toEqual(worn);
    expect(self?.einst?.neck?.boundTo).toBeDefined();
  });

  it('malformed frames drop before any sim call, drawing nothing and spending nothing', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 903, 'Fuzzer');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const before = materialCounts(server, pid);
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    const malformed: Record<string, unknown>[] = [
      { cmd: 'perfect_item', slot: 'neck', bag: 0, item: APEX_NECK }, // both refs usable
      { cmd: 'perfect_item' }, // neither
      { cmd: 'perfect_item', bag: 1.5, item: APEX_NECK }, // non-integer bag
      { cmd: 'perfect_item', bag: -1, item: APEX_NECK }, // negative bag
      { cmd: 'perfect_item', bag: '0', item: APEX_NECK }, // a numeric STRING is not a cell
      { cmd: 'perfect_item', bag: 0 }, // a cell with no item id is not a bagged ref
      { cmd: 'perfect_item', bag: 0, item: 7 }, // a non-string item id
      { cmd: 'perfect_item', bag: 0, item: '' }, // an empty item id
      { cmd: 'perfect_item', bag: 0, item: 'x'.repeat(65) }, // over the string ceiling
      { cmd: 'perfect_item', slot: 'hat' }, // bogus slot string
      { cmd: 'perfect_item', slot: 3 }, // a number is not a slot
      { cmd: 'perfect_item', slot: 'hat', bag: 'x', item: APEX_NECK }, // both malformed
    ];
    const draws = drawsDuring(server.sim, () => {
      for (const body of malformed) cmd(server, session, body);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(draws).toBe(0);
    expect(materialCounts(server, pid)).toEqual(before);
    // The two tokens are validated independently (the apply_enchant case's
    // documented shape): an unusable slot beside a usable bag dispatches the
    // BAGGED ref (cell plus the named item id), which the sim then
    // re-validates against its own bags.
    cmd(server, session, { cmd: 'perfect_item', slot: 'hat', bag: 0, item: APEX_NECK });
    expect(spy).toHaveBeenCalledTimes(1);
    // perfectItemAs is the server's pid-explicit entry (the interface
    // contract with the sim: pid first, then the ref); the trailing argument
    // is the phase 13 optional legendary name, absent on an unnamed frame.
    expect(spy).toHaveBeenLastCalledWith(pid, { bag: 0, itemId: APEX_NECK }, undefined);
    spy.mockRestore();
  });

  it('the name FIELD drops independently of the ref, and a screened name never reaches the sim', () => {
    // Phase 13, the dispatch halves of the naming arm (the pure core is
    // resolvePerfectItemName in server/perfect_item_ref.ts). A malformed name
    // beside a usable ref degrades to an UNNAMED attempt (field-drop, never a
    // frame drop); a shape-valid but offensive name is refused by the server
    // content screen with its own error event and the sim is never called.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 904, 'Namer');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    // Every NAMED frame rides the name-screen lane (burst 5, two per second),
    // so the clock advances a second per frame here: this test is about the
    // dispatch halves, and the lane's own refusal is pinned separately below.
    const clock = namedFrameClock();
    // Per-dimension non-string or empty names: each still dispatches, nameless.
    for (const name of [7, '', ['a'], null, true]) {
      clock.tick();
      cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name });
      expect(spy).toHaveBeenLastCalledWith(pid, { slot: 'neck' }, undefined);
    }
    // An OVERSIZED string rides RAW and UNCUT (the fresh-reader finding on the
    // first QA fix: a cut could turn a shape-invalid wire spelling into a
    // valid short name online only; now the sim's inscription arm answers the
    // same raw value on both hosts, and the host-parity pin below drives it).
    clock.tick();
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: 'x'.repeat(65) });
    expect(spy).toHaveBeenLastCalledWith(pid, { slot: 'neck' }, 'x'.repeat(65));
    // A well-formed name rides through to the sim, which owns the SHAPE rule.
    clock.tick();
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: 'Dawnbreaker' });
    expect(spy).toHaveBeenLastCalledWith(pid, { slot: 'neck' }, 'Dawnbreaker');
    // The dispatch normalizes FIRST: the sim receives the NORMALIZED value
    // (trimmed, inner whitespace collapsed), never the raw wire spelling.
    clock.tick();
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: '  Dawn   breaker  ' });
    expect(spy).toHaveBeenLastCalledWith(pid, { slot: 'neck' }, 'Dawn breaker');
    // A shape-INVALID name (the digit) skips the content screen entirely and
    // rides through RAW for the sim's own shape arm to refuse: no refusal
    // event even when the raw string would match the profanity screen, so
    // the matcher only ever prices shape-valid names.
    fc.sent.length = 0;
    clock.tick();
    cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: 'fuck123' });
    expect(spy).toHaveBeenLastCalledWith(pid, { slot: 'neck' }, 'fuck123');
    const shapeInvalidErrors = fc.sent
      .filter((m: any) => m.t === 'events')
      .flatMap((m: any) => m.list)
      .filter((e: any) => e.type === 'error')
      .map((e: any) => e.text);
    expect(shapeInvalidErrors).not.toContain('That name is not allowed.');
    // The content screen (offensiveName, the pet_rename split) runs on the
    // NORMALIZED value, and phase 18 narrowed WHEN a match refuses the frame:
    // only a copy the sim would route to the promotion ladder can consume the
    // name, so the refusal needs a PERFECTED copy. Both spellings, including
    // the one only normalization exposes.
    const perfected = bagRefOf(server, pid, APEX_NECK);
    markPerfected(server, pid, perfected.bag);
    for (const name of ['fuck', 'f   u   u   u   ck']) {
      const callsBefore = spy.mock.calls.length;
      fc.sent.length = 0;
      clock.tick();
      cmd(server, session, { cmd: 'perfect_item', ...wireOf(perfected), name });
      expect(spy.mock.calls.length, name).toBe(callsBefore);
      const errors = fc.sent
        .filter((m: any) => m.t === 'events')
        .flatMap((m: any) => m.list)
        .filter((e: any) => e.type === 'error')
        .map((e: any) => e.text);
      expect(errors, name).toContain('That name is not allowed.');
    }
    spy.mockRestore();
    clock.restore();
  });

  it('an offensive name on an UNPERFECTED copy is stripped, and the attempt still runs', () => {
    // The other half of the phase 18 narrowing, over the real dispatch. The
    // ordinary perfecting attempt ignores `name` entirely (Sim.perfectItemAs
    // routes only a `payload.perfected` copy to the promotion ladder), so
    // refusing the whole frame for a name the sim would have dropped cost the
    // player their attempt. Now the name is STRIPPED: the sim is called
    // UNNAMED, and the player reads no refusal line.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 914, 'Stripper');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    const clock = namedFrameClock();
    const bagged = bagRefOf(server, pid, APEX_NECK);
    // The copy is untouched: no `perfected`, so the promotion ladder is not
    // where this frame is going. (The refusal arm above marks the twin.)
    expect(serverMeta(server, pid).inventory[bagged.bag]?.instance?.perfected).toBeUndefined();
    fc.sent.length = 0;
    clock.tick();
    cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged), name: 'fuck' });
    // Reached the sim, and reached it with the name gone rather than passed on:
    // a stripped name that still rode through would stamp it at the next
    // promotion, which is the whole point of stripping instead of forwarding.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(pid, { bag: bagged.bag, itemId: APEX_NECK }, undefined);
    const errors = fc.sent
      .filter((m: any) => m.t === 'events')
      .flatMap((m: any) => m.list)
      .filter((e: any) => e.type === 'error')
      .map((e: any) => e.text);
    expect(errors).not.toContain('That name is not allowed.');
    spy.mockRestore();
    clock.restore();
  });

  it('a shape-invalid raw name never lands on the copy online (the end-to-end pin)', () => {
    // The two halves above (the raw ride-through, and the sim's shape arm in
    // tests/orange_promotion.test.ts) compose into one claim worth one
    // assertion of its own: after a shape-invalid name rides RAW to the
    // online sim on a Perfected copy, that copy carries no name and no
    // legendary quality, and the player read the inscription line.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 904, 'RawRide');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const bagged = bagRefOf(server, pid, APEX_NECK);
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < 4; i++) cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged) });
    });
    const copy = () => serverMeta(server, pid).inventory[bagged.bag].instance;
    expect(copy()?.perfected).toBe(true);
    server.sim.addItem('deed_of_making', 1, pid);
    server.sim.drainEvents();
    fc.sent.length = 0;
    cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged), name: 'fuck123' });
    routePending(server);
    expect(textEvents(fc.sent)).toEqual(['That name cannot be inscribed on the work.']);
    expect(copy()?.name).toBeUndefined();
    expect(copy()?.rolled?.quality).toBeUndefined();
    expect(server.sim.countItem('deed_of_making', pid)).toBe(1);
  });

  it('an oversized name answers the SAME line on both hosts (the parity pin)', () => {
    // Both hosts hand the sim the RAW string (the online dispatch neither
    // drops nor cuts it), so the sim's shape arm answers with one line on
    // both and the player cannot tell the hosts apart.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 904, 'LongName');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const bagged = bagRefOf(server, pid, APEX_NECK);
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < 4; i++) cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged) });
    });
    server.sim.addItem('deed_of_making', 1, pid);
    const tooLong = 'A'.repeat(100);
    // The offline host's shape: the RAW string straight into the sim, exactly
    // as Sim.perfectItem hands it (no dispatch cut in between).
    server.sim.drainEvents();
    server.sim.perfectItemAs(pid, bagged, tooLong);
    const offline = server.sim
      .drainEvents()
      .filter((ev) => ev.type === 'error')
      .map((ev) => (ev as { text: string }).text);
    // Online host: the dispatch path over the same sim.
    fc.sent.length = 0;
    cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged), name: tooLong });
    routePending(server);
    const online = textEvents(fc.sent);
    expect(offline).toEqual(['That name cannot be inscribed on the work.']);
    expect(online).toEqual(offline);
    expect(server.sim.countItem('deed_of_making', pid)).toBe(1);
    // Neither host let the oversized raw name LAND: no name, no promotion.
    // Positive control first: the copy exists and IS Perfected (the four
    // forced-success attempts above), so the two negatives cannot pass by a
    // missing slot or a vanished instance.
    const copy = serverMeta(server, pid).inventory.find((s) => s.itemId === APEX_NECK)?.instance;
    expect(copy?.perfected).toBe(true);
    expect(copy?.name).toBeUndefined();
    expect(copy?.rolled?.quality).toBeUndefined();
  });

  it('the name-screen lane refuses the sixth named frame at one instant and never calls the sim', () => {
    // The phase 13 QA hot-path review: the obscenity matcher costs about 25
    // microseconds and used to ride the 30/s command lane ahead of every sim
    // gate. Named frames now take the name-screen lane (burst 5, refill two
    // per second), so a flood of hand-crafted named frames is shed before the
    // screen runs; an unnamed attempt stays on the command lane.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 904, 'Flooder');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    const spy = vi.spyOn(server.sim, 'perfectItemAs');
    for (let i = 0; i < 6; i++) {
      cmd(server, session, { cmd: 'perfect_item', slot: 'neck', name: `Oath ${'a'.repeat(i)}` });
    }
    expect(spy).toHaveBeenCalledTimes(5);
    // Unnamed attempts are untouched by the name lane.
    for (let i = 0; i < 3; i++) cmd(server, session, { cmd: 'perfect_item', slot: 'neck' });
    expect(spy).toHaveBeenCalledTimes(8);
    spy.mockRestore();
  });

  it("the sim's own denial reaches the client as its error line, drawing nothing", () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 904, 'Denied');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    server.sim.addItem(NON_APEX, 1, pid);
    const before = materialCounts(server, pid);
    server.sim.drainEvents();
    fc.sent.length = 0; // drop the join notice
    const draws = drawsDuring(server.sim, () => {
      cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagRefOf(server, pid, NON_APEX)) });
    });
    expect(draws).toBe(0);
    expect(materialCounts(server, pid)).toEqual(before);
    routePending(server);
    expect(textEvents(fc.sent)).toEqual(['Only Masterwrought items can be perfected.']);
  });

  it('ClientWorld.perfectingInfo over the mirrored state equals the server sim, worn and bagged', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 905, 'Mirror');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    server.sim.setPlayerLevel(20, pid);
    // A SECOND apex piece worn, so both arms carry a real view at once; a
    // locked material stack so the lock-aware `have` count is exercised.
    server.sim.addItem('warhewn_signet', 1, pid);
    server.sim.equipItem('warhewn_signet', pid);
    expect(serverMeta(server, pid).equipment.ring1).toBe('warhewn_signet');
    const bagged = bagRefOf(server, pid, APEX_NECK);
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < 2; i++) cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged) });
    });
    // Then the whole ember stack locks: the third attempt is refused on the
    // ladder's dedicated line (nothing spent), so the mirrored `have` really
    // is the lock-aware count and not the raw one.
    const ember = serverMeta(server, pid).inventory.find((s) => s.itemId === 'makers_ember');
    expect(ember).toBeTruthy();
    if (ember) ember.instance = { locked: true };
    server.sim.drainEvents();
    fc.sent.length = 0;
    cmd(server, session, { cmd: 'perfect_item', ...wireOf(bagged) });
    routePending(server);
    expect(textEvents(fc.sent)).toContain('A material needed for perfecting is locked.');

    // One WORN attempt too, forced to succeed, so the einst mirror carries a
    // real bound payload at rank 1 and the worn arm of the equality loop below
    // is not two default views agreeing.
    const ringBefore = materialCounts(server, pid);
    if (ember) delete ember.instance;
    withForcedRoll(server.sim, 0, () => {
      cmd(server, session, { cmd: 'perfect_item', slot: 'ring1' });
    });
    expect(materialCounts(server, pid)).toEqual(ringBefore.map((n) => n - 1));
    expect(serverMeta(server, pid).equipmentInstance.ring1?.boundTo).toBe(pid);
    // Re-lock the ember stack so the bagged view below still reads have 0.
    if (ember) ember.instance = { locked: true };

    // Every snapshot frame, in order, onto a bare ClientWorld: the mirrors
    // converge the way a live client's do.
    fc.sent.length = 0;
    broadcast(server);
    const client = bareClient(pid);
    for (const frame of fc.sent) {
      if (frame.t === 'snap')
        (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(frame);
    }
    for (const ref of [bagged, { slot: 'ring1' }] as PerfectItemRef[]) {
      const online = client.perfectingInfo(ref);
      const offline = server.sim.perfectingInfo(ref, pid);
      expect(online, JSON.stringify(ref)).toEqual(offline);
      expect(offline, 'the fixture really resolved a view').not.toBeNull();
    }
    // The bagged view is the walked one, so the parity above is not two nulls
    // or two untouched pieces agreeing by default.
    const walked = client.perfectingInfo(bagged);
    expect(walked).toMatchObject({
      itemId: APEX_NECK,
      rank: 2,
      ranks: PERFECTING_RANKS,
      perfected: false,
      craftId: 'jewelcrafting',
      skillMet: true,
      bound: true,
    });
    expect(walked?.materials.find((m) => m.itemId === 'makers_ember')?.have).toBe(0);
    // The worn view is the attempted one: bound through the einst mirror, at
    // exactly rank 1 (the forced success), never Perfected after one attempt.
    const wornView = client.perfectingInfo({ slot: 'ring1' });
    expect(wornView).toMatchObject({
      itemId: 'warhewn_signet',
      bound: true,
      perfected: false,
      rank: 1,
    });
  });

  it('the phase 13 view fields cross the wire: perfected, promoted, equipBlocked, the emptied bill', () => {
    // The phase 13 QA architecture review: the equality case above never
    // reaches a Perfected copy, so `promoted`, `equipBlocked`, and the bill
    // switching to the deed were only ever compared at their defaults. This
    // case walks three copies to the states those fields exist for and pins
    // both hosts on each, over a real snapshot.
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 906, 'MirrorLegend');
    const pid = session.pid as number;
    seedPerfecter(server, pid);
    server.sim.setPlayerLevel(20, pid);
    // Twelve attempts across three copies: top the seeded eight of each material up.
    for (const c of PERFECTING_ATTEMPT_COST) server.sim.addItem(c.itemId, MATERIALS, pid);
    server.sim.addItem('deed_of_making', 2, pid);
    // (1) A WORN signet walked to Perfected and PROMOTED: the legendary sub-cap
    // slot, promoted true, equipBlocked false (nothing is pending), no bill.
    server.sim.addItem('warhewn_signet', 1, pid);
    server.sim.equipItem('warhewn_signet', pid);
    expect(serverMeta(server, pid).equipment.ring1).toBe('warhewn_signet');
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < PERFECTING_RANKS; i++) {
        cmd(server, session, { cmd: 'perfect_item', slot: 'ring1' });
      }
    });
    cmd(server, session, { cmd: 'perfect_item', slot: 'ring1', name: 'Mirror Oath' });
    expect(serverMeta(server, pid).equipmentInstance.ring1?.name).toBe('Mirror Oath');
    // (2) A BAGGED signet twin walked to Perfected but NOT promoted: its
    // promotion would mint a unique-equip conflict with the worn twin, so
    // equipBlocked reads true, with the deed bill still listed.
    server.sim.addItem('warhewn_signet', 1, pid);
    const twin = bagRefOf(server, pid, 'warhewn_signet');
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < PERFECTING_RANKS; i++) {
        cmd(server, session, { cmd: 'perfect_item', ...wireOf(twin) });
      }
    });
    // (3) The BAGGED neck walked to Perfected and promoted: promoted true, no bill.
    const neck = bagRefOf(server, pid, APEX_NECK);
    withForcedRoll(server.sim, 0, () => {
      for (let i = 0; i < PERFECTING_RANKS; i++) {
        cmd(server, session, { cmd: 'perfect_item', ...wireOf(neck) });
      }
    });
    cmd(server, session, { cmd: 'perfect_item', ...wireOf(neck), name: 'Second Oath' });
    expect(serverMeta(server, pid).inventory[neck.bag].instance?.name).toBe('Second Oath');
    expect(server.sim.countItem('deed_of_making', pid)).toBe(0);

    // The last deed cell emptied above, so the bagged refs are re-resolved
    // (the index-plus-id pin means a stale index answers null, never a
    // neighbour): the neck sits below the deed cell, the twin above it.
    const neckNow = bagRefOf(server, pid, APEX_NECK);
    const twinNow = bagRefOf(server, pid, 'warhewn_signet');
    fc.sent.length = 0;
    broadcast(server);
    const client = bareClient(pid);
    for (const frame of fc.sent) {
      if (frame.t === 'snap')
        (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(frame);
    }
    for (const ref of [neckNow, twinNow, { slot: 'ring1' }] as PerfectItemRef[]) {
      const online = client.perfectingInfo(ref);
      const offline = server.sim.perfectingInfo(ref, pid);
      expect(online, JSON.stringify(ref)).toEqual(offline);
      expect(offline, 'the fixture really resolved a view').not.toBeNull();
    }
    // The values themselves, so the equality above is not two defaults agreeing.
    expect(client.perfectingInfo({ slot: 'ring1' })).toMatchObject({
      perfected: true,
      promoted: true,
      equipBlocked: false,
      materials: [],
    });
    expect(client.perfectingInfo(twinNow)).toMatchObject({
      perfected: true,
      promoted: false,
      equipBlocked: true,
      materials: [{ itemId: 'deed_of_making', required: 1, have: 0 }],
    });
    expect(client.perfectingInfo(neckNow)).toMatchObject({
      perfected: true,
      promoted: true,
      equipBlocked: false,
      materials: [],
    });
  });
});
