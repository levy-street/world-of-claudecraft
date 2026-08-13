import type { SpecDef, TalentEffect, TalentRowOption } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { abilityImageUrl, hasAbilityIconIdentity, type IconKind, iconDataUrl } from './icons';
import { specIconUrl } from './spec_icon_art';

export type TalentIconRef =
  | {
      kind: Extract<IconKind, 'ability' | 'crest'>;
      id: string;
    }
  | { kind: 'image'; url: string };

export type TalentSpecIconRef =
  | { kind: 'image'; url: string; fallback: TalentIconRef }
  | TalentIconRef
  | { kind: 'text'; text: string };

export const PALADIN_TALENT_IMAGE_IDS = new Set([
  'pal_r5_radiant_stride',
  'pal_r5_steadfast_step',
  'pal_r5_divine_steed',
  'pal_r8_enduring_protection',
  'pal_r8_steady_hands',
  'pal_r8_recurring_grace',
  'pal_r11_fist_of_justice',
  'pal_r11_double_sentence',
  'pal_r11_radiant_shackles',
  'pal_r14_zeal',
  'pal_r14_sacred_reserve',
  'pal_r14_divine_purpose',
  'pal_r17_extended_dawn',
  'pal_r17_radiant_wrath',
  'pal_r17_sanctified_fervor',
  'pal_r20_aura_mastery',
  'pal_r20_dawn_echo',
  'pal_r20_perpetual_sun',
]);

const TALENT_STAT_CREST: Record<string, string> = {
  armorPct: 'talent_armor',
  armor: 'talent_armor',
  crit: 'talent_crit',
  spellPower: 'talent_crit',
  int: 'talent_crit',
  spi: 'talent_crit',
  dodge: 'talent_dodge',
  agi: 'talent_dodge',
  ap: 'talent_ap',
  apPct: 'talent_ap',
  str: 'talent_ap',
  maxHpPct: 'talent_health',
  sta: 'talent_health',
  haste: 'talent_haste',
};

export function talentEffectIconRef(effect: TalentEffect | undefined): TalentIconRef {
  const chargeMod = effect?.ability?.find((mod) => mod.ability === 'charge');
  if (chargeMod?.bonusCharges) return { kind: 'ability', id: 'double_charge' };
  if (chargeMod?.addEffects?.length) return { kind: 'ability', id: 'crushing_charge' };

  const firstAbility = effect?.ability?.[0];
  if (firstAbility?.ability === 'blink' && firstAbility.bonusCharges) {
    return { kind: 'ability', id: 'double_blink' };
  }
  if (effect?.global?.blinkCast) return { kind: 'ability', id: 'blink_while_casting' };
  if (effect?.global?.barrierDrPct) return { kind: 'ability', id: 'warded' };
  if (
    effect?.ability?.some(
      (mod) =>
        mod.ability === 'ice_barrier' &&
        mod.addEffects?.some((added) => added.type === 'breakRoots'),
    )
  ) {
    return { kind: 'ability', id: 'temporal_rift' };
  }
  if (effect?.global?.convergence) return { kind: 'ability', id: 'elemental_convergence' };
  if (effect?.global?.manaDefCdrPer10) return { kind: 'ability', id: 'overflowing_power' };
  if (firstAbility?.ability === 'polymorph' && firstAbility.castPct === -1) {
    return { kind: 'ability', id: 'snap_polymorph' };
  }
  if (firstAbility?.ability === 'frost_nova' && firstAbility.bonusCharges) {
    return { kind: 'ability', id: 'twin_frost_nova' };
  }

  const abilityId = effect?.grant?.ability ?? firstAbility?.ability;
  if (abilityId && ABILITIES[abilityId]) return { kind: 'ability', id: abilityId };

  if (effect?.global?.bloodbathPct) return { kind: 'ability', id: 'bloodbath' };
  if (effect?.global?.cdrPerRage) return { kind: 'ability', id: 'colossal_might' };
  if (effect?.global?.secondWindPctPerSec) return { kind: 'ability', id: 'second_wind' };
  if (effect?.global?.onKillSpeedPct) return { kind: 'ability', id: 'pursuit' };
  if (effect?.global?.fearBreakPct) return { kind: 'ability', id: 'lingering_dread' };
  if (effect?.global?.autoRagePct || effect?.global?.abilityRagePct) {
    return { kind: 'ability', id: 'anger_management' };
  }
  if (effect?.global?.battleRhythm) return { kind: 'ability', id: 'battle_rhythm' };
  if (effect?.global?.stanceMastery) return { kind: 'ability', id: 'combat_mastery' };

  const stat = effect?.stats ? Object.keys(effect.stats)[0] : undefined;
  if (stat) return { kind: 'crest', id: TALENT_STAT_CREST[stat] ?? 'talent_generic' };
  if (effect?.global) {
    return {
      kind: 'crest',
      id: effect.global.threatPct ? 'talent_armor' : 'talent_crit',
    };
  }
  return { kind: 'crest', id: 'talent_choice' };
}

export function talentRowOptionIconRef(option: TalentRowOption): TalentIconRef {
  if (option.icon && PALADIN_TALENT_IMAGE_IDS.has(option.icon)) {
    return { kind: 'image', url: `/ui/skills/paladin/${option.icon}.webp` };
  }
  if (option.icon && abilityImageUrl(option.icon)) {
    return { kind: 'ability', id: option.icon };
  }
  // Classic choice rows carry an authored presentation icon. It is the source
  // of truth whenever painted art exists; effect-shape inference remains the
  // fallback for older rows (notably Warrior) that omit the field.
  if (option.icon && hasAbilityIconIdentity(option.icon)) {
    return { kind: 'ability', id: option.icon };
  }
  return talentEffectIconRef(option.effect);
}

export function talentSpecIconRef(spec: SpecDef): TalentSpecIconRef {
  const art = specIconUrl(spec);
  if (art) {
    return {
      kind: 'image',
      url: art,
      fallback: ABILITIES[spec.signature]
        ? { kind: 'ability', id: spec.signature }
        : { kind: 'crest', id: 'talent_choice' },
    };
  }
  if (ABILITIES[spec.signature]) return { kind: 'ability', id: spec.signature };
  return { kind: 'text', text: spec.icon };
}

/** CSS image stack with painted spec art above its configured signature fallback. */
export function talentSpecIconCssBackground(ref: TalentSpecIconRef): string | null {
  if (ref.kind === 'text') return null;
  if (ref.kind === 'image') {
    // Spec art carries a configured signature fallback; row art (the paladin
    // talent webps) is a bare image ref with no procedural fallback layer.
    return 'fallback' in ref
      ? `url(${ref.url}),url(${talentIconDataUrl(ref.fallback)})`
      : `url(${ref.url})`;
  }
  return `url(${talentIconDataUrl(ref)})`;
}

export function talentIconDataUrl(ref: TalentIconRef): string {
  if (ref.kind === 'image') return ref.url;
  return iconDataUrl(ref.kind, ref.id);
}

export function talentRowOptionIconDataUrl(option: TalentRowOption): string {
  return talentIconDataUrl(talentRowOptionIconRef(option));
}
