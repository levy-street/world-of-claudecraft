// Perfect Moment (owner design 2026-07-14): the Chronomancer's offensive
// cooldown. Instantly slams the caster to FOUR Arcane Charges and, for 10 sec,
// Aether Darts fires its full-charge barrage WITHOUT consuming them.

import { describe, expect, it } from 'vitest';
import {
  AETHER_DARTS_FULL_CHARGE_MISSILES,
  AETHER_SURGE_MAX_CHARGES,
  aetherSurgeStacks,
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
import type { Entity, SimEvent } from '../src/sim/types';

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
});
