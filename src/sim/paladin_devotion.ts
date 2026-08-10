import type { GroundAoE } from './entity_roster';
import type { ResolvedAbility } from './sim';
import type { Aura, Entity } from './types';

export const MAX_DEVOTION = 20;
export const ASCENSION_CHARGES = 5;
export const ASCENSION_DURATION = 45;
export const DIVINE_ASCENSION_AURA_ID = 'divine_ascension';
export const ASCENSION_DEVOTION_BANK_CAP = 0;
export const BLOCK_DEVOTION_ICD = 6;
// Divine Ascension (Amanecer) talent riders, applied at activation:
export const DAWNS_PATH_SPEED_MULT = 1.4; // Dawn's Path: +40% movement speed
export const DAWNS_PATH_SPEED_DURATION = 6;
export const AEGIS_OF_DEVOTION_DR = 0.25; // Aegis of Devotion: 25% damage reduction
export const AEGIS_OF_DEVOTION_DURATION = 8;

export type PaladinSpec = 'holy' | 'protection' | 'retribution';
export type AscensionImpactKind = 'healing' | 'defensive' | 'offensive' | 'area';

const ASCENSION_ABILITIES: Readonly<Record<PaladinSpec, ReadonlySet<string>>> = {
  holy: new Set(['mercy_lance', 'dawns_embrace', 'radiant_chorus', 'solar_invocation']),
  protection: new Set([
    'vowkeeper_strike',
    'bastion_rite',
    'sunward_disc',
    'bastion_sweep',
    'holy_shield',
    'consecration',
    'oath_chain',
    'veilbound_march',
  ]),
  retribution: new Set([
    'final_edict',
    'dawnfall',
    'faithforged_guard',
    'hammer_of_wrath',
    'guardian_covenant',
    'valkyrs_calling',
  ]),
};

const DEVOTION_GAIN: Readonly<Record<PaladinSpec, Readonly<Record<string, number>>>> = {
  holy: {
    mercy_lance: 1,
    dawns_embrace: 1,
    radiant_chorus: 1,
    solar_invocation: 1,
  },
  protection: {
    vowkeeper_strike: 1,
    sunward_disc: 1,
    bastion_sweep: 1,
  },
  retribution: {
    hammer_of_wrath: 1,
    final_edict: 1,
    dawnfall: 1,
  },
};

const COMMON_DIRECT_DEVOTION_ABILITIES: ReadonlySet<string> = new Set([
  'hammer_of_grace',
  'holy_light',
  'flash_of_light',
  'lay_on_hands',
  'exorcism',
  'crusader_strike',
  'holy_shock',
]);

function state(e: Entity): NonNullable<Entity['paladinDevotion']> | null {
  return e.kind === 'player' && e.templateId === 'paladin' ? (e.paladinDevotion ?? null) : null;
}

export function isDivineAscensionActive(e: Entity): boolean {
  const devotion = state(e);
  return !!devotion && devotion.ascensionCharges > 0 && devotion.ascensionRemaining > 0;
}

export function canActivateDivineAscension(e: Entity): boolean {
  const devotion = state(e);
  return !!devotion && devotion.value >= MAX_DEVOTION && !isDivineAscensionActive(e);
}

export function activateDivineAscension(e: Entity): boolean {
  const devotion = state(e);
  if (!devotion || !canActivateDivineAscension(e)) return false;
  devotion.value = 0;
  devotion.ascensionCharges = ASCENSION_CHARGES;
  devotion.ascensionRemaining = ASCENSION_DURATION;
  devotion.outOfCombatTime = 0;
  devotion.decayProgress = 0;
  return true;
}

export function grantDevotion(e: Entity, amount: number): number {
  const devotion = state(e);
  if (!devotion || !Number.isFinite(amount) || amount <= 0) return 0;
  if (isDivineAscensionActive(e)) return 0;
  const before = devotion.value;
  devotion.value = Math.min(MAX_DEVOTION, devotion.value + Math.floor(amount));
  devotion.outOfCombatTime = 0;
  devotion.decayProgress = 0;
  return devotion.value - before;
}

export function grantAbilityDevotion(e: Entity, amount: number): number {
  const multiplier = e.auras.some(
    (aura) => aura.id === 'avenging_wrath' || aura.id === 'perpetual_sun_generation',
  )
    ? 2
    : 1;
  return grantDevotion(e, amount * multiplier);
}

export function spendDevotion(e: Entity, amount: number): boolean {
  const devotion = state(e);
  if (!devotion || !Number.isFinite(amount) || amount < 0) return false;
  const cost = Math.floor(amount);
  if (devotion.value < cost) return false;
  devotion.value -= cost;
  return true;
}

export function hasDevotion(e: Entity, amount: number): boolean {
  const devotion = state(e);
  return !!devotion && devotion.value >= Math.max(0, Math.floor(amount));
}

export function paladinExecuteWindowActive(e: Entity, abilityId: string): boolean {
  return (
    abilityId === 'hammer_of_wrath' &&
    (isDivineAscensionActive(e) || e.auras.some((aura) => aura.id === 'avenging_wrath'))
  );
}

export function grantGroundAoEDevotionOnFirstHit(
  source: Entity,
  effect: GroundAoE,
  effectiveDamageTargets: number,
): void {
  if (effectiveDamageTargets <= 0 || effect.devotionGranted || !effect.devotionOnFirstHit) return;
  effect.devotionGranted = true;
  grantAbilityDevotion(source, effect.devotionOnFirstHit);
}

export function isAscensionEmpoweredAbility(spec: string | null, abilityId: string): boolean {
  if (spec !== 'holy' && spec !== 'protection' && spec !== 'retribution') return false;
  return ASCENSION_ABILITIES[spec].has(abilityId);
}

export function devotionGainForAbility(spec: string | null, abilityId: string): number {
  if (COMMON_DIRECT_DEVOTION_ABILITIES.has(abilityId)) return 1;
  if (spec !== 'holy' && spec !== 'protection' && spec !== 'retribution') return 0;
  return DEVOTION_GAIN[spec][abilityId] ?? 0;
}

export function devotionGenerationTriggered(
  _spec: string | null,
  _abilityId: string,
  trigger: { damage: boolean; healing: boolean },
): boolean {
  return trigger.damage || trigger.healing;
}

export function divineAscensionAura(e: Entity): Aura | null {
  const devotion = state(e);
  if (!devotion || !isDivineAscensionActive(e)) return null;
  return {
    id: DIVINE_ASCENSION_AURA_ID,
    name: 'Divine Ascension',
    kind: 'internal_cd',
    remaining: devotion.ascensionRemaining,
    duration: ASCENSION_DURATION,
    value: 0,
    charges: devotion.ascensionCharges,
    sourceId: e.id,
    school: 'holy',
  };
}

/** Keep the HUD aura charge badge aligned after an empowered ability is spent. */
export function syncDivineAscensionAura(e: Entity): Aura | null {
  const index = e.auras.findIndex(
    (aura) => aura.id === DIVINE_ASCENSION_AURA_ID && aura.sourceId === e.id,
  );
  if (index < 0) return null;
  const aura = e.auras[index];
  const devotion = state(e);
  if (!devotion || !isDivineAscensionActive(e)) {
    e.auras.splice(index, 1);
    return aura;
  }
  aura.remaining = devotion.ascensionRemaining;
  aura.charges = devotion.ascensionCharges;
  return null;
}

export function ascensionImpactKind(
  abilityId: string,
  targetIsHostile: boolean,
): AscensionImpactKind {
  if (abilityId === 'mercy_lance' || abilityId === 'solar_invocation') {
    return targetIsHostile ? 'offensive' : 'healing';
  }
  if (abilityId === 'dawns_embrace' || abilityId === 'radiant_chorus') {
    return 'healing';
  }
  if (
    abilityId === 'faithforged_guard' ||
    abilityId === 'bastion_rite' ||
    abilityId === 'holy_shield' ||
    abilityId === 'guardian_covenant'
  ) {
    return 'defensive';
  }
  return abilityId === 'dawnfall' ||
    abilityId === 'final_edict' ||
    abilityId === 'bastion_sweep' ||
    abilityId === 'consecration' ||
    abilityId === 'oath_chain' ||
    abilityId === 'veilbound_march'
    ? 'area'
    : 'offensive';
}

function scaleRange(min: number, max: number, mult: number): { min: number; max: number } {
  return { min: Math.round(min * mult), max: Math.round(max * mult) };
}

export function resolveAscensionAbility(
  e: Entity,
  spec: string | null,
  resolved: ResolvedAbility,
): ResolvedAbility {
  const passiveUpgrade =
    (spec === 'holy' && resolved.def.id === 'life_covenant') ||
    (spec === 'protection' && resolved.def.id === 'sacred_challenge');
  if (
    !isDivineAscensionActive(e) ||
    (!isAscensionEmpoweredAbility(spec, resolved.def.id) && !passiveUpgrade)
  ) {
    return resolved;
  }

  const effects = resolved.effects.map((effect) => {
    switch (resolved.def.id) {
      case 'mercy_lance':
        return effect.type === 'directDamage' ? { ...effect, guaranteedCrit: true } : effect;
      case 'dawns_embrace':
        return effect.type === 'heal'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.35) }
          : effect;
      case 'radiant_chorus':
        return effect.type === 'aoeHeal'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.2), radius: 40 }
          : effect;
      case 'dawnfall':
        return effect.type === 'aoeDamage'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.5), radius: 10 }
          : effect;
      case 'hammer_of_wrath':
        return effect.type === 'directDamage'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.3) }
          : effect;
      case 'valkyrs_calling':
        return effect.type === 'valkyrsCalling'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.5), ascended: true }
          : effect;
      case 'bastion_sweep':
        return effect.type === 'aoeDamage'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.3), radius: 8 }
          : effect;
      case 'holy_shield':
        if (effect.type === 'selfBuff' && effect.kind === 'buff_block') {
          return { ...effect, value: 0.4, duration: 10 };
        }
        if (effect.type === 'absorb') {
          return {
            ...effect,
            amount: Math.round(effect.amount * 1.5),
            casterMaxHpPct:
              effect.casterMaxHpPct === undefined
                ? undefined
                : Math.round(effect.casterMaxHpPct * 1.5 * 10_000) / 10_000,
            duration: 10,
          };
        }
        return effect;
      case 'consecration':
        return effect.type === 'groundAoE'
          ? { ...effect, ...scaleRange(effect.min, effect.max, 1.3) }
          : effect;
      // Debt of Light: Ascension raises the cap it can answer, so the empowered blow
      // denies more AND returns more (the return equals what was soaked).
      case 'faithforged_guard':
        return effect.type === 'selfBuff' && effect.kind === 'paladin_debt_of_light'
          ? { ...effect, value: Math.round(effect.value * 1.5) }
          : effect;
      case 'bastion_rite':
        return effect.type === 'selfBuff' ? { ...effect, duration: 10 } : effect;
      case 'sunward_disc':
        if (effect.type === 'directDamage') {
          return { ...effect, ...scaleRange(effect.min, effect.max, 1.3) };
        }
        if (effect.type === 'chainDamage') {
          return {
            ...effect,
            ...scaleRange(effect.min, effect.max, 1.3),
            jumps: 5,
          };
        }
        return effect;
      case 'guardian_covenant':
        return effect.type === 'buffTarget' || effect.type === 'selfBuff'
          ? { ...effect, value: 0.3 }
          : effect;
      case 'oath_chain':
        return effect.type === 'pullTarget' ? { ...effect, maxTargets: 2 } : effect;
      case 'veilbound_march':
        return effect.type === 'veilboundMarch' ? { ...effect, ascended: true } : effect;
      default:
        return effect;
    }
  });

  if (resolved.def.id === 'final_edict') {
    effects.push({ type: 'aoeDamage', min: 55, max: 70, radius: 6, softCap: 5 });
  } else if (resolved.def.id === 'solar_invocation') {
    effects.push({
      type: 'aoeHeal',
      min: 90,
      max: 110,
      radius: 10,
      playersOnly: true,
      centerOnTarget: true,
      friendlyTargetOnly: true,
    });
  } else if (resolved.def.id === 'vowkeeper_strike') {
    effects.push({
      type: 'selfBuff',
      kind: 'absorb',
      value: Math.max(1, Math.round(e.maxHp * 0.06)),
      duration: 6,
      auraId: 'vowkeeper_strike_absorb',
    });
  } else if (resolved.def.id === 'life_covenant') {
    effects.push({ type: 'absorb', amount: 120, duration: 6 });
  } else if (resolved.def.id === 'sacred_challenge') {
    effects.push({ type: 'selfBuff', kind: 'buff_dr', value: 0.15, duration: 4 });
  }

  return {
    ...resolved,
    castTime: resolved.def.id === 'dawns_embrace' ? 0 : resolved.castTime,
    effects,
  };
}

export function consumeAscensionCharge(
  e: Entity,
  spec: string | null,
  abilityId: string,
  preserveChance = 0,
  chance: (probability: number) => boolean = () => false,
): boolean {
  const devotion = state(e);
  if (!devotion || !isDivineAscensionActive(e) || !isAscensionEmpoweredAbility(spec, abilityId)) {
    return false;
  }
  if (preserveChance <= 0 || !chance(preserveChance)) devotion.ascensionCharges -= 1;
  if (devotion.ascensionCharges <= 0) {
    devotion.ascensionCharges = 0;
    devotion.ascensionRemaining = 0;
  }
  return true;
}

export function grantDevotionFromBlock(e: Entity): boolean {
  const devotion = state(e);
  if (!devotion || isDivineAscensionActive(e) || devotion.blockIcdRemaining > 0) return false;
  devotion.blockIcdRemaining = BLOCK_DEVOTION_ICD;
  return grantDevotion(e, 1) > 0;
}

export function updatePaladinDevotion(e: Entity, dt: number, sacredReserve = false): void {
  const devotion = state(e);
  if (!devotion || !Number.isFinite(dt) || dt <= 0) return;

  devotion.blockIcdRemaining = Math.max(0, devotion.blockIcdRemaining - dt);

  if (e.dead) {
    devotion.value = 0;
    devotion.ascensionCharges = 0;
    devotion.ascensionRemaining = 0;
    devotion.outOfCombatTime = 0;
    devotion.decayProgress = 0;
    return;
  }

  if (devotion.ascensionRemaining > 0) {
    devotion.ascensionRemaining = Math.max(0, devotion.ascensionRemaining - dt);
    if (devotion.ascensionRemaining === 0) {
      devotion.ascensionCharges = 0;
      if (sacredReserve) grantDevotion(e, 5);
    }
  }

  if (e.inCombat) {
    devotion.outOfCombatTime = 0;
    devotion.decayProgress = 0;
    return;
  }

  devotion.outOfCombatTime += dt;
  devotion.decayProgress = 0;
}
