// Inspect extension (Professions 2.0 Phase 6): equipped ItemInstancePayloads
// ride the IDENTITY lane (terse key `eqi`, next to `eq`) so the inspect window
// shows another player's masterwork/enchant rolls. This suite is the liveness
// half (the #2033 class: value, not shape): a REAL GameServer broadcast into a
// REAL ClientWorld.applySnapshot, where the mirrored VALUE must appear, change
// on re-equip, reset on unequip, elide on unchanged ticks, and never alias the
// wire payload. Plus the server-authority pin: the one wire surface where a
// client-supplied ItemInstancePayload is even expressible (trade_offer items)
// strips it. Encode/decode round-trip unit cases live in tests/snapshots.test.ts.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
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
import type { PlayerClass } from '../src/sim/types';

const ITEM_ID = 'eastbrook_ritual_vestments';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

function cmd(server: GameServer, session: ClientSession, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot with the
// REAL captured server snap (the tests/snapshots.test.ts bareClient idiom,
// trimmed to the fields the ents decode path touches).
function bareClient(pid: number, playerClass: PlayerClass = 'warrior'): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = playerClass;
  c.spectating = null;
  c.cupInfo = null;
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

describe('eqi over a real server broadcast into applySnapshot (liveness, not shape)', () => {
  it('mirrors the worn payload value, re-equip changes it, unequip resets it, unchanged ticks elide', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 1, 'Crafter');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Watcher');

    // Before any instanced equip, A's first-sight full record carries no eqi.
    broadcast(server);
    const before = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    expect(before?.k).toBe('player');
    expect(before?.eqi).toBeUndefined();

    // The server mints the instance (the only place payloads are born); the
    // client only sends the plain equip command by item id.
    const minted = { rolled: { masterwork: true, stats: { int: 3, spi: 1 } }, signer: 'Crafter' };
    server.sim.addItemInstance(ITEM_ID, structuredClone(minted), a.pid);
    cmd(server, a, { cmd: 'equip', item: ITEM_ID });
    fcB.sent.length = 0;
    server.sim.tick(); // the wire cache re-serializes identity once per sim tick
    broadcast(server);
    const snap1 = lastSnap(fcB.sent);
    const equipped = snap1?.ents.find((r: any) => r.id === a.pid);
    // identity changed, so B receives a FULL record with the payload VALUE
    expect(equipped?.k).toBe('player');
    expect(equipped?.eqi).toEqual({ chest: minted });

    // Feed the REAL snap into a real applySnapshot: the mirrored value appears
    // and equals the server-minted instance, deep-cloned (never aliasing the
    // parsed wire record a later mutation could reach).
    const client = bareClient(b.pid);
    (client as any).applySnapshot(snap1);
    const mirrored = client.entities.get(a.pid)?.equippedInstances;
    expect(mirrored).toEqual({ chest: minted });
    expect(mirrored?.chest).not.toBe(equipped.eqi.chest);
    equipped.eqi.chest.rolled.stats.int = 99;
    expect(mirrored?.chest?.rolled?.stats?.int).toBe(3);

    // An unchanged tick re-sends A as a LITE record: no identity, no eqi
    // (the sparse no-bloat tooth), and the applied mirror survives it.
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const lite = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    expect(lite?.k).toBeUndefined();
    expect(lite?.eqi).toBeUndefined();
    (client as any).applySnapshot(lastSnap(fcB.sent));
    expect(client.entities.get(a.pid)?.equippedInstances).toEqual({ chest: minted });

    // Re-equip with a differently-rolled copy: the VALUE changes the outcome
    // (a stale mirror that merely has the right shape fails here).
    const reroll = { rolled: { masterwork: true, stats: { int: 7 } }, signer: 'Crafter' };
    server.sim.addItemInstance(ITEM_ID, structuredClone(reroll), a.pid);
    cmd(server, a, { cmd: 'equip', item: ITEM_ID });
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const snap2 = lastSnap(fcB.sent);
    expect(snap2?.ents.find((r: any) => r.id === a.pid)?.eqi).toEqual({ chest: reroll });
    (client as any).applySnapshot(snap2);
    expect(client.entities.get(a.pid)?.equippedInstances).toEqual({ chest: reroll });

    // Unequip: the identity JSON loses eqi, the full record re-sends without
    // the key, and the client mirror resets to empty.
    cmd(server, a, { cmd: 'unequip_item', slot: 'chest' });
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const snap3 = lastSnap(fcB.sent);
    const bare = snap3?.ents.find((r: any) => r.id === a.pid);
    expect(bare?.k).toBe('player');
    expect(bare?.eqi).toBeUndefined();
    (client as any).applySnapshot(snap3);
    expect(client.entities.get(a.pid)?.equippedInstances).toEqual({});
  });
});

describe('server authority over instance payloads', () => {
  it('a client-supplied instance on a trade_offer wire message is stripped, never granted', () => {
    // Equip/craft/use commands carry only string ids, so an instance payload is
    // not even expressible there; the trade offer's items array is the one wire
    // surface that could smuggle one. tradeSetOffer rebuilds each accepted slot
    // as { itemId, count }, so the forged payload must never reach the
    // counter-party's bags: the received copy is plain.
    const server = new GameServer();
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 1, 'Forger');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Mark');
    server.sim.addItem('linen_scrap', 1, a.pid);

    cmd(server, a, { cmd: 'trade_req', id: b.pid });
    cmd(server, b, { cmd: 'trade_accept' });
    cmd(server, a, {
      cmd: 'trade_offer',
      items: [
        {
          itemId: 'linen_scrap',
          count: 1,
          instance: { rolled: { masterwork: true, stats: { spellPower: 99 } }, signer: 'Forged' },
        },
      ],
      copper: 0,
    });
    cmd(server, a, { cmd: 'trade_confirm' });
    cmd(server, b, { cmd: 'trade_confirm' });

    const received = server.sim.meta(b.pid)?.inventory.find((s) => s.itemId === 'linen_scrap');
    expect(received?.count).toBe(1);
    // Plain copy: the forged payload never crossed. `in` (not undefined) so an
    // explicitly-null smuggle also fails the pin.
    expect(received && 'instance' in received).toBe(false);
    // And the forger's own copy is gone (the trade itself really ran).
    expect(server.sim.meta(a.pid)?.inventory.some((s) => s.itemId === 'linen_scrap')).toBe(false);
  });
});

// The last link of the inspect chain is hud.ts DOM glue no suite instantiates
// (openInspect -> buildInspectSlotRow -> the widened itemTooltip), so the
// threading is source-pinned: the eqi wire and mirror above are liveness-
// tested, and these pins keep the rendered row actually consuming them.
import { readFileSync } from 'node:fs';

describe('hud openInspect instance threading (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('threads the inspected entity payload per slot into both paperdoll columns', () => {
    expect(hud).toContain('buildInspectSlotRow(cell, e.equippedInstances[cell.slot])');
  });

  it('the slot row forwards the instance into the tooltip builder', () => {
    expect(hud).toContain('this.attachTooltip(row, () => this.itemTooltip(item, true, instance))');
  });
});
