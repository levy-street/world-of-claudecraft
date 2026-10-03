// Display text for the Graveyard Shift side adventure: Morthen's mode-local kit
// and his identity aura. The kit is never in ABILITIES, so the shared name and
// description resolvers (ability_display_name.ts, ability_description.ts,
// aura_display_name.ts, cast_display_name.ts) ask this module before they fall
// back to a raw id. Every number in a description is read from the kit's own
// effects, so the tooltip cannot drift from what a cast does.

import { adventurerMarkerAura } from '../sim/graveyard_shift/hostility';
import { MORTHEN_KIT, soloEffect } from '../sim/graveyard_shift/kit';
import { morthenIdentityAura } from '../sim/graveyard_shift/morthen_identity';
import type { AbilityDef, AbilityEffect } from '../sim/types';
import { formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';

interface KitText {
  readonly name: TranslationKey;
  readonly description: TranslationKey;
}

const KIT_TEXT: Readonly<Record<string, KitText>> = {
  gshift_shadow_pulse: {
    name: 'devCommand.graveyardShift.abilities.shadowPulse.name',
    description: 'devCommand.graveyardShift.abilities.shadowPulse.description',
  },
  gshift_sextons_chain: {
    name: 'devCommand.graveyardShift.abilities.sextonsChain.name',
    description: 'devCommand.graveyardShift.abilities.sextonsChain.description',
  },
  gshift_raise_fallen: {
    name: 'devCommand.graveyardShift.abilities.raiseFallen.name',
    description: 'devCommand.graveyardShift.abilities.raiseFallen.description',
  },
};

const ADVENTURER_AURA_KEY: TranslationKey = 'devCommand.graveyardShift.adventurerAura';
const ADVENTURER_AURA_NAME = adventurerMarkerAura(0).name;

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
  if (name === ADVENTURER_AURA_NAME) return t(ADVENTURER_AURA_KEY);
  return graveyardShiftAbilityNameFromSource(name);
}

// The effect as it lands: the kit's known list carries every effect through the
// solo multiplier (kit.ts soloEffect), so tooltips read the resolved numbers.
function effectOf<K extends AbilityEffect['type']>(
  def: AbilityDef,
  type: K,
): Extract<AbilityEffect, { type: K }> | undefined {
  const found = def.effects.find((effect) => effect.type === type);
  return found ? (soloEffect(found) as Extract<AbilityEffect, { type: K }>) : undefined;
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
    case 'gshift_raise_fallen': {
      const raise = effectOf(def, 'gshiftRaiseFallen');
      return { radius: amount(raise?.radius), seconds: amount(raise?.duration) };
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
