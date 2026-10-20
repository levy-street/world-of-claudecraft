// Shield power scaling (player report: "At 282 healing power Psalm of Warding
// absorbs 269 dmg; at 32 healing power it absorbs 269 dmg"). Every absorb reads
// the caster's healPower (Spell Power + Healing Power) through absorbBonus:
// Psalm of Warding at the classic 0.10 coefficient on every rank, and the
// mage Mass Barrier raid cooldown at 250 base + 0.25 x healPower per target
// for 15 sec. These drive the real cast path (castAbility -> effect_dispatch)
// so a dropped coefficient, a per-recipient recompute, or a lost talent/absorb
// multiplier turns the suite red.
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  abilitiesKnownAt,
  MAGE_MASS_BARRIER_SPELL_POWER_COEFF,
  PRIEST_PSALM_OF_WARDING_SPELL_POWER_COEFF,
} from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { refreshKnownAbilities } from '../src/sim/progression/known_abilities';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { abilityEffectText } from '../src/ui/ability_description';

type PriestSpec = 'holy' | 'discipline';
type MageSpec = 'frost' | 'fire' | 'arcane';

function scaling(healPower: number) {
  return { spellPower: healPower, healPower, rangedPower: 0, attackPower: 0 };
}

function psalmValueAt(spec: PriestSpec, healPower: number): number {
  const sim = new Sim({ seed: 2801, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  p.gcdRemaining = 0;
  // A direct poke bypasses recalcPlayerStats; the shield reads healPower only.
  p.healPower = healPower;
  sim.targetEntity(p.id);
  sim.castAbility('power_word_shield');
  const shield = p.auras.find((a) => a.kind === 'absorb' && a.sourceId === p.id);
  if (!shield) throw new Error('Psalm of Warding did not land');
  return shield.value ?? 0;
}

function mageRig(spec: MageSpec, healPower: number, allyHealPower = 0) {
  const sim = new Sim({ seed: 2026, playerClass: 'mage', noPlayer: true });
  const casterId = sim.addPlayer('mage', 'Barrier Mage');
  const allyId = sim.addPlayer('warrior', 'Shielded Ally');
  sim.setPlayerLevel(20, casterId);
  sim.setPlayerLevel(20, allyId);
  expect(sim.applyTalents({ spec, rows: { 17: 'mag_r17_mass_barrier' } }, casterId)).toBe(true);
  const caster = sim.entities.get(casterId) as Entity;
  const ally = sim.entities.get(allyId) as Entity;
  ally.pos = { x: caster.pos.x + 6, y: caster.pos.y, z: caster.pos.z };
  ally.prevPos = { ...ally.pos };
  sim.partyInvite(allyId, casterId);
  sim.partyAccept(allyId);
  caster.resource = caster.maxResource;
  caster.gcdRemaining = 0;
  caster.healPower = healPower;
  ally.healPower = allyHealPower;
  return { sim, caster, ally, casterId };
}

function shieldOn(e: Entity) {
  const shield = e.auras.find((a) => a.id === 'mass_barrier');
  if (!shield) throw new Error(`no Mass Barrier on ${e.name}`);
  return shield;
}

describe('Psalm of Warding scales with healPower (cast path)', () => {
  it('authors the 0.10 coefficient on every rank', () => {
    expect(PRIEST_PSALM_OF_WARDING_SPELL_POWER_COEFF).toBe(0.1);
    const def = ABILITIES.power_word_shield;
    const rankEffects = [def.effects, ...(def.ranks ?? []).map((r) => r.effects ?? [])];
    expect(rankEffects).toHaveLength(4);
    for (const effects of rankEffects) {
      const absorb = effects.find((e) => e.type === 'absorb');
      expect(absorb && absorb.type === 'absorb' ? absorb.spellPowerCoeff : undefined).toBe(0.1);
    }
  });

  // Holy (Benison): talent heal mult 1.28, so 210 -> 269 base, and the rider is
  // round(hp x 0.10 x 1.28): 32 -> 4, 282 -> 36.
  it('Holy: 32 healPower absorbs 273, 282 healPower absorbs 305', () => {
    expect(psalmValueAt('holy', 32)).toBe(273);
    expect(psalmValueAt('holy', 282)).toBe(305);
  });

  // Discipline: heal mult 1.18 x absorb mastery 1.30 = 1.534, so 210 -> 322
  // base, and the rider is round(hp x 0.10 x 1.534): 32 -> 5, 282 -> 43.
  it('Discipline: 32 healPower absorbs 327, 282 healPower absorbs 365', () => {
    expect(psalmValueAt('discipline', 32)).toBe(327);
    expect(psalmValueAt('discipline', 282)).toBe(365);
  });

  it('zero healPower leaves the shield at its resolved rank amount', () => {
    expect(psalmValueAt('holy', 0)).toBe(269);
    expect(psalmValueAt('discipline', 0)).toBe(322);
  });
});

describe('Mass Barrier is a scaling raid cooldown (cast path)', () => {
  it('authors 250 base, 0.25 coefficient, 15 sec, 90 sec cooldown, 5 targets, 30 yd', () => {
    expect(MAGE_MASS_BARRIER_SPELL_POWER_COEFF).toBe(0.25);
    const def = ABILITIES.mass_barrier;
    expect(def.cooldown).toBe(90);
    const eff = def.effects.find((e) => e.type === 'aoeAllyAbsorb');
    if (!eff || eff.type !== 'aoeAllyAbsorb') throw new Error('missing aoeAllyAbsorb');
    expect(eff.amount).toBe(250);
    expect(eff.spellPowerCoeff).toBe(0.25);
    expect(eff.duration).toBe(15);
    expect(eff.maxTargets).toBe(5);
    expect(eff.radius).toBe(30);
  });

  it('shields caster and ally for 250 + 0.25 x the CASTER healPower, for 15 sec', () => {
    for (const [hp, expected] of [
      [0, 250],
      [80, 270],
      [282, 321], // 282 x 0.25 = 70.5 -> 71
    ] as const) {
      const { sim, caster, ally, casterId } = mageRig('frost', hp, 999);
      sim.castAbility('mass_barrier', casterId);
      for (const e of [caster, ally]) {
        const shield = shieldOn(e);
        expect(shield.kind).toBe('absorb');
        // The rider is the caster's, computed once per cast: the ally's own
        // 999 healPower must not leak into its shield.
        expect(shield.value, `${e.name} at ${hp}`).toBe(expected);
        expect(shield.duration).toBe(15);
        expect(shield.remaining).toBe(15);
        expect(shield.sourceId).toBe(casterId);
      }
      expect(caster.cooldowns.get('mass_barrier')).toBe(90);
    }
  });

  it('keeps the Fire spec school swap while scaling the same way', () => {
    const { sim, caster, ally, casterId } = mageRig('fire', 282);
    sim.castAbility('mass_barrier', casterId);
    for (const e of [caster, ally]) {
      expect(shieldOn(e).school).toBe('fire');
      expect(shieldOn(e).value).toBe(321);
    }
  });

  it('applies the global absorb multiplier to both the base and the healPower rider', () => {
    const { sim, caster, ally, casterId } = mageRig('frost', 282);
    const meta = sim.players.get(casterId);
    if (!meta) throw new Error('missing meta');
    meta.talentMods.global.absorbPct = 0.3;
    refreshKnownAbilities(sim.ctx, meta, false);
    sim.castAbility('mass_barrier', casterId);
    // base round(250 x 1.3) = 325, rider round(282 x 0.25 x 1.3) = round(91.65) = 92.
    expect(shieldOn(caster).value).toBe(417);
    expect(shieldOn(ally).value).toBe(417);
  });

  it('applies the talent heal multiplier to both the base and the healPower rider', () => {
    const { sim, caster, ally, casterId } = mageRig('frost', 282);
    const meta = sim.players.get(casterId);
    if (!meta) throw new Error('missing meta');
    meta.talentMods.global.healPct = 0.2;
    refreshKnownAbilities(sim.ctx, meta, false);
    sim.castAbility('mass_barrier', casterId);
    // base round(250 x 1.2) = 300, rider round(282 x 0.25 x 1.2) = round(84.6) = 85.
    expect(shieldOn(caster).value).toBe(385);
    expect(shieldOn(ally).value).toBe(385);
  });

  it('multiplies heal and absorb modifiers together on base and rider', () => {
    const { sim, caster, ally, casterId } = mageRig('frost', 282);
    const meta = sim.players.get(casterId);
    if (!meta) throw new Error('missing meta');
    meta.talentMods.global.healPct = 0.2;
    meta.talentMods.global.absorbPct = 0.3;
    refreshKnownAbilities(sim.ctx, meta, false);
    sim.castAbility('mass_barrier', casterId);
    // base round(250 x 1.56) = 390, rider round(282 x 0.25 x 1.56) = round(109.98) = 110.
    expect(shieldOn(caster).value).toBe(500);
    expect(shieldOn(ally).value).toBe(500);
  });

  it('keeps the Arcane school swap and the shared personal-barrier cooldown', () => {
    const { sim, caster, ally, casterId } = mageRig('arcane', 282);
    sim.castAbility('mass_barrier', casterId);
    // The Arcane spec baseline carries global healPct 0.15, which
    // reaches both halves: round(250 x 1.15) = 288, round(282 x 0.25 x 1.15) = 81.
    for (const e of [caster, ally]) {
      expect(shieldOn(e).school).toBe('arcane');
      expect(shieldOn(e).value).toBe(369);
    }
    // Arcane's personal barrier (Temporal Barrier, 12 sec) is put on cooldown.
    expect(caster.cooldowns.get('temporal_barrier')).toBe(12);
  });
});

describe('Psalm of Warding lower ranks scale through the cast path', () => {
  it('rank 2 at level 12 (Holy) adds the same 0.10 rider', () => {
    const at = (healPower: number): number => {
      const sim = new Sim({ seed: 2801, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(12);
      expect(sim.setSpec('holy')).toBe(true);
      sim.tick();
      const p = sim.player;
      p.resource = p.maxResource;
      p.gcdRemaining = 0;
      p.healPower = healPower;
      sim.targetEntity(p.id);
      sim.castAbility('power_word_shield');
      const shield = p.auras.find((a) => a.kind === 'absorb' && a.sourceId === p.id);
      if (!shield) throw new Error('Psalm of Warding did not land');
      return shield.value ?? 0;
    };
    // Rank 2 base round(90 x 1.20) = 108 at level 12; rider round(282 x 0.10 x 1.20) = 34.
    expect(at(0)).toBe(108);
    expect(at(282)).toBe(142);
  });
});

describe('shield tooltips show the same resolved values as combat', () => {
  it('Mass Barrier tooltip reads base plus the healPower rider', () => {
    const mods = computeTalentModifiers('mage', {
      ...emptyAllocation(),
      spec: 'frost',
      rows: { 17: 'mag_r17_mass_barrier' },
    } as never);
    const barrier = abilitiesKnownAt('mage', 20, mods).find((k) => k.def.id === 'mass_barrier');
    if (!barrier) throw new Error('missing mass_barrier');
    expect(abilityEffectText(barrier, scaling(80))).toBe('250 (+20)');
    expect(abilityEffectText(barrier, scaling(282))).toBe('250 (+71)');
    // A non-1 absorb multiplier reaches the tooltip exactly as combat (417 above).
    const boosted = computeTalentModifiers('mage', {
      ...emptyAllocation(),
      spec: 'frost',
      rows: { 17: 'mag_r17_mass_barrier' },
    } as never);
    boosted.global.absorbPct = 0.3;
    const boostedBarrier = abilitiesKnownAt('mage', 20, boosted).find(
      (k) => k.def.id === 'mass_barrier',
    );
    if (!boostedBarrier) throw new Error('missing boosted mass_barrier');
    expect(abilityEffectText(boostedBarrier, scaling(282))).toBe('325 (+92)');
    expect(barrier.def.description).toBe(
      'Shields you and up to 4 nearby allies within 30 yd, each absorbing $d damage for 15 sec. (Mage talent)',
    );
  });

  it('Psalm of Warding tooltip matches the cast path in Holy and Discipline', () => {
    for (const [spec, base, low, high] of [
      ['holy', 269, 4, 36],
      ['discipline', 322, 5, 43],
    ] as const) {
      const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec } as never);
      const shield = abilitiesKnownAt('priest', 20, mods).find(
        (k) => k.def.id === 'power_word_shield',
      );
      if (!shield) throw new Error('missing power_word_shield');
      expect(abilityEffectText(shield, scaling(32))).toBe(`${base} (+${low})`);
      expect(abilityEffectText(shield, scaling(282))).toBe(`${base} (+${high})`);
      expect(psalmValueAt(spec, 32)).toBe(base + low);
      expect(psalmValueAt(spec, 282)).toBe(base + high);
    }
  });
});
