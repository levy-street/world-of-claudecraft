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

// Revenge (Batch 2026-07-08): Protection's frontal-arc filler that REPLACES
// Reaver Strike (heroic_strike excludeSpecs ['prot'] + revenge specs ['prot']).
// It is a frontal aoeDamage with a soft target cap (softCap 5: above 5 targets
// the TOTAL is held to 5x per-target) and a defensive proc: a dodge or parry
// against the warrior has a 30% chance to make the next Revenge free
// (the revenge_free aura, applied in mobSwing, consumed via empower_next.ts).

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
};

function makeSim(
  seed = 4242,
  spec: string | null = 'prot',
  level = 20,
): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as unknown as TestSim;
  sim.setPlayerLevel(level);
  if (spec) expect(sim.setSpec(spec)).toBe(true);
  return { sim, p: sim.player };
}

function spawnMob(sim: TestSim, p: Entity, dx: number, dz: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x + dx,
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

const alloc = (spec: string | null): TalentAllocation => ({ ...emptyAllocation(), spec });
const knownIds = (spec: string | null): Set<string> =>
  new Set(
    abilitiesKnownAt('warrior', 20, computeTalentModifiers('warrior', alloc(spec))).map(
      (k) => k.def.id,
    ),
  );

describe('(a) Revenge content def + Reaver Strike exclusion', () => {
  it('pins Revenge: prot-only, cost 20, learnLevel 7, frontal aoe with softCap 5', () => {
    const def = ABILITIES.revenge;
    expect(def).toBeDefined();
    expect(def.name).toBe('Revenge');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(7);
    expect(def.cost).toBe(20);
    expect(def.cooldown).toBe(0);
    expect(def.castTime).toBe(0);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.specs).toEqual(['prot']);
    expect(def.effects).toEqual([
      { type: 'aoeDamage', min: 18, max: 24, radius: 8, frontal: true, softCap: 5 },
    ]);
  });

  it('Reaver Strike stays ungated but carries excludeSpecs ["prot","arms","fury"]', () => {
    expect(ABILITIES.heroic_strike.specs).toBeUndefined();
    // 2026-07-08: Reaver Strike is now excluded for every committed spec (arms and
    // fury dropped it too); only no-spec keeps it.
    expect(ABILITIES.heroic_strike.excludeSpecs).toEqual(['prot', 'arms', 'fury']);
  });
});

describe('(b) excludeSpecs / spec gating', () => {
  it('committed prot knows Revenge and not Reaver Strike; no-spec/arms/fury never gain Revenge', () => {
    const prot = knownIds('prot');
    expect(prot.has('revenge')).toBe(true);
    expect(prot.has('heroic_strike')).toBe(false);
    for (const spec of [null, 'arms', 'fury'] as const) {
      const ids = knownIds(spec);
      expect(ids.has('revenge'), `${spec} revenge`).toBe(false);
    }
    // Reaver Strike now drops for every committed spec (excludeSpecs
    // ['prot','arms','fury']), so only no-spec keeps it.
    expect(knownIds(null).has('heroic_strike')).toBe(true);
    expect(knownIds('fury').has('heroic_strike')).toBe(false);
    expect(knownIds('arms').has('heroic_strike')).toBe(false);
  });
});

describe('(c) frontal arc + soft target cap', () => {
  it('hits every enemy in the frontal arc but not one behind the caster', () => {
    const { sim, p } = makeSim();
    p.facing = 0; // facing +z
    const front1 = spawnMob(sim, p, 0, 4);
    const front2 = spawnMob(sim, p, 3, 4);
    const behind = spawnMob(sim, p, 0, -4);
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('revenge');

    expect(front1.hp).toBeLessThan(front1.maxHp);
    expect(front2.hp).toBeLessThan(front2.maxHp);
    expect(behind.hp).toBe(behind.maxHp); // outside the melee facing arc
  });

  it('soft-caps the TOTAL above 5 targets: per-target damage scales down', () => {
    // Five targets in the arc: uncapped, each takes a full rolled hit.
    const five = makeSim(9001);
    five.p.facing = 0;
    const fiveMobs = [2, 3, 4, 5, 6].map((dz) => spawnMob(five.sim, five.p, 0, dz));
    five.p.resource = 100;
    five.sim.drainEvents();
    five.sim.castAbility('revenge');
    const fiveDealt = fiveMobs.map((m) => m.maxHp - m.hp);
    const fiveTotal = fiveDealt.reduce((a, b) => a + b, 0);
    const fiveAvg = fiveTotal / fiveMobs.length;
    for (const d of fiveDealt) expect(d).toBeGreaterThan(0);

    // Ten targets in the arc: capScale = 5/10 = 0.5, so each hit is halved and
    // the TOTAL is held near the 5-target total instead of doubling it.
    const ten = makeSim(9001);
    ten.p.facing = 0;
    const tenMobs = [2, 3, 4, 5, 6, 7, 7.5, 6.5, 5.5, 4.5].map((dz) =>
      spawnMob(ten.sim, ten.p, 0, dz),
    );
    ten.p.resource = 100;
    ten.sim.drainEvents();
    ten.sim.castAbility('revenge');
    const tenDealt = tenMobs.map((m) => m.maxHp - m.hp);
    const tenTotal = tenDealt.reduce((a, b) => a + b, 0);
    const tenAvg = tenTotal / tenMobs.length;
    for (const d of tenDealt) expect(d).toBeGreaterThan(0);

    // Per-target damage is scaled down (roughly halved) vs the 5-target cast.
    expect(tenAvg).toBeLessThan(fiveAvg * 0.7);
    // The TOTAL is capped: 10 targets do NOT deal ~2x the 5-target total; they
    // land within ~15% of it (would be ~2x without the cap).
    expect(tenTotal).toBeLessThan(fiveTotal * 1.15);
    expect(tenTotal).toBeGreaterThan(fiveTotal * 0.85);
  });
});

// Drive mob swings against the warrior until the revenge_free proc lands (or a
// bounded number of dodges elapse). dodgeChance = 1 forces the avoid branch, so
// every swing rolls the 30% proc; deterministic for a fixed seed.
function procRevengeFree(sim: TestSim, p: Entity, mob: Entity, maxSwings = 80): boolean {
  p.dodgeChance = 1;
  for (let i = 0; i < maxSwings; i++) {
    sim.mobSwing(mob, p);
    if (p.auras.some((a) => a.kind === 'revenge_free')) return true;
  }
  return false;
}

describe('(d) dodge/parry -> free-cost proc', () => {
  it('a prot warrior who dodges an incoming swing can proc revenge_free, and a free Revenge spends 0 rage', () => {
    const { sim, p } = makeSim(31);
    const attacker = spawnMob(sim, p, 0, 3);
    p.facing = 0;
    sim.drainEvents();

    expect(procRevengeFree(sim, p, attacker)).toBe(true);
    const proc = p.auras.find((a) => a.kind === 'revenge_free');
    expect(proc).toBeDefined();
    expect(proc?.id).toBe('revenge_free');

    // A free Revenge: cast on an EMPTY rage bar, it still fires and spends 0.
    p.resource = 0;
    p.gcdRemaining = 0;
    sim.drainEvents();
    sim.castAbility('revenge');
    expect(attacker.hp).toBeLessThan(attacker.maxHp); // the cast landed
    expect(p.resource).toBe(0); // nothing spent (free proc)
    expect(p.auras.some((a) => a.kind === 'revenge_free')).toBe(false); // aura consumed
  });

  it('a non-prot warrior never gets the proc (does not know Revenge)', () => {
    const { sim, p } = makeSim(31, 'fury');
    const attacker = spawnMob(sim, p, 0, 3);
    sim.drainEvents();
    // Fury never knows Revenge, so no dodge ever arms the free-cost aura.
    p.dodgeChance = 1;
    for (let i = 0; i < 120; i++) {
      sim.mobSwing(attacker, p);
      expect(p.auras.some((a) => a.kind === 'revenge_free')).toBe(false);
    }
  });

  it('without the proc, Revenge on an empty bar is refused for lack of rage', () => {
    const { sim, p } = makeSim(5);
    spawnMob(sim, p, 0, 4);
    p.facing = 0;
    p.resource = 0;
    p.gcdRemaining = 0;
    expect(p.auras.some((a) => a.kind === 'revenge_free')).toBe(false);
    sim.drainEvents();
    sim.castAbility('revenge');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'Not enough rage!')).toBe(true);
  });
});

describe('(e) determinism', () => {
  it('a short prot fight including a dodge replays byte-identically', () => {
    const run = (): string => {
      const { sim, p } = makeSim(77);
      const mob = spawnMob(sim, p, 0, 4);
      p.facing = 0;
      const amounts: number[] = [];
      const record = (events: SimEvent[]) => {
        for (const e of events) {
          if (e.type === 'damage') amounts.push(e.amount);
        }
      };
      sim.drainEvents();
      // Force several dodges (arming the proc), then cast Revenge, then settle.
      p.dodgeChance = 1;
      for (let i = 0; i < 10; i++) {
        sim.mobSwing(mob, p);
        record(sim.drainEvents());
      }
      p.resource = 100;
      p.gcdRemaining = 0;
      sim.castAbility('revenge');
      record(sim.drainEvents());
      for (let i = 0; i < 20 * 4; i++) record(sim.tick());
      return JSON.stringify([amounts, mob.hp, p.hp, p.resource, p.auras.map((a) => a.id).sort()]);
    };
    expect(run()).toBe(run());
  });
});
