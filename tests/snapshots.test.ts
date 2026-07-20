import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; snapshot logic is under test.
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
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { saveCharacterState } from '../server/db';
import { type ClientSession, GameServer, wireEntity } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { mechHeldWeaponOverride, visualKeyFor } from '../src/render/characters/manifest';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import { DELVES, GATHER_NODES, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Aura, DT, type PlayerClass } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { absorbTotal } from '../src/ui/absorb_bar';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { isAuraDebuff } from '../src/ui/auras_view';
import { buildCraftingView } from '../src/ui/crafting_view';

const DELTA_KEYS = [
  'inv',
  'buyback',
  'equip',
  'qlog',
  'qdone',
  'lockouts',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
  'honor',
  'lhonor',
  'corpse',
];

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
  meta: Parameters<GameServer['join']>[7] = {},
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null, false, meta);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function eventTexts(sent: any[]): string[] {
  return sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev) => ev.type === 'log' || ev.type === 'error')
    .map((ev) => ev.text);
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
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

describe('self stat wire round-trip', () => {
  it('mirrors crit/haste rating from the self snapshot onto the paper-doll entity', () => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    internals.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'mage',
        nm: 'Caster',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        res: 0,
        mres: 100,
        rtype: 'mana',
        crat: 20,
        hrat: 150,
        hirat: 30,
      },
    });
    // Without the wire fields these read the blankEntity default 0 (the bug this guards).
    expect(client.player.critRating).toBe(20);
    expect(client.player.hasteRating).toBe(150);
    expect(client.player.hitRating).toBe(30);
  });

  it('backfills WARFARE fractions when an older server sends the legacy six-field stats shape', () => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    internals.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Veteran',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        stats: { str: 40, agi: 25, sta: 38, int: 10, spi: 12, armor: 300 },
      },
    });
    expect(client.player.stats).toMatchObject({
      str: 40,
      pvpOffense: 0,
      pvpDefense: 0,
    });
  });
});

describe('self talent wire decode (IWorldTalents facet)', () => {
  // Ported coverage from the mage-line branch: the client decodes the heavy `tal`
  // field, repairs the allocation, and re-derives spec/role/known/talentPoints
  // locally from the mirrored rows (display-only; the server stays authoritative).
  it('decodes the talent snapshot field and recomputes known from spec plus rows', () => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    const snapshotAlloc = {
      spec: 'prot',
      rows: { 8: 'war_row_die_by_the_sword', 17: 'war_row_recklessness' },
    };
    internals.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Tank',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        res: 0,
        mres: 100,
        rtype: 'rage',
        tal: {
          alloc: snapshotAlloc,
          loadouts: [{ name: 'MT', alloc: { spec: null, rows: {} }, bar: [] }],
          activeLoadout: 0,
        },
      },
    });
    expect(client.talents).toEqual(snapshotAlloc);
    expect(client.talentSpec).toBe('prot');
    expect(client.talentRole).toBe('tank'); // derived from the prot mastery, not the wire
    expect(client.loadouts.length).toBe(1);
    expect(client.activeLoadout).toBe(0);
    // known is re-derived locally: the prot signature plus the two row grants.
    expect(client.known.some((k) => k.def.id === 'shield_slam')).toBe(true);
    expect(client.known.some((k) => k.def.id === 'die_by_sword')).toBe(true);
    expect(client.known.some((k) => k.def.id === 'recklessness')).toBe(true);
    expect(client.talentPoints()).toEqual({ total: 6, spent: 2 });
  });
});

describe('spectate client POV', () => {
  it('follows observed self, aligns on entry and respawn, then restores identity', () => {
    const client = bareClient(1);
    const internals = client as unknown as {
      applySnapshot(snapshot: unknown): void;
      onMessage(raw: string): void;
    };
    internals.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Moderator',
        lv: 10,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        res: 0,
        mres: 100,
        rtype: 'rage',
      },
    });
    internals.onMessage(JSON.stringify({ t: 'spectate', name: 'Suspect' }));
    expect(client.spectating).toBe('Suspect');

    const snapshot = (facing: number, dead: boolean) => ({
      t: 'snap',
      ents: [],
      self: {
        id: 2,
        k: 'player',
        tid: 'rogue',
        nm: 'Suspect',
        lv: 10,
        x: 5,
        y: 0,
        z: 7,
        f: facing,
        hp: dead ? 0 : 100,
        mhp: 100,
        dead,
        res: dead ? 0 : 80,
        mres: 100,
        rtype: 'energy',
      },
    });

    internals.applySnapshot(snapshot(1.25, false));
    expect(client.playerId).toBe(2);
    expect(client.player.name).toBe('Suspect');
    expect(client.cfg.playerClass).toBe('rogue');
    expect(client.consumeSpectateFacing()).toBe(1.25);
    expect(client.consumeSpectateFacing()).toBeNull();

    internals.applySnapshot(snapshot(2.5, true));
    expect(client.consumeSpectateFacing()).toBeNull();
    internals.applySnapshot(snapshot(-0.75, false));
    expect(client.consumeSpectateFacing()).toBe(-0.75);
    expect(client.consumeSpectateFacing()).toBeNull();

    internals.onMessage(JSON.stringify({ t: 'spectate', name: null }));
    expect(client.spectating).toBeNull();
    expect(client.playerId).toBe(1);
    expect(client.player.name).toBe('Moderator');
    expect(client.cfg.playerClass).toBe('warrior');
    expect(client.consumeSpectateFacing()).toBeNull();
  });
});

describe('per-session isolation in the broadcast loop', () => {
  it('keeps broadcasting to healthy sessions when one session throws', () => {
    // Regression: the broadcast loop iterated every session unguarded, so a throw
    // while building one player's snapshot unwound the whole call and starved every
    // other session of its snapshot that tick (server/CLAUDE.md: one socket must
    // not crash the loop). forEachGuarded must isolate the bad session.
    const server = new GameServer();
    const before = fakeWs();
    const bad = fakeWs();
    const after = fakeWs();
    joinServer(server, before, 1, 'Before');
    const badSession = joinServer(server, bad, 2, 'Broken');
    // 'After' joins last, so it is iterated AFTER the throwing session: the real
    // regression is that this one used to be starved when 'Broken' threw.
    joinServer(server, after, 3, 'After');

    // Force a throw only while serializing the bad session's self payload.
    const original = (server as any).selfWireJson.bind(server);
    vi.spyOn(server as any, 'selfWireJson').mockImplementation((session: any, ...rest: any[]) => {
      if (session.pid === badSession.pid) throw new Error('corrupt self state');
      return original(session, ...rest);
    });

    expect(() => broadcast(server)).not.toThrow();
    // Both healthy sessions, on either side of the throw, still got a snapshot;
    // only the broken one was skipped.
    expect(lastSnap(before.sent)).not.toBeNull();
    expect(lastSnap(after.sent)).not.toBeNull();
    expect(lastSnap(bad.sent)).toBeNull();
  });
});

describe('raid lockouts over the wire', () => {
  it('ships a granted lockout in self.lockouts and ClientWorld mirrors it end to end', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Locked');
    const sim = (server as any).sim;
    const meta = sim.players.get(session.pid);
    const until = Date.now() + 5 * 60 * 60 * 1000;
    meta.raidLockouts.set('nythraxis_boss_arena', until);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.lockouts).toEqual({ nythraxis_boss_arena: until });

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const out = client.raidLockouts();
    expect(out.map((l) => l.id)).toEqual(['nythraxis_boss_arena']);
    expect(out[0].msRemaining).toBeGreaterThan(5 * 60 * 60 * 1000 - 5000);
  });

  it('clears the client lockout once the server-side entry has expired', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Expiring');
    const sim = (server as any).sim;
    const meta = sim.players.get(session.pid);
    meta.raidLockouts.set('nythraxis_boss_arena', Date.now() - 1000); // already past

    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.lockouts).toEqual({}); // server filters to future-only

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.raidLockouts()).toEqual([]);
  });
});

// The held-items-on-the-mech fix is client render, but it depends on four wire
// fields the server must ship for a player: class (tid), cosmetic body (cat),
// equipped mainhand (mh), and equipped offhand (oh). This drives the real server
// emit into the real client mirror and checks the visual layer's inputs.
describe('Combat Mech held weapon over the wire', () => {
  it('mirrors a Rogue mech with independent mainhand and offhand weapons', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    const pid = sim.playerId;
    sim.setPlayerLevel(20, pid);
    sim.setPlayerSkin(pid, 0, 'mech');
    sim.addItem('keen_dirk', 1, pid);
    sim.equipItem('keen_dirk', pid);
    const e = sim.entities.get(pid)!;
    expect(e.mainhandItemId).toBe('rusty_dagger');
    expect(e.offhandItemId).toBe('keen_dirk');

    // server emit
    const w = wireEntity(e);
    expect(w.tid).toBe('rogue'); // class drives visualKeyFor and the hand-layout override
    expect(w.cat).toBe('mech'); // cosmetic body
    expect(w.mh).toBe('rusty_dagger');
    expect(w.oh).toBe('keen_dirk');

    // client mirror: a DIFFERENT local player seeing this rogue-mech in the world
    const client = bareClient(pid + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = client.entities.get(e.id)!;
    expect(mirrored.templateId).toBe('rogue');
    expect(mirrored.skinCatalog).toBe('mech');
    expect(mirrored.mainhandItemId).toBe('rusty_dagger');
    expect(mirrored.offhandItemId).toBe('keen_dirk');

    // what the renderer derives from the mirrored entity
    expect(visualKeyFor(mirrored)).toBe('player_mech');
    const override = mechHeldWeaponOverride(mirrored.templateId as PlayerClass);
    expect(override?.weaponSlots).toEqual([0]);
    expect(override?.offhandSlot).toBe(1);
  });

  it('mirrors a winning Warrior mech with its real shield offhand', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const pid = sim.playerId;
    sim.setPlayerSkin(pid, 0, 'mech');
    sim.addItem('worn_sword', 1, pid);
    sim.equipItem('worn_sword', pid);
    const e = sim.entities.get(pid)!;

    const client = bareClient(pid + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [wireEntity(e)] });
    const mirrored = client.entities.get(e.id)!;
    expect(mirrored.skinCatalog).toBe('mech');
    expect(mirrored.mainhandItemId).toBe('worn_sword');
    expect(mirrored.offhandItemId).toBe('eastbrook_buckler');
    expect(visualKeyFor(mirrored)).toBe('player_mech');
    expect(mechHeldWeaponOverride(mirrored.templateId as PlayerClass)).toMatchObject({
      weaponSlots: [0],
      offhandSlot: 1,
    });
  });
});

// Operator-set account flair (the [AI] mark + an official streamer's links). The
// wire keys `ai` and `slk` ARE the protocol, so pin both halves together: the REAL
// server emit (wireEntity) into the REAL client mirror (applySnapshot). Pinning only
// the decode (a hand-built wire record) would let the server rename or drop the key
// with every test still green, which is exactly the hole this closes.
describe('account flair over the wire', () => {
  const LINKS = { twitch: 'https://twitch.tv/someone', youtube: 'https://youtu.be/abc' };

  it('mirrors the AI mark and the streamer links onto another player client', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const e = sim.player;
    // What the server stamps on the entity once an operator sets the flair
    // (GameServer.applyAccountFlairLive; the wireStreamerLinks gate runs there).
    e.aiAccount = true;
    e.streamerLinks = { ...LINKS };

    const wire = wireEntity(e);
    expect(wire.ai).toBe(1); // the wire key is `ai`, encoded as 1 (sparse)
    expect(wire.slk).toEqual(LINKS); // the wire key is `slk`

    // A DIFFERENT player's client seeing this streamer in the world.
    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    const mirrored = client.entities.get(e.id)!;
    expect(mirrored.aiAccount).toBe(true);
    expect(mirrored.streamerLinks).toEqual(LINKS);
  });

  it('leaves an ordinary player unmarked, with neither key on the wire', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const e = sim.player;

    const wire = wireEntity(e);
    // Absent, not `ai: 0` / `slk: {}`: an ordinary player's identity record must be
    // byte-unchanged by this feature, or every entity on screen pays for it.
    expect(wire).not.toHaveProperty('ai');
    expect(wire).not.toHaveProperty('slk');

    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    const mirrored = client.entities.get(e.id)!;
    expect(mirrored.aiAccount).toBe(false);
    expect(mirrored.streamerLinks).toBeUndefined();
  });

  it('drops a hostile link at the client boundary even if one reached the wire', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const e = sim.player;
    // The server gates this twice (admin write + wireStreamerLinks), so this record
    // cannot occur in production. The point is that the CLIENT re-sanitizes anyway:
    // a link that survives to a client must never reach window.open.
    const wire = { ...wireEntity(e), slk: { twitch: 'javascript:alert(1)' } };

    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    expect(client.entities.get(e.id)!.streamerLinks).toBeUndefined();
  });
});

// Corpse harvest claims over the wire. The corpse picker
// (src/game/corpse_loot_availability.ts) reads mob.harvestClaimedBy; offline the
// Sim entity carries it, so online the same field must ride the sparse terse key
// `hcb` or the online picker keeps offering already-claimed corpses. Same pin
// shape as the account-flair suite above: the REAL server emit (wireEntity) into
// the REAL client mirror (applySnapshot), never a hand-built wire record alone.
describe('corpse harvest claim over the wire', () => {
  function deadWolfCorpse(id: number): ReturnType<typeof createMob> {
    const template = MOBS.forest_wolf;
    const mob = createMob(id, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    return mob;
  }

  it('mirrors the claimer pid onto another player client via hcb', () => {
    const claimer = 42;
    const mob = deadWolfCorpse(9001);
    mob.harvestClaimedBy = claimer;

    const w = wireEntity(mob);
    expect(w.hcb).toBe(claimer);

    const client = bareClient(claimer + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    expect(client.entities.get(mob.id)!.harvestClaimedBy).toBe(claimer);
  });

  it('keeps an unclaimed corpse sparse: no hcb key, mirrored as null', () => {
    const mob = deadWolfCorpse(9002);

    const w = wireEntity(mob);
    // Absent, not `hcb: null`: an unclaimed corpse's record must be byte-unchanged
    // by this feature, so the per-entity delta cache keeps eliding it.
    expect(w).not.toHaveProperty('hcb');

    const client = bareClient(1);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    expect(client.entities.get(mob.id)!.harvestClaimedBy).toBeNull();
  });

  it('clears a stale mirrored claim when a later record arrives without hcb', () => {
    const mob = deadWolfCorpse(9003);
    mob.harvestClaimedBy = 42;

    const client = bareClient(1);
    (client as any).applySnapshot({ t: 'snap', ents: [wireEntity(mob)] });
    expect(client.entities.get(mob.id)!.harvestClaimedBy).toBe(42);

    // Respawn clears the claim server-side (src/sim/mob/lifecycle.ts); the next
    // record simply omits hcb, and the mirror must reset, not keep the stale pid.
    mob.harvestClaimedBy = null;
    (client as any).applySnapshot({ t: 'snap', ents: [wireEntity(mob)] });
    expect(client.entities.get(mob.id)!.harvestClaimedBy).toBeNull();
  });
});

describe('combat ratings over the wire', () => {
  it('mirrors Ranged Attack Power so online hunter attack-spell tooltips can scale', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.tick();
    const e = sim.player;
    expect(e.rangedPower).toBeGreaterThan(0);

    const wire = wireEntity(e);
    expect(wire.rp).toBe(e.rangedPower);

    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    const mirrored = client.entities.get(e.id)!;
    expect(mirrored.rangedPower).toBe(e.rangedPower);
  });
});

describe('delta snapshots', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Testa');
  });

  it('first snapshot carries the full self state', () => {
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    // a fresh session has an empty lastSent, so EVERY maybe() delta key rides the
    // first snapshot (even the null-valued ones like party/trade/bank); all 44 of them
    for (const key of ALL_DELTA_KEYS) {
      expect(snap.self, `self.${key} missing from first snapshot`).toHaveProperty(key);
    }
    expect(snap.self.party).toBeNull();
    expect(snap.self.trade).toBeNull();
    expect(Array.isArray(snap.self.inv)).toBe(true);
    expect(Array.isArray(snap.ents)).toBe(true);
  });

  it('mirrors account-wide cosmetic unlocks from self snapshots', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const joined = server.join(fc.ws, 1, 1, 'Cosmetic', 'warrior', null, false, {
      accountCosmetics: {
        completedQuestIds: ['q_aldrics_fallen_star'],
        mechChromaIds: ['amber_crimson'],
        weaponSkinIds: [],
        weaponSkinLoadout: {},
      },
    });
    if ('error' in joined) throw new Error(joined.error);
    const session = joined;
    session.blockListLoaded = true;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.cosmetics).toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.accountCosmetics).toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });
  });

  it('mirrors live cosmetic appearance catalog through snapshots', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const joined = server.join(fc.ws, 1, 1, 'Mechlive', 'shaman', null);
    if ('error' in joined) throw new Error(joined.error);
    const session = joined;
    session.blockListLoaded = true;
    server.sim.setPlayerSkin(session.pid, 0, 'mech');

    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.cat).toBe('mech');

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.player.skinCatalog).toBe('mech');
  });

  it('omits unchanged heavy fields from subsequent snapshots', () => {
    broadcast(server);
    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // This single-tick test stays on the decay-safe subset: cds and the timer-backed
    // keys (delve/arena timers, delveDaily) can re-emit after a real sim.tick(), so the
    // widened all-27 omission is proven by the no-op re-broadcast test instead.
    for (const key of DELTA_KEYS) {
      expect(snap.self, `self.${key} resent although unchanged`).not.toHaveProperty(key);
    }
    // the always-on fields are still present every snapshot
    for (const key of [
      'x',
      'z',
      'hp',
      'mhp',
      'res',
      'gcd',
      'pcd',
      'swing',
      'xp',
      'copper',
      'target',
    ]) {
      expect(snap.self).toHaveProperty(key);
    }
  });

  it('mirrors the swing timer to the online client for the swing-timer HUD bar', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.swingTimer = 1.7;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.swing).toBeCloseTo(1.7, 1);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.player.swingTimer).toBeCloseTo(1.7, 1);
  });

  it('mirrors the shared potion cooldown to the online client for the action-bar swipe', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.potionCdRemaining = 95.5;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.pcd).toBeCloseTo(95.5, 1);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.player.potionCdRemaining).toBeCloseTo(95.5, 1);
  });

  it('includes live aura and movement diagnostics in admin online rows', () => {
    const druidServer = new GameServer();
    const fc = fakeWs();
    const druid = joinServer(druidServer, fc, 10, 'Newkali', 'druid');
    const player = druidServer.sim.entities.get(druid.pid)!;
    druidServer.sim.setPlayerLevel(20, druid.pid);
    player.resource = player.maxResource;

    druidServer.sim.castAbility('travel_form', druid.pid);
    druidServer.sim.tick();

    const row = druidServer.liveSessions().find((p) => p.characterId === 10)!;
    expect(row.moveSpeedMultiplier).toBeCloseTo(1.4);
    expect(row.runSpeed).toBeCloseTo(9.8);
    expect(row.swimming).toBe(false);
    expect(row.auras).toContainEqual(
      expect.objectContaining({
        id: 'travel_form',
        name: 'Fleet Form',
        kind: 'form_travel',
        value: 1.4,
      }),
    );
  });

  it('sell command forwards bounded stack quantities', () => {
    const player = server.sim.entities.get(session.pid)!;
    const vendor = [...server.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    player.pos = { ...vendor.pos, x: vendor.pos.x + 2 };
    player.prevPos = { ...player.pos };
    server.sim.addItem('wolf_fang', 5, session.pid);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'wolf_fang', count: 3 }),
    );

    expect(server.sim.meta(session.pid)?.copper).toBe(12);
    expect(server.sim.countItem('wolf_fang', session.pid)).toBe(2);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'wolf_fang', count: 99 }),
    );

    expect(server.sim.meta(session.pid)?.copper).toBe(20);
    expect(server.sim.countItem('wolf_fang', session.pid)).toBe(0);
  });

  it('discard command mirrors inventory and quest progress changes', () => {
    const meta = server.sim.meta(session.pid)!;
    meta.questLog.set('q_widows', { questId: 'q_widows', counts: [10, 0], state: 'active' });
    server.sim.addItem('widow_venom_sac', 6, session.pid);
    broadcast(server);
    fc.sent.length = 0;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'discard', item: 'widow_venom_sac', count: 2 }),
    );
    broadcast(server);

    expect(server.sim.countItem('widow_venom_sac', session.pid)).toBe(4);
    expect(meta.questLog.get('q_widows')).toMatchObject({ counts: [10, 4], state: 'active' });
    const snap = lastSnap(fc.sent);
    // The wire mirrors the whole inventory (starter rations included); pin the
    // discarded stack's mirrored count.
    expect(snap.self.inv.filter((s: { itemId: string }) => s.itemId === 'widow_venom_sac')).toEqual(
      [{ itemId: 'widow_venom_sac', count: 4 }],
    );
    expect(snap.self.qlog).toEqual([{ questId: 'q_widows', counts: [10, 4], state: 'active' }]);
  });

  it('echoes the last processed input sequence in self snapshots', () => {
    server.handleMessage(session, JSON.stringify({ t: 'input', seq: 7, mi: { f: 1 } }));
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.ack).toBe(7);

    server.handleMessage(session, JSON.stringify({ t: 'input', seq: 6, mi: { f: 0 } }));
    fc.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fc.sent).self.ack).toBe(7);
  });

  it('turns echoed input acks into client latency samples', () => {
    const client = bareClient(1);
    const first = {
      id: 1,
      k: 'player',
      tid: 'player',
      nm: 'Testa',
      lv: 1,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };
    (client as any).pendingInputSeqSentAt.set(1, 100);
    (client as any).pendingInputSeqSentAt.set(2, 140);

    const oldPerf = (globalThis as any).performance;
    (globalThis as any).performance = { now: () => 200 };
    try {
      (client as any).applySnapshot({ t: 'snap', ents: [], self: { ...first, ack: 2 } });
    } finally {
      (globalThis as any).performance = oldPerf;
    }

    expect(client.consumeInputEchoSamples()).toEqual([100, 60]);
    expect(client.consumeInputEchoSamples()).toEqual([]);
  });

  it('snaps a dead mob to its respawn pose instead of interpolating from the corpse', () => {
    const client = bareClient(1);
    const corpse = {
      id: 99,
      k: 'mob',
      tid: 'forest_wolf',
      nm: 'Forest Wolf',
      lv: 1,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 0,
      mhp: 45,
      dead: true,
      h: true,
    };
    const respawned = {
      id: 99,
      tid: 'forest_wolf',
      nm: 'Forest Wolf',
      lv: 1,
      x: 10,
      y: 0,
      z: 0,
      f: 0,
      hp: 45,
      mhp: 45,
      dead: false,
      h: true,
    };

    const oldPerf = (globalThis as any).performance;
    (globalThis as any).performance = { now: () => 100 };
    try {
      (client as any).applySnapshot({ t: 'snap', ents: [corpse] });
      (globalThis as any).performance = { now: () => 125 };
      (client as any).applySnapshot({ t: 'snap', ents: [respawned] });
    } finally {
      (globalThis as any).performance = oldPerf;
    }

    const mob = client.entities.get(99)!;
    expect(mob.dead).toBe(false);
    expect(mob.pos.x).toBe(10);
    expect(mob.prevPos).toEqual(mob.pos);
  });

  it('resends a heavy field once it changes', () => {
    broadcast(server);
    fc.sent.length = 0;
    server.sim.addItem('baked_bread', 2, session.pid);
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('inv');
    expect(snap.self.inv.some((s: any) => s.itemId === 'baked_bread')).toBe(true);
    expect(snap.self).not.toHaveProperty('qlog');
    expect(snap.self).not.toHaveProperty('stats');
  });

  it('flushes mage row picks in the next heavy self snapshot', () => {
    const mageServer = new GameServer();
    const mageFc = fakeWs();
    const mage = joinServer(mageServer, mageFc, 9, 'Rowwire', 'mage');
    mageServer.sim.setPlayerLevel(5, mage.pid);

    broadcast(mageServer);
    const client = bareClient(mage.pid, 'mage');
    (client as any).applySnapshot(lastSnap(mageFc.sent));
    mageFc.sent.length = 0;
    broadcast(mageServer);
    expect(lastSnap(mageFc.sent).self).not.toHaveProperty('tal');

    mageFc.sent.length = 0;
    mageServer.handleMessage(
      mage,
      JSON.stringify({ t: 'cmd', cmd: 'selectTalentRow', level: 5, optionId: 'mag_r5_ice_floes' }),
    );
    broadcast(mageServer);

    const snap = lastSnap(mageFc.sent);
    expect(snap.self.tal.alloc).toEqual({ spec: null, rows: { 5: 'mag_r5_ice_floes' } });
    (client as any).applySnapshot(snap);
    expect(client.talents).toEqual({ spec: null, rows: { 5: 'mag_r5_ice_floes' } });
  });

  it('resends equip + inv on the next snapshot after an online unequip', () => {
    // A fresh warrior starts with worn_sword equipped in mainhand (its class
    // startWeapon). unequipItem returns the piece to bags via the sim's
    // addItemSilent, which (unlike the addItem/removeItem hub) does NOT bump
    // PlayerMeta.wireRev and emits only a log event, so the gated equip/inv block
    // is resent promptly only because unequip_item is a HEAVY_SELF_CMD. Without
    // that the client would show the item still equipped (and missing from bags)
    // until the ~2 s staggered safety refresh.
    const client = bareClient(session.pid);
    expect(server.sim.meta(session.pid)!.equipment.mainhand).toBe('worn_sword');

    // Flush the first full snapshot to the client so it has the equipped state,
    // then confirm the heavy block is quiet: with the gate on, a no-op
    // re-broadcast omits equip/inv (the staggered refresh is not due this tick),
    // so any later resend is the command dirtying the session, not the refresh.
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.equipment.mainhand).toBe('worn_sword');
    fc.sent.length = 0;
    broadcast(server);
    const quiet = lastSnap(fc.sent);
    expect(quiet.self).not.toHaveProperty('equip');
    expect(quiet.self).not.toHaveProperty('inv');

    // Unequip the mainhand and broadcast once: the very next snapshot must carry
    // the updated equip + inv, not wait for the safety refresh.
    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'unequip_item', slot: 'mainhand' }),
    );
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('equip');
    expect(snap.self).toHaveProperty('inv');
    expect(snap.self.equip.mainhand).toBeUndefined();
    expect(snap.self.inv.some((s: any) => s.itemId === 'worn_sword')).toBe(true);

    // and it round-trips: the client mirror clears the slot and shows it in bags.
    (client as any).applySnapshot(snap);
    expect(client.equipment.mainhand).toBeUndefined();
    expect(client.inventory.some((s) => s.itemId === 'worn_sword')).toBe(true);
  });

  it('instance payloads (masterwork and legacy quality) ride the inv snapshot verbatim', () => {
    // Phase 2 back-compat over the wire: the server sends the live
    // meta.inventory wholesale, so a masterwork copy's full payload (signer,
    // enchant marker, rolled.masterwork plus baked stats) and a legacy copy's
    // rolled.quality must both arrive on the client mirror byte-identical.
    // A future snapshot serializer that field-picks the instance would red
    // here before it could strip either generation.
    const masterwork = {
      signer: 'Testa',
      enchant: 'enchant_chest_stamina',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    };
    const legacy = { signer: 'Oldhand', rolled: { quality: 'rare' as const } };
    server.sim.addItemInstance('eastbrook_ritual_vestments', masterwork, session.pid);
    server.sim.addItemInstance('apprentice_staff', legacy, session.pid);

    broadcast(server);
    const snap = lastSnap(fc.sent);
    const wireMw = snap.self.inv.find((s: any) => s.itemId === 'eastbrook_ritual_vestments');
    const wireLegacy = snap.self.inv.find((s: any) => s.itemId === 'apprentice_staff');
    expect(wireMw?.instance).toEqual(masterwork);
    expect(wireLegacy?.instance).toEqual(legacy);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(
      client.inventory.find((s) => s.itemId === 'eastbrook_ritual_vestments')?.instance,
    ).toEqual(masterwork);
    expect(client.inventory.find((s) => s.itemId === 'apprentice_staff')?.instance).toEqual(legacy);
  });

  it('mirrors vendor buyback deltas to the client', () => {
    const wilkes = [...server.sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    const player = server.sim.entities.get(session.pid)!;
    player.pos.x = wilkes.pos.x + 2;
    player.pos.z = wilkes.pos.z;
    player.prevPos = { ...player.pos };
    server.sim.addItem('apprentice_staff', 1, session.pid);
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.vendorBuyback).toEqual([]);
    expect(client.consumeInventoryChanged()).toBe(true);

    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'sell', item: 'apprentice_staff' }),
    );
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('buyback');
    expect(snap.self.buyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);

    const buybackOnly = { ...snap, self: { ...snap.self } };
    delete buybackOnly.self.inv;
    (client as any).applySnapshot(buybackOnly);
    expect(client.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]);
    expect(client.consumeInventoryChanged()).toBe(true);
  });

  it('quest commands force a quest-state resync even when rejected', () => {
    broadcast(server);
    fc.sent.length = 0;
    // unknown quest: the sim rejects it and quest state does not change, but
    // the next snapshot must still carry quest fields so stale client UI
    // converges back to the server's truth
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'accept', quest: 'no_such_quest' }),
    );
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('qlog');
    expect(snap.self).toHaveProperty('qdone');
    expect(snap.self).not.toHaveProperty('inv');
  });

  it('rejected distant quest accepts resync the authoritative quest state', () => {
    broadcast(server);
    fc.sent.length = 0;
    const player = server.sim.entities.get(session.pid)!;
    player.pos.x = 0;
    player.pos.z = -40;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'accept', quest: 'q_wolves' }));
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.qlog).toEqual([]);
    expect(snap.self.qdone).toEqual([]);
  });

  it('dev quest completion resyncs qlog and qdone', () => {
    const previous = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    try {
      broadcast(server);
      fc.sent.length = 0;

      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'dev_complete_quest', quest: 'q_wolves' }),
      );
      broadcast(server);

      const snap = lastSnap(fc.sent);
      expect(snap.self).toHaveProperty('qlog');
      expect(snap.self).toHaveProperty('qdone');
      expect(snap.self.qlog).toEqual([]);
      expect(snap.self.qdone).toContain('q_wolves');
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = previous;
    }
  });

  it('each client gets full state on its own first snapshot', () => {
    broadcast(server);
    const fc2 = fakeWs();
    joinServer(server, fc2, 2, 'Testb');
    broadcast(server);
    const snapNew = lastSnap(fc2.sent);
    // a fresh session always receives the full self state: every registered delta key
    for (const key of ALL_DELTA_KEYS) {
      expect(snapNew.self, `self.${key} missing for fresh session`).toHaveProperty(key);
    }
    // the veteran session still gets deltas only
    const snapOld = lastSnap(fc.sent);
    expect(snapOld.self).not.toHaveProperty('inv');
    // both players spawn together, so each sees the other in ents
    expect(snapNew.ents.some((e: any) => e.id === session.pid)).toBe(true);
  });
});

describe('raid party wire', () => {
  let server: GameServer;
  let fcLeader: FakeClient;
  let leader: ClientSession;
  let fcMember: FakeClient;
  let member: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fcLeader = fakeWs();
    leader = joinServer(server, fcLeader, 1, 'Leada');
    fcMember = fakeWs();
    member = joinServer(server, fcMember, 2, 'Memba');
    // Form a party, then mark it a raid and split into two subgroups. The
    // convert-to-raid command gates on a full five-player party, so we set the
    // raid state directly: this test pins the WIRE serialization, not that gate.
    const sim = server.sim;
    sim.partyInvite(member.pid, leader.pid);
    sim.partyAccept(member.pid);
    const party = (sim as any).partyOf(leader.pid);
    party.raid = true;
    party.raidGroups.set(member.pid, 2);
  });

  it('self.party wire carries the raid flag and per-member subgroup', () => {
    broadcast(server);
    const snap = lastSnap(fcLeader.sent);
    expect(snap.self.party).not.toBeNull();
    // The raid flag must survive the wire so the HUD renders the raid roster.
    expect(snap.self.party.raid).toBe(true);
    // Every member must carry its subgroup so the social panel can bucket them.
    for (const m of snap.self.party.members) {
      expect(m, `member ${m.pid} missing group`).toHaveProperty('group');
    }
    const memberGroup = snap.self.party.members.find((m: any) => m.pid === member.pid)?.group;
    expect(memberGroup).toBe(2);
  });

  it('online ClientWorld mirrors raid roster from the wire', () => {
    broadcast(server);
    const snap = lastSnap(fcLeader.sent);
    const client = bareClient(leader.pid);
    (client as any).applySnapshot(snap);
    expect(client.partyInfo).not.toBeNull();
    expect(client.partyInfo?.raid).toBe(true);
    expect(client.partyInfo?.members.find((m) => m.pid === member.pid)?.group).toBe(2);
  });

  it('ships tactical frame fields and the authoritative connection state', () => {
    const entity = server.sim.entities.get(member.pid)!;
    const meta = server.sim.meta(member.pid)!;
    meta.talentMods.role = 'healer';
    entity.auras.push({
      id: 'power_word_shield',
      name: 'Psalm of Warding',
      kind: 'absorb',
      remaining: 6,
      duration: 12,
      value: 90,
      sourceId: member.pid,
      school: 'holy',
    });
    member.linkdead = true;

    broadcast(server);
    const snap = lastSnap(fcLeader.sent);
    const wired = snap.self.party.members.find((m: any) => m.pid === member.pid);
    expect(wired).toMatchObject({ absorb: 90, role: 'healer', connected: 0 });
    expect(wired.auras).toEqual([{ id: 'power_word_shield', kind: 'absorb', remaining: 6 }]);

    const client = bareClient(leader.pid);
    (client as any).applySnapshot(snap);
    expect(client.partyInfo?.members.find((m) => m.pid === member.pid)).toMatchObject({
      absorb: 90,
      role: 'healer',
      connected: 0,
    });
  });

  it('projects common party member history once per broadcast and refreshes same-tick broadcasts', () => {
    const server = new GameServer();
    const leaderClient = fakeWs();
    const leader = joinServer(server, leaderClient, 11, 'Leader');
    const memberClient = fakeWs();
    const member = joinServer(server, memberClient, 22, 'Member');
    const thirdClient = fakeWs();
    const third = joinServer(server, thirdClient, 33, 'Third');
    server.sim.partyInvite(member.pid, leader.pid);
    server.sim.partyAccept(member.pid);
    server.sim.partyInvite(third.pid, leader.pid);
    server.sim.partyAccept(third.pid);

    let historyReads = 0;
    for (const pid of [leader.pid, member.pid, third.pid]) {
      const entity = server.sim.entities.get(pid)!;
      let history = [{ tick: server.sim.tickCount, amount: 10 }];
      Object.defineProperty(entity, 'damageHistory', {
        configurable: true,
        get: () => {
          historyReads++;
          return history;
        },
        set: (next) => {
          history = next ?? [];
        },
      });
    }

    broadcast(server);
    expect(historyReads).toBe(3);

    const memberEntity = server.sim.entities.get(member.pid)!;
    memberEntity.hp = 777;
    broadcast(server);
    expect(historyReads).toBe(6);
    const memberRow = lastSnap(leaderClient.sent).self.party.members.find(
      (row: any) => row.pid === member.pid,
    );
    expect(memberRow.hp).toBe(777);
  });

  it('uses the observed player as the Echo viewer for a spectator party snapshot', () => {
    const moderatorClient = fakeWs();
    const moderator = joinServer(server, moderatorClient, 3, 'Modera');
    const target = server.sim.entities.get(member.pid)!;
    target.auras.push(
      {
        id: 'temporal_echo',
        name: 'Temporal Echo',
        kind: 'temporal_echo',
        remaining: 11.1,
        duration: 15,
        value: 0,
        sourceId: leader.pid,
        school: 'arcane',
      },
      {
        id: 'temporal_echo',
        name: 'Temporal Echo',
        kind: 'temporal_echo',
        remaining: 22.1,
        duration: 15,
        value: 0,
        sourceId: member.pid,
        school: 'arcane',
      },
    );
    (server as any).enterSpectate(moderator, leader);

    broadcast(server);

    const echoAurasFor = (client: FakeClient) => {
      const memberRow = lastSnap(client.sent).self.party.members.find(
        (row: any) => row.pid === member.pid,
      );
      return memberRow.auras.filter((row: any) => row.kind === 'temporal_echo');
    };
    expect(echoAurasFor(fcLeader)).toEqual([
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 12 },
    ]);
    expect(echoAurasFor(fcMember)).toEqual([
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 23 },
    ]);
    expect(echoAurasFor(moderatorClient)).toEqual([
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 12 },
    ]);
  });
});

describe('dungeon difficulty wire', () => {
  it('ships the selected dungeon difficulty and ClientWorld mirrors it', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Hero');
    server.sim.setDungeonDifficulty('heroic', session.pid);

    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap.self.ddiff).toBe('heroic');
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.dungeonDifficulty()).toBe('heroic');
  });

  it('dispatches set_dungeon_difficulty through the wire and rejects invalid values', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Hero');

    const send = (difficulty: unknown) =>
      server.handleMessage(
        session,
        JSON.stringify({ t: 'cmd', cmd: 'set_dungeon_difficulty', difficulty }),
      );

    send('heroic');
    expect(server.sim.dungeonDifficulty(session.pid)).toBe('heroic');

    // isDungeonDifficulty guards the dispatch arm: junk values change nothing.
    send('mythic');
    expect(server.sim.dungeonDifficulty(session.pid)).toBe('heroic');
    send(7);
    expect(server.sim.dungeonDifficulty(session.pid)).toBe('heroic');
    send(undefined);
    expect(server.sim.dungeonDifficulty(session.pid)).toBe('heroic');

    send('normal');
    expect(server.sim.dungeonDifficulty(session.pid)).toBe('normal');
  });

  it('dispatches heroic_buy through the wire and validates the itemId', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Hero');
    const send = (itemId: unknown) =>
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'heroic_buy', itemId }));

    // Junk payloads never reach the sim handler (typeof string guard).
    send(7);
    send(undefined);
    // A valid string flows through; far from the quartermaster the sim refuses
    // with an error event rather than granting anything.
    send('seal_of_the_nine_oaths');
    expect(server.sim.countItem('seal_of_the_nine_oaths', session.pid)).toBe(0);
  });
});

describe('restart countdown', () => {
  const restartMessages = [
    'Server restart in 10 minutes.',
    'Server restart in 5 minutes.',
    'Server restart in 2 minutes.',
    'Server restart in 1 minute.',
    'Server restart in 30 seconds.',
    'Server restart in 10 seconds.',
    'Server restarting now.',
  ];

  it('broadcasts the restart countdown to every connected player', () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const alice = fakeWs();
      const bob = fakeWs();
      joinServer(server, alice, 1, 'Alice');
      joinServer(server, bob, 2, 'Bob', 'mage');
      alice.sent.length = 0;
      bob.sent.length = 0;

      const result = server.startRestartCountdown();

      expect(result.started).toBe(true);
      expect(eventTexts(alice.sent)).toEqual(['Server restart in 10 minutes.']);
      expect(eventTexts(bob.sent)).toEqual(['Server restart in 10 minutes.']);

      vi.advanceTimersByTime(5 * 60_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages.slice(0, 2));

      vi.advanceTimersByTime(3 * 60_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages.slice(0, 3));

      vi.advanceTimersByTime(60_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages.slice(0, 4));

      vi.advanceTimersByTime(30_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages.slice(0, 5));

      vi.advanceTimersByTime(20_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages.slice(0, 6));

      vi.advanceTimersByTime(10_000);
      expect(eventTexts(alice.sent)).toEqual(restartMessages);
      expect(eventTexts(bob.sent)).toEqual(restartMessages);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a duplicate countdown until the active one completes', () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const fc = fakeWs();
      joinServer(server, fc, 1, 'Alice');
      fc.sent.length = 0;

      expect(server.startRestartCountdown().started).toBe(true);
      const duplicate = server.startRestartCountdown();
      expect(duplicate.started).toBe(false);
      expect(duplicate.active).toBe(true);

      vi.advanceTimersByTime(10 * 60_000);
      expect(server.startRestartCountdown().started).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('online movement input lifetime', () => {
  it('clears stale held movement when the websocket input stream goes quiet', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Spinner');

    server.handleMessage(
      session,
      JSON.stringify({
        t: 'input',
        seq: 1,
        mi: { f: 0, b: 0, tl: 1, tr: 0, sl: 0, sr: 0, j: 0 },
      }),
    );
    const meta = server.sim.meta(session.pid)!;
    expect(meta.moveInput.turnLeft).toBe(true);

    for (let i = 0; i < Math.floor(0.5 / DT); i++) server.sim.tick();
    (server as any).clearStaleInputs();
    expect(meta.moveInput.turnLeft).toBe(true);

    for (let i = 0; i < Math.ceil(0.35 / DT); i++) server.sim.tick();
    (server as any).clearStaleInputs();
    expect(meta.moveInput.turnLeft).toBe(false);
  });
});

describe('chat moderation', () => {
  it('rate-limits chat bursts per connected client before cooldown', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    fc.sent.length = 0;

    for (let i = 0; i < 6; i++) {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: `msg ${i}` }));
    }
    (server as any).routeEvents(server.sim.tick());

    const events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events.filter((ev) => ev.type === 'chat')).toHaveLength(5);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'You are sending messages too quickly. Slow down.',
      }),
    );
  });

  it('locks chat for 20 seconds after repeated over-limit messages', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    fc.sent.length = 0;

    for (let i = 0; i < 8; i++) {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: `msg ${i}` }));
    }
    (server as any).routeEvents(server.sim.tick());

    const events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events.filter((ev) => ev.type === 'chat')).toHaveLength(5);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        text: 'Chat locked for 20s because you are sending messages too quickly.',
      }),
    );
  });

  it('blocks hard-word (slur) messages and escalates warning -> mute', () => {
    const server = new GameServer();
    server.chatFilter.load({
      soft: [],
      hard: ['slurword'],
      config: { warningsBeforeMute: 1, muteLadderSeconds: [600] },
    });
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');

    // First offense: blocked entirely + warning; it never becomes a chat event.
    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'you are a slurword' }),
    );
    (server as any).routeEvents(server.sim.tick());
    let events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events.some((ev) => ev.type === 'chat')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: expect.stringContaining('Warning') }),
    );

    // Second offense: escalates to a timed mute.
    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'slurword strikes again' }),
    );
    events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: expect.stringContaining('muted') }),
    );

    // Now muted: even a clean message is dropped until the mute expires.
    fc.sent.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'hello everyone' }),
    );
    (server as any).routeEvents(server.sim.tick());
    events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events.some((ev) => ev.type === 'chat')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: expect.stringContaining('muted') }),
    );
  });

  it('leaves soft (cosmetic) words untouched server-side — clients mask them', () => {
    const server = new GameServer();
    server.chatFilter.load({
      soft: ['darn'],
      hard: [],
      config: { warningsBeforeMute: 1, muteLadderSeconds: [600] },
    });
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    fc.sent.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text: 'oh darn it' }));
    (server as any).routeEvents(server.sim.tick());
    const events = fc.sent.flatMap((msg) => (msg.t === 'events' ? msg.list : []));
    expect(events).toContainEqual(expect.objectContaining({ type: 'chat', text: 'oh darn it' }));
  });

  it('ships the soft word list to clients in the hello payload', () => {
    const server = new GameServer();
    server.chatFilter.load({
      soft: ['darn', 'heck'],
      hard: ['slurword'],
      config: { warningsBeforeMute: 1, muteLadderSeconds: [600] },
    });
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Testa');
    const hello = fc.sent.find((msg) => msg.t === 'hello');
    expect(hello.softWords).toEqual(['darn', 'heck']);
    // Hard words are enforcement-only and must never be shipped to the client.
    expect(JSON.stringify(hello)).not.toContain('slurword');
  });
});

describe('autosaves', () => {
  beforeEach(() => {
    vi.mocked(saveCharacterState).mockReset();
    vi.mocked(saveCharacterState).mockResolvedValue(true);
  });

  it('skips overlapping saveAll runs while saving each current session once', async () => {
    const server = new GameServer();
    joinServer(server, fakeWs(), 1, 'Testa');
    joinServer(server, fakeWs(), 2, 'Testb');
    joinServer(server, fakeWs(), 3, 'Testc');

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave.then(() => true));

    const firstRun = server.saveAll('test');
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(3);
    });

    await server.saveAll('test');
    expect(saveCharacterState).toHaveBeenCalledTimes(3);

    resolveFirstSave();
    await firstRun;

    const savedCharacterIds = vi.mocked(saveCharacterState).mock.calls.map((call) => call[0]);
    expect(savedCharacterIds.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('waits for an active autosave before running the shutdown save pass', async () => {
    const server = new GameServer();
    joinServer(server, fakeWs(), 1, 'Testa');
    joinServer(server, fakeWs(), 2, 'Testb');

    let resolveFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    vi.mocked(saveCharacterState).mockImplementationOnce(() => firstSave.then(() => true));

    const autosave = server.saveAll('autosave');
    await vi.waitFor(() => {
      expect(saveCharacterState).toHaveBeenCalledTimes(2);
    });

    const shutdown = server.saveAll('shutdown');
    await Promise.resolve();
    expect(saveCharacterState).toHaveBeenCalledTimes(2);

    resolveFirstSave();
    await autosave;
    await shutdown;

    const savedCharacterIds = vi.mocked(saveCharacterState).mock.calls.map((call) => call[0]);
    expect(savedCharacterIds.sort((a, b) => a - b)).toEqual([1, 1, 2, 2]);
  });
});

describe('/who command', () => {
  it('lists online players with class, level, realm, and zone metadata', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph', 'warrior');
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Bet', 'mage');
    server.sim.setPlayerLevel(7, other.pid);
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 2 players online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).toContain('Bet - level 7 mage - Eastbrook Vale');
  });

  it('hides ignored players and players who ignored the requester', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    const fcIgnored = fakeWs();
    const ignored = joinServer(server, fcIgnored, 2, 'Bet');
    const fcBlocking = fakeWs();
    const blocking = joinServer(server, fcBlocking, 3, 'Gimel');
    self.blockedIds = new Set([ignored.characterId]);
    blocking.blockedIds = new Set([self.characterId]);
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 1 player online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).not.toContain('Bet');
    expect(text).not.toContain('Gimel');
  });

  it('waits for the requester block list before showing online players', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    joinServer(server, fakeWs(), 2, 'Bet');
    self.blockListLoaded = false;
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    expect(eventTexts(fc.sent)).toContain(
      'Your block list is still loading. Try /who again in a moment.',
    );
  });

  it('omits players whose own block list is still loading', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const self = joinServer(server, fc, 1, 'Aleph');
    const pending = joinServer(server, fakeWs(), 2, 'Bet');
    pending.blockListLoaded = false;
    fc.sent.length = 0;

    server.handleMessage(self, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/who' }));

    const text = eventTexts(fc.sent).join('\n');
    expect(text).toContain('Who: 1 player online on Claudemoon.');
    expect(text).toContain('Aleph - level 1 warrior - Eastbrook Vale');
    expect(text).not.toContain('Bet');
  });
});

describe('client-side delta merge', () => {
  it('does not apply optimistic quest accept or completion state', () => {
    const client = bareClient(1);
    const sent: any[] = [];
    (client as any).ws = {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    };
    const oldWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    try {
      client.acceptQuest('q_wolves');
      expect(client.questLog.has('q_wolves')).toBe(false);
      expect(client.questState('q_wolves')).toBe('active');
      expect(sent).toContainEqual({ t: 'cmd', cmd: 'accept', quest: 'q_wolves' });

      (client as any).pendingQuestCommands.clear();
      client.questLog.set('q_wolves', { questId: 'q_wolves', counts: [8], state: 'ready' });
      client.turnInQuest('q_wolves');
      expect(client.questLog.has('q_wolves')).toBe(true);
      expect(client.questsDone.has('q_wolves')).toBe(false);
      expect(client.questState('q_wolves')).toBe('active');
      expect(sent).toContainEqual({ t: 'cmd', cmd: 'turnin', quest: 'q_wolves' });
    } finally {
      (globalThis as any).WebSocket = oldWebSocket;
    }
  });

  it('flushes changed movement immediately without resending unchanged frames', () => {
    const client = bareClient(1);
    const sent: any[] = [];
    (client as any).ws = {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    };
    const oldWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    try {
      Object.assign(client.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      });
      expect(client.flushInput(100)).toBe(true);
      expect(sent).toEqual([
        { t: 'input', seq: 1, mi: { f: 1, b: 0, tl: 0, tr: 0, sl: 0, sr: 0, j: 0 } },
      ]);

      expect(client.flushInput(105)).toBe(false);
      expect(sent).toHaveLength(1);

      Object.assign(client.moveInput, { forward: false, strafeRight: true });
      expect(client.flushInput(115)).toBe(false);
      expect(sent).toHaveLength(1);

      expect(client.flushInput(120)).toBe(true);
      expect(sent.at(-1)).toEqual({
        t: 'input',
        seq: 2,
        mi: { f: 0, b: 0, tl: 0, tr: 0, sl: 0, sr: 1, j: 0 },
      });
    } finally {
      (globalThis as any).WebSocket = oldWebSocket;
    }
  });

  it('reconstructs stacking-debuff stack counts from the wire (Armor Shear)', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({
      ents: [
        {
          id: 2,
          k: 'mob',
          tid: 'wolf',
          nm: 'Wolf',
          lv: 3,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 40,
          mhp: 40,
          auras: [
            {
              id: 'sunder_armor',
              name: 'Armor Shear',
              kind: 'sunder',
              rem: 30,
              dur: 30,
              stacks: 3,
            },
          ],
        },
      ],
    });
    const aura = client.entities.get(2)?.auras.find((a) => a.kind === 'sunder');
    expect(aura?.stacks, 'client should mirror the wire stack count').toBe(3);
  });

  it('reconstructs charge-limited aura charges from the wire (Thunder Ward)', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({
      ents: [
        {
          id: 3,
          k: 'player',
          tid: '',
          nm: 'Shaman',
          lv: 12,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 200,
          mhp: 200,
          auras: [
            {
              id: 'lightning_shield',
              name: 'Thunder Ward',
              kind: 'thorns',
              rem: 600,
              dur: 600,
              charges: 2,
            },
          ],
        },
      ],
    });
    const aura = client.entities.get(3)?.auras.find((a) => a.id === 'lightning_shield');
    expect(aura?.charges, 'client should mirror the wire charge count').toBe(2);
  });

  it('round-trips the aura caster id (src) so own-aura prominence works online', () => {
    // Drives the REAL server emit (wireEntity) into the REAL client mirror: a
    // regression that drops either the `src` emission or the online.ts decode
    // would silently decode every online aura to sourceId 0, degrading the
    // target strip's ownFirst dot/hot prominence online while offline keeps it
    // (the stacks/charges sibling pins above follow the same pattern).
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const e = sim.entities.get(sim.playerId)!;
    e.auras.push(
      {
        id: 'deep_wounds',
        name: 'Gaping Wounds',
        kind: 'dot',
        remaining: 9,
        duration: 9,
        value: 5,
        sourceId: 42,
        school: 'physical',
      },
      {
        id: 'battle_shout',
        name: 'Battle Shout',
        kind: 'buff_ap',
        remaining: 120,
        duration: 120,
        value: 20,
        sourceId: 0,
        school: 'physical',
      },
    );
    const w = wireEntity(e) as { auras: { id: string; src?: number }[] };
    expect(w.auras.find((a) => a.id === 'deep_wounds')?.src, 'server ships the caster id').toBe(42);
    expect(
      'src' in (w.auras.find((a) => a.id === 'battle_shout') ?? {}),
      'a sourceless aura omits src to stay lean',
    ).toBe(false);

    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    const mirrored = client.entities.get(e.id)?.auras;
    expect(
      mirrored?.find((a) => a.id === 'deep_wounds')?.sourceId,
      'client mirrors the caster id',
    ).toBe(42);
    expect(
      mirrored?.find((a) => a.id === 'battle_shout')?.sourceId,
      'an omitted src decodes to 0',
    ).toBe(0);
  });

  it('round-trips next-cast empowerment scope for online action-bar glows', () => {
    const sim = new Sim({ seed: 7, playerClass: 'priest', autoEquip: true });
    const e = sim.entities.get(sim.playerId)!;
    e.auras.push({
      id: 'pri_searing_light',
      name: 'Searing Light',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: e.id,
      school: 'holy',
      empowerAbilities: ['smite'],
    });
    const w = wireEntity(e) as { auras: { id: string; emp?: string[] }[] };
    expect(w.auras.find((a) => a.id === 'pri_searing_light')?.emp).toEqual(['smite']);

    const client = bareClient(e.id + 1000);
    (client as any).applySnapshot({ t: 'snap', ents: [w] });
    const aura = client.entities.get(e.id)?.auras.find((a) => a.id === 'pri_searing_light');
    expect(aura?.empowerAbilities).toEqual(['smite']);
  });

  it('snaps the interpolation anchor on a teleport but tweens normal moves', () => {
    const client = bareClient(1);
    const ent = (x: number, z: number) => ({
      id: 2,
      k: 'mob',
      tid: 'wolf',
      nm: 'Wolf',
      lv: 3,
      x,
      y: 0,
      z,
      f: 0,
      hp: 40,
      mhp: 40,
    });
    const apply = (x: number, z: number) => (client as any).applySnapshot({ ents: [ent(x, z)] });

    // first sight: anchor initialised to the spawn pose
    apply(10, 20);
    let e = client.entities.get(2)!;
    expect(e.prevPos).toMatchObject({ x: 10, z: 20 });

    // a normal step keeps the anchor behind the new pose so the renderer can
    // interpolate across the gap (anchor stays at the previous server pose)
    apply(12, 21);
    e = client.entities.get(2)!;
    expect(e.pos).toMatchObject({ x: 12, z: 21 });
    expect(e.prevPos.x).not.toBe(12);
    expect(e.prevPos.z).not.toBe(21);

    // a teleport is a discontinuity: the anchor snaps to the destination so
    // the entity does not streak across the map over the next interval
    apply(220, 240);
    e = client.entities.get(2)!;
    expect(e.pos).toMatchObject({ x: 220, z: 240 });
    expect(e.prevPos).toMatchObject({ x: 220, z: 240 });
  });

  it('keeps previous structures when delta fields are omitted', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Testa');
    const client = bareClient(session.pid);

    server.sim.addItem('conjured_water', 1, session.pid);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.inventory.length).toBeGreaterThan(0);
    const invRef = client.inventory;
    const qlogRef = client.questLog;
    const qdoneRef = client.questsDone;
    const cdsRef = client.player.cooldowns;

    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    // omitted fields neither reset nor get rebuilt
    expect(client.inventory).toBe(invRef);
    expect(client.questLog).toBe(qlogRef);
    expect(client.questsDone).toBe(qdoneRef);
    expect(client.player.cooldowns).toBe(cdsRef);

    fc.sent.length = 0;
    server.sim.addItem('baked_bread', 1, session.pid);
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.inventory).not.toBe(invRef);
    expect(client.inventory.some((s) => s.itemId === 'baked_bread')).toBe(true);
  });
});

describe('despawn grace (anti-flicker)', () => {
  // A full ("first sight") wire record carrying identity, so applyWire creates
  // the entity rather than skipping it as a half-initialized lite ghost.
  function fullWire(id: number, x: number, z: number, extra: Record<string, unknown> = {}) {
    return {
      id,
      k: 'player',
      tid: 'warrior',
      nm: `E${id}`,
      lv: 1,
      x,
      y: 0,
      z,
      f: 0,
      hp: 100,
      mhp: 100,
      ...extra,
    };
  }
  function snap(self: any, ents: any[], keep: number[] = []) {
    return { t: 'snap', tick: 1, time: 0, self, ents, keep };
  }

  let clock = 0;

  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains a far entity briefly missing from a snapshot, then drops it after the grace window', () => {
    const c = bareClient(1);
    const self = () => fullWire(1, 0, 0);

    // Establish: self plus a far entity riding the interest boundary (~95yd).
    (c as any).applySnapshot(snap(self(), [fullWire(2, 95, 0)]));
    expect(c.entities.has(2)).toBe(true);

    // Boundary churn: it drops out of the next snapshot. Held, not deleted.
    clock += 50;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(true);

    // Still gone, but within the grace window: still retained.
    clock += 200;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(true);

    // Gone past the grace window: now really removed.
    clock += 600;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(false);
  });

  it('clears the grace timer when the entity reappears (no flicker on re-entry)', () => {
    const c = bareClient(1);
    const self = () => fullWire(1, 0, 0);
    const ent2 = c.entities; // ref to the live map

    (c as any).applySnapshot(snap(self(), [fullWire(2, 95, 0)]));
    const created = ent2.get(2);

    clock += 50;
    (c as any).applySnapshot(snap(self(), [])); // briefly missing
    clock += 50;
    (c as any).applySnapshot(snap(self(), [fullWire(2, 96, 0)])); // back
    // Same entity object retained the whole time — the renderer never tore down
    // and rebuilt its view, so no visible flash.
    expect(ent2.get(2)).toBe(created);

    // Marker cleared, so a later miss starts a fresh grace window rather than
    // counting from the earlier one.
    clock += 5000;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(true);
  });

  it('treats a `keep`-listed entity as present (tier-throttle is never "missing")', () => {
    const c = bareClient(1);
    const self = () => fullWire(1, 0, 0);

    (c as any).applySnapshot(snap(self(), [fullWire(2, 95, 0)]));
    expect(c.entities.has(2)).toBe(true);

    // First a genuine omission so the grace timer is actually armed — without
    // this the `missingSince.has(2)` assertion below would be trivially false
    // and never exercise the keep-clears-timer path.
    clock += 50;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(true);
    expect((c as any).missingSince.has(2)).toBe(true);

    // Now a distance-tier-throttled snapshot omits it from `ents` but lists it
    // in `keep`, so it counts as seen — retained, and the armed grace timer is
    // cleared.
    clock += 50;
    (c as any).applySnapshot(snap(self(), [], [2]));
    expect(c.entities.has(2)).toBe(true);
    expect((c as any).missingSince.has(2)).toBe(false);

    // Because the timer was cleared, a genuine later miss starts a fresh grace
    // window (held now, not deleted as if it had been missing since the throttle).
    clock += 5000;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(true);
  });

  it('drops a close-range disappearance immediately (preserves instant stealth-vanish)', () => {
    const c = bareClient(1);
    const self = () => fullWire(1, 0, 0);

    (c as any).applySnapshot(snap(self(), [fullWire(2, 10, 0)]));
    expect(c.entities.has(2)).toBe(true);

    // A nearby enemy going stealth stops being observable and is omitted. It
    // must vanish at once — no grace for close-range disappearances.
    clock += 50;
    (c as any).applySnapshot(snap(self(), []));
    expect(c.entities.has(2)).toBe(false);
  });
});

// Guild name rides the identity wire (terse key `gd`) so nearby players' plates
// can show "<Guild>" under the name. setPlayerGuild is the server's only writer;
// offline/headless never call it, so the field stays ''.
describe('guild nameplate wire', () => {
  it('carries the guild name through wireEntity only when set', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Thaldrin');

    expect(wireEntity(sim.entities.get(pid)!).gd).toBeUndefined();

    sim.setPlayerGuild(pid, 'Silver Hand');
    expect(wireEntity(sim.entities.get(pid)!).gd).toBe('Silver Hand');

    // leaving the guild clears the field, so the line disappears for viewers
    sim.setPlayerGuild(pid, '');
    expect(wireEntity(sim.entities.get(pid)!).gd).toBeUndefined();
  });

  it('restores entity.guild on the client from a full record', () => {
    const client = bareClient(99);
    const base = {
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Brae',
      lv: 5,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [{ ...base, gd: 'Silver Hand' }] });
    expect(client.entities.get(7)?.guild).toBe('Silver Hand');

    // a later full record without `gd` means "no guild" → reset to ''
    (client as any).applySnapshot({ t: 'snap', ents: [base] });
    expect(client.entities.get(7)?.guild).toBe('');
  });
});

// The Book of Deeds active title rides the identity wire (key `title`, a deed
// id, never display text) so other players' titles reach nameplates/inspect.
// Emitted only when non-null (mobs and untitled players pay zero bytes); the
// sim validator (src/sim/deeds.ts setActiveTitle) is the only writer.
describe('active title wire (Book of Deeds)', () => {
  it('carries the title deed id through wireEntity only when set', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Thaldrin');
    const e = sim.entities.get(pid)!;
    const meta = sim.players.get(pid)!;
    expect(wireEntity(e).title).toBeUndefined();

    // earn a title-reward deed, then select it through the sim setter
    meta.deedsEarned.set('prog_veteran', '2026-07-08');
    sim.setActiveTitle('prog_veteran', pid);
    expect(wireEntity(e).title).toBe('prog_veteran');

    // clearing the title drops the key, so the line disappears for viewers
    sim.setActiveTitle(null, pid);
    expect(wireEntity(e).title).toBeUndefined();
  });

  it('restores entity.title on the client from a full record', () => {
    const client = bareClient(99);
    const base = {
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Brae',
      lv: 5,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [{ ...base, title: 'prog_veteran' }] });
    expect(client.entities.get(7)?.title).toBe('prog_veteran');

    // a later full record without `title` means "untitled" -> reset to null
    (client as any).applySnapshot({ t: 'snap', ents: [base] });
    expect(client.entities.get(7)?.title).toBeNull();
  });

  it('server dispatch shape-checks the payload and routes through the sim validator', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Titled');
    const sim = server.sim;
    const meta = sim.players.get(session.pid)!;
    const e = sim.entities.get(session.pid)!;
    meta.deedsEarned.set('prog_veteran', '2026-07-08');

    // a non-string, non-null payload never reaches the sim (silent no-op)
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: 42 }));
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBeNull();

    // a raw frame naming an UNEARNED deed is refused by the sim validator
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: 'prog_champion' }),
    );
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBeNull();

    // the earned title-reward deed is accepted and echoes on the snapshot
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: 'prog_veteran' }),
    );
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');
    broadcast(server);
    expect(lastSnap(fc.sent).self.atitle).toBe('prog_veteran');
  });

  it('the ClientWorld send frame round-trips through the server dispatch (key lockstep)', () => {
    // Drive the REAL ClientWorld send path (cmd -> rawCmd -> ws.send) and feed
    // the produced frame verbatim into server.handleMessage, so a key rename
    // on EITHER side (deedId vs anything else) reddens here instead of
    // silently no-oping in production.
    const outbox: string[] = [];
    const client = bareClient(1);
    (client as any).connected = true;
    (client as any).ws = { readyState: 1, send: (p: string) => outbox.push(p) };
    client.setActiveTitle('prog_veteran');
    client.setActiveTitle(null);
    expect(outbox.map((p) => JSON.parse(p))).toEqual([
      { t: 'cmd', cmd: 'deed_set_title', deedId: 'prog_veteran' },
      { t: 'cmd', cmd: 'deed_set_title', deedId: null },
    ]);

    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Lockstep');
    const meta = server.sim.players.get(session.pid)!;
    const e = server.sim.entities.get(session.pid)!;
    meta.deedsEarned.set('prog_veteran', '2026-07-08');
    server.handleMessage(session, outbox[0]); // the client-built select frame
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');
    server.handleMessage(session, outbox[1]); // the client-built clear frame
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBeNull();
  });

  it('a null payload through the server dispatch clears the title and echoes null', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Cleared');
    const sim = server.sim;
    const meta = sim.players.get(session.pid)!;
    const e = sim.entities.get(session.pid)!;
    meta.deedsEarned.set('prog_veteran', '2026-07-08');
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: 'prog_veteran' }),
    );
    expect(meta.activeTitle).toBe('prog_veteran');

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: null }),
    );
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBeNull();
    broadcast(server);
    expect(lastSnap(fc.sent).self.atitle).toBeNull();
  });

  it('a mid-session unlock re-emits deeds and dstats on the next snapshot', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Unlocks');
    const sim = server.sim;
    const meta = sim.players.get(session.pid)!;

    broadcast(server); // first snapshot: full self state
    sim.tick(); // a quiet tick: nothing deed-related changed
    fc.sent.length = 0;
    broadcast(server);
    const quiet = lastSnap(fc.sent);
    expect(quiet.self).not.toHaveProperty('deeds');
    expect(quiet.self).not.toHaveProperty('dstats');

    // a real evaluator grant mid-session (duelsWon 0 -> 1 crosses the
    // pvp_duel_first_win threshold) must reach the client on the NEXT
    // snapshot, not the ~2s staggered backstop
    sim.ctx.bumpDeedStat(meta, 'duelsWon', 1);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_duel_first_win')).toBe(true);
    fc.sent.length = 0;
    broadcast(server);
    const after = lastSnap(fc.sent);
    expect(after.self.deeds).toHaveProperty('pvp_duel_first_win');
    expect(after.self.dstats.counters.duelsWon).toBe(1);
    expect(after.self.renown).toBe(5); // exactly pvp_duel_first_win's renown, from a base of 0
  });

  it('a second client sees the first client entity title after the re-wire', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 1, 'Wearer');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Viewer');
    const sim = server.sim;
    sim.players.get(a.pid)!.deedsEarned.set('prog_veteran', '2026-07-08');

    // before the title: B's view of A carries no `title` key
    broadcast(server);
    const viewerB = bareClient(b.pid);
    (viewerB as any).applySnapshot(lastSnap(fcB.sent));
    expect(viewerB.entities.get(a.pid)?.title ?? null).toBeNull();

    // A selects the title; the identity change re-wires A as a full record on
    // the next tick (the per-entity wire cache re-serializes at most once per
    // sim tick, so the tick between command and broadcast mirrors production)
    server.handleMessage(
      a,
      JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: 'prog_veteran' }),
    );
    sim.tick();
    fcB.sent.length = 0;
    broadcast(server);
    (viewerB as any).applySnapshot(lastSnap(fcB.sent));
    expect(viewerB.entities.get(a.pid)?.title).toBe('prog_veteran');

    // A clears; the identity JSON loses the key, so A re-wires as a full
    // record WITHOUT `title` and B's mirror must return to null (the ?? null
    // default in the apply, not a stale carry-over)
    server.handleMessage(a, JSON.stringify({ t: 'cmd', cmd: 'deed_set_title', deedId: null }));
    sim.tick();
    fcB.sent.length = 0;
    broadcast(server);
    (viewerB as any).applySnapshot(lastSnap(fcB.sent));
    expect(viewerB.entities.get(a.pid)?.title).toBeNull();
  });

  it('a fresh player wires an empty earned map and null title that decode faithfully', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Fresh');
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // empty-value fidelity on the wire (the 40-key presence test above only
    // proves the keys ride the first snapshot)
    expect(snap.self.deeds).toEqual({});
    expect(snap.self.atitle).toBeNull();
    expect(snap.self.renown).toBe(0);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.deedsEarned.size).toBe(0);
    expect(client.activeTitle).toBeNull();
    expect(client.renown).toBe(0);
  });
});

// Equipped hand item ids ride the identity wire (terse keys `mh`/`oh`) so the
// renderer can show each player's held weapon models. Recomputed in
// recalcPlayerStats; the renderer maps them to GLBs (ITEM_WEAPON_VARIANTS).
describe('held weapon wire (mainhandItemId/offhandItemId)', () => {
  it('carries both equipped hand item ids through wireEntity', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Thaldrin');
    const e = sim.entities.get(pid)!;
    // a fresh warrior starts holding its class startWeapon
    expect(e.mainhandItemId).toBe('worn_sword');
    e.offhandItemId = 'eastbrook_buckler';
    expect(wireEntity(e).mh).toBe('worn_sword');
    expect(wireEntity(e).oh).toBe('eastbrook_buckler');
  });

  it('restores both held item ids on the client from a full record', () => {
    const client = bareClient(99);
    const base = {
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Brae',
      lv: 5,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };

    (client as any).applySnapshot({
      t: 'snap',
      ents: [{ ...base, mh: 'zealotsbane_blade', oh: 'eastbrook_buckler' }],
    });
    expect(client.entities.get(7)?.mainhandItemId).toBe('zealotsbane_blade');
    expect(client.entities.get(7)?.offhandItemId).toBe('eastbrook_buckler');

    // A later full record without either hand means "nothing equipped" → reset both.
    (client as any).applySnapshot({ t: 'snap', ents: [base] });
    expect(client.entities.get(7)?.mainhandItemId).toBeNull();
    expect(client.entities.get(7)?.offhandItemId).toBeNull();
  });
});

// Season 1 Armory: the active weapon-skin cosmetic rides the identity wire
// (terse key `wsk`, render-only like `mh`). Identity resend is a JSON compare,
// so an apply AND a detach must each produce a fresh full record for viewers;
// lite records leave the decoded value untouched.
describe('weapon skin wire (weaponSkinId)', () => {
  it('keeps the online optimistic bow and crossbow loadout mutually exclusive', () => {
    const client = bareClient(99);
    const internals = client as any;
    internals.connected = false;
    internals.accountCosmetics = {
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: ['winterbite', 'meteorlatch_crossbow'],
      weaponSkinLoadout: {},
    };
    internals.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 99,
        k: 'player',
        tid: 'hunter',
        nm: 'Ranger',
        lv: 5,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        mh: 'rusty_hatchet',
        res: 0,
        mres: 100,
        rtype: 'focus',
      },
    });

    client.changeWeaponSkin('winterbite', 'bow');
    client.changeWeaponSkin('meteorlatch_crossbow', 'crossbow');
    expect(client.player.weaponSkinLoadout).toEqual({ crossbow: 'meteorlatch_crossbow' });
    expect(client.accountCosmetics.weaponSkinLoadout).toEqual({
      crossbow: 'meteorlatch_crossbow',
    });

    client.changeWeaponSkin('winterbite', 'bow');
    expect(client.player.weaponSkinLoadout).toEqual({ bow: 'winterbite' });
    expect(client.accountCosmetics.weaponSkinLoadout).toEqual({ bow: 'winterbite' });
  });

  it('carries the active skin through wireEntity only while one is applied', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Thaldrin');
    const e = sim.entities.get(pid)!;
    expect(wireEntity(e).wsk).toBeUndefined();

    // a fresh warrior holds worn_sword (a sword), so the sword skin attaches
    expect(sim.setWeaponSkin(pid, 'ice_fang_sword')).toBe(true);
    expect(wireEntity(e).wsk).toBe('ice_fang_sword');

    // detaching drops the key from the wire entirely
    sim.setWeaponSkin(pid, null, 'sword');
    expect(wireEntity(e).wsk).toBeUndefined();
  });

  it('restores entity.weaponSkinId from a full record; a lite record preserves it', () => {
    const client = bareClient(99);
    const base = {
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Brae',
      lv: 5,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };

    (client as any).applySnapshot({ t: 'snap', ents: [{ ...base, wsk: 'ice_fang_sword' }] });
    expect(client.entities.get(7)?.weaponSkinId).toBe('ice_fang_sword');

    // a lite record (no identity fields) leaves the applied skin in place
    (client as any).applySnapshot({
      t: 'snap',
      ents: [{ id: 7, x: 1, y: 0, z: 1, f: 0, hp: 100, mhp: 100 }],
    });
    expect(client.entities.get(7)?.weaponSkinId).toBe('ice_fang_sword');

    // a later full record without `wsk` means "no skin applied" → reset to null
    (client as any).applySnapshot({ t: 'snap', ents: [base] });
    expect(client.entities.get(7)?.weaponSkinId).toBeNull();
  });

  it('broadcasts wsk to nearby sessions as a full record on apply and drops it on detach', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const joined = server.join(fcA.ws, 1, 1, 'Skinner', 'warrior', null, false, {
      accountCosmetics: {
        completedQuestIds: [],
        mechChromaIds: [],
        weaponSkinIds: ['ice_fang_sword'],
        weaponSkinLoadout: {},
      },
    });
    if ('error' in joined) throw new Error(joined.error);
    const a = joined;
    a.blockListLoaded = true;
    const fcB = fakeWs();
    joinServer(server, fcB, 2, 'Watcher');

    // Before the apply, B's first-sight full record of A carries no wsk.
    broadcast(server);
    const before = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    expect(before?.k).toBe('player');
    expect(before?.wsk).toBeUndefined();

    server.handleMessage(
      a,
      JSON.stringify({
        t: 'cmd',
        cmd: 'change_weapon_skin',
        skin: 'ice_fang_sword',
        wtype: 'sword',
      }),
    );
    fcB.sent.length = 0;
    server.sim.tick(); // the wire cache re-serializes identity once per sim tick
    broadcast(server);
    const applied = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    // identity changed, so B receives a FULL record (k present) with the skin
    expect(applied?.k).toBe('player');
    expect(applied?.wsk).toBe('ice_fang_sword');

    server.handleMessage(
      a,
      JSON.stringify({ t: 'cmd', cmd: 'change_weapon_skin', skin: null, wtype: 'sword' }),
    );
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const detached = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    // the detach re-sends identity too, now without the wsk key
    expect(detached?.k).toBe('player');
    expect(detached?.wsk).toBeUndefined();
  });
});

// Worn per-slot instance payloads ride the identity wire (terse key `eqi`,
// Professions 2.0 Phase 6) so the inspect window shows another player's
// masterwork/enchant rolls. Sparse exactly like `eq`: players only, present
// only while at least one worn piece carries a payload, absent otherwise (the
// no-bloat tooth: an instance-less player's identity record is byte-unchanged).
// `eqi` is an IDENTITY key, not a maybe() delta key, so it stays out of
// ALL_DELTA_KEYS; and like `eq` it is outside TERSE_TO_IWORLD scope (that map
// pins delta keys + self scalars only). End-to-end GameServer liveness plus
// clone-not-alias live in tests/inspect_instances.test.ts.
describe('equipped instance wire (eqi)', () => {
  const inst = { rolled: { masterwork: true, stats: { int: 3, spi: 1 } }, signer: 'Aldric' };

  it('carries eqi through wireEntity only while an instanced piece is worn', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Thaldrin');
    const e = sim.entities.get(pid)!;
    // The fresh auto-equipped worn set is all plain pieces: eq rides, eqi
    // stays off the wire entirely.
    expect(wireEntity(e).eq).toBeDefined();
    expect(wireEntity(e).eqi).toBeUndefined();

    sim.addItemInstance('eastbrook_ritual_vestments', structuredClone(inst), pid);
    sim.equipItem('eastbrook_ritual_vestments', pid);
    expect((wireEntity(e).eq as any).chest).toBe('eastbrook_ritual_vestments');
    expect(wireEntity(e).eqi).toEqual({ chest: inst });

    // Unequipping the one instanced piece drops the key again (sparse, like wsk).
    sim.unequipItem('chest', pid);
    expect(wireEntity(e).eqi).toBeUndefined();
  });

  it('strips non-cosmetic instance fields from the wire payload (data minimization)', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Yrsa');
    const e = sim.entities.get(pid)!;
    sim.addItemInstance(
      'eastbrook_ritual_vestments',
      {
        signer: 'Aldric',
        rolled: { masterwork: true, stats: { int: 3 } },
        boundTo: pid,
        charges: { mend: 2 },
      },
      pid,
    );
    sim.equipItem('eastbrook_ritual_vestments', pid);
    const wired = wireEntity(e).eqi as Record<string, Record<string, unknown>>;
    // Only the cosmetic inspect fields (signer, enchant, rolled) leave the
    // server; boundTo and charges are gameplay state no inspecting client
    // needs and must never ride the identity wire.
    expect(wired.chest.signer).toBe('Aldric');
    expect(wired.chest.rolled).toEqual({ masterwork: true, stats: { int: 3 } });
    expect(wired.chest.boundTo).toBeUndefined();
    expect(wired.chest.charges).toBeUndefined();
    expect(Object.keys(wired.chest).sort()).toEqual(['rolled', 'signer']);
  });

  it('restores equippedInstances from a full record, deep-cloned; an eqi-less full record resets', () => {
    const client = bareClient(99);
    const base = {
      id: 7,
      k: 'player',
      tid: 'warrior',
      nm: 'Brae',
      lv: 5,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };
    const wireInst = structuredClone(inst);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [{ ...base, eq: { chest: 'eastbrook_ritual_vestments' }, eqi: { chest: wireInst } }],
    });
    const e = client.entities.get(7)!;
    expect(e.equippedInstances).toEqual({ chest: inst });
    // Deep-cloned, never aliased: mutating the wire-parsed payload (a later
    // message could) must not reach the mirror, rolled.stats included.
    expect(e.equippedInstances.chest).not.toBe(wireInst);
    wireInst.rolled.stats.int = 99;
    expect(e.equippedInstances.chest?.rolled?.stats?.int).toBe(3);

    // A lite record (no identity fields) leaves the mirror in place.
    (client as any).applySnapshot({
      t: 'snap',
      ents: [{ id: 7, x: 1, y: 0, z: 1, f: 0, hp: 100, mhp: 100 }],
    });
    expect(client.entities.get(7)?.equippedInstances).toEqual({ chest: inst });

    // A later full record WITHOUT eqi means no worn piece carries a payload
    // anymore: the mirror resets to empty (the `eq` absent-key semantics).
    (client as any).applySnapshot({ t: 'snap', ents: [base] });
    expect(client.entities.get(7)?.equippedInstances).toEqual({});
  });
});

describe('delve self-state mirrors over the wire', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Delver');
  });

  function enterDelveOnServer(): void {
    const sim = server.sim;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const door = DELVES.collapsed_reliquary.doorPos;
    const p = sim.entities.get(session.pid)!;
    p.pos.x = door.x;
    p.pos.z = door.z;
    p.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.enterDelve('collapsed_reliquary', 'normal', session.pid);
  }

  it('geo-gates companion_upgrade and enter_delve to the board NPC door', () => {
    const sim = server.sim;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const meta = sim.meta(session.pid)!;
    meta.companionUpgrades.companion_tessa = 1;
    meta.delveMarks = 100;
    const p = sim.entities.get(session.pid)!;
    const door = DELVES.collapsed_reliquary.doorPos;
    const place = (x: number, z: number) => {
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = terrainHeight(x, z, sim.cfg.seed);
      p.prevPos = { ...p.pos };
    };
    // Far from Brother Halven: the upgrade command is rejected (rank unchanged)...
    place(door.x + 200, door.z);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'companion_upgrade', companionId: 'companion_tessa' }),
    );
    expect(meta.companionUpgrades.companion_tessa).toBe(1);
    // ...and enter_delve does not claim a run from across the world.
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'enter_delve',
        delveId: 'collapsed_reliquary',
        tierId: 'normal',
      }),
    );
    expect(sim.delveRunForPlayer(session.pid)).toBeNull();
    // Standing on the board door: the upgrade goes through.
    place(door.x, door.z);
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'companion_upgrade', companionId: 'companion_tessa' }),
    );
    expect(meta.companionUpgrades.companion_tessa).toBe(2);
  });

  it('sends drun + dcompanion on entering a delve and the client mirrors them', () => {
    enterDelveOnServer();
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).toHaveProperty('drun');
    expect(snap.self).toHaveProperty('dcompanion');
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.delveRun).not.toBeNull();
    expect(client.companionState?.companionId).toBe('companion_tessa');
  });

  it('mirrors delveMarks + delveClears + delveDaily to the client when they change', () => {
    enterDelveOnServer();
    broadcast(server);
    fc.sent.length = 0;
    server.sim.meta(session.pid)!.delveMarks = 5;
    const meta = server.sim.meta(session.pid)!;
    meta.delveClears['collapsed_reliquary:heroic'] = 1;
    meta.delveDaily.markClears = 2;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.dmarks).toBe(5);
    expect(snap.self.dclears['collapsed_reliquary:heroic']).toBe(1);
    expect(snap.self.delveDaily.markClears).toBe(2);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.delveMarks).toBe(5);
    expect(client.delveClears['collapsed_reliquary:heroic']).toBe(1);
    // the shop view resolves the heroic-gated rare as unlocked off the mirror
    expect(
      client.delveShopOffers('collapsed_reliquary').find((o: any) => o.requiresHeroicClear)
        ?.unlocked,
    ).toBe(true);
    expect(client.delveDaily.markClears).toBe(2);
  });

  it('does NOT resend drun on an unchanged delve-less first/second tick', () => {
    // Outside a delve, drun is null and must be omitted after the first send.
    broadcast(server);
    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self).not.toHaveProperty('drun');
  });

  it('clears drun + dcompanion (value to null) on leaving a delve and the client mirror follows', () => {
    enterDelveOnServer();
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.delveRun).not.toBeNull();
    fc.sent.length = 0;
    server.sim.leaveDelve(session.pid);
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.drun).toBeNull();
    expect(snap.self.dcompanion).toBeNull();
    (client as any).applySnapshot(snap);
    expect(client.delveRun).toBeNull();
    expect(client.companionState).toBeNull();
  });
});

describe('lockpick view rebuilds from events on the online client', () => {
  function sessionEvent(sid: string, col: number, visible: any[]) {
    return {
      type: 'lockpickSession',
      sessionId: sid,
      objectId: 77,
      w: 11,
      h: 6,
      col,
      row: 2,
      page: 1,
      pageCount: 1,
      tries: 1,
      triesTotal: 1,
      lootTier: 'premium',
      allowed: ['hardSet', 'set', 'steady', 'ease', 'drop'],
      visible,
      stepTimeoutMs: 20000,
    };
  }
  function feed(client: ClientWorld, ev: any) {
    (client as any).onMessage(JSON.stringify({ t: 'events', list: [ev] }));
  }

  it('builds on session, advances on step, ignores foreign sessions, clears on end', () => {
    const client = bareClient(1);
    (client as any).lockpickState = null;
    const v0 = [{ col: 0, row: 2, kind: 'channel' }];
    feed(client, sessionEvent('s1', 0, v0));
    expect(client.lockpickState).not.toBeNull();
    expect(client.lockpickState?.sessionId).toBe('s1');
    expect(client.lockpickState?.lootTier).toBe('premium');
    expect(client.lockpickState?.visible).toEqual(v0);

    // Step advances col + visible, leaves identity fields (w/h/lootTier) intact.
    const v1 = [{ col: 1, row: 3, kind: 'channel' }];
    feed(client, {
      type: 'lockpickStep',
      sessionId: 's1',
      col: 1,
      row: 3,
      page: 1,
      pageCount: 1,
      tries: 1,
      triesTotal: 1,
      result: 'advanced',
      visible: v1,
    });
    expect(client.lockpickState?.col).toBe(1);
    expect(client.lockpickState?.visible).toEqual(v1);
    expect(client.lockpickState?.w).toBe(11);
    expect(client.lockpickState?.lootTier).toBe('premium');

    // A step for a different session must not mutate the active view.
    feed(client, {
      type: 'lockpickStep',
      sessionId: 'OTHER',
      col: 9,
      row: 9,
      page: 1,
      pageCount: 1,
      tries: 1,
      triesTotal: 1,
      result: 'advanced',
      visible: [],
    });
    expect(client.lockpickState?.col).toBe(1);

    // End for the active session clears it; events still reach the HUD queue.
    feed(client, { type: 'lockpickEnd', sessionId: 's1', outcome: 'success', lootTier: 'premium' });
    expect(client.lockpickState).toBeNull();
    expect(client.drainEvents().length).toBeGreaterThan(0);
  });

  it('does not clear the view on a foreign lockpickEnd', () => {
    const client = bareClient(1);
    (client as any).lockpickState = null;
    feed(client, sessionEvent('s2', 0, []));
    feed(client, { type: 'lockpickEnd', sessionId: 'OTHER', outcome: 'fail' });
    expect(client.lockpickState).not.toBeNull();
    expect(client.lockpickState?.sessionId).toBe('s2');
  });
});

// ---------------------------------------------------------------------------
// W0a: full self-snapshot delta round-trip gate.
//
// `selfWireJson` (server/game.ts) emits its heavy "delta" fields through a
// `maybe(key, value)` closure that ships a key only when its serialized form
// changed since this session last received it; `applySnapshot` (src/net/
// online.ts) mirrors each with `if (s.X !== undefined)` (or the inline
// `s.X ?? e.X` form for `stats`/`weapon`). This is the single most fragile codec
// in the workstream, so we pin: (a) the exact registered key set against drift, (b) the
// terse-key -> IWorld-name rename map, (c) that every dirtied value round-trips
// onto the correct decode target, and (d) that a no-op re-broadcast omits all registered keys
// while the prior decoded value is preserved.
// ---------------------------------------------------------------------------

// The pinned set of the 49 `maybe(...)` delta keys, sorted. Cross-checked below
// against the live `maybe(...)` calls scraped from server/game.ts source, so a
// 49th unregistered delta key reddens this gate.
const ALL_DELTA_KEYS = [
  'achg',
  'arena',
  'atitle',
  'bags',
  'bank',
  'buyback',
  'cardDuel',
  'cds',
  'corpse',
  'cosmetics',
  'cprof',
  'dclears',
  'dcomp',
  'dcompanion',
  'deeds',
  'delveDaily',
  'df',
  'dfb',
  'dmarks',
  'drun',
  'dstats',
  'duel',
  'equip',
  'gprof',
  'honor',
  'inv',
  'lhonor',
  'lockouts',
  'lroll',
  'lrollg',
  'mail',
  'mailU',
  'market',
  'marks',
  'milestones',
  'mst',
  'ncd',
  'party',
  'prof',
  'qdone',
  'qlog',
  'renown',
  'sport',
  'stats',
  'tal',
  'tfocus',
  'trade',
  'vcup',
  'weapon',
] as const;

// The terse wire key -> IWorld member name rename map, in sorted order. The wire
// string IS the protocol (contract #4): a terse key renamed on one side passes tsc
// and most per-field tests but silently breaks the world, so this map is pinned and
// each target is validated as a survived value by the round-trip test below. It
// carries the always-present self scalars (res/mres/rtype/lxp/rxp/prk) plus every
// delta key whose IWorld name differs from its terse key (stats/weapon/delveDaily
// keep their name; tal fans out to several members and is asserted directly).
const TERSE_TO_IWORLD: Record<string, string> = {
  achg: 'abilityCharges',
  arena: 'arenaInfo',
  atitle: 'activeTitle',
  bags: 'bags',
  bank: 'bankInfo',
  buyback: 'vendorBuyback',
  cds: 'cooldowns',
  cosmetics: 'accountCosmetics',
  cprof: 'craftingIdentity',
  dclears: 'delveClears',
  dcomp: 'companionUpgrades',
  dcompanion: 'companionState',
  deeds: 'deedsEarned',
  df: 'dungeonFinderInfo',
  dfb: 'dungeonFinderBoard',
  dmarks: 'delveMarks',
  drun: 'delveRun',
  dstats: 'deedStats',
  duel: 'duelInfo',
  equip: 'equipment',
  gprof: 'gatheringProficiency',
  inv: 'inventory',
  lhonor: 'lifetimeHonor',
  lockouts: 'selfLockouts',
  lroll: 'lootRollPrompts',
  lrollg: 'lootRollGroup',
  lxp: 'lifetimeXp',
  mail: 'mailInfo',
  mailU: 'mailUnread',
  market: 'marketInfo',
  marks: 'markers',
  milestones: 'unlockedMilestones',
  mres: 'maxResource',
  mst: 'activeMobileStationCraft',
  party: 'partyInfo',
  prk: 'prestigeRank',
  prof: 'professionsState',
  qdone: 'questsDone',
  qlog: 'questLog',
  res: 'resource',
  rtype: 'resourceType',
  rxp: 'restedXp',
  sport: 'sportRole',
  tfocus: 'townFocus',
  vcup: 'cupInfo',
};

// Year ~2223 in epoch ms. Beats selfWireJson's `until > Date.now()` lockout
// filter without a wall-clock read in test scaffolding.
const FAR_FUTURE_MS = 8_000_000_000_000;

// Dirty every one of the registered `maybe()` delta fields with a distinguishable,
// non-default value so the round-trip + no-op-omission assertions are meaningful
// (a fresh session carries all of them on snapshot #1 regardless, since lastSent is
// empty). Most fields are set on their real PlayerMeta/Entity/session source;
// for the few whose authentic setup is mutually exclusive in one player state we
// poke the exact source field the encoder reads, per the brief (the gate asserts
// the CODEC, not gameplay validity, which the parity/sim suites own):
//   - `dcompanion`: the delve companion auto-spawns only for a `solo:` run, which
//     a 2-player party precludes; we attach `run.companion` directly.
//   - `marks`: setMarker requires a hostile-mob target the delve instance does
//     not hand us deterministically; we seed the party's marker map directly.
//   - `market`: marketInfoFor is null unless near the Merchant, so we relocate
//     the Merchant entity onto the (in-delve) player.
function dirtyEveryDeltaField(): {
  server: GameServer;
  fc: FakeClient;
  leader: ClientSession;
  memberPid: number;
} {
  const server = new GameServer();
  const fc = fakeWs();
  const leader = joinServer(server, fc, 1, 'Alld');
  const fcMember = fakeWs();
  const member = joinServer(server, fcMember, 2, 'Memb', 'mage');
  const sim = server.sim;
  const lp = leader.pid;
  const mp = member.pid;
  const meta = sim.meta(lp)!;

  // Real 2-player party (party) and a real delve run (drun).
  sim.partyInvite(mp, lp);
  sim.partyAccept(mp);
  sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, lp);
  const door = DELVES.collapsed_reliquary.doorPos;
  const pDoor = sim.entities.get(lp)!;
  pDoor.pos.x = door.x;
  pDoor.pos.z = door.z;
  pDoor.pos.y = terrainHeight(door.x, door.z, sim.cfg.seed);
  pDoor.prevPos = { ...pDoor.pos };
  sim.enterDelve('collapsed_reliquary', 'normal', lp);
  const p = sim.entities.get(lp)!;

  // Poke the encoder's exact sources for the mutually-exclusive cases.
  const run = sim.delveRunForPlayer(lp) as any;
  run.companion = { companionId: 'companion_tessa', entityId: mp };
  const party = (sim as any).partyOf(lp);
  (sim as any).targeting.partyMarkers.set(party.id, new Map([[mp, 3]]));
  const merchant = sim.entities.get(sim.market.merchantIds[0]);
  if (merchant) merchant.pos = { ...p.pos };
  // `mail`: mailInfoFor is null unless near a mailbox, so relocate one onto the
  // player. `mailU` is already non-zero: every fresh character got the one-time
  // Ravenpost welcome letter (delay 0) at join.
  const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
  if (mailbox) mailbox.pos = { ...p.pos };
  // `bank`: bankInfoFor is null unless near a banker, so relocate a bursar onto the
  // player; a stocked bank slot makes the mirrored contents distinguishable.
  const banker = sim.entities.get(sim.bankerIds[0]);
  if (banker) banker.pos = { ...p.pos };
  meta.bank.inventory = [{ itemId: 'wolf_fang', count: 2 }];

  // Direct PlayerMeta fields.
  meta.inventory = [{ itemId: 'baked_bread', count: 3 }];
  meta.vendorBuyback = [{ itemId: 'apprentice_staff', count: 1 }];
  meta.equipment = { ...meta.equipment, mainhand: 'zealotsbane_blade' };
  meta.questLog.set('q_widows', { questId: 'q_widows', counts: [10, 0], state: 'active' });
  meta.questsDone.add('q_wolves');
  meta.raidLockouts.set('nythraxis_boss_arena', FAR_FUTURE_MS);
  meta.unlockedMilestones.add('milestone_test');
  meta.lifetimeXp = 555;
  meta.honor = 321;
  meta.lifetimeHonor = 654;
  meta.restedXp = 222;
  meta.prestigeRank = 3;
  meta.delveMarks = 7;
  meta.delveClears = { 'collapsed_reliquary:heroic': 1 };
  meta.companionUpgrades = { companion_tessa: 2 };
  meta.gatheringProficiency = { mining: 6, logging: 0, herbalism: 0 };
  meta.craftSkills.armorcrafting = 31;
  meta.craftSkills.weaponcrafting = 29;
  meta.archetype = {
    activeArchetype: 'armorcrafting',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'leatherworking',
    attunedPairs: ['weaponcrafting+armorcrafting'],
    switchCount: 2,
    amendsProgress: 4,
  };
  // An ACTIVE mobile crafting station (Phase 8, `mst`): set directly on the
  // meta slot (the placement command's specialization gate is pinned in
  // tests/professions_crafting_hub.test.ts; this suite pins the WIRE mirror),
  // far from expiry so the server-side liveness check reads it active.
  meta.mobileStation = {
    playerId: 'Alld',
    craftId: 'armorcrafting',
    pos: { x: 1, z: 2 },
    placedAtTick: sim.tickCount,
    expiresAtTick: sim.tickCount + 12000,
  };
  // Per-player gather-node respawn cooldown (#1866): one node still cooling
  // down (readyAt 30s in the sim future), so `ncd` mirrors it as ~30 remaining
  // seconds and nodeHarvestableByMe reports it not ready.
  meta.nodeHarvestReadyAt[GATHER_NODES[0].id] = sim.time + 30;
  meta.delveDaily = { date: '2099-01-01', firstClearXp: new Set(['x']), markClears: 4 };
  meta.talents = { spec: 'arms', rows: {} };
  // Book of Deeds: two earned deeds with DISTINCT utcDay stamps (an empty map
  // would be a vacuous pin), a non-zero stat block covering the counter, both
  // sets, and a clear record, a renown total, and an active title
  // (prog_veteran carries a title reward, so the sim setter would accept it).
  meta.deedsEarned.set('prog_first_steps', '2026-07-01');
  meta.deedsEarned.set('prog_veteran', '2026-07-08');
  meta.deedStats.counters.kills = 7;
  meta.deedStats.itemsDiscovered.add('wolf_fang');
  meta.deedStats.visited.add('npc:chronicler_saul');
  meta.deedStats.dungeonClears.hollow_crypt = 2;
  meta.renown = 15;
  meta.activeTitle = 'prog_veteran';
  // the Vale Cup sport kit swap ('sport' heavy key) and queue readout ('vcup')
  meta.sportRole = 'keeper';
  meta.talentMods.spec = 'arms';
  meta.loadouts = [{ name: 'PvP', alloc: { spec: 'arms', rows: {} }, bar: [] }];
  meta.activeLoadout = 0;

  // Session-scoped account cosmetics.
  leader.accountCosmetics = {
    completedQuestIds: ['q_aldrics_fallen_star'],
    mechChromaIds: ['amber_crimson'],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  };

  // Player Entity fields.
  p.cooldowns.set('heroic_strike', 5);
  p.abilityCharges = {
    ice_block: { charges: 1, maxCharges: 2, recharge: 10, rechargeLength: 240 },
  };
  p.stats = { ...p.stats, str: 12345, pvpOffense: 0.17, pvpDefense: 0.13 };
  p.weapon = { ...p.weapon, min: 999 };
  p.resource = 42;
  p.maxResource = 150;
  // corpse: the ghost-run body marker (self-only delta). Non-null = a ghost with a
  // body to run back to; the encoder reads p.corpsePos via maybe('corpse', ...).
  p.corpsePos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };

  // Trade / duel / loot-roll: poke the exact collections the encoder reads.
  sim.trades.set(lp, {
    a: lp,
    b: mp,
    offerA: { items: [], copper: 10 },
    offerB: { items: [], copper: 0 },
    acceptedA: true,
    acceptedB: false,
  });
  sim.duels.set(lp, { a: lp, b: mp, state: 'countdown', timer: 3 });
  (sim as any).pendingLootRolls.set(1, {
    id: 1,
    itemId: 'baked_bread',
    itemName: 'Baked Bread',
    quality: 'common',
    expiresAt: 9999,
    candidates: [lp],
    partyMembers: [lp, mp],
    choices: new Map(),
  });

  return { server, fc, leader, memberPid: mp };
}

describe('full self-state snapshot delta fixture', () => {
  it('mirrors an exact pair and completes the online combo craft command end to end', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 71, 'Combo');
    const meta = server.sim.meta(session.pid)!;
    meta.craftSkills.armorcrafting = 25;
    meta.craftSkills.weaponcrafting = 25;
    meta.archetype = {
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 0,
      amendsProgress: 0,
    };
    meta.inventory = [
      { itemId: 'bone_fragments', count: 4 },
      { itemId: 'linen_scrap', count: 2 },
    ];
    // Phase 9 acquisition switch: combo recipes are trainer-taught now, so a
    // fresh test player must learn this one explicitly before crafting it.
    meta.knownRecipes.add('recipe_ironbound_warplate_helm');

    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    const recipe = COMBO_RECIPES.find((entry) => entry.id === 'recipe_ironbound_warplate_helm')!;
    const view = buildCraftingView(
      [recipe],
      client.inventory,
      ITEMS,
      client.craftSkills,
      client.craftingIdentity,
    );
    expect(client.craftingIdentity.synced).toBe(true);
    expect(view.recipes[0].craftable).toBe(true);

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'craft_item', recipe: recipe.id }),
    );
    expect(server.sim.countItem(recipe.resultItemId, session.pid)).toBe(1);
  });

  it('train_recipe online: fee hits the self copper and the SORTED knownRecipes rides the cprof delta', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 72, 'Trainee');
    const meta = server.sim.meta(session.pid)!;
    meta.craftSkills.armorcrafting = 25; // ironbound is armorcrafting
    meta.craftSkills.weaponcrafting = 25; // forgeguard is weaponcrafting
    meta.copper = 10000;
    // Stand at the Eastbrook forge: training is gated on the STATIC station.
    const player = server.sim.entities.get(session.pid)!;
    player.pos = { ...player.pos, x: 7, z: 16.5 };
    player.prevPos = { ...player.pos };

    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.craftingIdentity.knownRecipes).toEqual([]);

    // Learn the two forge combos in REVERSE alphabetical order: the mirror
    // must come back SORTED (the stable-signature contract), never insertion
    // ordered, and each train charges its 2500 fee exactly once.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'train_recipe', recipe: 'recipe_ironbound_warplate_helm' }),
    );
    server.handleMessage(
      session,
      JSON.stringify({
        t: 'cmd',
        cmd: 'train_recipe',
        recipe: 'recipe_forgeguard_bulwark_gauntlets',
      }),
    );
    expect(server.sim.meta(session.pid)?.copper).toBe(5000);

    fc.sent.length = 0;
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    // Liveness: the ClientWorld read surface reflects the grant with NO
    // explicit dirty-marking anywhere in the dispatch case (knownRecipes is
    // part of craftingIdentityFor's JSON, so the cprof maybe() diff fires).
    expect(client.craftingIdentity.knownRecipes).toEqual([
      'recipe_forgeguard_bulwark_gauntlets',
      'recipe_ironbound_warplate_helm',
    ]);
    expect(client.copper).toBe(5000);
  });

  it('carries every one of the dirtied delta keys on the first snapshot', () => {
    const { server, fc } = dirtyEveryDeltaField();
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    for (const key of ALL_DELTA_KEYS) {
      expect(snap.self, `self.${key} missing from first snapshot`).toHaveProperty(key);
      // each was dirtied to a non-default value, so none rides the wire as null
      expect(snap.self[key], `self.${key} arrived null`).not.toBeNull();
    }
  });

  it('mirrors every dirtied self value onto the correct decode target', () => {
    const { server, fc, leader, memberPid } = dirtyEveryDeltaField();
    broadcast(server);
    const client = bareClient(leader.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    // --- fields that decode onto the player ENTITY (client.player), not the client ---
    expect(client.player.cooldowns.get('heroic_strike')).toBe(5); // cds -> e.cooldowns
    expect(client.player.abilityCharges?.ice_block?.charges).toBe(1); // achg -> e.abilityCharges
    expect(client.player.stats).toMatchObject({
      str: 12345,
      pvpOffense: 0.17,
      pvpDefense: 0.13,
    }); // stats (inline s.X ?? e.X, legacy-safe object replacement)
    expect(client.player.weapon).toMatchObject({ min: 999 }); // weapon (inline s.X ?? e.X)
    expect(client.player.resource).toBe(42); // res -> resource
    expect(client.player.maxResource).toBe(150); // mres -> maxResource
    expect(client.player.resourceType).toBe('rage'); // rtype -> resourceType

    // --- always-present scalar renames ---
    expect(client.lifetimeXp).toBe(555); // lxp -> lifetimeXp
    expect(client.honor).toBe(321); // honor
    expect(client.lifetimeHonor).toBe(654); // lhonor -> lifetimeHonor
    expect(client.restedXp).toBe(222); // rxp -> restedXp
    expect(client.prestigeRank).toBe(3); // prk -> prestigeRank

    // --- fields that decode onto the client ---
    expect(client.inventory).toEqual([{ itemId: 'baked_bread', count: 3 }]); // inv -> inventory
    expect(client.vendorBuyback).toEqual([{ itemId: 'apprentice_staff', count: 1 }]); // buyback -> vendorBuyback
    expect(client.equipment).toMatchObject({ mainhand: 'zealotsbane_blade' }); // equip -> equipment
    // cosmetics -> accountCosmetics, asserted against the normalized shape (the input
    // is already the normal {completedQuestIds, mechChromaIds} form, see :192-202)
    expect(client.accountCosmetics).toEqual({
      completedQuestIds: ['q_aldrics_fallen_star'],
      mechChromaIds: ['amber_crimson'],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    });
    expect([...client.questLog.values()]).toEqual([
      { questId: 'q_widows', counts: [10, 0], state: 'active' },
    ]); // qlog -> questLog (Map)
    expect(client.questsDone.has('q_wolves')).toBe(true); // qdone -> questsDone (Set)
    expect(client.unlockedMilestones).toEqual(['milestone_test']); // milestones -> unlockedMilestones
    // lockouts -> selfLockouts (private), via the raidLockouts() accessor
    expect(client.raidLockouts().map((l) => l.id)).toEqual(['nythraxis_boss_arena']);
    expect(client.partyInfo).not.toBeNull(); // party -> partyInfo
    expect(client.partyInfo?.members.some((m) => m.pid === memberPid)).toBe(true);
    expect(client.markerFor(memberPid)).toBe(3); // marks -> markers, via markerFor()
    expect((client.tradeInfo as any)?.otherPid).toBe(memberPid); // trade -> tradeInfo
    expect((client.duelInfo as any)?.state).toBe('countdown'); // duel -> duelInfo
    expect(client.arenaInfo).not.toBeNull(); // arena -> arenaInfo
    expect(client.marketInfo).not.toBeNull(); // market -> marketInfo
    expect(client.bankInfo).not.toBeNull(); // bank -> bankInfo
    expect(client.bankInfo?.slots).toEqual([{ itemId: 'wolf_fang', count: 2 }]); // bank contents mirror
    expect(client.activeLootRolls().map((r) => r.rollId)).toEqual([1]); // lroll -> lootRollPrompts
    // lrollg -> lootRollGroup, via the lootRollGroupStatus() accessor
    expect(client.lootRollGroupStatus()).toEqual([
      {
        rollId: 1,
        itemId: 'baked_bread',
        itemName: 'Baked Bread',
        quality: 'common',
        expiresAt: 9999,
        entries: [{ pid: leader.pid, name: 'Alld', choice: null }],
      },
    ]);
    expect(client.delveRun).not.toBeNull(); // drun -> delveRun
    expect(client.companionState?.companionId).toBe('companion_tessa'); // dcompanion -> companionState
    expect(client.delveMarks).toBe(7); // dmarks -> delveMarks
    expect(client.companionUpgrades).toEqual({ companion_tessa: 2 }); // dcomp -> companionUpgrades
    expect(client.gatheringProficiency).toEqual({ mining: 6, logging: 0, herbalism: 0 }); // gprof -> gatheringProficiency
    // ncd -> nodeHarvestableByMe: the cooling-down node reads not-ready, an
    // untouched node (never in the map) still reads ready.
    expect(client.nodeHarvestableByMe(GATHER_NODES[0].id)).toBe(false);
    expect(client.nodeHarvestableByMe('not_a_real_node')).toBe(true);
    expect(client.professionsState).toEqual({
      skills: [
        { professionId: 'mining', skill: 6, maxSkill: 300 },
        { professionId: 'logging', skill: 0, maxSkill: 300 },
        { professionId: 'herbalism', skill: 0, maxSkill: 300 },
      ],
    }); // prof -> professionsState
    expect(client.craftingIdentity).toMatchObject({
      version: 1,
      synced: true,
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 2,
      amendsProgress: 4,
      amendsRequired: 11,
    }); // cprof -> craftingIdentity
    // The pair-named archetype title derives LIVE from the mirrored
    // craftingIdentity (Professions 2.0 Phase 1): the canonical pair id, not a
    // craft id, and it must reflect the cprof delta just applied.
    expect(client.archetypeTitle).toBe('weaponcrafting+armorcrafting');
    expect(client.craftSkills).toMatchObject({ armorcrafting: 31, weaponcrafting: 29 });
    // mst -> activeMobileStationCraft: the server-computed ACTIVE craft id
    // (expiry resolved server-side against the sim's own tickCount).
    expect(client.activeMobileStationCraft).toBe('armorcrafting');
    expect(client.delveClears).toEqual({ 'collapsed_reliquary:heroic': 1 }); // dclears -> delveClears
    expect(client.delveDaily).toMatchObject({ markClears: 4 }); // delveDaily
    // deeds -> deedsEarned: the Map rebuilds from the plain wire object with
    // both utcDay stamps intact (a Map does not survive JSON.stringify)
    expect([...client.deedsEarned.entries()]).toEqual([
      ['prog_first_steps', '2026-07-01'],
      ['prog_veteran', '2026-07-08'],
    ]);
    // dstats -> deedStats: counters survive and BOTH Sets rebuild from arrays
    expect(client.deedStats.counters.kills).toBe(7);
    expect(client.deedStats.itemsDiscovered.has('wolf_fang')).toBe(true);
    expect(client.deedStats.visited.has('npc:chronicler_saul')).toBe(true);
    expect(client.deedStats.dungeonClears).toEqual({ hollow_crypt: 2 });
    expect(client.renown).toBe(15); // renown (same name both sides, no rename)
    expect(client.activeTitle).toBe('prog_veteran'); // atitle -> activeTitle
    // tal -> talents / talentSpec / loadouts / activeLoadout
    expect(client.talents).toEqual({ spec: 'arms', rows: {} });
    expect(client.talentSpec).toBe('arms');
    expect(client.loadouts).toEqual([{ name: 'PvP', alloc: { spec: 'arms', rows: {} }, bar: [] }]);
    expect(client.activeLoadout).toBe(0);
  });

  it('flips mst to null when the mobile station expires (server-side tick-domain check)', () => {
    // The expiry arm of the mst self-delta: activeMobileStationCraftFor
    // resolves active-vs-expired against the SERVER sim's own tickCount, so
    // the lapse must reach the client as an explicit mst: null delta (a
    // nullable scalar; omission would leave the stale craft id mirrored).
    const { server, fc, leader } = dirtyEveryDeltaField();
    broadcast(server);
    const client = bareClient(leader.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.activeMobileStationCraft).toBe('armorcrafting');

    const meta = server.sim.meta(leader.pid);
    if (!meta?.mobileStation) throw new Error('mobile station missing from the harness');
    meta.mobileStation.expiresAtTick = server.sim.tickCount; // isStationActive: now < expiry fails
    server.sim.tick();
    broadcast(server);
    (client as any).applySnapshot(lastSnap(fc.sent));
    expect(client.activeMobileStationCraft).toBeNull();
  });

  it('omits all delta keys on a no-op re-broadcast and preserves the prior mirror', () => {
    const { server, fc, leader, memberPid } = dirtyEveryDeltaField();
    broadcast(server);
    const client = bareClient(leader.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    // capture the structures decoded from snapshot #1, by reference
    const invRef = client.inventory;
    const cooldownsRef = client.player.cooldowns;
    const statsRef = client.player.stats;
    const weaponRef = client.player.weapon;
    const partyRef = client.partyInfo;
    const delveRunRef = client.delveRun;

    // a second broadcast with NO intervening sim.tick() and no state mutation: the
    // maybe() closure sees byte-identical JSON for every registered key and omits every one
    fc.sent.length = 0;
    broadcast(server);
    const snap2 = lastSnap(fc.sent);
    for (const key of ALL_DELTA_KEYS) {
      expect(snap2.self, `self.${key} resent although unchanged`).not.toHaveProperty(key);
    }

    // applying the delta-less snapshot keeps the prior mirror untouched, by reference
    // (covers both the `if (s.X !== undefined)` and the inline `s.X ?? e.X` forms)
    (client as any).applySnapshot(snap2);
    expect(client.inventory).toBe(invRef); // if !== undefined (client field)
    expect(client.player.cooldowns).toBe(cooldownsRef); // if !== undefined (player entity)
    expect(client.player.stats).toBe(statsRef); // s.stats ?? e.stats (inline, player entity)
    expect(client.player.weapon).toBe(weaponRef); // s.weapon ?? e.weapon (inline, player entity)
    expect(client.partyInfo).toBe(partyRef);
    expect(client.delveRun).toBe(delveRunRef);
    expect(client.markerFor(memberPid)).toBe(3);
    expect(client.delveMarks).toBe(7);
    expect(client.honor).toBe(321);
    expect(client.lifetimeHonor).toBe(654);
    expect(client.companionState?.companionId).toBe('companion_tessa');
  });
});

describe('gather node cooldown wire round trip (ncd)', () => {
  it('flips a node from not-ready back to ready once the server-side cooldown clears', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Gatherer');
    const sim = (server as any).sim;
    const meta = sim.players.get(session.pid);
    const nodeId = GATHER_NODES[0].id;
    meta.nodeHarvestReadyAt[nodeId] = sim.time + 30;

    broadcast(server);
    const notReadySnap = lastSnap(fc.sent);
    expect(notReadySnap.self.ncd).toMatchObject({ [nodeId]: expect.any(Number) });

    const client = bareClient(session.pid);
    (client as any).applySnapshot(notReadySnap);
    expect(client.nodeHarvestableByMe(nodeId)).toBe(false);

    // Server-side cooldown clears (readyAt passes): the next broadcast omits the
    // node from `ncd` entirely (server/game.ts's until > sim.time filter), and
    // applying THAT snapshot, not a hand-reassigned map, must flip the client
    // back to ready -- the exact transition a permanent-lockout regression would
    // fail to make.
    meta.nodeHarvestReadyAt[nodeId] = sim.time - 1;
    broadcast(server);
    const readySnap = lastSnap(fc.sent);
    expect(readySnap.self.ncd).toEqual({});

    (client as any).applySnapshot(readySnap);
    expect(client.nodeHarvestableByMe(nodeId)).toBe(true);
  });
});

describe('delta-key contract pins (anti-drift)', () => {
  it('ALL_DELTA_KEYS contains exactly 49 unique keys in sorted order', () => {
    expect(ALL_DELTA_KEYS).toHaveLength(49);
    expect(new Set(ALL_DELTA_KEYS).size).toBe(49);
    expect([...ALL_DELTA_KEYS]).toEqual([...ALL_DELTA_KEYS].sort());
  });

  it('ALL_DELTA_KEYS equals the maybe(...) keys scraped from server/game.ts (multi-line lockouts incl.)', () => {
    const src = readFileSync(resolve(process.cwd(), 'server/game.ts'), 'utf8');
    // tolerate whitespace/newline between `(` and the quote so the multi-line
    // maybe('lockouts', ...) call (game.ts ~2166-2169) is captured, not undercounted
    const re = /\bmaybe\(\s*['"](\w+)['"]/g;
    const scraped = new Set<string>();
    for (let m = re.exec(src); m !== null; m = re.exec(src)) scraped.add(m[1]);
    expect(scraped.has('lockouts')).toBe(true); // the multi-line call IS captured
    expect(scraped.size).toBe(49);
    expect([...scraped].sort()).toEqual([...ALL_DELTA_KEYS].sort());
  });

  it('TERSE_TO_IWORLD pins the terse-key to IWorld-name renames in sorted membership', () => {
    // the non-obvious renames the brief calls out as where drift hides
    const required: Record<string, string> = {
      res: 'resource',
      mres: 'maxResource',
      rtype: 'resourceType',
      lxp: 'lifetimeXp',
      lhonor: 'lifetimeHonor',
      rxp: 'restedXp',
      prk: 'prestigeRank',
      drun: 'delveRun',
      dcompanion: 'companionState',
      dmarks: 'delveMarks',
      dcomp: 'companionUpgrades',
      dclears: 'delveClears',
      atitle: 'activeTitle',
      deeds: 'deedsEarned',
      dstats: 'deedStats',
    };
    for (const [terse, iworld] of Object.entries(required)) {
      expect(TERSE_TO_IWORLD[terse], `rename ${terse} -> ${iworld} drifted`).toBe(iworld);
    }
    // renown keeps the same name on both sides, so it must NEVER grow a rename
    // entry (one would imply a wire key the decoder does not read)
    expect('renown' in TERSE_TO_IWORLD).toBe(false);
    // sorted-membership pin: adding or renaming an entry must be a deliberate,
    // reviewable change landing in alphabetical order
    expect(Object.keys(TERSE_TO_IWORLD)).toEqual([...Object.keys(TERSE_TO_IWORLD)].sort());
    // every entry is either a delta key or one of the always-present self scalars
    const SELF_SCALARS = new Set(['res', 'mres', 'rtype', 'lxp', 'rxp', 'prk']);
    for (const terse of Object.keys(TERSE_TO_IWORLD)) {
      expect(
        (ALL_DELTA_KEYS as readonly string[]).includes(terse) || SELF_SCALARS.has(terse),
        `${terse} is neither a delta key nor a known self scalar`,
      ).toBe(true);
    }
  });
});

// Buff/debuff hover tooltips read an aura's magnitude (src/ui/aura_effect.ts: flat stat amount,
// slow/haste multiplier, dot/hot per-tick, absorb remaining, imbue range, ...), so the wire must
// carry it or the tooltip reads 0 online (the reported "Increases attack power by 0" bug). The
// serializer now sends `value` whenever it is nonzero (raw, so a negative stat-sap's sign and its
// isAuraDebuff classification survive), plus value2/value3 (imbue), tickInterval (dot/hot), and a
// non-physical school. The client decode reads `a.value ?? 0` and `a.school ?? 'physical'`, so a
// value-0 aura or an old server still decodes to the defaults (backward compatible). This drives a
// real Sim aura through the real serializer (wireEntity) and the real client decode
// (ClientWorld.applySnapshot).
describe('aura magnitude over the wire (buff/debuff tooltip parity)', () => {
  function roundTrip(aura: Aura): { wire: Record<string, unknown>; mirror: Aura } {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Sapped');
    const e = sim.entities.get(pid)!;
    e.auras.push(aura);
    const wire = wireEntity(e);
    // A different pid than the wired entity, so the player is decoded as a regular entity.
    const client = bareClient(999);
    // Serialize through JSON exactly as production does (wireCacheFor -> JSON.stringify), so
    // the round trip also catches any JSON-normalization divergence (e.g. -0 -> 0), not just
    // the in-memory wire shape.
    const snap = JSON.parse(JSON.stringify({ t: 'snap', ents: [wire] }));
    (client as any).applySnapshot(snap);
    const mirror = client.entities.get(pid)!.auras.find((a) => a.id === aura.id)!;
    return { wire, mirror };
  }

  // Pull the wired aura record by id (the entity carries only the pushed aura here).
  function wireAura(wire: Record<string, unknown>, id: string): Record<string, unknown> {
    return (wire.auras as Array<Record<string, unknown>>).find((a) => a.id === id)!;
  }

  function sapInt(value: number): Aura {
    return {
      id: 'enfeeble',
      name: 'Enfeeble',
      kind: 'buff_int',
      remaining: 8,
      duration: 8,
      value,
      sourceId: 0,
      school: 'physical',
    };
  }

  it('sends a NEGATIVE buff_* value so the sap classifies as a debuff in BOTH worlds', () => {
    const simSap = sapInt(-30);
    const { wire, mirror } = roundTrip(simSap);
    // the serializer carried the negative value...
    expect(wireAura(wire, 'enfeeble').value).toBe(-30);
    // ...and the client decoded it (not the old hardcoded 0).
    expect(mirror.value).toBe(-30);
    // so isAuraDebuff agrees across the wire: a debuff offline AND online.
    expect(isAuraDebuff(simSap)).toBe(true);
    expect(isAuraDebuff(mirror)).toBe(true);
  });

  it('sends a POSITIVE buff value so its tooltip shows the real magnitude, still a buff in both worlds', () => {
    const buff: Aura = { ...sapInt(40), id: 'arcane_intellect', name: 'Aether Insight' };
    const { wire, mirror } = roundTrip(buff);
    expect(wireAura(wire, 'arcane_intellect').value).toBe(40); // rides the wire now (was omitted)
    expect(mirror.value).toBe(40); // client mirrors the real magnitude (not the old hardcoded 0)
    expect(isAuraDebuff(buff)).toBe(false); // positive value -> still a buff, online and off
    expect(isAuraDebuff(mirror)).toBe(false);
  });

  it('sends a POSITIVE absorb value so the shield overlay and tooltip work online too', () => {
    const shield: Aura = {
      id: 'power_word_shield',
      name: 'Psalm of Warding',
      kind: 'absorb',
      remaining: 12,
      duration: 12,
      value: 250,
      sourceId: 0,
      school: 'holy',
    };
    const { wire, mirror } = roundTrip(shield);
    expect(wireAura(wire, 'power_word_shield').value).toBe(250);
    expect(wireAura(wire, 'power_word_shield').school).toBe('holy'); // non-physical school rides
    expect(mirror.value).toBe(250); // client mirrors the remaining absorb...
    expect(mirror.school).toBe('holy');
    // ...so the unit-frame shield overlay now derives online exactly as offline.
    expect(absorbTotal([mirror])).toBe(250);
  });

  it('classifies a non-buff_ aura (fear) as a debuff by KIND, not value, across the wire', () => {
    // An incapacitate (fear) stores a random facing angle in value; it now rides the wire like
    // any nonzero value, but the incapacitate tooltip reads NO number, so the inert angle is
    // harmless. Classification stays KIND-based (DEBUFF_AURA_KINDS), identical in both worlds.
    const fear: Aura = {
      id: 'fear',
      name: 'Harrow',
      kind: 'incapacitate',
      remaining: 4,
      duration: 4,
      value: -1.5,
      sourceId: 0,
      school: 'shadow',
    };
    const { wire, mirror } = roundTrip(fear);
    expect(wireAura(wire, 'fear').value).toBe(-1.5); // nonzero value rides raw (sign preserved)
    expect(mirror.value).toBe(-1.5);
    expect(auraEffectDescriptor(fear)?.nums).toBeUndefined(); // incapacitate shows no number
    expect(isAuraDebuff(fear)).toBe(true); // debuff via kind, in both worlds
    expect(isAuraDebuff(mirror)).toBe(true);
  });

  it("round-trips Harrier's Guise so its tooltip shows the real attack power, not 0 (the bug)", () => {
    // The reported bug: online, Harrier's Guise read "Increases attack power by 0" because the
    // positive buff_ap magnitude never rode the wire. It now does, so offline == online.
    const hawk: Aura = {
      id: 'aspect_of_the_hawk',
      name: "Harrier's Guise",
      kind: 'buff_ap',
      remaining: 1800,
      duration: 1800,
      value: 20,
      sourceId: 0,
      school: 'physical',
    };
    const { wire, mirror } = roundTrip(hawk);
    expect(wireAura(wire, 'aspect_of_the_hawk').value).toBe(20);
    expect(mirror.value).toBe(20);
    // end to end: the mirrored aura drives the tooltip descriptor to the real number.
    const desc = auraEffectDescriptor(mirror);
    expect(desc?.key).toBe('hudChrome.auraEffect.increase.ap');
    expect(desc?.nums?.value).toBe(20); // "Increases attack power by 20", never 0
  });

  it('round-trips a dot magnitude, tick cadence, and non-physical school for its tooltip', () => {
    const dot: Aura = {
      id: 'corruption',
      name: 'Blackrot',
      kind: 'dot',
      remaining: 12,
      duration: 12,
      value: 15,
      tickInterval: 3,
      sourceId: 0,
      school: 'shadow',
    };
    const { wire, mirror } = roundTrip(dot);
    expect(wireAura(wire, 'corruption').value).toBe(15);
    expect(wireAura(wire, 'corruption').tickInterval).toBe(3);
    expect(wireAura(wire, 'corruption').school).toBe('shadow');
    expect(mirror.value).toBe(15);
    expect(mirror.tickInterval).toBe(3);
    expect(mirror.school).toBe('shadow');
    const desc = auraEffectDescriptor(mirror);
    expect(desc?.key).toBe('hudChrome.auraEffect.dot');
    expect(desc?.nums?.value).toBe(15);
    expect(desc?.nums?.interval).toBe(3);
    expect(desc?.school).toBe('shadow');
  });

  it('round-trips unbreakable control so the client never offers cancellation', () => {
    const scriptedStasis: Aura = {
      id: 'scripted_stasis',
      name: 'Scripted Stasis',
      kind: 'stasis',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 0,
      school: 'arcane',
      unbreakableControl: true,
    };

    const { wire, mirror } = roundTrip(scriptedStasis);
    expect(wireAura(wire, 'scripted_stasis').ub).toBe(1);
    expect(mirror.unbreakableControl).toBe(true);
  });

  it('round-trips the imbue judgement range (value2/value3), value omitted when 0', () => {
    const imbue: Aura = {
      id: 'holy_might',
      name: 'Holy Might',
      kind: 'imbue',
      remaining: 300,
      duration: 300,
      value: 0, // imbue carries its numbers in value2/value3, so value stays 0...
      value2: 8,
      value3: 12,
      sourceId: 0,
      school: 'holy',
    };
    const { wire, mirror } = roundTrip(imbue);
    expect('value' in wireAura(wire, 'holy_might')).toBe(false); // ...and is omitted (decodes 0)
    expect(wireAura(wire, 'holy_might').value2).toBe(8);
    expect(wireAura(wire, 'holy_might').value3).toBe(12);
    expect(mirror.value2).toBe(8);
    expect(mirror.value3).toBe(12);
    const desc = auraEffectDescriptor(mirror);
    expect(desc?.key).toBe('hudChrome.auraEffect.imbueRange');
    expect(desc?.nums?.min).toBe(8);
    expect(desc?.nums?.max).toBe(12);
  });

  it('tolerates an old-server wire aura with no value (backward compatible -> 0)', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({
      ents: [
        {
          id: 2,
          k: 'mob',
          tid: 'wolf',
          nm: 'Wolf',
          lv: 3,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 40,
          mhp: 40,
          auras: [{ id: 'enfeeble', name: 'Enfeeble', kind: 'buff_int', rem: 8, dur: 8 }],
        },
      ],
    });
    const mirror = client.entities.get(2)!.auras.find((a) => a.kind === 'buff_int')!;
    expect(mirror.value).toBe(0);
  });
});

describe('aura decode reuses records across snapshots (allocation fast path)', () => {
  function wolfWire(sim: Sim, mobId: number): Record<string, unknown> {
    return JSON.parse(JSON.stringify(wireEntity(sim.entities.get(mobId)!)));
  }

  function makeMobWithAura(): { sim: Sim; mobId: number } {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Poker');
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    void pid;
    mob.auras.push({
      id: 'corruption',
      name: 'Blackrot',
      kind: 'dot',
      remaining: 12,
      duration: 12,
      value: 15,
      tickInterval: 3,
      sourceId: 0,
      school: 'shadow',
    });
    return { sim, mobId: mob.id };
  }

  it('keeps the same array and record objects while only fields change', () => {
    const { sim, mobId } = makeMobWithAura();
    const client = bareClient(999);
    (client as any).applySnapshot({ t: 'snap', ents: [wolfWire(sim, mobId)] });
    const firstArr = client.entities.get(mobId)!.auras;
    const firstRec = firstArr[0];
    expect(firstRec.remaining).toBe(12);

    // same aura set, only the remaining ticked down: the mirror must update the
    // SAME objects in place (no per-snapshot churn) with the new field values
    sim.entities.get(mobId)!.auras[0].remaining = 7.5;
    (client as any).applySnapshot({ t: 'snap', ents: [wolfWire(sim, mobId)] });
    const secondArr = client.entities.get(mobId)!.auras;
    expect(secondArr).toBe(firstArr);
    expect(secondArr[0]).toBe(firstRec);
    expect(firstRec.remaining).toBe(7.5);
    expect(firstRec.value).toBe(15);
    expect(firstRec.school).toBe('shadow');
  });

  it('rebuilds the list when the aura composition changes', () => {
    const { sim, mobId } = makeMobWithAura();
    const client = bareClient(999);
    (client as any).applySnapshot({ t: 'snap', ents: [wolfWire(sim, mobId)] });
    const firstArr = client.entities.get(mobId)!.auras;

    sim.entities.get(mobId)!.auras.push({
      id: 'venom_bite',
      name: 'Venom Bite',
      kind: 'dot',
      remaining: 6,
      duration: 6,
      value: 4,
      tickInterval: 2,
      sourceId: 0,
      school: 'nature',
    });
    (client as any).applySnapshot({ t: 'snap', ents: [wolfWire(sim, mobId)] });
    const secondArr = client.entities.get(mobId)!.auras;
    expect(secondArr).not.toBe(firstArr); // composition changed: fresh build
    expect(secondArr.map((a) => a.id)).toEqual(['corruption', 'venom_bite']);
    expect(secondArr[1].value).toBe(4);

    // and dropping back to one aura rebuilds again (length mismatch path)
    sim.entities.get(mobId)!.auras.pop();
    (client as any).applySnapshot({ t: 'snap', ents: [wolfWire(sim, mobId)] });
    expect(client.entities.get(mobId)!.auras.map((a) => a.id)).toEqual(['corruption']);
  });
});

describe('aura decode fast-path guards (composition edge cases)', () => {
  function client2(sim: Sim, mobId: number) {
    const client = bareClient(999);
    const apply = () =>
      (client as any).applySnapshot({
        t: 'snap',
        ents: [JSON.parse(JSON.stringify(wireEntity(sim.entities.get(mobId)!)))],
      });
    return { client, apply };
  }

  function makeMobWithTwoAuras(): { sim: Sim; mobId: number } {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    sim.addPlayer('warrior', 'Poker');
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    mob.auras.push(
      {
        id: 'corruption',
        name: 'Blackrot',
        kind: 'dot',
        remaining: 12,
        duration: 12,
        value: 15,
        sourceId: 0,
        school: 'shadow',
      },
      {
        id: 'weakness',
        name: 'Weakness',
        kind: 'buff_ap',
        remaining: 9,
        duration: 9,
        value: -5,
        sourceId: 0,
        school: 'physical',
      },
    );
    return { sim, mobId: mob.id };
  }

  it('a same-length REORDER rebuilds instead of smearing fields across records', () => {
    const { sim, mobId } = makeMobWithTwoAuras();
    const { client, apply } = client2(sim, mobId);
    apply();
    const mob = sim.entities.get(mobId)!;
    // swap the two auras: same ids, same length, different order
    mob.auras.reverse();
    apply();
    const mirrored = client.entities.get(mobId)!.auras;
    expect(mirrored.map((a) => a.id)).toEqual(['weakness', 'corruption']);
    // each record carries ITS aura's fields, not the other slot's
    expect(mirrored[0].value).toBe(-5);
    expect(mirrored[1].value).toBe(15);
    expect(mirrored[1].school).toBe('shadow');
  });

  it('the in-place path clears optional sub-fields the wire stops sending', () => {
    const { sim, mobId } = makeMobWithTwoAuras();
    const mob = sim.entities.get(mobId)!;
    mob.auras[0].stacks = 3;
    mob.auras[0].value2 = 8;
    const { client, apply } = client2(sim, mobId);
    apply();
    const rec = client.entities.get(mobId)!.auras[0];
    expect(rec.stacks).toBe(3);
    expect(rec.value2).toBe(8);
    // same aura set (fast path), but the optionals dropped off the wire
    mob.auras[0].stacks = undefined;
    mob.auras[0].value2 = undefined;
    apply();
    expect(client.entities.get(mobId)!.auras[0]).toBe(rec); // fast path taken
    expect(rec.stacks).toBeUndefined(); // not a stale 3
    expect(rec.value2).toBeUndefined(); // not a stale 8
  });
});

describe('entity-anchored world event scoping', () => {
  it('delivers delveRitePulse to sessions near its entityId anchor and not to far ones', () => {
    // The rite pulse is a world event with no pid; eventAnchor must resolve its
    // entityId to the shrine position and interest-scope delivery (EVENT_RADIUS).
    // Pre-fix the field was shrineId, which eventAnchor did not recognize, so
    // the pulse broadcast realm-wide and closed rite popups in unrelated runs.
    const server = new GameServer();
    const near = fakeWs();
    const far = fakeWs();
    const sNear = joinServer(server, near, 1, 'Nearena');
    const sFar = joinServer(server, far, 2, 'Faraway');
    const nearEnt = server.sim.entities.get(sNear.pid)!;
    const farEnt = server.sim.entities.get(sFar.pid)!;
    farEnt.pos.x = nearEnt.pos.x + 500;
    farEnt.pos.z = nearEnt.pos.z + 500;
    near.sent.length = 0;
    far.sent.length = 0;
    // Anchor on the near player's own entity: eventAnchor only reads a live
    // entity's position, so any resolvable id pins the scoping semantics.
    (server as any).routeEvents([
      { type: 'delveRitePulse', entityId: nearEnt.id, shrineKind: 'rite_shrine_bell' },
    ]);
    const pulses = (fc: ReturnType<typeof fakeWs>) =>
      fc.sent
        .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
        .filter((ev: { type: string }) => ev.type === 'delveRitePulse');
    expect(pulses(near)).toHaveLength(1);
    expect(pulses(far)).toHaveLength(0);
  });
});

describe('server tick rate on the snap head', () => {
  it('omits tickHz while the meter warms up, then reports the measured rate', () => {
    const server = new GameServer();
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Ticky');
    broadcast(server);
    // fresh server: nothing measured yet, so the head omits the field entirely
    // and the ops profile reports null rather than a fake number
    expect(lastSnap(fc.sent).tickHz).toBeUndefined();
    expect(server.perfProfile().tickHz).toBeNull();
    // Drive the meter the way start() does (one record per callback against
    // wall ms); the loop timer itself cannot run under vitest without flaking.
    const internals = server as any;
    internals.tickRateMeter.record(0, 1);
    for (let t = 50; t <= 3000; t += 50) internals.tickRateMeter.record(t, 1);
    internals.tickHz = internals.tickRateMeter.rate(3000);
    fc.sent.length = 0;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // parsed by JSON.parse in fakeWs, so this also proves the head stays valid JSON
    expect(snap.tickHz).toBeCloseTo(20, 1);
    expect(snap.tick).toBeTypeOf('number');
    // the same reading rides the ops /api/perf payload (both dispatch arms
    // share perfProfile), rounded for the wire
    expect(server.perfProfile().tickHz).toBeCloseTo(20, 1);
  });

  it('throttles tickHz on the head, re-emitting once the interval elapses', () => {
    const server = new GameServer();
    const fc = fakeWs();
    joinServer(server, fc, 1, 'Ticky');
    const internals = server as any;
    internals.tickRateMeter.record(0, 1);
    for (let t = 50; t <= 3000; t += 50) internals.tickRateMeter.record(t, 1);
    internals.tickHz = internals.tickRateMeter.rate(3000);
    // first head after warm-up carries the value
    broadcast(server);
    expect(lastSnap(fc.sent).tickHz).toBeCloseTo(20, 1);
    // a second head within the throttle window (no sim.time advance) omits it,
    // so the slow-moving scalar does not ride every 20 Hz snapshot. The client
    // holds its last reading across that gap (see the mirror test below).
    fc.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fc.sent).tickHz).toBeUndefined();
    // once sim.time advances past the interval, the next head carries it again
    for (let i = 0; i < 20; i++) server.sim.tick(); // ~1s of sim time
    fc.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fc.sent).tickHz).toBeCloseTo(20, 1);
  });
});

describe('client mirror of the server tick rate', () => {
  it('mirrors tickHz from the snap head and keeps the last value when omitted', () => {
    const client = bareClient(1);
    expect(client.serverTickHz).toBeNull();
    (client as any).applySnapshot({ t: 'snap', tickHz: 19.6, ents: [] });
    expect(client.serverTickHz).toBe(19.6);
    // a warm-up-era head omits the field: the mirror holds the last reading
    (client as any).applySnapshot({ t: 'snap', ents: [] });
    expect(client.serverTickHz).toBe(19.6);
  });

  it('rejects junk tickHz values instead of poisoning the mirror', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({ t: 'snap', tickHz: 20, ents: [] });
    // Infinity is the one value only Number.isFinite rejects (typeof passes, > 0 passes)
    for (const junk of ['20', Number.NaN, Number.POSITIVE_INFINITY, -1, 0, null]) {
      (client as any).applySnapshot({ t: 'snap', tickHz: junk, ents: [] });
    }
    expect(client.serverTickHz).toBe(20);
  });
});

describe('Ring of Frost snapshot parity', () => {
  it('mirrors authoritative active rings and clears zones missing from the next snapshot', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [],
      rings: [{ id: '1:20', x: 3, z: 5, r: 6, i: 4.5, dur: 10, rem: 7.25 }],
    });
    expect(client.activeFrostRings).toEqual([
      { id: '1:20', x: 3, z: 5, radius: 6, innerRadius: 4.5, duration: 10, remaining: 7.25 },
    ]);

    (client as any).applySnapshot({ t: 'snap', ents: [] });
    expect(client.activeFrostRings).toEqual([]);
  });

  it('interest-scopes active rings with their server-authored remaining lifetime', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Frostwire', 'mage');
    const caster = server.sim.entities.get(session.pid)!;
    (server.sim as any).groundAoEs.push({
      sourceId: caster.id,
      pos: { x: caster.pos.x + 4, y: caster.pos.y, z: caster.pos.z },
      radius: 6,
      min: 0,
      max: 0,
      remaining: 7.5,
      interval: 10,
      tickTimer: 10,
      school: 'frost',
      ability: 'Ring of Frost',
      frostRing: {
        id: `${caster.id}:10`,
        abilityId: 'rings_of_frost',
        duration: 10,
        freezeDuration: 4,
        innerRadius: 4.5,
        triggeredIds: new Set<number>(),
      },
    });

    broadcast(server);

    expect(lastSnap(fc.sent).rings).toEqual([
      expect.objectContaining({ id: `${caster.id}:10`, r: 6, i: 4.5, dur: 10, rem: 7.5 }),
    ]);
  });
});

describe('Temporal Hourglass snapshot parity', () => {
  it('mirrors authoritative ground hourglasses and clears missing traps', () => {
    const client = bareClient(1);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [],
      hourglasses: [{ id: '1:20', x: 3, z: 5, r: 1.75, dur: 30, rem: 21.5 }],
    });
    expect(client.activeTemporalHourglasses).toEqual([
      { id: '1:20', x: 3, z: 5, radius: 1.75, duration: 30, remaining: 21.5 },
    ]);

    (client as any).applySnapshot({ t: 'snap', ents: [] });
    expect(client.activeTemporalHourglasses).toEqual([]);
  });

  it('interest-scopes ground hourglasses with server-authored lifetime', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Timewire', 'mage');
    const caster = server.sim.entities.get(session.pid)!;
    (server.sim as any).groundAoEs.push({
      sourceId: caster.id,
      pos: { x: caster.pos.x + 4, y: caster.pos.y, z: caster.pos.z },
      radius: 1.75,
      min: 0,
      max: 0,
      remaining: 21.5,
      interval: 30,
      tickTimer: 30,
      school: 'arcane',
      ability: 'Hourglass of Suspension',
      temporalHourglass: {
        id: `${caster.id}:10`,
        abilityId: 'temporal_hourglass',
        protectiveDuration: 5,
        hostilePveDuration: 60,
        hostilePvpDuration: 10,
        groundDuration: 30,
        healMaxHpPct: 0.3,
        selfCooldownRate: 2,
        allyCooldownRate: 1.75,
      },
    });

    broadcast(server);

    expect(lastSnap(fc.sent).hourglasses).toEqual([
      expect.objectContaining({ id: `${caster.id}:10`, r: 1.75, dur: 30, rem: 21.5 }),
    ]);
  });
});

describe('authoritative interaction command outcomes', () => {
  it.each([
    ['loot', { id: -1 }],
    ['pickup', { id: -1 }],
    ['harvest_node', {}],
    ['enter_dungeon', {}],
    ['leave_dungeon', {}],
    ['delve_interact', {}],
  ])('reports a rejected %s command to the requesting client', (cmd, payload) => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Interactor');
    fc.sent.length = 0;
    const rid = 41;

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd, ...payload, rid }));

    expect(fc.sent).toContainEqual({ t: 'commandOutcome', rid, ok: false });
  });

  it('reports a successful command to the requesting client', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Interactor');
    fc.sent.length = 0;

    const player = server.sim.entities.get(session.pid)!;
    player.dead = true;
    player.ghost = false;
    player.hp = 0;
    server.sim.releaseSpirit(session.pid);
    expect(player.ghost).toBe(true);

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'resurrect_healer', rid: 42 }));
    expect(fc.sent).toContainEqual({ t: 'commandOutcome', rid: 42, ok: true });
    expect(player.dead).toBe(false);
  });

  it('forwards a valid pickup payload and reports the resulting world change', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Interactor');
    const player = server.sim.entities.get(session.pid)!;
    const object = [...server.sim.entities.values()].find(
      (entity) =>
        entity.kind === 'object' && entity.objectItemId === 'supply_crate' && entity.lootable,
    )!;
    server.sim.players.get(session.pid)!.questLog.set('q_supplies', {
      questId: 'q_supplies',
      counts: [0],
      state: 'active',
    });
    player.pos = { ...object.pos };
    player.prevPos = { ...object.pos };
    fc.sent.length = 0;

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'pickup', id: object.id, rid: 43 }),
    );

    expect(fc.sent).toContainEqual({ t: 'commandOutcome', rid: 43, ok: true });
    expect(server.sim.countItem('supply_crate', session.pid)).toBe(1);
    expect(object.lootable).toBe(false);
  });
});

describe('negotiated stable timer wire v2', () => {
  const timerV2 = { timerWireVersion: 2 } as unknown as Parameters<GameServer['join']>[7];

  function testAura(id: string, remaining: number, value = 7): Aura {
    return {
      id,
      name: id,
      kind: 'buff_ap',
      remaining,
      duration: remaining,
      value,
      sourceId: 0,
      school: 'physical',
    };
  }

  it('keeps an unnegotiated recipient on the legacy remaining-time wire', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Legacy', 'mage');
    const player = server.sim.entities.get(session.pid)!;
    const meta = server.sim.meta(session.pid)!;
    player.auras = [];
    player.auras.push(testAura('legacy_aura', 10));
    player.cooldowns.set('legacy_cast', 5);
    meta.nodeHarvestReadyAt.legacy_node = server.sim.time + 30;

    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.tw).toBeUndefined();
    expect(first.self.auras[0]).toMatchObject({ id: 'legacy_aura', rem: 10 });
    expect(first.self.auras[0]).not.toHaveProperty('exp');
    expect(first.self.cds.legacy_cast).toBe(5);
    expect(first.self.ncd.legacy_node).toBe(30);

    fc.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const second = lastSnap(fc.sent);
    expect(second.self.auras[0].rem).toBeLessThan(10);
    expect(second.self.cds.legacy_cast).toBeLessThan(5);
    expect(second.self.ncd.legacy_node).toBeLessThan(30);
  });

  it('sends a complete stable first snapshot, then ages omitted timers across skipped ticks', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Stable', 'mage', timerV2);
    const player = server.sim.entities.get(session.pid)!;
    const meta = server.sim.meta(session.pid)!;
    player.auras = [];
    player.auras.push(testAura('stable_aura', 10));
    player.cooldowns.set('stable_cast', 5);
    player.abilityCharges = {
      stable_cast: {
        charges: 1,
        maxCharges: 2,
        recharge: 5,
        rechargeLength: 5,
        recharges: [5],
      },
    };
    meta.nodeHarvestReadyAt.stable_node = server.sim.time + 30;

    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.tw).toBe(2);
    expect(first.self.auras[0]).toMatchObject({ id: 'stable_aura', exp: 10 });
    expect(first.self.auras[0]).not.toHaveProperty('rem');
    expect(first.self.cds.stable_cast).toBe(5);
    expect(first.self.achg.stable_cast).toBe(1);
    expect(first.self.ncd.stable_node).toBe(30);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(first);
    expect(client.player.auras[0].remaining).toBe(10);
    expect(client.player.cooldowns.get('stable_cast')).toBe(5);
    expect(client.nodeHarvestableByMe('stable_node')).toBe(false);

    fc.sent.length = 0;
    for (let i = 0; i < 5; i++) server.sim.tick();
    broadcast(server);
    const later = lastSnap(fc.sent);
    expect(later.tick - first.tick).toBe(5);
    expect(later.self).not.toHaveProperty('auras');
    expect(later.self).not.toHaveProperty('cds');
    expect(later.self).not.toHaveProperty('achg');
    expect(later.self).not.toHaveProperty('ncd');

    (client as any).applySnapshot(later);
    expect(client.player.auras[0].remaining).toBeCloseTo(9.75, 5);
    expect(client.player.cooldowns.get('stable_cast')).toBeCloseTo(4.75, 5);
    expect(client.nodeHarvestableByMe('stable_node')).toBe(false);

    player.auras.length = 0;
    player.cooldowns.clear();
    player.abilityCharges.stable_cast.charges = 2;
    meta.nodeHarvestReadyAt.stable_node = server.sim.time - 1;
    fc.sent.length = 0;
    broadcast(server);
    const cleared = lastSnap(fc.sent);
    expect(cleared.self.auras).toEqual([]);
    expect(cleared.self.cds).toEqual({});
    expect(cleared.self.achg).toEqual({ stable_cast: 2 });
    expect(cleared.self.ncd).toEqual({});

    (client as any).applySnapshot(cleared);
    expect(client.player.auras).toEqual([]);
    expect(client.player.cooldowns.size).toBe(0);
    expect(client.player.abilityCharges?.stable_cast?.charges).toBe(2);
    expect(client.nodeHarvestableByMe('stable_node')).toBe(true);
  });

  it('re-sends aura refreshes, reorder, values, stacks, and charges without timer churn', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'AuraMutations', 'mage', timerV2);
    const player = server.sim.entities.get(session.pid)!;
    player.auras = [];
    const firstAura = testAura('first', 10, 2);
    const secondAura = testAura('second', 12, 3);
    player.auras.push(firstAura, secondAura);

    broadcast(server);
    const first = lastSnap(fc.sent);
    const firstExpiry = first.self.auras.find((a: any) => a.id === 'first').exp;
    const client = bareClient(session.pid);
    (client as any).applySnapshot(first);

    server.sim.tick();
    player.auras.reverse();
    firstAura.remaining = 20;
    secondAura.value = 9;
    secondAura.stacks = 3;
    secondAura.charges = 4;
    fc.sent.length = 0;
    broadcast(server);
    const changed = lastSnap(fc.sent);
    expect(changed.self.auras.map((a: any) => a.id)).toEqual(['second', 'first']);
    expect(changed.self.auras[0]).toMatchObject({ value: 9, stacks: 3, charges: 4 });
    expect(changed.self.auras[1].exp).toBeGreaterThan(firstExpiry);

    (client as any).applySnapshot(changed);
    expect(client.player.auras.map((a) => a.id)).toEqual(['second', 'first']);
    expect(client.player.auras[0]).toMatchObject({ value: 9, stacks: 3, charges: 4 });
    expect(client.player.auras[1].remaining).toBeCloseTo(20, 5);
  });

  it('keeps rate-aware cooldown deadlines stable through Temporal Hourglass acceleration', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Accelerated', 'mage', timerV2);
    const player = server.sim.entities.get(session.pid)!;
    player.auras = [];
    player.auras.push({
      ...testAura('temporal_hourglass', 1, 3),
      kind: 'stasis',
      duration: 1,
    });
    player.cooldowns.set('accelerated_cast', 5);
    player.cooldowns.set('temporal_hourglass', 5);

    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.self.cds.accelerated_cast).toEqual([3, 3, 1]);
    expect(first.self.cds.temporal_hourglass).toBe(5);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(first);
    expect(client.player.cooldowns.get('accelerated_cast')).toBe(5);

    fc.sent.length = 0;
    for (let i = 0; i < 10; i++) server.sim.tick();
    broadcast(server);
    const accelerated = lastSnap(fc.sent);
    expect(accelerated.self).not.toHaveProperty('cds');
    (client as any).applySnapshot(accelerated);
    expect(client.player.cooldowns.get('accelerated_cast')).toBeCloseTo(3.5, 5);

    fc.sent.length = 0;
    for (let i = 0; i < 10; i++) server.sim.tick();
    broadcast(server);
    const expired = lastSnap(fc.sent);
    expect(expired.self.cds.accelerated_cast).toBe(3);
    (client as any).applySnapshot(expired);
    expect(client.player.cooldowns.get('accelerated_cast')).toBeCloseTo(2, 5);

    player.cooldowns.set('accelerated_cast', 6);
    player.auras.push({
      ...testAura('temporal_hourglass', 2, 2),
      kind: 'stasis',
      duration: 2,
    });
    fc.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fc.sent).self.cds.accelerated_cast).toEqual([5, 2, 3]);

    player.auras = player.auras.filter((aura) => aura.id !== 'temporal_hourglass');
    fc.sent.length = 0;
    broadcast(server);
    const removed = lastSnap(fc.sent);
    expect(removed.self.cds.accelerated_cast).toBe(7);
    (client as any).applySnapshot(removed);
    expect(client.player.cooldowns.get('accelerated_cast')).toBe(6);
  });

  it('freezes retained auras while dead, then resumes absolute decay after resurrection', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Paused', 'mage', timerV2);
    const player = server.sim.entities.get(session.pid)!;
    player.auras = [];
    player.auras.push(testAura('retained', 8));
    broadcast(server);
    const client = bareClient(session.pid);
    (client as any).applySnapshot(lastSnap(fc.sent));

    player.dead = true;
    player.hp = 0;
    fc.sent.length = 0;
    broadcast(server);
    const frozen = lastSnap(fc.sent);
    expect(frozen.self.auras[0]).toMatchObject({ id: 'retained', rem: 8 });
    expect(frozen.self.auras[0]).not.toHaveProperty('exp');
    (client as any).applySnapshot(frozen);
    const frozenRemaining = client.player.auras[0].remaining;

    fc.sent.length = 0;
    for (let i = 0; i < 6; i++) server.sim.tick();
    broadcast(server);
    const whileDead = lastSnap(fc.sent);
    expect(whileDead.self).not.toHaveProperty('auras');
    (client as any).applySnapshot(whileDead);
    expect(client.player.auras[0].remaining).toBe(frozenRemaining);

    player.dead = false;
    player.hp = player.maxHp;
    fc.sent.length = 0;
    broadcast(server);
    const resumed = lastSnap(fc.sent);
    expect(resumed.self.auras[0]).toHaveProperty('exp');
    expect(resumed.self.auras[0]).not.toHaveProperty('rem');
    (client as any).applySnapshot(resumed);

    fc.sent.length = 0;
    server.sim.tick();
    server.sim.tick();
    broadcast(server);
    const decayed = lastSnap(fc.sent);
    expect(decayed.self).not.toHaveProperty('auras');
    (client as any).applySnapshot(decayed);
    expect(client.player.auras[0].remaining).toBeCloseTo(frozenRemaining - 0.1, 5);
  });

  it('keeps legacy and v2 entity variants isolated and builds each at most once per tick', () => {
    const server = new GameServer();
    const stableWs = fakeWs();
    const legacyWs = fakeWs();
    const subjectWs = fakeWs();
    const stable = joinServer(server, stableWs, 1, 'StableViewer', 'warrior', timerV2);
    joinServer(server, legacyWs, 2, 'LegacyViewer');
    const subject = joinServer(server, subjectWs, 3, 'Subject', 'mage');
    const subjectEntity = server.sim.entities.get(subject.pid)!;
    subjectEntity.auras = [];
    subjectEntity.auras.push(testAura('shared_aura', 20));

    (server as any).perfDetailActive = true;
    (server as any).bcLegacySerializes = 0;
    (server as any).bcStableSerializes = 0;
    (server as any).bcBaseSerializes = 0;
    broadcast(server);
    const stableFirst = lastSnap(stableWs.sent);
    const legacyFirst = lastSnap(legacyWs.sent);
    const stableRow = stableFirst.ents.find((e: any) => e.id === subject.pid);
    const legacyRow = legacyFirst.ents.find((e: any) => e.id === subject.pid);
    expect(stableRow.auras[0]).toHaveProperty('exp');
    expect(stableRow.auras[0]).not.toHaveProperty('rem');
    expect(legacyRow.auras[0]).toHaveProperty('rem');
    expect(legacyRow.auras[0]).not.toHaveProperty('exp');
    expect((server as any).bcLegacySerializes).toBeLessThanOrEqual(server.sim.entities.size);
    expect((server as any).bcStableSerializes).toBeLessThanOrEqual(server.sim.entities.size);
    expect((server as any).bcBaseSerializes).toBeLessThanOrEqual(server.sim.entities.size);
    expect(
      (server as any).bcLegacySerializes + (server as any).bcStableSerializes,
    ).toBeLessThanOrEqual(server.sim.entities.size * 2);

    const stableClient = bareClient(stable.pid);
    (stableClient as any).applySnapshot(stableFirst);
    stableWs.sent.length = 0;
    legacyWs.sent.length = 0;
    subjectWs.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const stableSecond = lastSnap(stableWs.sent);
    const legacySecond = lastSnap(legacyWs.sent);
    expect(stableSecond.ents.find((e: any) => e.id === subject.pid)).toBeUndefined();
    expect(stableSecond.keep).toContain(subject.pid);
    expect(legacySecond.ents.find((e: any) => e.id === subject.pid)?.auras[0]).toHaveProperty(
      'rem',
    );
    expect(JSON.stringify(stableSecond).length).toBeLessThan(JSON.stringify(legacySecond).length);
    (stableClient as any).applySnapshot(stableSecond);
    expect(stableClient.entities.get(subject.pid)?.auras[0].remaining).toBeCloseTo(19.95, 5);
  });

  it('uses the recipient capability for spectator self records', () => {
    const server = new GameServer();
    const stableWs = fakeWs();
    const legacyWs = fakeWs();
    const targetWs = fakeWs();
    const stableSpectator = joinServer(server, stableWs, 1, 'StableSpec', 'mage', timerV2);
    const legacySpectator = joinServer(server, legacyWs, 2, 'LegacySpec', 'mage');
    const target = joinServer(server, targetWs, 3, 'Observed', 'mage');
    for (let i = 0; i < 5; i++) server.sim.tick();
    const targetEntity = server.sim.entities.get(target.pid)!;
    targetEntity.auras = [];
    targetEntity.auras.push(testAura('observed_aura', 10));
    targetEntity.cooldowns.set('observed_cast', 5);
    (server as any).enterSpectate(stableSpectator, target);
    (server as any).enterSpectate(legacySpectator, target);
    stableWs.sent.length = 0;
    legacyWs.sent.length = 0;
    broadcast(server);

    const stableSnap = lastSnap(stableWs.sent);
    const legacySnap = lastSnap(legacyWs.sent);
    expect(stableSnap.self.id).toBe(target.pid);
    expect(stableSnap.tw).toBe(2);
    expect(stableSnap.self.auras[0]).toHaveProperty('exp');
    expect(stableSnap.self.cds.observed_cast).toBeCloseTo(server.sim.time + 5, 5);
    expect(legacySnap.self.id).toBe(target.pid);
    expect(legacySnap.tw).toBeUndefined();
    expect(legacySnap.self.auras[0]).toHaveProperty('rem');
    expect(legacySnap.self.cds.observed_cast).toBe(5);
  });

  it('refreshes the negotiated capability on linkdead resume in both directions', () => {
    const server = new GameServer();
    const legacyWs = fakeWs();
    const original = joinServer(server, legacyWs, 1, 'ResumeWire');
    legacyWs.ws.readyState = 3;
    expect(server.socketClosed(original, legacyWs.ws)).toBe(true);

    const stableWs = fakeWs();
    const stableResult = server.join(
      stableWs.ws,
      1,
      1,
      'ResumeWire',
      'warrior',
      null,
      false,
      timerV2,
    );
    if ('error' in stableResult) throw new Error(stableResult.error);
    expect(stableResult).toBe(original);
    expect((stableResult as any).timerWireVersion).toBe(2);
    stableWs.sent.length = 0;
    broadcast(server);
    expect(lastSnap(stableWs.sent).tw).toBe(2);

    stableWs.ws.readyState = 3;
    expect(server.socketClosed(stableResult, stableWs.ws)).toBe(true);
    const fallbackWs = fakeWs();
    const fallback = server.join(fallbackWs.ws, 1, 1, 'ResumeWire', 'warrior', null);
    if ('error' in fallback) throw new Error(fallback.error);
    expect(fallback).toBe(original);
    expect((fallback as any).timerWireVersion).toBe(1);
    fallbackWs.sent.length = 0;
    broadcast(server);
    expect(lastSnap(fallbackWs.sent).tw).toBeUndefined();
  });

  it('falls back to legacy decode solely when the snapshot has no v2 marker', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'OldServer', 'mage');
    const player = server.sim.entities.get(session.pid)!;
    player.auras = [];
    player.auras.push(testAura('old_wire', 6));
    player.cooldowns.set('old_cast', 4);
    broadcast(server);
    const first = lastSnap(fc.sent);
    expect(first.tw).toBeUndefined();

    const client = bareClient(session.pid);
    (client as any).applySnapshot(first);
    expect(client.player.auras[0].remaining).toBe(6);
    expect(client.player.cooldowns.get('old_cast')).toBe(4);

    fc.sent.length = 0;
    for (let i = 0; i < 3; i++) server.sim.tick();
    broadcast(server);
    const second = lastSnap(fc.sent);
    expect(second.tw).toBeUndefined();
    (client as any).applySnapshot(second);
    expect(client.player.auras[0].remaining).toBeCloseTo(5.85, 5);
    expect(client.player.cooldowns.get('old_cast')).toBeCloseTo(3.85, 5);
  });

  it('omits stable auras from moving lite records, then sends an explicit remote removal', () => {
    const server = new GameServer();
    const viewerWs = fakeWs();
    const subjectWs = fakeWs();
    const viewer = joinServer(server, viewerWs, 1, 'MovingViewer', 'mage', timerV2);
    const subject = joinServer(server, subjectWs, 2, 'MovingSubject', 'mage');
    const subjectEntity = server.sim.entities.get(subject.pid)!;
    subjectEntity.auras = [testAura('moving_aura', 20)];

    broadcast(server);
    const first = lastSnap(viewerWs.sent);
    const client = bareClient(viewer.pid, 'mage');
    (client as any).applySnapshot(first);
    expect(client.entities.get(subject.pid)?.auras[0].remaining).toBe(20);

    viewerWs.sent.length = 0;
    server.sim.tick();
    subjectEntity.pos.x += 1;
    subjectEntity.prevPos.x += 1;
    server.sim.grid.update(subjectEntity);
    broadcast(server);
    const moving = lastSnap(viewerWs.sent);
    const lite = moving.ents.find((entity: any) => entity.id === subject.pid);
    expect(lite).toBeDefined();
    expect(lite.k).toBeUndefined();
    expect(lite).not.toHaveProperty('auras');
    (client as any).applySnapshot(moving);
    expect(client.entities.get(subject.pid)?.auras[0].remaining).toBeCloseTo(19.95, 5);

    subjectEntity.auras = [];
    viewerWs.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const removed = lastSnap(viewerWs.sent);
    const removalRow = removed.ents.find((entity: any) => entity.id === subject.pid);
    expect(removalRow.auras).toEqual([]);
    (client as any).applySnapshot(removed);
    expect(client.entities.get(subject.pid)?.auras).toEqual([]);
  });

  it('retains a remote aura revision across a non-due distance-tier tick', () => {
    const server = new GameServer();
    const viewerWs = fakeWs();
    const subjectWs = fakeWs();
    const viewer = joinServer(server, viewerWs, 1, 'DeferredViewer', 'mage', timerV2);
    const subject = joinServer(server, subjectWs, 2, 'DeferredSubject', 'mage');
    const viewerEntity = server.sim.entities.get(viewer.pid)!;
    const subjectEntity = server.sim.entities.get(subject.pid)!;
    subjectEntity.auras = [testAura('deferred_aura', 20, 2)];
    subjectEntity.pos.x = viewerEntity.pos.x + 60;
    subjectEntity.pos.z = viewerEntity.pos.z;
    subjectEntity.prevPos = { ...subjectEntity.pos };
    server.sim.grid.update(subjectEntity);

    broadcast(server);
    expect(lastSnap(viewerWs.sent).ents.some((entity: any) => entity.id === subject.pid)).toBe(
      true,
    );

    server.sim.tick();
    subjectEntity.auras[0].value = 9;
    viewerWs.sent.length = 0;
    broadcast(server);
    const deferred = lastSnap(viewerWs.sent);
    expect(deferred.ents.find((entity: any) => entity.id === subject.pid)).toBeUndefined();
    expect(deferred.keep).toContain(subject.pid);

    server.sim.tick();
    viewerWs.sent.length = 0;
    broadcast(server);
    const delivered = lastSnap(viewerWs.sent).ents.find((entity: any) => entity.id === subject.pid);
    expect(delivered.k).toBeUndefined();
    expect(delivered.auras[0]).toMatchObject({ id: 'deferred_aura', value: 9 });
  });

  it('eliminates stable aura rebuild churn and aggregate bytes over 160 ticks', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'LongWindow', 'mage');
    const player = server.sim.entities.get(session.pid)!;
    player.auras = [testAura('long_window', 60)];
    const internals = server as any;
    internals.perfDetailActive = true;
    internals.bcBaseSerializes = 0;
    internals.bcLegacySerializes = 0;
    internals.bcStableSerializes = 0;
    let legacyBytes = 0;
    let stableBytes = 0;

    for (let i = 0; i < 160; i++) {
      const legacy = internals.wireCacheFor(player, false);
      const stable = internals.wireCacheFor(player, true);
      legacyBytes += (i === 0 ? legacy.fullJson : legacy.liteJson).length;
      stableBytes += i === 0 ? stable.fullAuraJson.length : `{"keep":[${player.id}]}`.length;
      if (i < 159) server.sim.tick();
    }

    expect(internals.bcBaseSerializes).toBe(160);
    expect(internals.bcLegacySerializes).toBeGreaterThan(150);
    expect(internals.bcStableSerializes).toBe(1);
    expect(internals.wireCache.get(player.id).auraCache.rebuilds).toBe(1);
    expect(stableBytes).toBeLessThan(legacyBytes * 0.35);
  });
});
