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
    // Seed hunted (post-merge camp order) so the first 10 Rimelance casts all
    // LAND (a resisted bolt never impacts, so it banks nothing); the loop only
    // needs 7, the extra landed casts are margin. Under seed 90210 the merged
    // stream resists cast 5. Re-hunted from seed 11 after the Eastbrook camp
    // respacing merged in: world-gen draws 5 rng values per camp mob, so
    // thinning the zone-1 camps shifted every seed's stream and seed 11 now
    // resists cast 3. Seed 12 lands all 10 again, so the loop below is
    // unchanged.
    const { sim, p } = makeSim({ seed: 12 });
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

  // Issue #2632: Glacial Spike's cast bar completes (mana spent, cooldown armed)
  // several ticks before its frost bolt actually reaches the target (the
  // projectile travels at PROJECTILE_SPEED). A rapid second press landing in
  // that window used to re-check the Icicles gate, find it still at full stacks
  // (the aura was only removed once the bolt LANDED, inside runEffects), and get
  // wrongly accepted as a second legitimate cast off the same stack.
  it('rejects a second press made while the first bolt is still in flight (issue #2632)', () => {
    const { sim, p } = makeSim();
    spawnTarget(sim, p);
    pushAura(p, { id: 'icicles', name: 'Icicles', kind: 'icicles', stacks: ICICLE_MAX });
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('glacial_spike');
    const events: SimEvent[] = [...sim.drainEvents()];
    expect(
      events.some(
        (e) => e.type === 'castStart' && e.entityId === p.id && e.ability === 'glacial_spike',
      ),
    ).toBe(true);

    // Tick only far enough for the 2.7s cast bar to complete: the cast stops
    // successfully, but the bolt (roughly 6 ticks over the spawnTarget distance)
    // has not landed yet, so the Icicles gate is the only thing being tested.
    let castCompleted = false;
    for (let i = 0; i < 60 && !castCompleted; i++) {
      events.push(...sim.tick());
      castCompleted = events.some((e) => e.type === 'castStop' && e.entityId === p.id && e.success);
    }
    expect(castCompleted).toBe(true);
    expect(damageEvents(events, 'Glacial Spike')).toHaveLength(0);

    // A rapid second press in that window: must be rejected outright, not
    // accepted as a fresh cast against the same (already-spent) Icicles stack.
    const beforeSecondPress = events.length;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('glacial_spike');
    events.push(...sim.drainEvents());
    const secondPressEvents = events.slice(beforeSecondPress);
    expect(
      secondPressEvents.some(
        (e) => e.type === 'castStart' && e.entityId === p.id && e.ability === 'glacial_spike',
      ),
    ).toBe(false);
    expect(secondPressEvents.some((e) => e.type === 'error')).toBe(true);

    // Let the first (and only accepted) bolt land, then confirm exactly one
    // Glacial Spike hit landed and the whole Icicle stack was spent once.
    for (let i = 0; i < 20; i++) events.push(...sim.tick());
    expect(damageEvents(events, 'Glacial Spike')).toHaveLength(1);
    expect(frostIcicleCharges(p.auras)).toBe(0);
  });
});
