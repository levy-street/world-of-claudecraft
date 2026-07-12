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
import type { Entity, SimEvent } from '../src/sim/types';
import { absorbBarView, absorbTotal } from '../src/ui/absorb_bar';

// Protection kit (operator design): Raised Guard (raised_guard), an off-GCD
// 6 sec 50% PHYSICAL damage cut (the buff_dr_phys sibling of Furious Mending's
// buff_dr, read at the same combat/damage.ts fold but gated on the school);
// Iron Resolve (iron_resolve), the first spendsAllResource ability: cost is
// the 20-rage minimum, casting spends up to 40 rage (its spendResourceCap) and
// grants a priest-style 'absorb' shield of 4 damage per rage spent for up to
// 10 sec; Faultline
// (faultline), a frontal-arc (MELEE_ARC) 8 yd aoe slam that also stuns for
// 3 sec; Defiant Bellow (defiant_bellow), an aoe taunt fanning the SHARED
// applyTaunt entry over every hostile mob within 10 yd. All four are
// spec-gated base kit (`specs: ['prot']`).

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

type DealDamage = {
  dealDamage(
    source: Entity,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string,
    kind: string,
  ): void;
};

function makeSim(seed = 4242, level = 20): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as unknown as TestSim;
  sim.setPlayerLevel(level);
  expect(sim.setSpec('prot')).toBe(true);
  sim.player.equippedItems.offhand = 'eastbrook_buckler'; // shield abilities now require one
  return { sim, p: sim.player };
}

function spawnMob(sim: TestSim, p: Entity, dz: number): Entity {
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
  return mob;
}

function hit(sim: TestSim, source: Entity, target: Entity, amount: number, school = 'physical') {
  (sim as unknown as DealDamage).dealDamage(
    source,
    target,
    amount,
    false,
    school,
    'Test Hit',
    'hit',
  );
}

const alloc = (spec: string | null): TalentAllocation => ({ ...emptyAllocation(), spec });
const knownIds = (spec: string | null): Set<string> =>
  new Set(
    abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior', alloc(spec))).map(
      (k) => k.def.id,
    ),
  );

const PROT_IDS = ['raised_guard', 'iron_resolve', 'faultline', 'defiant_bellow'] as const;

describe('(a) prot kit content defs', () => {
  it('pins Raised Guard: off-GCD 15 rage, 12 sec cooldown, 6 sec 50% physical-only cut', () => {
    const def = ABILITIES.raised_guard;
    expect(def).toBeDefined();
    expect(def.name).toBe('Raised Guard');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(8);
    expect(def.cost).toBe(15);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(12);
    expect(def.maxCharges).toBe(2); // stores up to 2 charges (Batch 2026-07-08)
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.offGcd).toBe(true);
    expect(def.specs).toEqual(['prot']);
    expect(def.effects).toEqual([
      {
        type: 'selfBuff',
        kind: 'buff_dr_phys',
        value: 0.5,
        duration: 6,
        auraId: 'raised_guard_dr',
        auraName: 'Raised Guard',
      },
    ]);
  });

  it('pins Iron Resolve: spend-all with a 20 rage minimum, 15 sec cooldown, 4x absorb up to 10 sec', () => {
    const def = ABILITIES.iron_resolve;
    expect(def).toBeDefined();
    expect(def.name).toBe('Iron Resolve');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(14);
    // `cost` is the MINIMUM cast gate; spendsAllResource bills the bar up to
    // spendResourceCap (40 rage), snapshotted in casting_lifecycle.
    expect(def.cost).toBe(20);
    expect(def.spendsAllResource).toBe(true);
    expect(def.spendResourceCap).toBe(40);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(15);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.specs).toEqual(['prot']);
    expect(def.effects).toEqual([{ type: 'absorbSpentResource', mult: 4, duration: 10 }]);
  });

  it('pins Faultline: 15 rage, 30 sec cooldown, frontal 8 yd aoe plus a 3 sec stun', () => {
    const def = ABILITIES.faultline;
    expect(def).toBeDefined();
    expect(def.name).toBe('Faultline');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(14);
    expect(def.cost).toBe(15);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(30);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.specs).toEqual(['prot']);
    expect(def.effects).toEqual([
      { type: 'aoeDamage', min: 15, max: 20, radius: 8, frontal: true, stunSec: 3 },
    ]);
  });

  it('pins Defiant Bellow: free 1 min cooldown, 10 yd aoe taunt', () => {
    const def = ABILITIES.defiant_bellow;
    expect(def).toBeDefined();
    expect(def.name).toBe('Defiant Bellow');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(12);
    expect(def.cost).toBe(0);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(60);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.specs).toEqual(['prot']);
    expect(def.effects).toEqual([{ type: 'aoeTaunt', radius: 10 }]);
  });
});

describe('(b) Raised Guard halves physical damage only, for 6 sec', () => {
  it('cuts a physical hit in half, leaves a spell hit untouched, and expires after 6 sec', () => {
    const { sim, p } = makeSim();
    const mob = spawnMob(sim, p, 5);
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('raised_guard');

    const dr = p.auras.find((a) => a.id === 'raised_guard_dr');
    expect(dr).toBeDefined();
    expect(dr?.kind).toBe('buff_dr_phys');
    expect(dr?.name).toBe('Raised Guard');
    expect(dr?.value).toBe(0.5);
    expect(dr?.duration).toBe(6);
    expect(p.resource).toBe(85); // 15 rage spent

    // Physical hit: halved.
    p.hp = p.maxHp;
    hit(sim, mob, p, 100, 'physical');
    expect(p.maxHp - p.hp).toBe(50);

    // Spell hit: NOT reduced (physical-only, unlike the generic buff_dr).
    p.hp = p.maxHp;
    hit(sim, mob, p, 100, 'fire');
    expect(p.maxHp - p.hp).toBe(100);

    // After 7 sec the buff is gone and physical damage lands in full again.
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(p.auras.some((a) => a.id === 'raised_guard_dr')).toBe(false);
    p.hp = p.maxHp;
    hit(sim, mob, p, 100, 'physical');
    expect(p.maxHp - p.hp).toBe(100);
  });
});

describe('(c) Iron Resolve spends up to 40 rage into a damage-absorb shield', () => {
  it('refuses to cast below the 20 rage minimum', () => {
    const { sim, p } = makeSim();
    p.resource = 10;
    sim.drainEvents();
    sim.castAbility('iron_resolve');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'Not enough rage!')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'absorb')).toBe(false);
    expect(p.resource).toBe(10); // nothing spent on the refused cast
  });

  it('caps the spend at 40 rage (leaving the rest) and absorbs spent x 4, then overflow lands', () => {
    const { sim, p } = makeSim();
    const mob = spawnMob(sim, p, 5);
    p.resource = 60; // above the 40 cap
    sim.drainEvents();
    sim.castAbility('iron_resolve');

    expect(p.resource).toBe(20); // 60 - 40 cap, NOT drained to 0
    const shield = p.auras.find((a) => a.kind === 'absorb');
    expect(shield).toBeDefined();
    expect(shield?.id).toBe('iron_resolve');
    expect(shield?.name).toBe('Iron Resolve');
    expect(shield?.value).toBe(160); // 40 rage (the cap) x 4
    expect(shield?.duration).toBe(10);

    // The shield rides the existing absorb-bar plumbing (tests/absorb_bar.test.ts).
    expect(absorbTotal(p.auras)).toBe(160);
    const view = absorbBarView({ hp: p.hp, maxHp: p.maxHp, auras: p.auras });
    expect(view.total).toBe(160);

    // A 100 hit is fully soaked; the shield shrinks by exactly that amount.
    p.hp = p.maxHp;
    hit(sim, mob, p, 100, 'physical');
    expect(p.maxHp - p.hp).toBe(0);
    expect(p.auras.find((a) => a.kind === 'absorb')?.value).toBe(60);

    // A 200 hit drains the remaining 60 and the 140 overflow lands on health.
    sim.drainEvents();
    hit(sim, mob, p, 200, 'physical');
    expect(p.maxHp - p.hp).toBe(140);
    expect(p.auras.some((a) => a.kind === 'absorb')).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'aura' && e.name === 'Iron Resolve' && e.gained === false),
    ).toBe(true);
  });

  it('below the 40 cap it spends everything it has (30 rage absorbs 120)', () => {
    const { sim, p } = makeSim();
    p.resource = 30; // under the cap
    sim.drainEvents();
    sim.castAbility('iron_resolve');
    expect(p.resource).toBe(0); // whole bar, since 30 < 40 cap
    expect(p.auras.find((a) => a.kind === 'absorb')?.value).toBe(120); // 30 x 4
  });

  it('casting at exactly the 20 rage minimum absorbs 80', () => {
    const { sim, p } = makeSim();
    p.resource = 20;
    sim.drainEvents();
    sim.castAbility('iron_resolve');
    expect(p.resource).toBe(0);
    expect(p.auras.find((a) => a.kind === 'absorb')?.value).toBe(80);
  });
});

describe('(d) Faultline hits and stuns only enemies in the frontal arc', () => {
  it('damages and stuns a mob in front but not one behind the caster', () => {
    const { sim, p } = makeSim();
    const front = spawnMob(sim, p, 4);
    const behind = spawnMob(sim, p, -4);
    p.facing = 0; // facing +z, straight at `front`; `behind` sits at pi
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('faultline');

    // Front mob: damage landed and the paired stun is worn.
    expect(front.hp).toBeLessThan(front.maxHp);
    const stun = front.auras.find((a) => a.kind === 'stun');
    expect(stun).toBeDefined();
    expect(stun?.id).toBe('faultline_stun');
    expect(stun?.name).toBe('Faultline');
    expect(stun?.duration).toBe(3); // vs a mob: no PvP DR shortening

    // Behind mob: untouched, no stun.
    expect(behind.hp).toBe(behind.maxHp);
    expect(behind.auras.some((a) => a.kind === 'stun')).toBe(false);
  });
});

describe('(e) Defiant Bellow taunts every nearby hostile mob onto the caster', () => {
  it('lifts threat to the top and forces two nearby mobs onto the caster, but not a far one', () => {
    const { sim, p } = makeSim();
    const near1 = spawnMob(sim, p, 4);
    const near2 = spawnMob(sim, p, -6);
    const far = spawnMob(sim, p, 40);
    // Another player already leads near1's hate table; the taunt must match it.
    const otherId = sim.addPlayer('priest', 'Tanky');
    near1.threat.set(otherId, 50);

    sim.drainEvents();
    sim.castAbility('defiant_bellow');

    // near1: threat lifted to (at least) the table's top (the initial-aggro
    // pip may add 1 on top), forced onto the caster.
    expect(near1.threat.get(p.id) ?? 0).toBeGreaterThanOrEqual(50);
    expect(near1.threat.get(p.id) ?? 0).toBeGreaterThanOrEqual(near1.threat.get(otherId) ?? 0);
    expect(near1.forcedTargetId).toBe(p.id);
    expect(near1.aggroTargetId).toBe(p.id);
    // near2: empty table, the taunt floor (plus the initial-aggro pip) still
    // lands the mob on us.
    expect(near2.threat.get(p.id) ?? 0).toBeGreaterThanOrEqual(1);
    expect(near2.forcedTargetId).toBe(p.id);
    expect(near2.aggroTargetId).toBe(p.id);
    // far (40 yd): out of the 10 yd radius, completely untouched.
    expect(far.threat.get(p.id)).toBeUndefined();
    expect(far.forcedTargetId).toBeNull();
  });
});

describe('(f) spec gating', () => {
  it('prot knows all four; no-spec, arms, and fury know none', () => {
    // Spec-gating (2026-07-07): a no-spec warrior sees only the shared base kit,
    // so the prot exclusives are hidden until prot is committed.
    for (const id of PROT_IDS) {
      expect(knownIds('prot').has(id), `${id} (prot)`).toBe(true);
      expect(knownIds(null).has(id), `${id} (no spec)`).toBe(false);
      expect(knownIds('arms').has(id), `${id} (arms)`).toBe(false);
      expect(knownIds('fury').has(id), `${id} (fury)`).toBe(false);
    }
  });
});

describe('(g) determinism', () => {
  it('an identical seeded prot rotation replays byte-identically', () => {
    const run = (): string => {
      const { sim, p } = makeSim(77);
      const front = spawnMob(sim, p, 4);
      const behind = spawnMob(sim, p, -6);
      p.facing = 0;
      const amounts: number[] = [];
      const record = (events: SimEvent[]) => {
        for (const e of events) {
          if (e.type === 'damage') amounts.push(e.amount);
          if (e.type === 'heal2') amounts.push(-e.amount);
        }
      };
      sim.drainEvents();
      p.resource = 100;
      sim.castAbility('raised_guard');
      record(sim.drainEvents());
      p.gcdRemaining = 0;
      sim.castAbility('faultline');
      record(sim.drainEvents());
      p.gcdRemaining = 0;
      p.resource = 45;
      sim.castAbility('iron_resolve');
      record(sim.drainEvents());
      p.gcdRemaining = 0;
      sim.castAbility('defiant_bellow');
      record(sim.drainEvents());
      for (let i = 0; i < 20 * 12; i++) record(sim.tick());
      return JSON.stringify([
        amounts,
        front.hp,
        behind.hp,
        p.hp,
        p.resource,
        p.auras.map((a) => a.id),
        front.threat.get(p.id) ?? null,
        behind.threat.get(p.id) ?? null,
      ]);
    };
    expect(run()).toBe(run());
  });
});
