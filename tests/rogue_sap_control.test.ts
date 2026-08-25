import { describe, expect, it } from 'vitest';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { incapacitateDrCategory } from '../src/sim/incapacitate_dr';
import { Sim } from '../src/sim/sim';
import type { CrowdControlDrCategory, Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Sap is the classic out-of-combat setup tool. Two defects it had:
//   1. its incapacitate arm called enterCombat, which put both sides in combat
//      and handed the victim an aggro target, so the moment the 8 sec expired
//      the mob charged the rogue who was still standing there in Duskveil;
//   2. it carried no PvP diminishing returns at all, so it could be re-applied
//      at full duration back to back.
// It now rides the 'incapacitate' DR category, whose ladder resolves through
// the same generic arm Gripping Roots ('root') uses.

type SimInternals = {
  rebucket(e: Entity): void;
  addEntity(e: Entity): void;
  diminishedCrowdControlDuration(
    source: Entity,
    target: Entity,
    category: CrowdControlDrCategory,
    duration: number,
  ): number | null;
};

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as SimInternals).rebucket(e);
}

function sapRig(): { sim: Sim; rogue: Entity; mob: Entity } {
  const sim = new Sim({ seed: 9, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  const rogue = sim.player;
  teleport(sim, rogue, 0, 0);
  const mob = createMob(32_000, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
  mob.hostile = true;
  mob.aiState = 'idle';
  (sim as unknown as SimInternals).addEntity(mob);
  teleport(sim, mob, 3, 0);
  rogue.facing = Math.atan2(mob.pos.x - rogue.pos.x, mob.pos.z - rogue.pos.z);
  rogue.resource = rogue.maxResource;
  return { sim, rogue, mob };
}

function sapAura(target: Entity) {
  return target.auras.find((a) => a.id === 'sap_incap');
}

describe('Sap does not start a fight', () => {
  it('leaves both the rogue and the victim out of combat', () => {
    const { sim, rogue, mob } = sapRig();
    sim.castAbility('stealth');
    sim.tick();
    expect(rogue.stealthed).toBe(true);

    rogue.gcdRemaining = 0;
    sim.targetEntity(mob.id);
    sim.castAbility('sap');
    sim.tick();

    expect(sapAura(mob)).toBeDefined();
    // The whole point: no combat, no aggro target, no hate table entry.
    expect(rogue.inCombat).toBe(false);
    expect(mob.inCombat).toBe(false);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.threat.size).toBe(0);
    expect(mob.aiState).toBe('idle');
    // And it still does not blow the rogue's own Duskveil.
    expect(rogue.stealthed).toBe(true);
  });

  it('the victim does not charge the rogue when the Sap expires', () => {
    const { sim, rogue, mob } = sapRig();
    sim.castAbility('stealth');
    sim.tick();
    rogue.gcdRemaining = 0;
    sim.targetEntity(mob.id);
    sim.castAbility('sap');
    sim.tick();
    expect(sapAura(mob)).toBeDefined();

    // Park the rogue well outside any proximity-aggro radius so the only thing
    // that could pull the mob is the Sap itself, then run the full 8 sec out.
    teleport(sim, rogue, 0, 60);
    for (let i = 0; i < 20 * 10; i++) sim.tick();

    expect(sapAura(mob)).toBeUndefined();
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.inCombat).toBe(false);
  });
});

describe('Sap diminishing returns match Gripping Roots', () => {
  it('walks the full/half/quarter/immune ladder against another player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
    const a = sim.addPlayer('rogue', 'Slip');
    const b = sim.addPlayer('mage', 'Mark');
    sim.duels.set(a, { a, b, state: 'active', timer: 0 });
    sim.duels.set(b, sim.duels.get(a)!);
    const source = sim.entities.get(a)!;
    const target = sim.entities.get(b)!;
    const dr = (category: CrowdControlDrCategory, duration: number) =>
      (sim as unknown as SimInternals).diminishedCrowdControlDuration(
        source,
        target,
        category,
        duration,
      );

    // Sap's authored 8 sec, four applications inside the reset window.
    expect(dr('incapacitate', 8)).toBe(8);
    expect(dr('incapacitate', 8)).toBe(4);
    expect(dr('incapacitate', 8)).toBe(2);
    expect(dr('incapacitate', 8)).toBeNull();

    // Byte-for-byte the ladder the druid root rides, which is the parity asked
    // for. Fresh ccDr state so the two chains are measured independently.
    target.ccDr.clear();
    const roots = [dr('root', 8), dr('root', 8), dr('root', 8), dr('root', 8)];
    target.ccDr.clear();
    const saps = [
      dr('incapacitate', 8),
      dr('incapacitate', 8),
      dr('incapacitate', 8),
      dr('incapacitate', 8),
    ];
    expect(saps).toEqual(roots);
  });

  it('keeps its own bucket, so a Sap never eats a root chain', () => {
    const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
    const a = sim.addPlayer('rogue', 'Slip');
    const b = sim.addPlayer('mage', 'Mark');
    sim.duels.set(a, { a, b, state: 'active', timer: 0 });
    sim.duels.set(b, sim.duels.get(a)!);
    const source = sim.entities.get(a)!;
    const target = sim.entities.get(b)!;
    const dr = (category: CrowdControlDrCategory) =>
      (sim as unknown as SimInternals).diminishedCrowdControlDuration(source, target, category, 8);

    expect(dr('incapacitate')).toBe(8);
    expect(dr('incapacitate')).toBe(4);
    // A root applied after two Saps is still at full duration.
    expect(dr('root')).toBe(8);
  });

  it('PvE is untouched: a mob takes the full 8 sec every time', () => {
    const { sim, rogue, mob } = sapRig();
    const dr = () =>
      (sim as unknown as SimInternals).diminishedCrowdControlDuration(
        rogue,
        mob,
        'incapacitate',
        8,
      );
    expect(dr()).toBe(8);
    expect(dr()).toBe(8);
    expect(dr()).toBe(8);
  });

  it('only Sap is diminished; the other plain incapacitates are unchanged', () => {
    expect(incapacitateDrCategory('sap')).toBe('incapacitate');
    for (const id of ['gouge', 'blind', 'wyvern_sting', 'hibernate']) {
      expect(ABILITIES[id], `${id} should exist`).toBeDefined();
      expect(incapacitateDrCategory(id), id).toBeNull();
    }
  });

  it('only Sap opts out of combat entry', () => {
    expect(ABILITIES.sap.noCombatEntry).toBe(true);
    const optedOut = Object.values(ABILITIES)
      .filter((def) => def.noCombatEntry)
      .map((def) => def.id);
    expect(optedOut).toEqual(['sap']);
  });
});
