// v0.42.0 class-balance pass (docs/design/class-balance-v042.md): the tooltip
// layer's contract with the sim's precomputed output-scaling metadata. Proves
// three things:
//   1. src/sim/ability_output_scaling.ts's buildAbilityOutputScaling resolves
//      the SAME multiplier the real combat call sites apply (talent_hit_mult
//      plus content/talents.ts's global dotDmgPct/hotHealPct/absorbPct, and
//      the bespoke Vespers Dirge Spell Power correction).
//   2. src/ui/ability_damage.ts's abilityDamageBonus reproduces that
//      multiplier on every rider it previously left at an implicit 1 (a
//      pre-v0.42 regression this pass fixes), including the aoeHeal AoE-flag
//      bug fix, and stays byte-identical to the old behavior when no
//      outputScaling is resolved (a mob/pet ability, or an unaffiliated
//      class/spec).
//   3. src/ui/ability_description.ts folds a live primary-healing spec
//      factor onto the COMPLETE displayed heal/HoT amount exactly once,
//      matching src/sim/primary_healing.ts's placement, instead of layering
//      it as a second additive "(+N)" badge.
import { describe, expect, it } from 'vitest';
import { buildAbilityOutputScaling } from '../src/sim/ability_output_scaling';
import { castAbility } from '../src/sim/combat/casting_lifecycle';
import { VESPERS_DOT_DAMAGE_MULT } from '../src/sim/combat/priest/vespers';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  emptyModifiers,
} from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { primaryHealingMultiplier } from '../src/sim/spec_output_tuning';
import {
  absorbBonus,
  channelTickBonus,
  directHealBonus,
  dotTickBonus,
  hotTickBonus,
} from '../src/sim/spell_scaling';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import { MAX_LEVEL, type SimEvent } from '../src/sim/types';
import {
  type AbilityScaling,
  abilityDamageBonus,
  abilityPrimaryHealingTotal,
  abilityScalingOf,
} from '../src/ui/ability_damage';
import { abilityEffectText } from '../src/ui/ability_description';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { WORLD_WITHOUT_HUB_YARD } from './helpers/hub_yard';

const SC: AbilityScaling = { spellPower: 200, healPower: 200, rangedPower: 300, attackPower: 250 };

function known(
  cls: Parameters<typeof abilitiesKnownAt>[0],
  id: string,
  mods?: ReturnType<typeof computeTalentModifiers>,
) {
  const ability = abilitiesKnownAt(cls, MAX_LEVEL, mods).find((k) => k.def.id === id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function requiredEffect<T>(effects: readonly T[], pred: (e: T) => boolean): T {
  const found = effects.find(pred);
  if (!found) throw new Error('missing expected effect');
  return found;
}

const SPIRITMEND_MODS = computeTalentModifiers('shaman', {
  ...emptyAllocation(),
  spec: 'restoration',
} as never);
const SUNMENDER_MODS = computeTalentModifiers('paladin', {
  ...emptyAllocation(),
  spec: 'holy',
} as never);
const GROVEHEART_MODS = computeTalentModifiers('druid', {
  ...emptyAllocation(),
  spec: 'restoration',
} as never);
const WILDFANG_MODS = computeTalentModifiers('druid', {
  ...emptyAllocation(),
  spec: 'feral',
} as never);
const VESPERS_MODS = computeTalentModifiers('priest', {
  ...emptyAllocation(),
  spec: 'shadow',
} as never);
const DOCTRINE_MODS = computeTalentModifiers('priest', {
  ...emptyAllocation(),
  spec: 'discipline',
} as never);
const FROST_MAGE_MODS = computeTalentModifiers('mage', {
  ...emptyAllocation(),
  spec: 'frost',
} as never);
const NO_SPEC_MODS = emptyModifiers();

describe('buildAbilityOutputScaling (src/sim/ability_output_scaling.ts)', () => {
  it('is the all-1 identity for a no-spec character', () => {
    const healingTouch = known('druid', 'healing_touch', NO_SPEC_MODS);
    const out = buildAbilityOutputScaling(healingTouch.def, 'druid', NO_SPEC_MODS);
    expect(out).toEqual({ damage: 1, healing: 1, dot: 1, hot: 1, absorb: 1, primaryHealing: 1 });
  });

  it('returns primaryHealing 1 for a non-player caster (cls null)', () => {
    const healingTouch = known('druid', 'healing_touch', GROVEHEART_MODS);
    const out = buildAbilityOutputScaling(healingTouch.def, null, GROVEHEART_MODS);
    expect(out.primaryHealing).toBe(1);
  });

  it('resolves the exact combat dmgMult/healMult for damage and healing', () => {
    const rejuv = known('druid', 'rejuvenation', GROVEHEART_MODS);
    const out = buildAbilityOutputScaling(rejuv.def, 'druid', GROVEHEART_MODS);
    const hit = resolveTalentHitMult(rejuv.def, GROVEHEART_MODS);
    expect(out.damage).toBe(hit.dmgMult);
    expect(out.healing).toBe(hit.healMult);
  });

  it('folds dotDmgPct/hotHealPct/absorbPct into dot/hot/absorb, matching effect_dispatch.ts', () => {
    const mods = {
      ...GROVEHEART_MODS,
      global: { ...GROVEHEART_MODS.global, dotDmgPct: 0.2, hotHealPct: 0.15, absorbPct: 0.1 },
    };
    const rejuv = known('druid', 'rejuvenation', mods);
    const out = buildAbilityOutputScaling(rejuv.def, 'druid', mods);
    const hit = resolveTalentHitMult(rejuv.def, mods);
    expect(out.dot).toBeCloseTo(hit.dmgMult * 1.2);
    expect(out.hot).toBeCloseTo(hit.healMult * 1.15);
    expect(out.absorb).toBeCloseTo(hit.healMult * 1.1);
  });

  it('resolves the v0.42.0 primary-healing factor per class/spec, and 1 elsewhere', () => {
    // Read the live tuned constants from spec_output_tuning.ts rather than a
    // hardcoded 1.1/1.2 literal: that table is still under balance review
    // (Groveheart's total-engine calibration in particular), and this test's
    // job is proving the DISPLAY follows whatever the source resolves to, not
    // pinning today's specific numbers.
    const healingWave = known('shaman', 'healing_wave', SPIRITMEND_MODS);
    expect(
      buildAbilityOutputScaling(healingWave.def, 'shaman', SPIRITMEND_MODS).primaryHealing,
    ).toBe(primaryHealingMultiplier('shaman', 'restoration'));

    const holyLight = known('paladin', 'holy_light', SUNMENDER_MODS);
    expect(buildAbilityOutputScaling(holyLight.def, 'paladin', SUNMENDER_MODS).primaryHealing).toBe(
      primaryHealingMultiplier('paladin', 'holy'),
    );

    const healingTouch = known('druid', 'healing_touch', GROVEHEART_MODS);
    expect(
      buildAbilityOutputScaling(healingTouch.def, 'druid', GROVEHEART_MODS).primaryHealing,
    ).toBe(primaryHealingMultiplier('druid', 'restoration'));

    // restoration is also a shaman/druid spec id, but the factor is
    // class-qualified: an untargeted class/spec pairing (feral druid) must
    // not inherit restoration's factor just because the spec id matches
    // another class's tuned spec.
    const healingTouchFeral = known('druid', 'healing_touch', WILDFANG_MODS);
    expect(
      buildAbilityOutputScaling(healingTouchFeral.def, 'druid', WILDFANG_MODS).primaryHealing,
    ).toBe(1);
  });

  it('applies the Vespers Dirge Spell Power correction only to shadow_word_pain on a committed Vespers priest', () => {
    const dirge = known('priest', 'shadow_word_pain', VESPERS_MODS);
    const out = buildAbilityOutputScaling(dirge.def, 'priest', VESPERS_MODS);
    const hit = resolveTalentHitMult(dirge.def, VESPERS_MODS);
    expect(out.dot).toBeCloseTo(
      hit.dmgMult * (1 + VESPERS_MODS.global.dotDmgPct) * VESPERS_DOT_DAMAGE_MULT,
    );

    // Doctrine (a different priest spec) casts the same ability without the
    // Vespers-only correction.
    const dirgeDoctrine = known('priest', 'shadow_word_pain', DOCTRINE_MODS);
    const outDoctrine = buildAbilityOutputScaling(dirgeDoctrine.def, 'priest', DOCTRINE_MODS);
    const hitDoctrine = resolveTalentHitMult(dirgeDoctrine.def, DOCTRINE_MODS);
    expect(outDoctrine.dot).toBeCloseTo(hitDoctrine.dmgMult * (1 + DOCTRINE_MODS.global.dotDmgPct));

    // A different Vespers dot (not Dirge) never takes the correction.
    const mindBlast = known('priest', 'mind_blast', VESPERS_MODS);
    if (mindBlast.effects.some((e) => e.type === 'dot')) {
      const outOther = buildAbilityOutputScaling(mindBlast.def, 'priest', VESPERS_MODS);
      const hitOther = resolveTalentHitMult(mindBlast.def, VESPERS_MODS);
      expect(outOther.dot).toBeCloseTo(hitOther.dmgMult * (1 + VESPERS_MODS.global.dotDmgPct));
    }
  });
});

describe('abilityDamageBonus applies resolved outputScaling (v0.42.0 fix)', () => {
  it('multiplies a direct heal rider by outputScaling.healing', () => {
    const heal = known('shaman', 'healing_wave', SPIRITMEND_MODS);
    const outputScaling = buildAbilityOutputScaling(heal.def, 'shaman', SPIRITMEND_MODS);
    const eff = requiredEffect(heal.effects, (e) => e.type === 'heal');
    const res = { ...heal, outputScaling };
    expect(abilityDamageBonus(res, eff, SC)).toBe(
      directHealBonus(SC.healPower, res.castTime, false, outputScaling.healing),
    );
    // Sanity: the factor is not 1, so this actually exercises the fix.
    expect(outputScaling.healing).not.toBe(1);
  });

  it('an instant aoeHeal (radiant_chorus) takes the AoE-penalised direct coefficient', () => {
    // radiant_chorus is a single-cast (non-channel) aoeHeal, matching
    // effect_dispatch.ts's instant 'aoeHeal' case (directHealBonus, aoe=true).
    const chorus = known('paladin', 'radiant_chorus', SUNMENDER_MODS);
    const outputScaling = buildAbilityOutputScaling(chorus.def, 'paladin', SUNMENDER_MODS);
    const eff = requiredEffect(chorus.effects, (e) => e.type === 'aoeHeal');
    const res = { ...chorus, outputScaling };
    expect(res.def.channel).toBeUndefined();
    expect(abilityDamageBonus(res, eff, SC)).toBe(
      directHealBonus(SC.healPower, res.castTime, true, outputScaling.healing),
    );
  });

  it('a channeled aoeHeal (tranquility/Gladesong) takes the per-pulse channel coefficient, not the direct one', () => {
    // v0.42.0 fix: a prior version of this helper used directHealBonus
    // (aoe=false, no channel awareness) for EVERY aoeHeal, which is wrong for
    // a self-centered healing channel: casting_lifecycle.ts's channel-tick
    // arm reads channelTickBonus instead (see the aoeHeal case comment).
    const def = ABILITIES.tranquility;
    expect(def.channel).toBeDefined();
    const outputScaling = buildAbilityOutputScaling(def, 'druid', GROVEHEART_MODS);
    const eff = requiredEffect(def.effects, (e) => e.type === 'aoeHeal');
    const res = {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
      outputScaling,
    };
    const expected = channelTickBonus(SC.healPower, def, outputScaling.healing);
    expect(abilityDamageBonus(res, eff, SC)).toBe(expected);
    // Proves the fix actually changed behavior: the old (wrong) direct-coefficient
    // read would have produced a different number here.
    expect(expected).not.toBe(
      directHealBonus(SC.healPower, res.castTime, true, outputScaling.healing),
    );
  });

  it('multiplies a dot rider total by outputScaling.dot (dmgMult * dotDmgPct)', () => {
    const dirge = known('priest', 'shadow_word_pain', VESPERS_MODS);
    const outputScaling = buildAbilityOutputScaling(dirge.def, 'priest', VESPERS_MODS);
    const eff = requiredEffect(dirge.effects, (e) => e.type === 'dot');
    if (eff.type !== 'dot') throw new Error('unreachable');
    const res = { ...dirge, outputScaling };
    const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
    const expected =
      dotTickBonus(SC.spellPower, dirge.def, eff.duration, eff.interval, outputScaling.dot) * ticks;
    expect(abilityDamageBonus(res, eff, SC)).toBe(expected);
  });

  it('multiplies a pure HoT rider total by outputScaling.hot', () => {
    const rejuv = known('druid', 'rejuvenation', GROVEHEART_MODS);
    const outputScaling = buildAbilityOutputScaling(rejuv.def, 'druid', GROVEHEART_MODS);
    const eff = requiredEffect(rejuv.effects, (e) => e.type === 'hot');
    if (eff.type !== 'hot') throw new Error('unreachable');
    const res = { ...rejuv, outputScaling };
    const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
    const expected =
      hotTickBonus(SC.healPower, eff.duration, eff.interval, outputScaling.hot) * ticks;
    expect(abilityDamageBonus(res, eff, SC)).toBe(expected);
  });

  it('multiplies an absorb rider by outputScaling.absorb', () => {
    // Every shield with an authored Spell Power coefficient is a mage
    // personal barrier (spell_scaling.ts's absorbBonus header); Psalm of
    // Warding carries none and scales by rank instead.
    const iceBarrier = known('mage', 'ice_barrier', FROST_MAGE_MODS);
    const outputScaling = buildAbilityOutputScaling(iceBarrier.def, 'mage', FROST_MAGE_MODS);
    const eff = requiredEffect(iceBarrier.effects, (e) => e.type === 'absorb');
    if (eff.type !== 'absorb') throw new Error('unreachable');
    const res = { ...iceBarrier, outputScaling };
    expect(abilityDamageBonus(res, eff, SC)).toBe(
      absorbBonus(SC.healPower, eff.spellPowerCoeff ?? 0, outputScaling.absorb),
    );
  });

  it('falls back to the pre-v0.42 factor-1 behavior when outputScaling is absent', () => {
    const heal = known('shaman', 'healing_wave', SPIRITMEND_MODS);
    const eff = requiredEffect(heal.effects, (e) => e.type === 'heal');
    // A real KnownAbility carries its own resolved outputScaling (parent's
    // classes.ts wiring); strip it to exercise the NEUTRAL fallback a
    // mob/pet ability (or a caller predating this metadata) still takes.
    const { outputScaling: _drop, ...withoutScaling } = heal as typeof heal & {
      outputScaling?: unknown;
    };
    expect(abilityDamageBonus(withoutScaling as typeof heal, eff, SC)).toBe(
      directHealBonus(SC.healPower, heal.castTime),
    );
  });
});

describe('abilityPrimaryHealingTotal (the complete-packet spec factor)', () => {
  it('returns null when the resolved outputScaling.primaryHealing is 1', () => {
    const heal = known('shaman', 'healing_wave', NO_SPEC_MODS);
    const outputScaling = buildAbilityOutputScaling(heal.def, 'shaman', NO_SPEC_MODS);
    const eff = requiredEffect(heal.effects, (e) => e.type === 'heal');
    const res = { ...heal, outputScaling };
    expect(abilityPrimaryHealingTotal(res, eff, SC)).toBeNull();
  });

  it('folds the factor onto the complete base-plus-power heal range once', () => {
    const heal = known('shaman', 'healing_wave', SPIRITMEND_MODS);
    const outputScaling = buildAbilityOutputScaling(heal.def, 'shaman', SPIRITMEND_MODS);
    const eff = requiredEffect(heal.effects, (e) => e.type === 'heal');
    if (eff.type !== 'heal') throw new Error('unreachable');
    const res = { ...heal, outputScaling };
    const bonus = abilityDamageBonus(res, eff, SC);
    const combined = abilityPrimaryHealingTotal(res, eff, SC);
    expect(combined).toEqual({
      min: Math.round((eff.min + bonus) * outputScaling.primaryHealing),
      max: Math.round((eff.max + bonus) * outputScaling.primaryHealing),
    });
    // Not the naive (unscaled range) + (scaled bonus): the whole packet scales.
    expect(combined?.min).not.toBe(eff.min + bonus);
  });

  it('never scales a fixed max-HP utility heal', () => {
    const lastRite = abilitiesKnownAt('paladin', MAX_LEVEL, SUNMENDER_MODS).find((k) =>
      k.effects.some((e) => e.type === 'heal' && e.casterMaxHpPct !== undefined),
    );
    expect(lastRite, 'expected a casterMaxHpPct heal on holy paladin').toBeDefined();
    if (!lastRite) return;
    const outputScaling = buildAbilityOutputScaling(lastRite.def, 'paladin', SUNMENDER_MODS);
    expect(outputScaling.primaryHealing).not.toBe(1);
    const eff = requiredEffect(lastRite.effects, (e) => e.type === 'heal');
    const res = { ...lastRite, outputScaling };
    expect(abilityPrimaryHealingTotal(res, eff, SC)).toBeNull();
  });

  it('folds the factor onto a HoT at the per-tick level, then multiplies by tick count', () => {
    const rejuv = known('druid', 'rejuvenation', GROVEHEART_MODS);
    const outputScaling = buildAbilityOutputScaling(rejuv.def, 'druid', GROVEHEART_MODS);
    const eff = requiredEffect(rejuv.effects, (e) => e.type === 'hot');
    if (eff.type !== 'hot') throw new Error('unreachable');
    const res = { ...rejuv, outputScaling };
    const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
    const tickBase = Math.max(1, Math.round(eff.total / ticks));
    const tickSp = hotTickBonus(SC.healPower, eff.duration, eff.interval, outputScaling.hot);
    const expectedTick = Math.round((tickBase + tickSp) * outputScaling.primaryHealing);
    const combined = abilityPrimaryHealingTotal(res, eff, SC);
    expect(combined).toEqual({ min: expectedTick * ticks, max: expectedTick * ticks });
  });

  it('renders the combined range through abilityEffectText, replacing the separate bonus badge', () => {
    const heal = known('shaman', 'healing_wave', SPIRITMEND_MODS);
    const outputScaling = buildAbilityOutputScaling(heal.def, 'shaman', SPIRITMEND_MODS);
    const res = { ...heal, outputScaling };
    const eff = requiredEffect(res.effects, (e) => e.type === 'heal');
    const combined = abilityPrimaryHealingTotal(res, eff, SC);
    expect(combined).not.toBeNull();
    const text = abilityEffectText(res, SC);
    expect(text).not.toContain('+');
    if (combined && combined.min !== combined.max) {
      expect(text).toContain(String(combined.min));
      expect(text).toContain(String(combined.max));
    } else if (combined) {
      expect(text).toBe(String(combined.min));
    }
  });
});

describe('v0.42.0 Skulduggery/Coldsight tooltip drift fixes', () => {
  it("describes Veiled Edge's live armed value instead of a hardcoded double", () => {
    // Base VEILED_EDGE_BONUS 0.5 (v0.42.0, halved from 1): +50%, not double.
    // A NEW key (veiledEdgeStrike), not the original veiledEdge: every
    // existing locale already carries a translated, placeholder-free
    // veiledEdge string, and reshaping ITS tokens would break interpolation
    // for every locale, not just the untranslated ones (see the hud_chrome.ts
    // catalog comment).
    expect(auraEffectDescriptor({ id: 'veiled_edge', kind: 'veiled_edge', value: 0.5 })).toEqual({
      key: 'hudChrome.auraEffect.veiledEdgeStrike',
      nums: { pct: 50 },
    });
    // Ashveil 4pc's armed value (ASHVEIL_4PC_VEILED_EDGE_BONUS 1): reads
    // double, matching the halved set text (was triple).
    expect(auraEffectDescriptor({ id: 'veiled_edge', kind: 'veiled_edge', value: 1 })).toEqual({
      key: 'hudChrome.auraEffect.veiledEdgeStrike',
      nums: { pct: 100 },
    });
    expect(hudChromeStrings.auraEffect.veiledEdgeStrike).toBe(
      "Your next Lurker's Strike deals {pct}% more weapon damage",
    );
  });

  it('describes the Coldsight Read banked opportunity from its own tuned multipliers', () => {
    expect(
      auraEffectDescriptor({
        id: 'hunter_coldsight_read',
        kind: 'hunter_coldsight_read',
        value: 0,
      }),
    ).toEqual({
      key: 'hudChrome.auraEffect.coldsightRead',
      nums: { longDrawPct: 50, fellShotPct: 75 },
    });
  });
});

// Decisive regressions: the EXPECTED number comes from actually running the
// real combat code (castAbility/updateCasting over a live Sim), never from
// re-deriving the arithmetic through the same helpers the tooltip calls (a
// wrong coefficient choice, e.g. directHealBonus instead of channelTickBonus,
// would otherwise pass a self-consistent-but-wrong test).
describe('actual runtime -> formatted tooltip, real Sim casts (Groveheart druid)', () => {
  function freshGroveheartDruid(seed: number): Sim {
    const sim = new Sim({
      seed,
      playerClass: 'druid',
      autoEquip: true,
      world: WORLD_WITHOUT_HUB_YARD,
    });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.setSpec('restoration')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.player.maxHp = 1_000_000;
    sim.player.hp = 1;
    sim.rng.next = () => 0.5; // every roll lands on its exact midpoint
    sim.targetEntity(sim.player.id, sim.player.id);
    return sim;
  }

  // Real ticks, not a hand-driven updateCasting loop: this is also what
  // advances the GCD between two casts in the same test (a manual
  // updateCasting-only drain never counts it down, so a second cast right
  // after the first is silently refused with no error event). sim.tick()
  // DRAINS its own event queue on return, so the events must be collected
  // from each call's return value, not read back afterward with
  // sim.drainEvents() (which would find nothing).
  // do/while, not while: an instant cast (castTime 0) resolves its effects
  // SYNCHRONOUSLY inside castAbility, before castingAbility is ever true, so
  // a guard-first loop would tick zero times and never drain that queued
  // event.
  function waitForCast(sim: Sim, guard = 200): SimEvent[] {
    const p = sim.player;
    const events: SimEvent[] = [];
    let i = 0;
    do {
      events.push(...sim.tick());
    } while (p.castingAbility && i++ < guard);
    expect(p.castingAbility).toBeNull();
    return events;
  }

  function healedAmount(events: SimEvent[]): number {
    return events
      .filter((e): e is Extract<SimEvent, { type: 'heal2' }> => e.type === 'heal2')
      .reduce((sum, e) => sum + e.amount, 0);
  }

  function waitOutGcd(sim: Sim, seconds = 2): void {
    for (let i = 0; i < 20 * seconds; i++) sim.tick();
  }

  it('Wildbloom (rejuvenation): the pure-HoT $d matches the actually deposited tick total', () => {
    const sim = freshGroveheartDruid(101);
    const p = sim.player;
    castAbility(sim.ctx, 'rejuvenation', p.id);
    waitForCast(sim);
    const hot = p.auras.find((a) => a.id === 'rejuvenation' && a.kind === 'hot');
    expect(hot).toBeDefined();
    const res = sim.resolvedAbility('rejuvenation');
    expect(res).not.toBeNull();
    if (!res || !hot) return;
    const ticks = hot.duration / (hot.tickInterval ?? 1);
    const actualTotal = hot.value * ticks;
    const text = abilityEffectText(res, abilityScalingOf(p));
    expect(text).toBe(String(actualTotal));
  });

  it('Regrowth (Second Bloom): the hybrid HoT rider still takes the primary-healing factor on its flat base', () => {
    const sim = freshGroveheartDruid(102);
    const p = sim.player;
    castAbility(sim.ctx, 'regrowth', p.id);
    waitForCast(sim);
    const hot = p.auras.find((a) => a.id === 'regrowth' && a.kind === 'hot');
    expect(hot).toBeDefined();
    const res = sim.resolvedAbility('regrowth');
    expect(res).not.toBeNull();
    if (!res || !hot) return;
    const hotEffect = res.effects.find((e) => e.type === 'hot');
    expect(hotEffect?.type).toBe('hot');
    if (hotEffect?.type !== 'hot') return;
    const combined = abilityPrimaryHealingTotal(res, hotEffect, abilityScalingOf(p));
    expect(combined).not.toBeNull();
    // A hybrid HoT's rider is suppressed to 0 (the direct heal already took
    // the coefficient), but its flat per-tick base still takes the v0.42.0
    // factor: combined is the TOTAL over every tick, matching the real
    // per-tick aura value times its tick count.
    const ticks = hot.duration / (hot.tickInterval ?? 1);
    expect(combined?.min).toBe(hot.value * ticks);
  });

  it('Gladesong (tranquility) channel: each pulse matches the actual per-tick channel coefficient', () => {
    const sim = freshGroveheartDruid(103);
    const p = sim.player;
    expect(
      sim.applyTalents({ spec: 'restoration', rows: { 17: 'dru_r17_frenzied_regeneration' } }),
    ).toBe(true);
    castAbility(sim.ctx, 'tranquility', p.id);
    // Sum the actual heal2 events rather than the hp delta: real sim.tick()
    // calls also run passive regen and other systems, which would otherwise
    // contaminate a plain before/after hp reading.
    const totalHealed = healedAmount(waitForCast(sim));
    const res = sim.resolvedAbility('tranquility');
    expect(res).not.toBeNull();
    if (!res) return;
    const eff = res.effects.find((e) => e.type === 'aoeHeal');
    expect(eff?.type).toBe('aoeHeal');
    if (eff?.type !== 'aoeHeal') return;
    const scaling = abilityScalingOf(p);
    const bonus = abilityDamageBonus(res, eff, scaling);
    const factor = res.outputScaling?.primaryHealing ?? 1;
    // Mirrors casting_lifecycle.ts's own arithmetic exactly: the pinned
    // ctx.rng.range(min, max) returns the UNROUNDED midpoint, and only the
    // final scalePrimaryHealing rounds (rounding the midpoint first, as a
    // display-side shortcut, would drift from the real per-pulse amount).
    const midpoint = (eff.min + eff.max) / 2;
    const perPulse = Math.round((midpoint + bonus) * factor);
    const pulses = res.def.channel?.ticks ?? 1;
    expect(totalHealed).toBe(perPulse * pulses);
  });

  it('Swiftmend (consumeAura heal): the $d combined total matches the actual consumed-HoT heal', () => {
    const sim = freshGroveheartDruid(104);
    const p = sim.player;
    castAbility(sim.ctx, 'rejuvenation', p.id);
    waitForCast(sim);
    expect(p.auras.some((a) => a.id === 'rejuvenation')).toBe(true);
    waitOutGcd(sim);
    castAbility(sim.ctx, 'swiftmend', p.id);
    const actualHealed = healedAmount(waitForCast(sim));
    expect(actualHealed).toBeGreaterThan(0);
    // The consumed Wildbloom is gone; Swiftmend's own heal is the only thing
    // that landed.
    expect(p.auras.some((a) => a.id === 'rejuvenation')).toBe(false);
    const res = sim.resolvedAbility('swiftmend');
    expect(res).not.toBeNull();
    if (!res) return;
    const eff = res.effects.find((e) => e.type === 'consumeAura');
    expect(eff?.type).toBe('consumeAura');
    if (eff?.type !== 'consumeAura' || !eff.heal) return;
    const scaling = abilityScalingOf(p);
    const combined = abilityPrimaryHealingTotal(res, eff, scaling);
    expect(combined).not.toBeNull();
    // The pinned rng.range(min, max) always rolls the exact midpoint;
    // reproduce the real formula exactly (mirroring the Gladesong test
    // above), then separately prove the displayed $d RANGE actually
    // brackets the real roll (the range's own bounds are min/max, not the
    // rolled amount, so they cannot equal it directly).
    const bonus = abilityDamageBonus(res, eff, scaling);
    const factor = res.outputScaling?.primaryHealing ?? 1;
    const midpoint = (eff.heal.min + eff.heal.max) / 2;
    expect(actualHealed).toBe(Math.round((midpoint + bonus) * factor));
    expect(combined?.min).toBeLessThanOrEqual(actualHealed);
    expect(combined?.max).toBeGreaterThanOrEqual(actualHealed);
    const text = abilityEffectText(res, scaling);
    expect(text).toContain(String(combined?.min));
    expect(text).toContain(String(combined?.max));
  });
});
