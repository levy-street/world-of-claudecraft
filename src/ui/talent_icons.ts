import { ABILITIES } from '../sim/data';
import type { TalentChoiceOption, TalentEffect, TalentNode } from '../sim/content/talents';
import { iconDataUrl, type IconKind } from './icons';

export interface TalentIconRef {
  kind: Extract<IconKind, 'ability' | 'crest'>;
  id: string;
}

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

const DEMON_HUNTER_TALENT_ABILITY_ICON: Record<string, string> = {
  dh_fel_concentration: 'chaos_strike',
  dh_heightened_senses: 'blur',
  dh_demonic_tactics: 'chaos_strike',
  dh_demonic_resilience: 'metamorphosis',
  dh_weapon_mastery: 'blade_dance',
  dh_dark_arts: 'eye_beam',
  dh_elusiveness: 'blur',
  dh_metamorphosis: 'metamorphosis',
  dh_devastation_cruelty: 'chaos_strike',
  dh_devastation_devastation: 'chaos_strike',
  dh_devastation_bane: 'throw_glaive',
  dh_devastation_flurry: 'blade_dance',
  dh_devastation_cold_blood: 'demon_bite',
  dh_devastation_cataclysm: 'chaos_strike',
  dh_cb_crit: 'chaos_strike',
  dh_cb_ap: 'blade_dance',
  dh_cb_chaos: 'chaos_strike',
  dh_vengeance_toughness: 'metamorphosis',
  dh_vengeance_deflection: 'blur',
  dh_vengeance_ardent_defender: 'metamorphosis',
  dh_vengeance_bulwark: 'blur',
  dh_vengeance_anticipation: 'sigil_of_flame',
  dh_vengeance_vengeance: 'immolation_aura',
  dh_ant_health: 'metamorphosis',
  dh_ant_armor: 'blur',
  dh_ant_threat: 'immolation_aura',
  dh_meta_knowledge: 'eye_beam',
  dh_meta_embrace: 'metamorphosis',
  dh_meta_resilience: 'metamorphosis',
  dh_meta_tactics: 'eye_beam',
  dh_meta_fel_stamina: 'fel_rush',
  dh_meta_metamorphosis: 'metamorphosis',
  dh_fs_power: 'eye_beam',
  dh_fs_health: 'metamorphosis',
  dh_fs_resilience: 'blur',
};

function demonHunterTalentIconRef(id: string): TalentIconRef | null {
  const abilityId = DEMON_HUNTER_TALENT_ABILITY_ICON[id];
  return abilityId ? { kind: 'ability', id: abilityId } : null;
}
export function talentEffectIconRef(effect: TalentEffect | undefined, kind: TalentNode['kind'] | 'choice'): TalentIconRef {
  const abilityId = effect?.grant?.ability ?? effect?.ability?.[0]?.ability;
  if (abilityId && ABILITIES[abilityId]) return { kind: 'ability', id: abilityId };

  const stat = effect?.stats ? Object.keys(effect.stats)[0] : undefined;
  if (stat) return { kind: 'crest', id: TALENT_STAT_CREST[stat] ?? 'talent_generic' };

  if (effect?.global) return { kind: 'crest', id: effect.global.threatPct ? 'talent_armor' : 'talent_crit' };
  return { kind: 'crest', id: kind === 'choice' ? 'talent_choice' : 'talent_generic' };
}

export function talentNodeIconRef(node: TalentNode): TalentIconRef {
  return demonHunterTalentIconRef(node.id) ?? talentEffectIconRef(node.effect, node.kind);
}

export function talentChoiceIconRef(choice: TalentChoiceOption): TalentIconRef {
  return demonHunterTalentIconRef(choice.id) ?? talentEffectIconRef(choice.effect, 'choice');
}

export function talentIconDataUrl(ref: TalentIconRef): string {
  return iconDataUrl(ref.kind, ref.id);
}

export function talentNodeIconDataUrl(node: TalentNode): string {
  return talentIconDataUrl(talentNodeIconRef(node));
}

export function talentChoiceIconDataUrl(choice: TalentChoiceOption): string {
  return talentIconDataUrl(talentChoiceIconRef(choice));
}
