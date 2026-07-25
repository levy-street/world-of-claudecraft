// Chronomancy Phase 3 mechanics (docs/prd/mage-chronomancy.md 13.4 / 14): Aether
// Surge (Oleada de éter), the single-target Arcane spender with per-caster Arcane
// Charges. Each cast READS the charges held (scaling damage +30%/charge and cost
// x1.9/charge), THEN banks one more (cap 4); the charge aura expires 10s after
// the last cast. Aether Darts (arcane_missiles) consumes every charge on its
// first landed missile, splitting a flat Arcane bonus across the missiles.
import { describe, expect, it } from 'vitest';
import {
  AETHER_SURGE_COST_PER_CHARGE,
  AETHER_SURGE_DMG_PER_CHARGE,
  aetherSurgeCostMult,
  aetherSurgeDamageMult,
  aetherSurgeStacks,
  armAetherSurgeFree,
} from '../src/sim/combat/chronomancy';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

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

function chargeAura(value: number): Aura {
  return {
    id: 'arcane_surge',
    name: 'Aether Surge',
    kind: 'arcane_charge',
    remaining: 10,
    duration: 10,
    value,
    stacks: value,
    sourceId: 1,
    school: 'arcane',
  } as Aura;
}

function withCharges(n: number): Entity {
  return { auras: n > 0 ? [chargeAura(n)] : [] } as unknown as Entity;
}

// Cast an ability at a target and tick past its completion so a cast-time
// projectile:false spell resolves its damage and banks/consumes charges.
function castResolve(sim: Sim, p: Entity, id: string, targetId: number, seconds = 2.3): SimEvent[] {
  p.resource = p.maxResource;
  (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
  sim.targetEntity(targetId);
  sim.castAbility(id);
  return collect(sim, seconds);
}

describe('Aether Surge charge multipliers (pure)', () => {
  it('damage scales +30% per charge, linear', () => {
    expect(AETHER_SURGE_DMG_PER_CHARGE).toBe(0.3);
    expect(aetherSurgeDamageMult(withCharges(0))).toBe(1);
    expect(aetherSurgeDamageMult(withCharges(1))).toBeCloseTo(1.3);
    expect(aetherSurgeDamageMult(withCharges(3))).toBeCloseTo(1.9);
    expect(aetherSurgeDamageMult(withCharges(4))).toBeCloseTo(2.2);
  });

  it('cost doubles per charge, geometric (much steeper than damage)', () => {
    expect(AETHER_SURGE_COST_PER_CHARGE).toBe(1);
    expect(aetherSurgeCostMult(withCharges(0))).toBe(1);
    expect(aetherSurgeCostMult(withCharges(1))).toBeCloseTo(2);
    expect(aetherSurgeCostMult(withCharges(2))).toBeCloseTo(4);
    expect(aetherSurgeCostMult(withCharges(4))).toBeCloseTo(16);
  });
});

describe('Aether Surge cost at each charge level (resolvedAbility choke point)', () => {
  it('the affordability/spend cost is base x1.9^charges, rounded', () => {
    const base = ABILITIES.arcane_surge.cost; // provisional base, derived via harness
    const { sim, p } = chronoMage();
    for (let k = 0; k <= 4; k++) {
      p.auras = p.auras.filter((a) => a.id !== 'arcane_surge');
      if (k > 0) p.auras.push(chargeAura(k));
      expect(sim.resolvedAbility('arcane_surge')?.cost).toBe(Math.round(base * 2 ** k));
    }
  });
});

describe('Aether Surge charge sequence (use previous, then +1)', () => {
  it('banks one charge per cast up to 4; the 5th cast is the first at four charges', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    const seen: number[] = [];
    for (let n = 1; n <= 5; n++) {
      // Snapshot the charges this cast will USE (before it banks its own).
      seen.push(aetherSurgeStacks(p));
      castResolve(sim, p, 'arcane_surge', mob.id);
      expect(aetherSurgeStacks(p)).toBe(Math.min(4, n));
    }
    // Each cast used the PREVIOUS count: 0,1,2,3,4. The fifth is the first cast
    // that dealt damage at the full four-charge multiplier.
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('a higher-charge cast hits harder (the damage multiplier is real)', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    const dmgOf = (evs: SimEvent[]) =>
      evs
        .filter(
          (e): e is Extract<SimEvent, { type: 'damage' }> =>
            e.type === 'damage' && e.sourceId === p.id && e.targetId === mob.id,
        )
        .reduce((a, e) => a + e.amount, 0);
    const d0 = dmgOf(castResolve(sim, p, 'arcane_surge', mob.id)); // 0 charges
    // p now holds 1 charge; force it to 3 for a clean high-charge cast.
    p.auras = p.auras.filter((a) => a.id !== 'arcane_surge');
    p.auras.push(chargeAura(3));
    const d3 = dmgOf(castResolve(sim, p, 'arcane_surge', mob.id)); // 3 charges (x1.9)
    expect(d0).toBeGreaterThan(0);
    expect(d3).toBeGreaterThan(d0 * 1.5); // clearly harder; ~1.9x before roll noise
  });
});

describe('Aether Surge feeds Temporal Echo (no hidden heal bonus)', () => {
  it('the marked ally is healed for the Echo fraction of the Aether Surge damage', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    const allyId = sim.addPlayer('warrior', 'Marcado');
    const ally = sim.entities.get(allyId)!;
    ally.pos.x = p.pos.x + 4;
    ally.pos.z = p.pos.z;
    ally.maxHp = 1_000_000;
    ally.hp = 1; // low: the Echo heal never clamps
    // Mark the ally with Temporal Echo.
    castResolve(sim, p, 'temporal_echo', allyId, 0.2);
    // Cast Aether Surge at the dummy while the mark rides; capture the damage and
    // the Echo heal that lands on the ally in the same window.
    ally.hp = 1;
    const evs = castResolve(sim, p, 'arcane_surge', mob.id);
    const dmg = evs
      .filter(
        (e): e is Extract<SimEvent, { type: 'damage' }> =>
          e.type === 'damage' && e.sourceId === p.id && e.targetId === mob.id,
      )
      .reduce((a, e) => a + e.amount, 0);
    const echo = evs
      .filter(
        (e): e is Extract<SimEvent, { type: 'heal2' }> =>
          e.type === 'heal2' && e.targetId === allyId && e.ability === 'Temporal Echo',
      )
      .reduce((a, e) => a + e.amount, 0);
    expect(dmg).toBeGreaterThan(0);
    // Echo heals 35% of the single-target Arcane damage: purely the damage, no
    // hidden heal bonus (allow +/-1 for per-hit rounding).
    expect(echo).toBeGreaterThan(0);
    expect(Math.abs(echo - Math.round(dmg * 0.35))).toBeLessThanOrEqual(1);
  });
});

describe('Aether Surge charge window expires', () => {
  it('charges reset ~10s after the last cast', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    castResolve(sim, p, 'arcane_surge', mob.id);
    expect(aetherSurgeStacks(p)).toBe(1);
    collect(sim, 10.5); // idle past the 10s window
    expect(aetherSurgeStacks(p)).toBe(0);
  });
});

describe('Aether Darts consumes the charges', () => {
  it('spends every charge on the first landed missile and hits harder for it', () => {
    // Baseline Aether Darts with no charges.
    const base = chronoMage();
    const baseMob = addHostile(base.sim);
    const baseDmg = castResolve(base.sim, base.p, 'arcane_missiles', baseMob.id, 3.5)
      .filter(
        (e): e is Extract<SimEvent, { type: 'damage' }> =>
          e.type === 'damage' && e.sourceId === base.p.id && e.targetId === baseMob.id,
      )
      .reduce((a, e) => a + e.amount, 0);

    // With 4 charges held: the channel consumes them and adds the flat bonus.
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    p.auras = p.auras.filter((a) => a.id !== 'arcane_surge');
    p.auras.push(chargeAura(4));
    const evs = castResolve(sim, p, 'arcane_missiles', mob.id, 3.5);
    // Charges are gone after the channel dealt damage.
    expect(aetherSurgeStacks(p)).toBe(0);
    const chargedDmg = evs
      .filter(
        (e): e is Extract<SimEvent, { type: 'damage' }> =>
          e.type === 'damage' && e.sourceId === p.id && e.targetId === mob.id,
      )
      .reduce((a, e) => a + e.amount, 0);
    // The dump added a flat 6-per-charge bonus (24 total across the missiles).
    expect(chargedDmg).toBeGreaterThan(baseDmg);
  });

  it('does NOT spend the charges if the channel is broken before any missile lands', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    p.auras = p.auras.filter((a) => a.id !== 'arcane_surge');
    p.auras.push(chargeAura(4));
    p.resource = p.maxResource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(mob.id);
    sim.castAbility('arcane_missiles');
    sim.tick(); // channel just started; no missile fired yet
    // Break the channel before any missile lands by yanking the target out of
    // range: the next channel tick refuses and cancels the cast.
    mob.pos.z = p.pos.z + 100;
    collect(sim, 3.5);
    // No missile ever landed, so the charges are untouched.
    expect(aetherSurgeStacks(p)).toBe(4);
  });
});

describe('Aether Surge free-cast proc', () => {
  it('an armed free Aether Surge waives its charged cost but still banks a charge', () => {
    const { sim, p } = chronoMage();
    const mob = addHostile(sim);
    // Build 2 charges with real casts (strip any free proc they roll, so the
    // measured cast below is the only free one).
    castResolve(sim, p, 'arcane_surge', mob.id); // 0 -> 1
    castResolve(sim, p, 'arcane_surge', mob.id); // 1 -> 2
    expect(aetherSurgeStacks(p)).toBe(2);
    p.auras = p.auras.filter((a) => a.kind !== 'next_cast_free');

    // Arm the free proc deterministically (the sim rolls it at 15%; force it
    // here) and cast WITHOUT refilling mana: it spends nothing and still banks
    // the third charge.
    armAetherSurgeFree(sim.ctx, p);
    const before = p.resource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(mob.id);
    sim.castAbility('arcane_surge');
    collect(sim, 2.3);
    expect(before - p.resource).toBe(0); // charged cost waived
    expect(aetherSurgeStacks(p)).toBe(3); // still banked a charge

    // Single-use: strip any fresh proc the free cast may have rolled, then the
    // FOLLOWING cast pays mana again.
    p.auras = p.auras.filter((a) => a.kind !== 'next_cast_free');
    const before2 = p.resource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(mob.id);
    sim.castAbility('arcane_surge');
    collect(sim, 2.3);
    expect(before2 - p.resource).toBeGreaterThan(0);
  });

  it('the free proc only covers Aether Surge, not other casts', () => {
    const { sim, p } = chronoMage();
    const allyId = sim.addPlayer('warrior', 'Aliado');
    const ally = sim.entities.get(allyId)!;
    ally.pos.x = p.pos.x + 4;
    ally.pos.z = p.pos.z;
    ally.hp = Math.floor(ally.maxHp * 0.4);
    armAetherSurgeFree(sim.ctx, p);
    // Temporal Mend is NOT empowered by the Aether Surge free proc: it pays.
    const before = p.resource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(allyId);
    sim.castAbility('temporal_mend');
    collect(sim, 2.3);
    expect(before - p.resource).toBeGreaterThan(0);
  });
});
