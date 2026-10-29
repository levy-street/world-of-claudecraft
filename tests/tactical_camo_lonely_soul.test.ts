import { describe, expect, it } from 'vitest';
import { startAutoAttack } from '../src/sim/combat/auto_attack';
import { dealDamage } from '../src/sim/combat/damage';
import {
  TACTICAL_CAMO_ID,
  TACTICAL_CAMO_PET_CHECK_TICKS,
} from '../src/sim/combat/hunter_lonely_soul';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

// Stealth Rework: Tactical Camo is no longer a Fieldcraft-only spell. Every
// hunter spec gets it from the Lonely Soul talent (row 8, id hun_r8_beastguard),
// and it is usable only while the hunter has no living pet.

type TestSim = Sim & { addEntity(entity: Entity): void; nextId: number };
type HunterSpec = 'beast_mastery' | 'marksmanship' | 'survival';
const SPECS: readonly HunterSpec[] = ['beast_mastery', 'marksmanship', 'survival'];
const LONELY_SOUL = 'hun_r8_beastguard';
const OTHER_ROW_8 = 'hun_r8_shared_recovery';

function hunter(spec: HunterSpec, row8: string | null, seed = 5101): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: row8 ? { 8: row8 } : {} })).toBe(true);
  sim.player.inCombat = false;
  sim.player.combatTimer = 99;
  return sim;
}

function addPet(sim: TestSim): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  sim.addEntity(pet);
  return pet;
}

const camo = (sim: Sim): boolean => sim.player.auras.some((a) => a.id === TACTICAL_CAMO_ID);

function knows(spec: HunterSpec, row8: string | null): boolean {
  const rows = row8 ? { ...emptyAllocation().rows, 8: row8 } : emptyAllocation().rows;
  const mods = computeTalentModifiers('hunter', { ...emptyAllocation(), spec, rows }, 20);
  return abilitiesKnownAt('hunter', 20, mods).some(({ def }) => def.id === TACTICAL_CAMO_ID);
}

describe('Tactical Camo comes from Lonely Soul, for every hunter spec', () => {
  it('is known by every spec that picks Lonely Soul', () => {
    for (const spec of SPECS) expect(knows(spec, LONELY_SOUL), spec).toBe(true);
  });

  it('is unknown without Lonely Soul, Fieldcraft included', () => {
    for (const spec of SPECS) {
      expect(knows(spec, null), `${spec} with no row`).toBe(false);
      expect(knows(spec, OTHER_ROW_8), `${spec} with another row`).toBe(false);
    }
  });

  it('is no longer gated to a spec and refuses a living pet', () => {
    const sim = hunter('beast_mastery', LONELY_SOUL);
    const def = sim.resolvedAbility(TACTICAL_CAMO_ID)?.def;
    expect(def?.specs).toBeUndefined();
    expect(def?.requiresNoPet).toBe(true);
  });
});

describe('Tactical Camo needs no pet', () => {
  it('casts with no pet out, on every spec', () => {
    for (const spec of SPECS) {
      const sim = hunter(spec, LONELY_SOUL);
      sim.castAbility(TACTICAL_CAMO_ID);
      sim.tick();
      expect(camo(sim), spec).toBe(true);
      expect(sim.player.stealthed, spec).toBe(true);
    }
  });

  it('is refused while a living pet is out, with the pet error', () => {
    const sim = hunter('marksmanship', LONELY_SOUL);
    addPet(sim);
    sim.castAbility(TACTICAL_CAMO_ID);
    const errors = sim.tick().flatMap((ev: SimEvent) => (ev.type === 'error' ? [ev.text] : []));
    expect(camo(sim)).toBe(false);
    expect(errors).toContain('You already have a pet.');
  });

  it('casts once the pet is dead', () => {
    const sim = hunter('beast_mastery', LONELY_SOUL);
    const pet = addPet(sim);
    pet.dead = true;
    pet.hp = 0;
    sim.castAbility(TACTICAL_CAMO_ID);
    sim.tick();
    expect(camo(sim)).toBe(true);
  });

  it('ends within a second of a living pet appearing without a cast', () => {
    const sim = hunter('survival', LONELY_SOUL);
    sim.castAbility(TACTICAL_CAMO_ID);
    sim.tick();
    expect(camo(sim)).toBe(true);
    addPet(sim); // a pet returning without a cast (a revive in place, a match return)
    for (let i = 0; i < TACTICAL_CAMO_PET_CHECK_TICKS; i++) sim.tick();
    expect(camo(sim)).toBe(false);
    expect(sim.player.stealthed).toBe(false);
  });
});

describe('attacking breaks Tactical Camo', () => {
  function camouflaged(): { sim: TestSim; mob: Entity } {
    const sim = hunter('marksmanship', LONELY_SOUL);
    sim.castAbility(TACTICAL_CAMO_ID);
    sim.tick();
    expect(camo(sim)).toBe(true);
    const p = sim.player;
    const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 12,
    });
    mob.hostile = true;
    mob.moveSpeed = 0;
    sim.addEntity(mob);
    p.facing = 0; // facing +z, toward the dummy
    p.targetId = mob.id;
    return { sim, mob };
  }

  it('ends on the auto-attack press, before any shot lands', () => {
    const { sim } = camouflaged();
    startAutoAttack(sim.ctx, sim.playerId);
    expect(sim.player.autoAttack).toBe(true);
    expect(camo(sim)).toBe(false);
    expect(sim.player.stealthed).toBe(false);
  });

  it('ends on the release of an attack ability, before the shot lands', () => {
    const { sim, mob } = camouflaged();
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('serpent_sting');
    expect(camo(sim)).toBe(false); // broken on the release
    expect(mob.auras.some((a) => a.id === 'serpent_sting')).toBe(false); // still in flight
  });

  it('ends on dealing or taking damage', () => {
    const { sim, mob } = camouflaged();
    dealDamage(sim.ctx, sim.player, mob, 10, false, 'physical', 'Test Hit', 'hit');
    expect(camo(sim)).toBe(false);
    sim.player.cooldowns.delete(TACTICAL_CAMO_ID);
    sim.player.inCombat = false;
    sim.player.combatTimer = 99;
    sim.castAbility(TACTICAL_CAMO_ID);
    sim.tick();
    expect(camo(sim)).toBe(true);
    dealDamage(sim.ctx, mob, sim.player, 10, false, 'physical', 'Test Hit', 'hit');
    expect(camo(sim)).toBe(false);
  });
});
