// The Smith's Heart's death checkpoints (content/smith_heart_checkpoints.ts,
// encounters/smith_heart/checkpoint_order.ts and checkpoint.ts, applied by
// instances/dungeon_checkpoints.ts): a spirit that walks back in rises in the
// room of the guardian the raid killed LAST, or on the Heart's Arrival Terrace
// once all four guardians are down (and the seal's portal is open), or at the
// entrance before any kill. Each point stands at its room's door, off the
// fight's floor and clear of its hazards, behind exactly the gates it lists;
// the rule is per claim, reset with it, and the same through the server.

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { isBlocked } from '../src/sim/colliders';
import { handleDeath } from '../src/sim/combat/damage';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_GATES,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
} from '../src/sim/content/smith_heart';
import {
  SMITH_HEART_CHECKPOINTS,
  type SmithHeartCheckpointRoom,
} from '../src/sim/content/smith_heart_checkpoints';
import {
  BREATH,
  CORNICE_GAPS,
  HAMMER_PIT,
  HEART_RETURN_PORTAL,
  RING_PORTAL,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  inBreathArena,
  inHearthFloor,
  insideRimewall,
  onLakeIce,
} from '../src/sim/encounters/smith_heart';
import {
  noteSmithHeartKills,
  smithHeartCheckpointRooms,
} from '../src/sim/encounters/smith_heart/checkpoint_order';
import { COUNCIL_ARENA_R } from '../src/sim/encounters/smith_heart/council_scope';
import { onAnvil } from '../src/sim/encounters/smith_heart/final_scope';
import { SMITH_HEART_VEIN_BITS, smithHeartProgress } from '../src/sim/encounters/smith_heart/seal';
import { dungeonReentryPoint } from '../src/sim/instances/dungeon_checkpoints';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon, freeInstance } from '../src/sim/instances/dungeons';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { RES_HP_FRACTION } from '../src/sim/spirit';
import type { Entity, WorldContent } from '../src/sim/types';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const DUNGEON = DUNGEONS.smith_heart;
const P = SMITH_HEART_CHECKPOINTS;

beforeEach(() => clearDungeonGateStateForTest());

function setup(seed = 17) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Heartwalker');
  expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst, player: sim.entities.get(pid) as Entity };
}

function slay(sim: Sim, pid: number, mob: Entity | undefined) {
  if (mob && !mob.dead) handleDeath(sim.ctx, mob, sim.entities.get(pid) ?? null);
}

function placed(sim: Sim, inst: InstanceSlot, pred: (i: number) => boolean): Entity[] {
  const out: Entity[] = [];
  DUNGEON.spawns.forEach((_, i) => {
    const e = sim.entities.get(inst.mobIds[i]);
    if (e && pred(i)) out.push(e);
  });
  return out;
}

function killPacks(sim: Sim, pid: number, inst: InstanceSlot, packs: readonly string[]) {
  for (const e of placed(sim, inst, (i) => packs.includes(DUNGEON.spawns[i].packId ?? '')))
    slay(sim, pid, e);
}

function killBoss(sim: Sim, pid: number, inst: InstanceSlot, templateId: string) {
  for (const e of placed(sim, inst, (i) => DUNGEON.spawns[i].mobId === templateId))
    slay(sim, pid, e);
}

/** Win a vein's fight the way a raid does (its packs, then its guardian, or
 *  the whole council), then let a tick pass so the kill has its own tick. */
function win(sim: Sim, pid: number, inst: InstanceSlot, vein: SmithHeartVein) {
  killPacks(sim, pid, inst, SMITH_HEART_PACKS[vein]);
  if (vein === 'hammer') for (const id of SMITH_HEART_COUNCIL) killBoss(sim, pid, inst, id);
  else killBoss(sim, pid, inst, SMITH_HEART_GUARDIANS[vein]);
  sim.tick();
}

function die(sim: Sim, pid: number) {
  const player = sim.entities.get(pid) as Entity;
  player.dead = true;
  sim.releaseSpirit(pid);
  expect(player.ghost).toBe(true);
}

function local(inst: InstanceSlot, e: Entity) {
  const o = instanceOrigin(DUNGEON.index, inst.slot);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

/** Die where you stand, release, walk back in through the door. */
function runBack(sim: Sim, pid: number, inst: InstanceSlot) {
  die(sim, pid);
  expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
  const player = sim.entities.get(pid) as Entity;
  expect(player.dead).toBe(false);
  expect(player.ghost).toBe(false);
  return local(inst, player);
}

function expectAt(at: { x: number; z: number }, room: SmithHeartCheckpointRoom | 'entry') {
  const want = room === 'entry' ? DUNGEON.entry : P[room].pos;
  expect(at.x).toBeCloseTo(want.x, 6);
  expect(at.z).toBeCloseTo(want.z, 6);
}

describe('the rooms to try (pure)', () => {
  it('none before a kill, the last kill first, the Heart first once all four are down', () => {
    expect(smithHeartCheckpointRooms([])).toEqual([]);
    expect(smithHeartCheckpointRooms(['hammer'])).toEqual(['hammer']);
    expect(smithHeartCheckpointRooms(['hammer', 'breath'])).toEqual(['breath', 'hammer']);
    expect(smithHeartCheckpointRooms(['hammer', 'quench', 'breath'])).toEqual([
      'breath',
      'quench',
      'hammer',
    ]);
    expect(smithHeartCheckpointRooms(['hammer', 'heat', 'breath', 'quench'])).toEqual([
      'final',
      'quench',
      'breath',
      'heat',
      'hammer',
    ]);
  });
});

describe("the Smith's Heart death checkpoints", () => {
  it('a spirit rises at the entrance before any guardian falls', () => {
    const { sim, pid, inst, player } = setup();
    killPacks(sim, pid, inst, SMITH_HEART_PACKS.hammer);
    sim.tick();
    expectAt(runBack(sim, pid, inst), 'entry');
    expect(player.hp).toBe(Math.max(1, Math.round(player.maxHp * RES_HP_FRACTION)));
  });

  it('rises in the Quarry once the council has fallen', () => {
    const { sim, pid, inst } = setup();
    win(sim, pid, inst, 'hammer');
    expectAt(runBack(sim, pid, inst), 'hammer');
  });

  it.each([
    ['breath', 'quench'],
    ['quench', 'breath'],
    ['heat', 'breath'],
    ['breath', 'heat'],
    ['quench', 'heat'],
    ['heat', 'quench'],
  ] as const)('kills %s then %s: rises in the last one killed', (a, b) => {
    const { sim, pid, inst } = setup();
    win(sim, pid, inst, 'hammer');
    win(sim, pid, inst, a);
    expectAt(runBack(sim, pid, inst), a);
    win(sim, pid, inst, b);
    expectAt(runBack(sim, pid, inst), b);
  });

  it('a kill landed this very tick still counts', () => {
    const { sim, pid, inst } = setup();
    win(sim, pid, inst, 'hammer');
    killPacks(sim, pid, inst, SMITH_HEART_PACKS.quench);
    killBoss(sim, pid, inst, SMITH_HEART_GUARDIANS.quench);
    expectAt(runBack(sim, pid, inst), 'quench');
  });

  it('all four down and the portal open: rises on the Heart terrace', () => {
    const { sim, pid, inst } = setup();
    for (const v of ['hammer', 'heat', 'quench', 'breath'] as const) win(sim, pid, inst, v);
    killPacks(sim, pid, inst, SMITH_HEART_PACKS.ring);
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    expectAt(runBack(sim, pid, inst), 'final');
  });

  it('all four down but the portal shut (the Ring alive): the last guardian instead', () => {
    const { sim, pid, inst } = setup();
    for (const v of ['hammer', 'heat', 'breath', 'quench'] as const) win(sim, pid, inst, v);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    expectAt(runBack(sim, pid, inst), 'quench');
  });

  it('a hostile body on the latest point gives way to the kill before it', () => {
    const { sim, pid, inst } = setup();
    win(sim, pid, inst, 'hammer');
    win(sim, pid, inst, 'breath');
    win(sim, pid, inst, 'quench');
    const ringMob = placed(
      sim,
      inst,
      (i) => (DUNGEON.spawns[i].packId ?? '') === SMITH_HEART_PACKS.ring[0],
    )[0];
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    ringMob.pos = sim.ctx.groundPos(o.x + P.quench.pos.x + 3, o.z + P.quench.pos.z);
    ringMob.prevPos = { ...ringMob.pos };
    ringMob.spawnPos = { ...ringMob.pos };
    sim.ctx.rebucket(ringMob);
    die(sim, pid);
    expect(dungeonReentryPoint(sim.ctx, inst, sim.entities.get(pid) as Entity)).toEqual(
      P.breath.pos,
    );
  });

  it('a fresh claim forgets the old run order', () => {
    const { sim, pid, inst } = setup();
    for (const v of ['hammer', 'quench', 'breath'] as const) win(sim, pid, inst, v);
    expectAt(runBack(sim, pid, inst), 'breath');
    const oldExit = inst.exitId;
    freeInstance(sim.ctx, inst);
    expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
    const fresh = sim.ctx.instances.find(
      (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
    ) as InstanceSlot;
    expect(fresh.exitId).not.toBe(oldExit);
    sim.tick();
    expectAt(runBack(sim, pid, fresh), 'entry');
    for (const v of ['hammer', 'breath', 'quench'] as const) win(sim, pid, fresh, v);
    expectAt(runBack(sim, pid, fresh), 'quench');
  });

  it('keys the order by the claim and its exit, so a recycled slot never inherits it', () => {
    const inst = { partyKey: 'solo:1', exitId: 1 } as InstanceSlot;
    const B = SMITH_HEART_VEIN_BITS;
    noteSmithHeartKills(inst, B.hammer, B);
    noteSmithHeartKills(inst, B.hammer | B.heat, B);
    expect(noteSmithHeartKills(inst, B.hammer | B.heat | B.breath, B)).toEqual([
      'hammer',
      'heat',
      'breath',
    ]);
    // The same slot object claimed again (a new exit), first seen this far
    // along: in vein order, never the old run's.
    inst.exitId = 2;
    expect(noteSmithHeartKills(inst, B.hammer | B.heat | B.breath, B)).toEqual([
      'hammer',
      'breath',
      'heat',
    ]);
    // A fight standing up again (a dev reset) leaves the order.
    expect(noteSmithHeartKills(inst, B.hammer | B.heat, B)).toEqual(['hammer', 'heat']);
    expect(noteSmithHeartKills({ partyKey: null, exitId: 3 } as InstanceSlot, 15, B)).toEqual([]);
  });

  it('is shared by the raid: every member rises in the room the raid last cleared', () => {
    const sim = new Sim({
      seed: 17,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
      devCommands: true,
    });
    const lead = sim.addPlayer('warrior', 'Heartwalker');
    const second = sim.addPlayer('warrior', 'Second');
    sim.partyInvite(second, lead);
    sim.partyAccept(second);
    expect(enterDungeon(sim.ctx, 'smith_heart', lead)).toBe(true);
    expect(enterDungeon(sim.ctx, 'smith_heart', second)).toBe(true);
    const claims = sim.ctx.instances.filter(
      (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
    );
    expect(claims.length).toBe(1);
    const inst = claims[0];
    sim.tick();
    win(sim, lead, inst, 'hammer');
    win(sim, lead, inst, 'heat');
    expectAt(runBack(sim, second, inst), 'heat');
    expectAt(runBack(sim, lead, inst), 'heat');
  });
});

describe('each point stands at its door, clear of the fight', () => {
  it('lies off every fighting floor and hazard of its room', () => {
    const h = P.hammer.pos;
    expect(Math.hypot(h.x - HAMMER_PIT.x, h.z - HAMMER_PIT.z)).toBeGreaterThan(COUNCIL_ARENA_R);
    const b = P.breath.pos;
    expect(inBreathArena(b.x, b.z)).toBe(false);
    for (const gap of CORNICE_GAPS)
      expect(Math.hypot(b.x - gap.x, b.z - gap.z)).toBeGreaterThan(gap.r + 20);
    expect(Math.hypot(b.x - BREATH.cornice.x, b.z - BREATH.cornice.z)).toBeGreaterThan(60);
    const q = P.quench.pos;
    expect(onLakeIce(q.x, q.z)).toBe(false);
    expect(insideRimewall(q.x, q.z)).toBe(false);
    const t = P.heat.pos;
    expect(inHearthFloor(t.x, t.z)).toBe(false);
    const f = P.final.pos;
    expect(onAnvil(f.x, f.z)).toBe(false);
    expect(Math.hypot(f.x - HEART_RETURN_PORTAL.x, f.z - HEART_RETURN_PORTAL.z)).toBeGreaterThan(
      HEART_RETURN_PORTAL.r + PLAYER_BODY_RADIUS,
    );
    expect(Math.hypot(f.x - RING_PORTAL.x, f.z - RING_PORTAL.z)).toBeGreaterThan(RING_PORTAL.r);
    const o = instanceOrigin(DUNGEON.index, 4);
    setOpenDungeonGates(
      o.x,
      o.z,
      SMITH_HEART_GATES.map((g) => g.id),
    );
    for (const room of Object.keys(P) as SmithHeartCheckpointRoom[]) {
      expect(
        isBlocked(99, o.x + P[room].pos.x, o.z + P[room].pos.z, PLAYER_BODY_RADIUS),
        room,
      ).toBe(false);
    }
    setOpenDungeonGates(o.x, o.z, []);
  });

  // Earned as a raid does (only the packs on the way and the guardians), so
  // every other pack of the mountain still stands; the risen spirit waits
  // there and nothing comes for it.
  it.each([
    [['hammer'], 'hammer'],
    [['hammer', 'breath'], 'breath'],
    [['hammer', 'quench'], 'quench'],
    [['hammer', 'heat'], 'heat'],
  ] as const)('after %j nothing pulls a spirit risen in %s', (veins, room) => {
    const { sim, pid, inst } = setup();
    for (const v of veins) win(sim, pid, inst, v);
    expectAt(runBack(sim, pid, inst), room);
    const player = sim.entities.get(pid) as Entity;
    for (let i = 0; i < 20 * 6; i++) {
      sim.tick();
      expect(player.inCombat, `tick ${i}`).toBe(false);
      expect(player.dead).toBe(false);
    }
  });

  it('nothing pulls a spirit risen on the terrace while the final boss waits', () => {
    const { sim, pid, inst } = setup();
    for (const v of SMITH_HEART_VEINS) win(sim, pid, inst, v);
    killPacks(sim, pid, inst, SMITH_HEART_PACKS.ring);
    sim.tick();
    expectAt(runBack(sim, pid, inst), 'final');
    const player = sim.entities.get(pid) as Entity;
    for (let i = 0; i < 20 * 6; i++) {
      sim.tick();
      expect(player.inCombat).toBe(false);
      // The terrace is not the return portal's trigger: the spirit stays put.
      expectAt(local(inst, player), 'final');
    }
  });

  // A flood fill over the real colliders from the entrance, exactly the
  // listed gates open (the Heart is reached by the portal, not on foot).
  describe('routes', () => {
    const o = instanceOrigin(DUNGEON.index, 4);
    const { minX, maxX, minZ, maxZ } = SMITH_HEART_FIELD.bounds;
    const width = maxX - minX + 1;
    const cell = (x: number, z: number) => (Math.round(z) - minZ) * width + (Math.round(x) - minX);
    const fills = new Map<string, Uint8Array>();
    const reaches = (open: readonly string[], x: number, z: number): boolean => {
      const key = [...open].sort().join(',');
      let seen = fills.get(key);
      if (!seen) {
        setOpenDungeonGates(o.x, o.z, open);
        seen = new Uint8Array(width * (maxZ - minZ + 1));
        const queue = [Math.round(DUNGEON.entry.x), Math.round(DUNGEON.entry.z)];
        seen[cell(queue[0], queue[1])] = 1;
        for (let q = 0; q < queue.length; q += 2) {
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = queue[q] + dx;
            const nz = queue[q + 1] + dz;
            if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
            const i = cell(nx, nz);
            if (seen[i] || isBlocked(7, o.x + nx, o.z + nz, 0.5)) continue;
            seen[i] = 1;
            queue.push(nx, nz);
          }
        }
        setOpenDungeonGates(o.x, o.z, []);
        fills.set(key, seen);
      }
      return seen[cell(x, z)] === 1;
    };

    it.each(SMITH_HEART_VEINS.map((v) => [v] as const))(
      'the %s point is behind exactly its listed gates',
      (vein) => {
        const row = P[vein];
        expect(reaches([], row.pos.x, row.pos.z)).toBe(false);
        expect(reaches(row.gates, row.pos.x, row.pos.z)).toBe(true);
        for (const gateId of row.gates) {
          const rest = row.gates.filter((id) => id !== gateId);
          expect(reaches(rest, row.pos.x, row.pos.z), `without ${gateId}`).toBe(false);
        }
      },
      120_000,
    );

    it('the Heart is reached by no walk at all, every gate open', () => {
      const all = SMITH_HEART_GATES.map((g) => g.id);
      expect(reaches(all, P.final.pos.x, P.final.pos.z)).toBe(false);
    }, 120_000);
  });
});

describe('the same through the server', () => {
  function serverRun(order: readonly SmithHeartVein[]) {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    let server: Any;
    try {
      server = new GameServer();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
    const sim = server.sim;
    const ws = { readyState: 1, send: () => {} };
    const session = server.join(ws, 1, 1, 'Heartwalker', 'warrior', null, false, {});
    if ('error' in session) throw new Error(session.error);
    const pid = session.pid as number;
    return { sim, pid, at: devRun(sim, pid, order) };
  }

  /** The in-game recipe (the report's playtest steps): enter, clear the
   *  trash, kill the guardians in order, die, release, walk back in. */
  function devRun(sim: Any, pid: number, order: readonly SmithHeartVein[]) {
    sim.chat('/dev heart enter', pid);
    sim.tick();
    sim.chat('/dev heart kill trash', pid);
    sim.tick();
    for (const v of order) {
      sim.chat(`/dev heart kill ${v}`, pid);
      sim.tick();
    }
    sim.chat('/dev die', pid);
    sim.tick();
    const player = sim.entities.get(pid);
    expect(player.dead).toBe(true);
    sim.releaseSpirit(pid);
    expect(player.ghost).toBe(true);
    sim.chat('/dev heart enter', pid);
    expect(player.dead).toBe(false);
    const inst = sim.ctx.instances.find(
      (i: InstanceSlot) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
    );
    return local(inst, player);
  }

  it.each([
    [['hammer', 'breath', 'quench'], 'quench'],
    [['hammer', 'quench', 'breath'], 'breath'],
    [['hammer', 'heat', 'quench', 'breath'], 'final'],
  ] as const)('after %j the server raises the spirit in %s, as offline does', (order, room) => {
    const online = serverRun(order);
    expectAt(online.at, room);
    const offline = new Sim({
      seed: 17,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
      devCommands: true,
    });
    const pid = offline.addPlayer('warrior', 'Heartwalker');
    expect(devRun(offline, pid, order)).toEqual(online.at);
  });
});
