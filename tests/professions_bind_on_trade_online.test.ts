// Professions 2.0 (Enchanting reachable) COVERAGE arms: the gaps the
// two shipped suites (tests/professions_typed_reagents.test.ts and
// tests/professions_enchanting_commands.test.ts) leave open.
//
//   1. The full TWO-SESSION bind-on-trade arc over a LIVE GameServer: A
//      disenchants two rares (armed secondaries in A's bags), trades one to B
//      over the real trade wire (the stamp lands on B's granted copy and
//      surfaces in B's mirrored inventory), then B's attempt to trade the bound
//      copy back is refused with the localized deny, the copy stays with B, and
//      A's OTHER unbound armed copy is still offerable. The second-trade
//      refusal is BOTH directions: B cannot offer it, so the round-trip can
//      never even begin.
//   2. The bindOnTrade JSONB persistence round-trip: an armed-unstamped payload
//      and a stamped payload both survive serializeCharacter -> JSON -> load
//      byte-identically inside an InvSlot, and an absurd persisted count on an
//      armed instanced stack load-clamps through the SHARED bags.ts
//      instancedCountCap ceiling (no bespoke bypass for the new payload shape).
//   3+4. Online throttled-deny surfacing + cross-action attribution over a live
//      GameServer: the shared 10-per-60s window (action_throttle.ts) is spent by
//      mixed real actions, and the (MAX+1)th action denies over the wire with
//      ITS OWN event type / reason 'throttled', never a sibling action's event,
//      consuming nothing.
//
// These arms deliberately do NOT duplicate the shipped suites: the offline
// resolver/yield/trade-lock semantics, the single-client online routing of a
// SUCCESS, and the eqi inspect strip live there. This file exercises only the
// multi-session, persistence, and online-deny paths those two omit.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so the live GameServer suite needs no Postgres (the vi.mock
// hoisting caveat from #2088 applies: this block cannot reference imports).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
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
import { ClientWorld } from '../src/net/online';
import { instancedCountCap } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { InvSlot, PlayerClass, SimEvent } from '../src/sim/types';

// A common one-hand weapon: disenchants to arcane_dust (sub-rare, no typed
// secondary) and salvages to bone_fragments. Both actions draw the shared
// window, so it burns the throttle either way.
const COMMON_WEAPON = 'eastbrook_arming_sword';
// A rare mace: disenchants to a FIXED single arcane_essence primary plus exactly
// ONE typed, bind-on-trade secondary (resonant_steel), with ZERO rng draws.
// Chosen over an epic precisely for that determinism: an epic's 1-or-2 secondary
// count rides an rng draw, so two epic disenchants would grant a seed-dependent
// total. Two rare disenchants grant exactly two byte-equal armed copies, which
// stack into one slot of count 2, the clean "trade one, keep one"
// shape arm 1 needs.
const RARE_WEAPON = 'moggers_copper_cudgel';
const SECONDARY = 'resonant_steel';
const DUST = 'arcane_dust';
const BOUND_ERROR = 'That item is bound and cannot be traded.';

const FIELD_A = { x: 0, z: 150 };
const FIELD_B = { x: 3, z: 150 };

// ---------------------------------------------------------------------------
// Live-server harness (the tests/professions_enchanting_commands.test.ts recipe,
// redefined here so this file is standalone and never imports another test).
// ---------------------------------------------------------------------------
type WireMsg = {
  t: string;
  list?: SimEvent[];
  self?: Record<string, unknown>;
  [k: string]: unknown;
};

function fakeWs(): { sent: WireMsg[]; ws: unknown } {
  const sent: WireMsg[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: ReturnType<typeof fakeWs>,
  id: number,
  name: string,
): ClientSession {
  const session = server.join(fc.ws as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function placeAt(server: GameServer, pid: number, pos: { x: number; z: number }): void {
  const entity = (
    server.sim as unknown as { entities: Map<number, { pos: any; prevPos?: any }> }
  ).entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { x: pos.x, z: pos.z };
}

function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function broadcast(server: GameServer): void {
  (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
}

function lastSnap(sent: WireMsg[]): { self: Record<string, unknown> } | null {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i] as any;
  return null;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function eventsFor(sent: WireMsg[], type: SimEvent['type'], fromIdx = 0): SimEvent[] {
  return sent
    .slice(fromIdx)
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

function serverInv(server: GameServer, pid: number): InvSlot[] {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta.inventory;
}

function tradeSessionFor(
  server: GameServer,
  pid: number,
): { a: number; offerA: any; offerB: any } | undefined {
  return (server.sim as unknown as { ctx: { trades: Map<number, any> } }).ctx.trades.get(pid);
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly
// (the tests/snapshots.test.ts bareClient shape).
function bareClient(pid: number, playerClass: PlayerClass = 'warrior'): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = playerClass;
  c.spectating = null;
  c.cupInfo = null;
  c.lastVcupRemainder = null;
  c.lastVcupShared = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.nodeCooldowns = new Map();
  return c;
}

function applySnap(client: ClientWorld, snap: unknown): void {
  (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
}

// ---------------------------------------------------------------------------
// Arm 1: the two-session bind-on-trade arc over a live GameServer.
// ---------------------------------------------------------------------------
describe('online bind-on-trade arc (two sessions, live GameServer)', () => {
  it('first trade stamps the recipient, the reverse trade is refused, and A keeps an offerable copy', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const a = joinServer(server, fcA, 601, 'Ayla');
    const b = joinServer(server, fcB, 602, 'Borin');
    placeAt(server, a.pid, FIELD_A);
    placeAt(server, b.pid, FIELD_B);

    // A disenchants two rares -> two armed, unstamped resonant_steel copies that
    // stack into one slot of count 2 (byte-equal payloads).
    server.sim.addItem(RARE_WEAPON, 2, a.pid);
    cmd(server, a, { cmd: 'disenchant_item', item: RARE_WEAPON });
    cmd(server, a, { cmd: 'disenchant_item', item: RARE_WEAPON });
    routeTick(server);
    const aStack = serverInv(server, a.pid).find((s) => s.itemId === SECONDARY);
    expect(aStack?.count).toBe(2);
    expect(aStack?.instance?.bindOnTrade).toBe(true);
    expect(aStack?.instance?.boundTo).toBeUndefined(); // minted armed but unstamped

    // A -> B trade of ONE copy over the real trade wire.
    cmd(server, a, { cmd: 'trade_req', id: b.pid });
    cmd(server, b, { cmd: 'trade_accept' });
    cmd(server, a, { cmd: 'trade_offer', items: [{ itemId: SECONDARY, count: 1 }] });
    cmd(server, a, { cmd: 'trade_confirm' });
    cmd(server, b, { cmd: 'trade_confirm' });
    routeTick(server);

    // The stamp landed on B's granted copy (boundTo === B), and A keeps exactly
    // one still-unstamped armed copy.
    const bSlot = serverInv(server, b.pid).find((s) => s.itemId === SECONDARY);
    expect(bSlot?.count).toBe(1);
    expect(bSlot?.instance?.bindOnTrade).toBe(true);
    expect(bSlot?.instance?.boundTo).toBe(b.pid);
    const aAfter = serverInv(server, a.pid).find((s) => s.itemId === SECONDARY);
    expect(aAfter?.count).toBe(1);
    expect(aAfter?.instance?.boundTo).toBeUndefined();

    // The stamp surfaces in B's MIRRORED inventory after a broadcast (the
    // tradeDone HEAVY_SELF_EVENT refreshed B's self inventory).
    broadcast(server);
    const bSnap = lastSnap(fcB.sent);
    if (!bSnap) throw new Error('no snapshot for B');
    const bClient = bareClient(b.pid);
    applySnap(bClient, bSnap);
    const bMirrored = bClient.inventory.find((s) => s.itemId === SECONDARY);
    expect(bMirrored?.instance?.boundTo).toBe(b.pid);
    expect(bMirrored?.instance?.bindOnTrade).toBe(true);

    // B tries to trade the bound copy BACK to A: the offer is refused. B is the
    // requester (session.a === B), so the deny clamps B's own offer to empty and
    // B receives the localized error (the exact literal the HUD matcher and the
    // S3 localization guard key on). A never receives that error.
    const aErrBefore = eventsFor(fcA.sent, 'error').length;
    cmd(server, b, { cmd: 'trade_req', id: a.pid });
    cmd(server, a, { cmd: 'trade_accept' });
    cmd(server, b, { cmd: 'trade_offer', items: [{ itemId: SECONDARY, count: 1 }] });
    routeTick(server);
    expect(
      eventsFor(fcB.sent, 'error').some((e) => e.type === 'error' && e.text === BOUND_ERROR),
    ).toBe(true);
    expect(eventsFor(fcA.sent, 'error').length).toBe(aErrBefore); // pid-scoped to B only
    // The impossibility that blocks the round-trip: B's offer is empty, so the
    // bound copy can never even enter a trade, in EITHER direction.
    const bSession = tradeSessionFor(server, b.pid);
    const bOffer = bSession?.a === b.pid ? bSession?.offerA : bSession?.offerB;
    expect(bOffer?.items).toEqual([]);

    // Even confirming the empty handshake moves nothing: B keeps the bound copy,
    // A never gains one back.
    cmd(server, b, { cmd: 'trade_confirm' });
    cmd(server, a, { cmd: 'trade_confirm' });
    routeTick(server);
    expect(server.sim.countItem(SECONDARY, b.pid)).toBe(1);
    expect(server.sim.countItem(SECONDARY, a.pid)).toBe(1); // still just A's own unbound copy

    // A's OTHER (unbound, unstamped) copy is STILL offerable: a fresh A -> B
    // trade accepts it into A's offer with no bound-deny to A.
    const aErrBeforeReoffer = eventsFor(fcA.sent, 'error').length;
    cmd(server, a, { cmd: 'trade_req', id: b.pid });
    cmd(server, b, { cmd: 'trade_accept' });
    cmd(server, a, { cmd: 'trade_offer', items: [{ itemId: SECONDARY, count: 1 }] });
    routeTick(server);
    expect(eventsFor(fcA.sent, 'error').length).toBe(aErrBeforeReoffer); // no bound deny
    const aSession = tradeSessionFor(server, a.pid);
    const aOffer = aSession?.a === a.pid ? aSession?.offerA : aSession?.offerB;
    expect(aOffer?.items).toEqual([{ itemId: SECONDARY, count: 1 }]);
    cmd(server, a, { cmd: 'trade_cancel' });
  });
});

// ---------------------------------------------------------------------------
// Arm 2: bindOnTrade JSONB persistence round-trip + the shared load clamp.
// ---------------------------------------------------------------------------
function freshSim(seed = 5): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false, noPlayer: true });
}

describe('bindOnTrade persistence round-trip (serialize -> JSONB -> load)', () => {
  it('an armed-unstamped and a stamped payload both survive a serialize/load round-trip byte-identically', () => {
    const src = freshSim();
    const pid = src.addPlayer('warrior', 'Src');
    // Two distinct payloads => two distinct slots (boundTo differs, so they never
    // merge). 777 is an arbitrary persisted owner id; the load only preserves it.
    src.ctx.addItemInstance(SECONDARY, { bindOnTrade: true }, pid);
    src.ctx.addItemInstance(SECONDARY, { bindOnTrade: true, boundTo: 777 }, pid);

    const state = src.serializeCharacter(pid);
    if (!state) throw new Error('serializeCharacter returned null');
    // Simulate the JSONB store/load byte boundary.
    const wire = JSON.parse(JSON.stringify(state));

    const dst = freshSim(9);
    const loadedPid = dst.addPlayer('warrior', 'Dst', { state: wire });
    const inv = dst.ctx.resolve(loadedPid)?.meta.inventory ?? [];
    const armed = inv.find((s) => s.itemId === SECONDARY && s.instance?.boundTo === undefined);
    const stamped = inv.find((s) => s.itemId === SECONDARY && s.instance?.boundTo === 777);
    expect(armed?.instance).toEqual({ bindOnTrade: true });
    expect(stamped?.instance).toEqual({ bindOnTrade: true, boundTo: 777 });
    expect(armed?.count).toBe(1);
    expect(stamped?.count).toBe(1);
  });

  it('an absurd persisted count on an armed instanced stack load-clamps through the SHARED instancedCountCap', () => {
    const src = freshSim();
    const pid = src.addPlayer('warrior', 'Src');
    src.ctx.addItemInstance(SECONDARY, { bindOnTrade: true }, pid);

    const state = src.serializeCharacter(pid);
    if (!state) throw new Error('serializeCharacter returned null');
    const wire = JSON.parse(JSON.stringify(state)) as typeof state;
    // Tamper: inflate the armed stack's persisted count far past any legitimate
    // merge could build.
    const tampered = wire.inventory.find((s) => s.itemId === SECONDARY);
    if (!tampered) throw new Error('no persisted resonant_steel slot');
    tampered.count = 9999;

    const dst = freshSim(9);
    const loadedPid = dst.addPlayer('warrior', 'Dst', { state: wire });
    const loaded = (dst.ctx.resolve(loadedPid)?.meta.inventory ?? []).find(
      (s) => s.itemId === SECONDARY,
    );
    // The load consumed the SHARED bags.ts helper: the armed payload is mergeable
    // (no charges), so it caps at the item's stack size, NOT at 1, and NOT at the
    // tampered 9999. No bespoke bypass for the new bindOnTrade shape.
    const cap = instancedCountCap(ITEMS[SECONDARY], { bindOnTrade: true });
    expect(loaded?.count).toBe(cap);
    expect(cap).toBeGreaterThan(1); // mergeable arm (stack size), not the one-per-slot charge arm
    expect(loaded?.count).toBeLessThan(9999); // genuinely clamped
    expect(loaded?.instance).toEqual({ bindOnTrade: true }); // payload itself untouched
  });
});

// ---------------------------------------------------------------------------
// Arms 3 + 4: online throttled-deny surfacing and cross-action attribution.
// The shared window (action_throttle.ts) is burned by REAL mixed actions over a
// live GameServer; no sim.tick runs during the burn, so sim.time (and the
// window) never advances until the deny is observed.
// ---------------------------------------------------------------------------
describe('online shared-throttle deny surfacing (live GameServer)', () => {
  it('a throttled disenchant surfaces reason "throttled" over the event AND the denc delta, consuming nothing', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 611, 'Windowed');
    placeAt(server, st.pid, FIELD_A);
    // 11 copies: 10 to burn the shared window via a genuine MIX (5 salvage + 5
    // disenchant), 1 left for the throttled attempt.
    server.sim.addItem(COMMON_WEAPON, CRAFT_THROTTLE_MAX_PER_WINDOW + 1, st.pid);

    const half = CRAFT_THROTTLE_MAX_PER_WINDOW / 2;
    for (let i = 0; i < half; i++) cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW - half; i++)
      cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    // The window is now spent by mixed action types. Capture the pre-deny stock.
    const weaponsBefore = server.sim.countItem(COMMON_WEAPON, st.pid);
    const dustBefore = server.sim.countItem(DUST, st.pid);
    expect(weaponsBefore).toBe(1);

    cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server);

    // Immediacy arm: the pid-scoped disenchantResult carries reason 'throttled'.
    const denc = eventsFor(fc.sent, 'disenchantResult');
    const throttled = denc[denc.length - 1];
    if (throttled?.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(throttled.ok).toBe(false);
    expect(throttled.reason).toBe('throttled');
    expect(throttled.pid).toBe(st.pid);

    // Convergence arm: the denc self-delta mirrors the throttled stash, and a
    // real ClientWorld decodes it onto lastDisenchantResult.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastDisenchantResultFor(st.pid);
    expect(stash?.reason).toBe('throttled');
    expect(snap.self.denc).toEqual(stash);
    const client = bareClient(st.pid);
    applySnap(client, snap);
    expect(client.lastDisenchantResult).toEqual(stash);

    // The throttled attempt consumed nothing and granted nothing.
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(weaponsBefore);
    expect(server.sim.countItem(DUST, st.pid)).toBe(dustBefore);
  });

  it('a throttled salvage after disenchant spends denies with salvageResult, NEVER a disenchantResult', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 612, 'Attributed');
    placeAt(server, st.pid, FIELD_A);
    // 11 copies: 10 disenchants spend the shared window, 1 left to salvage.
    server.sim.addItem(COMMON_WEAPON, CRAFT_THROTTLE_MAX_PER_WINDOW + 1, st.pid);

    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++)
      cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server); // drain the burn's disenchantResult events
    const lastDencBefore = server.sim.lastDisenchantResultFor(st.pid);
    expect(lastDencBefore?.ok).toBe(true); // the burn ended on a success
    const mark = fc.sent.length;
    const weaponsBefore = server.sim.countItem(COMMON_WEAPON, st.pid);
    expect(weaponsBefore).toBe(1);

    // The (MAX+1)th action is a SALVAGE: it sees the window spent by disenchants
    // (the window is genuinely shared across action types) and denies with its
    // OWN event type.
    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);

    const newSalv = eventsFor(fc.sent, 'salvageResult', mark);
    expect(newSalv).toHaveLength(1);
    if (newSalv[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(newSalv[0].ok).toBe(false);
    expect(newSalv[0].reason).toBe('throttled');
    // Discrimination: the throttled salvage emitted NO disenchantResult, and it
    // did not overwrite the disenchant stash either.
    expect(eventsFor(fc.sent, 'disenchantResult', mark)).toEqual([]);
    expect(server.sim.lastDisenchantResultFor(st.pid)).toEqual(lastDencBefore);
    expect(server.sim.lastSalvageResultFor(st.pid)?.reason).toBe('throttled');
    // Nothing consumed by the throttled attempt.
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(weaponsBefore);
  });
});
