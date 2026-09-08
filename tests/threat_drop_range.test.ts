// The hate-table reach (THREAT_DROP_RANGE, src/sim/threat.ts): an attacker
// farther than the reach from an engaged mob is dropped off its hate table by
// the engaged pass (src/sim/combat/engaged_combat.ts) instead of being held in
// combat. The classic map-change threat drop, generalised to distance: stepping
// through an instance door, or otherwise leaving a fight a raid keeps engaged,
// releases on the next tick instead of leaving the player stuck in combat.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOSS_ENCOUNTER_COMBAT_RANGE, collectEngagedPids } from '../src/sim/combat/engaged_combat';
import { BUILTIN_WORLD, DUNGEONS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { createMobScanCounters } from '../src/sim/mob/scan_counters';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { beyondThreatRange, THREAT_DROP_RANGE } from '../src/sim/threat';
import type { Entity, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { expectDefined } from './helpers/defined';

const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
  roads: [],
};

beforeAll(() => setActiveWorldContent(TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

const ARENA_X = 305;
const ARENA_Z = 0;
const LINGER_TICKS = 20 * 5;

function makeWorld(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD });
}

function entity(sim: Sim, id: number): Entity {
  return expectDefined(sim.entities.get(id));
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

let nextMobId = 91_001;
function spawnMob(sim: Sim, templateId: string, level: number, x: number, z: number): Entity {
  const mob = createMob(nextMobId++, expectDefined(MOBS[templateId]), level, sim.groundPos(x, z));
  mob.maxHp = 50_000;
  mob.hp = 50_000;
  sim.entities.set(mob.id, mob);
  return mob;
}

function hit(sim: Sim, source: Entity, target: Entity, amount: number): void {
  sim.dealDamage(source, target, amount, false, 'physical', null, 'hit', true);
}

function addSturdyPlayer(sim: Sim, cls: 'warrior' | 'priest', name: string): number {
  const pid = sim.addPlayer(cls, name);
  sim.setPlayerLevel(30, pid);
  return pid;
}

function formParty(sim: Sim, leader: number, members: number[]): void {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

// Tank + a second attacker on one wolf at the arena; the tank holds aggro.
function wolfFight(
  x = ARENA_X,
  z = ARENA_Z,
): { sim: Sim; wolf: Entity; tank: number; dps: number } {
  const sim = makeWorld();
  const wolf = spawnMob(sim, 'forest_wolf', 5, x, z);
  const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
  const dps = addSturdyPlayer(sim, 'warrior', 'Dps');
  place(sim, entity(sim, tank), x + 2, z);
  place(sim, entity(sim, dps), x + 4, z);
  hit(sim, entity(sim, tank), wolf, 500);
  hit(sim, entity(sim, dps), wolf, 10);
  sim.tick();
  expect(wolf.aggroTargetId).toBe(tank);
  expect(wolf.threat.has(dps)).toBe(true);
  return { sim, wolf, tank, dps };
}

describe('hate-table reach: out-of-range attackers drop off the table', () => {
  it('pins the reach literal and the boss hold sharing it', () => {
    expect(THREAT_DROP_RANGE).toBe(100);
    expect(BOSS_ENCOUNTER_COMBAT_RANGE).toBe(THREAT_DROP_RANGE);
  });

  it('drops an attacker who walked beyond the reach and releases them after their linger', () => {
    const { sim, wolf, tank, dps } = wolfFight();
    place(sim, entity(sim, dps), ARENA_X, ARENA_Z + 150);
    sim.tick();
    expect(wolf.threat.has(dps)).toBe(false);
    expect(wolf.threat.has(tank)).toBe(true);
    expect(wolf.aggroTargetId).toBe(tank);
    expect(wolf.inCombat).toBe(true);

    entity(sim, dps).combatTimer = 99;
    sim.tick();
    expect(entity(sim, dps).inCombat).toBe(false);
    // Nothing re-adds them while they stay away.
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(wolf.threat.has(dps)).toBe(false);
    expect(entity(sim, dps).inCombat).toBe(false);
  });

  it('keeps an attacker just inside the reach and drops one just outside it', () => {
    // Along z, so a wolf step toward the tank (along x) barely moves the distance.
    const inside = wolfFight();
    place(inside.sim, entity(inside.sim, inside.dps), ARENA_X, ARENA_Z + 99);
    inside.sim.tick();
    expect(inside.wolf.threat.has(inside.dps)).toBe(true);
    entity(inside.sim, inside.dps).combatTimer = 99;
    inside.sim.tick();
    expect(entity(inside.sim, inside.dps).inCombat).toBe(true);

    const outside = wolfFight();
    place(outside.sim, entity(outside.sim, outside.dps), ARENA_X, ARENA_Z + 101);
    outside.sim.tick();
    expect(outside.wolf.threat.has(outside.dps)).toBe(false);
  });

  it('a dropped current target hands the mob to the next attacker', () => {
    const { sim, wolf, tank, dps } = wolfFight();
    place(sim, entity(sim, tank), ARENA_X, ARENA_Z + 150);
    for (let i = 0; i < 20 * 2 && wolf.aggroTargetId !== dps; i++) sim.tick();
    expect(wolf.threat.has(tank)).toBe(false);
    expect(wolf.aggroTargetId).toBe(dps);
    expect(wolf.forcedTargetId).toBeNull();
  });

  it('a lone attacker dropping empties the table and the mob goes home', () => {
    const sim = makeWorld();
    const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
    const solo = addSturdyPlayer(sim, 'warrior', 'Solo');
    place(sim, entity(sim, solo), ARENA_X + 2, ARENA_Z);
    hit(sim, entity(sim, solo), wolf, 100);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(solo);

    place(sim, entity(sim, solo), ARENA_X, ARENA_Z + 150);
    for (let i = 0; i < 20 * 5 && wolf.aiState !== 'evade' && wolf.inCombat; i++) sim.tick();
    expect(wolf.threat.size).toBe(0);
    expect(wolf.aggroTargetId).not.toBe(solo);
    entity(sim, solo).combatTimer = 99;
    sim.tick();
    expect(entity(sim, solo).inCombat).toBe(false);
  });

  it('releases a taunt lock held by the dropped attacker', () => {
    const { sim, wolf, dps } = wolfFight();
    wolf.forcedTargetId = dps;
    wolf.forcedTargetTimer = 3;
    place(sim, entity(sim, dps), ARENA_X, ARENA_Z + 150);
    sim.tick();
    expect(wolf.threat.has(dps)).toBe(false);
    expect(wolf.forcedTargetId).toBeNull();
    expect(wolf.forcedTargetTimer).toBe(0);
  });

  it('a raider who steps through an instance door mid-fight is released next tick', () => {
    // The reported hazard: a mob the group keeps engaged never leashes, so
    // without the reach rule the member who zoned would stay in combat inside.
    const dungeon = expectDefined(DUNGEONS.hollow_crypt);
    const door = dungeon.doorPos;
    const { sim, wolf, tank, dps } = wolfFight(door.x + 12, door.z);
    formParty(sim, tank, [dps]);
    place(sim, entity(sim, dps), door.x, door.z);
    expect(sim.enterDungeon(dungeon.id, dps)).toBe(true);
    expect(beyondThreatRange(wolf, entity(sim, dps))).toBe(true);
    sim.tick();
    expect(wolf.threat.has(dps)).toBe(false);
    expect(wolf.threat.has(tank)).toBe(true);
    entity(sim, dps).combatTimer = 99;
    sim.tick();
    expect(entity(sim, dps).inCombat).toBe(false);
  });
});

// Unit cases on hand-built entities: the drop is a table mutation of the walk,
// so pin its side effects one at a time.
const DPS_ID = 501;
const TANK_ID = 502;
const MOB_ID = 600;

function fakePlayer(id: number, x = 0): Entity {
  return {
    id,
    kind: 'player',
    dead: false,
    ownerId: null,
    pos: { x, y: 0, z: 0 },
  } as unknown as Entity;
}

function fakeMob(overrides: Partial<Entity> = {}): Entity {
  return {
    id: MOB_ID,
    kind: 'mob',
    dead: false,
    ownerId: null,
    hostile: true,
    inCombat: true,
    aiState: 'attack',
    templateId: 'forest_wolf',
    threat: new Map<number, number>([
      [DPS_ID, 10],
      [TANK_ID, 500],
    ]),
    aggroTargetId: TANK_ID,
    forcedTargetId: null,
    forcedTargetTimer: 0,
    combatTimer: 0,
    pos: { x: 0, y: 0, z: 0 },
    ...overrides,
  } as unknown as Entity;
}

function fakeCtx(entities: Entity[]): SimContext {
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    players: new Map(),
    partyOf: () => null,
    mobScanCounters: createMobScanCounters(),
    // Hand-built cases fight in the open world (x well under the instance band),
    // so the slot lookup early-outs before it would read ctx.instances.
    instances: [],
  } as unknown as SimContext;
}

describe('collectEngagedPids reach drop (unit)', () => {
  it('drops the far entry, keeps the near one, and holds only the near one', () => {
    const mob = fakeMob();
    const ctx = fakeCtx([fakePlayer(DPS_ID, THREAT_DROP_RANGE + 1), fakePlayer(TANK_ID, 3), mob]);
    const out = new Set<number>();
    collectEngagedPids(ctx, out);
    expect(mob.threat.has(DPS_ID)).toBe(false);
    expect(mob.threat.get(TANK_ID)).toBe(500);
    expect(out.has(DPS_ID)).toBe(false);
    expect(out.has(TANK_ID)).toBe(true);
  });

  it('clears the current-target pointer and a taunt lock that named the dropped entry', () => {
    const mob = fakeMob({ aggroTargetId: DPS_ID, forcedTargetId: DPS_ID, forcedTargetTimer: 2 });
    const ctx = fakeCtx([fakePlayer(DPS_ID, THREAT_DROP_RANGE + 1), fakePlayer(TANK_ID, 3), mob]);
    const out = new Set<number>();
    collectEngagedPids(ctx, out);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.forcedTargetId).toBeNull();
    expect(mob.forcedTargetTimer).toBe(0);
    expect(out.has(DPS_ID)).toBe(false);
  });

  it('measures the reach flat and keeps an entry exactly at it', () => {
    const mob = fakeMob();
    const ctx = fakeCtx([fakePlayer(DPS_ID, THREAT_DROP_RANGE), fakePlayer(TANK_ID, 3), mob]);
    collectEngagedPids(ctx, new Set<number>());
    expect(mob.threat.has(DPS_ID)).toBe(true);
  });

  it('spares a chain-pulled mob still crossing to its puller', () => {
    const mob = fakeMob({ aiState: 'chase', aggroTargetId: DPS_ID, chainPullInbound: true });
    const ctx = fakeCtx([fakePlayer(DPS_ID, THREAT_DROP_RANGE + 60), fakePlayer(TANK_ID, 3), mob]);
    const out = new Set<number>();
    collectEngagedPids(ctx, out);
    expect(mob.threat.has(DPS_ID)).toBe(true);
    expect(mob.aggroTargetId).toBe(DPS_ID);
    expect(out.has(DPS_ID)).toBe(true);
  });

  it('never touches the table of a mob that is not engaged', () => {
    const cases: Array<[string, Partial<Entity>]> = [
      ['evading', { aiState: 'evade' }],
      ['idle and out of combat', { aiState: 'idle', inCombat: false }],
      ['not hostile', { hostile: false }],
    ];
    for (const [label, overrides] of cases) {
      const mob = fakeMob(overrides);
      const ctx = fakeCtx([fakePlayer(DPS_ID, THREAT_DROP_RANGE + 1), fakePlayer(TANK_ID, 3), mob]);
      collectEngagedPids(ctx, new Set<number>());
      expect(mob.threat.has(DPS_ID), label).toBe(true);
    }
  });
});
