import { describe, expect, it } from 'vitest';
import { applyRuinousBrand } from '../src/sim/combat/destruction';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Duels are player-vs-player; the only ambient dependency is givePet, which
// adopts a wild mob. Keep the real forest_wolf camps as that mob supply and
// strip the rest of the ambient world (subsystem-world pattern, see
// tests/dot_final_tick.test.ts).
const DUEL_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((c) => c.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: DUEL_TEST_WORLD });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Start an accepted duel between two adjacent players and run the countdown
// out so the bout is live.
function startedDuel(
  aClass: 'warrior' | 'mage' | 'hunter' | 'warlock' = 'warrior',
  bClass: 'warrior' | 'mage' | 'hunter' | 'warlock' = 'mage',
): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer(aClass, 'Aleph', { autoEquip: true });
  const b = sim.addPlayer(bClass, 'Bet', { autoEquip: true });
  teleport(sim, a, 0, -40);
  teleport(sim, b, 4, -40);
  sim.duelRequest(b, a);
  sim.duelAccept(b);
  // run the 3s countdown (TICK_RATE = 20) to flip the duel to 'active'
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick();
    const d = (sim as any).duels.get(a);
    if (d && d.state === 'active') break;
  }
  return { sim, a, b };
}

function givePet(sim: Sim, ownerPid: number): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      e.ownerId = ownerPid;
      e.hostile = false;
      e.hp = e.maxHp;
      teleport(sim, e.id, sim.entities.get(ownerPid)!.pos.x + 1, sim.entities.get(ownerPid)!.pos.z);
      return e;
    }
  }
  throw new Error('no wild mob available to adopt as a pet');
}

// A bleed/poison style damage-over-time applied by the opponent.
function opponentDot(sourceId: number): Aura {
  return {
    id: 'test_bleed',
    name: 'Test Bleed',
    kind: 'dot',
    remaining: 10,
    duration: 10,
    value: 40,
    tickInterval: 1,
    tickTimer: 1,
    sourceId,
    school: 'physical',
  } as Aura;
}

describe('duel: non-lethal cleanup', () => {
  it('a lingering opponent DoT does not kill the loser after the duel ends', () => {
    const { sim, a, b } = startedDuel();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect((sim as any).duels.get(a)?.state).toBe('active');

    // Aleph puts a strong bleed on Bet, then lands the finishing blow. The
    // 1-HP duel guard fires, the duel ends, Bet survives at 1 HP.
    (sim as any).applyAura(eb, opponentDot(ea.id));
    (sim as any).dealDamage(ea, eb, eb.hp + 1000, false, 'physical', 'Finisher', 'hit');

    expect(sim.duelFor(b)).toBeNull(); // duel is over
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBe(1);

    // Run a few seconds so the leftover bleed ticks several times.
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    // The duel was non-lethal — the opponent's leftover DoT must not have
    // killed Bet for real after the bout ended.
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBeGreaterThanOrEqual(1);
  });

  it('a lingering DoT does not kill a player who forfeits by running away', () => {
    const { sim, a, b } = startedDuel();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;

    (sim as any).applyAura(eb, opponentDot(ea.id));
    eb.hp = 30; // wounded but alive

    // Bet flees past the forfeit distance, ending the duel as a draw (a
    // quiet vale spot clear of camps: the old far point is island land now).
    teleport(sim, b, 40, -140);
    sim.tick();
    expect((sim as any).duels.has(b)).toBe(false);

    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(eb.dead).toBe(false);
  });
});

describe('duel: same-tick reciprocal lethal hits', () => {
  it('does not let a real death slip through when both duelists land a lethal hit in the same tick', () => {
    const { sim, a, b } = startedDuel();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    (sim as any).drainEvents();

    // Aleph's blow lands first and ends the duel via the 1-HP guard. Before
    // the duel entry is purged, Bet's own lethal blow against Aleph resolves
    // in the SAME tick (the real projectile-resolution path can produce this
    // when both attacks land in one tick). Neither hit may produce a real
    // death: duels never kill.
    (sim as any).dealDamage(ea, eb, eb.hp + 1000, false, 'physical', 'Finisher', 'hit');
    (sim as any).dealDamage(eb, ea, ea.hp + 1000, false, 'physical', 'Finisher', 'hit');

    expect(eb.dead).toBe(false);
    expect(eb.hp).toBe(1);
    expect(ea.dead).toBe(false);
    expect(ea.hp).toBe(1);
    expect(sim.duelFor(a)).toBeNull();
    expect(sim.duelFor(b)).toBeNull();

    // Only the first lethal hit should have resolved the duel: the deed
    // ledgers and the duelEnd broadcast must not double-count the reciprocal
    // hit that landed against an already-ended bout.
    const aMeta = sim.players.get(a)!;
    const bMeta = sim.players.get(b)!;
    expect(aMeta.deedStats.counters.duelsWon ?? 0).toBe(1);
    expect(bMeta.deedStats.counters.duelsLost ?? 0).toBe(1);
    expect(bMeta.deedStats.counters.duelsWon ?? 0).toBe(0);
    expect(aMeta.deedStats.counters.duelsLost ?? 0).toBe(0);
    const duelEndEvents = ((sim as any).events as { type: string }[]).filter(
      (e) => e.type === 'duelEnd',
    );
    expect(duelEndEvents.length).toBe(1);
  });
});

describe('duel: PvP combat affordances', () => {
  it('lets a commanded pet attack an active duel opponent', () => {
    const { sim, a, b } = startedDuel('hunter', 'mage');
    const pet = givePet(sim, a);
    const eb = sim.entities.get(b)!;
    const startHp = eb.hp;

    sim.targetEntity(b, a);
    sim.petAttack(a);
    for (let i = 0; i < 20 * 5 && eb.hp === startHp; i++) sim.tick();

    expect(pet.aggroTargetId).toBe(b);
    expect(eb.hp).toBeLessThan(startHp);
  });

  it('does not make a dueling pet hostile to its owner', () => {
    const { sim, a } = startedDuel('hunter', 'mage');
    const pet = givePet(sim, a);
    const owner = sim.entities.get(a)!;

    expect(sim.isHostileTo(pet, owner)).toBe(false);
    expect(sim.isHostileTo(owner, pet)).toBe(false);
  });

  it('treats pet damage as owner PvP damage for non-lethal duel endings', () => {
    const { sim, a, b } = startedDuel('hunter', 'mage');
    const pet = givePet(sim, a);
    const eb = sim.entities.get(b)!;

    (sim as any).dealDamage(pet, eb, eb.hp + 1000, false, 'physical', 'Pet Bite', 'hit');

    expect(sim.duelFor(b)).toBeNull();
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBe(1);
  });

  it('lets warlock self and hostile spells work against active duel opponents', () => {
    const { sim, a, b } = startedDuel('warlock', 'warrior');
    const warlock = sim.entities.get(a)!;
    const warrior = sim.entities.get(b)!;
    sim.setPlayerLevel(20, a);
    sim.setPlayerLevel(20, b);
    warlock.resource = Math.floor(warlock.maxResource / 2);
    warlock.hp = warlock.maxHp - 50;
    warlock.targetId = b;
    warlock.facing = Math.atan2(warrior.pos.x - warlock.pos.x, warrior.pos.z - warlock.pos.z);

    const hpBeforeTap = warlock.hp;
    const manaBeforeTap = warlock.resource;
    sim.castAbility('life_tap', a);
    expect(warlock.hp).toBeLessThan(hpBeforeTap);
    expect(warlock.resource).toBeGreaterThan(manaBeforeTap);

    // The curse is a projectile now: it applies when the bolt reaches the warrior
    // (projectile_travel), a few ticks after the cast, so let each land. A bolt
    // can also MISS on the spell hit table (the roll rides the shared rng
    // stream, which world-gen shifts), so retry the cast rather than pin a
    // stream position.
    for (let attempt = 0; attempt < 8; attempt++) {
      warlock.gcdRemaining = 0;
      warlock.resource = warlock.maxResource;
      sim.castAbility('curse_of_agony', a);
      for (let i = 0; i < 20 && (sim as any).pendingProjectiles.length > 0; i++) sim.tick();
      if (warrior.auras.some((aura) => aura.id === 'curse_of_agony')) break;
    }
    expect(warrior.auras.some((aura) => aura.id === 'curse_of_agony')).toBe(true);

    warlock.gcdRemaining = 0;
    warlock.resource = warlock.maxResource;
    const warriorHpBeforeDrain = warrior.hp;
    const warlockHpBeforeDrain = warlock.hp;
    sim.castAbility('drain_life', a);
    for (let i = 0; i < 20 * 2; i++) sim.tick();

    expect(warrior.hp).toBeLessThan(warriorHpBeforeDrain);
    expect(warlock.hp).toBeGreaterThan(warlockHpBeforeDrain);
  });

  it('copies the terminal duel health loss through Ruinous Brand', () => {
    const { sim, a, b } = startedDuel('warlock', 'warrior');
    sim.setPlayerLevel(20, a);
    sim.setPlayerLevel(20, b);
    expect(sim.setSpec('destruction', a)).toBe(true);
    sim.tick();
    const warlock = sim.entities.get(a)!;
    const opponent = sim.entities.get(b)!;
    const branded = createMob(99_901, MOBS.training_dummy, 20, {
      x: warlock.pos.x + 2,
      y: warlock.pos.y,
      z: warlock.pos.z + 5,
    });
    branded.hostile = true;
    branded.maxHp = branded.hp = 10_000;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(branded);
    applyRuinousBrand(sim.ctx, warlock, branded, 18, 3);

    opponent.hp = 10;
    opponent.inCombat = true;
    opponent.combatTimer = 0;
    warlock.resource = warlock.maxResource;
    warlock.gcdRemaining = 0;
    warlock.auras.push({
      id: 'destruction_ruin',
      name: 'Ruin',
      kind: 'destruction_ruin',
      remaining: 3600,
      duration: 3600,
      value: 1,
      stacks: 1,
      sourceId: warlock.id,
      school: 'fire',
    });
    sim.targetEntity(opponent.id, a);
    warlock.facing = Math.atan2(opponent.pos.x - warlock.pos.x, opponent.pos.z - warlock.pos.z);
    const brandedBefore = branded.hp;

    sim.castAbility('shadowburn', a);
    for (let i = 0; i < 20 && opponent.hp > 1; i++) sim.tick();

    expect(opponent.hp).toBe(1);
    expect(brandedBefore - branded.hp).toBe(5);
    expect(branded.auras.find((aura) => aura.id === 'ruinous_brand')?.stacks).toBe(2);
  });
});

describe('duel end and live profession sessions', () => {
  it('the duel-ending clamped blow still ends the loser fishing session', () => {
    // The 1 hp duel clamp early-returns before the shared damage tail, which
    // is where the landed-hit session cancel lives: without its own cancel a
    // duel loser kept fishing at 1 hp through the blow that ended the duel.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b);
    if (!loser) throw new Error('missing loser');
    loser.castingAbility = 'fishing';
    loser.castTotal = 15;
    loser.castRemaining = 15;
    loser.fishBiteAtTick = (sim as any).tickCount + 100;
    loser.fishCastZoneId = 'eastbrook_vale';
    const winner = sim.entities.get(a);
    if (!winner) throw new Error('missing winner');

    sim.events = [];
    sim.dealDamage(winner, loser, loser.hp + 500, false, 'physical', null, 'hit');

    expect(loser.hp).toBe(1);
    // The release/v0.33.0 duel-end contract defers the map delete to the
    // tick-tail purge (endedTick), so consumers see the end through
    // duelFor's null, never a deleted entry.
    expect(sim.duelFor(a)).toBeNull();
    expect(loser.castingAbility).toBeNull();
    expect(loser.fishBiteAtTick).toBe(0);
    expect(loser.fishCastZoneId).toBe('');
    // Event order matches the shared tail: damage first, then castStop, so
    // clients and parity goldens see one order for a landed-blow cancel.
    const types = sim.events.map((e) => e.type);
    const damageAt = types.indexOf('damage');
    const stopAt = types.indexOf('castStop');
    expect(damageAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(damageAt);
  });

  it('the duel-ending blow leaves a SPELL cast alone (classic no-cancel)', () => {
    // Dropping the isNonSpellCast gate for an unconditional cancel must red
    // here: the clamp arm never grew a spell-cancel path.
    const { sim, a, b } = startedDuel();
    const loser = sim.entities.get(b);
    if (!loser) throw new Error('missing loser');
    loser.castingAbility = 'frostbolt';
    loser.castTotal = 15;
    loser.castRemaining = 15;
    const winner = sim.entities.get(a);
    if (!winner) throw new Error('missing winner');

    sim.dealDamage(winner, loser, loser.hp + 500, false, 'physical', null, 'hit');

    expect(loser.hp).toBe(1);
    // The release/v0.33.0 duel-end contract defers the map delete to the
    // tick-tail purge (endedTick), so consumers see the end through
    // duelFor's null, never a deleted entry.
    expect(sim.duelFor(a)).toBeNull();
    expect(loser.castingAbility).toBe('frostbolt');
  });

  it('a same-tick reciprocal lethal exchange clamps and cancels BOTH duelists', () => {
    // The v0.33.0 sync composed two independent changes on the clamp arm: the
    // release widened its gate to admit a duel that ended EARLIER THIS TICK
    // (endedTick === tickCount, the reciprocal-lethal fix) and the branch
    // added the landed-hit session cancel inside the arm. Neither parent
    // exercised the combination: the second blow of a reciprocal exchange
    // must still clamp to 1 hp AND cancel the survivor's non-spell cast.
    const { sim, a, b } = startedDuel();
    const first = sim.entities.get(a);
    const second = sim.entities.get(b);
    if (!first || !second) throw new Error('missing duelist');
    first.castingAbility = 'fishing';
    first.castTotal = 15;
    first.castRemaining = 15;
    second.castingAbility = 'fishing';
    second.castTotal = 15;
    second.castRemaining = 15;

    // Blow one ends the duel (endedTick stamps the current tick).
    sim.dealDamage(first, second, second.hp + 500, false, 'physical', null, 'hit');
    expect(second.hp).toBe(1);
    expect(second.castingAbility).toBeNull();
    expect(sim.duelFor(a)).toBeNull();

    // Blow two, same tick, from the other duelist: the ended-this-tick duel
    // still clamps (nobody dies to a duel), and the branch's cancel runs on
    // this newly-admitted path too.
    sim.dealDamage(second, first, first.hp + 500, false, 'physical', null, 'hit');
    expect(first.hp).toBe(1);
    expect(first.castingAbility).toBeNull();
  });

  it('a duelist SELF-sourced clamped tick does not end their own session', () => {
    // The tail's self-hit exclusion, restated on the clamp arm: a duelist's
    // own damage (the Cauterize burn carries the caster's own id) can land
    // the clamped blow, and classic rules say your own damage never
    // interrupts a gather or fishing session.
    const { sim, a, b } = startedDuel();
    const duelist = sim.entities.get(b);
    if (!duelist) throw new Error('missing duelist');
    duelist.castingAbility = 'fishing';
    duelist.castTotal = 15;
    duelist.castRemaining = 15;
    duelist.fishCastZoneId = 'eastbrook_vale';

    sim.dealDamage(duelist, duelist, duelist.hp + 500, false, 'fire', null, 'hit');

    expect(duelist.hp).toBe(1);
    expect(duelist.castingAbility).toBe('fishing');
    expect(duelist.fishCastZoneId).toBe('eastbrook_vale');
    void a;
  });
});
