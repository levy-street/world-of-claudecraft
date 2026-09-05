import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

import { GameServer } from '../server/game';
import { HEAVY_SELF_CMDS, HEAVY_SELF_EVENTS } from '../server/heavy_self';
import { parsePerfectingSwapCommand } from '../server/perfecting_swap_command';
import { perfectingSwapCommand } from '../src/net/perfecting_swap_command';
import { STATIONS } from '../src/sim/content/professions';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import type { PerfectingSwapRequest } from '../src/sim/professions/perfecting_swap';
import type { SimEvent } from '../src/sim/types';
import { COMMAND_FACETS, COMMAND_NAMES } from '../src/world_api';
import { bareClient, broadcast, fakeWs, joinServer, lastSnap } from './helpers/bare_client';

const CHEST = 'crucible_str_mail_chest';
const WAIST = 'crucible_str_mail_waist';
const pinned = { pin: 'a'.repeat(32), anchor: { ordinal: 0, count: 1 } };
const wireSource = { bag: 0, item: CHEST, copy: pinned };
const wireTarget = { slot: 'waist', copy: { pin: 'b'.repeat(32) } };

beforeEach(() => vi.stubGlobal('WebSocket', { OPEN: 1 }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rank exchange wire boundary', () => {
  it('registers the command, owning facet and personal heavy result', () => {
    expect(COMMAND_NAMES).toContain('swap_perfecting_ranks');
    expect(COMMAND_FACETS).toHaveProperty('swap_perfecting_ranks', 'IWorldProfessions');
    expect(HEAVY_SELF_CMDS.has('swap_perfecting_ranks')).toBe(true);
    expect(HEAVY_SELF_EVENTS.has('perfectingSwapResult')).toBe(true);
  });

  it('parses two explicit pinned copies without trusting rank or owner fields', () => {
    expect(parsePerfectingSwapCommand({ source: wireSource, target: wireTarget, rank: 4, pid: 9 })).toEqual({
      source: { bag: 0, itemId: CHEST, copy: pinned },
      target: wireTarget,
    });
  });

  it.each([
    null, [], {}, { source: null, target: wireTarget },
    { source: wireSource, target: [] },
    { source: { bag: 0, item: CHEST }, target: wireTarget },
    { source: wireSource, target: { slot: 'waist' } },
    { source: { ...wireSource, copy: { pin: 'x' } }, target: wireTarget },
    { source: { ...wireSource, copy: { pin: 'a'.repeat(32) } }, target: wireTarget },
    { source: { ...wireSource, bag: -1 }, target: wireTarget },
    { source: { ...wireSource, slot: 'chest' }, target: wireTarget },
    { source: wireSource, target: { ...wireTarget, copy: pinned } },
  ])('drops malformed or legacy unpinned requests whole: %j', (input) => {
    expect(parsePerfectingSwapCommand(input)).toBeNull();
  });

  it('preserves an explicit confirmation capture even after the mirror changes', () => {
    const reads = { inventory: [{ itemId: CHEST, count: 1 }], equipment: { waist: WAIST }, equipmentInstances: {} };
    const request: PerfectingSwapRequest = {
      source: capturePerfectItemRef(reads, { bag: 0, itemId: CHEST }),
      target: capturePerfectItemRef(reads, { slot: 'waist' }),
    };
    const first = perfectingSwapCommand(reads, request);
    reads.inventory[0] = { itemId: WAIST, count: 1 };
    expect(perfectingSwapCommand(reads, request)).toEqual(first);
    expect(parsePerfectingSwapCommand(first)).toEqual(request);
  });
});

function fixture(worn: boolean) {
  const server = new GameServer();
  const socket = fakeWs();
  const session = joinServer(server, socket, 941, 'Rankcrafter');
  const pid = session.pid;
  const meta = server.sim.meta(pid)!;
  meta.craftSkills.blacksmithing = 125;
  const station = STATIONS.find((entry) => entry.type === 'forge')!;
  const player = server.sim.entities.get(pid)!;
  player.pos = { ...player.pos, x: station.pos.x, z: station.pos.z };
  player.inCombat = false;
  meta.inventory = [{ itemId: WAIST, count: 1, instance: { perfecting: 1 } }];
  if (worn) {
    meta.equipment.chest = CHEST;
    meta.equipmentInstance.chest = { perfecting: 3 };
  } else meta.inventory.push({ itemId: CHEST, count: 1, instance: { perfecting: 3 } });
  const sent: Record<string, unknown>[] = [];
  const client = bareClient(pid, { ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } });
  broadcast(server);
  const apply = (snapshot: unknown) => (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(snapshot);
  apply(lastSnap(socket.sent));
  const request: PerfectingSwapRequest = {
    source: capturePerfectItemRef(client, worn ? { slot: 'chest' } : { bag: 1, itemId: CHEST }),
    target: capturePerfectItemRef(client, { bag: 0, itemId: WAIST }),
  };
  return { server, socket, session, pid, meta, client, sent, request, apply };
}

describe('rank exchange through the real online host', () => {
  it.each([false, true])('resolves only on the server and refreshes both mirrors (worn=%s)', (worn) => {
    const { server, socket, session, pid, meta, client, sent, request, apply } = fixture(worn);
    const otherSocket = fakeWs();
    joinServer(server, otherSocket, 942, 'Othercrafter');
    const before = JSON.stringify(client.inventory);
    expect(client.perfectingSwapInfo(request)).toEqual(server.sim.perfectingSwapInfo(request, pid));
    expect(client.perfectingSwapInfo(request)?.reason).toBeUndefined();
    client.swapPerfectingRanks(request);
    expect(sent).toHaveLength(1);
    expect(sent[0].cmd).toBe('swap_perfecting_ranks');
    expect(JSON.stringify(client.inventory)).toBe(before);
    let draws = 0;
    server.sim.rng.setObserver(() => draws++);
    server.handleMessage(session, JSON.stringify(sent[0]));
    server.sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(meta.inventory[0].instance?.perfecting).toBe(3);
    expect(worn ? meta.equipmentInstance.chest?.perfecting : meta.inventory[1].instance?.perfecting).toBe(1);
    expect((session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty).toBe(true);
    const events = server.sim.drainEvents();
    (server as unknown as { routeEvents(e: SimEvent[]): void }).routeEvents(events);
    expect(socket.sent.flatMap((frame) => frame.list ?? [])).toContainEqual(expect.objectContaining({ type: 'perfectingSwapResult', pid, ok: true }));
    expect(otherSocket.sent.flatMap((frame) => frame.list ?? [])).not.toContainEqual(expect.objectContaining({ type: 'perfectingSwapResult' }));
    broadcast(server);
    apply(lastSnap(socket.sent));
    expect(client.inventory).toEqual(meta.inventory);
    if (worn) expect(client.equipmentInstances.chest).toEqual(meta.equipmentInstance.chest);
    const after = JSON.stringify(server.sim.serializeCharacter(pid));
    server.handleMessage(session, JSON.stringify(sent[0]));
    expect(JSON.stringify(server.sim.serializeCharacter(pid))).toBe(after);
    expect(server.sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'perfectingSwapResult', ok: false, reason: 'no_item' }));
  });

  it('drops either unpinned copy before the sim or heavy-self mark', () => {
    const { server, session, request } = fixture(false);
    const action = vi.spyOn(server.sim, 'swapPerfectingRanks');
    const fields = perfectingSwapCommand({ inventory: [], equipment: {}, equipmentInstances: {} }, request);
    for (const key of ['source', 'target'] as const) {
      const malformed = { ...fields, [key]: { bag: 0, item: WAIST } };
      (session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty = false;
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'swap_perfecting_ranks', ...malformed }));
      expect(action).not.toHaveBeenCalled();
      expect((session as unknown as { selfHeavyDirty: boolean }).selfHeavyDirty).toBe(false);
    }
  });
});
