// Proves the
// ClientWorld lastDisenchantResult/lastEnchantResult/lastSalvageResult reads are
// LIVE over the real wire path, closing what the shipped suites leave open:
//   A. The FULL onMessage wire path for the event arm (the shipped suites call
//      the private applyXResultEvent handlers directly; this feeds real server
//      'events' frames through onMessage and also pins the eventQueue HUD arm).
//   B. Identical consecutive denies: the maybe() delta diffs serialized JSON, so
//      a second same-reason deny ships NO salv delta; the event arm alone must
//      surface it.
//   C. Ordering both ways in one client frame (event->snap, snap->event) plus
//      the no-clear guarantee (a snapshot without the key preserves the mirror).
//   D. Reconnect-style full snapshot (fresh session.lastSent) re-ships all three
//      keys, including explicit nulls.
//   E. Throttled apply_enchant attribution (the shipped coverage suite probes
//      disenchant and salvage attribution, never enchant).
import { describe, expect, it, vi } from 'vitest';

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
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import type { PlayerClass, SimEvent } from '../src/sim/types';

const COMMON_WEAPON = 'eastbrook_arming_sword';
const DUST = 'arcane_dust';
const WEAPON_ENCHANT = 'enchant_weapon_might';
const FIELD_POS = { x: 0, z: 150 };

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

function snapAfter(sent: WireMsg[], fromIdx = 0): { self: Record<string, unknown> } | null {
  for (let i = sent.length - 1; i >= fromIdx; i--) if (sent[i].t === 'snap') return sent[i] as any;
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

function eventFrames(sent: WireMsg[], fromIdx = 0): WireMsg[] {
  return sent.slice(fromIdx).filter((m) => m.t === 'events');
}

// The tests/snapshots.test.ts bareClient shape (identical to the shipped
// suites): a ClientWorld without WebSocket plumbing.
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

// eventQueue is private on ClientWorld; the probe reads it through one cast
// (the HUD drains it via drainEvents, which would consume what we assert on).
function queueOf(client: ClientWorld): SimEvent[] {
  return (client as unknown as { eventQueue: SimEvent[] }).eventQueue;
}

function applySnap(client: ClientWorld, snap: unknown): void {
  (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
}

// Feed a raw wire frame through the REAL client entry point (ws.onmessage ->
// onMessage), not the private per-event handlers.
function feed(client: ClientWorld, frame: WireMsg): void {
  (client as unknown as { onMessage(raw: string): void }).onMessage(JSON.stringify(frame));
}

// ---------------------------------------------------------------------------
// A. Event arm ALONE over the real onMessage wire path (no snapshot at all).
// ---------------------------------------------------------------------------
describe('result mirror: event arm alone through the real onMessage path', () => {
  it('real server events frames drive all three lastX mirrors and the eventQueue with NO snapshot', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 701, 'WireA');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 3, st.pid);
    server.sim.addItem(DUST, 5, st.pid);
    const client = bareClient(st.pid);
    expect(client.lastSalvageResult).toBeUndefined(); // bareClient skips field init

    // Salvage.
    let mark = fc.sent.length;
    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    for (const f of eventFrames(fc.sent, mark)) feed(client, f);
    const salvStash = server.sim.lastSalvageResultFor(st.pid);
    expect(salvStash?.ok).toBe(true);
    expect(client.lastSalvageResult).toEqual(salvStash);
    expect(queueOf(client).filter((e: SimEvent) => e.type === 'salvageResult')).toHaveLength(1);

    // Disenchant.
    mark = fc.sent.length;
    cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server);
    for (const f of eventFrames(fc.sent, mark)) feed(client, f);
    const dencStash = server.sim.lastDisenchantResultFor(st.pid);
    expect(dencStash?.ok).toBe(true);
    expect(client.lastDisenchantResult).toEqual(dencStash);
    expect(queueOf(client).filter((e: SimEvent) => e.type === 'disenchantResult')).toHaveLength(1);

    // Apply enchant (the third weapon copy is still held; dust covers reagents).
    mark = fc.sent.length;
    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON, enchant: WEAPON_ENCHANT });
    routeTick(server);
    for (const f of eventFrames(fc.sent, mark)) feed(client, f);
    const enchStash = server.sim.lastEnchantResultFor(st.pid);
    expect(enchStash?.ok).toBe(true);
    expect(client.lastEnchantResult).toEqual(enchStash);
    expect(queueOf(client).filter((e: SimEvent) => e.type === 'enchantResult')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B. Identical consecutive denies: the delta suppresses, the event arm surfaces.
// ---------------------------------------------------------------------------
describe('result mirror: second identical deny rides the event arm alone', () => {
  it('two not_held salvage denies: no second salv delta, but a second salvageResult event lands', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 702, 'WireB');
    placeAt(server, st.pid, FIELD_POS);
    // Never grant the weapon: both salvage attempts deny not_held identically.

    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    broadcast(server);
    const snap1 = snapAfter(fc.sent);
    if (!snap1) throw new Error('no first snapshot');
    const denyStash = server.sim.lastSalvageResultFor(st.pid);
    expect(denyStash?.ok).toBe(false);
    expect(denyStash?.reason).toBe('not_held');
    expect(snap1.self.salv).toEqual(denyStash);

    const client = bareClient(st.pid);
    applySnap(client, snap1);
    expect(client.lastSalvageResult).toEqual(denyStash);

    // Second identical deny.
    const mark = fc.sent.length;
    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    broadcast(server);

    // Delta arm silent: the serialized stash is byte-identical, so maybe() skips
    // the salv key on the second snapshot.
    const snap2 = snapAfter(fc.sent, mark);
    if (!snap2) throw new Error('no second snapshot');
    expect('salv' in snap2.self).toBe(false);

    // Event arm alone surfaces the second deny: exactly one new pid-scoped
    // salvageResult, and feeding the real frames queues it for the HUD drain.
    const denies = eventsFor(fc.sent, 'salvageResult', mark);
    expect(denies).toHaveLength(1);
    if (denies[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(denies[0].reason).toBe('not_held');
    const qBefore = queueOf(client).filter((e: SimEvent) => e.type === 'salvageResult').length;
    for (const f of eventFrames(fc.sent, mark)) feed(client, f);
    applySnap(client, snap2);
    expect(queueOf(client).filter((e: SimEvent) => e.type === 'salvageResult')).toHaveLength(
      qBefore + 1,
    );
    expect(client.lastSalvageResult).toEqual(denyStash); // still the deny, never cleared
  });
});

// ---------------------------------------------------------------------------
// C. Ordering both ways in one client frame + the no-clear guarantee.
// ---------------------------------------------------------------------------
describe('result mirror: event/snapshot ordering never regresses the mirror', () => {
  it('event-then-snap and snap-then-event both settle on the authoritative value; a keyless snap preserves it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 703, 'WireC');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    broadcast(server);
    const frames = eventFrames(fc.sent);
    const snap = snapAfter(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastSalvageResultFor(st.pid);
    expect(stash?.ok).toBe(true);
    expect(snap.self.salv).toEqual(stash);

    // Order 1: event frame first, snapshot second (same client frame).
    const clientA = bareClient(st.pid);
    for (const f of frames) feed(clientA, f);
    expect(clientA.lastSalvageResult).toEqual(stash);
    applySnap(clientA, snap);
    expect(clientA.lastSalvageResult).toEqual(stash);

    // Order 2: snapshot first, event frame second.
    const clientB = bareClient(st.pid);
    applySnap(clientB, snap);
    expect(clientB.lastSalvageResult).toEqual(stash);
    for (const f of frames) feed(clientB, f);
    expect(clientB.lastSalvageResult).toEqual(stash);

    // No-clear: a later snapshot WITHOUT the salv key (unchanged stash, delta
    // suppressed) must not regress an event-set mirror to null/undefined.
    const mark = fc.sent.length;
    routeTick(server);
    broadcast(server);
    const snap2 = snapAfter(fc.sent, mark);
    if (!snap2) throw new Error('no follow-up snapshot');
    expect('salv' in snap2.self).toBe(false);
    const clientC = bareClient(st.pid);
    for (const f of frames) feed(clientC, f);
    applySnap(clientC, snap2);
    expect(clientC.lastSalvageResult).toEqual(stash);
  });
});

// ---------------------------------------------------------------------------
// D. Reconnect-style full snapshot: fresh lastSent re-ships every key.
// ---------------------------------------------------------------------------
describe('result mirror: reconnect full snapshot converges the mirror', () => {
  it('after resetting session.lastSent (the fresh-session shape) the next snap carries salv, ench, and an explicit denc null', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 704, 'WireD');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    broadcast(server); // normal session state: salv delta consumed here
    const stash = server.sim.lastSalvageResultFor(st.pid);
    expect(stash?.ok).toBe(true);
    expect(server.sim.lastDisenchantResultFor(st.pid)).toBeNull(); // never disenchanted

    // Reconnect-style: a fresh ClientSession starts with an empty lastSent, so
    // every maybe() key re-fires on its first snapshot.
    (st as unknown as { lastSent: Record<string, string> }).lastSent = {};
    const mark = fc.sent.length;
    broadcast(server);
    const full = snapAfter(fc.sent, mark);
    if (!full) throw new Error('no full snapshot');
    expect(full.self.salv).toEqual(stash);
    expect('denc' in full.self).toBe(true);
    expect(full.self.denc).toBeNull();

    const client = bareClient(st.pid);
    applySnap(client, full);
    expect(client.lastSalvageResult).toEqual(stash);
    expect(client.lastDisenchantResult).toBeNull(); // explicitly null, not left undefined
  });
});

// ---------------------------------------------------------------------------
// E. Throttled apply_enchant attribution (the missing third direction).
// ---------------------------------------------------------------------------
describe('result mirror: throttled apply_enchant surfaces via enchantResult/ench only', () => {
  it('a valid enchant attempt on a spent window denies with enchantResult throttled, sibling surfaces untouched', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 705, 'WireE');
    placeAt(server, st.pid, FIELD_POS);
    // 11 weapons: 10 burn the shared window (5 salvage + 5 disenchant), 1 stays
    // held as the enchant target. 5 dust covers the enchant reagents, so every
    // pre-throttle check passes and the deny is genuinely the throttle.
    server.sim.addItem(COMMON_WEAPON, CRAFT_THROTTLE_MAX_PER_WINDOW + 1, st.pid);
    server.sim.addItem(DUST, 5, st.pid);

    const half = CRAFT_THROTTLE_MAX_PER_WINDOW / 2;
    for (let i = 0; i < half; i++) cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW - half; i++)
      cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server); // drain the burn's events
    const preSalv = server.sim.lastSalvageResultFor(st.pid);
    const preDenc = server.sim.lastDisenchantResultFor(st.pid);
    expect(preSalv?.ok).toBe(true);
    expect(preDenc?.ok).toBe(true);
    const dustBefore = server.sim.countItem(DUST, st.pid);
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(1);
    const mark = fc.sent.length;

    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON, enchant: WEAPON_ENCHANT });
    routeTick(server);

    // Exactly one enchantResult, reason throttled; ZERO sibling events.
    const ench = eventsFor(fc.sent, 'enchantResult', mark);
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(false);
    expect(ench[0].reason).toBe('throttled');
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);
    expect(eventsFor(fc.sent, 'disenchantResult', mark)).toEqual([]);
    expect(eventsFor(fc.sent, 'salvageResult', mark)).toEqual([]);

    // Sibling stashes untouched; nothing consumed by the throttled attempt.
    expect(server.sim.lastEnchantResultFor(st.pid)?.reason).toBe('throttled');
    expect(server.sim.lastSalvageResultFor(st.pid)).toEqual(preSalv);
    expect(server.sim.lastDisenchantResultFor(st.pid)).toEqual(preDenc);
    expect(server.sim.countItem(DUST, st.pid)).toBe(dustBefore);
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(1);

    // Convergence arm: the ench delta decodes onto the right mirror and the
    // sibling mirrors receive their own (pre-mark) values, not the deny.
    broadcast(server);
    const snap = snapAfter(fc.sent, mark);
    if (!snap) throw new Error('no snapshot');
    const client = bareClient(st.pid);
    applySnap(client, snap);
    expect(client.lastEnchantResult?.ok).toBe(false);
    expect(client.lastEnchantResult?.reason).toBe('throttled');
    expect(client.lastSalvageResult).toEqual(preSalv);
    expect(client.lastDisenchantResult).toEqual(preDenc);
  });
});
