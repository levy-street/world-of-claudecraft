import type { SpecDef, TalentEffect, TalentRowOption } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { type IconKind, iconDataUrl } from './icons';

export interface TalentIconRef {
  kind: Extract<IconKind, 'ability' | 'crest'>;
  id: string;
}

export type TalentSpecIconRef =
  | { kind: 'image'; url: string }
  | TalentIconRef
  | { kind: 'text'; text: string };

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

const WARRIOR_SPEC_ART = new Set(['arms', 'fury', 'prot']);
const MAGE_SPEC_ART = new Set(['arcane', 'fire', 'frost']);

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
  if (effect?.global?.temporalRift) return { kind: 'ability', id: 'temporal_rift' };
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
    return { kind: 'crest', id: effect.global.threatPct ? 'talent_armor' : 'talent_crit' };
  }
  return { kind: 'crest', id: 'talent_choice' };
}

export function talentRowOptionIconRef(option: TalentRowOption): TalentIconRef {
  return talentEffectIconRef(option.effect);
}

export function talentSpecIconRef(spec: SpecDef): TalentSpecIconRef {
  if (spec.class === 'warrior' && WARRIOR_SPEC_ART.has(spec.id)) {
    return { kind: 'image', url: `/ui/specs/warrior/${spec.id}.webp` };
  }
  if (spec.class === 'mage' && MAGE_SPEC_ART.has(spec.id)) {
    return { kind: 'image', url: `/ui/specs/mage/${spec.id}.png` };
  }
  if (ABILITIES[spec.signature]) return { kind: 'ability', id: spec.signature };
  return { kind: 'text', text: spec.icon };
}

export function talentIconDataUrl(ref: TalentIconRef): string {
  return iconDataUrl(ref.kind, ref.id);
}

export function talentRowOptionIconDataUrl(option: TalentRowOption): string {
  return talentIconDataUrl(talentRowOptionIconRef(option));
}
