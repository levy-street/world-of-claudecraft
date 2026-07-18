// Owner tuning batch 2026-07-13: haste shortens the GCD, Hot Streak builder crits
// outside Combustion shave its cooldown, Mass Barrier caps at 5 nearest, plus the
// Scald/Cinderfall/Aetherwell/Racing Mind/Temporal Exhaustion number changes.
import { describe, expect, it } from 'vitest';
import { COMBUSTION_CDR_PER_CRIT, fireMageOnSpellHit } from '../src/sim/combat/fire_mage';
import { SATED_DURATION } from '../src/sim/combat/haste_burst';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function mage(spec: 'fire' | 'frost' | 'arcane'): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addDummy(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, { x: p.pos.x, y: p.pos.y, z: p.pos.z + 5 });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

function spellHaste(bonus: number): Aura {
  return {
    id: 'test_haste',
    name: 'Haste',
    kind: 'buff_spellhaste',
    value: bonus,
    remaining: 60,
    duration: 60,
    sourceId: 0,
    school: 'arcane',
  };
}

describe('Haste shortens the global cooldown', () => {
  it('no haste keeps the 1.5s GCD; +30% haste cuts it; extreme haste floors at 0.75s', () => {
    const base = mage('fire');
    base.sim.targetEntity(addDummy(base.sim).id);
    base.sim.castAbility('fireball');
    expect(base.p.gcdRemaining).toBeCloseTo(1.5, 3);

    const hasted = mage('fire');
    hasted.p.auras.push(spellHaste(0.3)); // spellHasteMult 1.3
    hasted.sim.targetEntity(addDummy(hasted.sim).id);
    hasted.sim.castAbility('fireball');
    expect(hasted.p.gcdRemaining).toBeCloseTo(1.5 / 1.3, 3);

    const capped = mage('fire');
    capped.p.auras.push(spellHaste(2)); // spellHasteMult 3 => 0.5, floored to 0.75
    capped.sim.targetEntity(addDummy(capped.sim).id);
    capped.sim.castAbility('fireball');
    expect(capped.p.gcdRemaining).toBeCloseTo(0.75, 3);
  });
});

describe('Hot Streak builder crits shave Combustion cooldown', () => {
  it('a builder crit outside Combustion trims the cooldown; a crit during it does not', () => {
    const { sim, p } = mage('fire');
    const ctx = (sim as unknown as { ctx: Parameters<typeof fireMageOnSpellHit>[0] }).ctx;

    p.cooldowns.set('combustion', 120);
    fireMageOnSpellHit(ctx, p, 'fireball', true); // builder crit, not in Combustion
    expect(p.cooldowns.get('combustion')).toBeCloseTo(120 - COMBUSTION_CDR_PER_CRIT, 6);

    // A non-crit does nothing.
    fireMageOnSpellHit(ctx, p, 'fireball', false);
    expect(p.cooldowns.get('combustion')).toBeCloseTo(120 - COMBUSTION_CDR_PER_CRIT, 6);

    // During Combustion, its own crits do NOT further shorten the cooldown.
    p.cooldowns.set('combustion', 120);
    p.auras.push({
      id: 'combustion',
      name: 'Combustion',
      kind: 'combustion',
      value: 0,
      remaining: 10,
      duration: 10,
      sourceId: p.id,
      school: 'fire',
    });
    fireMageOnSpellHit(ctx, p, 'fireball', true);
    expect(p.cooldowns.get('combustion')).toBe(120);
  });
});

describe('Mass Barrier shields only the 5 nearest', () => {
  it('caps at the caster plus the four closest allies', () => {
    // Mass Barrier is a choice-row talent, so grant it via the talent rig.
    const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'frost', rows: { 17: 'mag_r17_mass_barrier' } })).toBe(true);
    const p = sim.player;
    // Recipients are group-scoped (party/raid only), so raid all 7 allies with
    // the caster: fill the 5-player party, convert to raid, invite the rest.
    const allies: Entity[] = [];
    for (let i = 0; i < 7; i++) {
      const id = sim.addPlayer('warrior', `A${i}`);
      const e = sim.entities.get(id)!;
      e.pos = { x: p.pos.x + 1 + i, y: p.pos.y, z: p.pos.z }; // increasing distance
      e.prevPos = { ...e.pos };
      allies.push(e);
      if (i === 4) {
        (
          sim as unknown as { party: { convertPartyToRaid(pid: number): void } }
        ).party.convertPartyToRaid(p.id);
      }
      sim.partyInvite(id, p.id);
      sim.partyAccept(id);
    }
    const hasShield = (e: Entity) => e.auras.some((a) => a.id === 'mass_barrier');
    p.resource = p.maxResource;
    sim.castAbility('mass_barrier');
    sim.tick();
    // The caster and the 4 nearest allies are shielded; the 3 farthest are not.
    expect(hasShield(p)).toBe(true);
    const shieldedAllies = allies.filter(hasShield).length;
    expect(shieldedAllies).toBe(4);
    expect(allies.slice(0, 4).every(hasShield)).toBe(true);
    expect(allies.slice(4).some(hasShield)).toBe(false);
  });
});

describe('Number changes', () => {
  it('Scald lands instantly (no traveling bolt)', () => {
    expect(ABILITIES.scorch.projectile).toBe(false);
  });
  it('Cinderfall stores three charges', () => {
    expect(ABILITIES.fire_blast.maxCharges).toBe(3);
  });
  it('Aetherwell restores 100 mana per tick', () => {
    const gain = ABILITIES.evocation.effects.find((e) => e.type === 'gainResource');
    expect(gain && 'amount' in gain ? gain.amount : 0).toBe(100);
  });
  it('Racing Mind is off the global cooldown', () => {
    expect(ABILITIES.presence_of_mind.offGcd).toBe(true);
  });
  it('Temporal Exhaustion lasts 10 minutes', () => {
    expect(SATED_DURATION).toBe(600);
  });
  it('Mass Barrier caps at 5 targets', () => {
    const eff = ABILITIES.mass_barrier.effects.find((e) => e.type === 'aoeAllyAbsorb');
    expect(eff && 'maxTargets' in eff ? eff.maxTargets : 0).toBe(5);
  });
});
