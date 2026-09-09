// Intentional Gathering PR3: the harvest preference over the ONLINE wire.
// Three surfaces, each pinned separately:
//   1. The pure decode leaf `src/net/harvest_preference_wire.ts`
//      (`decodeHarvestPreferenceWire`), proposed to sit beside the other
//      wire-decode siblings (snapshot_timer_wire.ts, account_cosmetics_wire.ts):
//      DOM-free, ClientWorld-free, never widens a decode-input `undefined`
//      into the legacy All default (that collapse is loadHarvestPreference's
//      job for a REAL absent save key, never for a wire value the host is
//      choosing not to touch).
//   2. The real Sim -> GameServer.selfWireJson -> ClientWorld.applySnapshot
//      round trip for the new `hpref` self-delta: All encodes as the explicit
//      'all' token (never omitted, unlike the sparse SAVE encoding), a
//      malformed live preference encodes as explicit JSON null (never
//      omitted), a retired bounded id rides verbatim, and an UNCHANGED value
//      omits the key entirely (the atitle/aborder maybe() precedent), with
//      the client retaining its prior mirror on omission.
//   3. The new `set_harvest_preference` command: the server derives pid from
//      the authenticated session (never a client-supplied field), and
//      ClientWorld.setHarvestPreference sends the raw command only, with NO
//      optimistic local mirror write (the setActiveTitle/setActiveBorder
//      precedent in src/net/online.ts).

// Mock the db layer so no Postgres is needed (the afk_wire.test.ts minimal set:
// join + handleMessage + broadcastSnapshots need nothing heavier).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import type { ClientSession } from '../server/game';
import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import {
  HARVEST_PREFERENCE_ALL,
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

function material(itemId: string): HarvestPreference {
  return { kind: 'material', itemId };
}

// --- 1. the pure decode leaf ---------------------------------------------

describe('decodeHarvestPreferenceWire (src/net/harvest_preference_wire.ts)', () => {
  it('decodes the explicit all token and a supported material id', async () => {
    const { decodeHarvestPreferenceWire } = await import('../src/net/harvest_preference_wire');
    expect(decodeHarvestPreferenceWire(HARVEST_PREFERENCE_ALL_TOKEN)).toEqual(
      HARVEST_PREFERENCE_ALL,
    );
    expect(decodeHarvestPreferenceWire('rough_hide')).toEqual(material('rough_hide'));
  });

  it('keeps a retired bounded material id verbatim (never rejected for being unsupported)', async () => {
    const { decodeHarvestPreferenceWire } = await import('../src/net/harvest_preference_wire');
    expect(decodeHarvestPreferenceWire('retired_material')).toEqual(material('retired_material'));
    const atBound = 'm'.repeat(64);
    expect(decodeHarvestPreferenceWire(atBound)).toEqual(material(atBound));
  });

  it('decodes an explicit malformed live value to null, never to All', async () => {
    const { decodeHarvestPreferenceWire } = await import('../src/net/harvest_preference_wire');
    for (const raw of [null, 42, {}, [], true, '', 'a'.repeat(65), 'two words', 'line\nbreak']) {
      expect(decodeHarvestPreferenceWire(raw), String(raw)).toBeNull();
    }
  });

  it('rejects wire-input undefined to null rather than widening it into legacy All', async () => {
    // The absent-key-means-All collapse belongs to loadHarvestPreference for a
    // real save row with no key at all; a wire decode is only ever called on a
    // key the host already confirmed is PRESENT in the delta, so a decode-input
    // undefined is misuse, and must not silently resolve to an active choice.
    const { decodeHarvestPreferenceWire } = await import('../src/net/harvest_preference_wire');
    expect(decodeHarvestPreferenceWire(undefined)).toBeNull();
  });
});

// --- 2. the real Sim -> GameServer.selfWireJson -> ClientWorld.applySnapshot round trip ---

describe('the hpref self-delta: real server encode, real client decode', () => {
  it('encodes the default All as the explicit token on the very first snapshot (never omitted)', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Fresh');
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.hpref).toBe(HARVEST_PREFERENCE_ALL_TOKEN);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect((client as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('encodes and decodes a chosen material after setHarvestPreference', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Chooser');
    broadcast(server);
    // Prime a REAL connected client with the first (dense) snapshot before
    // the change, exactly as a live session would have already synced by the
    // time it observes a later delta.
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect((client as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    server.sim.setHarvestPreference('rough_hide', session.pid);
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.hpref).toBe('rough_hide');

    (client as any).applySnapshot(snap);
    expect((client as any).harvestPreference).toEqual(material('rough_hide'));
  });

  it('keeps a retired bounded material id verbatim across the wire', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Retired');
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    // A save older than the current catalog: poke the live meta directly the
    // way the sim's own load path would leave it (loadHarvestPreference keeps
    // a bounded-but-retired id verbatim; see tests/harvest_preference.test.ts).
    const meta = server.sim.players.get(session.pid)!;
    meta.harvestPreference = material('retired_material');
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.hpref).toBe('retired_material');

    (client as any).applySnapshot(snap);
    expect((client as any).harvestPreference).toEqual(material('retired_material'));
  });

  it('encodes a malformed live preference as explicit JSON null, never omitted', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Malformed');
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect((client as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    // Models the load-refused state (Sim.addPlayer's own malformed-rawstate
    // arm sets exactly this): a live null the player must explicitly replace.
    const meta = server.sim.players.get(session.pid)!;
    meta.harvestPreference = null;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(Object.hasOwn(snap.self, 'hpref')).toBe(true);
    expect(snap.self.hpref).toBeNull();

    (client as any).applySnapshot(snap);
    expect((client as any).harvestPreference).toBeNull();
  });

  it('omits hpref on an unchanged snapshot, and the client retains its prior mirror', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Quiet');
    broadcast(server);
    const first = lastSnap(fc.sent);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(first);

    server.sim.setHarvestPreference('wolf_fang', session.pid);
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    const changed = lastSnap(fc.sent);
    expect(changed.self.hpref).toBe('wolf_fang');
    (client as any).applySnapshot(changed);
    expect((client as any).harvestPreference).toEqual(material('wolf_fang'));

    server.sim.tick(); // a quiet tick: nothing harvest-preference related changed
    fc.sent.length = 0;
    broadcast(server);
    const quiet = lastSnap(fc.sent);
    expect(quiet.self).not.toHaveProperty('hpref');

    (client as any).applySnapshot(quiet);
    expect((client as any).harvestPreference).toEqual(material('wolf_fang'));
  });

  it('a second, uninvolved session never sees its own hpref move', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 1, 'Alpha');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Beta');
    broadcast(server);
    const clientB = bareClient(b.pid);
    (clientB as any).applySnapshot(lastSnap(fcB.sent));
    expect((clientB as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    server.sim.setHarvestPreference('rough_hide', a.pid);
    broadcast(server);

    expect(server.sim.harvestPreferenceFor(a.pid)).toEqual(material('rough_hide'));
    expect(server.sim.harvestPreferenceFor(b.pid)).toEqual(HARVEST_PREFERENCE_ALL);
    const snapB = lastSnap(fcB.sent);
    expect(snapB.self.hpref).not.toBe('rough_hide');
    (clientB as any).applySnapshot(snapB);
    expect((clientB as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);
  });
});

// --- 3. the set_harvest_preference command ---------------------------------

describe('the set_harvest_preference command', () => {
  function joinedServer(
    characterId: number,
    name: string,
  ): { server: GameServer; session: ClientSession } {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, characterId, name);
    return { server, session };
  }

  function sendRaw(server: GameServer, session: ClientSession, msg: Record<string, unknown>) {
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'set_harvest_preference', ...msg }),
    );
  }

  it('derives pid from the authenticated session, never a client-supplied field', () => {
    const { server, session } = joinedServer(1, 'Real');
    const spy = vi.spyOn(server.sim, 'setHarvestPreference');

    // A forged pid/characterId field on the frame must never reach the sim
    // call in place of the session's own pid.
    sendRaw(server, session, { raw: 'rough_hide', pid: 999999, characterId: 999999 });

    expect(spy).toHaveBeenCalledWith('rough_hide', session.pid);
    expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(material('rough_hide'));
  });

  it('changes only the sending session, even when a forged pid names a real second player', () => {
    const { server, session: a } = joinedServer(1, 'Alpha');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Beta');

    sendRaw(server, a, { raw: 'rough_hide', pid: b.pid });

    expect(server.sim.harvestPreferenceFor(a.pid)).toEqual(material('rough_hide'));
    expect(server.sim.harvestPreferenceFor(b.pid)).toEqual(HARVEST_PREFERENCE_ALL);
  });

  it('a valid command round trips to the exact chosen material', () => {
    const { server, session } = joinedServer(1, 'Valid');
    sendRaw(server, session, { raw: 'wolf_fang' });
    expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(material('wolf_fang'));

    sendRaw(server, session, { raw: HARVEST_PREFERENCE_ALL_TOKEN });
    expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(HARVEST_PREFERENCE_ALL);
  });

  // Each case joins its OWN fresh session (rather than sharing one session
  // across the whole table) so a red here can only mean the command was
  // validated and refused, never that the shared session's command-lane
  // burst (MSG_LANE_COMMAND_BURST, server/msg_lanes.ts) silently dropped a
  // later frame in the table and left the prior value untouched for the
  // wrong reason.
  const badRaws: unknown[] = [
    42,
    null,
    {},
    [],
    true,
    undefined,
    '', // empty
    'hide', // a tag, not a material item id
    'tusk', // a tag
    'prime_cut', // a specimen id
    'a'.repeat(65), // overlong
  ];
  for (const raw of badRaws) {
    it(`leaves the current choice untouched on a bad raw: ${String(raw)}`, () => {
      const { server, session } = joinedServer(1, 'Guarded');
      sendRaw(server, session, { raw: 'wolf_fang' });
      const before = server.sim.harvestPreferenceFor(session.pid);
      expect(before).toEqual(material('wolf_fang'));

      sendRaw(server, session, raw === undefined ? {} : { raw });
      expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(before);

      // Proves validation was genuinely reached rather than the frame being
      // silently rate-limited: this SAME session still accepts a follow-up
      // valid command, so its command lane was never exhausted.
      sendRaw(server, session, { raw: 'rough_hide' });
      expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(material('rough_hide'));
    });
  }

  it('never throws and never changes state when the raw field is entirely absent', () => {
    const { server, session } = joinedServer(1, 'NoField');
    expect(() => {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'set_harvest_preference' }));
    }).not.toThrow();
    expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(HARVEST_PREFERENCE_ALL);
  });
});

// --- ClientWorld.setHarvestPreference: command-only, no optimistic mirror ---

describe('ClientWorld.setHarvestPreference sends the command only', () => {
  it('sends set_harvest_preference and writes NO local mirror (the setActiveTitle precedent)', () => {
    const outbox: string[] = [];
    const client = bareClient(1, { harvestPreference: HARVEST_PREFERENCE_ALL });
    (client as any).connected = true;
    (client as any).ws = { readyState: 1, send: (p: string) => outbox.push(p) };

    (client as any).setHarvestPreference('rough_hide');
    // Asserted BEFORE any snapshot echo: the send writes no optimistic local
    // copy, so a refused pick can never leave a phantom preference selected.
    expect((client as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    (client as any).setHarvestPreference(HARVEST_PREFERENCE_ALL_TOKEN);
    expect((client as any).harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    expect(outbox.map((p) => JSON.parse(p))).toEqual([
      { t: 'cmd', cmd: 'set_harvest_preference', raw: 'rough_hide' },
      { t: 'cmd', cmd: 'set_harvest_preference', raw: HARVEST_PREFERENCE_ALL_TOKEN },
    ]);
  });

  it('the client-built send frame round-trips through the real server dispatch', () => {
    const outbox: string[] = [];
    const client = bareClient(1, { harvestPreference: HARVEST_PREFERENCE_ALL });
    (client as any).connected = true;
    (client as any).ws = { readyState: 1, send: (p: string) => outbox.push(p) };
    (client as any).setHarvestPreference('wolf_fang');

    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Lockstep');
    server.handleMessage(session, outbox[0]);
    expect(server.sim.harvestPreferenceFor(session.pid)).toEqual(material('wolf_fang'));
  });
});

// --- initial unsynced mirror + reconnect must never leak a prior choice ---

describe('the harvest preference mirror before sync and across a reconnect hello', () => {
  class StubWebSocket {
    static readonly OPEN = 1;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    readyState = StubWebSocket.OPEN;
    constructor(public readonly url: string) {}
    send(): void {
      /* no-op: these tests never assert on sends */
    }
    close(): void {
      /* no-op: there is no real socket */
    }
  }

  function withDomStubs<T>(fn: () => T): T {
    const g = globalThis as Record<string, unknown>;
    const prevWebSocket = g.WebSocket;
    const prevWindow = g.window;
    g.WebSocket = StubWebSocket as unknown;
    g.window = { setInterval: () => 0, clearInterval: () => undefined };
    try {
      return fn();
    } finally {
      g.WebSocket = prevWebSocket;
      g.window = prevWindow;
    }
  }

  interface ClientInternals {
    applySnapshot(snap: unknown): void;
    onMessage(raw: string): void;
    reconnectAttempts: number;
    harvestPreference: HarvestPreference | null;
  }

  function makeWorld(): ClientInternals {
    const world = withDomStubs(() => {
      const w = new ClientWorld('harvest-pref-probe-token', 1, 'warrior', 'http://localhost');
      w.close();
      return w;
    });
    return world as unknown as ClientInternals;
  }

  // A full (identity-bearing) self record, the shape server/game.ts wireEntity
  // emits (mirrors target_echo_client.test.ts's playerWire): applySnapshot's
  // self-record decode needs the identity/position fields to resolve the
  // local entity at all, so a bare `{ hpref }` object is not a real frame.
  function selfSnap(hpref: string | null): unknown {
    return {
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Me',
        lv: 1,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        hpref,
      },
    };
  }

  it('reads null before any snapshot has ever synced the mirror', () => {
    const wire = makeWorld();
    expect(wire.harvestPreference).toBeNull();
  });

  it('resets to null on the post-reconnect hello, before the resent world lands', () => {
    const wire = makeWorld();
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    wire.applySnapshot(selfSnap('rough_hide'));
    expect(wire.harvestPreference).toEqual(material('rough_hide'));

    // Simulate the auto-reconnect arm: a fresh hello with reconnectAttempts > 0
    // runs the per-session transient reset (the marketInfo precedent) and must
    // drop the prior character's mirrored choice rather than let it linger
    // until the resent world's first snapshot happens to repeat it.
    wire.reconnectAttempts = 1;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    expect(wire.harvestPreference).toBeNull();

    // The server resends the world from scratch; its value applies immediately.
    wire.applySnapshot(selfSnap(HARVEST_PREFERENCE_ALL_TOKEN));
    expect(wire.harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);
  });
});
