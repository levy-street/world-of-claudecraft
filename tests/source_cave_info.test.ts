import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so importing server/game (for wireEntity) needs no Postgres.
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
}));

import { wireEntity } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { isDelvePos } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  isSourceCavePos,
  SOURCE_CAVE_DEF,
  SOURCE_CAVE_DUNGEON_ID,
  sourceCaveOrigin,
  sourceCaveTierWeaponForLogin,
} from '../src/sim/source_cave';
import type { SourceCaveRosterEntry } from '../src/sim/source_cave/types';
import type { Entity } from '../src/sim/types';
import type { SourceCaveInfo } from '../src/world_api/dungeons';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

const ROSTER: SourceCaveRosterEntry[] = [
  { login: 'alpha', mergedPrs: 90, rank: 1 },
  { login: 'bravo', mergedPrs: 8, rank: 2 },
  { login: 'charlie', mergedPrs: 0, rank: 3 },
];

function makeSim(roster: SourceCaveRosterEntry[] = ROSTER, seed = 1234): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    sourceCaveRoster: roster,
  }) as AnySim;
}

function enteredCave(sim: AnySim): { pid: number; inst: any } {
  const pid = sim.playerId;
  sim.setPlayerLevel(20, pid);
  sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
  const inst = sim.instances.find(
    (i: { dungeonId: string; partyKey: string | null }) =>
      i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
  return { pid, inst };
}

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly.
// Mirrors tests/snapshots.test.ts bareClient.
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

function selfSnapshot(pid: number, scave: unknown): unknown {
  return {
    t: 'snap',
    ents: [],
    self: {
      id: pid,
      k: 'player',
      tid: 'warrior',
      nm: 'Alice',
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
      scave,
    },
  };
}

describe('sourceCaveInfoWire: pure projection', () => {
  it('returns null when no cave exists', () => {
    const sim = makeSim();
    sim.sourceCave = null;
    expect(sim.sourceCaveInfoWire(sim.playerId)).toBeNull();
    expect(sim.sourceCaveInfo()).toBeNull();
  });

  it('projects the static roster (module count, mobs, total) regardless of instance', () => {
    const sim = makeSim();
    const info = sim.sourceCaveInfo() as SourceCaveInfo;
    expect(info.totalMobs).toBe(3);
    expect(info.moduleCount).toBe(1); // the cave is always the single arena room
    expect(info.modules).toEqual(['source_cave_arena']);
    expect(info.mobs.map((m) => m.login).sort()).toEqual(['alpha', 'bravo', 'charlie']);
    // The rank-1 contributor (alpha) is the boss; exactly one boss in the roster.
    expect(info.mobs.filter((m) => m.boss).length).toBe(1);
    expect(info.mobs.find((m) => m.boss)?.login).toBe('alpha');
    // Before entering, no active instance => no kill progress and no lockout.
    expect(info.killed).toBe(0);
    expect(info.cleared).toBe(false);
  });

  it('stays the single arena room for a much larger roster', () => {
    // A larger roster changes ring placement, never the module list: this pins
    // that a regression bringing back per-roster module scaling would be caught.
    const bigRoster: SourceCaveRosterEntry[] = Array.from({ length: 40 }, (_, i) => ({
      login: `contributor${i}`,
      mergedPrs: 40 - i,
      rank: i + 1,
    }));
    const sim = makeSim(bigRoster);
    const info = sim.sourceCaveInfo() as SourceCaveInfo;
    expect(info.moduleCount).toBe(1);
    expect(info.modules).toEqual(['source_cave_arena']);
    expect(info.totalMobs).toBeLessThanOrEqual(42);
    expect(info.totalMobs).toBe(
      sim.sourceCave.spec.mobs.filter((mob: { combatant?: boolean }) => mob.combatant === true)
        .length,
    );
  });

  it('projects prestige rung and combat role separately, including where they diverge', () => {
    // The nameplate shows a DIFFERENT one per encounter phase, so the wire has to
    // carry both. A roster past the combat budget makes them genuinely disagree:
    // rank 3 is a Worldwright by merged PRs but fights as an Architect, and the
    // tail past rank 42 keeps its rung while carrying no combat role at all.
    const roster: SourceCaveRosterEntry[] = Array.from({ length: 44 }, (_, i) => ({
      login: `contributor${i + 1}`,
      mergedPrs: Math.max(1, 300 - i * 7),
      rank: i + 1,
    }));
    const byLogin = new Map(
      ((makeSim(roster).sourceCaveInfo() as SourceCaveInfo).mobs ?? []).map((mob) => [
        mob.login,
        mob,
      ]),
    );

    // Rank 3 (286 PRs) is a Worldwright by prestige, an Architect by role.
    expect(byLogin.get('contributor3')).toMatchObject({
      tier: 'worldwright',
      combatTier: 'architect',
      combatant: true,
    });
    // Rank 1 is the boss and holds the top role on both sides.
    expect(byLogin.get('contributor1')).toMatchObject({
      tier: 'worldwright',
      combatTier: 'worldwright',
      boss: true,
    });
    // Rank 43 is past the 42-role budget: prestige survives, the role is null.
    expect(byLogin.get('contributor43')).toMatchObject({ combatant: false, combatTier: null });
    expect(byLogin.get('contributor43')?.tier).not.toBeNull();
    // Exactly the tail overflows, and every combatant carries a role.
    const guardians = [...byLogin.values()].filter((mob) => !mob.combatant);
    expect(guardians.map((mob) => mob.login).sort()).toEqual(['contributor43', 'contributor44']);
    expect([...byLogin.values()].every((mob) => mob.combatant === (mob.combatTier !== null))).toBe(
      true,
    );
  });

  it('projects a below-threshold contributor as an unranked rung, not a fabricated one', () => {
    // charlie has 0 merged PRs: no prestige rung at all. The wire must say null
    // rather than defaulting to the first rung, or the friendly-phase nameplate
    // would award a title nobody earned.
    const info = makeSim().sourceCaveInfo() as SourceCaveInfo;
    const charlie = info.mobs.find((mob) => mob.login === 'charlie');
    expect(charlie?.tier).toBeNull();
    expect(info.mobs.find((mob) => mob.login === 'alpha')?.tier).toBe('worldwright');
  });

  it('projects the elite display flag from the spec, not just the boss flag', () => {
    // alpha (90 PRs) clears the elite dev-tier threshold; charlie (0 PRs) does not,
    // so a regression that dropped/inverted/swapped the elite mapping in the wire
    // projection would slip through if only `boss` were ever asserted.
    const sim = makeSim();
    const info = sim.sourceCaveInfo() as SourceCaveInfo;
    const byLogin = new Map(info.mobs.map((m) => [m.login, m]));
    expect(byLogin.get('alpha')?.elite).toBe(true);
    expect(byLogin.get('charlie')?.elite).toBe(false);
  });

  it('counts killed mobs in the player active instance via the clear.ts liveness idiom', () => {
    const sim = makeSim();
    const { pid, inst } = enteredCave(sim);
    expect((sim.sourceCaveInfo() as SourceCaveInfo).killed).toBe(0);

    // Despawned mob (entity removed) AND flagged-dead corpse both count as killed.
    sim.entities.delete(inst.mobIds[0]);
    (sim.entities.get(inst.mobIds[1]) as Entity).dead = true;
    const info = sim.sourceCaveInfoWire(pid) as SourceCaveInfo;
    expect(info.killed).toBe(2);
    expect(info.totalMobs).toBe(3);
  });

  it('projects every visible contributor but counts only the fixed combat roster', () => {
    const roster: SourceCaveRosterEntry[] = Array.from({ length: 60 }, (_, i) => ({
      login: `contributor-${i}`,
      mergedPrs: i === 0 ? 90 : i < 7 ? 30 : i < 13 ? 15 : i < 21 ? 5 : 1,
      rank: i + 1,
    }));
    const sim = makeSim(roster);
    const { pid, inst } = enteredCave(sim);
    const combatIds = new Set<number>(inst.sourceCaveEncounter.waves.flat());
    const spectatorId = inst.mobIds.find((id: number) => !combatIds.has(id)) as number;
    expect(sim.sourceCaveInfoWire(pid) as SourceCaveInfo).toMatchObject({
      totalMobs: 42,
      killed: 0,
    });
    expect((sim.sourceCaveInfoWire(pid) as SourceCaveInfo).mobs.length).toBe(60);

    (sim.entities.get(spectatorId) as Entity).dead = true;
    expect((sim.sourceCaveInfoWire(pid) as SourceCaveInfo).killed).toBe(0);
    const combatId = [...combatIds][0];
    (sim.entities.get(combatId) as Entity).dead = true;
    expect((sim.sourceCaveInfoWire(pid) as SourceCaveInfo).killed).toBe(1);
  });

  it('killed is scoped to the viewer own instance, not shared across instances', () => {
    // Two unrelated players (no party) each claim their OWN solo cave instance
    // (instanceKeyFor => `solo:<pid>`). A regression that matched the first cave
    // instance found, or counted dead mobs across every cave instance, would still
    // pass every other test here since they all use a single player.
    const sim = new Sim({
      seed: 1234,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      sourceCaveRoster: ROSTER,
    }) as AnySim;
    const pidA = sim.addPlayer('warrior', 'Alice');
    const pidB = sim.addPlayer('warrior', 'Bob');
    sim.setPlayerLevel(20, pidA);
    sim.setPlayerLevel(20, pidB);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pidA);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pidB);
    const instances = sim.instances.filter(
      (i: { dungeonId: string; partyKey: string | null }) =>
        i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
    );
    expect(instances.length).toBe(2);
    const [instA, instB] = instances;
    expect(instA.partyKey).not.toBe(instB.partyKey);

    // Kill every mob in A's instance only; B's instance is untouched.
    for (const id of instA.mobIds) (sim.entities.get(id) as Entity).dead = true;

    const infoA = sim.sourceCaveInfoWire(pidA) as SourceCaveInfo;
    const infoB = sim.sourceCaveInfoWire(pidB) as SourceCaveInfo;
    expect(infoA.killed).toBe(instA.mobIds.length);
    expect(infoB.killed).toBe(0);
  });

  it('cleared reflects an active lockout, and is false for an expired or absent one', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid);

    // Absent lockout => not cleared.
    expect((sim.sourceCaveInfo() as SourceCaveInfo).cleared).toBe(false);

    // Active lockout => cleared.
    meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, sim.lockoutNowMs() + 100_000);
    expect((sim.sourceCaveInfo() as SourceCaveInfo).cleared).toBe(true);

    // Expired lockout => not cleared.
    meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, sim.lockoutNowMs() - 1);
    expect((sim.sourceCaveInfo() as SourceCaveInfo).cleared).toBe(false);
  });
});

describe('sourceCaveInfo: Sim vs ClientWorld getter parity', () => {
  it('both worlds surface the same shape for a player inside the cave with mobs dead', () => {
    const sim = makeSim();
    const { pid, inst } = enteredCave(sim);
    (sim.entities.get(inst.mobIds[0]) as Entity).dead = true;
    sim.players.get(pid).raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, sim.lockoutNowMs() + 50_000);

    const simInfo = sim.sourceCaveInfo() as SourceCaveInfo;
    expect(simInfo.killed).toBe(1);
    expect(simInfo.cleared).toBe(true);

    // The server ships sourceCaveInfoWire(pid) as the snapshot self `scave` field;
    // round-trip it through JSON to mirror the real wire, then decode on the client.
    const wire = JSON.parse(JSON.stringify(sim.sourceCaveInfoWire(pid)));
    const client = bareClient(pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(
      selfSnapshot(pid, wire),
    );
    expect(client.sourceCaveInfo()).toEqual(simInfo);
  });

  it('an absent scave key leaves the mirrored value unchanged (delta invariant)', () => {
    const client = bareClient(1) as any;
    const prior: SourceCaveInfo = {
      moduleCount: 2,
      modules: ['reliquary_sunken_ossuary', 'reliquary_finale'],
      mobs: [],
      totalMobs: 0,
      killed: 3,
      cleared: true,
      sealState: 'cleared',
      playersInsideSeal: 0,
      playersInInstance: 0,
      activeWave: 0,
      totalWaves: 0,
    };
    client.mirroredSourceCaveInfo = prior;
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'A',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 1,
        mhp: 1,
        res: 0,
        mres: 0,
        rtype: 'rage',
      },
    });
    // No scave key present => prior mirror kept intact.
    expect(client.sourceCaveInfo()).toEqual(prior);
  });
});

describe('source cave: hostile contributor login rides nm verbatim (D7 regression)', () => {
  it('a shell/HTML-looking login survives spec -> mob name -> wireEntity nm unchanged', () => {
    const hostile: SourceCaveRosterEntry[] = [
      { login: 'rm -rf /', mergedPrs: 99, rank: 1 },
      { login: '<script>alert(1)</script>', mergedPrs: 5, rank: 2 },
      { login: "'; DROP TABLE characters; --", mergedPrs: 1, rank: 3 },
    ];
    const sim = makeSim(hostile, 4242);
    // Verbatim through spec generation.
    expect(sim.sourceCave.spec.mobs.map((m: { login: string }) => m.login).sort()).toEqual([
      "'; DROP TABLE characters; --",
      '<script>alert(1)</script>',
      'rm -rf /',
    ]);

    const { inst } = enteredCave(sim);
    const byName = new Map<string, Entity>();
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id) as Entity;
      byName.set(e.name, e);
      // Verbatim through the entity name (template id embeds the login too).
      expect(e.name).toBe(hostile.find((h) => e.templateId === `source_cave_${h.login}`)?.login);
    }

    // Verbatim through the wire `nm` field for every hostile login.
    for (const h of hostile) {
      const e = byName.get(h.login) as Entity;
      expect(e, `mob ${h.login} spawned`).toBeDefined();
      const wire = wireEntity(e);
      expect(wire.nm).toBe(h.login);
    }
  });
});

describe('source cave: a character saved inside the cave relogs at the cave door (bug g)', () => {
  it('ejects to the cave own overworld door, not the DELVE_LIST[0] door', () => {
    const src = makeSim();
    const state = src.serializeCharacter(src.playerId)!;
    const origin = sourceCaveOrigin(0);
    state.pos = { x: origin.x, z: origin.z + 20 }; // deep inside cave slot 0

    const dst = new Sim({
      seed: 1234,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      sourceCaveRoster: ROSTER,
    }) as AnySim;
    const pid = dst.addPlayer('warrior', 'Relogged', { state });
    const e = dst.entities.get(pid) as Entity;

    const door = SOURCE_CAVE_DEF.doorPos;
    expect(Math.abs(e.pos.x - door.x)).toBeLessThan(1); // at the cave door (~165), NOT a delve door
    expect(Math.abs(e.pos.z - (door.z - 4))).toBeLessThan(1); // z-4 eject offset
    expect(isSourceCavePos(e.pos.x)).toBe(false);
    expect(isDelvePos(e.pos.x)).toBe(false);
  });
});

describe('source cave: per-mob model override rides the identity wire', () => {
  it('encodes `vk` for a top-rung contributor mob (no `mh`: the dev_hacker rig is unarmed)', () => {
    const sim = makeSim();
    const { inst } = enteredCave(sim);
    const alpha = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.name === 'alpha') as Entity; // mergedPrs 90 -> worldwright rung
    expect(alpha.visualKey).toBe('dev_hacker');
    const wire = wireEntity(alpha);
    expect(wire.vk).toBe('dev_hacker');
    expect(wire.mh).toBeUndefined();
  });

  it('encodes `mh` for the armed tiers: the per-mob weapon rides the identity wire', () => {
    const sim = makeSim([
      { login: 'boss', mergedPrs: 90, rank: 1 },
      { login: 'archie', mergedPrs: 40, rank: 2 }, // architect rung
      { login: 'runa', mergedPrs: 20, rank: 3 }, // runesmith rung
    ]);
    const { inst } = enteredCave(sim);
    const byName = new Map<string, Entity>(
      inst.mobIds.map((id: number) => {
        const e = sim.entities.get(id) as Entity;
        return [e.name, e];
      }),
    );
    const archie = byName.get('archie') as Entity;
    expect(archie.mainhandItemId).toBe('commit_blade');
    expect(wireEntity(archie).mh).toBe('commit_blade');
    const runa = byName.get('runa') as Entity;
    expect(runa.mainhandItemId).toBe(sourceCaveTierWeaponForLogin('runesmith', 'runa')?.itemId);
    expect(wireEntity(runa).mh).toBe(runa.mainhandItemId);
  });

  it('a below-first-rung contributor still ships a dev body', () => {
    const sim = makeSim();
    const { inst } = enteredCave(sim);
    const charlie = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.name === 'charlie') as Entity; // mergedPrs 0 -> no rung
    expect(charlie.visualKey).toBe('dev_noob');
    const wire = wireEntity(charlie);
    expect(wire.vk).toBe('dev_noob');
    expect(wire.mh).toBeUndefined();
    // The encode-omission arm (no override -> no `vk` byte) still holds for a
    // mob without a visualKey.
    charlie.visualKey = null;
    expect(wireEntity(charlie).vk).toBeUndefined();
  });

  it('decodes `vk` onto the mirrored client entity, and defaults to null when absent', () => {
    const client = bareClient(99);
    const withOverride = {
      id: 501,
      k: 'mob',
      tid: 'source_cave_alpha',
      nm: 'alpha',
      lv: 20,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      vk: 'mob_reedbound_acolyte',
    };
    const withoutOverride = {
      id: 502,
      k: 'mob',
      tid: 'source_cave_charlie',
      nm: 'charlie',
      lv: 19,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
    };
    (client as any).applySnapshot({ t: 'snap', ents: [withOverride, withoutOverride] });
    expect(client.entities.get(501)!.visualKey).toBe('mob_reedbound_acolyte');
    expect(client.entities.get(502)!.visualKey).toBeNull();
  });
});
