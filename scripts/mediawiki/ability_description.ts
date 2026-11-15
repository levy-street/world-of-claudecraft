// A static wiki has no current character's Ranged Attack Power. Keep Bear Trap's
// live tooltip placeholder in game, but label its zero-power reference total in
// the article and explain the same per-tick rounding that combat uses.
import { hunterTrapBleedAmounts } from '../../src/sim/combat/hunter_trap_bleed';
import { ABILITIES } from '../../src/sim/data';
import type { ResolvedAbility } from '../../src/sim/resolved_ability';
import type { AbilityDef } from '../../src/sim/types';
import type { AbilityScaling } from '../../src/ui/ability_damage';
import { abilityDisplayDescription, abilityEffectText } from '../../src/ui/ability_description';

export function mediawikiAbilityDescription(ability: AbilityDef): string {
  if (ability.id !== 'bear_trap') return ability.description;
  const effect = ability.effects.find((candidate) => candidate.type === 'hunterBearTrap');
  if (!effect) throw new Error('Bear Trap wiki description requires its bleed effect');
  const { total, ticks } = hunterTrapBleedAmounts({
    total: effect.bleedTotal,
    duration: effect.bleedDuration,
    interval: effect.bleedInterval,
  });
  return (
    ability.description.replace(
      'bleeds for $d Physical damage',
      `bleeds for ${total} Physical damage at zero Ranged Attack Power`,
    ) +
    ` The bleed deals damage ${ticks} times, once every ${effect.bleedInterval} sec. Each tick is rounded to a whole number.`
  );
}

// The in-game description is hand-written prose with a few numbers spliced in. A few of
// its fixed numbers (a weapon percent, a hit that cannot be filled in) can fall behind the
// ability data. The article's Scaling section is built from the data, so the description
// is brought in line with it here, and an empty number is filled from the same data.
const pctText = (fraction: number) => String(Number((fraction * 100).toFixed(1)));

function orbDamageText(res: ResolvedAbility): string {
  const orb = res.effects.find((e) => e.type === 'frozenOrb');
  return orb ? `${orb.min} to ${orb.max}` : '';
}

function reconcile(res: ResolvedAbility, text: string): string {
  let out = text;
  const strikes = res.effects.filter((e) => e.type === 'weaponStrike');
  if (
    strikes.length &&
    strikes.every((e) => (e.weaponMult ?? 1) === (strikes[0].weaponMult ?? 1))
  ) {
    const pct = pctText(strikes[0].weaponMult ?? 1);
    if (/\d+(?:\.\d+)?% weapon damage/.test(out))
      out = out.replace(/\d+(?:\.\d+)?% weapon damage/, `${pct}% weapon damage`);
    else if (pct !== '100') out = out.replace(/(?<!% )\bweapon damage\b/, `${pct}% weapon damage`);
  }
  const hex = res.effects.find((e) => e.type === 'afflictionViolence');
  if (hex) {
    out = out
      .replace('dealing Shadow damage', `dealing ${hex.damage} Shadow damage`)
      .replace(/lash it for \d+ Shadow damage/, `lash it for ${hex.damage} Shadow damage`);
  }
  if (res.def.id === 'deep_wounds') {
    const bleed = ABILITIES.mortal_strike?.effects.find((e) => e.type === 'dot');
    if (bleed)
      out = out.replace(
        'bleeding for Physical damage',
        `bleeding for ${bleed.total} Physical damage`,
      );
  }
  // Some Paladin text writes distances in meters; every range, radius and stat in the
  // game and on the wiki is in yards.
  return out.replace(/(\d+(?:\.\d+)?)[ -](?:m|meters?)\b/g, '$1 yd');
}

/** The ability description as the wiki shows it: the game's own text, with a stale or
 *  missing number replaced by the one the ability data holds. */
export function wikiAbilityText(res: ResolvedAbility, scaling?: AbilityScaling): string {
  const effectText = abilityEffectText(res, scaling) || orbDamageText(res);
  return reconcile(res, abilityDisplayDescription(res, effectText, scaling));
}
