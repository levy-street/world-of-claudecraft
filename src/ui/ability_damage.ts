// Pure, host-agnostic helper that folds the CURRENT character's Spell Power /
// Ranged Attack Power / Attack Power into an ability's displayed damage, so the
// action-bar and spellbook tooltips show the real numbers a cast will land (and
// they update live as gear changes). It reuses the EXACT sim coefficient helpers
// (src/sim/spell_scaling.ts) so the tooltip can never drift from what combat does.
//
// This only changes the NUMBER spliced into the existing `$d` damage placeholder,
// never adds a string, so it needs no new i18n keys. Unit-tested in
// tests/ability_damage.test.ts; hud.ts is the thin consumer.
import type { ResolvedAbility } from '../sim/sim';
import {
  abilityScalingPower,
  channelTickBonus,
  directHitBonus,
  dotTickBonus,
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
      return directHitBonus(power, def, res.castTime, true);
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
