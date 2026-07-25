import { describe, expect, it } from 'vitest';
import { frostIcicleCharges, ICICLE_MAX } from '../src/sim/combat/frost_mage';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

// Glacial Spike (owner design 2026-07-14, combat/frost_mage.ts + content): the
// frost spender. Rimelance impacts and Frozen Orb pulses bank Icicles (up to 5);
// at a full stack Glacial Spike is castable, consumes the whole stack for a slow
// heavy hit, and freezes the target so the follow-up spells Shatter.

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function makeSim(opts?: { spec?: string | null; seed?: number }): { sim: TestSim; p: Entity } {
  const sim = new Sim({
    seed: opts?.seed ?? 90210,
    playerClass: 'mage',
    autoEquip: true,
  }) as unknown as TestSim;
  sim.setPlayerLevel(20);
  const spec = opts?.spec === undefined ? 'frost' : opts.spec;
  if (spec !== null) expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  return { sim, p: sim.player };
}

function spawnTarget(sim: TestSim, p: Entity, dz = 8): Entity {
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function damageEvents(events: SimEvent[], abilityName: string) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.ability === abilityName,
  );
}

function castAndResolve(
  sim: TestSim,
  p: Entity,
  abilityId: string,
  abilityName: string,
  maxTicks = 160,
): SimEvent[] {
  p.gcdRemaining = 0;
  p.resource = p.maxResource;
  sim.castAbility(abilityId);
  const events: SimEvent[] = [...sim.drainEvents()];
  for (let i = 0; i < maxTicks; i++) {
    events.push(...sim.tick());
    if (damageEvents(events, abilityName).length > 0) break;
  }
  return events;
}

function pushAura(e: Entity, aura: Partial<Aura> & Pick<Aura, 'id' | 'name' | 'kind'>): void {
  e.auras.push({
    value: 0,
    remaining: 999,
    duration: 999,
    school: 'frost',
    ...aura,
  } as Aura);
}

const alloc = (spec: string | null): TalentAllocation => ({ ...emptyAllocation(), spec });
const knownIds = (spec: string | null): Set<string> =>
  new Set(
    abilitiesKnownAt('mage', 20, computeTalentModifiers('mage', alloc(spec))).map((k) => k.def.id),
  );

describe('Glacial Spike content def', () => {
  it('pins the slow, heavy, icicle-gated spender', () => {
    const def = ABILITIES.glacial_spike;
    expect(def).toBeDefined();
    expect(def.name).toBe('Glacial Spike');
    expect(def.specs).toEqual(['frost']);
    // Slow and powerful: a long cast, no cooldown (the Icicle gate is the limiter).
    expect(def.castTime).toBeGreaterThanOrEqual(2.5);
    expect(def.cooldown).toBe(0);
    expect(def.school).toBe('frost');
    // Gated on a FULL Icicles stack, which the cast consumes.
    expect(def.requiresAuraKind).toBe('icicles');
    expect(def.requiresAuraStacks).toBe(ICICLE_MAX);
    // It hits AND freezes: a directDamage plus a target root.
    const rank20 = def.ranks?.find((r) => r.level === 20) ?? def;
    const types = (rank20.effects ?? []).map((e) => e.type);
    expect(types).toContain('directDamage');
    expect(types).toContain('root');
  });

  it('is a frost-only ability', () => {
    expect(knownIds('frost').has('glacial_spike')).toBe(true);
    expect(knownIds('fire').has('glacial_spike')).toBe(false);
    expect(knownIds(null).has('glacial_spike')).toBe(false);
  });
});

describe('Icicles build-up', () => {
  it('a Rimelance impact banks one Icicle, capped at ICICLE_MAX', () => {
    const { sim, p } = makeSim();
    spawnTarget(sim, p);
    expect(frostIcicleCharges(p.auras)).toBe(0);
    for (let n = 1; n <= ICICLE_MAX + 2; n++) {
      castAndResolve(sim, p, 'frostbolt', 'Rimelance');
      expect(frostIcicleCharges(p.auras)).toBe(Math.min(n, ICICLE_MAX));
    }
  });
});

describe('Glacial Spike gating + payoff', () => {
  it('does not cast below a full Icicle stack (the stack is untouched)', () => {
    const { sim, p } = makeSim();
    const target = spawnTarget(sim, p);
    pushAura(p, { id: 'icicles', name: 'Icicles', kind: 'icicles', stacks: ICICLE_MAX - 1 });
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('glacial_spike');
    const events: SimEvent[] = [...sim.drainEvents()];
    for (let i = 0; i < 160; i++) events.push(...sim.tick());
    // Blocked: no Glacial Spike damage, no root planted, the Icicles are not spent.
    expect(damageEvents(events, 'Glacial Spike')).toHaveLength(0);
    expect(target.auras.some((a) => a.kind === 'root')).toBe(false);
    expect(frostIcicleCharges(p.auras)).toBe(ICICLE_MAX - 1);
  });

  it('at a full stack it fires, consumes every Icicle, and freezes the target', () => {
    const { sim, p } = makeSim();
    const target = spawnTarget(sim, p);
    pushAura(p, { id: 'icicles', name: 'Icicles', kind: 'icicles', stacks: ICICLE_MAX });
    const events = castAndResolve(sim, p, 'glacial_spike', 'Glacial Spike');
    // It landed its heavy hit.
    expect(damageEvents(events, 'Glacial Spike').length).toBeGreaterThan(0);
    // It consumed the whole Icicle stack.
    expect(frostIcicleCharges(p.auras)).toBe(0);
    // It froze the target (a root aura), so isRooted counts it as frozen and the
    // follow-up spells Shatter.
    expect(target.auras.some((a) => a.kind === 'root')).toBe(true);
  });
});
