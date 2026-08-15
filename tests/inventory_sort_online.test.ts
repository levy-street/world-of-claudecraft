// The EXECUTED server arm for inv_sort (the source pins in
// tests/inventory_sort.test.ts hold the declaration text; these cases drive
// the real receive path): a live in-process GameServer (the
// tests/professions_destroy_trade_races.test.ts recipe), asserting that the
// command survives dispatch, that HEAVY_SELF_CMDS membership marks the self
// mirror dirty so the tidied inventory actually reaches the online client,
// and that the two staged-state races the sort's consolidation splice can
// reach (an open trade offer, a slot-pinned disenchant cast) resolve without
// creating, destroying, or misdirecting a single unit.
import { describe, expect, it, vi } from 'vitest';
import { completeEnchantFamilyCast } from './helpers/enchant_family_cast';

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
import type { PlayerMeta } from '../src/sim/sim';
import type { InvSlot, SimEvent } from '../src/sim/types';

const SWORD = 'eastbrook_arming_sword'; // common gear: a valid disenchant victim
const DUST = 'arcane_dust';
const ORE = 'copper_ore';

const FIELD_A = { x: 0, z: 150 };
const FIELD_B = { x: 3, z: 150 };

type WireMsg = { t: string; list?: SimEvent[]; [k: string]: unknown };

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
    server.sim as unknown as {
      entities: Map<number, { pos: { x: number; z: number }; prevPos?: unknown }>;
    }
  ).entities.get(pid);
  if (!entity) throw new Error(`no entity for pid ${pid}`);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { x: pos.x, z: pos.z };
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

// Tick and route, then flush every player's enchant-family cast and route
// again: the race suite's routeTick, so a cast-paced disenchant resolves
// inside one call.
function routeTick(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
  for (const pid of server.sim.players.keys()) {
    completeEnchantFamilyCast(server.sim as never, pid);
  }
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

// One tick with NO cast flush: the arm where the disenchant cast is still
// running when the next command lands.
function tickCastLive(server: GameServer): void {
  (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(server.sim.tick());
}

function eventsFor(sent: WireMsg[], type: SimEvent['type']): SimEvent[] {
  return sent
    .filter((m) => m.t === 'events')
    .flatMap((m) => m.list ?? [])
    .filter((ev) => ev.type === type);
}

function serverInv(server: GameServer, pid: number): InvSlot[] {
  const meta = (server.sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid);
  if (!meta) throw new Error(`no meta for pid ${pid}`);
  return meta.inventory;
}

describe('inv_sort over the real online dispatch path', () => {
  it('consolidates, stamps hints, and the tidied inventory rides the heavy self snapshot', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 801, 'Sorter');
    const pid = session.pid as number;
    const inv = serverInv(server, pid);
    inv.length = 0; // drop the starter provisions so the counts below are exact
    inv.push({ itemId: 'baked_bread', count: 2 });
    server.sim.addItem(SWORD, 1, pid);
    inv.push({ itemId: 'baked_bread', count: 3 });

    // The membership claim, behaviorally: receipt of the command alone marks
    // the self mirror dirty (drop inv_sort from HEAVY_SELF_CMDS and this flag
    // stays false while the offline host still looks perfect).
    (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
    cmd(server, session, { cmd: 'inv_sort' });
    expect((session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty).toBe(true);

    routeTick(server);
    // The world loop, not the event router, is what sends snapshots; drive
    // one broadcast pass explicitly (the bandwidth/afk_wire rig idiom) so the
    // dirty flag set above is what ships the heavy self block.
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();

    // Server-side: merged and hint-stamped (gear leads, bread follows).
    const bread = inv.filter((s) => s.itemId === 'baked_bread');
    expect(bread).toHaveLength(1);
    expect(bread[0]?.count).toBe(5);
    expect(inv.find((s) => s.itemId === SWORD)?.slot).toBe(0);
    expect(bread[0]?.slot).toBe(1);

    // Client-side: the tidied array (cell hints included) actually arrived.
    // Heavy fields ride inside the snapshot's `self` object (the
    // `"self":<selfJson>` envelope, server/game.ts broadcastSnapshots).
    const selfOf = (m: WireMsg): { inv?: InvSlot[] } | undefined =>
      m.self as { inv?: InvSlot[] } | undefined;
    const snapshots = fc.sent.filter((m) => selfOf(m)?.inv !== undefined);
    expect(snapshots.length).toBeGreaterThan(0);
    const mirrored = selfOf(snapshots.at(-1) as WireMsg)?.inv as InvSlot[];
    expect(mirrored.find((s) => s.itemId === SWORD)?.slot).toBe(0);
    const mirroredBread = mirrored.filter((s) => s.itemId === 'baked_bread');
    expect(mirroredBread).toHaveLength(1);
    expect(mirroredBread[0]).toMatchObject({ count: 5, slot: 1 });
  });

  it('a sort between offer and confirm never breaks a staged trade (itemId-keyed revalidation)', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const a = joinServer(server, fcA, 803, 'Racer');
    const b = joinServer(server, fcB, 804, 'Counter');
    placeAt(server, a.pid as number, FIELD_A);
    placeAt(server, b.pid as number, FIELD_B);

    const invA = serverInv(server, a.pid as number);
    invA.length = 0;
    invA.push({ itemId: ORE, count: 5 });
    invA.push({ itemId: ORE, count: 5 });
    server.sim.addItem(SWORD, 1, a.pid as number); // sits AFTER the ore donors

    cmd(server, a, { cmd: 'trade_req', id: b.pid });
    cmd(server, b, { cmd: 'trade_accept' });
    cmd(server, a, { cmd: 'trade_offer', items: [{ itemId: SWORD, count: 1 }] });
    // The consolidation splice: the second ore donates into the first and is
    // spliced out, shifting the staged sword's array index down by one.
    cmd(server, a, { cmd: 'inv_sort' });
    cmd(server, a, { cmd: 'trade_confirm' });
    cmd(server, b, { cmd: 'trade_confirm' });
    routeTick(server);

    // The swap completed on the itemId key: exactly one sword total, now B's.
    expect(server.sim.countItem(SWORD, b.pid as number)).toBe(1);
    expect(server.sim.countItem(SWORD, a.pid as number)).toBe(0);
    // And the consolidation neither created nor destroyed a unit of ore.
    expect(server.sim.countItem(ORE, a.pid as number)).toBe(10);
  });

  it('a sort mid-disenchant-cast denies not_held instead of destroying a shifted copy', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 806, 'Pinner');
    const pid = session.pid as number;
    const inv = serverInv(server, pid);
    inv.length = 0;
    inv.push({ itemId: ORE, count: 5 });
    inv.push({ itemId: ORE, count: 5 });
    server.sim.addItem(SWORD, 1, pid); // index 2, the slot the cast pins

    cmd(server, session, { cmd: 'disenchant_item', item: SWORD, slot: 2 });
    tickCastLive(server); // the cast is running, not yet complete
    // The splice: ore consolidates to one stack, the array shrinks, and
    // nothing sits at the pinned index 2 anymore.
    cmd(server, session, { cmd: 'inv_sort' });
    routeTick(server); // completes the cast, which re-checks the victim pin

    const results = eventsFor(fc.sent, 'disenchantResult');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, reason: 'not_held' });
    // The sword survived intact and nothing was granted for it.
    expect(server.sim.countItem(SWORD, pid)).toBe(1);
    expect(server.sim.countItem(DUST, pid)).toBe(0);
    expect(server.sim.countItem(ORE, pid)).toBe(10);
  });
});
