// The real-behavior end-to-end arc.
// Exercises the three commands through the surfaces a player reaches:
// offline Sim through the IWorld surface, then online through a live in-process
// GameServer (harness modeled on tests/professions_bind_on_trade_online.test.ts).
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
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { InvSlot, PlayerClass, SimEvent } from '../src/sim/types';

const RARE_WEAPON = 'moggers_copper_cudgel'; // rare mace -> resonant_steel
const COMMON_WEAPON = 'eastbrook_arming_sword';
const ENCHANT = 'enchant_weapon_runed_edge'; // essence x2 + resonant_steel x1
const ESSENCE = 'arcane_essence';
const SECONDARY = 'resonant_steel';

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

describe('offline Sim end-to-end (IWorld surface)', () => {
  it('disenchants a rare (typed secondary), applies a Runed enchant, salvages, with lastX mirrors', () => {
    const sim = new Sim({ seed: 20260721, playerClass: 'warrior', autoEquip: false });
    const inv = () => sim.ctx.resolve()?.meta.inventory ?? [];

    // 1. Rare disenchant: fixed 1 essence + exactly 1 armed resonant_steel.
    const essenceBefore = sim.countItem(ESSENCE);
    sim.addItem(RARE_WEAPON, 1);
    sim.disenchantItem(RARE_WEAPON);
    const denc = sim.lastDisenchantResult;
    expect(denc?.ok).toBe(true);
    expect(denc?.materialItemId).toBe(ESSENCE);
    expect(denc?.count).toBe(1);
    expect(denc?.secondaryItemId).toBe(SECONDARY);
    expect(denc?.secondaryCount).toBe(1);
    expect(sim.countItem(ESSENCE)).toBe(essenceBefore + 1);
    const steelSlot = inv().find((s) => s.itemId === SECONDARY);
    expect(steelSlot?.instance?.bindOnTrade).toBe(true);
    expect(steelSlot?.instance?.boundTo).toBeUndefined();
    expect(sim.countItem(RARE_WEAPON)).toBe(0);

    // Replay of the same action cannot double-grant: item is gone -> not_held.
    sim.disenchantItem(RARE_WEAPON);
    expect(sim.lastDisenchantResult?.ok).toBe(false);
    expect(sim.lastDisenchantResult?.reason).toBe('not_held');
    expect(sim.countItem(ESSENCE)).toBe(essenceBefore + 1);
    expect(sim.countItem(SECONDARY)).toBe(1);

    // 2. Apply the Runed enchant: essence x2 + steel x1 consumed, copy enchanted.
    sim.addItem(RARE_WEAPON, 1);
    sim.addItem(ESSENCE, 2);
    const essencePre = sim.countItem(ESSENCE);
    sim.applyEnchant(RARE_WEAPON, ENCHANT);
    const ench = sim.lastEnchantResult;
    expect(ench?.ok).toBe(true);
    expect(ench?.enchantId).toBe(ENCHANT);
    expect(sim.countItem(ESSENCE)).toBe(essencePre - 2);
    expect(sim.countItem(SECONDARY)).toBe(0);
    expect(sim.countItem(RARE_WEAPON)).toBe(1);
    const enchanted = inv().find(
      (s) => s.itemId === RARE_WEAPON && s.instance?.enchant === ENCHANT,
    );
    expect(enchanted).toBeTruthy();

    // 3. Salvage a common weapon: materials granted, item consumed.
    sim.addItem(COMMON_WEAPON, 1);
    sim.salvageItem(COMMON_WEAPON);
    const salv = sim.lastSalvageResult;
    expect(salv?.ok).toBe(true);
    expect(salv?.materialItemId).toBeTruthy();
    expect(salv?.count ?? 0).toBeGreaterThan(0);
    if (salv?.materialItemId) {
      expect(sim.countItem(salv.materialItemId)).toBeGreaterThan(0);
    }
    expect(sim.countItem(COMMON_WEAPON)).toBe(0);
  });
});

describe('online end-to-end (live GameServer, wire commands + self-deltas)', () => {
  it('resolves the three commands server-side and mirrors denc/ench/salv into a real ClientWorld', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const st = joinServer(server, fc, 701, 'QaCorrect');
    placeAt(server, st.pid, { x: 0, z: 150 });

    // Disenchant a rare over the wire.
    server.sim.addItem(RARE_WEAPON, 1, st.pid);
    const essenceBefore = server.sim.countItem(ESSENCE, st.pid);
    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    routeTick(server);
    const dencEvents = eventsFor(fc.sent, 'disenchantResult');
    expect(dencEvents.length).toBe(1);
    const dev = dencEvents[0];
    if (dev.type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(dev.ok).toBe(true);
    expect(dev.secondaryItemId).toBe(SECONDARY);
    expect(dev.pid).toBe(st.pid);
    expect(server.sim.countItem(ESSENCE, st.pid)).toBe(essenceBefore + 1);

    // Duplicated command: denied server-side, no double grant.
    const mark = fc.sent.length;
    cmd(server, st, { cmd: 'disenchant_item', item: RARE_WEAPON });
    routeTick(server);
    const dup = eventsFor(fc.sent, 'disenchantResult', mark);
    expect(dup.length).toBe(1);
    if (dup[0].type !== 'disenchantResult') throw new Error('expected disenchantResult');
    expect(dup[0].ok).toBe(false);
    expect(dup[0].reason).toBe('not_held');
    expect(server.sim.countItem(ESSENCE, st.pid)).toBe(essenceBefore + 1);
    expect(server.sim.countItem(SECONDARY, st.pid)).toBe(1);

    // Apply enchant over the wire (essence x2 + the disenchanted steel).
    server.sim.addItem(RARE_WEAPON, 1, st.pid);
    server.sim.addItem(ESSENCE, 2, st.pid);
    cmd(server, st, { cmd: 'apply_enchant', item: RARE_WEAPON, enchant: ENCHANT });
    routeTick(server);
    const enchEvents = eventsFor(fc.sent, 'enchantResult');
    expect(enchEvents.length).toBe(1);
    if (enchEvents[0].type !== 'enchantResult') throw new Error('expected enchantResult');
    expect(enchEvents[0].ok).toBe(true);
    expect(server.sim.countItem(SECONDARY, st.pid)).toBe(0);
    const enchSlot = serverInv(server, st.pid).find(
      (s) => s.itemId === RARE_WEAPON && s.instance?.enchant === ENCHANT,
    );
    expect(enchSlot).toBeTruthy();

    // Salvage over the wire.
    server.sim.addItem(COMMON_WEAPON, 1, st.pid);
    cmd(server, st, { cmd: 'salvage_item', item: COMMON_WEAPON });
    routeTick(server);
    const salvEvents = eventsFor(fc.sent, 'salvageResult');
    expect(salvEvents.length).toBe(1);
    if (salvEvents[0].type !== 'salvageResult') throw new Error('expected salvageResult');
    expect(salvEvents[0].ok).toBe(true);

    // Convergence arm: the denc/ench/salv self-deltas land on a real ClientWorld.
    broadcast(server);
    const snap = lastSnap(fc.sent);
    if (!snap) throw new Error('no snapshot');
    expect(snap.self.denc).toEqual(server.sim.lastDisenchantResultFor(st.pid));
    expect(snap.self.ench).toEqual(server.sim.lastEnchantResultFor(st.pid));
    expect(snap.self.salv).toEqual(server.sim.lastSalvageResultFor(st.pid));
    const client = bareClient(st.pid);
    applySnap(client, snap);
    expect(client.lastDisenchantResult).toEqual(server.sim.lastDisenchantResultFor(st.pid));
    expect(client.lastEnchantResult).toEqual(server.sim.lastEnchantResultFor(st.pid));
    expect(client.lastSalvageResult).toEqual(server.sim.lastSalvageResultFor(st.pid));
    expect(client.lastEnchantResult?.ok).toBe(true);
    expect(client.lastSalvageResult?.ok).toBe(true);
  });
});
