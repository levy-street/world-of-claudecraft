// The farming command chain end to end over the live wire: the frames
// ClientWorld actually emits, fed verbatim into the real GameServer dispatch.
//
// WHY THIS FILE EXISTS. Every other pin on this chain checks one half in
// isolation. tests/command_schema.test.ts proves the TOKENS match by scanning
// both sources; tests/command_facets.test.ts tags them; the parity suite proves
// both worlds expose the members. None of them can see a PAYLOAD FIELD skew: if
// ClientWorld sent `{ bedId, cropId }` while the dispatch read `msg.bed` /
// `msg.crop`, all of those stay green, the type guard silently refuses every
// real frame, and farming is inert online while every offline test passes.
//
// So nothing here hand-writes a frame. The client's own send is captured off the
// socket as a raw string and handed to server.handleMessage unchanged, which is
// the one thing that can only pass when both halves agree on the field names.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the
// vi.mock hoisting caveat applies: this block cannot reference imports).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
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
import { ClientWorld } from '../src/net/online';
import { farmBedById } from '../src/sim/content/farm_patches';
import type { PlayerClass, SimEvent } from '../src/sim/types';
import { broadcast, lastSnap } from './helpers/bare_client';

const PROBE_CLASS: PlayerClass = 'warrior';
const BED = 'bed_eastbrook_1';
const CROP = 'vale_wheat';

// --- the client half: a real ClientWorld whose socket keeps every send ---

class StubWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  sent: string[] = [];
  static last: StubWebSocket | null = null;
  constructor(public readonly url: string) {
    StubWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = StubWebSocket.CLOSED;
  }
}

function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = {
    setInterval: () => 0,
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

// Run a body against a world that can actually SEND. Two things gate that and
// both are easy to get silently wrong, which would make every assertion below
// vacuous: canSendCommand() needs `connected`, which the server's `hello` sets
// (not the socket open), and it reads WebSocket.OPEN off the global, so the stub
// must stay installed for the whole body rather than just the constructor. The
// guard at the end of this helper fails loudly if no frame was produced.
function withClient(fn: (world: ClientWorld, sock: StubWebSocket) => void): void {
  withDomStubs(() => {
    const world = new ClientWorld('farm-chain-token', 1, PROBE_CLASS, 'http://x');
    const sock = StubWebSocket.last;
    if (!sock) throw new Error('ClientWorld opened no socket');
    (world as unknown as { onMessage(raw: string): void }).onMessage(
      JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }),
    );
    sock.sent.length = 0; // drop whatever the join flush queued
    try {
      fn(world, sock);
    } finally {
      world.close();
    }
  });
}

function commandFrames(sock: StubWebSocket, token: string): Record<string, unknown>[] {
  return sock.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((msg) => msg.t === 'cmd' && msg.cmd === token);
}

// --- the server half ---

function fakeWs(): { sent: unknown[]; ws: unknown } {
  const sent: unknown[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(server: GameServer, id: number, name: string): ClientSession {
  const session = server.join(fakeWs().ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

// Production shape for every arm here: farming is a normal player command, not a
// dev cheat, so the claim "the server dispatches this" must hold with the dev
// gate provably unset.
beforeEach(() => {
  expect(process.env.ALLOW_DEV_COMMANDS).toBeUndefined();
});

describe('ClientWorld emits the farming frames the protocol declares', () => {
  it('plantCrop sends plant_crop carrying exactly the bed and crop ids', () => {
    withClient((world, sock) => {
      world.plantCrop(BED, CROP);

      const frames = commandFrames(sock, 'plant_crop');
      expect(frames).toHaveLength(1);
      // The exhaustive key set, not a containment check: an EXTRA field is as
      // much a protocol change as a missing one, and a client-supplied item or
      // yield payload riding along here is the exact thing server authority
      // forbids. A KNOBLESS plant stays byte-identical to the pre-knob
      // protocol: unset knobs are omitted, never sent as false.
      expect(Object.keys(frames[0]).sort()).toEqual(['bed', 'cmd', 'crop', 't']);
      expect(frames[0]).toEqual({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP });
    });
  });

  it('plantCrop rides knob fields ONLY when literally true, one per requested knob', () => {
    withClient((world, sock) => {
      // All three requested: the frame carries all three literal-true fields
      // and nothing else (still an exhaustive key set, the arm above's rule).
      world.plantCrop(BED, CROP, { compost: true, watch: true, tonic: true });
      // One requested: only that field rides.
      world.plantCrop(BED, CROP, { watch: true });
      // Explicit false is the SAME statement as absent (knob not requested),
      // so it must not widen the frame either.
      world.plantCrop(BED, CROP, { compost: false, watch: false, tonic: false });

      const frames = commandFrames(sock, 'plant_crop');
      expect(frames).toHaveLength(3);
      expect(Object.keys(frames[0]).sort()).toEqual([
        'bed',
        'cmd',
        'compost',
        'crop',
        't',
        'tonic',
        'watch',
      ]);
      expect(frames[0]).toEqual({
        t: 'cmd',
        cmd: 'plant_crop',
        bed: BED,
        crop: CROP,
        compost: true,
        watch: true,
        tonic: true,
      });
      expect(Object.keys(frames[1]).sort()).toEqual(['bed', 'cmd', 'crop', 't', 'watch']);
      expect(frames[1].watch).toBe(true);
      expect(Object.keys(frames[2]).sort()).toEqual(['bed', 'cmd', 'crop', 't']);
    });
  });

  it('harvestCrop sends harvest_crop carrying exactly the bed id', () => {
    withClient((world, sock) => {
      world.harvestCrop(BED);

      const frames = commandFrames(sock, 'harvest_crop');
      expect(frames).toHaveLength(1);
      expect(Object.keys(frames[0]).sort()).toEqual(['bed', 'cmd', 't']);
      expect(frames[0]).toEqual({ t: 'cmd', cmd: 'harvest_crop', bed: BED });
    });
  });

  it('convertHusks sends convert_husks with NO payload beyond the frame chrome', () => {
    withClient((world, sock) => {
      world.convertHusks();

      const frames = commandFrames(sock, 'convert_husks');
      expect(frames).toHaveLength(1);
      // Exhaustive: the ratio, the batch count and both item ids resolve
      // sim-side from the sender's own bags, so an EXTRA field here would be
      // a client trying to choose its own trade.
      expect(Object.keys(frames[0]).sort()).toEqual(['cmd', 't']);
      expect(frames[0]).toEqual({ t: 'cmd', cmd: 'convert_husks' });
    });
  });

  it('predicts nothing locally: the plot mirror is untouched until the server answers', () => {
    withClient((world, sock) => {
      world.plantCrop(BED, CROP);
      world.harvestCrop(BED);

      // Both commands sent, and myFarmPlots is still exactly what the last
      // (here, absent) `fplot` delta said. The hidden pre-roll lives
      // server-side, so there is nothing this client could legitimately
      // predict.
      expect(sock.sent).toHaveLength(2);
      expect(world.myFarmPlots).toEqual([]);
    });
  });
});

describe('the captured client frames reach the sim through the real dispatch', () => {
  it('routes plant_crop, harvest_crop and convert_husks to the Sim with what the client sent', () => {
    const rawFrames: string[] = [];
    withClient((world, sock) => {
      world.plantCrop(BED, CROP);
      world.plantCrop(BED, CROP, { compost: true, tonic: true });
      world.harvestCrop(BED);
      world.convertHusks();
      rawFrames.push(...sock.sent);
    });
    expect(rawFrames).toHaveLength(4);

    const server = new GameServer();
    const session = joinServer(server, 1, 'Rowan');
    const plantSpy = vi.spyOn(server.sim, 'plantCrop').mockImplementation(() => {});
    const harvestSpy = vi.spyOn(server.sim, 'harvestCrop').mockImplementation(() => {});
    const convertSpy = vi.spyOn(server.sim, 'convertHusks').mockImplementation(() => {});

    // Verbatim: the client's own bytes, never a frame written by this test.
    for (const raw of rawFrames) server.handleMessage(session, raw);

    // The dispatch hands the sim a COMPLETE knob record either way: an
    // omitted wire field arrives as false (absent and false are the same
    // protocol statement), a literal-true field as true. This is the one
    // place the whole field-name agreement between the client's send and the
    // server's read is proven end to end.
    expect(plantSpy).toHaveBeenCalledTimes(2);
    expect(plantSpy).toHaveBeenNthCalledWith(
      1,
      BED,
      CROP,
      { compost: false, watch: false, tonic: false },
      session.pid,
    );
    expect(plantSpy).toHaveBeenNthCalledWith(
      2,
      BED,
      CROP,
      { compost: true, watch: false, tonic: true },
      session.pid,
    );
    expect(harvestSpy).toHaveBeenCalledTimes(1);
    expect(harvestSpy).toHaveBeenCalledWith(BED, session.pid);
    expect(convertSpy).toHaveBeenCalledTimes(1);
    expect(convertSpy).toHaveBeenCalledWith(session.pid);
    vi.restoreAllMocks();
  });

  it('refuses a non-string id at the type boundary, per field, without reaching the sim', () => {
    const server = new GameServer();
    const session = joinServer(server, 2, 'Wren');
    const plantSpy = vi.spyOn(server.sim, 'plantCrop').mockImplementation(() => {});
    const harvestSpy = vi.spyOn(server.sim, 'harvestCrop').mockImplementation(() => {});

    // One case per FIELD, not one joint case: a guard that checked only `bed`
    // would still pass a test that malformed both at once. The knob fields
    // are guarded per field too: present-but-not-boolean refuses the whole
    // frame (coercing junk into a knob choice would be the laundering the id
    // rule forbids), covered one junk type per field.
    const refused: Record<string, unknown>[] = [
      { cmd: 'plant_crop', bed: 42, crop: CROP },
      { cmd: 'plant_crop', bed: BED, crop: 42 },
      { cmd: 'plant_crop', crop: CROP },
      { cmd: 'plant_crop', bed: BED },
      { cmd: 'plant_crop', bed: BED, crop: CROP, compost: 'yes' },
      { cmd: 'plant_crop', bed: BED, crop: CROP, watch: 1 },
      { cmd: 'plant_crop', bed: BED, crop: CROP, tonic: null },
      { cmd: 'harvest_crop', bed: 42 },
      { cmd: 'harvest_crop' },
    ];
    for (const body of refused) {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
    }

    expect(plantSpy).not.toHaveBeenCalled();
    expect(harvestSpy).not.toHaveBeenCalled();

    // The same session still works with well-formed frames (knobbed
    // included), so the refusals above are the guard doing its job and not a
    // dead dispatch arm.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP, compost: true }),
    );
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvest_crop', bed: BED }));
    expect(plantSpy).toHaveBeenCalledTimes(2);
    expect(plantSpy).toHaveBeenLastCalledWith(
      BED,
      CROP,
      { compost: true, watch: false, tonic: false },
      session.pid,
    );
    expect(harvestSpy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('passes an UNKNOWN bed or crop id straight through: legality is the sim call', () => {
    // The dispatch validates TYPES only. Laundering an unknown id here (to
    // undefined, or to a default) would hand the sim a value the client never
    // sent and make the two hosts disagree about the same message, so a bogus
    // id must arrive intact and be refused by the sim's own allowlists.
    const server = new GameServer();
    const session = joinServer(server, 3, 'Ash');
    const plantSpy = vi.spyOn(server.sim, 'plantCrop').mockImplementation(() => {});

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: 'bed_nowhere_99', crop: 'not_a_crop' }),
    );

    expect(plantSpy).toHaveBeenCalledWith(
      'bed_nowhere_99',
      'not_a_crop',
      { compost: false, watch: false, tonic: false },
      session.pid,
    );
    vi.restoreAllMocks();
  });
});

// The self-mirror convergence contract for the plant command.
//
// A successful plant SPENDS the seed through ctx.removeItem, which emits no
// loot event. 'plant_crop' IS a HEAVY_SELF_CMDS member (belt and braces; see
// the WHAT THEY DO NOT PIN block below), so these arms isolate the EVENT
// membership by clearing the receipt-time dirty flag after handleMessage and
// before the routing tick: any dirty state observed after that clear is the
// routed farmPlanted event's doing alone. Drop the HEAVY_SELF_EVENTS
// membership and the positive arm reds, exactly as checked the hard way when
// it was written. (The toolEffectResult precedent in
// tests/professions_tool_effect_slot_online.test.ts.)
function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function heavyDirty(session: ClientSession): boolean {
  return (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty;
}

function clearHeavyDirty(session: ClientSession): void {
  (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
}

function standAtBed(server: GameServer, pid: number, bedId: string): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  const p = server.sim.entities.get(pid);
  if (!p) throw new Error(`no entity for pid ${pid}`);
  p.pos.x = bed.x;
  p.pos.z = bed.z;
  p.prevPos = { ...p.pos };
}

describe('farmPlanted is a HEAVY_SELF_EVENTS member: the planter self-mirror re-diffs', () => {
  it('dirties the planter on a successful plant, whose seed spend rides no loot event', () => {
    const server = new GameServer();
    const session = joinServer(server, 1, 'Planter');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    server.sim.addItem('vale_wheat_seed', 1, pid);
    // FLUSH THE SETUP FIRST. Granting the seed emits its own `loot` event, and
    // events sit in the sim buffer until a tick drains them, so without this
    // the plant tick would route the SETUP's loot (itself a member) and dirty
    // the session no matter what farmPlanted does. Verified the hard way: the
    // arm below passed with 'farmPlanted' deleted from the table until this
    // line existed.
    routeTick(server);
    clearHeavyDirty(session);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    // plant_crop IS in HEAVY_SELF_CMDS, and its receipt has already set the
    // flag by now: clearing here is what isolates the EVENT membership, so
    // the dirty state asserted below is the routed farmPlanted's doing and
    // never the command receipt's.
    clearHeavyDirty(session);
    routeTick(server);

    // The plant really happened (otherwise the flag below would prove nothing):
    // the plot exists and the seed is gone from the authoritative bags.
    const meta = server.sim.meta(pid);
    expect(meta?.farmPlots.has(BED)).toBe(true);
    expect(server.sim.countItem('vale_wheat_seed', pid)).toBe(0);
    expect(heavyDirty(session)).toBe(true);
  });

  it('does NOT dirty on a refusal, which spends nothing (farmDenied is not a member)', () => {
    // The negative arm, and the deliberate difference from the toolEffectResult
    // family: farming routes every refusal through a separate farmDenied event,
    // so a client spamming denials forces no heavy re-serialize. Without this
    // arm the positive case above would also pass a signal that fired on
    // everything.
    const server = new GameServer();
    const session = joinServer(server, 2, 'Empty');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    // No seed in bags: the plant is refused at gate 8 and consumes nothing.
    // Same setup flush as above, so this arm measures the command and not
    // whatever the join left buffered.
    routeTick(server);
    clearHeavyDirty(session);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    clearHeavyDirty(session);
    routeTick(server);

    expect(server.sim.meta(pid)?.farmPlots.has(BED)).toBe(false);
    expect(heavyDirty(session)).toBe(false);
  });
});

// END-TO-END FRESHNESS through the heavy self gate.
//
// `fplot` moved behind the heavyDue gate when the growth phase made its
// non-empty arm live (a farming session was otherwise rebuilding, sorting,
// survival-evaluating and stringifying up to one row per authored bed at 20 Hz
// to discover the bytes had not changed). The freshness question the security
// review raised is: does a plot change actually reach the planter's next
// snapshot, or does it now wait on the staggered backstop? These arms answer it
// over the REAL broadcast path rather than by reading a table.
//
// WHAT THEY DO NOT PIN, deliberately: WHICH mechanism supplies the dirty state.
// Two independently do. plant_crop/harvest_crop are HEAVY_SELF_CMDS members,
// AND every successful plant or harvest mutates bags (seed spent, produce or
// husks granted), which bumps meta.wireRev through onInventoryChangedForQuests,
// and wireRev is itself a heavyDue input. Deleting either membership leaves
// these arms green, which was checked rather than assumed. That is the right
// shape anyway: the contract worth pinning is the OBSERVABLE one (the client
// sees the change at once), and it should not red merely because an
// implementation detail moved between two sufficient mechanisms.
describe('a plot change reaches the planter in the very next snapshot', () => {
  function joinWithSocket(server: GameServer, id: number, name: string) {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    return { session, fc };
  }

  it('carries the new plot on the first broadcast after the plant, not on a later refresh', () => {
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 1, 'Fresh');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    server.sim.addItem('vale_wheat_seed', 1, pid);

    // Baseline: a broadcast BEFORE the plant, so the client's mirror already
    // holds the empty plot set and the assertion below cannot pass on a
    // first-snapshot-sends-everything effect.
    broadcast(server);
    expect(lastSnap(fc.sent).self.fplot).toEqual([]);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    broadcast(server);

    const rows = lastSnap(fc.sent).self.fplot as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].bedId).toBe(BED);
    expect(rows[0].cropId).toBe(CROP);
    expect(rows[0].status).toBe('growing');
    // The hidden pre-roll still never crosses, with a real planted row rather
    // than a hand-written fixture behind it (the Phase 2 leak pin's premise).
    expect(rows[0].survivalRoll).toBeUndefined();
    expect(rows[0].yieldSeed).toBeUndefined();
  });

  it('carries the paid knob flags on the wire row, and nothing beyond the nine keys', () => {
    // The knob flags ride fplot only because the server serializes the
    // projection rows verbatim; no field list names them, so a later
    // omit-defaults or filter pass could strip a paid flag from the player's
    // own mirror with every sim-level pin still green. Pinned here over the
    // real broadcast: the flags arrive true, and the row's key set is EXACTLY
    // the nine projection keys (the snapshots.test.ts leak pin's idiom).
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 3, 'Knobbed');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    server.sim.addItem('vale_wheat_seed', 1, pid);
    server.sim.addItem('compost', 1, pid);
    server.sim.addItem('growth_tonic', 1, pid);
    server.sim.addItem('vale_wheat', 2, pid);

    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'plant_crop',
        bed: BED,
        crop: CROP,
        compost: true,
        watch: true,
        tonic: true,
      }),
    );
    broadcast(server);

    const rows = lastSnap(fc.sent).self.fplot as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].compost).toBe(true);
    expect(rows[0].watch).toBe(true);
    expect(rows[0].tonic).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'bedId',
      'compost',
      'cropId',
      'notified',
      'plantedAtMs',
      'readyAtMs',
      'status',
      'tonic',
      'watch',
    ]);
  });

  it('carries the harvest removal on the first broadcast after the harvest', () => {
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 2, 'Reaper');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    server.sim.addItem('vale_wheat_seed', 1, pid);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    broadcast(server);
    expect((lastSnap(fc.sent).self.fplot as unknown[]).length).toBe(1);

    // Ripen it and pull it: the plant cast has to clear first, so drive the
    // grow-now cheat through the sim rather than waiting out a real duration.
    const meta = server.sim.meta(pid);
    const plot = meta?.farmPlots.get(BED);
    if (!plot) throw new Error('the plant did not land');
    plot.readyAtMs = 0;
    const player = server.sim.entities.get(pid);
    if (player) {
      player.castingAbility = null;
      player.castRemaining = 0;
    }
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvest_crop', bed: BED }));
    broadcast(server);

    // The emptied plot set reaches the client at once too, which is the arm
    // that would silently regress if only plant_crop were a HEAVY_SELF_CMDS
    // member: harvest_crop needs its own entry, and this is what proves it.
    expect(server.sim.meta(pid)?.farmPlots.has(BED)).toBe(false);
    expect(lastSnap(fc.sent).self.fplot).toEqual([]);
  });
});

// EVENT DELIVERY over the real routing path (QA round). Farming's ENTIRE
// online feedback channel (the chat lines, the husk line, every refusal toast)
// is these four personal events reaching the actor's socket: nothing else in
// this suite proved delivery, so a future interest-scope or suppression filter
// quietly swallowing non-combat personal events would have shipped a silently
// mute farming loop. Frames are read off the same fake sockets the broadcast
// suite uses; farm events are pid-scoped personal, so a bystander standing at
// the SAME bed must receive nothing.
describe('the four farm events reach the actor, and only the actor', () => {
  function joinWithSocket(server: GameServer, id: number, name: string) {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    return { session, fc };
  }

  function farmEvents(sent: unknown[], type: string): { pid?: number }[] {
    return (sent as { t?: string; list?: { type?: string; pid?: number }[] }[])
      .filter((m) => m.t === 'events')
      .flatMap((m) => m.list ?? [])
      .filter((e) => e.type === type) as { pid?: number }[];
  }

  it('delivers farmPlanted and farmDenied to the planter, never to a bystander', () => {
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 1, 'Actor');
    const { session: bystander, fc: bystanderFc } = joinWithSocket(server, 2, 'Bystander');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    standAtBed(server, bystander.pid as number, BED);
    server.sim.addItem('vale_wheat_seed', 1, pid);
    routeTick(server);
    fc.sent.length = 0;
    bystanderFc.sent.length = 0;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    routeTick(server);
    expect(farmEvents(fc.sent, 'farmPlanted')).toHaveLength(1);
    expect(farmEvents(fc.sent, 'farmPlanted')[0].pid).toBe(pid);
    // Personal means personal: the bystander at the same bed sees nothing.
    expect(farmEvents(bystanderFc.sent, 'farmPlanted')).toHaveLength(0);

    // A refusal reaches the actor the same way (the empty pouch: gate 8). The
    // flavor cast from the plant above must clear first, or the busy gate
    // answers through the shared error line instead of farmDenied.
    const actor = server.sim.entities.get(pid);
    if (actor) {
      actor.castingAbility = null;
      actor.castRemaining = 0;
    }
    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: 'bed_eastbrook_2', crop: CROP }),
    );
    routeTick(server);
    expect(farmEvents(fc.sent, 'farmDenied')).toHaveLength(1);
    expect(farmEvents(bystanderFc.sent, 'farmDenied')).toHaveLength(0);
  });

  it('delivers farmHusksConverted to the trader, never to a bystander', () => {
    // The knobs phase's fifth farm event, over the same live routing path as
    // the four above: without this arm a suppression filter could mute the
    // trade's only feedback line while every sim-level pin stayed green.
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 1, 'Trader');
    const { fc: bystanderFc } = joinWithSocket(server, 2, 'Bystander');
    const pid = session.pid as number;
    server.sim.addItem('withered_husks', 2, pid);
    // Flush the setup grant's own loot event before measuring (the fixture
    // vacuity discipline the HEAVY_SELF arms above document).
    routeTick(server);
    fc.sent.length = 0;
    bystanderFc.sent.length = 0;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'convert_husks' }));
    routeTick(server);
    const events = farmEvents(fc.sent, 'farmHusksConverted');
    expect(events).toHaveLength(1);
    expect(events[0].pid).toBe(pid);
    expect(farmEvents(bystanderFc.sent, 'farmHusksConverted')).toHaveLength(0);
    // The trade really happened on the authoritative bags, so the delivery
    // above is a real event and not a stray echo.
    expect(server.sim.countItem('compost', pid)).toBe(1);
    expect(server.sim.countItem('withered_husks', pid)).toBe(0);

    // And the refusal twin through the same path: a second convert with an
    // empty pouch answers with the pid-scoped farmDenied.
    fc.sent.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'convert_husks' }));
    routeTick(server);
    expect(farmEvents(fc.sent, 'farmDenied')).toHaveLength(1);
    expect(farmEvents(bystanderFc.sent, 'farmDenied')).toHaveLength(0);
  });

  it('delivers farmHarvested for a ready plot and farmWithered for a doomed one', () => {
    const server = new GameServer();
    const { session, fc } = joinWithSocket(server, 1, 'Reaper');
    const pid = session.pid as number;
    standAtBed(server, pid, BED);
    server.sim.addItem('vale_wheat_seed', 2, pid);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    const meta = server.sim.meta(pid);
    const plot = meta?.farmPlots.get(BED);
    if (!plot) throw new Error('the plant did not land');
    plot.readyAtMs = 0;
    plot.survivalRoll = 0; // survives at any skill
    const player = server.sim.entities.get(pid);
    if (player) {
      player.castingAbility = null;
      player.castRemaining = 0;
    }
    routeTick(server);
    fc.sent.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvest_crop', bed: BED }));
    routeTick(server);
    expect(farmEvents(fc.sent, 'farmHarvested')).toHaveLength(1);

    // And the withered twin, through the same live path.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'plant_crop', bed: BED, crop: CROP }),
    );
    const doomed = meta?.farmPlots.get(BED);
    if (!doomed) throw new Error('the second plant did not land');
    doomed.readyAtMs = 0;
    doomed.survivalRoll = 0.99; // loses to the 0.85 chance at skill 0
    if (player) {
      player.castingAbility = null;
      player.castRemaining = 0;
    }
    routeTick(server);
    fc.sent.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvest_crop', bed: BED }));
    routeTick(server);
    expect(farmEvents(fc.sent, 'farmWithered')).toHaveLength(1);
    expect(farmEvents(fc.sent, 'farmHarvested')).toHaveLength(0);
  });
});
