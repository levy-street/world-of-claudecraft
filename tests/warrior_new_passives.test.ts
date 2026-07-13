// New warrior passives (owner 2026-07-09): Arms Seasoned Soldier (crit autos mint
// +10% rage) and the reworked Arms mastery Master Armorer (+10% damage with a
// two-handed weapon). Fury passives land in follow-up commits.

import { describe, expect, it } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { ENRAGE_DMG_DONE, MAX_LEVEL, SUDDEN_DEATH_CHANCE } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

function requireMeta(sim: Sim, pid: number) {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`Missing player meta ${pid}`);
  return meta;
}

function makeWarrior(spec: string | null): { sim: AnySim; p: Entity; mob: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(MAX_LEVEL);
  if (spec) expect(sim.setSpec(spec)).toBe(true);
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = 1e7;
  mob.hp = 1e7;
  mob.hostile = true;
  sim.addEntity(mob);
  return { sim, p, mob };
}

// Rage minted by one auto-attack hit of a FIXED amount (isolating the crit factor
// from the crit's own 2x damage), via dealDamage's auto-attack rage block.
function autoRage(sim: AnySim, p: Entity, mob: Entity, crit: boolean): number {
  p.resource = 0;
  sim.dealDamage(p, mob, 100, crit, 'physical', null, 'hit');
  return p.resource;
}

describe('Seasoned Soldier (Arms): crit autos mint 10% more rage', () => {
  it('a committed Arms warrior knows the passive and crits mint 1.1x a non-crit of equal damage', () => {
    const { sim, p, mob } = makeWarrior('arms');
    const meta = requireMeta(sim, p.id);
    expect(meta.known.some((k: any) => k.def.id === 'seasoned_soldier')).toBe(true);
    const nonCrit = autoRage(sim, p, mob, false);
    const crit = autoRage(sim, p, mob, true);
    expect(crit).toBeCloseTo(nonCrit * 1.1, 4);
  });

  it('does NOT apply for a no-spec warrior (passive is arms-gated): crit == non-crit rage', () => {
    const { sim, p, mob } = makeWarrior(null);
    const nonCrit = autoRage(sim, p, mob, false);
    const crit = autoRage(sim, p, mob, true);
    expect(crit).toBeCloseTo(nonCrit, 4);
  });

  it('does NOT apply for Fury (spec-gated to arms): crit == non-crit rage', () => {
    const { sim, p, mob } = makeWarrior('fury');
    const nonCrit = autoRage(sim, p, mob, false);
    const crit = autoRage(sim, p, mob, true);
    expect(crit).toBeCloseTo(nonCrit, 4);
  });
});

describe('Master Armorer (Arms mastery): +10% damage while wielding a two-handed weapon', () => {
  // Pinned to a REAL shipped two-hander (Armorer Hode's vendor stock), so this
  // suite fails if the mastery's only enabling item ever drops out of content.
  const TWO_H = 'highwatch_greatsword';

  it('the enabling weapon ships in content as a real two-hander', () => {
    const def = ITEMS[TWO_H];
    expect(def?.kind).toBe('weapon');
    expect(def?.kind === 'weapon' && def.hand).toBe('twohand');
  });

  function hitDamage(mainhandId: string | undefined, spec: string | null): number {
    const { sim, p, mob } = makeWarrior(spec);
    requireMeta(sim, p.id).equipment.mainhand = mainhandId;
    const hp0 = mob.hp;
    sim.dealDamage(p, mob, 100, false, 'physical', null, 'hit');
    return hp0 - mob.hp;
  }

  it('an Arms warrior with a 2H mainhand deals 10% more physical damage', () => {
    expect(hitDamage(TWO_H, 'arms')).toBe(110);
  });

  it('an Arms warrior WITHOUT a 2H (1H mainhand) gets no bonus', () => {
    expect(hitDamage('worn_sword', 'arms')).toBe(100); // worn_sword defaults to onehand
  });

  it('a Fury warrior with a 2H mainhand gets no bonus (mastery is Arms-only)', () => {
    expect(hitDamage(TWO_H, 'fury')).toBe(100);
  });
});

function faceMelee(sim: AnySim, p: Entity, mob: Entity): void {
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
}

describe('Diabolical Twinstrike (Fury): Twinstrike hits 15% harder while Enraged', () => {
  it('raging_gale deals 1.15x enraged-with-passive vs enraged-without (Enrage 11% cancels in the ratio)', () => {
    const { sim, p, mob } = makeWarrior('fury');
    const meta = requireMeta(sim, p.id);
    p.weapon = { min: 30, max: 30, speed: 2 };
    p.attackPower = 0;
    p.critChance = 0;
    mob.dodgeChance = 0;
    mob.stats.armor = 0;
    faceMelee(sim, p, mob);
    const cast = (): number => {
      p.gcdRemaining = 0;
      p.cooldowns.delete('raging_gale');
      p.charges?.delete('raging_gale');
      p.auras = p.auras.filter((a) => a.kind !== 'enrage');
      p.auras.push({
        id: 'enrage',
        name: 'Enrage',
        kind: 'enrage',
        value: ENRAGE_DMG_DONE,
        duration: 99,
        remaining: 99,
        sourceId: p.id,
        school: 'physical',
      } as Aura);
      mob.hp = mob.maxHp;
      const hp0 = mob.hp;
      sim.castAbility('raging_gale');
      return hp0 - mob.hp;
    };
    const withPassive = cast();
    meta.known = meta.known.filter(
      (k: { def: { id: string } }) => k.def.id !== 'diabolical_twinstrike',
    );
    const without = cast();
    expect(withPassive).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
    expect(withPassive / without).toBeCloseTo(1.15, 2);
  });

  it('no bonus while NOT Enraged: passive-known equals passive-removed damage', () => {
    const { sim, p, mob } = makeWarrior('fury');
    const meta = requireMeta(sim, p.id);
    p.weapon = { min: 30, max: 30, speed: 2 };
    p.attackPower = 0;
    p.critChance = 0;
    mob.dodgeChance = 0;
    mob.stats.armor = 0;
    faceMelee(sim, p, mob);
    const cast = (): number => {
      p.gcdRemaining = 0;
      p.cooldowns.delete('raging_gale');
      p.charges?.delete('raging_gale');
      p.auras = p.auras.filter((a) => a.kind !== 'enrage'); // deliberately NOT enraged
      mob.hp = mob.maxHp;
      const hp0 = mob.hp;
      sim.castAbility('raging_gale');
      return hp0 - mob.hp;
    };
    const withPassive = cast();
    meta.known = meta.known.filter(
      (k: { def: { id: string } }) => k.def.id !== 'diabolical_twinstrike',
    );
    const without = cast();
    expect(withPassive).toBeGreaterThan(0);
    expect(withPassive).toBe(without); // the 1.15x rider is Enrage-gated
  });
});

describe('Cleaving Blows (Fury): Red Harvest refunds a charge of Twinstrike', () => {
  it('casting Red Harvest refunds one spent raging_gale charge', () => {
    const { sim, p, mob } = makeWarrior('fury');
    faceMelee(sim, p, mob);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale'); // spend one charge
    expect(p.charges?.get('raging_gale')?.spent).toBe(1);
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest');
    expect(p.charges?.get('raging_gale')?.spent).toBe(0); // refunded
  });

  it('does NOT refund when the passive is absent', () => {
    const { sim, p, mob } = makeWarrior('fury');
    const meta = requireMeta(sim, p.id);
    meta.known = meta.known.filter((k: { def: { id: string } }) => k.def.id !== 'cleaving_blows');
    faceMelee(sim, p, mob);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.charges?.get('raging_gale')?.spent).toBe(1);
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest');
    expect(p.charges?.get('raging_gale')?.spent).toBe(1); // no refund
  });
});

describe('Protection shield abilities require a shield equipped', () => {
  const hasShieldError = (events: Array<{ type?: string; text?: string }>): boolean =>
    events.some((e) => e.type === 'error' && /shield/i.test(e.text ?? ''));

  it('die_by_sword needs NO shield (the Arms defensive is wielded, not blocked)', () => {
    const { sim, p, mob } = makeWarrior('arms');
    faceMelee(sim, p, mob);
    p.equippedItems.offhand = undefined;
    p.gcdRemaining = 0;
    sim.drainEvents();
    sim.castAbility('die_by_sword');
    expect(hasShieldError(sim.drainEvents())).toBe(false);
    expect(p.auras.some((a) => a.kind === 'die_by_sword')).toBe(true);
  });

  for (const ability of ['shield_slam', 'raised_guard']) {
    it(`${ability} is blocked without a shield and allowed with one`, () => {
      const { sim, p, mob } = makeWarrior('prot');
      faceMelee(sim, p, mob);
      p.resource = 100;

      p.equippedItems.offhand = undefined;
      p.gcdRemaining = 0;
      sim.drainEvents();
      sim.castAbility(ability);
      expect(hasShieldError(sim.drainEvents())).toBe(true);

      p.equippedItems.offhand = 'eastbrook_buckler';
      p.gcdRemaining = 0;
      p.cooldowns.delete(ability);
      sim.drainEvents();
      sim.castAbility(ability);
      expect(hasShieldError(sim.drainEvents())).toBe(false);
    });
  }
});

describe('Sudden Death (Arms): free, any-health Early Grave', () => {
  it('a committed Arms warrior knows the passive', () => {
    const { sim, p } = makeWarrior('arms');
    expect(
      requireMeta(sim, p.id).known.some(
        (k: { def: { id: string } }) => k.def.id === 'sudden_death',
      ),
    ).toBe(true);
  });

  it('with the aura, Early Grave hits a FULL-health target for no rage and consumes the aura', () => {
    const { sim, p, mob } = makeWarrior('arms');
    faceMelee(sim, p, mob);
    mob.hp = mob.maxHp; // full health: normally execute is gated to <20%
    p.resource = 0; // no rage
    p.auras.push({
      id: 'sudden_death',
      name: 'Sudden Death',
      kind: 'sudden_death',
      duration: 10,
      remaining: 10,
      sourceId: p.id,
      school: 'physical',
    } as Aura);
    p.gcdRemaining = 0;
    const hp0 = mob.hp;
    sim.castAbility('execute');
    expect(mob.hp).toBeLessThan(hp0); // landed despite full HP and 0 rage
    expect(p.auras.some((a) => a.kind === 'sudden_death')).toBe(false); // aura consumed
  });

  it('without the aura, Early Grave is blocked on a full-health target', () => {
    const { sim, p, mob } = makeWarrior('arms');
    faceMelee(sim, p, mob);
    mob.hp = mob.maxHp;
    p.resource = 100;
    p.gcdRemaining = 0;
    const hp0 = mob.hp;
    sim.castAbility('execute');
    expect(mob.hp).toBe(hp0); // blocked by the <20% HP gate
  });

  // The proc itself (auto_attack.ts): a CONNECTED auto rolls SUDDEN_DEATH_CHANCE
  // and arms the aura. Force exactly that roll (every other chance draw returns
  // false, so the swing cannot miss/dodge/crit and stays connected) and drive a
  // real auto swing, so a regression that stops the proc rolling fails here.
  function forcedProcSwing(spec: string | null): Entity {
    const { sim, p, mob } = makeWarrior(spec);
    const meta = requireMeta(sim, p.id);
    faceMelee(sim, p, mob);
    mob.dodgeChance = 0;
    (sim as AnySim).rng.chance = (chance: number): boolean => chance === SUDDEN_DEATH_CHANCE;
    p.autoAttack = true;
    p.swingTimer = 0;
    p.offhandSwingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    return p;
  }

  it('a connected auto on a committed Arms warrior arms the Sudden Death aura', () => {
    const p = forcedProcSwing('arms');
    expect(p.auras.some((a) => a.kind === 'sudden_death')).toBe(true);
  });

  it('the same connected auto never arms it for Fury or a no-spec warrior', () => {
    expect(forcedProcSwing('fury').auras.some((a) => a.kind === 'sudden_death')).toBe(false);
    expect(forcedProcSwing(null).auras.some((a) => a.kind === 'sudden_death')).toBe(false);
  });
});
