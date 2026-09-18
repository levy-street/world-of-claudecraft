// Perfect Moment (owner design 2026-07-14): the Chronomancer's offensive
// cooldown. Instantly slams the caster to FOUR Arcane Charges and, for 10 sec,
// Aether Darts fires its full-charge barrage WITHOUT consuming them.

import { describe, expect, it } from 'vitest';
import {
  AETHER_DARTS_FULL_CHARGE_MISSILES,
  AETHER_SURGE_MAX_CHARGES,
  ARCANE_SURGE_ID,
  aetherSurgeStacks,
  PERFECT_MOMENT_DARTS_DAMAGE_MULT,
  PERFECT_MOMENT_DURATION,
  PERFECT_MOMENT_ID,
} from '../src/sim/combat/chronomancy';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addHostile(sim: Sim, dist = 6): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

function collect(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

function dartsHits(events: SimEvent[]): number {
  return events.filter((e) => e.type === 'damage' && e.ability === 'Aether Darts').length;
}

const alloc = (spec: string | null): TalentAllocation => ({ ...emptyAllocation(), spec });
const knownIds = (spec: string | null): Set<string> =>
  new Set(
    abilitiesKnownAt('mage', 20, computeTalentModifiers('mage', alloc(spec))).map((k) => k.def.id),
  );

describe('Perfect Moment content def', () => {
  it('pins the Chronomancer-only, level 10, off-GCD 2 min cooldown', () => {
    const def = ABILITIES.perfect_moment;
    expect(def).toBeDefined();
    expect(def.name).toBe('Perfect Moment');
    expect(def.specs).toEqual(['arcane']);
    expect(def.learnLevel).toBe(10);
    expect(def.cooldown).toBe(120);
    expect(def.castTime).toBe(0);
    expect(def.offGcd).toBe(true);
    expect(def.effects).toEqual([{ type: 'perfectMoment' }]);
  });

  it('is Chronomancer-exclusive', () => {
    expect(knownIds('arcane').has('perfect_moment')).toBe(true);
    expect(knownIds('fire').has('perfect_moment')).toBe(false);
    expect(knownIds('frost').has('perfect_moment')).toBe(false);
  });
});

describe('Perfect Moment window', () => {
  it('slams the caster from 0 to FULL charges instantly (the loaded bird)', () => {
    const { sim, p } = chronoMage();
    expect(aetherSurgeStacks(p)).toBe(0);
    sim.castAbility('perfect_moment');
    sim.tick();
    expect(aetherSurgeStacks(p)).toBe(AETHER_SURGE_MAX_CHARGES);
    const window = p.auras.find((a) => a.id === PERFECT_MOMENT_ID);
    expect(window?.duration).toBe(PERFECT_MOMENT_DURATION);
  });

  it('chains full five-missile barrages without consuming the charges', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    sim.targetEntity(mob.id);
    sim.castAbility('perfect_moment');
    sim.tick();
    // First barrage: five missiles, and the stack survives the dump.
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('arcane_missiles');
    const first = collect(sim, 4);
    expect(dartsHits(first)).toBe(AETHER_DARTS_FULL_CHARGE_MISSILES);
    expect(aetherSurgeStacks(p)).toBe(AETHER_SURGE_MAX_CHARGES);
    // Second barrage inside the same window: five more.
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('arcane_missiles');
    const second = collect(sim, 4);
    expect(dartsHits(second)).toBe(AETHER_DARTS_FULL_CHARGE_MISSILES);
    expect(aetherSurgeStacks(p)).toBe(AETHER_SURGE_MAX_CHARGES);
  });

  it('after the window closes, the dump consumes charges again', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    sim.targetEntity(mob.id);
    sim.castAbility('perfect_moment');
    // Ride the whole window out: the marker AND the slammed charges expire.
    collect(sim, PERFECT_MOMENT_DURATION + 1);
    expect(p.auras.some((a) => a.id === PERFECT_MOMENT_ID)).toBe(false);
    expect(aetherSurgeStacks(p)).toBe(0);
    // Rebuild one real charge, then dump: back to the normal consume rule.
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('arcane_surge');
    collect(sim, 3);
    expect(aetherSurgeStacks(p)).toBe(1);
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('arcane_missiles');
    collect(sim, 4);
    expect(aetherSurgeStacks(p)).toBe(0);
  });

  it('increases Aether Darts damage by 20% while Perfect Moment is active', () => {
    // 1. Fire Aether Darts at 4 charges WITHOUT Perfect Moment
    const { sim: simNormal, p: pNormal } = chronoMage();
    const mobNormal = addHostile(simNormal);
    simNormal.targetEntity(mobNormal.id);
    ctxOf(simNormal).applyAura(pNormal, {
      id: ARCANE_SURGE_ID,
      name: 'Aether Surge',
      kind: 'arcane_charge',
      value: AETHER_SURGE_MAX_CHARGES,
      stacks: AETHER_SURGE_MAX_CHARGES,
      duration: 10,
      remaining: 10,
      sourceId: pNormal.id,
      school: 'arcane',
    });
    pNormal.gcdRemaining = 0;
    pNormal.resource = pNormal.maxResource;
    simNormal.castAbility('arcane_missiles');
    const normalHits = collect(simNormal, 4).filter(
      (e) => e.type === 'damage' && e.ability === 'Aether Darts',
    ) as { amount: number; crit: boolean }[];
    expect(normalHits).toHaveLength(AETHER_DARTS_FULL_CHARGE_MISSILES);

    // 2. Fire Aether Darts WITH Perfect Moment
    const { sim: simPM, p: pPM } = chronoMage();
    const mobPM = addHostile(simPM);
    simPM.targetEntity(mobPM.id);
    simPM.castAbility('perfect_moment');
    simPM.tick();
    pPM.gcdRemaining = 0;
    pPM.resource = pPM.maxResource;
    simPM.castAbility('arcane_missiles');
    const pmHits = collect(simPM, 4).filter(
      (e) => e.type === 'damage' && e.ability === 'Aether Darts',
    ) as { amount: number; crit: boolean }[];
    expect(pmHits).toHaveLength(AETHER_DARTS_FULL_CHARGE_MISSILES);

    // Non-crit and crit bolts are both buffed by exactly 20%
    const normalNonCrit = normalHits.find((h) => !h.crit);
    const pmNonCrit = pmHits.find((h) => !h.crit);
    expect(normalNonCrit).toBeDefined();
    expect(pmNonCrit).toBeDefined();
    if (normalNonCrit && pmNonCrit) {
      expect(pmNonCrit.amount).toBe(
        Math.round(normalNonCrit.amount * PERFECT_MOMENT_DARTS_DAMAGE_MULT),
      );
    }

    const normalCrit = normalHits.find((h) => h.crit);
    const pmCrit = pmHits.find((h) => h.crit);
    if (normalCrit && pmCrit) {
      expect(pmCrit.amount).toBe(Math.round(normalCrit.amount * PERFECT_MOMENT_DARTS_DAMAGE_MULT));
    }
  });
});
