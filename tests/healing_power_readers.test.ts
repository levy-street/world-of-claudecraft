// Healing Power reader independence, per reader family (review finding 12).
//
// The directionality contract (types.ts BaseItemDef.healPower, pinned end to
// end by tests/heal_power.test.ts): Entity.healPower derives as spellPower
// plus flat Healing Power, and every heal, HoT, and absorb rider reads
// healPower, while damage riders read spellPower. Earlier scaling tests set
// spellPower and healPower to the SAME value (mirroring the derivation by
// hand), so a reader silently regressing from healPower to spellPower stayed
// green. These tests decouple the two stats per reader family:
//   - healingPowerBoost: healPower raised by a flat delta, spellPower held.
//     The heal must grow by exactly the coefficient applied to the delta.
//   - spellPowerRaised: raw spellPower raised, healPower held. The heal must
//     NOT change: raw spellPower reaches healing only THROUGH the healPower
//     derivation (recalcPlayerStats), which tests/heal_power.test.ts covers.
// Expected values are literals computed from the live classic coefficients in
// src/sim/spell_scaling.ts (direct: clamp(castTime, 1.5, 3.5)/3.5, HoT:
// duration/15 split across ticks, channel: clamp(duration, 1.5, 3.5)/3.5
// split across ticks, AoE penalty 0.333, HEALING_SP_SCALE 2 on direct/HoT),
// PLUS (v0.42.0 class-balance-v042.md) one more pass through
// primary_healing.ts scalePrimaryHealing(rawPacket, primaryHealingMultiplier)
// for every reader whose caster is a Spiritmend shaman, Sunmender paladin, or
// Groveheart druid: the whole raw packet (authored base + SP rider) is
// multiplied once, not just the rider. An unspecced/other-spec caster keeps
// multiplier 1 and its literal unchanged.
//
// Reader families and their sim code paths:
//   chain heal    combat/effect_dispatch.ts 'chainHeal' (directHealBonus) - Spiritmend x1.10
//   HoT           combat/effect_dispatch.ts 'hot' (hotTickBonus) - unspecced priest, x1 (unaffected)
//   absorb        combat/effect_dispatch.ts 'absorb' (absorbBonus) - outside the healing-factor scope
//   AoE heal      combat/effect_dispatch.ts 'aoeHeal' (directHealBonus, aoe) - Sunmender x1.10
//   channel AoE   combat/casting_lifecycle.ts aoeHeal pulse (channelTickBonus) - unspecced druid, x1 (unaffected)
//   druid replant combat/druid_engines.ts replantWildbloom (hotTickBonus) - Groveheart x1.20
//   Paladin Aegis combat/paladin_aegis.ts tick + final burst - Sunmender x1.10
import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { resolveDruidOverbloom } from '../src/sim/combat/druid_engines';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { WORLD_WITHOUT_HUB_YARD } from './helpers/hub_yard';

const BASE_POWER = 70;
const HEALING_POWER_DELTA = 140; // the flat Healing Power robe of the boost arm
const RAISED_SPELL_POWER = 470; // the raw spellPower poke of the held arm

type StatArm = 'baseline' | 'healingPowerBoost' | 'spellPowerRaised';

// Set the two derived ratings directly on the entity (the established
// heal_spellpower.test.ts idiom): the derivation from gear is pinned by
// tests/heal_power.test.ts, so here the poke isolates WHICH stat each reader
// consumes. spellPowerRaised deliberately breaks the derivation (healPower
// held below spellPower) so a reader on the wrong stat cannot hide.
function applyArm(caster: Entity, arm: StatArm): void {
  if (arm === 'baseline') {
    caster.spellPower = BASE_POWER;
    caster.healPower = BASE_POWER;
  } else if (arm === 'healingPowerBoost') {
    caster.spellPower = BASE_POWER;
    caster.healPower = BASE_POWER + HEALING_POWER_DELTA;
  } else {
    caster.spellPower = RAISED_SPELL_POWER;
    caster.healPower = BASE_POWER;
  }
}

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`missing entity ${id}`);
  return found;
}

// Pin every rng draw to 0.5: range(min, max) yields the exact midpoint and
// chance(critPct) is false, so amounts are exact literals (the
// paladin_aegis.test.ts idiom). No wall clock anywhere: the drains below call
// updateCasting directly, one DT step per call.
function pinRng(sim: Sim): void {
  sim.rng.next = () => 0.5;
}

// Drive the cast or channel one DT step at a time, re-applying the stat arm
// before every step: a cast that plants an aura on the caster (Aegis puts its
// protection on the caster too) triggers recalcPlayerStats, which would
// silently rebuild both ratings from gear and undo the poke mid-channel.
function drainCast(sim: Sim, caster: Entity, arm: StatArm, limit = 400): void {
  const meta = sim.players.get(caster.id);
  if (!meta) throw new Error(`missing player meta ${caster.id}`);
  let guard = 0;
  while (caster.castingAbility && guard++ < limit) {
    applyArm(caster, arm);
    updateCasting(sim.ctx, caster, meta);
  }
  expect(caster.castingAbility).toBeNull();
}

describe('chain heal reads healPower (effect_dispatch chainHeal)', () => {
  // Cascading Mend: castTime 2.5, base 120 to 145 (midpoint 132.5). Rider =
  // round(healPower * 2 * 2.5/3.5): 70 -> 100, 210 -> 300. Restoration carries
  // no legacy talent heal multiplier on this ability (costPct only), but
  // Spiritmend's v0.42.0 primary factor (1.10) now scales the WHOLE raw
  // packet (base + rider) once, before rounding: first hop =
  // round((132.5 + rider) * 1.10).
  function firstHopHeal(arm: StatArm): number {
    const sim = new Sim({ seed: 5, playerClass: 'shaman', noPlayer: true });
    const casterId = sim.addPlayer('shaman', 'Chainer');
    const allyId = sim.addPlayer('warrior', 'Hurt Ally');
    sim.setPlayerLevel(18, casterId);
    expect(sim.setSpec('restoration', casterId)).toBe(true);
    sim.setPlayerLevel(18, allyId);
    const caster = entity(sim, casterId);
    const ally = entity(sim, allyId);
    // Deep deficit on a huge pool: the applied heal is never clamped, so the
    // hp delta IS the first hop amount (later hops land on the full caster).
    ally.maxHp = 1_000_000;
    ally.hp = 1;
    caster.resource = caster.maxResource;
    applyArm(caster, arm);
    pinRng(sim);
    sim.targetEntity(allyId, casterId);
    castAbility(sim.ctx, 'chain_heal', casterId);
    drainCast(sim, caster, arm);
    return ally.hp - 1;
  }

  it('a flat Healing Power delta adds exactly the cast-time coefficient rider, then the Spiritmend factor once', () => {
    expect(firstHopHeal('baseline')).toBe(256); // round((132.5 + 100) * 1.10)
    expect(firstHopHeal('healingPowerBoost')).toBe(476); // round((132.5 + 300) * 1.10)
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(firstHopHeal('spellPowerRaised')).toBe(256);
  });
});

describe('pure HoT reads healPower (effect_dispatch hot)', () => {
  // Renew: duration 15, interval 3 at every rank, so the per-tick rider is
  // round(healPower * 2 * (15/15) / 5) = round(healPower * 0.4):
  // 70 -> 28, 210 -> 84. An unspecced priest carries no heal multiplier.
  function renewTickValue(arm: StatArm | 'zero'): number {
    const sim = new Sim({ seed: 9, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(12);
    const p = sim.player;
    p.resource = p.maxResource;
    if (arm === 'zero') {
      p.spellPower = 0;
      p.healPower = 0;
    } else {
      applyArm(p, arm);
    }
    castAbility(sim.ctx, 'renew', p.id);
    const hot = p.auras.find((aura) => aura.id === 'renew' && aura.kind === 'hot');
    if (!hot) throw new Error('no renew hot planted');
    return hot.value;
  }

  it('a flat Healing Power delta adds exactly the split DoT-coefficient rider', () => {
    const base = renewTickValue('zero');
    expect(renewTickValue('baseline')).toBe(base + 28);
    expect(renewTickValue('healingPowerBoost')).toBe(base + 84);
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(renewTickValue('spellPowerRaised')).toBe(renewTickValue('baseline'));
  });
});

describe('coefficient absorb reads healPower (effect_dispatch absorb)', () => {
  // Ice Barrier rank 1 (level 11): authored 50 plus round(healPower * 0.5)
  // (MAGE_PERSONAL_BARRIER_SPELL_POWER_COEFF): 70 -> 85, 210 -> 155. Frost
  // carries no heal or absorb multiplier.
  function barrierValue(arm: StatArm): number {
    const sim = new Sim({ seed: 13, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(11);
    expect(sim.setSpec('frost')).toBe(true);
    const p = sim.player;
    p.resource = p.maxResource;
    applyArm(p, arm);
    sim.castAbility('ice_barrier');
    const barrier = p.auras.find((aura) => aura.id === 'ice_barrier' && aura.kind === 'absorb');
    if (!barrier) throw new Error('no ice barrier applied');
    return barrier.value;
  }

  it('a flat Healing Power delta adds exactly the authored coefficient rider', () => {
    expect(barrierValue('baseline')).toBe(85); // 50 + round(70 * 0.5)
    expect(barrierValue('healingPowerBoost')).toBe(155); // 50 + round(210 * 0.5)
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(barrierValue('spellPowerRaised')).toBe(85);
  });
});

describe('direct AoE heal reads healPower (effect_dispatch aoeHeal)', () => {
  // Radiant Chorus (holy paladin, level 14): castTime 2, base 90 to 110
  // (midpoint 100). Rider = round(healPower * 2 * (2/3.5) * 0.333):
  // 70 -> 27, 210 -> 80. Sunmender's mastery is crit-heal only (no legacy
  // multiplier reaches a non-crit heal), but the v0.42.0 Sunmender primary
  // factor (1.10) now scales the whole raw packet once: round((100 + rider) * 1.10).
  function selfAoeHeal(arm: StatArm): number {
    const sim = new Sim({
      seed: 17,
      playerClass: 'paladin',
      autoEquip: true,
      world: WORLD_WITHOUT_HUB_YARD,
    });
    sim.setPlayerLevel(14);
    expect(sim.setSpec('holy')).toBe(true);
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = 1;
    p.resource = p.maxResource;
    applyArm(p, arm);
    pinRng(sim);
    castAbility(sim.ctx, 'radiant_chorus', p.id);
    drainCast(sim, p, arm);
    return p.hp - 1;
  }

  it('a flat Healing Power delta adds exactly the AoE-penalized rider, then the Sunmender factor once', () => {
    expect(selfAoeHeal('baseline')).toBe(140); // round((100 + round(70 * 2 * (2/3.5) * 0.333)) * 1.10) = round(127 * 1.10)
    expect(selfAoeHeal('healingPowerBoost')).toBe(198); // round((100 + round(210 * 2 * (2/3.5) * 0.333)) * 1.10) = round(180 * 1.10)
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(selfAoeHeal('spellPowerRaised')).toBe(140);
  });
});

describe('channeled AoE heal pulse reads healPower (casting_lifecycle aoeHeal arm)', () => {
  // Gladesong (tranquility): channel duration 4 clamps to the 3.5 coefficient
  // cap, split over 4 ticks, so each pulse rider is round(healPower * 0.25)
  // with NO healing double-scale (channelTickBonus): 70 -> 18, 210 -> 53.
  // Pulse base 42 to 52 (midpoint 47); four pulses on the caster. An
  // unspecced druid carries no heal multiplier. This is the reader that HAD
  // regressed to spellPower via abilityScalingPower (fixed in the same change
  // as this test).
  function selfChannelHealTotal(arm: StatArm): number {
    const sim = new Sim({ seed: 21, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 17: 'dru_r17_frenzied_regeneration' } })).toBe(
      true,
    );
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = 1;
    p.resource = p.maxResource;
    applyArm(p, arm);
    pinRng(sim);
    castAbility(sim.ctx, 'tranquility', p.id);
    drainCast(sim, p, arm);
    return p.hp - 1;
  }

  it('a flat Healing Power delta adds exactly the per-pulse channel rider', () => {
    expect(selfChannelHealTotal('baseline')).toBe(260); // 4 * (47 + round(70 * 0.25))
    expect(selfChannelHealTotal('healingPowerBoost')).toBe(400); // 4 * (47 + round(210 * 0.25))
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(selfChannelHealTotal('spellPowerRaised')).toBe(260);
  });
});

describe('druid Overbloom replant reads healPower (druid_engines replantWildbloom)', () => {
  // At level 10 (rank 2, authored hot.total 32 -> 56 on rank), restoration's
  // spec_baselines.ts global healPct 0.08 plus rejuvenation's ability dmgPct
  // 0.24 give talentHealMult 1.32 (resolveTalentHitMult, level-independent);
  // Grove's Gift mastery hotHealPct is LEVEL-SCALED and reads 0.125 at level
  // 10 (half its level-20 value of 0.25), so combinedHotMult here is
  // 1.32 * 1.125 = 1.485, not the level-20 1.65 an unscaled reading would
  // suggest. That combined multiplier bakes into the resolved ability's
  // hot.total (classes.ts scaleEffect) AND separately scales the runtime SP
  // rider (hotTickBonus) the replant now correctly threads through
  // (previously it passed no multiplier at all, the v0.42.0 bug fix).
  // hotBase = round(83 / (12/3)) = 21 is the SAME across every arm (it comes
  // from the baked total, not runtime healPower); hotSp = hotTickBonus(healPower,
  // 12, 3, 1.485): 0 -> 0, 70 -> 42, 210 -> 125. The Groveheart primary factor
  // is 1.05 (spec_output_tuning.ts; retuned down from an initial 1.20
  // candidate once this replant SP-rider fix was in, per class-balance-v042.md's
  // "do not silently stack a full buff on a large bug fix") and scales the
  // WHOLE (hotBase + hotSp) sum once, so the per-arm literals below are
  // computed as round((21 + hotSp) * 1.05) rather than as a delta off the
  // zero arm: rounding the sum once, instead of rounding the rider alone and
  // adding a separately-rounded base, is not exactly linear, so a
  // delta-style assertion here would drift by rounding noise instead of
  // proving the actual formula.
  function replantTickValue(arm: StatArm | 'zero'): { value: number } {
    const sim = new Sim({ seed: 25, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(10);
    expect(sim.setSpec('restoration')).toBe(true);
    const p = sim.player;
    if (arm === 'zero') {
      p.spellPower = 0;
      p.healPower = 0;
    } else {
      applyArm(p, arm);
    }
    resolveDruidOverbloom(sim.ctx, p, p, 0.6);
    const hot = p.auras.find((aura) => aura.id === 'rejuvenation' && aura.kind === 'hot');
    if (!hot) throw new Error('no replanted rejuvenation');
    // Pin the coefficient inputs so the literal riders above cannot silently
    // drift against a re-authored duration or interval.
    expect(hot.duration).toBe(12);
    expect(hot.tickInterval).toBe(3);
    return { value: hot.value };
  }

  it('a flat Healing Power delta adds exactly the split DoT-coefficient rider, then the Groveheart factor once', () => {
    expect(replantTickValue('zero').value).toBe(22); // round((21 + 0) * 1.05)
    expect(replantTickValue('baseline').value).toBe(66); // round((21 + 42) * 1.05)
    expect(replantTickValue('healingPowerBoost').value).toBe(153); // round((21 + 125) * 1.05)
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(replantTickValue('spellPowerRaised').value).toBe(66);
  });
});

describe('Paladin Aegis reads healPower (paladin_aegis tick and final burst)', () => {
  // Aegis of the First Dawn: channel duration 5 clamps to the 3.5 coefficient
  // cap over 5 ticks, so each tick rider is round(healPower * 0.2)
  // (70 -> 14, 210 -> 42) on the 35 to 45 base (midpoint 40); the completion
  // burst rider is directHealBonus(healPower, 0, aoe) =
  // round(healPower * 2 * (1.5/3.5) * 0.333) (70 -> 20, 210 -> 60) on the
  // 120 to 150 base (midpoint 135). Holy carries no legacy talent heal
  // multiplier here (paladin has no spec_baselines.ts entry and no row grants
  // aegis_first_dawn an ability mod), but the v0.42.0 Sunmender primary
  // factor (1.10) scales the WHOLE raw tick/burst packet once: tick =
  // round((40 + rider) * 1.10), burst = round((135 + rider) * 1.10). Read the
  // heal2 events (the ally cannot hold a maxHp poke: the protection aura's
  // recalc rescales hp by fraction), re-hurting the ally each step so no heal
  // clamps against the real pool.
  function allyAegisHeals(arm: StatArm): number[] {
    const sim = new Sim({ seed: 29, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const allyId = sim.addPlayer('priest', 'Dawn Ally');
    sim.setPlayerLevel(20, allyId);
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = entity(sim, allyId);
    ally.pos = { ...sim.player.pos };
    const p = sim.player;
    p.resource = p.maxResource;
    applyArm(p, arm);
    pinRng(sim);
    castAbility(sim.ctx, 'aegis_first_dawn', p.id);
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error(`missing player meta ${p.id}`);
    let guard = 0;
    while (p.castingAbility && guard++ < 400) {
      applyArm(p, arm);
      ally.hp = 1;
      updateCasting(sim.ctx, p, meta);
    }
    expect(p.castingAbility).toBeNull();
    return sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id ? [event.amount] : [],
    );
  }

  it('a flat Healing Power delta adds exactly the tick and burst riders, then the Sunmender factor once', () => {
    // baseline: tick round((40+14)*1.10)=59, burst round((135+20)*1.10)=171.
    expect(allyAegisHeals('baseline')).toEqual([59, 59, 59, 59, 59, 171]);
    // healingPowerBoost: tick round((40+42)*1.10)=90, burst round((135+60)*1.10)=215.
    expect(allyAegisHeals('healingPowerBoost')).toEqual([90, 90, 90, 90, 90, 215]);
  });

  it('raw spellPower with healPower held changes nothing', () => {
    expect(allyAegisHeals('spellPowerRaised')).toEqual([59, 59, 59, 59, 59, 171]);
  });
});
