// The shared feast (Farming Phase 12) end to end over the live wire, the
// farming_command_chain_online idiom: the frames ClientWorld actually emits,
// fed verbatim into the real GameServer dispatch, with MULTIPLE sessions on
// the same server, because the feature's whole point is cross-session: one
// player places, another eats. Nothing here hand-writes a command frame; the
// client's own bytes are captured off a stub socket and handed to
// server.handleMessage unchanged, so a payload field skew between
// ClientWorld's send and the dispatch's read can only red here.
//
// FRAME-RACE DISCIPLINE (the event-forced-read lesson): events broadcast
// BEFORE snapshots, so every state read that follows an event stays armed
// across frames (routeTick + broadcast per attempt, bounded) until the
// change is observed, never a one-shot read.
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

import type { ClientSession, GameServer as GameServerType } from '../server/game';
import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { farmBedById } from '../src/sim/content/farm_patches';
import { CONSUME_DURATION, type SimEvent } from '../src/sim/types';
import { broadcast, type FakeClient, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

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

// Run a body against a world that can actually SEND (the farming chain
// suite's rig: canSendCommand needs `connected`, which the server's `hello`
// sets, and it reads WebSocket.OPEN off the global, so the stub must stay
// installed for the whole body).
function withClient(fn: (world: ClientWorld, sock: StubWebSocket) => void): void {
  withDomStubs(() => {
    const world = new ClientWorld('feast-online-token', 1, 'warrior', 'http://x');
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

/** The one raw frame a fresh real ClientWorld emits for `send`. */
function captureFrame(send: (world: ClientWorld) => void): string {
  let raw = '';
  withClient((world, sock) => {
    send(world);
    if (sock.sent.length !== 1) {
      throw new Error(`expected exactly one frame, got ${sock.sent.length}`);
    }
    raw = sock.sent[0];
  });
  return raw;
}

// --- the server half ---

function routeTick(server: GameServerType): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

interface FarmEventFrame {
  pid?: number;
  reason?: string;
  feastId?: number;
}

function farmEvents(sent: unknown[], type: string): FarmEventFrame[] {
  return (sent as { t?: string; list?: { type?: string; pid?: number }[] }[])
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((e) => e.type === type) as FarmEventFrame[];
}

/** Stand a player one step east of a garden bed (the proven-safe fixture
 *  spot of the farming online suite; no mob reaches it inside a test). */
function standNearBed(server: GameServerType, pid: number, bedId: string, dx = 1): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  const p = server.sim.entities.get(pid);
  if (!p) throw new Error(`no entity for pid ${pid}`);
  p.pos.x = bed.x + dx;
  p.pos.z = bed.z;
  p.prevPos = { ...p.pos };
}

/** Tick-and-broadcast until `read` yields a value, bounded (the frame-race
 *  lesson: never a one-shot read after consuming an event). */
function awaitFrames<T>(server: GameServerType, read: () => T | null, bound = 30): T {
  for (let i = 0; i < bound; i++) {
    const got = read();
    if (got !== null) return got;
    routeTick(server);
    broadcast(server);
  }
  throw new Error(`the awaited wire state never arrived within ${bound} frames`);
}

// biome-ignore lint/suspicious/noExplicitAny: wire rows are untyped JSON
function invItemIds(snap: any): string[] {
  const inv = snap?.self?.inv as { itemId?: string }[] | undefined;
  return (inv ?? []).map((row) => row.itemId ?? '');
}

// An entity is PRESENT on a snap either as a full/lite `ents` row (new or
// changed) or as a bare id on the `keep` list (unchanged and settled, kept
// alive without re-serializing). Absent from both means despawned or out of
// interest: the client prunes by exactly this absence.
// biome-ignore lint/suspicious/noExplicitAny: wire rows are untyped JSON
function entPresent(snap: any, id: number): boolean {
  const ents = (snap?.ents ?? []) as { id?: number }[];
  if (ents.some((row) => row.id === id)) return true;
  return ((snap?.keep ?? []) as number[]).includes(id);
}

const BED = 'bed_eastbrook_1';

// Production shape: the feast is a normal player command family, never a dev
// cheat, so every dispatch claim here must hold with the dev gate unset.
beforeEach(() => {
  expect(process.env.ALLOW_DEV_COMMANDS).toBeUndefined();
});

describe('ClientWorld emits the feast frames the protocol declares', () => {
  it('placeFeast sends place_feast with NO payload beyond the frame chrome', () => {
    withClient((world, sock) => {
      world.placeFeast();
      const frames = sock.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
      expect(frames).toHaveLength(1);
      // Exhaustive: the item id, charges, expiry and the one-active-feast
      // rule all resolve server-side, so an EXTRA field here would be a
      // client trying to choose its own feast.
      expect(Object.keys(frames[0]).sort()).toEqual(['cmd', 't']);
      expect(frames[0]).toEqual({ t: 'cmd', cmd: 'place_feast' });
    });
  });

  it('consumeFeast sends consume_feast carrying exactly the entity id', () => {
    withClient((world, sock) => {
      world.consumeFeast(42);
      const frames = sock.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
      expect(frames).toHaveLength(1);
      expect(Object.keys(frames[0]).sort()).toEqual(['cmd', 'id', 't']);
      expect(frames[0]).toEqual({ t: 'cmd', cmd: 'consume_feast', id: 42 });
    });
  });
});

describe('the multi-session feast routing over the real broadcast path', () => {
  function join(server: GameServerType, id: number, name: string) {
    const fc: FakeClient = fakeWs();
    const session: ClientSession = joinServer(server, fc, id, name);
    return { session, fc };
  }

  it('the placer self snapshot reflects the spent bag item on the very next broadcast', () => {
    const server = new GameServer();
    const { session, fc } = join(server, 1, 'Placer');
    const pid = session.pid as number;
    standNearBed(server, pid, BED);
    server.sim.addItem('harvest_feast', 1, pid);
    // Ride out the FIRST 1 Hz residue before the baseline (the heavy-self-arm
    // lesson): the join's welcome letter arrives on that boundary and is
    // itself a heavy marker, so a baseline taken earlier could owe its inv
    // bytes to the mail rather than the grant, and the "very next broadcast"
    // claim below would not isolate the command.
    for (let i = 0; i < 25; i++) routeTick(server);
    broadcast(server);
    expect(invItemIds(lastSnap(fc.sent))).toContain('harvest_feast');

    // The client's own bytes, verbatim.
    server.handleMessage(
      session,
      captureFrame((world) => world.placeFeast()),
    );
    broadcast(server);

    // The spend is real on the authoritative bags AND already on this first
    // post-command snapshot (place_feast is a HEAVY_SELF_CMDS member; a drop
    // from that table strands this inv on the staggered backstop and reds
    // the assertion below).
    expect(server.sim.countItem('harvest_feast', pid)).toBe(0);
    expect(invItemIds(lastSnap(fc.sent))).not.toContain('harvest_feast');
    // And the entity really spawned server-side.
    const feast = [...server.sim.entities.values()].find((e) => e.templateId === 'farm_feast');
    expect(feast).toBeDefined();
  });

  it('routes place, the entity snapshot, the bite, Well Fed, the ledger deny, and the despawn across two sessions', () => {
    const server = new GameServer();
    const { session: placer, fc: placerFc } = join(server, 1, 'Placer');
    const { session: guest, fc: guestFc } = join(server, 2, 'Guest');
    const placerPid = placer.pid as number;
    const guestPid = guest.pid as number;
    // Both inside INTERACT_RANGE of the drop spot (the placer's feet) and
    // trivially inside each other's interest.
    standNearBed(server, placerPid, BED, 1);
    standNearBed(server, guestPid, BED, 2);
    server.sim.addItem('harvest_feast', 1, placerPid);
    for (let i = 0; i < 25; i++) routeTick(server); // flush grant + welcome mail

    server.handleMessage(
      placer,
      captureFrame((world) => world.placeFeast()),
    );

    // SESSION 2 sees the feast on ITS normal entity snapshot: no new wire
    // mechanism, just an ents row (k/tid/nm are the identity keys every
    // entity rides). Bounded await, never a one-shot read.
    const row = awaitFrames(server, () => {
      const snap = lastSnap(guestFc.sent);
      const ents = (snap?.ents ?? []) as { tid?: string }[];
      return (ents.find((r) => r.tid === 'farm_feast') as Record<string, unknown>) ?? null;
    });
    expect(row.k).toBe('object');
    expect(row.tid).toBe('farm_feast');
    // The name VALUE is the placer's raw player name (the client composes the
    // localized title from it; never sim-side English).
    expect(row.nm).toBe('Placer');
    const feastId = row.id as number;
    expect(server.sim.ctx.feasts.has(feastId)).toBe(true);

    // SESSION 2 eats, with its own client's bytes carrying the id it just
    // learned off the wire. The self mirror gains the eating state.
    server.handleMessage(
      guest,
      captureFrame((world) => world.consumeFeast(feastId)),
    );
    const eat = awaitFrames(server, () => {
      const snap = lastSnap(guestFc.sent);
      return (snap?.self?.eat as { remaining?: number } | null) ?? null;
    });
    expect(eat.remaining).toBeGreaterThan(0);
    expect(eat.remaining).toBeLessThanOrEqual(CONSUME_DURATION);

    // Past the 18s sit-restore, the Phase 11 completion path mints Well Fed
    // on the EATER's own snapshot (value 12, the +12 Stamina buff).
    for (let i = 0; i < CONSUME_DURATION * 20 + 10; i++) routeTick(server);
    const wellfed = awaitFrames(server, () => {
      const snap = lastSnap(guestFc.sent);
      const auras = (snap?.self?.auras ?? []) as { id?: string; value?: number }[];
      return auras.find((a) => a.id === 'wellfed_buff_sta') ?? null;
    });
    expect(wellfed.value).toBe(12);

    // The SECOND bite answers the ledger deny, to the eater's socket ONLY
    // (farm events are pid-scoped personal; the placer is the bystander
    // negative here). State unchanged: the deny spends nothing.
    const chargesBefore = server.sim.ctx.feasts.get(feastId)?.charges;
    placerFc.sent.length = 0;
    guestFc.sent.length = 0;
    server.handleMessage(
      guest,
      captureFrame((world) => world.consumeFeast(feastId)),
    );
    routeTick(server);
    const denied = farmEvents(guestFc.sent, 'farmDenied');
    expect(denied).toHaveLength(1);
    expect(denied[0].pid).toBe(guestPid);
    expect(denied[0].reason).toBe('feast_eaten');
    expect(farmEvents(placerFc.sent, 'farmDenied')).toHaveLength(0);
    expect(server.sim.ctx.feasts.get(feastId)?.charges).toBe(chargesBefore);

    // DESPAWN: force the tick-domain expiry (the suite's plot-write idiom;
    // the real 3600-tick wait is not a test's business), let the 1 Hz sweep
    // inside updateFarming collect it, and both sessions learn by ABSENCE
    // from their normal snapshots: no removal message exists to assert.
    // Positive control first: a fresh snapshot still carries the feast on
    // BOTH sockets (as an ents row or a keep id), so the absence below is
    // the sweep's doing, never idle-entity elision.
    broadcast(server);
    expect(entPresent(lastSnap(guestFc.sent), feastId)).toBe(true);
    expect(entPresent(lastSnap(placerFc.sent), feastId)).toBe(true);
    const state = server.sim.ctx.feasts.get(feastId);
    if (!state) throw new Error('the feast state vanished early');
    state.expiresAtTick = server.sim.tickCount;
    awaitFrames(server, () => {
      const guestSnap = lastSnap(guestFc.sent);
      const placerSnap = lastSnap(placerFc.sent);
      if (!guestSnap || !placerSnap) return null;
      const gone = !entPresent(guestSnap, feastId) && !entPresent(placerSnap, feastId);
      return gone ? true : null;
    });
    expect(server.sim.entities.has(feastId)).toBe(false);
    expect(server.sim.ctx.feasts.has(feastId)).toBe(false);
  });
});
