// Pure, host-agnostic helper that folds the CURRENT character's Spell Power /
// Ranged Attack Power / Attack Power into an ability's displayed damage, so the
// action-bar and spellbook tooltips show the real numbers a cast will land (and
// they update live as gear changes). It reuses the EXACT sim coefficient helpers
// (src/sim/spell_scaling.ts) so the tooltip can never drift from what combat does.
//
// v0.42.0 (docs/design/class-balance-v042.md): the rider below also folds in
// `res.outputScaling` (src/sim/ability_output_scaling.ts), the same resolved
// talent/mastery multiplier and dotDmgPct/hotHealPct/absorbPct global the
// matching combat call site applies. A missing `outputScaling` (a mob/pet
// ability) takes the all-1 neutral default, matching pre-v0.42 behavior.
//
// This only changes the NUMBERS spliced into the description placeholders ($d
// damage, $o over-time total, $b buff value, $t duration), never adds a string,
// so it needs no new i18n keys. It also owns the placeholder EFFECT PICKERS
// (which effect each placeholder reads), so ability_description.ts and the tooltip-consistency
// guard test share one definition and cannot drift. Unit-tested in
// tests/ability_damage.test.ts and tests/v042_balance_tooltips.test.ts;
// hud.ts is the thin consumer.
import type { AbilityOutputScaling } from '../sim/ability_output_scaling';
import type { ResolvedAbility } from '../sim/sim';
import {
  abilityScalingPower,
  absorbBonus,
  channelTickBonus,
  directHealBonus,
  directHitBonus,
  dotTickBonus,
  hotTickBonus,
} from '../sim/spell_scaling';
import type { AbilityEffect, Entity } from '../sim/types';

// The all-1 fallback used everywhere `res.outputScaling` is absent (a mob/pet
// ability, or a caller resolved before this metadata existed): reproduces the
// pre-v0.42 tooltip numbers exactly.
const NEUTRAL_OUTPUT_SCALING: AbilityOutputScaling = {
  damage: 1,
  healing: 1,
  dot: 1,
  hot: 1,
  absorb: 1,
  primaryHealing: 1,
};

/** The character's live scaling ratings (entity.spellPower / healPower /
 *  rangedPower / attackPower). healPower feeds the heal, HoT, and absorb
 *  arms, mirroring the sim's heal riders; damage arms read spellPower. */
export interface AbilityScaling {
  spellPower: number;
  healPower: number;
  rangedPower: number;
  attackPower: number;
}

/** Build the scaling snapshot from a live entity: the ONE constructor, so a
 *  consumer (the HUD tooltips) can never miss a scaling field. */
export function abilityScalingOf(
  e: Pick<Entity, 'spellPower' | 'healPower' | 'rangedPower' | 'attackPower'>,
): AbilityScaling {
  return {
    spellPower: e.spellPower,
    healPower: e.healPower,
    rangedPower: e.rangedPower,
    attackPower: e.attackPower,
  };
}

/** Flat bonus this character adds to ONE displayed hit of `eff` (or, for a DoT, to
 *  its whole `total`), matching combat. 0 when the effect does not scale. */
export function abilityDamageBonus(
  res: ResolvedAbility,
  eff: AbilityEffect,
  scaling: AbilityScaling,
): number {
  const def = res.def;
  const out = res.outputScaling ?? NEUTRAL_OUTPUT_SCALING;
  // Finishers (Eviscerate, Ferocious Bite) fold Attack Power into the listed
  // damage via the sim's effectiveAttackPower / 14 path, separate from the
  // coefficient model below; only physical finishers get it. Combat
  // (effect_dispatch.ts 'finisherDamage') multiplies this rider by the same
  // resolved talent damage multiplier as every other damage rider.
  if (eff.type === 'finisherDamage') {
    return def.school === 'physical' ? Math.round((scaling.attackPower / 14) * out.damage) : 0;
  }
  // A weaponStrike / weaponDamage listed number is its flat bonus; Attack Power
  // rides the weapon swing (shown on the character sheet), so it falls through to
  // the switch default (0) here. Every other rider scales: Spell Power for spells,
  // Ranged AP for hunter shots, melee Attack Power for physical specials.
  const power = abilityScalingPower(scaling, def);
  switch (eff.type) {
    case 'directDamage':
      // A channelled directDamage (Arcane Missiles) is a per-tick hit: it uses the
      // channel coefficient in combat, not the single-cast one.
      return def.channel
        ? channelTickBonus(power, def, out.damage)
        : directHitBonus(power, def, res.castTime, false, out.damage, eff.spellPowerCoeff);
    case 'aoeDamage':
    case 'aoeRoot':
    case 'chainDamage':
      // A channelled AoE (Rain of Fire, Hurricane, Volley) pulses through the
      // channel-tick path in casting_lifecycle, which adds channelTickBonus to
      // each pulse, not the single-cast AoE coefficient. chainDamage (Hallowed Wall
      // bounce) is a one-shot AoE hit, so it takes the same AoE coefficient.
      return def.channel
        ? channelTickBonus(power, def, out.damage)
        : directHitBonus(power, def, res.castTime, true, out.damage);
    case 'groundAoE':
      // Each ground pulse is an AoE hit: effect_dispatch snapshots
      // directHitBonus(..., aoe) into the zone's spBonus at cast time.
      return directHitBonus(power, def, res.castTime, true, out.damage);
    case 'valkyrsCalling':
      // The delayed landing owns its authored range in the movement system.
      return 0;
    case 'aoeHeal':
      // A self-centered healing channel (Gladesong/Tranquility) pulses via
      // channelTickBonus each tick (casting_lifecycle.ts); an instant aoeHeal
      // takes the AoE-penalised direct coefficient instead (effect_dispatch.ts,
      // aoe=true). A prior version of this helper always used the instant
      // path with aoe=FALSE, over-reporting both.
      return def.channel
        ? channelTickBonus(scaling.healPower, def, out.healing)
        : directHealBonus(scaling.healPower, res.castTime, true, out.healing);
    case 'chainHeal':
      // Combat applies the full direct-heal coefficient to the first target,
      // then applies the authored falloff to each jump.
      return directHealBonus(scaling.healPower, res.castTime, false, out.healing);
    case 'consumeAura':
      if (eff.deal) return directHitBonus(power, def, res.castTime, false, out.damage);
      if (eff.heal) return directHealBonus(scaling.healPower, res.castTime, false, out.healing);
      return 0;
    case 'heal':
      // Combat adds the direct-heal rider (full cast-time coefficient off Spell
      // Power, no AP scale-down) to every direct heal in effect_dispatch.
      return directHealBonus(scaling.healPower, res.castTime, false, out.healing);
    case 'absorb':
      return absorbBonus(scaling.healPower, eff.spellPowerCoeff ?? 0, out.absorb);
    case 'hot': {
      // A HoT that rides a direct heal (Regrowth) does NOT scale in combat (the
      // direct part already took the coefficient); only pure HoTs (Rejuvenation)
      // take the per-tick rider. The tooltip shows the TOTAL, so the per-tick
      // bonus is multiplied across all ticks, mirroring the dot case below.
      const hybridHeal = res.effects.some((e) => e.type === 'heal');
      if (hybridHeal) return 0;
      const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
      return hotTickBonus(scaling.healPower, eff.duration, eff.interval, out.hot) * ticks;
    }
    case 'drainTick':
      return channelTickBonus(power, def, out.damage);
    case 'dot': {
      // A DoT that rides a direct/AoE nuke (hybrid) does NOT scale its rider in the
      // sim (the direct part already took the coefficient), so the tooltip must not
      // show one either. Match combat's `hybrid` test in effect_dispatch.ts.
      const hybrid = res.effects.some(
        (e) => e.type === 'directDamage' || e.type === 'aoeDamage' || e.type === 'aoeRoot',
      );
      if (hybrid) return 0;
      // The tooltip shows the DoT's TOTAL; the sim adds the per-tick bonus to each
      // tick, so the total gains per-tick-bonus * tick-count.
      const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
      return dotTickBonus(power, def, eff.duration, eff.interval, out.dot) * ticks;
    }
    case 'hunterBloodhook':
      return Math.round(scaling.rangedPower * eff.rangedPowerCoeff * (eff.damageMult ?? 1));
    case 'hunterStampede':
      return Math.round(scaling.rangedPower * eff.rangedPowerCoeff);
    case 'afflictionLitany':
      // Litany is a flat, rank-resolved pulse. It gains Hexcraft's ability
      // modifier during resolution but has no Spell Power coefficient.
      return 0;
    default:
      return 0;
  }
}

/** The v0.42 primary-healing spec factor (Spiritmend, Sunmender, Groveheart;
 *  `res.outputScaling.primaryHealing`, matching primary_healing.ts's
 *  `scalePrimaryHealing`) folded onto the COMPLETE base-plus-power heal or
 *  HoT amount, exactly once, after the whole raw packet, before crit/target
 *  resolution: the same placement combat uses. Returns null when the factor
 *  is 1, or the effect never takes it (a fixed max-HP heal/HoT, since combat
 *  cannot know the target's max HP from an `AbilityScaling` snapshot either).
 *
 *  A hybrid HoT (Regrowth) DOES take the factor on its flat per-tick base
 *  even though its SP rider is suppressed to 0 (effect_dispatch.ts's 'hot'
 *  case scales `hotBase + hotSp` unconditionally, only pctOfMax opts out);
 *  `abilityDamageBonus` already returns 0 for the rider in that case, so no
 *  extra branch is needed here beyond the pctOfMax check.
 *
 *  The combined `hot` amount is computed at the PER-TICK level, not by
 *  scaling the authored total directly: combat rounds
 *  `round(total / ticks) + hotTickBonus(...)` once per tick, applies the
 *  factor to THAT amount, then multiplies by the tick count. */
export function abilityPrimaryHealingTotal(
  res: ResolvedAbility,
  eff: AbilityEffect,
  scaling: AbilityScaling,
): { min: number; max: number } | null {
  const factor = res.outputScaling?.primaryHealing ?? 1;
  if (factor === 1) return null;
  switch (eff.type) {
    case 'heal': {
      if (eff.casterMaxHpPct !== undefined) return null;
      const bonus = abilityDamageBonus(res, eff, scaling);
      return {
        min: Math.round((eff.min + bonus) * factor),
        max: Math.round((eff.max + bonus) * factor),
      };
    }
    case 'chainHeal':
    case 'aoeHeal': {
      const bonus = abilityDamageBonus(res, eff, scaling);
      return {
        min: Math.round((eff.min + bonus) * factor),
        max: Math.round((eff.max + bonus) * factor),
      };
    }
    case 'consumeAura': {
      if (!eff.heal) return null;
      const bonus = abilityDamageBonus(res, eff, scaling);
      return {
        min: Math.round((eff.heal.min + bonus) * factor),
        max: Math.round((eff.heal.max + bonus) * factor),
      };
    }
    case 'hot': {
      if (eff.pctOfMax !== undefined) return null;
      const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
      const tickBase = Math.max(1, Math.round(eff.total / ticks));
      const tickBonus = abilityDamageBonus(res, eff, scaling) / ticks;
      const tick = Math.round((tickBase + tickBonus) * factor);
      const total = tick * ticks;
      return { min: total, max: total };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Placeholder effect pickers. These define which resolved effect each tooltip
// placeholder reads; hud.ts formats the picked effect and the consistency guard
// (tests/ability_tooltip_consistency.test.ts) asserts every placeholder used in
// a description is resolvable, so a description can never render an empty or
// wrong-effect number again.

/** The effect `$d` displays: the first direct hit / heal / listed bonus. */
export function abilityPrimaryEffect(res: ResolvedAbility): AbilityEffect | undefined {
  return res.effects.find(
    (eff) =>
      eff.type === 'directDamage' ||
      eff.type === 'heal' ||
      eff.type === 'weaponDamage' ||
      eff.type === 'weaponStrike' ||
      eff.type === 'aoeDamage' ||
      eff.type === 'aoeHeal' ||
      eff.type === 'chainHeal' ||
      eff.type === 'aoeRoot' ||
      eff.type === 'chainDamage' ||
      eff.type === 'groundAoE' ||
      eff.type === 'valkyrsCalling' ||
      (eff.type === 'repositionToAim' && eff.landingAoe !== undefined) ||
      eff.type === 'consumeAura' ||
      eff.type === 'finisherDamage' ||
      eff.type === 'drainTick' ||
      eff.type === 'sunder' ||
      eff.type === 'faerieFire' ||
      eff.type === 'lifeTap' ||
      eff.type === 'hunterBloodhook' ||
      eff.type === 'hunterStampede' ||
      eff.type === 'afflictionLitany',
  );
}

/** The effect `$d` falls back to when the ability has no primary hit. */
export function abilitySecondaryEffect(res: ResolvedAbility): AbilityEffect | undefined {
  return res.effects.find(
    (eff) =>
      eff.type === 'dot' || eff.type === 'hot' || eff.type === 'absorb' || eff.type === 'imbue',
  );
}

/** The effect `$o` displays: the over-time rider (dot/hot) of a hybrid ability. */
export function abilityOverTimeEffect(
  res: ResolvedAbility,
): Extract<AbilityEffect, { type: 'dot' | 'hot' }> | undefined {
  const eff = res.effects.find((e) => e.type === 'dot' || e.type === 'hot');
  return eff as Extract<AbilityEffect, { type: 'dot' | 'hot' }> | undefined;
}

/** The value `$b` displays: the first self/target buff's (or AoE debuff shout's)
 *  resolved strength, so a ranked buff's prose (Iron Bellow's attack power,
 *  Wildward's armor, Direhowl's attack-power cut) can never drift from the rank
 *  the player actually knows. Null when the ability has none. */
export function abilityBuffValue(res: ResolvedAbility): number | null {
  for (const eff of res.effects) {
    // Overbloom's harvest fraction is its $b: the RESOLVED druidOverbloom
    // harvestPct as a whole percent, so the Grovespring 4pc's 75 shows live
    // for wearers the same way a talent-upgraded value would (base 60).
    if (eff.type === 'druidOverbloom') return Math.round(eff.harvestPct * 100);
    if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      // form_fireball carries a 1+fraction speed multiplier; the tooltip's $b%
      // wants the whole-percent bonus (1.4 -> 40).
      if (eff.kind === 'form_fireball') return (eff.value - 1) * 100;
      return eff.value;
    }
    if (eff.type === 'aoeAttackPower') {
      // The reworked shout (Direhowl) is a percentage damage cut (pct) rather than
      // the old flat attack-power drain (amount): show the whole-percent value the
      // player feels, so $b never renders the now-zero legacy amount.
      if (eff.pct != null) return Math.round(eff.pct * 100);
      return eff.amount ?? null;
    }
  }
  return null;
}

/** The `$b` value for an already-APPLIED aura, read straight off its live
 *  (kind, value) rather than re-resolved through anyone's talents. A buff/debuff
 *  tooltip viewed on another entity must show what that aura actually IS, not what
 *  the viewer's own copy of the ability would grant (Pact Deepened doubling
 *  Fiendhide's armor for its owner must still read doubled on every other
 *  player's screen). Mirrors abilityBuffValue's one non-identity case
 *  (form_fireball's multiplier -> whole-percent conversion) so the two functions
 *  can never disagree on the same aura. */
export function auraBuffDisplayValue(a: { kind: string; value: number }): number {
  if (a.kind === 'form_fireball') return (a.value - 1) * 100;
  return a.value;
}

/** The value `$t` displays: the first timed effect's resolved duration in seconds
 *  (rank-resolved, so Deep Gash's longer rank-3 bleed and Bewitch's longer rank-2
 *  sleep read true). Null when no effect carries a duration. */
export function abilityDurationValue(res: ResolvedAbility): number | null {
  for (const eff of res.effects) {
    // An extendDot's timed magnitude is its per-application extension cap in
    // seconds (Moonseed is the only extendDot user): $t prints the RESOLVED
    // maxBonus, so the Moonscorch 2pc's 12 shows live for wearers (base 6).
    if (eff.type === 'extendDot') return eff.maxBonus;
    if ('duration' in eff && typeof eff.duration === 'number') return eff.duration;
  }
  return null;
}

/** Dynamic percentages for the Hourglass tooltip, read from the resolved effect. */
export function abilityTemporalHourglassValues(res: ResolvedAbility): {
  healing: number;
  selfCooldownRecovery: number;
  allyCooldownRecovery: number;
  hostilePveDuration: number;
  hostilePvpDuration: number;
  groundDuration: number;
} | null {
  const effect = res.effects.find((candidate) => candidate.type === 'temporalHourglass');
  if (effect?.type !== 'temporalHourglass') return null;
  return {
    healing: effect.healMaxHpPct * 100,
    selfCooldownRecovery: (effect.selfCooldownRate - 1) * 100,
    allyCooldownRecovery: (effect.allyCooldownRate - 1) * 100,
    hostilePveDuration: effect.hostilePveDuration,
    hostilePvpDuration: effect.hostilePvpDuration,
    groundDuration: effect.groundDuration,
  };
}
