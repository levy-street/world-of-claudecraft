// End-to-end proof that DoTs/HoTs are fully DYNAMIC, driven through the real sim tick
// (updateAuras via Sim.tick). A live Spell Power buff on the caster instantly lifts an
// already-active DoT and drops it back when the buff fades, with NO recast; caster haste
// raises the tick RATE while the duration stays fixed, so a hasted DoT lands more ticks.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

const TPS = 20;

function makeSim() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const sourceId = sim.addPlayer('warlock', 'Dotter');
  const targetId = sim.addPlayer('warrior', 'Target');
  const source = sim.entities.get(sourceId) as Entity;
  const target = sim.entities.get(targetId) as Entity;
  target.maxHp = 1_000_000;
  target.hp = target.maxHp;
  return { sim, source, target };
}

// A pure DoT: 40 base per tick, +0.2 x live Spell Power rider, 3s interval, 60s duration.
function dynamicDot(source: Entity): Aura {
  return {
    id: 'testdot',
    name: 'Test Rot',
    kind: 'dot',
    remaining: 60,
    duration: 60,
    value: 40,
    tickBase: 40,
    tickPowerCoeff: 0.2,
    tickPowerStat: 'spell',
    tickInterval: 3,
    tickTimer: 3,
    sourceId: source.id,
    school: 'shadow',
  };
}

function tickAmounts(sim: Sim, source: Entity, target: Entity, seconds: number): number[] {
  const amounts: number[] = [];
  for (let i = 0; i < seconds * TPS; i++) {
    for (const e of sim.tick() as SimEvent[]) {
      if (
        e.type === 'damage' &&
        e.sourceId === source.id &&
        e.targetId === target.id &&
        e.ability === 'Test Rot'
      ) {
        amounts.push((e as Extract<SimEvent, { type: 'damage' }>).amount);
      }
    }
  }
  return amounts;
}

describe('dynamic DoTs: live power recompute', () => {
  it('an active DoT tracks the caster Spell Power up AND back down with no recast', () => {
    const { sim, source, target } = makeSim();
    source.spellPower = 0;
    target.auras.push(dynamicDot(source));

    const early = tickAmounts(sim, source, target, 9); // ~3 ticks at SP 0
    source.spellPower = 300; // buff lands mid-DoT
    const mid = tickAmounts(sim, source, target, 9); // ~3 ticks at SP 300
    source.spellPower = 0; // buff fades
    const late = tickAmounts(sim, source, target, 9); // ~3 ticks back at SP 0

    // Crit only ever raises a tick (shadow crits at 1.5x), so the per-phase MINIMUM is
    // the non-crit amount: 40 at SP 0, 40 + round(300 * 0.2) = 100 at SP 300.
    expect(early.length).toBeGreaterThanOrEqual(2);
    expect(mid.length).toBeGreaterThanOrEqual(2);
    expect(late.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...early)).toBe(40);
    expect(Math.min(...mid)).toBe(100); // instantly bigger, no recast
    expect(Math.min(...late)).toBe(40); // and back down when the buff ends
  });
});

describe('dynamic DoTs: haste raises the tick rate', () => {
  it('a hasted caster lands more ticks over the same fixed duration', () => {
    const base = makeSim();
    base.source.spellPower = 0;
    base.source.spellHaste = 0;
    base.target.auras.push(dynamicDot(base.source));
    const baseTicks = tickAmounts(base.sim, base.source, base.target, 60).length;

    const fast = makeSim();
    fast.source.spellPower = 0;
    fast.source.spellHaste = 1.0; // +100% haste halves the interval
    fast.target.auras.push(dynamicDot(fast.source));
    const fastTicks = tickAmounts(fast.sim, fast.source, fast.target, 60).length;

    // 60s / 3s = 20 ticks unhasted; ~100% haste roughly doubles that (duration fixed).
    expect(baseTicks).toBe(20);
    expect(fastTicks).toBeGreaterThan(baseTicks * 1.7);
  });
});

describe('dynamic HoTs: live power recompute + haste', () => {
  function healTicks(sim: Sim, source: Entity, target: Entity, seconds: number): number[] {
    const amounts: number[] = [];
    for (let i = 0; i < seconds * TPS; i++) {
      for (const e of sim.tick() as SimEvent[]) {
        if (e.type === 'heal2' && e.sourceId === source.id && e.targetId === target.id) {
          amounts.push((e as Extract<SimEvent, { type: 'heal2' }>).amount);
        }
      }
    }
    return amounts;
  }

  it('an active HoT scales with the caster Spell Power without a recast', () => {
    const { sim, source, target } = makeSim();
    source.spellPower = 0;
    target.hp = 1; // keep a deep deficit so ticks are never clamped by missing hp
    target.auras.push({
      id: 'testhot',
      name: 'Test Bloom',
      kind: 'hot',
      remaining: 60,
      duration: 60,
      value: 30,
      tickBase: 30,
      tickPowerCoeff: 0.2,
      tickPowerStat: 'spell',
      tickInterval: 3,
      tickTimer: 3,
      sourceId: source.id,
      school: 'nature',
    });

    const early = healTicks(sim, source, target, 9);
    source.spellPower = 500;
    target.hp = 1;
    const boosted = healTicks(sim, source, target, 9);
    // 30 base at SP 0, 30 + round(500 * 0.2) = 130 at SP 500 (crit only raises it).
    expect(Math.min(...early)).toBe(30);
    expect(Math.min(...boosted)).toBe(130);
  });
});

describe('dynamic DoTs: ticks can crit', () => {
  it('a high-crit caster produces at least one 1.5x tick over the DoT', () => {
    const { sim, source, target } = makeSim();
    source.spellPower = 0;
    source.stats.int = 6000; // spellCrit = 0.05 + int * 0.0008 -> guaranteed crits
    target.auras.push(dynamicDot(source));
    const amounts = tickAmounts(sim, source, target, 60);
    // base tick is 40; a crit tick is round(40 * 1.5) = 60.
    expect(amounts).toContain(60);
  });
});
