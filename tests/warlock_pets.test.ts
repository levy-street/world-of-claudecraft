import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { dist2d } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warlock', autoEquip: true });
}

function nearestMob(sim: Sim): Entity {
  const p = sim.player;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best!;
}

function teleport(e: Entity, x: number, z: number, seed: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, seed);
  e.prevPos = { ...e.pos };
}

// drive a cast to completion (6-10s casts → tick well past it)
function castAndFinish(sim: Sim, id: string) {
  sim.castAbility(id);
  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
}

describe('warlock demon pets', () => {
  it('summons an imp that is an owned, friendly demon', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    expect(sim.petOf(sim.playerId)).toBeNull();
    castAndFinish(sim, 'summon_imp');
    const pet = sim.petOf(sim.playerId);
    expect(pet).not.toBeNull();
    expect(pet!.templateId).toBe('emberkin');
    expect(pet!.ownerId).toBe(sim.playerId);
    expect(pet!.hostile).toBe(false);
  });

  it("imp attacks the owner's enemy at range with fire damage", () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    castAndFinish(sim, 'summon_imp');
    const imp = sim.petOf(sim.playerId)!;
    const mob = nearestMob(sim);
    mob.maxHp = 5000;
    mob.hp = 5000;
    teleport(mob, sim.player.pos.x + 10, sim.player.pos.z, sim.cfg.seed);
    // owner engages: the pet assists targets the owner is attacking
    sim.targetEntity(mob.id);
    sim.startAutoAttack();
    let sawFire = false;
    for (let i = 0; i < 20 * 12; i++) {
      const ev = sim.tick();
      if (
        ev.some(
          (e: any) =>
            e.type === 'damage' && e.sourceId === imp.id && e.school === 'fire' && e.amount > 0,
        )
      )
        sawFire = true;
      if (sawFire) break;
    }
    expect(sawFire).toBe(true);
    expect(mob.hp).toBeLessThan(5000);
  });

  it('summoning a voidwalker replaces the existing imp', () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    castAndFinish(sim, 'summon_imp');
    const imp = sim.petOf(sim.playerId)!;
    expect(imp.templateId).toBe('emberkin');
    castAndFinish(sim, 'summon_voidwalker');
    const pet = sim.petOf(sim.playerId)!;
    expect(pet.templateId).toBe('gloomshade');
    // the imp is gone from the world entirely (summoned demons unravel)
    expect(sim.entities.has(imp.id)).toBe(false);
  });

  it('a slain demon unravels instead of respawning into the wild', () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    castAndFinish(sim, 'summon_imp');
    const imp = sim.petOf(sim.playerId)!;
    (sim as any).dealDamage(null, imp, imp.maxHp + 100, false, 'shadow', null, 'hit', true);
    expect(imp.dead).toBe(true);
    // brief corpse, then it despawns (no wild demon left behind)
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(sim.entities.has(imp.id)).toBe(false);
    for (const e of sim.entities.values()) {
      expect(e.templateId).not.toBe('emberkin');
    }
  });
});
