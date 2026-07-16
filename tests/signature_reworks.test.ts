// Reworked spec signatures + spell-haste plumbing (owner pass): Chain Heal now bounces,
// Feral Instinct is a form-gated resource burst, Metamorphosis and Moonkin Form stack
// multiple buffs, spell haste (stat + auras) shortens casts, and fractional buff values
// survive a global damage mastery instead of rounding to zero.
import { describe, expect, it } from 'vitest';
import { spellDamageMultFromAuras, spellHasteMult } from '../src/sim/combat/spell_combat';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: PlayerClass, spec: string | null = null, seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  if (spec) sim.setSpec(spec);
  const p = sim.entities.get(sim.playerId) as Entity;
  p.maxHp = p.hp = 1_000_000;
  p.resource = p.maxResource;
  return sim;
}

function addAlly(sim: Sim, x: number, z: number, hp = 100): Entity {
  const y = terrainHeight(x, z, sim.cfg.seed);
  const ally = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, { x, y, z });
  (ally as any).hostile = false;
  (ally as any).kind = 'player';
  ally.maxHp = 1_000_000;
  ally.hp = hp;
  sim.entities.set(ally.id, ally);
  (sim as any).rebucket(ally);
  return ally;
}

describe('reworked signatures', () => {
  it('Conflagrate and Swiftmend use the retuned cooldowns (6s / 8s)', () => {
    const lock = makeSim('warlock', 'destruction');
    expect(lock.resolvedAbility('conflagrate')?.cooldown).toBe(6);
    const druid = makeSim('druid', 'restoration');
    expect(druid.resolvedAbility('swiftmend')?.cooldown).toBe(8);
  });

  it('Chain Heal bounces to nearby allies with healing falloff', () => {
    const sim = makeSim('shaman', 'restoration');
    const pid = sim.playerId;
    const p = sim.entities.get(pid) as Entity;
    // Three injured allies in a line off the player's (flat) spawn, each within the 12yd
    // chain radius of the previous. The caster is at full health, so the "injured only"
    // bounce rule never picks it.
    const a1 = addAlly(sim, p.pos.x + 2, p.pos.z);
    const a2 = addAlly(sim, p.pos.x + 2, p.pos.z + 8);
    const a3 = addAlly(sim, p.pos.x + 2, p.pos.z + 16);
    sim.targetEntity(a1.id, pid);
    const healed = new Set<number>();
    for (let i = 0; i < 20 * 4; i++) {
      if (i === 0) sim.castAbility('chain_heal', pid);
      for (const ev of sim.tick())
        if (ev.type === 'heal2' && (ev as any).sourceId === pid) healed.add((ev as any).targetId);
    }
    // primary + 2 jumps = 3 distinct allies, and each was actually topped up.
    expect(healed.size).toBe(3);
    for (const a of [a1, a2, a3]) expect(a.hp).toBeGreaterThan(100);
  });

  it('Feral Instinct grants Energy regen in Cat Form and instant Rage in Bear Form', () => {
    // Cat Form: an energy druid gains a buff_energyregen aura (doubled regen).
    const cat = makeSim('druid', 'feral');
    const cp = cat.entities.get(cat.playerId) as Entity;
    cp.auras.push({
      id: 'cat',
      name: 'Cat Form',
      kind: 'form_cat',
      remaining: 999,
      duration: 999,
      value: 0,
      sourceId: cp.id,
      school: 'physical',
    });
    cp.resourceType = 'energy';
    cat.castAbility('feral_charge', cat.playerId);
    cat.tick();
    expect(cp.auras.some((a) => a.kind === 'buff_energyregen' && a.value === 1)).toBe(true);

    // Bear Form: a rage druid instantly gains 50 Rage.
    const bear = makeSim('druid', 'feral');
    const bp = bear.entities.get(bear.playerId) as Entity;
    bp.auras.push({
      id: 'bear',
      name: 'Bear Form',
      kind: 'form_bear',
      remaining: 999,
      duration: 999,
      value: 0,
      sourceId: bp.id,
      school: 'physical',
    });
    bp.resourceType = 'rage';
    bp.maxResource = 100;
    bp.resource = 0;
    bear.castAbility('feral_charge', bear.playerId);
    bear.tick();
    expect(bp.resource).toBe(50);
  });

  it('Metamorphosis stacks damage AND haste on the caster (no aura eviction)', () => {
    const sim = makeSim('warlock', 'demonology');
    const p = sim.entities.get(sim.playerId) as Entity;
    sim.castAbility('metamorphosis', sim.playerId);
    sim.tick();
    // form marker + spell damage + spell haste all survive apply (distinct aura ids).
    expect(p.auras.some((a) => a.kind === 'form_metamorph')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'buff_spelldmg' && a.value === 0.2)).toBe(true);
    expect(p.auras.some((a) => a.kind === 'buff_spellhaste' && a.value === 0.2)).toBe(true);
    expect(spellDamageMultFromAuras(p)).toBeCloseTo(1.2);
    expect(spellHasteMult(p)).toBeCloseTo(1.2);
  });

  it('Moonkin Form grants +20% spell damage and +50% armor', () => {
    const sim = makeSim('druid', 'balance');
    const p = sim.entities.get(sim.playerId) as Entity;
    const armorBefore = p.stats.armor;
    sim.castAbility('moonkin_form', sim.playerId);
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(true);
    expect(spellDamageMultFromAuras(p)).toBeCloseTo(1.2);
    expect(p.stats.armor).toBe(Math.round(armorBefore * 1.5));
  });
});

describe('spell haste plumbing', () => {
  it('the spellHaste stat (set bonus or mastery) shortens a cast', () => {
    const sim = makeSim('mage');
    const pid = sim.playerId;
    const p = sim.entities.get(pid) as Entity;
    p.spellHaste = 0.15;
    // Frostbolt needs a hostile target in range and line of sight.
    const y = terrainHeight(p.pos.x, p.pos.z + 12, sim.cfg.seed);
    const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
      x: p.pos.x,
      y,
      z: p.pos.z + 12,
    });
    mob.hostile = true;
    mob.maxHp = mob.hp = 1_000_000;
    sim.entities.set(mob.id, mob);
    (sim as any).rebucket(mob);
    p.facing = 0;
    sim.targetEntity(mob.id, pid);
    const base = sim.resolvedAbility('frostbolt', pid)?.castTime ?? 0;
    expect(base).toBeGreaterThan(0);
    sim.castAbility('frostbolt', pid);
    expect(p.castTotal).toBeCloseTo(base / 1.15, 5);
  });

  it('a spec mastery with spellHastePct folds into the caster spell-haste stat', () => {
    const sim = makeSim('mage', 'arcane');
    const p = sim.entities.get(sim.playerId) as Entity;
    // Aetheric Flux mastery grants +10% spell haste (all-27 identity pass values).
    expect(p.spellHaste).toBeCloseTo(0.1);
  });

  it('Arcane Power keeps its 0.1 haste value under an Arcane spell-damage mastery (no round-to-0)', () => {
    const sim = makeSim('mage', 'arcane');
    const ap = sim.resolvedAbility('arcane_power');
    const haste = (ap?.effects ?? []).find(
      (e: any) => e.type === 'selfBuff' && e.kind === 'buff_spellhaste',
    ) as any;
    expect(haste).toBeDefined();
    expect(haste.value).toBeCloseTo(0.1);
  });
});

describe('crit-damage masteries', () => {
  it('a Fire mage mastery doubles SPELL crit damage via Entity.critDmgSpellBonus', () => {
    const sim = makeSim('mage', 'fire');
    const p = sim.entities.get(sim.playerId) as Entity;
    // Afterflame grants +50% spell crit damage: spell crits go from 1.5x to 2.0x. The
    // physical/heal crit channels are untouched (the mastery is spell-only).
    expect(p.critDmgSpellBonus).toBeCloseTo(0.5);
    expect(p.critDmgPhysBonus).toBe(0);
    expect(p.critDmgHealBonus).toBe(0);
  });

  it('a non-specced caster has no bonus crit damage', () => {
    const sim = makeSim('mage');
    const p = sim.entities.get(sim.playerId) as Entity;
    recalcPlayerStats(
      p,
      'mage',
      (sim as any).players.get(p.id).equipment,
      (sim as any).playerMods((sim as any).players.get(p.id)),
      (sim as any).players.get(p.id).equipmentInstance,
    );
    expect(p.critDmgSpellBonus).toBe(0);
  });
});
