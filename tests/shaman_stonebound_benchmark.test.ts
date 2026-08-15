import { describe, expect, it } from 'vitest';
import {
  advanceWarspiritCadence,
  applyWarspiritPosture,
  stoneboundThreatMultiplier,
} from '../src/sim/combat/shaman_warspirit';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import { armorReduction, type Entity } from '../src/sim/types';

function effectiveArmor(sim: Sim, entity: Entity): number {
  return (sim as unknown as { effectiveArmor(target: Entity): number }).effectiveArmor(entity);
}

function physicalEffectiveHealth(sim: Sim, entity: Entity, flatReduction: number): number {
  const armorMultiplier = 1 - armorReduction(effectiveArmor(sim, entity), entity.level);
  return entity.maxHp / (armorMultiplier * (1 - flatReduction));
}

function enhancement(posture: 'galeheart' | 'stonebound'): { sim: Sim; player: Entity } {
  const sim = new Sim({ seed: 2920, playerClass: 'shaman', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('enhancement')).toBe(true);
  applyWarspiritPosture(sim.ctx, sim.player, posture);
  return { sim, player: sim.player };
}

function target(sim: Sim, player: Entity): Entity {
  const mob = createMob(92_920, MOBS.training_dummy, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 3,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp = 1_000_000;
  sim.entities.set(mob.id, mob);
  return mob;
}

describe('Stonebound PBE benchmark contract', () => {
  it('stays below a dedicated Protection Warrior on physical effective health', () => {
    // v0.38 tank parity pass: the ceiling moved from 0.8 to 0.9. The posture
    // gained a Stamina component, more armor, and deeper damage reduction so a
    // Stonebound shaman can tank heroic Nythraxis without being one-shot, and
    // the old "materially below tier" off-tank framing no longer holds. The
    // two frames read differently and both matter: on THIS test's default
    // autoEquip kit the ratio is 0.83, while on a hand-built best-in-slot
    // stamina kit (the tests/tank_parity.test.ts frame) it reaches 0.99. The
    // warrior stays the pure-tank ceiling in both. Owner decision surfaced in
    // the v0.38 tank balance PR.
    const stone = enhancement('stonebound');
    const protection = new Sim({ seed: 2920, playerClass: 'warrior', autoEquip: true });
    protection.setPlayerLevel(20);
    expect(protection.setSpec('prot')).toBe(true);
    protection.castAbility('defensive_stance');
    protection.tick();

    const stoneEhp = physicalEffectiveHealth(stone.sim, stone.player, 0.15);
    const protectionEhp = physicalEffectiveHealth(protection, protection.player, 0.1);
    expect(stoneEhp).toBeGreaterThan(stone.player.maxHp * 1.25);
    expect(stoneEhp).toBeLessThan(protectionEhp * 0.9);
  });

  it('multiplies damaging-action threat by 2.75 but gives up Galeheart sustained output', () => {
    const gale = enhancement('galeheart');
    const stone = enhancement('stonebound');
    const galeTarget = target(gale.sim, gale.player);
    const stoneTarget = target(stone.sim, stone.player);

    addThreat(
      galeTarget,
      gale.player.id,
      100 * stoneboundThreatMultiplier(gale.sim.ctx, gale.player),
    );
    addThreat(
      stoneTarget,
      stone.player.id,
      100 * stoneboundThreatMultiplier(stone.sim.ctx, stone.player),
    );
    expect(stoneTarget.threat.get(stone.player.id)).toBe(
      (galeTarget.threat.get(gale.player.id) ?? 0) * 2.75,
    );

    for (let step = 0; step < 3; step++) {
      advanceWarspiritCadence(gale.sim.ctx, gale.player, galeTarget, 100);
      advanceWarspiritCadence(stone.sim.ctx, stone.player, stoneTarget, 100);
    }
    const galeEchoDamage = gale.sim
      .drainEvents()
      .filter((event) => event.type === 'damage' && event.ability === 'Galeheart Echo')
      .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0);
    const stoneEchoDamage = stone.sim
      .drainEvents()
      .filter((event) => event.type === 'damage' && event.ability === 'Galeheart Echo')
      .reduce((sum, event) => sum + (event.type === 'damage' ? event.amount : 0), 0);
    expect(galeEchoDamage).toBe(100);
    expect(stoneEchoDamage).toBe(0);
  });
});
