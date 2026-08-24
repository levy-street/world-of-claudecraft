import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { addThreat } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Entering Duskveil must drop the rogue out of every hostile's live targeting.
//
// The reported PvP defect: a hunter or warlock pet that already had the rogue
// as its aggro target kept it through the stealth cast, because updatePet only
// releases a HELD target when petCanSeeTarget fails, and a stealthed player
// inside the pet's detection radius still passes that. So the pet went on
// hitting someone the owner could no longer see. The mob and hostile-player
// arms of the same rule are covered here too.

const DEMON_TEMPLATE = 'emberkin';

type SimInternals = { rebucket(e: Entity): void; addEntity(e: Entity): void; ctx: SimContext };

/** A live entity map that counts full sweeps, so a cast that walks the world
 *  twice where once will do is visible from a test. */
class CountingEntities extends Map<number, Entity> {
  sweeps = 0;
  override values(): MapIterator<Entity> {
    this.sweeps++;
    return super.values();
  }
}

function internals(sim: Sim): SimInternals {
  return sim as unknown as SimInternals;
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  internals(sim).rebucket(e);
}

/** Duelling rogue and warlock: the duel is what makes the two sides hostile,
 *  and a pet resolves its hostility through its owner. */
function duelRig(foeClass: 'warlock' | 'hunter' = 'warlock'): {
  sim: Sim;
  rogue: Entity;
  foe: Entity;
  rogueId: number;
} {
  const sim = new Sim({ seed: 17, playerClass: 'rogue', noPlayer: true });
  const rogueId = sim.addPlayer('rogue', 'Slip');
  const foeId = sim.addPlayer(foeClass, 'Foe');
  sim.duels.set(rogueId, { a: rogueId, b: foeId, state: 'active', timer: 0 });
  sim.duels.set(foeId, sim.duels.get(rogueId)!);
  const rogue = sim.entities.get(rogueId)!;
  const foe = sim.entities.get(foeId)!;
  sim.setPlayerLevel(20, rogueId);
  teleport(sim, rogue, 0, 0);
  teleport(sim, foe, 6, 0);
  rogue.resource = rogue.maxResource;
  return { sim, rogue, foe, rogueId };
}

/** Stealth is gated on being out of combat, which is not what these cases are
 *  about: clear the flags the setup incidentally set so the cast goes through. */
function slipIntoDuskveil(sim: Sim, rogue: Entity, rogueId: number): void {
  rogue.inCombat = false;
  rogue.combatTimer = 99;
  rogue.gcdRemaining = 0;
  rogue.resource = rogue.maxResource;
  sim.castAbility('stealth', rogueId);
  sim.tick();
  expect(rogue.stealthed).toBe(true);
}

describe('entering Duskveil clears every hostile lock on the rogue', () => {
  it('a warlock pet holding the rogue as its target lets go', () => {
    const { sim, rogue, foe, rogueId } = duelRig('warlock');
    summonPet(internals(sim).ctx, foe, DEMON_TEMPLATE);
    const pet = sim.petOf(foe.id)!;
    teleport(sim, pet, 4, 0);

    // The pet is locked on, well inside its own detection radius (4 yd against
    // the 18 yd base), which is exactly the case that used to survive stealth.
    pet.aggroTargetId = rogue.id;
    pet.inCombat = true;
    addThreat(pet, rogue.id, 50);
    sim.tick();
    expect(pet.aggroTargetId).toBe(rogue.id);

    slipIntoDuskveil(sim, rogue, rogueId);

    expect(pet.aggroTargetId).toBeNull();
    expect(pet.threat.has(rogue.id)).toBe(true);
    // ...and it does not simply re-acquire on the following ticks.
    for (let i = 0; i < 20; i++) sim.tick();
    expect(pet.aggroTargetId).toBeNull();
  });

  it('a hostile player loses the selection and the auto-attack feeding it', () => {
    const { sim, rogue, foe, rogueId } = duelRig();
    foe.targetId = rogue.id;
    foe.autoAttack = true;

    slipIntoDuskveil(sim, rogue, rogueId);

    expect(foe.targetId).toBeNull();
    expect(foe.autoAttack).toBe(false);
  });

  it("Smokestep clears a hostile player's selection when it points at the rogue's pet", () => {
    const { sim, rogue, foe, rogueId } = duelRig();
    summonPet(internals(sim).ctx, rogue, DEMON_TEMPLATE);
    const pet = sim.petOf(rogue.id)!;
    teleport(sim, pet, 2, 0);
    foe.targetId = pet.id;
    foe.autoAttack = true;
    foe.queuedOnSwing = 'heroic_strike';
    foe.queuedOnSwingFree = true;
    foe.queuedOnSwingCostMultiplier = 0.5;
    rogue.inCombat = true;
    rogue.gcdRemaining = 0;
    rogue.resource = rogue.maxResource;

    sim.castAbility('vanish', rogueId);

    expect(foe.targetId).toBeNull();
    expect(foe.autoAttack).toBe(false);
    expect(foe.queuedOnSwing).toBeNull();
    expect(foe.queuedOnSwingFree).toBeUndefined();
    expect(foe.queuedOnSwingCostMultiplier).toBeUndefined();
  });

  it('a hostile mob drops its live lock and then prunes if it cannot re-detect', () => {
    const sim = new Sim({ seed: 17, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    const rogue = sim.player;
    teleport(sim, rogue, 0, 0);
    const mob = createMob(33_000, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    mob.hostile = true;
    internals(sim).addEntity(mob);
    teleport(sim, mob, 5, 0);
    mob.aiState = 'chase';
    mob.aggroTargetId = rogue.id;
    mob.forcedTargetId = rogue.id;
    mob.forcedTargetTimer = 3;
    addThreat(mob, rogue.id, 40);

    slipIntoDuskveil(sim, rogue, sim.player.id);

    expect(mob.aggroTargetId).toBeNull();
    expect(mob.forcedTargetId).toBeNull();
    expect(mob.threat.has(rogue.id)).toBe(false);
  });

  it('Smokestep drops the rogue AND settles it in a single sweep of the entity map', () => {
    // The clear settles hostile mobs AND hostile players, and Smokestep adds
    // its own combat drop on top. Every one of those walks the whole entity
    // map, so they all ride ONE pass: a plain Duskveil costs a single sweep,
    // and Smokestep costs that same sweep plus the pet lookup its combat drop
    // needs (`petOf`, a shared scan this rule does not own).
    const sweepsFor = (ability: 'stealth' | 'vanish'): number => {
      const sim = new Sim({ seed: 17, playerClass: 'rogue', autoEquip: true });
      sim.setPlayerLevel(20);
      const rogue = sim.player;
      teleport(sim, rogue, 0, 0);
      const mob = createMob(33_100, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
      mob.hostile = true;
      internals(sim).addEntity(mob);
      teleport(sim, mob, 5, 0);
      mob.aiState = 'chase';
      mob.aggroTargetId = rogue.id;
      addThreat(mob, rogue.id, 40);
      rogue.inCombat = true;
      rogue.combatTimer = 99;
      rogue.gcdRemaining = 0;
      rogue.resource = rogue.maxResource;
      if (ability === 'stealth') rogue.inCombat = false;

      const counted = new CountingEntities(sim.entities);
      (sim as unknown as { entities: Map<number, Entity> }).entities = counted;
      counted.sweeps = 0;
      sim.castAbility(ability);
      // Either cast really did the live-lock work the sweeps are being counted for.
      expect(mob.aggroTargetId).toBeNull();
      if (ability === 'stealth') {
        expect(mob.threat.has(rogue.id)).toBe(true);
      } else {
        expect(mob.threat.has(rogue.id)).toBe(false);
      }
      return counted.sweeps;
    };

    const plain = sweepsFor('stealth');
    expect(plain).toBe(1);
    expect(sweepsFor('vanish')).toBe(plain + 2);
  });

  it('Smokestep still drops the rogue out of combat while it clears the lock', () => {
    const sim = new Sim({ seed: 17, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    const rogue = sim.player;
    teleport(sim, rogue, 0, 0);
    const mob = createMob(33_200, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
    mob.hostile = true;
    internals(sim).addEntity(mob);
    teleport(sim, mob, 5, 0);
    mob.aiState = 'chase';
    mob.aggroTargetId = rogue.id;
    mob.forcedTargetId = rogue.id;
    mob.forcedTargetTimer = 3;
    addThreat(mob, rogue.id, 40);
    rogue.inCombat = true;
    rogue.autoAttack = true;
    rogue.targetId = mob.id;
    rogue.gcdRemaining = 0;

    sim.castAbility('vanish');

    // The combat-drop half: the caster leaves the fight and stops swinging.
    expect(rogue.inCombat).toBe(false);
    expect(rogue.autoAttack).toBe(false);
    expect(rogue.targetId).toBeNull();
    // The stealth-entry half, from the same single pass.
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.forcedTargetId).toBeNull();
    expect(mob.threat.size).toBe(0);
    expect(mob.aiState).toBe('evade');
  });

  it("leaves the rogue's own target alone: Duskveil is an opener, not an escape", () => {
    const { sim, rogue, foe, rogueId } = duelRig();
    sim.targetEntity(foe.id, rogueId);
    expect(rogue.targetId).toBe(foe.id);

    slipIntoDuskveil(sim, rogue, rogueId);

    expect(rogue.targetId).toBe(foe.id);
  });

  it('leaves a hostile who is targeting somebody else untouched', () => {
    const { sim, rogue, foe, rogueId } = duelRig();
    const bystanderId = sim.addPlayer('mage', 'Bystander');
    foe.targetId = bystanderId;
    foe.inCombat = true;
    // Freshly in combat, so the tick's own out-of-combat decay is not what
    // decides the inCombat assertion below.
    foe.combatTimer = 0;

    slipIntoDuskveil(sim, rogue, rogueId);

    // Only a hostile pointed AT the rogue is cleared, and combat state is never
    // touched (losing sight of one opponent is not leaving the fight).
    // The foe's own autoAttack is deliberately not asserted here: the ordinary
    // auto-attack maintenance owns it and drops it for its own reasons against
    // a non-hostile selection, which has nothing to do with this rule.
    expect(foe.targetId).toBe(bystanderId);
    expect(foe.inCombat).toBe(true);
  });
});
