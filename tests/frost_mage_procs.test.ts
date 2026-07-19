import { describe, expect, it } from 'vitest';
import {
  BRAIN_FREEZE_DURATION,
  FINGERS_OF_FROST_DURATION,
  FINGERS_OF_FROST_MAX_STACKS,
  frostProcGlowActive,
  WINTERS_CHILL_CHARGES,
  WINTERS_CHILL_SPENDERS,
} from '../src/sim/combat/frost_mage';
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

// Frost mage proc engine (owner design 2026-07-11, combat/frost_mage.ts):
// Rimelance (frostbolt) impacts roll Fingers of Frost (15%, 2 stacks) and
// Brain Freeze (20%, single); Flurry plants Winter's Chill (2 charges); Ice
// Lance spends them, in the owner's order (really-frozen consumes nothing >
// Fingers > Winter's Chill), for Shatter crits and its 3x frozen damage.

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

// A stationary target: the training dummy never moves (moveSpeed 0, dummy AI),
// so a timed cast can never fail its completion line-of-sight recheck because
// the target wandered mid-cast (a forest wolf does, and flaked the suite).
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

/** Cast and tick until the ability's damage lands (spells travel as
 *  projectiles, so even an instant resolves a few ticks later). */
function castAndResolve(
  sim: TestSim,
  p: Entity,
  abilityId: string,
  abilityName: string,
  maxTicks = 140,
): SimEvent[] {
  p.gcdRemaining = 0;
  p.resource = p.maxResource;
  sim.castAbility(abilityId);
  const events: SimEvent[] = [...sim.drainEvents()];
  for (let i = 0; i < maxTicks; i++) {
    // tick() RETURNS (and clears) the tick's events; drainEvents alone misses them.
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

describe('frost kit content defs', () => {
  it('pins Ice Lance: instant, cheap, no cooldown, frost-gated', () => {
    const def = ABILITIES.ice_lance;
    expect(def).toBeDefined();
    expect(def.name).toBe('Ice Lance');
    expect(def.class).toBe('mage');
    expect(def.learnLevel).toBe(5);
    expect(def.specs).toEqual(['frost']);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(0);
    expect(def.school).toBe('frost');
    expect(def.requiresTarget).toBe(true);
    expect(def.effects).toEqual([{ type: 'directDamage', min: 10, max: 12 }]);
  });

  it('pins Flurry: three bolts, 1.5s cast, 10s cooldown, frost-gated', () => {
    const def = ABILITIES.flurry;
    expect(def).toBeDefined();
    expect(def.name).toBe('Winterlash');
    expect(def.learnLevel).toBe(8);
    expect(def.specs).toEqual(['frost']);
    expect(def.castTime).toBe(1.5);
    expect(def.cooldown).toBe(10);
    expect(def.school).toBe('frost');
    expect(def.effects).toHaveLength(3);
    for (const eff of def.effects) expect(eff.type).toBe('directDamage');
  });

  it('pins the three spec passives as effect-less frost-gated docs', () => {
    // Owner leveling pass 2026-07-14: the two proc passives arrive at the spec
    // pick (5); the Shatter payoff lands at 10.
    for (const [id, lvl] of [
      ['fingers_of_frost', 5],
      ['brain_freeze', 5],
      ['shatter', 10],
    ] as const) {
      const def = ABILITIES[id];
      expect(def, id).toBeDefined();
      expect(def.passive, id).toBe(true);
      expect(def.specs, id).toEqual(['frost']);
      expect(def.effects, id).toEqual([]);
      expect(def.learnLevel, id).toBe(lvl);
    }
  });

  it("Winter's Chill spender set covers Ice Lance and never Flurry", () => {
    expect(WINTERS_CHILL_SPENDERS.has('ice_lance')).toBe(true);
    expect(WINTERS_CHILL_SPENDERS.has('flurry')).toBe(false);
    expect(WINTERS_CHILL_SPENDERS.has('frostbolt')).toBe(false);
  });

  it('the action-bar glow predicate scopes each proc to its spender', () => {
    const fingers = [{ kind: 'fingers_of_frost' }];
    const brain = [{ kind: 'brain_freeze' }];
    expect(frostProcGlowActive(fingers, 'ice_lance')).toBe(true);
    expect(frostProcGlowActive(fingers, 'flurry')).toBe(false);
    expect(frostProcGlowActive(brain, 'flurry')).toBe(true);
    expect(frostProcGlowActive(brain, 'ice_lance')).toBe(false);
    expect(frostProcGlowActive([], 'ice_lance')).toBe(false);
    expect(frostProcGlowActive([...fingers, ...brain], 'frostbolt')).toBe(false);
  });
});

describe('spec gating', () => {
  it('committed frost knows the kit; fire/arcane/no-spec interactions', () => {
    const frost = knownIds('frost');
    for (const id of ['ice_lance', 'flurry', 'fingers_of_frost', 'brain_freeze', 'shatter']) {
      expect(frost.has(id), id).toBe(true);
    }
    const fire = knownIds('fire');
    const arcane = knownIds('arcane');
    for (const id of ['ice_lance', 'flurry', 'fingers_of_frost', 'brain_freeze', 'shatter']) {
      expect(fire.has(id), id).toBe(false);
      expect(arcane.has(id), id).toBe(false);
    }
  });
});

describe('frostbolt proc generation', () => {
  // 30 casts x up to 140 sync tick() calls apiece (castAndResolve's projectile
  // wait) is a lot of synchronous sim work for vitest's 5s default: fine on an
  // idle machine, but tight under worker-pool CPU contention. Real execution is
  // sub-second in isolation; give this one real headroom instead of flaking.
  const PROC_TEST_TIMEOUT_MS = 20_000;

  it(
    'a committed-frost mage eventually rolls both procs, capped at 2 stacks',
    () => {
      const { sim, p } = makeSim();
      spawnTarget(sim, p);
      sim.drainEvents();
      let sawFingers = false;
      let sawBrain = false;
      for (let cast = 0; cast < 30; cast++) {
        castAndResolve(sim, p, 'frostbolt', 'Rimelance');
        const fingers = p.auras.find((a) => a.kind === 'fingers_of_frost');
        const brain = p.auras.find((a) => a.kind === 'brain_freeze');
        if (fingers) {
          sawFingers = true;
          expect(fingers.stacks ?? 1).toBeLessThanOrEqual(FINGERS_OF_FROST_MAX_STACKS);
          expect(fingers.duration).toBe(FINGERS_OF_FROST_DURATION);
        }
        if (brain) {
          sawBrain = true;
          expect(brain.duration).toBe(BRAIN_FREEZE_DURATION);
        }
      }
      expect(sawFingers).toBe(true);
      expect(sawBrain).toBe(true);
    },
    PROC_TEST_TIMEOUT_MS,
  );

  it('a mage without the frost spec never generates either proc', () => {
    const { sim, p } = makeSim({ spec: null });
    spawnTarget(sim, p);
    for (let cast = 0; cast < 15; cast++) {
      castAndResolve(sim, p, 'frostbolt', 'Rimelance');
      expect(p.auras.some((a) => a.kind === 'fingers_of_frost')).toBe(false);
      expect(p.auras.some((a) => a.kind === 'brain_freeze')).toBe(false);
    }
  });

  it(
    'same seed, same casts: identical proc sequence (determinism)',
    () => {
      const run = (): string[] => {
        const { sim, p } = makeSim({ seed: 777 });
        spawnTarget(sim, p);
        const gained: string[] = [];
        for (let cast = 0; cast < 12; cast++) {
          const events = castAndResolve(sim, p, 'frostbolt', 'Rimelance');
          for (const e of events) {
            if (
              e.type === 'aura' &&
              e.gained &&
              (e.name === 'Fingers of Frost' || e.name === 'Brain Freeze')
            )
              gained.push(e.name);
          }
        }
        return gained;
      };
      const first = run();
      expect(first.length).toBeGreaterThan(0);
      expect(run()).toEqual(first);
    },
    PROC_TEST_TIMEOUT_MS,
  );
});

describe('Ice Lance frozen resolution', () => {
  it('deals roughly triple damage against a really frozen (rooted) target', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    // Baseline: normal lances, no frozen state anywhere.
    let normalMax = 0;
    for (let i = 0; i < 6; i++) {
      const hits = damageEvents(castAndResolve(sim, p, 'ice_lance', 'Ice Lance'), 'Ice Lance');
      expect(hits).toHaveLength(1);
      if (!hits[0].crit && hits[0].amount > normalMax) normalMax = hits[0].amount;
    }
    expect(normalMax).toBeGreaterThan(0);
    // Frozen: a live root on the target, consuming nothing.
    pushAura(mob, { id: 'test_root', name: 'Test Root', kind: 'root' });
    const hits = damageEvents(castAndResolve(sim, p, 'ice_lance', 'Ice Lance'), 'Ice Lance');
    expect(hits).toHaveLength(1);
    const frozenHit = hits[0];
    const floor = frozenHit.crit ? normalMax * 2 : normalMax * 2.4;
    expect(frozenHit.amount).toBeGreaterThan(floor);
    // Really-frozen consumes no proc state (there was none to consume).
    expect(p.auras.some((a) => a.kind === 'fingers_of_frost')).toBe(false);
  });

  it("spends Fingers of Frost before Winter's Chill (the owner's order)", () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    pushAura(p, {
      id: 'fingers_of_frost',
      name: 'Fingers of Frost',
      kind: 'fingers_of_frost',
      stacks: 2,
    });
    pushAura(mob, {
      id: 'winters_chill',
      name: "Winter's Chill",
      kind: 'winters_chill',
      charges: WINTERS_CHILL_CHARGES,
      sourceId: p.id,
    });
    sim.drainEvents();
    castAndResolve(sim, p, 'ice_lance', 'Ice Lance');
    const fingers = p.auras.find((a) => a.kind === 'fingers_of_frost');
    expect(fingers?.stacks).toBe(1);
    const chill = mob.auras.find((a) => a.kind === 'winters_chill');
    expect(chill?.charges).toBe(WINTERS_CHILL_CHARGES);

    // Second lance spends the last Fingers stack: the aura fades entirely.
    castAndResolve(sim, p, 'ice_lance', 'Ice Lance');
    expect(p.auras.some((a) => a.kind === 'fingers_of_frost')).toBe(false);
    expect(mob.auras.find((a) => a.kind === 'winters_chill')?.charges).toBe(WINTERS_CHILL_CHARGES);

    // Third lance finally dips into Winter's Chill.
    castAndResolve(sim, p, 'ice_lance', 'Ice Lance');
    expect(mob.auras.find((a) => a.kind === 'winters_chill')?.charges).toBe(
      WINTERS_CHILL_CHARGES - 1,
    );
  });

  it('a Fingers-empowered lance hits like a frozen one', () => {
    const { sim, p } = makeSim();
    spawnTarget(sim, p);
    sim.drainEvents();
    let normalMax = 0;
    for (let i = 0; i < 6; i++) {
      const hits = damageEvents(castAndResolve(sim, p, 'ice_lance', 'Ice Lance'), 'Ice Lance');
      if (!hits[0].crit && hits[0].amount > normalMax) normalMax = hits[0].amount;
    }
    pushAura(p, {
      id: 'fingers_of_frost',
      name: 'Fingers of Frost',
      kind: 'fingers_of_frost',
      stacks: 1,
    });
    const hits = damageEvents(castAndResolve(sim, p, 'ice_lance', 'Ice Lance'), 'Ice Lance');
    const floor = hits[0].crit ? normalMax * 2 : normalMax * 2.4;
    expect(hits[0].amount).toBeGreaterThan(floor);
  });

  it('without any frozen state a lance stays cheap and small', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    const hits = damageEvents(castAndResolve(sim, p, 'ice_lance', 'Ice Lance'), 'Ice Lance');
    expect(hits).toHaveLength(1);
    expect(mob.auras.some((a) => a.kind === 'winters_chill')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'fingers_of_frost')).toBe(false);
  });
});

describe("Flurry and Winter's Chill", () => {
  it('a hard-cast Flurry lands three bolts, plants 2 charges, arms its cooldown', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    const events = castAndResolve(sim, p, 'flurry', 'Winterlash');
    // The cast took time (it appeared as a castStart, not an instant resolve).
    expect(events.some((e) => e.type === 'castStart' && e.ability === 'flurry')).toBe(true);
    const hits = damageEvents(events, 'Winterlash');
    expect(hits).toHaveLength(3);
    const chill = mob.auras.find((a) => a.kind === 'winters_chill');
    expect(chill).toBeDefined();
    expect(chill?.charges).toBe(WINTERS_CHILL_CHARGES);
    expect(p.cooldowns.has('flurry')).toBe(true);
  });

  it('Brain Freeze makes Flurry instant, skips its cooldown, and is consumed', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    pushAura(p, { id: 'brain_freeze', name: 'Brain Freeze', kind: 'brain_freeze' });
    sim.drainEvents();
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('flurry');
    // Instant: no cast bar armed, the proc is gone, no cooldown armed.
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.kind === 'brain_freeze')).toBe(false);
    expect(p.cooldowns.has('flurry')).toBe(false);
    const events: SimEvent[] = [...sim.drainEvents()];
    for (let i = 0; i < 60 && damageEvents(events, 'Winterlash').length < 3; i++) {
      events.push(...sim.tick());
    }
    expect(damageEvents(events, 'Winterlash')).toHaveLength(3);
    expect(mob.auras.find((a) => a.kind === 'winters_chill')?.charges).toBe(WINTERS_CHILL_CHARGES);
  });

  it('an empowered Flurry hits ~30% harder than a hard cast', () => {
    const seed = 4242;
    const hardHits = (() => {
      const { sim, p } = makeSim({ seed });
      spawnTarget(sim, p);
      sim.drainEvents();
      return damageEvents(castAndResolve(sim, p, 'flurry', 'Winterlash'), 'Winterlash');
    })();
    const bfHits = (() => {
      const { sim, p } = makeSim({ seed });
      spawnTarget(sim, p);
      pushAura(p, { id: 'brain_freeze', name: 'Brain Freeze', kind: 'brain_freeze' });
      sim.drainEvents();
      return damageEvents(castAndResolve(sim, p, 'flurry', 'Winterlash'), 'Winterlash');
    })();
    expect(hardHits).toHaveLength(3);
    expect(bfHits).toHaveLength(3);
    const sum = (hits: { amount: number }[]) => hits.reduce((s, h) => s + h.amount, 0);
    // Same seed casts identical underlying rolls; the empowered set must land
    // meaningfully above the hard set (1.3x baked, before crit noise).
    expect(sum(bfHits)).toBeGreaterThan(sum(hardHits) * 1.1);
  });

  it('an armed Brain Freeze casts Flurry straight through its running cooldown', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    // Without the proc, a running cooldown refuses the cast.
    p.cooldowns.set('flurry', 10);
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('flurry');
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'error' && e.text === 'That ability is not ready yet.'),
    ).toBe(true);
    // With Brain Freeze armed, the same press goes through: instant, three
    // bolts, proc consumed, and the RUNNING timer keeps ticking (no re-arm).
    pushAura(p, { id: 'brain_freeze', name: 'Brain Freeze', kind: 'brain_freeze' });
    p.gcdRemaining = 0;
    sim.castAbility('flurry');
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.kind === 'brain_freeze')).toBe(false);
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && damageEvents(events, 'Winterlash').length < 3; i++) {
      events.push(...sim.tick());
    }
    expect(damageEvents(events, 'Winterlash')).toHaveLength(3);
    expect(mob.auras.find((a) => a.kind === 'winters_chill')?.charges).toBe(WINTERS_CHILL_CHARGES);
    const remaining = p.cooldowns.get('flurry');
    expect(remaining).toBeDefined();
    expect(remaining as number).toBeLessThan(10);
  });

  it('a blocked cast never eats Brain Freeze (consumed after every gate)', () => {
    const { sim, p } = makeSim();
    // No target at all: the cast is refused up front.
    pushAura(p, { id: 'brain_freeze', name: 'Brain Freeze', kind: 'brain_freeze' });
    sim.drainEvents();
    p.gcdRemaining = 0;
    sim.castAbility('flurry');
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'brain_freeze')).toBe(true);
  });

  it("Flurry never spends the Winter's Chill it just planted", () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    castAndResolve(sim, p, 'flurry', 'Winterlash');
    expect(mob.auras.find((a) => a.kind === 'winters_chill')?.charges).toBe(WINTERS_CHILL_CHARGES);
    // A second Flurry against the chilled target re-plants to full, not less.
    for (let i = 0; i < 20 * 10 + 1; i++) sim.tick(); // wait out the cooldown
    sim.drainEvents();
    castAndResolve(sim, p, 'flurry', 'Winterlash');
    const chill = mob.auras.find((a) => a.kind === 'winters_chill');
    expect(chill).toBeDefined();
    expect(chill?.charges).toBe(WINTERS_CHILL_CHARGES);
  });
});
