import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { dropTargetsOnStealth } from '../src/sim/combat/stealth';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { petCanSeeStealthedTarget } from '../src/sim/threat';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

// Bug: pets could still see and hit stealthed rogues (proximity detection like a
// mob), and Vanish did not force enemies off the rogue. Pets now perceive stealth
// exactly like an enemy player (not at all), and entering stealth wipes every
// hostile hunter's lock. Covers Rogue Duskveil/Smokestep AND Druid Stalk.

type TestSim = Sim & { addEntity(entity: Entity): void; nextId: number };

function rogue(seed = 11): TestSim {
  const sim = new Sim({ seed, playerClass: 'rogue', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  return sim;
}

function stealthAura(id = 'stealth', name = 'Duskveil'): Aura {
  return {
    id,
    name,
    kind: 'stealth',
    remaining: 3600,
    duration: 3600,
    value: 0.5,
    sourceId: 0,
    school: 'physical',
  };
}

function addMob(sim: TestSim): Entity {
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  mob.hostile = true;
  sim.addEntity(mob);
  return mob;
}

function addPet(sim: TestSim, ownerId: number): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.ownerId = ownerId; // an owned mob is a pet
  sim.addEntity(pet);
  return pet;
}

// Add an enemy player in an active duel with the rogue. A duel is what makes the
// pair hostile to each other (isHostileTo), so both the enemy player and any pet
// it owns count as real hunters of the stealthing rogue.
function duelRival(sim: TestSim, cls: PlayerClass): number {
  const rival = sim.addPlayer(cls, 'Rival');
  const duel = {
    a: sim.playerId,
    b: rival,
    state: 'active' as const,
    timer: 0,
    controlled: new Map(),
  };
  sim.ctx.duels.set(sim.playerId, duel);
  sim.ctx.duels.set(rival, duel);
  return rival;
}

describe('pets cannot see stealthed rogues', () => {
  it('petCanSeeStealthedTarget: blind to Rogue stealth AND Druid prowl, sees otherwise', () => {
    const sim = rogue();
    const p = sim.player;
    expect(petCanSeeStealthedTarget(p)).toBe(true);
    p.auras.push(stealthAura('stealth', 'Duskveil'));
    expect(petCanSeeStealthedTarget(p)).toBe(false);
    p.auras = [stealthAura('prowl', 'Stalk')]; // druid Prowl is the same aura kind
    expect(petCanSeeStealthedTarget(p)).toBe(false);
  });

  it('a pet deals no damage to a stealthed player, but strikes a visible one', () => {
    const sim = rogue();
    const enemyPet = addPet(sim, 999_999); // an enemy pet (owned mob)
    const p = sim.player;
    p.auras.push(stealthAura());
    const blocked = dealDamage(sim.ctx, enemyPet, p, 50, false, 'physical', 'Bite', 'hit');
    expect(blocked).toBe(0);
    p.auras = [];
    const landed = dealDamage(sim.ctx, enemyPet, p, 50, false, 'physical', 'Bite', 'hit');
    expect(landed).toBeGreaterThan(0);
  });

  it('a pet drops a target that stealths (updatePet re-validates each tick)', () => {
    const sim = rogue();
    const rival = duelRival(sim, 'warrior');
    const pet = addPet(sim, sim.playerId); // the rogue's own pet, hunting the rival
    const rivalEntity = sim.entities.get(rival)!;
    pet.aggroTargetId = rival; // a pet's combat target is aggroTargetId
    pet.inCombat = true;
    // Rival slips into stealth directly (no cast, so ONLY the pet-visibility rule
    // can drop the target here, not the Vanish sweep).
    rivalEntity.auras.push(stealthAura());
    rivalEntity.stealthed = true;
    sim.tick();
    expect(pet.aggroTargetId).toBe(null);
  });
});

describe('Vanish forces enemies off the rogue', () => {
  it('wipes the rogue from a mob hate table, aggro, taunt lock, and live target', () => {
    const sim = rogue();
    const mob = addMob(sim);
    mob.threat.set(sim.playerId, 500);
    mob.aggroTargetId = sim.playerId;
    mob.targetId = sim.playerId;
    mob.forcedTargetId = sim.playerId;
    mob.forcedTargetTimer = 3;
    sim.castAbility('vanish');
    // Assert the flip SYNCHRONOUSLY, at cast time: base drops a wild mob to evade
    // and out of combat immediately (even through a Kidney Shot stun, when the mob
    // AI cannot run), and the new sweep must not starve that bookkeeping. Checked
    // before the tick because a mob already sitting on its spawn completes the
    // walk-home and resets to idle on the very next tick.
    expect(mob.aiState).toBe('evade');
    expect(mob.inCombat).toBe(false);
    sim.tick();
    expect(mob.threat.has(sim.playerId)).toBe(false);
    expect(mob.aggroTargetId).toBe(null);
    expect(mob.targetId).toBe(null);
    expect(mob.forcedTargetId).toBe(null);
  });

  it('drops an enemy pet locked onto the rogue', () => {
    const sim = rogue();
    const rival = duelRival(sim, 'hunter');
    const enemyPet = addPet(sim, rival); // owned by the hostile rival, so a true enemy pet
    enemyPet.aggroTargetId = sim.playerId; // a pet's combat target
    enemyPet.targetId = sim.playerId;
    sim.castAbility('vanish');
    sim.tick();
    expect(enemyPet.aggroTargetId).toBe(null);
    expect(enemyPet.targetId).toBe(null);
  });

  it('drops a hostile (dueling) enemy player targeting the rogue', () => {
    const sim = rogue();
    const rival = duelRival(sim, 'mage');
    const rivalEntity = sim.entities.get(rival)!;
    rivalEntity.targetId = sim.playerId;
    sim.castAbility('vanish');
    sim.tick();
    expect(rivalEntity.targetId).toBe(null);
  });

  it('leaves an ally who has the stealthing rogue targeted (party heal target)', () => {
    const sim = rogue();
    const ally = sim.addPlayer('priest', 'Friend'); // no duel: allies, not hostile
    const allyEntity = sim.entities.get(ally)!;
    allyEntity.targetId = sim.playerId;
    dropTargetsOnStealth(sim.ctx, sim.player);
    expect(allyEntity.targetId).toBe(sim.playerId);
  });
});

// The Vanish threat WIPE is exclusive to Vanish (dropSelfFromHostileFocus). A
// plain stealth opener (Duskveil/Stalk) only releases the live lock and leaves
// the hate table for classic mob detection to prune, so it is not a repeatable
// free threat dump on a 10 sec cooldown. It still drops a mob it can no longer
// see, and it still drops enemy players (they never see stealth), but a mob that
// can still detect the rogue keeps its hate.
describe('a plain stealth opener is not a Vanish-tier threat wipe', () => {
  it('releases a mob live lock but leaves the hate table intact', () => {
    const sim = rogue();
    const mob = addMob(sim);
    mob.threat.set(sim.playerId, 500);
    mob.aggroTargetId = sim.playerId;
    mob.targetId = sim.playerId;
    // Enter stealth directly (Duskveil is a plain opener: no Vanish combat drop).
    sim.player.auras.push(stealthAura('prowl', 'Stalk'));
    sim.player.stealthed = true;
    dropTargetsOnStealth(sim.ctx, sim.player);
    // Live lock released so the mob re-evaluates through classic detection...
    expect(mob.aggroTargetId).toBe(null);
    expect(mob.targetId).toBe(null);
    // ...but the hate table survives: only Vanish dumps threat outright.
    expect(mob.threat.has(sim.playerId)).toBe(true);
  });

  it('leaves a non-hostile mob alone (only enemies lose their lock)', () => {
    const sim = rogue();
    const critter = addMob(sim);
    critter.hostile = false; // neutral: not an enemy of the rogue
    critter.aggroTargetId = sim.playerId;
    critter.targetId = sim.playerId;
    sim.player.auras.push(stealthAura());
    sim.player.stealthed = true;
    dropTargetsOnStealth(sim.ctx, sim.player);
    expect(critter.aggroTargetId).toBe(sim.playerId);
    expect(critter.targetId).toBe(sim.playerId);
  });
});

describe('Greater Invisibility vanishes like Smokestep', () => {
  function mageWithGreaterInvis(seed = 21): TestSim {
    const sim = new Sim({ seed, playerClass: 'mage', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    if (!sim.applyTalents({ spec: 'frost', rows: { 8: 'mag_r8_greater_invis' } }))
      throw new Error('greater invisibility talent not granted');
    sim.player.resource = sim.player.maxResource;
    return sim;
  }

  it('"Vanish for 20 sec" wipes a mob to evade and drops an enemy player', () => {
    const sim = mageWithGreaterInvis();
    const mob = addMob(sim);
    mob.threat.set(sim.playerId, 500);
    mob.aggroTargetId = sim.playerId;
    mob.targetId = sim.playerId;
    const rival = duelRival(sim, 'warrior');
    const rivalEntity = sim.entities.get(rival)!;
    rivalEntity.targetId = sim.playerId;
    sim.castAbility('greater_invisibility');
    expect(sim.player.stealthed).toBe(true);
    // Same full drop as Vanish: hate table wiped, mob flipped to evade and out of
    // combat, live target cleared, and the enemy player loses its lock.
    expect(mob.threat.has(sim.playerId)).toBe(false);
    expect(mob.aggroTargetId).toBe(null);
    expect(mob.targetId).toBe(null);
    expect(mob.aiState).toBe('evade');
    expect(mob.inCombat).toBe(false);
    expect(rivalEntity.targetId).toBe(null);
  });
});
