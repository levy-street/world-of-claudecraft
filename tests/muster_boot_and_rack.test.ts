import { afterEach, describe, expect, it, vi } from 'vitest';

// The Mirefen muster on the two LIVE hosts, and the weapon rack through the real command
// path each of them uses.
//
// The muster used to be raised only once a Balgath existed, so the offline world (whose
// first world-boss rise is an hour out) had no soldiers, no camp and no rack for its first
// hour, and a host whose Balgath was not up had none at all. The live hosts now opt in
// (SimConfig.mirefenMuster) and the muster stands from the first tick, boss or no boss.
//
// The rack: every client entry point (the rack click and the interact key's object arm,
// src/game/interactions.ts and nearby_interaction.ts) sends `pickup`, never `interact`,
// and the sim's pickup refused any object without an item payload, so the rack silently
// did nothing online and offline alike. Driven here through GameServer.handleMessage, the
// exact frames a client sends. Db is mocked (no Postgres), as in the other server rigs.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { buildRealmSimConfig } from '../server/sim_boot_config';
import { offlineWorldConfig } from '../src/game/offline_world_config';
import {
  MUSTER_CAMPS,
  MUSTER_PIKE_LEASH,
  MUSTER_RACK,
  MUSTER_RACK_TEMPLATE_ID,
} from '../src/sim/content/mirefen_muster';
import { MOBS } from '../src/sim/data';
import { DAY_NIGHT_CYCLE_MS, NOON_PHASE } from '../src/sim/day_night';
import { LANCE_FIXED_DAMAGE, LANCE_THRUST_RANGE } from '../src/sim/lance_balance_core';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { eyeWardBlinded } from '../src/sim/mob/eye_ward';
import { MUSTER_SHARDPIKE_ID } from '../src/sim/muster_pike';
import { Sim } from '../src/sim/sim';
import { inertVaultConsumptionAdmission } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

afterEach(() => vi.unstubAllGlobals());

// Every post but the commander's: he is an NPC (the muster quests), raised beside them.
const TOTAL = MUSTER_CAMPS.reduce(
  (n, c) => n + c.soldiers.filter((s) => s.templateId !== 'muster_commander').length,
  0,
);
const army = (sim: Sim) => (sim as unknown as { musterArmy: MusterArmyState }).musterArmy;
const balgaths = (sim: Sim) =>
  [...sim.entities.values()].filter((e) => e.templateId === 'balgath_cyclops');

function expectFullMuster(sim: Sim): Entity {
  const a = army(sim);
  expect(a.soldierIds.length).toBe(TOTAL);
  for (const id of a.soldierIds) {
    const s = sim.entities.get(id);
    expect(s?.kind).toBe('mob');
    expect(s?.dead).toBe(false);
    expect(s?.hostile).toBe(false);
  }
  const commander = a.commanderId !== null ? sim.entities.get(a.commanderId) : undefined;
  expect(commander?.kind, 'the Muster Commander stands at the command camp').toBe('npc');
  expect(commander?.templateId).toBe('muster_commander');
  const rack = a.rackId !== null ? sim.entities.get(a.rackId) : undefined;
  expect(rack?.templateId).toBe(MUSTER_RACK_TEMPLATE_ID);
  expect(rack?.lootable).toBe(true);
  return rack as Entity;
}

describe('the muster stands from boot on both live hosts', () => {
  it('offline: the browser world config raises it on the first tick with no Balgath anywhere', () => {
    let n = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const cfg = offlineWorldConfig({ playerClass: 'mage', name: 'Ana', devCommands: false });
    expect(cfg.mirefenMuster).toBe(true);
    // Pin the sky to midnight so the case never depends on when it runs.
    const sim = new Sim({ ...cfg, dayNightNowMs: () => Date.UTC(2026, 0, 1, 0, 0, 0) });
    sim.tick();
    expectFullMuster(sim);
  });

  // The owner's offline playtest found the soldiers standing round an EMPTY crater: the
  // offline world did not opt into worldBossAtBoot, so his first rise was a full interval
  // (an hour) out and the only Balgath to be had was a /dev spawn. The browser world now
  // boots like the realm does, with him in his bed from the first tick.
  const BED = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops')?.pos ?? { x: 0, z: 0 };
  const BED_RADIUS = MOBS.balgath_cyclops?.slumber?.bedRadius ?? 0;
  function offlineBoot(nowMs: number): Sim {
    let n = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const cfg = offlineWorldConfig({ playerClass: 'mage', name: 'Ana', devCommands: false });
    const sim = new Sim({ ...cfg, dayNightNowMs: () => nowMs });
    sim.tick();
    return sim;
  }

  it('offline: Balgath is in his crater bed on the first tick, asleep by night', () => {
    const sim = offlineBoot(Date.UTC(2026, 0, 1, 0, 0, 0));
    const [boss] = balgaths(sim);
    expect(balgaths(sim)).toHaveLength(1);
    expect(Math.hypot(boss.pos.x - BED.x, boss.pos.z - BED.z)).toBeLessThanOrEqual(BED_RADIUS);
    expect(boss.dead).toBe(false);
    expect(boss.asleep).toBe(true);
    expect(boss.hostile).toBe(false);
    expect(army(sim).bossId).toBe(boss.id);
  });

  it('offline: Balgath is in his crater bed on the first tick, awake by day', () => {
    // Solar noon of the UTC-anchored cycle (NOON_PHASE), whatever the date.
    const sim = offlineBoot(Math.round(DAY_NIGHT_CYCLE_MS * NOON_PHASE));
    const [boss] = balgaths(sim);
    expect(balgaths(sim)).toHaveLength(1);
    expect(Math.hypot(boss.pos.x - BED.x, boss.pos.z - BED.z)).toBeLessThanOrEqual(BED_RADIUS);
    expect(boss.dead).toBe(false);
    expect(boss.asleep).toBe(false);
    expect(boss.hostile).toBe(true);
  });

  it('online: the realm boot config raises it on the first tick, and it outlives his corpse', () => {
    const cfg = buildRealmSimConfig(undefined, inertVaultConsumptionAdmission);
    expect(cfg.mirefenMuster).toBe(true);
    const server = new GameServer();
    const sim: Sim = server.sim;
    sim.tick();
    expectFullMuster(sim);
    // Kill him and clear his corpse window: the muster is still standing, every one of them.
    for (const boss of balgaths(sim)) {
      boss.hp = 0;
      boss.dead = true;
      boss.corpseTimer = 0;
    }
    for (let i = 0; i < 40; i++) sim.tick();
    expect(balgaths(sim).filter((b) => !b.dead)).toEqual([]);
    expectFullMuster(sim);
  });

  it('a world that does not opt in still raises nothing until a Balgath exists', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    for (let i = 0; i < 40; i++) sim.tick();
    expect(army(sim).soldierIds).toEqual([]);
    expect(army(sim).rackId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rack, through the server's command switch
// ---------------------------------------------------------------------------

interface Joined {
  session: { pid: number; blockListLoaded: boolean };
  e: Entity;
  frames: { t: string; rid?: number; ok?: boolean; list?: { type: string; text?: string }[] }[];
}

function join(server: GameServer, id: number, cls: 'warrior' | 'mage'): Joined {
  const frames: Joined['frames'] = [];
  const ws = { readyState: 1, send: (payload: string) => frames.push(JSON.parse(payload)) };
  // biome-ignore lint/suspicious/noExplicitAny: the rig drives GameServer's private surface
  const session = (server as any).join(ws, id, id, `Pikeman${id}`, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  const e = server.sim.entities.get(session.pid) as Entity;
  return { session, e, frames };
}

function metaOf(sim: Sim, pid: number) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`no meta for ${pid}`);
  return meta;
}

function stand(server: GameServer, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, server.sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function send(server: GameServer, j: Joined, msg: Record<string, unknown>): void {
  // biome-ignore lint/suspicious/noExplicitAny: the rig drives GameServer's private surface
  (server as any).handleMessage(j.session, JSON.stringify({ t: 'cmd', ...msg }));
}

describe('the weapon rack lends a Shardpike through the real command path', () => {
  it('a rack click (the pickup command) equips the pike at level 1, remembering the weapons', () => {
    const server = new GameServer();
    const sim: Sim = server.sim;
    sim.tick();
    const rack = expectFullMuster(sim);
    const j = join(server, 7, 'mage');
    const meta = metaOf(sim, j.session.pid);
    expect(j.e.level).toBe(1);
    const before = { mainhand: meta.equipment.mainhand, offhand: meta.equipment.offhand };
    expect(before.mainhand).toBeTruthy();
    // Beside the rack, well inside interact reach.
    stand(server, j.e, MUSTER_RACK.x, MUSTER_RACK.z + 2.5);
    send(server, j, { cmd: 'pickup', id: rack.id, rid: 11 });
    expect(meta.equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    expect(army(sim).lent.get(j.session.pid)).toEqual({
      mainhand: before.mainhand ?? null,
      offhand: before.offhand ?? null,
    });
    // The client's pending-command promise resolves true (the rack did something).
    expect(j.frames.find((f) => f.t === 'commandOutcome' && f.rid === 11)?.ok).toBe(true);
    // The loan ends when he walks out of the muster's reach: pike gone, weapons back.
    stand(server, j.e, MUSTER_PIKE_LEASH.x + MUSTER_PIKE_LEASH.radius + 20, MUSTER_PIKE_LEASH.z);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(meta.equipment.mainhand).toBe(before.mainhand);
    expect(meta.equipment.offhand).toBe(before.offhand);
    expect(sim.countItem(MUSTER_SHARDPIKE_ID, j.session.pid)).toBe(0);
    expect(army(sim).lent.has(j.session.pid)).toBe(false);
  });

  it('the interact key reaches the rack too, and a second take is refused politely', () => {
    const server = new GameServer();
    const sim: Sim = server.sim;
    sim.tick();
    const rack = expectFullMuster(sim);
    const j = join(server, 8, 'warrior');
    const meta = metaOf(sim, j.session.pid);
    stand(server, j.e, MUSTER_RACK.x + 1, MUSTER_RACK.z + 2.5);
    send(server, j, { cmd: 'interact' });
    expect(meta.equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    send(server, j, { cmd: 'pickup', id: rack.id, rid: 12 });
    expect(j.frames.find((f) => f.t === 'commandOutcome' && f.rid === 12)?.ok).toBe(false);
    expect(sim.countItem(MUSTER_SHARDPIKE_ID, j.session.pid)).toBe(0);
  });

  it('refuses from out of reach, and nothing moves', () => {
    const server = new GameServer();
    const sim: Sim = server.sim;
    sim.tick();
    const rack = expectFullMuster(sim);
    const j = join(server, 9, 'warrior');
    const meta = metaOf(sim, j.session.pid);
    const before = meta.equipment.mainhand;
    stand(server, j.e, MUSTER_RACK.x, MUSTER_RACK.z + 9);
    send(server, j, { cmd: 'pickup', id: rack.id, rid: 13 });
    expect(meta.equipment.mainhand).toBe(before);
    expect(j.frames.find((f) => f.t === 'commandOutcome' && f.rid === 13)?.ok).toBe(false);
    expect(army(sim).lent.has(j.session.pid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The lent pike, all the way to his eye, through the server's command switch
// ---------------------------------------------------------------------------

// The owner's playtest: braced with the rack's pike, the Barrowglass Thrust did nothing. Both
// thrust gates compared the main hand against Skerrit's quest pike by literal id, so the
// lent copy (which the brace accepts through isShardpikeItem) had its session ended silently
// at the thrust and its throw dropped at release. Driven here as a client does it: the rack
// click, `lance_brace`, the beam held on the strafe keys through real ticks, `lance_thrust`.
describe('the lent pike puts his eye out through the real command path', () => {
  function holdBeamUntilSet(sim: Sim, pid: number): void {
    const meta = metaOf(sim, pid);
    for (let i = 0; i < 20 * 10 && meta.lance?.phase !== 'steadied'; i++) {
      const beam = meta.lance?.beam;
      if (!beam) throw new Error('the brace broke before the pike was set');
      // Lean against the fall: a key pushes the marker toward its own side, so a beam
      // falling right (positive) is caught with the LEFT key.
      const lean = beam.balance + beam.velocity * 0.4;
      meta.moveInput.strafeLeft = lean > 0.02;
      meta.moveInput.strafeRight = lean < -0.02;
      sim.tick();
    }
    meta.moveInput.strafeRight = false;
    meta.moveInput.strafeLeft = false;
    expect(meta.lance?.phase, 'the pike never set').toBe('steadied');
  }

  function armAndThrust(server: GameServer, id: number, boss: Entity): Joined {
    const sim = server.sim;
    const rack = expectFullMuster(sim);
    const j = join(server, id, 'mage');
    stand(server, j.e, MUSTER_RACK.x, MUSTER_RACK.z + 2.5);
    send(server, j, { cmd: 'pickup', id: rack.id, rid: 21 });
    expect(metaOf(sim, j.session.pid).equipment.mainhand).toBe(MUSTER_SHARDPIKE_ID);
    // Ten yards off his middle (he fights from nine): plainly inside the thrust's reach.
    stand(server, j.e, boss.pos.x, boss.pos.z - 10);
    j.e.onGround = true;
    // Hold every mob still: the stance breaks on any shove, and a slam is not under test.
    sim.setDevMobsFrozen(true);
    send(server, j, { cmd: 'lance_brace' });
    expect(metaOf(sim, j.session.pid).lance?.phase).toBe('bracing');
    holdBeamUntilSet(sim, j.session.pid);
    const hp = boss.hp;
    send(server, j, { cmd: 'lance_thrust' });
    for (let i = 0; i < 40; i++) sim.tick();
    expect(boss.hp, 'the thrust never landed').toBe(hp - LANCE_FIXED_DAMAGE);
    expect(eyeWardBlinded(sim.ctx, boss), 'the eye was not put out').toBe(true);
    expect(metaOf(sim, j.session.pid).lanceThrusts).toBe(1);
    return j;
  }

  it('hits and blinds the scheduled Balgath, awake in his crater by day', () => {
    // Solar noon of the UTC-anchored cycle on a 2026 day, so he is up whatever the date.
    const day = Math.floor(Date.UTC(2026, 5, 1) / DAY_NIGHT_CYCLE_MS) * DAY_NIGHT_CYCLE_MS;
    vi.spyOn(Date, 'now').mockReturnValue(day + Math.round(DAY_NIGHT_CYCLE_MS * NOON_PHASE));
    try {
      const server = new GameServer();
      server.sim.tick();
      const [boss] = balgaths(server.sim);
      expect(boss, 'no scheduled Balgath').toBeDefined();
      expect(boss.asleep).toBe(false);
      armAndThrust(server, 31, boss);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('hits and blinds a /dev spawn copy, even with the scheduled one asleep in his bed', () => {
    const night = Math.floor(Date.UTC(2026, 5, 1) / DAY_NIGHT_CYCLE_MS) * DAY_NIGHT_CYCLE_MS;
    vi.spyOn(Date, 'now').mockReturnValue(night);
    try {
      const server = new GameServer();
      const sim = server.sim;
      sim.tick();
      const [sleeper] = balgaths(sim);
      expect(sleeper?.asleep).toBe(true);
      // The copy stands just north of the bed, so the pikeman (ten yards south of the copy)
      // is standing NEARER the sleeper: the awake one must still be the one the pike finds.
      const copyId = sim.spawnDevBoss('balgath_cyclops', sleeper.pos.x, sleeper.pos.z + 6);
      const copy = sim.entities.get(copyId) as Entity;
      const sleeperHp = sleeper.hp;
      const j = armAndThrust(server, 32, copy);
      const toSleeper = Math.hypot(j.e.pos.x - sleeper.pos.x, j.e.pos.z - sleeper.pos.z);
      const toCopy = Math.hypot(j.e.pos.x - copy.pos.x, j.e.pos.z - copy.pos.z);
      expect(toSleeper).toBeLessThan(toCopy);
      expect(toSleeper).toBeLessThan(LANCE_THRUST_RANGE);
      expect(sleeper.hp).toBe(sleeperHp);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
