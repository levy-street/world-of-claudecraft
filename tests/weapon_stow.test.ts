// The Z-key sheathed-weapon toggle (src/sim/weapon_stow.ts + the stow_weapon wire
// command): toggle + dead-gate, the WoW-style combat auto-unsheathe, JSONB
// persistence back-compat, and the entity-wire `ws` bit end to end
// (server encode -> ClientWorld decode).
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; wire/dispatch logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // bank_ledger.ts (imported via game.ts recordBankOp) reads this at call time.
  insertBankLedgerRow: vi.fn(async () => {}),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer, wireEntity } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import { dist2d, type PlayerClass } from '../src/sim/types';
import { drawWeapon, toggleWeaponStow } from '../src/sim/weapon_stow';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: 'warrior' | 'mage' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

function nearestMob(sim: Sim, templateId?: string) {
  const p = sim.player;
  let best: any = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (templateId && e.templateId !== templateId) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function teleportTo(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.onGround = true;
  p.fallStartY = p.pos.y;
}

describe('weapon_stow module', () => {
  it('toggles the flag and drawWeapon clears it', () => {
    const sim = makeSim();
    const p = sim.player;
    expect(p.weaponStowed).toBe(false);
    expect(toggleWeaponStow(p)).toBe(true);
    expect(p.weaponStowed).toBe(true);
    drawWeapon(p);
    expect(p.weaponStowed).toBe(false);
    expect(toggleWeaponStow(p)).toBe(true);
    expect(toggleWeaponStow(p)).toBe(false);
  });

  it('refuses to sheathe while dead (mirrors /sit)', () => {
    const sim = makeSim();
    const p = sim.player;
    p.dead = true;
    expect(toggleWeaponStow(p)).toBe(false);
    expect(p.weaponStowed).toBe(false);
  });
});

describe('IWorld toggle + combat auto-unsheathe', () => {
  it('Sim.toggleWeaponStow flips the primary player and survives idle ticks', () => {
    const sim = makeSim();
    sim.toggleWeaponStow();
    expect(sim.player.weaponStowed).toBe(true);
    // Idle time and plain movement input never draw the weapon; only a
    // deliberate combat action does.
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(sim.player.weaponStowed).toBe(true);
    sim.toggleWeaponStow();
    expect(sim.player.weaponStowed).toBe(false);
  });

  it('engaging auto-attack draws the weapon', () => {
    const sim = makeSim('warrior');
    const wolf = nearestMob(sim, 'forest_wolf');
    teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.toggleWeaponStow();
    expect(sim.player.weaponStowed).toBe(true);
    sim.startAutoAttack();
    expect(sim.player.weaponStowed).toBe(false);
  });

  it('casting an ability draws the weapon', () => {
    const sim = makeSim('mage');
    const wolf = nearestMob(sim);
    teleportTo(sim, wolf.pos.x + 8, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.toggleWeaponStow();
    expect(sim.player.weaponStowed).toBe(true);
    sim.castAbility('fireball');
    expect(sim.player.weaponStowed).toBe(false);
  });
});

describe('persistence (JSONB back-compat)', () => {
  it('serializes only while sheathed and round-trips through addPlayer', () => {
    const sim = makeSim();
    const drawn = sim.serializeCharacter(sim.playerId);
    // Absent while drawn: pre-feature saves and unsheathed characters stay
    // byte-equal (the parity-stable save contract).
    expect(drawn && 'weaponStowed' in drawn).toBe(false);

    sim.toggleWeaponStow();
    const stowed = sim.serializeCharacter(sim.playerId);
    expect(stowed?.weaponStowed).toBe(true);

    const resume = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = resume.addPlayer('warrior', 'Resumer', { state: stowed ?? undefined });
    expect(resume.entities.get(pid)?.weaponStowed).toBe(true);
  });

  it('a save without the field loads with the weapon drawn', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('no state');
    expect('weaponStowed' in state).toBe(false); // the legacy-save shape
    const resume = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = resume.addPlayer('warrior', 'Legacy', { state });
    expect(resume.entities.get(pid)?.weaponStowed).toBe(false);
  });
});

// --- entity wire: the `ws` bit -------------------------------------------------

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

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
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
  return c;
}

describe('ClientWorld optimistic nudge', () => {
  it('respects the dead-gate locally and sends the stow_weapon token when alive', () => {
    (globalThis as any).WebSocket = { OPEN: 1 };
    const client = bareClient(7);
    const sent: any[] = [];
    (client as any).ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    const self = (extra: Record<string, unknown>) => ({
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Nudge',
      lv: 1,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 10,
      mhp: 10,
      ...extra,
    });
    // Dead: the local nudge must NOT flip (the command still goes up; the
    // server-side Sim dead-gate is authoritative).
    internals.applySnapshot({ self: self({ dead: 1 }), ents: [], keep: [] });
    client.toggleWeaponStow();
    expect(client.player.weaponStowed).toBe(false);
    // Alive: the nudge flips instantly and the typed send carries the token.
    internals.applySnapshot({ self: self({}), ents: [], keep: [] });
    client.toggleWeaponStow();
    expect(client.player.weaponStowed).toBe(true);
    expect(sent.filter((m) => m.t === 'cmd' && m.cmd === 'stow_weapon')).toHaveLength(2);
    // The next snapshot reconciles the optimistic state to the server's truth.
    internals.applySnapshot({ self: self({}), ents: [], keep: [] });
    expect(client.player.weaponStowed).toBe(false);
  });
});

describe('weaponStowed over the wire', () => {
  it('wireEntity carries ws:1 only while sheathed (absent-means-unset)', () => {
    const sim = makeSim();
    const drawn = wireEntity(sim.player);
    expect('ws' in drawn).toBe(false);
    sim.toggleWeaponStow();
    expect(wireEntity(sim.player).ws).toBe(1);
  });

  it('stow_weapon dispatch -> snapshot -> ClientWorld round-trips end to end', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Sheather');
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'stow_weapon' }));
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fc.sent);
    expect(snap.self.ws).toBe(1);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.player.weaponStowed).toBe(true);

    // Toggle back: the next snapshot omits the bit and the client re-draws.
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'stow_weapon' }));
    (server as any).broadcastSnapshots();
    const snap2 = lastSnap(fc.sent);
    expect('ws' in snap2.self).toBe(false);
    (client as any).applySnapshot(snap2);
    expect(client.player.weaponStowed).toBe(false);
  });
});
