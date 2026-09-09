// The per-tick player combat flag (src/sim/combat/engaged_combat.ts): the classic
// hate-table rule (anyone a live mob still carries on its hate table stays in
// combat, not only the mob's current target) plus the raid-boss "zone in combat"
// rule (an engaged boss holds every nearby member of its attackers' groups).
//
// Regression: a raid member who stopped acting for 5s dropped combat mid-boss,
// swapped to a healer spec, and mass-resurrected the raid through a "cannot be
// cast in combat" gate. The Sim cases drive the real tick path; the unit cases
// at the end isolate each guard of the derivation on hand-built entities.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOSS_ENCOUNTER_COMBAT_RANGE,
  collectEngagedPids,
  isHeldInCombat,
  PET_COMBAT_LINGER,
} from '../src/sim/combat/engaged_combat';
import { NORMAL_BOSS_DUMMY_ID } from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { createMobScanCounters } from '../src/sim/mob/scan_counters';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { LEASH_DISTANCE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { expectDefined } from './helpers/defined';

// Every fight here is staged against a hand-spawned mob on open ground, so the
// ambient camps, NPCs, and road colliders are stripped for speed and isolation.
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
  roads: [],
};

beforeAll(() => setActiveWorldContent(TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

// Open ground well away from the Eastbrook hub (the /assist suite's staging spot).
const ARENA_X = 305;
const ARENA_Z = 0;
const LINGER_TICKS = 20 * 5;
const COMBAT_CAST_ERROR = "You can't do that while in combat.";
const WORLD_BOSS_ID = 'thunzharr_waking_peak';

interface HealHarness {
  applyHeal(source: Entity, target: Entity, amount: number, ability: string): void;
}

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

let nextMobId = 90_001;
function spawnMob(sim: Sim, templateId: string, level: number, x: number, z: number): Entity {
  const mob = createMob(nextMobId++, expectDefined(MOBS[templateId]), level, sim.groundPos(x, z));
  // survive every scripted hit in a case (death wipes the hate table)
  mob.maxHp = 50_000;
  mob.hp = 50_000;
  sim.entities.set(mob.id, mob);
  return mob;
}

function hit(sim: Sim, source: Entity, target: Entity, amount: number): void {
  sim.dealDamage(source, target, amount, false, 'physical', null, 'hit', true);
}

function heal(sim: Sim, source: Entity, target: Entity, amount: number): void {
  (sim as unknown as HealHarness).applyHeal(source, target, amount, 'heal');
}

function formParty(sim: Sim, leader: number, members: number[]): void {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

// Add a player who can take a few boss swings without dying inside a case.
function addSturdyPlayer(
  sim: Sim,
  cls: 'warrior' | 'priest' | 'mage' | 'warlock' | 'rogue',
  name: string,
): number {
  const pid = sim.addPlayer(cls, name);
  sim.setPlayerLevel(30, pid);
  return pid;
}

// Summon a warlock's imp and park it on passive so it never trades a blow on
// its own: the only way it reaches a hate table is a scripted hit.
function summonPassiveImp(sim: Sim, warlock: number): Entity {
  const owner = entity(sim, warlock);
  owner.resource = owner.maxResource;
  sim.castAbility('summon_imp', warlock);
  for (let i = 0; i < 20 * 6; i++) sim.tick();
  const imp = expectDefined(sim.petOf(warlock));
  sim.setPetMode('passive', warlock);
  return imp;
}

// Ticks `count` times and reports whether the player was flagged in combat on
// EVERY tick (a single dropped tick is the exploit window).
function inCombatForTicks(sim: Sim, pid: number, count: number): boolean {
  const p = entity(sim, pid);
  for (let i = 0; i < count; i++) {
    sim.tick();
    if (!p.inCombat) return false;
  }
  return true;
}

function errors(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid)
    .map((e) => e.text);
}

// Tank + a second attacker on one wild wolf. The tank out-threats the second
// attacker by a wide margin, so the wolf's aggro target is always the tank.
function wolfFight(): { sim: Sim; wolf: Entity; tank: number; dps: number } {
  const sim = makeWorld();
  const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
  const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
  const dps = addSturdyPlayer(sim, 'warrior', 'Dps');
  place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
  place(sim, entity(sim, dps), ARENA_X + 4, ARENA_Z);
  hit(sim, entity(sim, tank), wolf, 500);
  hit(sim, entity(sim, dps), wolf, 10);
  sim.tick();
  expect(wolf.aggroTargetId).toBe(tank);
  expect(wolf.threat.has(dps)).toBe(true);
  expect(isHeldInCombat(sim.ctx, dps)).toBe(true);
  return { sim, wolf, tank, dps };
}

describe('hate-table combat: every attacker on a live mob stays in combat', () => {
  it('keeps a non-target attacker in combat after their own 5s linger has run out', () => {
    const { sim, wolf, dps } = wolfFight();
    entity(sim, dps).combatTimer = 99;
    expect(inCombatForTicks(sim, dps, 20 * 10)).toBe(true);
    expect(wolf.dead).toBe(false);
    expect(wolf.aggroTargetId).not.toBe(dps);
  });

  it('keeps a healer in combat through the healing-threat entry alone', () => {
    const sim = makeWorld();
    const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const healer = addSturdyPlayer(sim, 'priest', 'Healer');
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, healer), ARENA_X + 12, ARENA_Z);
    hit(sim, entity(sim, tank), wolf, 200);
    sim.tick();
    entity(sim, tank).hp = Math.max(1, entity(sim, tank).hp - 50);
    heal(sim, entity(sim, healer), entity(sim, tank), 40);
    expect(wolf.threat.has(healer)).toBe(true);
    expect(wolf.aggroTargetId).toBe(tank);

    entity(sim, healer).combatTimer = 99;
    expect(inCombatForTicks(sim, healer, 20 * 10)).toBe(true);
    // The healer never became the target: the table entry alone carried it.
    expect(wolf.aggroTargetId).toBe(tank);
    expect(wolf.threat.has(healer)).toBe(true);
  });

  it("keeps a pet's owner in combat through the pet's table entry while the mob fights someone else", () => {
    const sim = makeWorld();
    const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const warlock = addSturdyPlayer(sim, 'warlock', 'Lock');
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, warlock), ARENA_X + 15, ARENA_Z);
    const imp = summonPassiveImp(sim, warlock);
    hit(sim, entity(sim, tank), wolf, 500);
    hit(sim, imp, wolf, 10);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(tank);
    expect(wolf.threat.has(imp.id)).toBe(true);

    // Park both clocks past every linger: only the table entry can hold the owner.
    entity(sim, warlock).combatTimer = 99;
    imp.combatTimer = 99;
    expect(inCombatForTicks(sim, warlock, 20 * 10)).toBe(true);
    expect(imp.combatTimer).toBeGreaterThanOrEqual(PET_COMBAT_LINGER);
    expect(wolf.aggroTargetId).toBe(tank);
    expect(wolf.threat.has(imp.id)).toBe(true);
  });

  it('releases the attacker once the mob dies', () => {
    const { sim, wolf, tank, dps } = wolfFight();
    entity(sim, dps).combatTimer = 99;
    sim.tick();
    expect(entity(sim, dps).inCombat).toBe(true);

    hit(sim, entity(sim, tank), wolf, 1_000_000);
    expect(wolf.dead).toBe(true);
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(entity(sim, dps).inCombat).toBe(false);
    expect(isHeldInCombat(sim.ctx, dps)).toBe(false);
  });

  it('releases the attacker once the mob leashes home and wipes its hate table', () => {
    const { sim, wolf, tank, dps } = wolfFight();
    const far = ARENA_X + LEASH_DISTANCE * 4;
    place(sim, entity(sim, tank), far, ARENA_Z);
    place(sim, entity(sim, dps), far, ARENA_Z);
    entity(sim, dps).combatTimer = 99;
    for (let i = 0; i < 20 * 60 && wolf.aiState !== 'evade'; i++) sim.tick();
    expect(wolf.aiState).toBe('evade');
    expect(wolf.threat.size).toBe(0);

    entity(sim, dps).combatTimer = 99;
    sim.tick();
    expect(entity(sim, dps).inCombat).toBe(false);
  });

  it('releases a dead attacker once their linger runs out (death drops them off every table)', () => {
    const { sim, wolf, tank, dps } = wolfFight();
    hit(sim, wolf, entity(sim, dps), 1_000_000);
    expect(entity(sim, dps).dead).toBe(true);
    expect(wolf.threat.has(dps)).toBe(false);
    // The lethal hit reset their own 5s linger; nothing holds them past it.
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(entity(sim, dps).inCombat).toBe(false);
    expect(wolf.dead).toBe(false);
    expect(wolf.aggroTargetId).toBe(tank);
  });

  it('Vanish still leaves combat while someone else keeps the mob engaged', () => {
    const sim = makeWorld();
    const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const rogue = addSturdyPlayer(sim, 'rogue', 'Rogue');
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, rogue), ARENA_X + 6, ARENA_Z);
    hit(sim, entity(sim, tank), wolf, 500);
    hit(sim, entity(sim, rogue), wolf, 10);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(tank);
    expect(entity(sim, rogue).inCombat).toBe(true);

    sim.castAbility('vanish', rogue);
    expect(wolf.threat.has(rogue)).toBe(false);
    for (let i = 0; i < 20 * 3; i++) {
      sim.tick();
      expect(entity(sim, rogue).inCombat).toBe(false);
    }
    expect(wolf.aggroTargetId).toBe(tank);
  });

  it('a training dummy holds the hitter only for their own 5s linger', () => {
    // Freeze the dummy inside its in-combat window (table intact, inCombat true)
    // while the hitter's own linger has long expired: the dummy guard alone
    // decides, and it must release.
    const sim = makeWorld();
    const dummy = spawnMob(sim, 'training_effigy', 1, ARENA_X, ARENA_Z);
    const hitter = addSturdyPlayer(sim, 'warrior', 'Hitter');
    place(sim, entity(sim, hitter), ARENA_X + 2, ARENA_Z);
    hit(sim, entity(sim, hitter), dummy, 50);
    sim.tick();
    expect(entity(sim, hitter).inCombat).toBe(true);
    entity(sim, hitter).combatTimer = 99;
    for (let i = 0; i < 20 * 3; i++) {
      dummy.combatTimer = 0;
      sim.tick();
      expect(entity(sim, hitter).inCombat).toBe(false);
    }
    expect(dummy.inCombat).toBe(true);
    expect(dummy.threat.has(hitter)).toBe(true);
  });

  it('a boss-profile practice dummy never holds a passive party member', () => {
    const sim = makeWorld();
    const dummy = spawnMob(sim, NORMAL_BOSS_DUMMY_ID, 20, ARENA_X, ARENA_Z);
    expect(MOBS[NORMAL_BOSS_DUMMY_ID]?.boss).toBe(true);
    const hitter = addSturdyPlayer(sim, 'warrior', 'Hitter');
    const passive = addSturdyPlayer(sim, 'priest', 'Passive');
    formParty(sim, hitter, [passive]);
    place(sim, entity(sim, hitter), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, passive), ARENA_X + 10, ARENA_Z);
    hit(sim, entity(sim, hitter), dummy, 50);
    sim.tick();
    expect(entity(sim, passive).inCombat).toBe(false);
  });

  it('pins the tuning literals the pass reads', () => {
    // PET_COMBAT_LINGER moved here from sim.ts (its behavior is pinned by
    // tests/pet_combat_regen.test.ts); the encounter range is pinned so the
    // distance cases below cannot drift with it.
    expect(PET_COMBAT_LINGER).toBe(5);
    expect(BOSS_ENCOUNTER_COMBAT_RANGE).toBe(100);
  });
});

// A boss (gorrak, `boss: true`) engaged by the tank; a party member parks
// `memberDistance` yards off along z (the tank stands along x, so a boss step
// toward the tank barely moves that distance) and never acts. Under the old
// rule they were never in combat at all.
function bossFight(memberDistance = 30): {
  sim: Sim;
  boss: Entity;
  tank: number;
  passive: number;
} {
  const sim = makeWorld();
  const boss = spawnMob(sim, 'gorrak', 6, ARENA_X, ARENA_Z);
  const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
  const passive = addSturdyPlayer(sim, 'priest', 'Passive');
  formParty(sim, tank, [passive]);
  place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
  place(sim, entity(sim, passive), ARENA_X, ARENA_Z + memberDistance);
  hit(sim, entity(sim, tank), boss, 500);
  sim.tick();
  expect(boss.aggroTargetId).toBe(tank);
  expect(boss.threat.has(passive)).toBe(false);
  return { sim, boss, tank, passive };
}

describe('boss encounters hold the whole nearby group in combat', () => {
  it('flags a party member who never touched the boss for the whole engagement', () => {
    const { sim, boss, passive } = bossFight();
    expect(entity(sim, passive).inCombat).toBe(true);
    expect(inCombatForTicks(sim, passive, 20 * 10)).toBe(true);
    expect(boss.threat.has(passive)).toBe(false);
  });

  it("flags the owner's party through a pet's table entry on the boss", () => {
    const sim = makeWorld();
    const boss = spawnMob(sim, 'gorrak', 6, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const warlock = addSturdyPlayer(sim, 'warlock', 'Lock');
    const passive = addSturdyPlayer(sim, 'priest', 'Passive');
    formParty(sim, warlock, [passive]);
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, warlock), ARENA_X + 15, ARENA_Z);
    place(sim, entity(sim, passive), ARENA_X, ARENA_Z + 30);
    const imp = summonPassiveImp(sim, warlock);
    hit(sim, entity(sim, tank), boss, 500);
    hit(sim, imp, boss, 10);
    sim.tick();
    expect(boss.aggroTargetId).toBe(tank);
    expect(boss.threat.has(imp.id)).toBe(true);
    expect(boss.threat.has(passive)).toBe(false);
    expect(entity(sim, passive).inCombat).toBe(true);
  });

  it('releases the passive member once the boss dies', () => {
    const { sim, boss, tank, passive } = bossFight();
    expect(entity(sim, passive).inCombat).toBe(true);
    hit(sim, entity(sim, tank), boss, 1_000_000);
    expect(boss.dead).toBe(true);
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(entity(sim, passive).inCombat).toBe(false);
  });

  it('releases the passive member when the last attacker dies and the boss resets', () => {
    const { sim, boss, tank, passive } = bossFight();
    expect(entity(sim, passive).inCombat).toBe(true);
    hit(sim, boss, entity(sim, tank), 1_000_000);
    expect(entity(sim, tank).dead).toBe(true);
    expect(boss.threat.has(tank)).toBe(false);
    for (let i = 0; i < 20 * 30 && boss.inCombat; i++) sim.tick();
    expect(boss.inCombat).toBe(false);
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(entity(sim, passive).inCombat).toBe(false);
    expect(entity(sim, tank).inCombat).toBe(false);
  });

  it('holds a member just inside the encounter range and not one just outside it', () => {
    const inside = bossFight(99);
    expect(entity(inside.sim, inside.passive).inCombat).toBe(true);
    const outside = bossFight(101);
    expect(entity(outside.sim, outside.passive).inCombat).toBe(false);
    outside.sim.tick();
    expect(entity(outside.sim, outside.passive).inCombat).toBe(false);
  });

  it('does not reach a party member far beyond the encounter range', () => {
    const { sim, passive } = bossFight(120);
    expect(entity(sim, passive).inCombat).toBe(false);
    sim.tick();
    expect(entity(sim, passive).inCombat).toBe(false);
  });

  it('does not reach a bystander outside the party', () => {
    const { sim, boss } = bossFight();
    const bystander = addSturdyPlayer(sim, 'priest', 'Bystander');
    place(sim, entity(sim, bystander), boss.pos.x, boss.pos.z + 30);
    sim.tick();
    expect(entity(sim, bystander).inCombat).toBe(false);
  });

  it('a wild non-boss mob does not pull a passive party member (classic trash rule)', () => {
    const sim = makeWorld();
    const wolf = spawnMob(sim, 'forest_wolf', 5, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const passive = addSturdyPlayer(sim, 'priest', 'Passive');
    formParty(sim, tank, [passive]);
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, passive), ARENA_X, ARENA_Z + 30);
    hit(sim, entity(sim, tank), wolf, 200);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(tank);
    expect(entity(sim, passive).inCombat).toBe(false);
  });

  it('draws no rng, boss branch included', () => {
    const { sim } = bossFight();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    collectEngagedPids(sim.ctx, new Set<number>());
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });

  it('blocks a mass resurrection by a parked member mid-encounter, and allows it after the kill', () => {
    // The reported exploit, end to end: an arcane mage parks 20 yards from the
    // boss, never acts, and tries to raise a dead party member while the tank
    // is still fighting.
    const sim = new Sim({ seed: 42, playerClass: 'mage', autoEquip: true, world: TEST_WORLD });
    sim.setPlayerLevel(10);
    expect(sim.setSpec('arcane')).toBe(true);
    const mage = sim.playerId;
    const boss = spawnMob(sim, 'gorrak', 6, ARENA_X, ARENA_Z);
    const tank = addSturdyPlayer(sim, 'warrior', 'Tank');
    const victim = addSturdyPlayer(sim, 'priest', 'Victim');
    formParty(sim, mage, [tank, victim]);
    place(sim, sim.player, ARENA_X + 20, ARENA_Z);
    place(sim, entity(sim, tank), ARENA_X + 2, ARENA_Z);
    place(sim, entity(sim, victim), ARENA_X + 6, ARENA_Z);
    hit(sim, entity(sim, tank), boss, 500);
    hit(sim, boss, entity(sim, victim), 1_000_000);
    expect(entity(sim, victim).dead).toBe(true);
    sim.tick();
    expect(boss.aggroTargetId).toBe(tank);

    // Parked for ten seconds: still in combat, so the cast is refused.
    expect(inCombatForTicks(sim, mage, 20 * 10)).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('collective_reversal');
    expect(errors(sim.tick(), mage)).toContain(COMBAT_CAST_ERROR);
    expect(sim.player.castingAbility).not.toBe('collective_reversal');

    // Encounter cleared: the group leaves combat and the raise goes through.
    hit(sim, entity(sim, tank), boss, 1_000_000);
    expect(boss.dead).toBe(true);
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(sim.player.inCombat).toBe(false);
    sim.player.resource = sim.player.maxResource;
    sim.player.cooldowns.delete('collective_reversal');
    sim.castAbility('collective_reversal');
    expect(errors(sim.tick(), mage)).not.toContain(COMBAT_CAST_ERROR);
    expect(sim.player.castingAbility).toBe('collective_reversal');
  });
});

// Hand-built entities on a minimal SimContext: one case per guard of the
// derivation, so a regression on any single dimension is visible.
const DPS_ID = 501;
const TANK_ID = 502;
const LOCK_ID = 503;
const PET_ID = 504;
const BOSS_ID = 600;
const ADD_ID = 601;
const NPC_ID = 700;

function fakePlayer(id: number, x = 0, dead = false): Entity {
  return { id, kind: 'player', dead, ownerId: null, pos: { x, y: 0, z: 0 } } as unknown as Entity;
}

function fakeMob(overrides: Partial<Entity> = {}): Entity {
  return {
    id: BOSS_ID,
    kind: 'mob',
    dead: false,
    ownerId: null,
    hostile: true,
    inCombat: true,
    aiState: 'attack',
    templateId: 'forest_wolf',
    threat: new Map<number, number>([[DPS_ID, 10]]),
    aggroTargetId: null,
    combatTimer: 0,
    pos: { x: 0, y: 0, z: 0 },
    ...overrides,
  } as unknown as Entity;
}

function fakeCtx(entities: Entity[], partyOf: SimContext['partyOf'] = () => null): SimContext {
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    players: new Map(),
    partyOf,
    mobScanCounters: createMobScanCounters(),
    // Hand-built cases fight in the open world (x well under the instance band),
    // so the slot lookup early-outs before it would read ctx.instances.
    instances: [],
  } as unknown as SimContext;
}

function held(ctx: SimContext): Set<number> {
  const out = new Set<number>();
  collectEngagedPids(ctx, out);
  return out;
}

describe('collectEngagedPids guards (unit)', () => {
  it('holds every table entry of an engaged wild mob', () => {
    const ctx = fakeCtx([fakePlayer(DPS_ID), fakeMob()]);
    expect(held(ctx).has(DPS_ID)).toBe(true);
    expect(ctx.mobScanCounters.threatEntryVisits).toBeGreaterThan(0);
  });

  it('holds through a scripted intermission (idle but still inCombat)', () => {
    const ctx = fakeCtx([fakePlayer(DPS_ID), fakeMob({ aiState: 'idle', inCombat: true })]);
    expect(held(ctx).has(DPS_ID)).toBe(true);
  });

  it('holds while actively chasing even if the inCombat flag is down (the old target rule)', () => {
    const ctx = fakeCtx([fakePlayer(DPS_ID), fakeMob({ aiState: 'chase', inCombat: false })]);
    expect(held(ctx).has(DPS_ID)).toBe(true);
  });

  it('releases on each single-dimension guard', () => {
    const cases: Array<[string, Partial<Entity>]> = [
      ['idle and out of combat', { aiState: 'idle', inCombat: false }],
      ['evading with the table intact', { aiState: 'evade' }],
      ['dead', { dead: true, aiState: 'dead' }],
      ['not hostile', { hostile: false }],
      ['a practice dummy', { templateId: 'training_effigy' }],
    ];
    for (const [label, overrides] of cases) {
      const ctx = fakeCtx([fakePlayer(DPS_ID), fakeMob(overrides)]);
      expect(held(ctx).has(DPS_ID), label).toBe(false);
    }
  });

  it('keeps the current aggro target held even when the table was pruned', () => {
    const ctx = fakeCtx([
      fakePlayer(TANK_ID),
      fakeMob({ threat: new Map(), aggroTargetId: TANK_ID }),
    ]);
    expect(held(ctx).has(TANK_ID)).toBe(true);
  });

  it('resolves a pet entry to its player owner, and a mob-owned add or NPC entry to nobody', () => {
    const pet = { ...fakeMob({ id: PET_ID, ownerId: LOCK_ID, aggroTargetId: null }) };
    const add = { ...fakeMob({ id: ADD_ID, ownerId: BOSS_ID, aggroTargetId: null }) };
    const npc = {
      id: NPC_ID,
      kind: 'npc',
      dead: false,
      ownerId: null,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as Entity;
    const boss = fakeMob({
      threat: new Map<number, number>([
        [PET_ID, 5],
        [ADD_ID, 5],
        [NPC_ID, 5],
      ]),
    });
    const ctx = fakeCtx([fakePlayer(LOCK_ID), pet, add, npc, boss]);
    const out = held(ctx);
    expect(out.has(LOCK_ID)).toBe(true);
    // The add's owner is the boss itself: never resolved as a player.
    expect(out.has(BOSS_ID)).toBe(false);
  });

  it("does not re-flag a dead owner through a pet still on a mob's table", () => {
    const deadOwner = { ...fakePlayer(LOCK_ID), dead: true } as Entity;
    const pet = fakeMob({ id: PET_ID, ownerId: LOCK_ID, aggroTargetId: null });
    const boss = fakeMob({ threat: new Map<number, number>([[PET_ID, 5]]) });
    const out = held(fakeCtx([deadOwner, pet, boss]));
    expect(out.has(LOCK_ID)).toBe(false);
    expect(out.has(PET_ID)).toBe(true);
  });

  it('applies the pet linger to an owned mob instead of the hate-table rule', () => {
    const fighting = fakeMob({
      id: PET_ID,
      ownerId: LOCK_ID,
      aggroTargetId: BOSS_ID,
      combatTimer: 1,
    });
    expect(held(fakeCtx([fakePlayer(LOCK_ID), fighting])).has(LOCK_ID)).toBe(true);
    const stale = fakeMob({
      id: PET_ID,
      ownerId: LOCK_ID,
      aggroTargetId: BOSS_ID,
      combatTimer: PET_COMBAT_LINGER,
    });
    expect(held(fakeCtx([fakePlayer(LOCK_ID), stale])).has(LOCK_ID)).toBe(false);
  });

  it("holds a world boss attacker's living, in-range group members and nobody else", () => {
    expect(MOBS[WORLD_BOSS_ID]?.worldBoss).toBe(true);
    expect(MOBS[WORLD_BOSS_ID]?.boss).toBe(true);
    const near = 510;
    const far = 511;
    const deadNear = 512;
    const stranger = 513;
    const party = {
      id: 1,
      leader: DPS_ID,
      members: [DPS_ID, near, far, deadNear],
    } as unknown as ReturnType<SimContext['partyOf']>;
    const partyOf: SimContext['partyOf'] = (pid) =>
      [DPS_ID, near, far, deadNear].includes(pid) ? party : null;
    const ctx = fakeCtx(
      [
        fakePlayer(DPS_ID, 5),
        fakePlayer(near, BOSS_ENCOUNTER_COMBAT_RANGE - 1),
        fakePlayer(far, BOSS_ENCOUNTER_COMBAT_RANGE + 1),
        fakePlayer(deadNear, 10, true),
        fakePlayer(stranger, 10),
        fakeMob({ templateId: WORLD_BOSS_ID }),
      ],
      partyOf,
    );
    const out = held(ctx);
    expect(out.has(near)).toBe(true);
    expect(out.has(far)).toBe(false);
    expect(out.has(deadNear)).toBe(false);
    expect(out.has(stranger)).toBe(false);
  });

  it('holds every in-range member of a full raid, deduped through one party lookup', () => {
    const members = Array.from({ length: 10 }, (_, i) => 520 + i);
    const raid = { id: 2, leader: members[0], members, raid: true } as unknown as ReturnType<
      SimContext['partyOf']
    >;
    let partyLookups = 0;
    const partyOf: SimContext['partyOf'] = (pid) => {
      partyLookups++;
      return members.includes(pid) ? raid : null;
    };
    // Three raiders on the boss's table, the rest parked inside the range.
    const boss = fakeMob({
      templateId: 'gorrak',
      threat: new Map<number, number>(members.slice(0, 3).map((id) => [id, 10])),
    });
    const ctx = fakeCtx([...members.map((id, i) => fakePlayer(id, i * 9)), boss], partyOf);
    const out = held(ctx);
    for (const id of members) expect(out.has(id), String(id)).toBe(true);
    // One partyOf per table entry (3), and the roster walk ran once.
    expect(partyLookups).toBe(3);
  });

  it('isHeldInCombat reads the cached pass output, never re-walking the world', () => {
    let lookups = 0;
    const ctx = {
      engagedPids: new Set<number>([DPS_ID]),
      get entities() {
        lookups++;
        return new Map<number, Entity>();
      },
    } as unknown as SimContext;
    expect(isHeldInCombat(ctx, DPS_ID)).toBe(true);
    expect(isHeldInCombat(ctx, TANK_ID)).toBe(false);
    expect(lookups).toBe(0);
  });

  it('a trash mob never consults the party at all', () => {
    let partyLookups = 0;
    const partyOf: SimContext['partyOf'] = () => {
      partyLookups++;
      return null;
    };
    held(fakeCtx([fakePlayer(DPS_ID), fakeMob()], partyOf));
    expect(partyLookups).toBe(0);
  });
});
