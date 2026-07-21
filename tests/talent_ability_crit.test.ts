import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { accumulateTalentEffect, emptyModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

// G8 (fix/talents2-balance-pass): per-ability critical strike chance. Talent
// effects previously only carried GLOBAL crit (stats.crit); the reworked
// Redhanded mastery (Craven Thrust crit, the classic Improved Backstab 30%)
// needs an ability-scoped bonus that reaches the weapon-strike hit table.

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Ev = { type?: string; kind?: string; crit?: boolean };

function makeSim(cls: PlayerClass, level: number, seed = 7): { sim: AnySim; p: AnyEntity } {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  p.resource = p.maxResource;
  return { sim, p };
}

function spawnDummy(sim: AnySim, p: AnyEntity, level: number): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS['forest_wolf'], level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

function capture(sim: AnySim): Ev[] {
  const events: Ev[] = [];
  const orig = (sim as any).emit.bind(sim);
  (sim as any).emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return events;
}

describe('G8: per-ability crit chance', () => {
  it('accumulates critPct into the resolved ability mod', () => {
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { ability: [{ ability: 'backstab', critPct: 0.3 }] });
    accumulateTalentEffect(mods, { ability: [{ ability: 'backstab', critPct: 0.1 }] });
    expect(mods.abilities.backstab.critPct).toBeCloseTo(0.4);
  });

  it('meleeSwing critBonus alone forces a crit when it reaches 100%', () => {
    const { sim, p } = makeSim('rogue', 12);
    p.critChance = 0; // the ONLY crit source is the per-ability bonus
    const mob = spawnDummy(sim, p, 12);
    const events = capture(sim);
    for (let i = 0; i < 3; i++) {
      const connected = meleeSwing(sim.ctx, p, mob, 5, 'Craven Thrust', {
        cannotBeDodged: true,
        critBonus: 1,
      });
      expect(connected).toBe(true);
    }
    const hits = events.filter((e) => e.type === 'damage' && e.kind === 'hit');
    expect(hits.length).toBe(3);
    expect(hits.every((e) => e.crit === true)).toBe(true);
  });

  it('meleeSwing without critBonus stays at the crit floor', () => {
    const { sim, p } = makeSim('rogue', 12);
    p.critChance = 0;
    const mob = spawnDummy(sim, p, 12);
    const events = capture(sim);
    // 0.5% floor: assert on the aggregate (a regression that leaks a 100%
    // bonus into the plain path flips every swing and fails decisively).
    for (let i = 0; i < 40; i++) {
      meleeSwing(sim.ctx, p, mob, 5, 'Craven Thrust', { cannotBeDodged: true });
    }
    const crits = events.filter((e) => e.type === 'damage' && e.kind === 'hit' && e.crit === true);
    expect(crits.length).toBeLessThanOrEqual(1);
  });
});
