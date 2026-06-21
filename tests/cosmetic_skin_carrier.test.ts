import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the creator-skin identity-carrier
// round-trip (server identity encode -> client snapshot decode) is under test
// alongside the pure-sim carrier behaviour.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // join() refreshes the holder tier (no linked wallet here -> tier 0, no quota work).
  walletForAccount: vi.fn(async () => null),
}));

import { GameServer, ClientSession } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import { recalcPlayerStats } from '../src/sim/entity';
import { MECH_CHROMAS } from '../src/sim/content/skins';
import { type PlayerClass } from '../src/sim/types';

// ---------------------------------------------------------------------------
// Sim core: the opaque id is stored, cleared, inert to stats, deterministic,
// and persisted — without the sim ever interpreting it.
// ---------------------------------------------------------------------------
describe('cosmetic skin carrier — sim core', () => {
  const makeSim = (cls: PlayerClass = 'warrior', seed = 4242) =>
    new Sim({ seed, playerClass: cls, autoEquip: true });

  it('setPlayerSkin stores the opaque cosmeticSkinId on both meta and entity', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBeNull();
    expect(sim.players.get(pid)!.cosmeticSkinId).toBeNull();

    sim.setPlayerSkin(pid, 0, 'class', 'creator_dragonscale');
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBe('creator_dragonscale');
    expect(sim.players.get(pid)!.cosmeticSkinId).toBe('creator_dragonscale');
  });

  it('selecting a built-in skin (no overlay arg) clears any creator overlay', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    sim.setPlayerSkin(pid, 0, 'class', 'creator_dragonscale');
    sim.setPlayerSkin(pid, 3, 'class');
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBeNull();
    // the numeric appearance still applies alongside the cleared overlay
    expect(sim.entities.get(pid)!.skin).toBe(3);
  });

  it('normalizes an empty-string overlay to null (never stores "")', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    sim.setPlayerSkin(pid, 0, 'class', '');
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBeNull();
  });

  it('caps the overlay id length at the sim setter — 64 kept, 65 dropped', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    const id64 = 'a'.repeat(64);
    sim.setPlayerSkin(pid, 0, 'class', id64);
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBe(id64);
    sim.setPlayerSkin(pid, 0, 'class', 'b'.repeat(65));
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBeNull();
  });

  it('setPlayerSkin on an unknown pid is a no-op that returns false', () => {
    const sim = makeSim();
    const before = sim.entities.size;
    expect(sim.setPlayerSkin(999_999, 0, 'class', 'creator_x')).toBe(false);
    expect(sim.entities.size).toBe(before); // no entity conjured for a missing player
  });

  it('clamps a mech skin index above range while keeping the owned overlay', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    sim.setPlayerSkin(pid, 999, 'mech', 'creator_keep'); // 999 >> MECH_CHROMAS range
    const e = sim.entities.get(pid)!;
    expect(e.skinCatalog).toBe('mech');
    expect(e.skin).toBe(MECH_CHROMAS.length - 1); // clamped, not 999
    expect(e.cosmeticSkinId).toBe('creator_keep');
  });

  it('cosmetic-only: recalcPlayerStats output is invariant under every skin permutation', () => {
    const sim = makeSim('mage');
    const pid = sim.primaryId;
    const e = sim.entities.get(pid)!;
    const meta = sim.players.get(pid)!;
    // Re-derive stats from class/gear/talents only; fingerprint the combat-
    // relevant outputs. skin/skinCatalog/cosmeticSkinId are not inputs, so this
    // must never move no matter how the appearance is set.
    const fingerprint = (): string => {
      recalcPlayerStats(e, meta.cls, meta.equipment, (sim as any).playerMods(meta));
      return JSON.stringify({
        maxHp: e.maxHp, maxResource: e.maxResource, attackPower: e.attackPower,
        rangedPower: e.rangedPower, critChance: e.critChance, dodgeChance: e.dodgeChance,
        resourceType: e.resourceType, stats: e.stats, weapon: e.weapon, scale: e.scale,
      });
    };
    const base = fingerprint();
    const permutations: Array<[number, 'class' | 'mech', string | null]> = [
      [0, 'class', null],
      [3, 'class', 'creator_a'],
      [0, 'mech', 'creator_b'],
      [7, 'class', null],
      [0, 'class', 'creator_c_with_a_long_uuid_like_value_0123456789'],
    ];
    for (const [skin, catalog, csk] of permutations) {
      sim.setPlayerSkin(pid, skin, catalog, csk);
      expect(fingerprint()).toBe(base);
    }
  });

  it('determinism: carrying a cosmeticSkinId never perturbs the simulation', () => {
    const fingerprintWorld = (sim: Sim): string => {
      const parts: string[] = [`t=${sim.tickCount}`];
      for (const [id, e] of [...sim.entities.entries()].sort((a, b) => a[0] - b[0])) {
        parts.push(`${id}:${e.pos.x.toFixed(4)},${e.pos.y.toFixed(4)},${e.pos.z.toFixed(4)},${e.hp},${e.facing.toFixed(4)}`);
      }
      return parts.join('|');
    };
    const run = (withCsk: boolean): string => {
      const sim = new Sim({ seed: 909090, playerClass: 'hunter', autoEquip: true });
      for (let i = 0; i < 240; i++) {
        if (i === 120 && withCsk) sim.setPlayerSkin(sim.primaryId, 2, 'class', 'creator_inert');
        sim.tick();
      }
      return fingerprintWorld(sim);
    };
    // Setting an (inert) opaque overlay mid-run leaves the world bit-identical.
    expect(run(true)).toBe(run(false));
  });

  it('persists cosmeticSkinId through serializeCharacter -> addPlayer(state)', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('rogue', 'Painter');
    sim.setPlayerSkin(pid, 2, 'class', 'creator_nebula');

    const state = sim.serializeCharacter(pid)!;
    expect(state.cosmeticSkinId).toBe('creator_nebula');

    const sim2 = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('rogue', 'Painter', { state });
    expect(sim2.entities.get(pid2)!.cosmeticSkinId).toBe('creator_nebula');
    expect(sim2.players.get(pid2)!.cosmeticSkinId).toBe('creator_nebula');
  });

  it('a pre-marketplace save (no cosmeticSkinId field) loads as null', () => {
    // Build a complete, valid save, then strip the field as an older save would lack it.
    const seed = new Sim({ seed: 12, playerClass: 'warrior', noPlayer: true });
    const seedPid = seed.addPlayer('mage', 'Legacy');
    const legacyState = seed.serializeCharacter(seedPid)!;
    delete (legacyState as any).cosmeticSkinId;

    const sim = new Sim({ seed: 12, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Legacy', { state: legacyState });
    expect(sim.entities.get(pid)!.cosmeticSkinId).toBeNull();
    expect(sim.players.get(pid)!.cosmeticSkinId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wire round-trip: the opaque id rides the identity record (full/changed only),
// is omitted when null, and decodes onto mirrored entities — mirroring the
// holder-tier flair broadcast harness.
// ---------------------------------------------------------------------------
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

function joinServer(server: GameServer, fc: FakeClient, characterId: number, name: string, cls: PlayerClass = 'warrior'): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.missingSince = new Map(); // interest-drop hysteresis (applySnapshot reads it)
  c.playerId = pid;
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
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
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
  return c;
}

describe('creator-skin identity broadcast round-trip', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Painter');
  });

  it('encodes csk in the self identity record when a creator skin is equipped', () => {
    server.sim.setPlayerSkin(session.pid, 0, 'class', 'creator_dragonscale');
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    expect(snap.self.csk).toBe('creator_dragonscale');
  });

  it('omits csk entirely for a player wearing only a built-in skin', () => {
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();
    broadcast(server);

    const snap = lastSnap(fc.sent);
    // the `if (e.cosmeticSkinId)` guard keeps the key off the wire
    expect(snap.self).not.toHaveProperty('csk');
  });

  it('round-trips a second player\'s csk through the full entity record both clients see', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Muralist', 'mage');
    server.sim.setPlayerSkin(other.pid, 0, 'class', 'creator_aurora');
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    // a first-sight record is "full": identity fields ride along
    expect(wire.k).toBe('player');
    expect(wire.csk).toBe('creator_aurora');

    // and the online client decodes the overlay onto the mirrored entity
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.cosmeticSkinId).toBe('creator_aurora');

    // DELTA INVARIANT: a later LITE record (identity fields omitted) must NOT wipe
    // the previously-decoded csk — absence means "unchanged", not "cleared".
    const lite = JSON.parse(JSON.stringify(snap));
    const rec = lite.ents.find((e: any) => e.id === other.pid);
    for (const k of ['k', 'tid', 'nm', 'lv', 'csk']) delete rec[k]; // strip identity → lite update
    (client as any).applySnapshot(lite);
    expect(client.entities.get(other.pid)!.cosmeticSkinId).toBe('creator_aurora'); // preserved
  });

  it('decodes csk into cosmeticSkinId on a raw full wire record', () => {
    const client = bareClient(99);
    const wire = {
      id: 42, k: 'player', tid: 'player', nm: 'Sovereign', lv: 60,
      x: 0, y: 0, z: 0, f: 0, hp: 100, mhp: 100, csk: 'creator_obsidian',
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    expect(client.entities.get(42)!.cosmeticSkinId).toBe('creator_obsidian');
  });

  it('defaults cosmeticSkinId to null when a record omits csk', () => {
    const client = bareClient(99);
    const wire = {
      id: 43, k: 'mob', tid: 'forest_wolf', nm: 'Forest Wolf', lv: 1,
      x: 0, y: 0, z: 0, f: 0, hp: 45, mhp: 45,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [wire] });

    expect(client.entities.get(43)!.cosmeticSkinId).toBeNull(); // w.csk ?? null
  });

  it('re-broadcasts a changed csk: equipping later resends a full identity record', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Equipper', 'mage');

    // first sight: no overlay -> full record, but no csk
    broadcast(server);
    let snap = lastSnap(fc.sent);
    let wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire).not.toHaveProperty('csk');

    // the player equips a creator skin -> identity changes -> a fresh full
    // record rides. Tick so the per-tick wire cache recomputes identityFields.
    server.sim.setPlayerSkin(other.pid, 0, 'class', 'creator_late');
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    snap = lastSnap(fc.sent);
    wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player'); // identity re-sent => full record
    expect(wire.csk).toBe('creator_late');
  });
});

// ---------------------------------------------------------------------------
// Equip gate: equipping a creator overlay is server-authoritative — gated on
// account ownership, never granted by the act of equipping.
// ---------------------------------------------------------------------------
describe('creator-skin equip gate (server-authoritative)', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Buyer');
  });

  const changeSkin = (msg: Record<string, unknown>) =>
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'change_skin', ...msg }));

  it('applies an owned creator overlay and clears it when a built-in skin is reselected', () => {
    session.accountCosmetics = { ...session.accountCosmetics, ownedCreatorSkinIds: ['creator_owned'] };

    changeSkin({ skin: 0, catalog: 'class', csk: 'creator_owned' });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBe('creator_owned');

    // selecting a built-in class skin (no csk) clears the overlay
    changeSkin({ skin: 3, catalog: 'class' });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();
    expect(server.sim.entities.get(session.pid)!.skin).toBe(3);
  });

  it('rejects an unowned overlay (forged id) yet still applies the built-in skin', () => {
    expect(session.accountCosmetics.ownedCreatorSkinIds).toEqual([]);

    changeSkin({ skin: 2, catalog: 'class', csk: 'creator_not_owned' });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();
    expect(server.sim.entities.get(session.pid)!.skin).toBe(2);
  });

  it('rejects an oversized overlay id (> 64 chars) even if it were somehow owned', () => {
    const huge = 'x'.repeat(65);
    session.accountCosmetics = { ...session.accountCosmetics, ownedCreatorSkinIds: [huge] };

    changeSkin({ skin: 0, catalog: 'class', csk: huge });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();
  });

  it('rejects an empty-string overlay even if it is "owned"', () => {
    session.accountCosmetics = { ...session.accountCosmetics, ownedCreatorSkinIds: [''] };
    changeSkin({ skin: 0, catalog: 'class', csk: '' });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();
  });

  it('accepts an owned overlay id at the exact 64-char boundary', () => {
    const id64 = 'c'.repeat(64);
    session.accountCosmetics = { ...session.accountCosmetics, ownedCreatorSkinIds: [id64] };
    changeSkin({ skin: 0, catalog: 'class', csk: id64 });
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBe(id64);
  });

  it('keeps an owned overlay across a mech-chroma equip the account owns', () => {
    // own both a creator overlay and a mech chroma, then equip the mech body
    session.accountCosmetics = {
      ...session.accountCosmetics,
      mechChromaIds: [MECH_CHROMAS[1].id],
      ownedCreatorSkinIds: ['creator_owned'],
    };
    changeSkin({ skin: 1, catalog: 'mech', csk: 'creator_owned' });
    const e = server.sim.entities.get(session.pid)!;
    expect(e.skinCatalog).toBe('mech');
    expect(e.skin).toBe(1);
    expect(e.cosmeticSkinId).toBe('creator_owned');
  });

  it('drops the whole command when skin is not a number (no overlay applied even if owned)', () => {
    session.accountCosmetics = { ...session.accountCosmetics, ownedCreatorSkinIds: ['creator_owned'] };
    changeSkin({ skin: '2', catalog: 'class', csk: 'creator_owned' }); // string skin -> rejected by the type guard
    const e = server.sim.entities.get(session.pid)!;
    expect(e.skin).toBe(0); // unchanged default
    expect(e.cosmeticSkinId).toBeNull();
  });

  it('a live applyCreatorSkinGrant opens the equip gate without a reconnect', () => {
    changeSkin({ skin: 0, catalog: 'class', csk: 'creator_new' }); // not owned yet -> rejected
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBeNull();

    server.applyCreatorSkinGrant(session.accountId, 'creator_new'); // the post-purchase grant
    expect(session.accountCosmetics.ownedCreatorSkinIds).toContain('creator_new');

    changeSkin({ skin: 0, catalog: 'class', csk: 'creator_new' }); // now it applies
    expect(server.sim.entities.get(session.pid)!.cosmeticSkinId).toBe('creator_new');
  });
});
