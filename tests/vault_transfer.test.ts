import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { WebSocket, WebSocketServer } from 'ws';

const nodeRequire = createRequire(import.meta.url);
const { WebSocket: NodeWebSocket, WebSocketServer: NodeWebSocketServer } = nodeRequire(
  join(dirname(nodeRequire.resolve('ws/package.json')), 'index.js'),
) as typeof import('ws');

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { VaultTransferSender } from '../server/vault_transfer';
import { emitVaultSelfKeys, type VaultSelfWireSession } from '../server/vault_wire';
import { isBackpressureExceeded, WS_BACKPRESSURE_LIMIT_BYTES } from '../server/ws_backpressure';
import { applyBankSelfWire } from '../src/net/bank_snapshot_wire';
import { decodeVaultInfoWire } from '../src/net/vault_snapshot_wire';
import {
  applyVaultTransferWire,
  resetVaultTransferWire,
  VaultTransferReceiver,
} from '../src/net/vault_transfer_receiver';
import { materialItemIds } from '../src/sim/material_ids';
import { sanitizeVaultState, vaultInfoFor, vaultInfoReadFor } from '../src/sim/materials_vault';
import type { SimContext } from '../src/sim/sim_context';
import {
  VAULT_TRANSFER_DEPTH,
  VAULT_TRANSFER_FRAME_BYTES,
  VAULT_TRANSFER_SOFT_BACKLOG_BYTES,
  VAULT_TRANSFER_STRING_CHARS,
  VAULT_TRANSFER_TOKEN_LIMIT,
  type VaultTransferChunk,
  type VaultTransferToken,
} from '../src/vault_transfer_protocol';
import type { VaultInfo } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

const SMALL: VaultInfo = {
  stock: { copper_ore: 7 },
  special: [],
  upgrades: 10,
  perMaterialCap: 1000,
  nextUpgradeCost: null,
};

function maximalProjection(): VaultInfo {
  // The independent review's real 118-material, 1000-source fixture. Exercise
  // production normalization AND banker projection, not a made-up wire blob.
  const rows = [...materialItemIds()].map((itemId) => ({
    itemId,
    count: 1000,
    materialSources: Array.from({ length: 1000 }, (_, i) => ({
      source: { gatherer: { kind: 'character', id: 2147483647 - i, name: 'W'.repeat(16) } },
      count: 1,
    })),
  }));
  const loaded = sanitizeVaultState({ stock: {}, special: rows, upgrades: 10 });
  const ctx = {
    resolve: () => ({ meta: { vault: loaded }, e: { pos: { x: 0, y: 0, z: 0 } } }),
    bankerIds: [2],
    entities: new Map([[2, { kind: 'npc', pos: { x: 0, y: 0, z: 0 } }]]),
    storagePrices: { vaultUpgrades: Array(10).fill(0) },
  } as unknown as SimContext;
  const projected = vaultInfoFor(ctx, 1);
  if (!projected) throw new Error('missing banker vault');
  return projected;
}

function session(bufferedAmount = 0): VaultSelfWireSession & { ws: { bufferedAmount: number } } {
  return {
    ws: { bufferedAmount },
    lastSent: {},
    lastVaultWirePid: null,
    lastVaultWireRev: null,
    lastCvaultWirePid: null,
    lastCvaultWireRev: null,
    lastCvaultWireBlocked: null,
  };
}

function chunks(info: VaultInfo, id = 1): VaultTransferChunk[] {
  const sender = new VaultTransferSender(id, info);
  const result: VaultTransferChunk[] = [];
  for (;;) {
    const chunk = sender.peek();
    result.push(chunk);
    sender.accept();
    if (chunk.done) return result;
  }
}

function packet(tokens: VaultTransferToken[], overrides: Partial<VaultTransferChunk> = {}) {
  return { vaultTransfer: 1, id: 1, cursor: 0, done: true, tokens, ...overrides };
}

const projection = maximalProjection();
const original = JSON.stringify({ t: 'snap', self: { vault: projection } });

function liveFixture(info: VaultInfo) {
  const meta = { vault: sanitizeVaultState(info), vaultWireRev: 4 };
  const player = { pos: { x: 0, y: 0, z: 0 } };
  const banker = { kind: 'npc', pos: { x: 0, y: 0, z: 0 } };
  const ctx = {
    resolve: () => ({ meta, e: player }),
    bankerIds: [2],
    entities: new Map([[2, banker]]),
    players: new Map([[1, meta]]),
    storagePrices: { vaultUpgrades: Array(10).fill(0) },
  } as unknown as SimContext;
  return { ctx, meta, player, banker };
}

describe('bounded Materials Vault transport', () => {
  it.each(['current-cap', 'one-oversized-legacy-row'])(
    'bounds actual source reads at bootstrap and every eligible pass: %s',
    (shape) => {
      const info =
        shape === 'current-cap'
          ? projection
          : {
              ...SMALL,
              special: [
                {
                  itemId: 'copper_ore',
                  count: 20000,
                  materialSources: Array.from({ length: 20000 }, (_, i) => ({
                    source: {
                      gatherer: { kind: 'character' as const, id: i + 1, name: 'Legacy' },
                    },
                    count: 1,
                  })),
                  slot: 9,
                },
              ],
            };
      const { ctx, meta } = liveFixture(info);
      const expected = vaultInfoFor(ctx, 1);
      let sourceReads = 0;
      for (const row of meta.vault.special)
        if (row.materialSources) {
          row.materialSources = new Proxy(row.materialSources, {
            get(target, key, receiver) {
              if (typeof key === 'string' && /^\d+$/.test(key)) sourceReads++;
              return Reflect.get(target, key, receiver);
            },
          });
        }
      const read = vaultInfoReadFor(ctx, 1);
      expect(read?.value.special).toBe(meta.vault.special);
      expect(sourceReads).toBe(0); // Bootstrap never clones even one source row.
      const owner = session(VAULT_TRANSFER_SOFT_BACKLOG_BYTES + 1);
      const client = bareClient(1, { vaultInfo: SMALL });
      let builds = 0,
        emissions = 0;
      const sim = {
        vaultInfoWireRevFor: () => meta.vaultWireRev,
        vaultWireRevFor: () => meta.vaultWireRev,
        craftVaultDrawBlockedFor: () => true,
        craftVaultStockFor: () => null,
        vaultInfoReadFor: () => {
          builds++;
          return vaultInfoReadFor(ctx, 1);
        },
      };
      const emit = (key: 'vault' | 'cvault', value: unknown) => {
        const encoded = JSON.stringify(value);
        (owner.lastSent as Record<string, string>)[key] = encoded;
        if (key === 'vault') {
          emissions++;
          applyBankSelfWire(client, { vault: JSON.parse(encoded) });
        }
      };
      emitVaultSelfKeys(emit, sim, owner, 1);
      expect(builds).toBe(0);
      expect(sourceReads).toBe(0);
      expect(emissions).toBe(0);
      owner.ws.bufferedAmount = 0;
      do {
        const before = sourceReads;
        emitVaultSelfKeys(emit, sim, owner, 1);
        expect(sourceReads - before).toBeLessThanOrEqual(VAULT_TRANSFER_TOKEN_LIMIT + 1);
        expect(sourceReads - before).toBeLessThan(shape === 'current-cap' ? 118000 : 20000);
        if (owner.vaultTransfer) expect(client.vaultInfo).toBe(SMALL);
      } while (owner.vaultTransfer);
      expect(builds).toBe(1);
      expect(emissions).toBeGreaterThan(1);
      expect(client.vaultInfo).toEqual(expected);
      const finishedReads = sourceReads;
      emitVaultSelfKeys(emit, sim, owner, 1);
      expect(sourceReads).toBe(finishedReads);
      expect(builds).toBe(1);
    },
    30000,
  );

  it('discards pinned live data before consuming another source when revision, identity or proximity changes', () => {
    const { ctx, meta, banker } = liveFixture(projection);
    const owner = session();
    const emitted: VaultTransferChunk[] = [];
    const sim = {
      vaultInfoWireRevFor: () => vaultInfoReadFor(ctx, 1)?.revision ?? null,
      vaultWireRevFor: () => meta.vaultWireRev,
      craftVaultDrawBlockedFor: () => true,
      craftVaultStockFor: () => null,
      vaultInfoReadFor: () => vaultInfoReadFor(ctx, 1),
    };
    const emit = (key: 'vault' | 'cvault', value: unknown) => {
      (owner.lastSent as Record<string, string>)[key] = JSON.stringify(value);
      if (key === 'vault' && value) emitted.push(value as VaultTransferChunk);
    };
    emitVaultSelfKeys(emit, sim, owner, 1);
    const old = owner.vaultTransfer?.read;
    expect(old?.isCurrent()).toBe(true);
    meta.vaultWireRev++;
    owner.ws.bufferedAmount = VAULT_TRANSFER_SOFT_BACKLOG_BYTES + 1;
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(old?.isCurrent()).toBe(false);
    expect(owner.vaultTransfer).toBeUndefined();
    expect(emitted).toHaveLength(1);
    owner.ws.bufferedAmount = 0;
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(emitted[1].id).toBeGreaterThan(emitted[0].id);
    expect(emitted[1].cursor).toBe(0);
    const replaced = owner.vaultTransfer?.read;
    meta.vault = sanitizeVaultState(SMALL);
    expect(replaced?.isCurrent()).toBe(false);
    owner.ws.bufferedAmount = VAULT_TRANSFER_SOFT_BACKLOG_BYTES + 1;
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(owner.vaultTransfer).toBeUndefined();
    owner.ws.bufferedAmount = 0;
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(emitted.at(-1)).toEqual(SMALL); // Equal numeric revision still restarts.
    banker.pos.x = 1000;
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(owner.vaultTransfer).toBeUndefined();
  });

  it('adopts all 118000 source units atomically through actual owner emission and client mirror', () => {
    expect(Buffer.byteLength(original)).toBeGreaterThan(11_000_000);
    expect(decodeVaultInfoWire(projection)).not.toBeNull();
    const owner = session();
    const client = bareClient(1, { vaultInfo: SMALL });
    let builds = 0;
    const sim = {
      vaultInfoWireRevFor: () => 4,
      vaultWireRevFor: () => 4,
      craftVaultDrawBlockedFor: () => false,
      vaultInfoReadFor: () => {
        builds++;
        return { value: projection, revision: 4, isCurrent: () => true };
      },
      craftVaultStockFor: () => ({}),
    };
    let largest = 0;
    let passes = 0;
    let vaultPackets = 0;
    const emit = (key: 'vault' | 'cvault', value: unknown) => {
      const encoded = JSON.stringify(value);
      (owner.lastSent as Record<string, string>)[key] = encoded;
      if (key !== 'vault') return;
      vaultPackets++;
      largest = Math.max(largest, Buffer.byteLength(encoded));
      applyBankSelfWire(client, { vault: JSON.parse(encoded) });
      if (!(value as VaultTransferChunk).done) expect(client.vaultInfo).toBe(SMALL);
    };
    do {
      emitVaultSelfKeys(emit, sim, owner, 1);
      passes++;
      expect(passes).toBeLessThan(1000);
    } while (owner.vaultTransfer);
    expect(builds).toBe(1);
    expect(vaultPackets).toBeGreaterThan(40);
    expect(largest).toBeLessThanOrEqual(VAULT_TRANSFER_FRAME_BYTES);
    expect(client.vaultInfo).toEqual(projection);
    expect(client.vaultInfo?.special.reduce((n, row) => n + row.count, 0)).toBe(118000);
    emitVaultSelfKeys(emit, sim, owner, 1);
    expect(builds).toBe(1);
    expect(vaultPackets).toBe(passes);
  }, 30_000);

  it('paces a 1Mbps drain by actual backlog and never queues the full projection', () => {
    const owner = session();
    let chunksSent = 0;
    let largestBacklog = 0;
    let ticks = 0;
    let builds = 0;
    const sim = {
      vaultInfoWireRevFor: () => 4,
      vaultWireRevFor: () => 4,
      craftVaultDrawBlockedFor: () => false,
      vaultInfoReadFor: () => {
        builds++;
        return { value: projection, revision: 4, isCurrent: () => true };
      },
      craftVaultStockFor: () => ({}),
    };
    const emit = (key: 'vault' | 'cvault', value: unknown) => {
      const payload = JSON.stringify(value);
      (owner.lastSent as Record<string, string>)[key] = payload;
      if (key === 'vault') {
        chunksSent++;
        owner.ws.bufferedAmount += Buffer.byteLength(payload);
      }
    };
    do {
      owner.ws.bufferedAmount = Math.max(0, owner.ws.bufferedAmount - 6250); // 1Mbps at20Hz
      emitVaultSelfKeys(emit, sim, owner, 1);
      largestBacklog = Math.max(largestBacklog, owner.ws.bufferedAmount);
      expect(isBackpressureExceeded(owner.ws.bufferedAmount)).toBe(false);
      expect(++ticks).toBeLessThan(10_000);
    } while (owner.vaultTransfer);
    expect(builds).toBe(1);
    expect(ticks).toBeGreaterThan(chunksSent * 2);
    expect(largestBacklog).toBeLessThanOrEqual(
      VAULT_TRANSFER_SOFT_BACKLOG_BYTES + VAULT_TRANSFER_FRAME_BYTES,
    );
  }, 30_000);

  it('cancels/restarts on revision, proximity, spectator anchor and socket replacement', () => {
    const owner = session();
    const emitted: unknown[] = [];
    const emit = (key: 'vault' | 'cvault', value: unknown) => {
      (owner.lastSent as Record<string, string>)[key] = JSON.stringify(value);
      if (key === 'vault') emitted.push(value);
    };
    let rev: number | null = 4;
    let builds = 0;
    const sim = {
      vaultInfoWireRevFor: () => rev,
      vaultWireRevFor: () => 4,
      craftVaultDrawBlockedFor: () => false,
      vaultInfoReadFor: () => {
        builds++;
        return { value: projection, revision: rev ?? 0, isCurrent: () => true };
      },
      craftVaultStockFor: () => ({}),
    };
    emitVaultSelfKeys(emit, sim, owner, 1);
    const first = emitted.at(-1) as VaultTransferChunk;
    rev = 5;
    emitVaultSelfKeys(emit, sim, owner, 1);
    const second = emitted.at(-1) as VaultTransferChunk;
    expect(second.id).toBeGreaterThan(first.id);
    expect(second.cursor).toBe(0);
    emitVaultSelfKeys(emit, sim, owner, 2); // moderator switches viewed owner
    expect((emitted.at(-1) as VaultTransferChunk).cursor).toBe(0);
    owner.ws = { bufferedAmount: 0 };
    emitVaultSelfKeys(emit, sim, owner, 2);
    expect((emitted.at(-1) as VaultTransferChunk).cursor).toBe(0);
    expect(builds).toBe(4);
    rev = null;
    emitVaultSelfKeys(emit, sim, owner, 2);
    expect(emitted.at(-1)).toBeNull();
    expect(owner.vaultTransfer).toBeUndefined();
  });

  it('omits only advisory special-row slot and retains nested instance slot data', () => {
    const instance = { signer: 'Ana', slot: 42 };
    const sender = new VaultTransferSender(1, {
      ...SMALL,
      special: [{ itemId: 'copper_ore', count: 1, slot: 9, instance }],
    });
    expect(sender.boundedSmallInfo().special).toEqual([
      { itemId: 'copper_ore', count: 1, instance: { signer: 'Ana', slot: 42 } },
    ]);
  });

  it('retries exactly the prepared chunk after an emitter failure', () => {
    const sender = new VaultTransferSender(1, projection);
    const first = sender.peek();
    expect(sender.peek()).toBe(first);
    sender.accept();
    expect(sender.peek().cursor).toBe(first.tokens.length);
  });

  it('preserves oversized legacy/dormant ids, over-cap stock, Unicode and inert prototype keys', () => {
    const id = `dormant${'🌿'.repeat(VAULT_TRANSFER_STRING_CHARS + 1)}`;
    const stock = JSON.parse('{"__proto__":3,"constructor":4}') as Record<string, number>;
    stock[id] = 100_000;
    const info = { ...SMALL, stock };
    const target = { vaultInfo: null };
    const stream = chunks(info);
    for (const chunk of stream) applyVaultTransferWire(target, chunk);
    expect(target.vaultInfo).toEqual(info);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect((target.vaultInfo as VaultInfo | null)?.stock[id]).toBe(100_000);
  });

  it('ignores obsolete transfer ids, rejects duplicate cursors, and clears on gate/reset', () => {
    const source = chunks(projection);
    const next = chunks(projection, 2);
    const receiver = new VaultTransferReceiver();
    expect(receiver.receive(source[0])).toBeUndefined();
    expect(receiver.receive(next[0])).toBeUndefined();
    expect(receiver.receive(source[1])).toBeUndefined();
    let adopted: VaultInfo | null | undefined;
    for (const chunk of next.slice(1)) adopted = receiver.receive(chunk);
    expect(adopted).toEqual(projection);
    expect(receiver.receive(next[0])).toBeUndefined(); // completed transfer replay
    const retry = new VaultTransferReceiver();
    expect(retry.receive(next[0])).toBeUndefined();
    expect(retry.receive(next[0])).toBeNull(); // repeated active cursor
    const target = { vaultInfo: SMALL };
    applyVaultTransferWire(target, source[0]);
    resetVaultTransferWire(target);
    expect(target.vaultInfo).toBeNull();
    applyVaultTransferWire(target, source[1]);
    expect(target.vaultInfo).toBeNull();
    applyVaultTransferWire(target, source[0]);
    applyVaultTransferWire(target, null);
    expect(target.vaultInfo).toBeNull();
  });

  it('clears previous-owner vault and partial receiver on actual spectate enter, switch and exit', () => {
    const world = bareClient(1, { vaultInfo: SMALL });
    const wire = world as unknown as { onMessage(raw: string): void };
    const future = (copper: number): VaultInfo => ({
      ...SMALL,
      stock: { copper_ore: copper },
      special: Array.from({ length: 4000 }, (_, i) => ({
        itemId: 'copper_ore',
        count: 1,
        craftedRecipeId: `legacy_${i}`,
      })),
    });
    const send = (pid: number, chunk: VaultTransferChunk) =>
      wire.onMessage(
        JSON.stringify({
          t: 'snap',
          ents: [],
          self: {
            id: pid,
            k: 'player',
            tid: 'warrior',
            nm: `Owner${pid}`,
            lv: 20,
            x: 0,
            y: 0,
            z: 0,
            f: 0,
            hp: 100,
            mhp: 100,
            vault: chunk,
          },
        }),
      );
    const stream = (pid: number, info: VaultInfo, id: number, firstMirror: VaultInfo | null) => {
      const frames = chunks(info, id);
      expect(frames[0].done).toBe(false);
      send(pid, frames[0]);
      expect(world.vaultInfo).toBe(firstMirror);
      for (const frame of frames.slice(1)) send(pid, frame);
      expect(world.vaultInfo).toEqual(info);
      expect(world.playerId).toBe(pid);
    };
    // Enter cancels a partial transfer belonging to the moderator's own vault.
    send(1, chunks(future(8), 1)[0]);
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Owner2' }));
    expect(world.vaultInfo).toBeNull();
    expect('vaultTransferReceiver' in world).toBe(false);
    const firstOwner = future(123);
    stream(2, firstOwner, 2, null);
    expect(world.spectating).toBe('Owner2');
    // A new revision for the same owner still retains its validated mirror.
    const sameOwnerMirror = world.vaultInfo;
    stream(2, future(124), 3, sameOwnerMirror);
    send(2, chunks(future(125), 4)[0]);
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Owner3' }));
    expect(world.vaultInfo).toBeNull();
    expect('vaultTransferReceiver' in world).toBe(false);
    stream(3, future(234), 5, null);
    expect(world.spectating).toBe('Owner3');
    send(3, chunks(future(235), 6)[0]);
    wire.onMessage(JSON.stringify({ t: 'spectate', name: null }));
    expect(world.vaultInfo).toBeNull();
    expect('vaultTransferReceiver' in world).toBe(false);
    expect(world.playerId).toBe(1);
    stream(1, future(456), 7, null);
    expect(world.spectating).toBeNull();
  });

  it('discards a partial transfer on actual reconnect hello before adopting the new socket revision', () => {
    const world = bareClient(1, { vaultInfo: SMALL, reconnectAttempts: 1 });
    applyBankSelfWire(world, { vault: chunks(projection)[0] });
    const wire = world as unknown as { onMessage(raw: string): void };
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 42 }));
    expect(world.vaultInfo).toBeNull();
    for (const chunk of chunks(SMALL, 1)) applyBankSelfWire(world, { vault: chunk });
    expect(world.vaultInfo).toEqual(SMALL);
  });

  it.each([1.5, 2 ** 53, 0, -1])('rejects a complete tree with unsafe stock count %s', (count) => {
    const target = { vaultInfo: SMALL };
    for (const chunk of chunks({ ...SMALL, stock: { copper_ore: count } }))
      applyVaultTransferWire(target, chunk);
    expect(target.vaultInfo).toBeNull();
  });

  it.each([
    packet([[0], [4, 'stock', true], [6, 1], [4, 'stock', true], [6, 2], [1]]),
    packet([[0], [4, 'x', false], [1]]),
    packet([[2], [1]]),
    packet([[6, Number.POSITIVE_INFINITY]]),
    packet([[6, 1]], { cursor: Number.MAX_SAFE_INTEGER }),
    packet([[0]], { id: Number.NaN }),
    packet([[5, 'x'.repeat(VAULT_TRANSFER_STRING_CHARS + 1), true]]),
    packet(Array.from({ length: VAULT_TRANSFER_DEPTH + 1 }, () => [0] as VaultTransferToken)),
    packet(Array.from({ length: VAULT_TRANSFER_TOKEN_LIMIT + 1 }, () => [0] as VaultTransferToken)),
    packet(Array.from({ length: 40 }, () => [5, '🌿'.repeat(4096), false] as VaultTransferToken)),
    packet([[0], [4, 'stock', true], [0], [4, 'copper_ore', true], [6, 1.5], [1], [1]]),
    packet([[0], [4, 'stock', true], [0], [4, 'copper_ore', true], [6, 2 ** 53], [1], [1]]),
  ])('rejects malformed grammar/bounds/counts without partially adopting %j', (bad) => {
    const target = { vaultInfo: SMALL };
    applyVaultTransferWire(target, bad);
    expect(target.vaultInfo).toBeNull();
  });
});

const sockets = new Set<WebSocket>();
const listeners = new Set<WebSocketServer>();
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  for (const listener of listeners)
    await new Promise<void>((resolve) => listener.close(() => resolve()));
});

describe('vault transfer through real ws and application sendRaw', () => {
  it('survives a paused receiver and bounded pacing, then reconstructs the exact vault', async () => {
    const listener = new NodeWebSocketServer({
      host: '127.0.0.1',
      port: 0,
      perMessageDeflate: false,
    });
    listeners.add(listener);
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('missing listener address');
    const accepted = new Promise<WebSocket>((resolve) => listener.once('connection', resolve));
    const client = new NodeWebSocket(`ws://127.0.0.1:${address.port}`, {
      perMessageDeflate: false,
    });
    sockets.add(client);
    await new Promise<void>((resolve) => client.once('open', resolve));
    const peer = await accepted;
    sockets.add(peer);
    const app = Object.create(GameServer.prototype) as {
      sendRaw(session: unknown, payload: string): void;
    };
    const owner = { ...session(), ws: peer, left: false };
    const mirror = { vaultInfo: null };
    let largestFrame = 0;
    let largestBacklog = 0;
    client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      applyVaultTransferWire(mirror, frame.self.vault);
    });
    const { ctx, meta } = liveFixture(projection);
    const sim = {
      vaultInfoWireRevFor: () => meta.vaultWireRev,
      vaultWireRevFor: () => meta.vaultWireRev,
      craftVaultDrawBlockedFor: () => true,
      craftVaultStockFor: () => null,
      vaultInfoReadFor: () => vaultInfoReadFor(ctx, 1),
    };
    // The controlled 50ms pause from the original failure reproduction.
    const receiverSocket = (client as unknown as { _socket: { pause(): void; resume(): void } })
      ._socket;
    receiverSocket.pause();
    let done = false;
    const sendNext = () => {
      if (done || peer.bufferedAmount > VAULT_TRANSFER_SOFT_BACKLOG_BYTES) return;
      emitVaultSelfKeys(
        (key, value) => {
          const serialized = JSON.stringify(value);
          (owner.lastSent as Record<string, string>)[key] = serialized;
          if (key !== 'vault') return;
          const payload = `{"t":"snap","self":{"vault":${serialized}}}`;
          largestFrame = Math.max(largestFrame, Buffer.byteLength(payload));
          app.sendRaw(owner, payload);
          largestBacklog = Math.max(largestBacklog, peer.bufferedAmount);
          done = (value as VaultTransferChunk).done;
        },
        sim,
        owner,
        1,
      );
    };
    sendNext();
    await new Promise((resolve) => setTimeout(resolve, 50));
    sendNext();
    expect(peer.readyState).toBe(NodeWebSocket.OPEN);
    expect(peer.bufferedAmount).toBeLessThan(WS_BACKPRESSURE_LIMIT_BYTES);
    receiverSocket.resume();
    for (let i = 0; i < 2000 && (!done || mirror.vaultInfo === null); i++) {
      sendNext();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(done).toBe(true);
    expect(mirror.vaultInfo).toEqual(projection);
    expect(largestFrame).toBeLessThan(VAULT_TRANSFER_FRAME_BYTES + 100);
    expect(largestBacklog).toBeLessThan(
      VAULT_TRANSFER_SOFT_BACKLOG_BYTES + VAULT_TRANSFER_FRAME_BYTES + 100,
    );
    expect(peer.readyState).toBe(NodeWebSocket.OPEN);
    // Chunk pacing must not weaken the existing hard fuse for a peer whose
    // ordinary game traffic stops draining altogether.
    receiverSocket.pause();
    const filler = ' '.repeat(1024 * 1024);
    for (let i = 0; i < 20 && peer.bufferedAmount <= WS_BACKPRESSURE_LIMIT_BYTES; i++)
      peer.send(filler);
    expect(peer.bufferedAmount).toBeGreaterThan(WS_BACKPRESSURE_LIMIT_BYTES);
    const socketClosed = vi.fn();
    Object.assign(app, { socketClosed });
    app.sendRaw(owner, '{}');
    expect(peer.readyState).not.toBe(NodeWebSocket.OPEN);
    expect(socketClosed).toHaveBeenCalledWith(owner, peer);
  }, 30_000);
});
