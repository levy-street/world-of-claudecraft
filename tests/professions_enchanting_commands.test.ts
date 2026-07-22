// Phase 13 enchanting COMMANDS across both worlds (the seam the content wave
// left un-wired): the Sim command methods (disenchantItem/applyEnchant/
// salvageItem) each stash their outcome AND emit their pid-scoped, text-free
// event exactly once; the live GameServer routes disenchant_item/apply_enchant/
// salvage_item to the sim resolver and mirrors the outcome back over BOTH the
// pid-scoped event (immediacy) and the denc/ench/salv self-delta (convergence);
// and the ClientWorld read surface (lastDisenchantResult/lastEnchantResult/
// lastSalvageResult) updates from each arm. The #2033 stub-trap class: a dropped
// wire case or a stripped reason leaves every offline resolver test green, so the
// online routing arm is load-bearing. The stash/round-trip codec is additionally
// pinned in tests/snapshots.test.ts; the resolver semantics in
// tests/professions_enchanting.test.ts and tests/professions_typed_reagents.test.ts.
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
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { PlayerClass, SimEvent } from '../src/sim/types';

// A common-quality one-hand weapon: disenchants to arcane_dust with NO typed
// secondary, salvages to bone_fragments, and takes the mainhand Might enchant.
const COMMON_WEAPON = 'eastbrook_arming_sword';
// A rare mace: disenchants to a FIXED single arcane_essence primary PLUS one
// typed, bind-on-trade secondary (resonant_steel), zero rng draws. Pinned in
// tests/professions_typed_reagents.test.ts.
const RARE_WEAPON = 'moggers_copper_cudgel';
const RARE_PRIMARY = 'arcane_essence';
const RARE_SECONDARY = 'resonant_steel';
// enchant_weapon_might: itemSlot 'mainhand', reagents 5x arcane_dust, str +5.
const WEAPON_ENCHANT = 'enchant_weapon_might';
// A helmet enchant, used to exercise the wrong_slot deny on the weapon above.
const HELMET_ENCHANT = 'enchant_helmet_fortitude';
const DUST = 'arcane_dust';

const makeSim = (seed = 7): Sim => new Sim({ seed, playerClass: 'warrior', autoEquip: false });

function eventsOfType(events: SimEvent[], type: SimEvent['type']): SimEvent[] {
  return events.filter((ev) => ev.type === type);
}

// ---------------------------------------------------------------------------
// Offline Sim: the command methods stash + emit exactly once, both arms.
// ---------------------------------------------------------------------------
describe('offline Sim enchanting commands: stash + single pid-scoped emit', () => {
  it('salvageItem stashes lastSalvageResult and emits salvageResult exactly once (success)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const salv = eventsOfType(sim.drainEvents(), 'salvageResult');
    expect(salv).toHaveLength(1);
    if (salv[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salv[0].ok).toBe(true);
    expect(salv[0].itemId).toBe(COMMON_WEAPON);
    expect(salv[0].materialItemId).toBe('bone_fragments');
    expect(salv[0].count).toBeGreaterThan(0);
    expect(salv[0].pid).toBe(pid);
    // The stash mirrors the event's payload.
    expect(sim.lastSalvageResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: salv[0].count,
    });
    expect(sim.lastSalvageResultFor(pid)).toEqual(sim.lastSalvageResult);
  });

  it('disenchantItem emits the typed secondary on a rare+ piece (fixed primary, one secondary)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(RARE_WEAPON, 1, pid);
    sim.drainEvents();
    sim.disenchantItem(RARE_WEAPON, pid);
    const denc = eventsOfType(sim.drainEvents(), 'disenchantResult');
    expect(denc).toHaveLength(1);
    if (denc[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc[0].ok).toBe(true);
    expect(denc[0].itemId).toBe(RARE_WEAPON);
    expect(denc[0].materialItemId).toBe(RARE_PRIMARY);
    expect(denc[0].count).toBe(1);
    expect(denc[0].secondaryItemId).toBe(RARE_SECONDARY);
    expect(denc[0].secondaryCount).toBe(1);
    expect(denc[0].pid).toBe(pid);
    expect(sim.lastDisenchantResult).toEqual({
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
    });
    // The typed secondary rode ctx.addItemInstance with { bindOnTrade: true }.
    const secondarySlot = sim.inventory.find((s) => s.itemId === RARE_SECONDARY);
    expect(secondarySlot?.instance?.bindOnTrade).toBe(true);
  });

  it('a sub-rare disenchant carries no secondary fields', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.drainEvents();
    sim.disenchantItem(COMMON_WEAPON, pid);
    const denc = eventsOfType(sim.drainEvents(), 'disenchantResult')[0];
    if (denc?.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc.ok).toBe(true);
    expect(denc.materialItemId).toBe(DUST);
    expect(denc.secondaryItemId).toBeUndefined();
    expect(denc.secondaryCount).toBeUndefined();
  });

  it('applyEnchant stashes lastEnchantResult and emits enchantResult exactly once (success)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.addItem(DUST, 5, pid);
    sim.drainEvents();
    sim.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, pid);
    const ench = eventsOfType(sim.drainEvents(), 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].itemId).toBe(COMMON_WEAPON);
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);
    expect(ench[0].reason).toBeUndefined();
    expect(ench[0].pid).toBe(pid);
    expect(sim.lastEnchantResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
    });
  });

  it('a deny surfaces the reason through BOTH the event and the stash, inventory untouched', () => {
    const sim = makeSim();
    const pid = sim.playerId;

    // salvage of a not-held item.
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const salvDeny = eventsOfType(sim.drainEvents(), 'salvageResult')[0];
    if (salvDeny?.type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salvDeny.ok).toBe(false);
    expect(salvDeny.reason).toBe('not_held');
    expect(sim.lastSalvageResult?.reason).toBe('not_held');

    // wrong_slot enchant deny: the sword is held but the enchant targets a helmet.
    sim.addItem(COMMON_WEAPON, 1, pid);
    sim.addItem(DUST, 5, pid);
    sim.drainEvents();
    sim.applyEnchant(COMMON_WEAPON, HELMET_ENCHANT, pid);
    const wrongSlot = eventsOfType(sim.drainEvents(), 'enchantResult')[0];
    if (wrongSlot?.type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(wrongSlot.ok).toBe(false);
    expect(wrongSlot.reason).toBe('wrong_slot');
    expect(sim.lastEnchantResult?.reason).toBe('wrong_slot');
    // ok:false left the inventory untouched: sword and dust still held.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
    expect(sim.countItem(DUST, pid)).toBe(5);

    // insufficient_materials enchant deny (sword held, no dust).
    const sim2 = makeSim(11);
    const pid2 = sim2.playerId;
    sim2.addItem(COMMON_WEAPON, 1, pid2);
    sim2.drainEvents();
    sim2.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, pid2);
    const shortMats = eventsOfType(sim2.drainEvents(), 'enchantResult')[0];
    if (shortMats?.type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(shortMats.reason).toBe('insufficient_materials');
    expect(sim2.countItem(COMMON_WEAPON, pid2)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Replay / dup safety + the shared-window throttle boundary.
// ---------------------------------------------------------------------------
describe('offline Sim enchanting commands: replay + throttle safety', () => {
  it('running the same command twice with one held copy destroys once, second is not_held', () => {
    for (const kind of ['salvage', 'disenchant', 'enchant'] as const) {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.addItem(COMMON_WEAPON, 1, pid);
      if (kind === 'enchant') sim.addItem(DUST, 10, pid); // enough for two applies if it re-granted

      const run = () => {
        if (kind === 'salvage') sim.salvageItem(COMMON_WEAPON, pid);
        else if (kind === 'disenchant') sim.disenchantItem(COMMON_WEAPON, pid);
        else sim.applyEnchant(COMMON_WEAPON, WEAPON_ENCHANT, pid);
      };

      run();
      // The one held copy was consumed exactly once. salvage/disenchant destroy
      // the piece outright (0 left); enchant transforms it into an enchanted
      // instance of the SAME itemId (total stays 1, but it is no longer eligible),
      // so a replay still can never re-consume it.
      if (kind === 'enchant') {
        expect(sim.countItem(COMMON_WEAPON, pid), kind).toBe(1);
        expect(sim.countEnchantableItem(COMMON_WEAPON, pid), kind).toBe(0);
      } else {
        expect(sim.countItem(COMMON_WEAPON, pid), kind).toBe(0);
      }
      const first =
        kind === 'salvage'
          ? sim.lastSalvageResult
          : kind === 'disenchant'
            ? sim.lastDisenchantResult
            : sim.lastEnchantResult;
      expect(first?.ok, kind).toBe(true);

      sim.drainEvents();
      run();
      // The second command finds nothing to act on: exactly one not_held deny,
      // no second destruction or grant.
      const second =
        kind === 'salvage'
          ? sim.lastSalvageResult
          : kind === 'disenchant'
            ? sim.lastDisenchantResult
            : sim.lastEnchantResult;
      expect(second?.ok, kind).toBe(false);
      expect(second?.reason, kind).toBe('not_held');
    }
  });

  it('the (MAX+1)th action in the 60s window denies throttled BEFORE any inventory change', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // One more copy than the shared window allows, all held at once (no sim.tick,
    // so sim.time never advances the window).
    const copies = CRAFT_THROTTLE_MAX_PER_WINDOW + 1;
    sim.addItem(COMMON_WEAPON, copies, pid);

    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) {
      sim.salvageItem(COMMON_WEAPON, pid);
      expect(sim.lastSalvageResult?.ok, `salvage #${i + 1}`).toBe(true);
    }
    // Exactly at the boundary (the 12b lesson: assert AT the boundary): the
    // budget is spent, so the next action denies with no consumption.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
    sim.drainEvents();
    sim.salvageItem(COMMON_WEAPON, pid);
    const throttled = eventsOfType(sim.drainEvents(), 'salvageResult')[0];
    if (throttled?.type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(throttled.ok).toBe(false);
    expect(throttled.reason).toBe('throttled');
    // The throttled action consumed nothing: the last copy is still held.
    expect(sim.countItem(COMMON_WEAPON, pid)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Live GameServer wire routing: each command routes to the sim resolver and the
// outcome returns over BOTH the pid-scoped event AND the self-delta, and lands
// in a real ClientWorld read surface. Modeled on
// tests/professions_training_online.test.ts + tests/snapshots.test.ts.
// ---------------------------------------------------------------------------
const FIELD_POS = { x: 0, z: 150 };

function fakeWs(): { sent: { t: string; list?: SimEvent[]; [k: string]: unknown }[]; ws: unknown } {
  const sent: { t: string; list?: SimEvent[] }[] = [];
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

function lastSnap(sent: { t: string; self?: any }[]): { self: Record<string, unknown> } | null {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i] as any;
  return null;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function eventsFor(sent: { t: string; list?: SimEvent[] }[], type: SimEvent['type']): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
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

function metaOf(server: GameServer, pid: number): PlayerMeta {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta;
}

describe('enchanting commands over the live GameServer wire (event + delta routing)', () => {
  it('disenchant_item routes the pid-scoped event AND the denc delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const fcOther = fakeWs();
    const st = joinServer(server, fc, 401, 'Dis');
    joinServer(server, fcOther, 402, 'Bystander');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: COMMON_WEAPON });
    routeTick(server);

    // Immediacy arm: exactly one pid-scoped disenchantResult, owner only.
    const denc = eventsFor(fc.sent, 'disenchantResult');
    expect(denc).toHaveLength(1);
    if (denc[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc[0].ok).toBe(true);
    expect(denc[0].pid).toBe(st.pid);
    expect(eventsFor(fcOther.sent, 'disenchantResult')).toEqual([]);

    // Convergence arm: the denc self-delta mirrors the server stash, and a real
    // ClientWorld decodes it onto lastDisenchantResult.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastDisenchantResultFor(st.pid);
    expect(snap.self.denc).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastDisenchantResult).toEqual(stash);
  });

  it('apply_enchant routes the enchantResult event AND the ench delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 403, 'Ench');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    server.sim.addItem(DUST, 5, st.pid);

    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON, enchant: WEAPON_ENCHANT });
    routeTick(server);

    const ench = eventsFor(fc.sent, 'enchantResult');
    expect(ench).toHaveLength(1);
    if (ench[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(ench[0].ok).toBe(true);
    expect(ench[0].enchantId).toBe(WEAPON_ENCHANT);
    expect(ench[0].pid).toBe(st.pid);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastEnchantResultFor(st.pid);
    expect(snap.self.ench).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastEnchantResult).toEqual(stash);
  });

  it('salvage_item routes the salvageResult event AND the salv delta into a ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 404, 'Salv');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);

    const salv = eventsFor(fc.sent, 'salvageResult');
    expect(salv).toHaveLength(1);
    if (salv[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salv[0].ok).toBe(true);
    expect(salv[0].pid).toBe(st.pid);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const stash = server.sim.lastSalvageResultFor(st.pid);
    expect(snap.self.salv).toEqual(stash);
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    expect(client.lastSalvageResult).toEqual(stash);
  });

  it('a malformed command (missing/wrong-typed field) is ignored: no crash, no event', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 405, 'Fuzzer');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: 42 });
    cmd(server, st, { cmd: 'apply_enchant', item: COMMON_WEAPON }); // enchant missing
    cmd(server, st, { cmd: 'salvage_item' }); // item missing
    routeTick(server);

    expect(eventsFor(fc.sent, 'disenchantResult')).toEqual([]);
    expect(eventsFor(fc.sent, 'enchantResult')).toEqual([]);
    expect(eventsFor(fc.sent, 'salvageResult')).toEqual([]);
    // No side effect: the piece is still held (nothing was consumed).
    expect(server.sim.countItem(COMMON_WEAPON, st.pid)).toBe(1);
  });

  it('a rare disenchant online mirrors the typed secondary into the client inventory as a bind-on-trade stack', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 406, 'Rarely');
    placeAt(server, st.pid, FIELD_POS);
    server.sim.addItem(RARE_WEAPON, 1, st.pid);

    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    routeTick(server);

    const denc = eventsFor(fc.sent, 'disenchantResult')[0];
    if (denc?.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(denc.secondaryItemId).toBe(RARE_SECONDARY);
    expect(denc.secondaryCount).toBe(1);

    // The loot event marks the session heavy-dirty, so the self inventory
    // refreshes (exactly like a craft): the mirrored client inventory carries the
    // typed secondary as an instanced stack with bindOnTrade set. Wire data
    // minimization is asymmetric on purpose: the OWNER must see their own payload
    // in full (the self `inv` mirror is unfiltered), so bindOnTrade survives here.
    // Only the FOREIGN inspect path (server/game.ts eqi allowlist) strips it, which
    // the "strips non-cosmetic instance fields" pin in tests/snapshots.test.ts
    // guards for boundTo/charges/bindOnTrade alike.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    const client = bareClient(st.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snap);
    const secondarySlot = client.inventory.find((s) => s.itemId === RARE_SECONDARY);
    expect(secondarySlot?.instance?.bindOnTrade).toBe(true);
    expect(client.inventory.some((s) => s.itemId === RARE_PRIMARY)).toBe(true);
    // The rare piece was consumed.
    expect(server.sim.countItem(RARE_WEAPON, st.pid)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ClientWorld liveness: the command SEND arm (right wire tokens) and the EVENT
// mirror arm (immediacy), independent of the delta path proven above.
// ---------------------------------------------------------------------------
describe('ClientWorld enchanting members are live (send + event mirror)', () => {
  it('the command methods send the exact wire tokens', () => {
    const prevWs = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = { OPEN: 1 };
    try {
      const sent: unknown[] = [];
      const c: any = Object.create(ClientWorld.prototype);
      c.connected = true;
      c.spectating = null;
      c.ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
      const client = c as ClientWorld;
      client.disenchantItem('sword_x');
      client.applyEnchant('sword_x', 'ench_y');
      client.salvageItem('sword_z');
      expect(sent).toEqual([
        { t: 'cmd', cmd: 'disenchant_item', item: 'sword_x' },
        { t: 'cmd', cmd: 'apply_enchant', item: 'sword_x', enchant: 'ench_y' },
        { t: 'cmd', cmd: 'salvage_item', item: 'sword_z' },
      ]);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = prevWs;
    }
  });

  it('the event mirror arm updates lastX from the pid-scoped event (immediacy, no delta)', () => {
    const client = bareClient(1);
    const internals = client as unknown as {
      applyDisenchantResultEvent(ev: SimEvent): void;
      applyEnchantResultEvent(ev: SimEvent): void;
      applySalvageResultEvent(ev: SimEvent): void;
    };
    expect(client.lastDisenchantResult).toBeUndefined(); // bareClient skips field init

    internals.applyDisenchantResultEvent({
      type: 'disenchantResult',
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
      pid: 1,
    });
    expect(client.lastDisenchantResult).toEqual({
      ok: true,
      itemId: RARE_WEAPON,
      materialItemId: RARE_PRIMARY,
      count: 1,
      secondaryItemId: RARE_SECONDARY,
      secondaryCount: 1,
    });

    internals.applyEnchantResultEvent({
      type: 'enchantResult',
      ok: false,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
      reason: 'insufficient_materials',
      pid: 1,
    });
    expect(client.lastEnchantResult).toEqual({
      ok: false,
      itemId: COMMON_WEAPON,
      enchantId: WEAPON_ENCHANT,
      reason: 'insufficient_materials',
    });

    internals.applySalvageResultEvent({
      type: 'salvageResult',
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: 3,
      pid: 1,
    });
    expect(client.lastSalvageResult).toEqual({
      ok: true,
      itemId: COMMON_WEAPON,
      materialItemId: 'bone_fragments',
      count: 3,
    });
  });
});
