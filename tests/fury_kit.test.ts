import { describe, expect, it } from 'vitest';
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
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

// Fury-only warrior kit (operator design): Twinstrike (raging_gale), a
// charge-limited two-hit rage builder, and Red Harvest (red_harvest), an
// 80-rage three-hit spender. Both are spec-gated base kit (`specs: ['fury']`),
// and Twinstrike is the first BASE-KIT user of the multi-charge cooldown flow
// (AbilityDef.maxCharges) that the Double Charge talent row pioneered.

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function makeSim(seed = 31337, level = 20): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as unknown as TestSim;
  sim.setPlayerLevel(level);
  // Twinstrike and Red Harvest are fury-gated base kit: commit fury so a
  // no-spec warrior's hidden kit does not swallow them (spec-gating design,
  // 2026-07-07). The "live sim drops both on an arms choice" test re-specs.
  expect(sim.setSpec('fury')).toBe(true);
  // A warrior spawns seeded in Battle Stance; one tick lets the stance reconcile
  // swap it to Berserker (the Fury default) so rage mints carry no Battle bonus.
  sim.tick();
  return { sim, p: sim.player };
}

function spawnTarget(sim: TestSim, p: Entity, dz = 4): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function strikeEvents(events: SimEvent[], abilityName: string) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.ability === abilityName,
  );
}

const alloc = (spec: string | null): TalentAllocation => ({ ...emptyAllocation(), spec });
const knownIds = (spec: string | null): Set<string> =>
  new Set(
    abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior', alloc(spec))).map(
      (k) => k.def.id,
    ),
  );

describe('fury kit content defs', () => {
  it('pins Twinstrike (raging_gale): free 2-charge builder, fury only', () => {
    const def = ABILITIES.raging_gale;
    expect(def).toBeDefined();
    expect(def.name).toBe('Twinstrike');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(7);
    expect(def.cost).toBe(0);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(8);
    expect(def.maxCharges).toBe(2);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(true);
    expect(def.specs).toEqual(['fury']);
    expect(def.effects.filter((e) => e.type === 'weaponStrike')).toHaveLength(2);
    expect(def.effects).toContainEqual({ type: 'gainResource', amount: 8 });
  });

  it('pins Red Harvest (red_harvest): 80-rage GCD-only three-hit spender, fury only', () => {
    const def = ABILITIES.red_harvest;
    expect(def).toBeDefined();
    expect(def.name).toBe('Red Harvest');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(10);
    expect(def.cost).toBe(80);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(0);
    expect(def.maxCharges).toBeUndefined();
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(true);
    expect(def.specs).toEqual(['fury']);
    // Red Harvest is the hardest-hitting warrior ability: three weapon strikes
    // each carrying a +55 bonus, above every other warrior hit including
    // Maiming Strike's single wpn+40. Plus it always Enrages (owner 2026-07-08).
    expect(def.effects).toEqual([
      { type: 'weaponStrike', bonus: 55 },
      { type: 'weaponStrike', bonus: 55 },
      { type: 'weaponStrike', bonus: 55 },
      { type: 'enrageChance', chance: 1, duration: 4 },
    ]);
    const mortal = ABILITIES.mortal_strike.effects.find((e) => e.type === 'weaponStrike');
    expect(mortal?.type === 'weaponStrike' && mortal.bonus).toBe(40);
    for (const eff of def.effects) {
      if (eff.type !== 'weaponStrike') continue;
      expect(eff.bonus).toBeGreaterThan(40);
    }
  });
});

describe('Twinstrike in combat', () => {
  it('strikes twice in one cast and generates exactly 8 rage', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    p.resource = 0;
    sim.castAbility('raging_gale');
    const swings = strikeEvents(sim.drainEvents(), 'Twinstrike');
    expect(swings).toHaveLength(2);
    for (const swing of swings) expect(swing.targetId).toBe(mob.id);
    // Ability-named strikes mint no on-hit rage, so the pool is exactly the
    // gainResource rider.
    expect(p.resource).toBe(8);
  });

  it('stores two charges: back-to-back casts work, the third waits on the recharge', () => {
    const { sim, p } = makeSim();
    spawnTarget(sim, p);
    sim.drainEvents();

    sim.castAbility('raging_gale');
    expect(p.charges?.get('raging_gale')?.spent).toBe(1);
    expect(p.cooldowns.get('raging_gale')).toBe(8);

    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.charges?.get('raging_gale')?.spent).toBe(2);
    expect(strikeEvents(sim.drainEvents(), 'Twinstrike')).toHaveLength(4);

    // Both stored uses spent: the third cast is refused while recharging.
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    const events = sim.drainEvents();
    expect(strikeEvents(events, 'Twinstrike')).toHaveLength(0);
    expect(
      events.some((e) => e.type === 'error' && e.text === 'That ability is not ready yet.'),
    ).toBe(true);

    // One full recharge refunds one use and re-arms the timer for the next.
    for (let i = 0; i < 20 * 8 + 1; i++) sim.tick();
    expect(p.charges?.get('raging_gale')?.spent).toBe(1);
    p.gcdRemaining = 0;
    sim.drainEvents();
    sim.castAbility('raging_gale');
    expect(strikeEvents(sim.drainEvents(), 'Twinstrike')).toHaveLength(2);
  });
});

describe('Red Harvest in combat', () => {
  it('requires 80 rage', () => {
    const { sim, p } = makeSim();
    spawnTarget(sim, p);
    sim.drainEvents();
    p.resource = 79;
    sim.castAbility('red_harvest');
    const events = sim.drainEvents();
    expect(strikeEvents(events, 'Red Harvest')).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && e.text === 'Not enough rage!')).toBe(true);
  });

  it('spends the full 80 and strikes three times in one cast', () => {
    const { sim, p } = makeSim();
    const mob = spawnTarget(sim, p);
    sim.drainEvents();
    p.resource = 80;
    sim.castAbility('red_harvest');
    const swings = strikeEvents(sim.drainEvents(), 'Red Harvest');
    expect(swings).toHaveLength(3);
    for (const swing of swings) expect(swing.targetId).toBe(mob.id);
    expect(p.resource).toBe(0);
  });
});

describe('fury spec gating', () => {
  it('no spec knows neither; fury keeps both at 20', () => {
    // With spec-gating, a no-spec warrior sees only the shared base kit, so the
    // fury exclusives are hidden until fury is committed.
    const none = knownIds(null);
    expect(none.has('raging_gale'), 'raging_gale under no spec').toBe(false);
    expect(none.has('red_harvest'), 'red_harvest under no spec').toBe(false);
    const fury = knownIds('fury');
    expect(fury.has('raging_gale'), 'raging_gale under fury').toBe(true);
    expect(fury.has('red_harvest'), 'red_harvest under fury').toBe(true);
  });

  it('arms and prot lose both', () => {
    for (const spec of ['arms', 'prot']) {
      const ids = knownIds(spec);
      expect(ids.has('raging_gale'), `raging_gale under ${spec}`).toBe(false);
      expect(ids.has('red_harvest'), `red_harvest under ${spec}`).toBe(false);
    }
  });

  it('the live sim drops both from the known list on an arms spec choice', () => {
    const { sim } = makeSim();
    expect(sim.known.some((k) => k.def.id === 'raging_gale')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'red_harvest')).toBe(true);
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'raging_gale')).toBe(false);
    expect(sim.known.some((k) => k.def.id === 'red_harvest')).toBe(false);
  });
});

describe('determinism', () => {
  it('an identical seeded fight with both abilities replays byte-identically', () => {
    const run = (): string => {
      const { sim, p } = makeSim(7);
      const mob = spawnTarget(sim, p);
      const amounts: number[] = [];
      p.resource = 80;
      sim.castAbility('red_harvest');
      sim.castAbility('raging_gale');
      for (let i = 0; i < 20 * 3; i++) {
        p.gcdRemaining = 0;
        sim.castAbility('raging_gale');
        for (const e of sim.tick()) {
          if (e.type === 'damage') amounts.push(e.amount);
        }
      }
      return JSON.stringify([amounts, mob.hp, p.hp, p.resource]);
    };
    expect(run()).toBe(run());
  });
});
