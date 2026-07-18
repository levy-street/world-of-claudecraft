// Pure, host-agnostic helper that folds the CURRENT character's Spell Power /
// Ranged Attack Power / Attack Power into an ability's displayed damage, so the
// action-bar and spellbook tooltips show the real numbers a cast will land (and
// they update live as gear changes). It reuses the EXACT sim coefficient helpers
// (src/sim/spell_scaling.ts) so the tooltip can never drift from what combat does.
//
// This only changes the NUMBERS spliced into the description placeholders ($d
// damage, $o over-time total, $b buff value, $t duration), never adds a string,
// so it needs no new i18n keys. It also owns the placeholder EFFECT PICKERS
// (which effect each placeholder reads), so hud.ts and the tooltip-consistency
// guard test share one definition and cannot drift. Unit-tested in
// tests/ability_damage.test.ts; hud.ts is the thin consumer.
import type { ResolvedAbility } from '../sim/sim';
import {
  abilityScalingPower,
  channelTickBonus,
  directHealBonus,
  directHitBonus,
  dotTickBonus,
  hotTickBonus,
} from '../sim/spell_scaling';
import type { AbilityEffect } from '../sim/types';

/** The character's live scaling ratings (entity.spellPower / rangedPower / attackPower). */
export interface AbilityScaling {
  spellPower: number;
  rangedPower: number;
  attackPower: number;
}

/** Flat bonus this character adds to ONE displayed hit of `eff` (or, for a DoT, to
 *  its whole `total`), matching combat. 0 when the effect does not scale. */
export function abilityDamageBonus(
  res: ResolvedAbility,
  eff: AbilityEffect,
  scaling: AbilityScaling,
): number {
  const def = res.def;
  // Finishers (Eviscerate, Ferocious Bite) fold Attack Power into the listed
  // damage via the sim's effectiveAttackPower / 14 path, separate from the
  // coefficient model below; only physical finishers get it.
  if (eff.type === 'finisherDamage') {
    return def.school === 'physical' ? Math.round(scaling.attackPower / 14) : 0;
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
        ? channelTickBonus(power, def)
        : directHitBonus(power, def, res.castTime, false);
    case 'aoeDamage':
    case 'aoeRoot':
    case 'chainDamage':
      // A channelled AoE (Rain of Fire, Hurricane, Volley) pulses through the
      // channel-tick path in casting_lifecycle, which adds channelTickBonus to
      // each pulse, not the single-cast AoE coefficient. chainDamage (Hallowed Wall
      // bounce) is a one-shot AoE hit, so it takes the same AoE coefficient.
      return def.channel
        ? channelTickBonus(power, def)
        : directHitBonus(power, def, res.castTime, true);
    case 'groundAoE':
      // Each ground pulse is an AoE hit: effect_dispatch snapshots
      // directHitBonus(..., aoe) into the zone's spBonus at cast time.
      return directHitBonus(power, def, res.castTime, true);
    case 'aoeHeal':
      // AoE heals take the same per-target coefficient penalty as aoeDamage.
      return directHealBonus(scaling.spellPower, res.castTime);
    case 'consumeAura':
      if (eff.deal) return directHitBonus(power, def, res.castTime, false);
      if (eff.heal) return directHealBonus(scaling.spellPower, res.castTime);
      return 0;
    case 'heal':
      // Combat adds the direct-heal rider (full cast-time coefficient off Spell
      // Power, no AP scale-down) to every direct heal in effect_dispatch.
      return directHealBonus(scaling.spellPower, res.castTime);
    case 'hot': {
      // A HoT that rides a direct heal (Regrowth) does NOT scale in combat (the
      // direct part already took the coefficient); only pure HoTs (Rejuvenation)
      // take the per-tick rider. The tooltip shows the TOTAL, so the per-tick
      // bonus is multiplied across all ticks, mirroring the dot case below.
      const hybridHeal = res.effects.some((e) => e.type === 'heal');
      if (hybridHeal) return 0;
      const ticks = eff.interval > 0 ? Math.max(1, eff.duration / eff.interval) : 1;
      return hotTickBonus(scaling.spellPower, eff.duration, eff.interval) * ticks;
    }
    case 'drainTick':
      return channelTickBonus(power, def);
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
      return dotTickBonus(power, def, eff.duration, eff.interval) * ticks;
    }
    default:
      return 0;
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
      eff.type === 'aoeRoot' ||
      eff.type === 'groundAoE' ||
      (eff.type === 'repositionToAim' && eff.landingAoe !== undefined) ||
      eff.type === 'consumeAura' ||
      eff.type === 'finisherDamage' ||
      eff.type === 'drainTick' ||
      eff.type === 'sunder' ||
      eff.type === 'faerieFire' ||
      eff.type === 'lifeTap',
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

/** The value `$t` displays: the first timed effect's resolved duration in seconds
 *  (rank-resolved, so Deep Gash's longer rank-3 bleed and Bewitch's longer rank-2
 *  sleep read true). Null when no effect carries a duration. */
export function abilityDurationValue(res: ResolvedAbility): number | null {
  for (const eff of res.effects) {
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
