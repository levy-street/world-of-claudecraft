// Display text for the Graveyard Shift side adventure: Morthen's mode-local kit
// and his identity aura. The kit is never in ABILITIES, so the shared name and
// description resolvers (ability_display_name.ts, ability_description.ts,
// aura_display_name.ts, cast_display_name.ts) ask this module before they fall
// back to a raw id. Every number in a description is read from the kit's own
// effects, so the tooltip cannot drift from what a cast does.

import { MORTHEN_KIT } from '../sim/graveyard_shift/kit';
import { morthenIdentityAura } from '../sim/graveyard_shift/morthen_identity';
import type { AbilityDef, AbilityEffect } from '../sim/types';
import { formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';

interface KitText {
  readonly name: TranslationKey;
  readonly description: TranslationKey;
}

const KIT_TEXT: Readonly<Record<string, KitText>> = {
  gshift_gravecall: {
    name: 'devCommand.graveyardShift.abilities.gravecall.name',
    description: 'devCommand.graveyardShift.abilities.gravecall.description',
  },
  gshift_shadow_pulse: {
    name: 'devCommand.graveyardShift.abilities.shadowPulse.name',
    description: 'devCommand.graveyardShift.abilities.shadowPulse.description',
  },
  gshift_sextons_chain: {
    name: 'devCommand.graveyardShift.abilities.sextonsChain.name',
    description: 'devCommand.graveyardShift.abilities.sextonsChain.description',
  },
  gshift_barrow_shroud: {
    name: 'devCommand.graveyardShift.abilities.barrowShroud.name',
    description: 'devCommand.graveyardShift.abilities.barrowShroud.description',
  },
};

const IDENTITY_AURA_KEY: TranslationKey = 'devCommand.graveyardShift.identityAura';
const IDENTITY_AURA_NAME = morthenIdentityAura(0).name;

const KIT_BY_ID: ReadonlyMap<string, AbilityDef> = new Map(MORTHEN_KIT.map((def) => [def.id, def]));
// The English names the sim stamps on combat events and on the auras a kit cast
// applies (a selfBuff, a daze, a silence all carry the ability's name).
const KIT_ID_BY_NAME: ReadonlyMap<string, string> = new Map(
  MORTHEN_KIT.map((def) => [def.name, def.id]),
);

export function isGraveyardShiftAbilityId(id: string): boolean {
  return KIT_BY_ID.has(id);
}

/** The localized kit ability name, or null for any id outside the kit. */
export function graveyardShiftAbilityName(id: string): string | null {
  const text = KIT_BY_ID.has(id) ? KIT_TEXT[id] : undefined;
  return text ? t(text.name) : null;
}

/** The localized kit ability name for the English name an event carries. */
export function graveyardShiftAbilityNameFromSource(name: string): string | null {
  const id = KIT_ID_BY_NAME.get(name);
  return id === undefined ? null : graveyardShiftAbilityName(id);
}

/** The localized name of an aura this mode applies: the identity, or a kit aura
 *  (which carries its ability's English name). Null for every other aura. */
export function graveyardShiftAuraName(name: string): string | null {
  if (name === IDENTITY_AURA_NAME) return t(IDENTITY_AURA_KEY);
  return graveyardShiftAbilityNameFromSource(name);
}

function effectOf<K extends AbilityEffect['type']>(
  def: AbilityDef,
  type: K,
): Extract<AbilityEffect, { type: K }> | undefined {
  return def.effects.find((effect): effect is Extract<AbilityEffect, { type: K }> => {
    return effect.type === type;
  });
}

function amount(value: number | undefined): string {
  return value === undefined ? '' : formatNumber(value, { maximumFractionDigits: 1 });
}

function percent(fraction: number | undefined): string {
  return fraction === undefined ? '' : formatNumber(fraction, { style: 'percent' });
}

/** A slow stored as a speed multiplier (0.7) reads as the speed it takes away (30%). */
function slowPercent(speedMult: number | undefined): string {
  return speedMult === undefined ? '' : percent(1 - speedMult);
}

function descriptionValues(def: AbilityDef): InterpolationValues {
  switch (def.id) {
    case 'gshift_gravecall': {
      const hit = effectOf(def, 'directDamage');
      return {
        min: amount(hit?.min),
        max: amount(hit?.max),
        dread: amount(effectOf(def, 'gainResource')?.amount),
      };
    }
    case 'gshift_shadow_pulse': {
      const blast = effectOf(def, 'aoeDamage');
      const push = effectOf(def, 'aoeKnockback');
      return {
        min: amount(blast?.min),
        max: amount(blast?.max),
        radius: amount(blast?.radius),
        distance: amount(push?.distance),
        slow: slowPercent(push?.dazeMult),
        slowSeconds: amount(push?.dazeDuration),
      };
    }
    case 'gshift_sextons_chain': {
      const pull = effectOf(def, 'pullTarget');
      return {
        stop: amount(pull?.stopDistance),
        slow: slowPercent(pull?.slowMult),
        slowSeconds: amount(pull?.slowDuration),
        lockout: amount(effectOf(def, 'interrupt')?.lockout),
        silence: amount(effectOf(def, 'silence')?.duration),
      };
    }
    case 'gshift_barrow_shroud': {
      const shroud = effectOf(def, 'selfBuff');
      return { pct: percent(shroud?.value), seconds: amount(shroud?.duration) };
    }
    default:
      return {};
  }
}

/** The localized kit tooltip prose with the kit's own numbers, or null outside the kit. */
export function graveyardShiftAbilityDescription(id: string): string | null {
  const def = KIT_BY_ID.get(id);
  const text = def ? KIT_TEXT[id] : undefined;
  if (!def || !text) return null;
  return t(text.description, descriptionValues(def));
}
