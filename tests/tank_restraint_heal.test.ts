// Damage-derived self-heals under the PvP tank restraint
// (src/sim/pvp/tank_restraint_heal.ts), on a real Protection paladin's
// Hammer of Grace against a dueling player:
//  - the heal is planned from the damage BEFORE the 30% tank cut, so it pays
//    the 30% self-heal cut once, not twice (0.7, never 0.49);
//  - Recurring Grace turns only REAL overheal into a shield: the share the
//    self-heal cut removed is not handed back as an absorb.

import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import {
  damageBeforeTankCut,
  restrainedPlannedHeal,
  TANK_PVP_DAMAGE_PENALTY,
  TANK_PVP_SELF_HEAL_PENALTY,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const HAMMER = 'hammer_of_grace';
const SHIELD = 'recurring_grace_absorb';

function duelRig(rows: Record<number, string> = {}) {
  const sim = new Sim({
    seed: 91,
    playerClass: 'paladin',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('paladin', 'Bulwark');
  sim.setPlayerLevel(20, pid);
  expect(sim.applyTalents({ spec: 'protection', rows }, pid)).toBe(true);
  const tank = sim.entities.get(pid)!;
  tank.resource = tank.maxResource;
  const foeId = sim.addPlayer('mage', 'Foe');
  const foe = sim.entities.get(foeId)!;
  foe.pos = { ...tank.pos, x: tank.pos.x + 3 };
  for (const e of [tank, foe]) {
    e.stats.pvpOffense = 0;
    e.stats.pvpDefense = 0;
  }
  foe.maxHp = foe.hp = 1_000_000;
  const duel = { a: pid, b: foeId, state: 'active', timer: 0, controlled: new Map() };
  (sim.duels as Map<number, unknown>).set(pid, duel);
  (sim.duels as Map<number, unknown>).set(foeId, duel);
  return { sim, tank, foe };
}

function hammer(sim: Sim, tank: Entity, foe: Entity): number {
  const meta = sim.players.get(tank.id)!;
  const ability = sim.resolvedAbility(HAMMER, tank.id);
  if (!ability) throw new Error('missing Hammer of Grace');
  tank.cooldowns.delete(HAMMER);
  const before = foe.hp;
  runEffects(sim.ctx, tank, meta, foe, ability);
  return before - foe.hp;
}

describe('Hammer of Grace under the PvP tank restraint', () => {
  it('pays the self-heal cut once: healed = 0.7 x half of the damage before the tank cut', () => {
    const { sim, tank, foe } = duelRig();
    tank.maxHp = 1_000_000;
    tank.hp = 1;
    const landed = hammer(sim, tank, foe);
    expect(landed).toBeGreaterThan(0);
    const preCut = landed / (1 - TANK_PVP_DAMAGE_PENALTY);
    const planned = Math.round(preCut * 0.5);
    expect(tank.hp - 1).toBe(Math.round(planned * (1 - TANK_PVP_SELF_HEAL_PENALTY)));
    // Not the double cut: well above half of the landed damage times 0.7.
    expect(tank.hp - 1).toBeGreaterThan(Math.round(landed * 0.5 * 0.7));
  });

  it('Recurring Grace gets no shield from the cut share when nothing overheals', () => {
    const { sim, tank, foe } = duelRig({ 8: 'pal_r8_recurring_grace' });
    tank.maxHp = 1_000_000;
    tank.hp = 1;
    hammer(sim, tank, foe);
    expect(tank.auras.some((a) => a.id === SHIELD)).toBe(false);
  });

  it('Recurring Grace still shields real overheal at full health', () => {
    const { sim, tank, foe } = duelRig({ 8: 'pal_r8_recurring_grace' });
    tank.hp = tank.maxHp;
    hammer(sim, tank, foe);
    const shield = tank.auras.find((a) => a.id === SHIELD);
    expect(shield).toBeDefined();
    expect(shield!.value).toBeGreaterThan(0);
  });
});

describe('restraint heal helpers', () => {
  it('only rescale inside the restraint, against a player-controlled target', () => {
    const { sim, tank, foe } = duelRig();
    // No exchange yet: unchanged.
    expect(damageBeforeTankCut(sim.ctx, tank, foe, 70)).toBe(70);
    expect(restrainedPlannedHeal(sim.ctx, tank, 100)).toBe(100);
    tank.pvpExchangeAt = sim.time;
    expect(damageBeforeTankCut(sim.ctx, tank, foe, 70)).toBeCloseTo(100);
    expect(restrainedPlannedHeal(sim.ctx, tank, 100)).toBe(70);
    // A non-hostile target (no duel) is never rescaled.
    sim.duels.clear();
    expect(damageBeforeTankCut(sim.ctx, tank, foe, 70)).toBe(70);
  });
});
