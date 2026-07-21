// Direct unit tests for src/sim/combat/heal.ts (C2). The healing core is exercised
// by importing the module functions and calling them against a real Sim.ctx (so the
// SimContext seam, entities, players and rng are the real shared ones the engine
// uses). This proves the extracted module is callable on its own and that the moved
// behavior (the crit draw + guard order, the heal-math multiplication chain, the
// heal-absorb soak, and the healing-threat fan-out) is intact, independent of the
// parity golden.

import { describe, expect, it } from 'vitest';
import {
  applyHeal,
  consumeHealAbsorb,
  critVulnBonus,
  healingTakenMult,
  healingThreat,
  hexOutputMult,
  threatEntryMatchesEntity,
} from '../src/sim/combat/heal';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 5252): Sim {
  return new Sim({ seed, playerClass: 'priest', autoEquip: true });
}

// Construct an aura with only the fields the heal helpers read.
function aura(kind: Aura['kind'], value: number, extra: Partial<Aura> = {}): Aura {
  return {
    id: `${kind}_${value}`,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value,
    sourceId: 0,
    school: 'physical',
    ...extra,
  } as Aura;
}

// A distinct healer player (source) so it never aliases the healed target.
function addHealer(sim: Sim): AnyEntity {
  const pid = (sim as any).addPlayer('priest', 'Healer') as number;
  return (sim as any).entities.get(pid) as AnyEntity;
}

// Register a hostile mob already in combat, with an explicit hate table, so it
// qualifies as an "aware" mob for healingThreat.
function awareMob(sim: Sim, threatOn: number[]): AnyEntity {
  const p = (sim as any).player as AnyEntity;
  const mob = createMob((sim as any).nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x + 50,
    y: p.pos.y,
    z: p.pos.z + 50,
  }) as AnyEntity;
  mob.hostile = true;
  mob.inCombat = true;
  for (const id of threatOn) mob.threat.set(id, 10);
  (sim as any).addEntity(mob);
  return mob;
}

describe('heal: healingTakenMult (Mortal Wound)', () => {
  it('is 1 with no mortal_wound aura', () => {
    const sim = makeSim();
    const e = { auras: [] } as unknown as Entity;
    expect(healingTakenMult(sim.ctx, e)).toBe(1);
  });

  it('reduces by (1 - value) per mortal_wound and stacks multiplicatively', () => {
    const sim = makeSim();
    const e = {
      auras: [aura('mortal_wound', 0.5), aura('mortal_wound', 0.25)],
    } as unknown as Entity;
    expect(healingTakenMult(sim.ctx, e)).toBeCloseTo(0.5 * 0.75, 6); // 0.375
  });

  it('clamps to 0 when a stack would drive it negative', () => {
    const sim = makeSim();
    const e = { auras: [aura('mortal_wound', 1.5)] } as unknown as Entity;
    expect(healingTakenMult(sim.ctx, e)).toBe(0);
  });
});

describe('heal: hexOutputMult (Weakening Hex)', () => {
  it('is 1 for a null source', () => {
    const sim = makeSim();
    expect(hexOutputMult(sim.ctx, null)).toBe(1);
  });

  it('is 1 with no hex aura', () => {
    const sim = makeSim();
    const e = { auras: [] } as unknown as Entity;
    expect(hexOutputMult(sim.ctx, e)).toBe(1);
  });

  it('scales by (1 - value) per hex aura and stacks multiplicatively', () => {
    const sim = makeSim();
    const e = { auras: [aura('hex', 0.3), aura('hex', 0.5)] } as unknown as Entity;
    expect(hexOutputMult(sim.ctx, e)).toBeCloseTo(0.7 * 0.5, 6); // 0.35
  });

  it('clamps to 0 when a stack would drive it negative', () => {
    const sim = makeSim();
    const e = { auras: [aura('hex', 1.4)] } as unknown as Entity;
    expect(hexOutputMult(sim.ctx, e)).toBe(0);
  });
});

describe('heal: consumeHealAbsorb', () => {
  it('returns the input unchanged when healed <= 0 (no-op)', () => {
    const sim = makeSim();
    const e = { auras: [aura('heal_absorb', 100)] } as unknown as Entity;
    expect(consumeHealAbsorb(sim.ctx, e, 0)).toBe(0);
    expect(consumeHealAbsorb(sim.ctx, e, -5)).toBe(-5);
    expect((e.auras[0] as Aura).value).toBe(100); // untouched
  });

  it('returns healing unchanged when there is no heal_absorb shield', () => {
    const sim = makeSim();
    const e = { auras: [aura('hex', 0.5)] } as unknown as Entity;
    expect(consumeHealAbsorb(sim.ctx, e, 80)).toBe(80);
  });

  it('a partially-drained shield survives (no filter) with reduced budget', () => {
    const sim = makeSim();
    const shield = aura('heal_absorb', 500);
    const e = { auras: [shield] } as unknown as Entity;
    expect(consumeHealAbsorb(sim.ctx, e, 200)).toBe(0); // all 200 eaten
    expect(shield.value).toBe(300);
    expect(e.auras.length).toBe(1); // not filtered
  });

  it('a fully-drained shield depletes and is filtered out; surplus healing survives', () => {
    const sim = makeSim();
    const small = aura('heal_absorb', 200);
    const big = aura('heal_absorb', 5000);
    const e = { auras: [small, big] } as unknown as Entity;
    // 1000 healing: small eats 200 (depletes), big eats 800 (survives), 0 returns.
    expect(consumeHealAbsorb(sim.ctx, e, 1000)).toBe(0);
    expect(e.auras.some((a: Aura) => a.id === small.id)).toBe(false); // depleted + filtered
    expect(e.auras.some((a: Aura) => a.id === big.id)).toBe(true);
    expect(big.value).toBe(4200);
  });

  it('returns the surviving healing when shields cannot fully soak it', () => {
    const sim = makeSim();
    const e = { auras: [aura('heal_absorb', 30)] } as unknown as Entity;
    expect(consumeHealAbsorb(sim.ctx, e, 100)).toBe(70); // 30 soaked, 70 lands
    expect(e.auras.length).toBe(0); // shield depleted + filtered
  });
});

describe('heal: critVulnBonus (Find Weakness)', () => {
  it('is 0 with no critvuln aura', () => {
    const sim = makeSim();
    const e = { auras: [] } as unknown as Entity;
    expect(critVulnBonus(sim.ctx, e)).toBe(0);
  });

  it('reports the largest active critvuln value', () => {
    const sim = makeSim();
    const e = {
      auras: [aura('critvuln', 0.2), aura('critvuln', 0.5), aura('critvuln', 0.3)],
    } as unknown as Entity;
    expect(critVulnBonus(sim.ctx, e)).toBe(0.5);
  });
});

describe('heal: applyHeal', () => {
  it('is a no-op on a dead target AND spends no rng draw (guard precedes the crit draw)', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.dead = true;
    tgt.hp = 10;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    applyHeal(sim.ctx, src, tgt, 500, 'Heal');
    sim.rng.setObserver(null);
    expect(draws).toBe(0); // no rng spent on a dead-target heal
    expect(tgt.hp).toBe(10); // untouched
  });

  it('spends exactly one rng draw (the crit roll) on a live-target heal', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.maxHp = 10000;
    tgt.hp = 1000;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    applyHeal(sim.ctx, src, tgt, 100, 'Heal');
    sim.rng.setObserver(null);
    expect(draws).toBe(1);
  });

  it('forced crit applies the *1.5 multiplier', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.maxHp = 100000;
    tgt.hp = 1000;
    src.stats.int = 5000; // spellCrit = 0.05 + 5000*0.0008 = 4.05 -> chance always passes
    sim.drainEvents();
    applyHeal(sim.ctx, src, tgt, 1000, 'Heal');
    expect(tgt.hp).toBe(1000 + 1500); // round(1000 * 1.5)
    const ev = sim.drainEvents().find((e) => e.type === 'heal2') as any;
    expect(ev.crit).toBe(true);
    expect(ev.amount).toBe(1500);
    expect(ev.ability).toBe('Heal');
  });

  it('forced non-crit applies no crit multiplier', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.maxHp = 100000;
    tgt.hp = 1000;
    src.stats.int = -1000; // spellCrit = 0.05 - 0.8 = -0.75 -> chance always fails
    applyHeal(sim.ctx, src, tgt, 1000, 'Heal');
    expect(tgt.hp).toBe(1000 + 1000);
  });

  it('clamps healing to the missing health (overheal is free)', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.maxHp = 5000;
    tgt.hp = 4900;
    src.stats.int = -1000; // no crit, so the clamp is the only thing trimming the heal
    sim.drainEvents();
    applyHeal(sim.ctx, src, tgt, 1000, 'Heal');
    expect(tgt.hp).toBe(5000); // clamped to maxHp
    const ev = sim.drainEvents().find((e) => e.type === 'heal2') as any;
    expect(ev.amount).toBe(100); // only the effective (non-overheal) portion
  });

  it('chains crit * hex(source) * mortalWound(target) before the absorb soak', () => {
    const sim = makeSim();
    const src = sim.player as AnyEntity;
    const tgt = sim.player as AnyEntity;
    tgt.maxHp = 100000;
    tgt.hp = 1000;
    src.stats.int = 5000; // forced crit
    src.auras.push(aura('hex', 0.5)); // outgoing *0.5
    tgt.auras.push(aura('mortal_wound', 0.5)); // incoming *0.5
    tgt.auras.push(aura('heal_absorb', 100)); // soak 100 after the mults
    applyHeal(sim.ctx, src, tgt, 1000, 'Heal');
    // round(1000 * 1.5 * 0.5 * 0.5) = 375, minus 100 absorb = 275 lands.
    expect(tgt.hp).toBe(1000 + 275);
    expect(tgt.auras.some((a: Aura) => a.kind === 'heal_absorb')).toBe(false); // 100 shield depleted
  });
});

describe('heal: healingThreat fan-out', () => {
  it('does nothing when the source is not a player', () => {
    const sim = makeSim();
    const mobSrc = awareMob(sim, []); // a mob source
    const tgt = sim.player as AnyEntity;
    const m = awareMob(sim, [tgt.id]);
    healingThreat(sim.ctx, mobSrc, tgt, 500);
    expect(m.threat.has(mobSrc.id)).toBe(false);
  });

  it('does nothing when healed <= 0', () => {
    const sim = makeSim();
    const src = addHealer(sim);
    const tgt = sim.player as AnyEntity;
    const m = awareMob(sim, [tgt.id]);
    healingThreat(sim.ctx, src, tgt, 0);
    expect(m.threat.has(src.id)).toBe(false);
  });

  it('splits effective-healing threat EVENLY across every aware mob', () => {
    const sim = makeSim();
    const src = addHealer(sim);
    const tgt = sim.player as AnyEntity;
    const m1 = awareMob(sim, [tgt.id]);
    const m2 = awareMob(sim, [tgt.id]);
    const m3 = awareMob(sim, [tgt.id]);
    healingThreat(sim.ctx, src, tgt, 600);
    // total = 600 * HEAL_THREAT_FACTOR(0.5) * threatMod(src,'physical'); per = total/3.
    const per = (sim.ctx.threatMod(src, 'physical') * 600 * 0.5) / 3;
    expect(m1.threat.get(src.id) ?? 0).toBeCloseTo(per, 6);
    expect(m2.threat.get(src.id) ?? 0).toBeCloseTo(per, 6);
    expect(m3.threat.get(src.id) ?? 0).toBeCloseTo(per, 6);
  });

  it('ignores mobs that are dead / friendly / out of combat / have an empty hate table', () => {
    const sim = makeSim();
    const src = addHealer(sim);
    const tgt = sim.player as AnyEntity;
    const dead = awareMob(sim, [tgt.id]);
    dead.dead = true;
    const friendly = awareMob(sim, [tgt.id]);
    friendly.hostile = false;
    const ooc = awareMob(sim, [tgt.id]);
    ooc.inCombat = false;
    const empty = awareMob(sim, []); // threat.size === 0
    const real = awareMob(sim, [tgt.id]);
    healingThreat(sim.ctx, src, tgt, 400);
    for (const m of [dead, friendly, ooc, empty]) expect(m.threat.has(src.id)).toBe(false);
    expect(real.threat.has(src.id)).toBe(true); // the lone qualifying mob got ALL the threat
  });
});

describe('heal: threatEntryMatchesEntity', () => {
  it('matches when the entity is directly in the hate table', () => {
    const sim = makeSim();
    const tgt = sim.player as AnyEntity;
    const m = awareMob(sim, [tgt.id]);
    expect(threatEntryMatchesEntity(sim.ctx, m, tgt)).toBe(true);
  });

  it('matches a player via a hate-table entry owned by that player (pet branch)', () => {
    const sim = makeSim();
    const tgt = sim.player as AnyEntity;
    const pet = awareMob(sim, []);
    pet.ownerId = tgt.id;
    pet.hostile = false;
    const m = awareMob(sim, [pet.id]); // mob holds the PET, not the player, in its table
    expect(m.threat.has(tgt.id)).toBe(false);
    expect(threatEntryMatchesEntity(sim.ctx, m, tgt)).toBe(true);
  });

  it('does not match a player with no owned hate-table entry', () => {
    const sim = makeSim();
    const tgt = sim.player as AnyEntity;
    const other = awareMob(sim, []);
    const m = awareMob(sim, [other.id]); // holds an unrelated mob
    expect(threatEntryMatchesEntity(sim.ctx, m, tgt)).toBe(false);
  });

  it('does not fall through to the owner scan for a non-player target', () => {
    const sim = makeSim();
    const mobTarget = awareMob(sim, []);
    const m = awareMob(sim, [12345]); // some unrelated id, not the mobTarget
    expect(threatEntryMatchesEntity(sim.ctx, m, mobTarget)).toBe(false);
  });
});
