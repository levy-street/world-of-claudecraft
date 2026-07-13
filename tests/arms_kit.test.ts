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

// Arms kit (operator design): the last two warrior abilities, both arms-only.
// Breachmaker (breachmaker), a modest weapon strike that stamps a SOURCE-SCOPED
// vulnerability (aura kind 'vuln_source', id 'breachmaker_vuln') on the target:
// only the CASTER's own damage against that target is amplified 20% for 8 sec,
// unlike the raid-wide 'vulnerability' curse. Measured Fury (measured_fury), a
// PASSIVE that makes every one of the caster's abilities cost 10% less rage,
// folded at the resolvedAbility cost choke point while the passive is known
// (spec-gated to arms, so automatically arms-only) and never castable.

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

function makeSim(spec: string, seed = 4242, level = 20): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as unknown as TestSim;
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
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

function spawnTarget(sim: TestSim, p: Entity, dz = 3): Entity {
  const mob = spawnMob(sim, p, dz);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
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

const ARMS_IDS = ['breachmaker', 'measured_fury'] as const;

describe('(a) arms kit content defs', () => {
  it('pins Breachmaker: 10 rage, 45 sec cooldown, arms only, a weapon strike plus a source-scoped 20% vuln for 8 sec', () => {
    const def = ABILITIES.breachmaker;
    expect(def).toBeDefined();
    expect(def.name).toBe('Breachmaker');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(12);
    expect(def.cost).toBe(10);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(45);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(true);
    expect(def.specs).toEqual(['arms']);
    // Not a passive: a real, castable strike.
    expect(def.passive).toBeUndefined();
    expect(def.effects).toEqual([
      { type: 'weaponStrike', bonus: 15 },
      {
        type: 'debuffTargetSource',
        kind: 'vuln_source',
        value: 0.2,
        duration: 8,
        auraId: 'breachmaker_vuln',
        auraName: 'Breachmaker',
      },
    ]);
  });

  it('pins Measured Fury: free passive, level 5, arms only, no cooldown', () => {
    const def = ABILITIES.measured_fury;
    expect(def).toBeDefined();
    expect(def.name).toBe('Measured Fury');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(5);
    expect(def.cost).toBe(0);
    expect(def.castTime).toBe(0);
    expect(def.cooldown).toBe(0);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.specs).toEqual(['arms']);
    expect(def.passive).toBe(true);
    expect(def.effects).toEqual([]);
  });
});

describe('(b) Breachmaker: source-scoped vulnerability on the target', () => {
  it('amplifies ONLY the caster damage on the debuffed mob by 20%, leaves a second attacker unchanged, and expires after 8 sec', () => {
    const { sim, p } = makeSim('arms');
    const mob = spawnTarget(sim, p);
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('breachmaker');

    // The debuff is on the TARGET, carries the CASTER's id, and is source-scoped.
    const vuln = mob.auras.find((a) => a.id === 'breachmaker_vuln');
    expect(vuln).toBeDefined();
    expect(vuln?.kind).toBe('vuln_source');
    expect(vuln?.name).toBe('Breachmaker');
    expect(vuln?.value).toBe(0.2);
    expect(vuln?.duration).toBe(8);
    expect(vuln?.sourceId).toBe(p.id);

    // Same-seed control WITHOUT the debuff: a 100 hit lands for exactly 100.
    const control = (() => {
      const c = makeSim('arms');
      const cmob = spawnMob(c.sim, c.p, 3);
      cmob.hp = cmob.maxHp;
      hit(c.sim, c.p, cmob, 100);
      return cmob.maxHp - cmob.hp;
    })();
    expect(control).toBe(100);

    // The caster's next hit on the debuffed mob is 20% harder (120 vs 100).
    mob.hp = mob.maxHp;
    hit(sim, p, mob, 100);
    expect(mob.maxHp - mob.hp).toBe(120);

    // A SEPARATE attacker's hit on the same mob is UNCHANGED (proves scoping).
    const otherId = sim.addPlayer('warrior', 'Other');
    const other = sim.entities.get(otherId)!;
    mob.hp = mob.maxHp;
    hit(sim, other, mob, 100);
    expect(mob.maxHp - mob.hp).toBe(100);

    // After 8 sec the debuff is gone and the caster's hit lands in full again.
    for (let i = 0; i < 20 * 9; i++) sim.tick();
    expect(mob.auras.some((a) => a.id === 'breachmaker_vuln')).toBe(false);
    mob.hp = mob.maxHp;
    hit(sim, p, mob, 100);
    expect(mob.maxHp - mob.hp).toBe(100);
  });
});

describe('(c) Measured Fury: 10% cheaper rage abilities, arms only, never castable', () => {
  it('discounts a rage ability 10% for arms but not for fury, and is itself not castable', () => {
    const { sim: arms } = makeSim('arms');
    const { sim: fury, p: furyP } = makeSim('fury', 99);

    // The passive is known by arms (base kit) but not by fury (spec-gated).
    expect(arms.known.some((k) => k.def.id === 'measured_fury')).toBe(true);
    expect(fury.known.some((k) => k.def.id === 'measured_fury')).toBe(false);

    // Same ungated staple (Hobbling Cut / hamstring, 10 rage), known to both: arms
    // pays 10% less, fury full. (Execute can no longer serve here: Fury's Early
    // Grave became a free rage builder 2026-07-08, so it shows no cost to discount.)
    const base = fury.resolvedAbility('hamstring')!.cost;
    expect(base).toBe(10);
    expect(arms.resolvedAbility('hamstring')!.cost).toBe(Math.max(0, Math.round(base * 0.9)));

    // The task's concrete example: Maiming Strike is 30 rage, 27 under the passive.
    expect(ABILITIES.mortal_strike.cost).toBe(30);
    expect(arms.resolvedAbility('mortal_strike')!.cost).toBe(27);
    // Fury lacks the passive, so the shared staple stays at its full, undiscounted
    // cost for it. Arms pays 10% less.
    expect(fury.resolvedAbility('hamstring')!.cost).toBe(10);
    expect(fury.resolvedAbility('hamstring')!.cost).toBeGreaterThan(
      arms.resolvedAbility('hamstring')!.cost,
    );

    // Casting the passive is a silent no-op: no GCD, no resource change, no events.
    const armsP = arms.player;
    armsP.gcdRemaining = 0;
    armsP.resource = 50;
    arms.drainEvents();
    arms.castAbility('measured_fury');
    expect(armsP.gcdRemaining).toBe(0);
    expect(armsP.resource).toBe(50);
    expect(arms.drainEvents().length).toBe(0);

    // And nothing in fury's world changed either.
    expect(furyP.gcdRemaining).toBe(0);
  });
});

describe('(d) spec gating', () => {
  it('arms knows both; no-spec, fury, and prot know neither', () => {
    // Spec-gating (2026-07-07): a no-spec warrior sees only the shared base kit,
    // so the arms exclusives are hidden until arms is committed.
    for (const id of ARMS_IDS) {
      expect(knownIds('arms').has(id), `${id} (arms)`).toBe(true);
      expect(knownIds(null).has(id), `${id} (no spec)`).toBe(false);
      expect(knownIds('fury').has(id), `${id} (fury)`).toBe(false);
      expect(knownIds('prot').has(id), `${id} (prot)`).toBe(false);
    }
  });
});

describe('(e) determinism', () => {
  it('an identical seeded Breachmaker fight replays byte-identically', () => {
    const run = (): string => {
      const { sim, p } = makeSim('arms', 77);
      const mob = spawnTarget(sim, p);
      const amounts: number[] = [];
      const record = (events: SimEvent[]) => {
        for (const e of events) {
          if (e.type === 'damage') amounts.push(e.amount);
          if (e.type === 'heal2') amounts.push(-e.amount);
        }
      };
      sim.drainEvents();
      p.resource = 100;
      sim.castAbility('breachmaker');
      record(sim.drainEvents());
      for (let i = 0; i < 20 * 10; i++) record(sim.tick());
      return JSON.stringify([amounts, mob.hp, p.hp, p.resource, mob.auras.map((a) => a.id)]);
    };
    expect(run()).toBe(run());
  });
});
