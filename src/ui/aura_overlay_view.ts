import { CHOICE_ROWS, type ChoiceRowOption } from '../sim/content/choice_rows';
import type { ProcResponse, TalentAllocation } from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';

export type WarriorProcId =
  | 'revenge_free'
  | 'battle_trance'
  | 'raised_guard'
  | 'iron_resolve'
  | 'sudden_death'
  | 'victory_rush'
  | 'overpower_charge'
  | 'enrage';

export type MageProcId =
  | 'heating_up'
  | 'hot_streak'
  | 'fingers_of_frost'
  | 'brain_freeze'
  | 'arcane_charge'
  | 'aether_rush'
  | 'perfect_moment';

export type AuraOverlayProcId = string;

export type AuraOverlayTheme =
  | 'rage'
  | 'battle'
  | 'death'
  | 'victory'
  | 'fire'
  | 'frost'
  | 'arcane'
  | 'warrior'
  | 'mage'
  | 'paladin'
  | 'hunter'
  | 'rogue'
  | 'priest'
  | 'shaman'
  | 'warlock'
  | 'druid';

export interface AuraOverlayProcDef {
  id: AuraOverlayProcId;
  auraKind: string;
  auraId?: string;
  iconAbilityId: string;
  theme: AuraOverlayTheme;
  labelKey: TranslationKey | null;
  talentChoice?: ChoiceRowOption;
}

export interface AuraOverlayDefaultMeta {
  playerClass: PlayerClass;
  slot: number;
}

interface KnownAbilityLike {
  def: { id: string };
}

interface AuraLike {
  id?: string;
  kind: string;
}

export function auraOverlayProcAura<T extends AuraLike>(
  def: Pick<AuraOverlayProcDef, 'auraKind' | 'auraId'>,
  auras: readonly T[],
): T | undefined {
  return auras.find(
    (aura) => aura.kind === def.auraKind && (def.auraId === undefined || aura.id === def.auraId),
  );
}

export function auraOverlayProcIsActive(
  def: Pick<AuraOverlayProcDef, 'auraKind' | 'auraId'>,
  auras: readonly AuraLike[],
): boolean {
  return auraOverlayProcAura(def, auras) !== undefined;
}

const has = (ids: ReadonlySet<string>, id: string): boolean => ids.has(id);

function talentAuraKind(response: ProcResponse): string | null {
  switch (response.kind) {
    case 'empowerNext':
      return response.aura;
    case 'aura':
      return response.auraKind;
    case 'absorb':
      return 'absorb';
    case 'echo':
      return 'heal_echo';
    default:
      return null;
  }
}

function selectedTalentProcDefs(
  playerClass: PlayerClass,
  talents: TalentAllocation | undefined,
): AuraOverlayProcDef[] {
  if (!talents) return [];
  const out: AuraOverlayProcDef[] = [];
  for (const row of CHOICE_ROWS[playerClass].rows) {
    const selectedId = talents.rows[row.level];
    if (!selectedId) continue;
    const choice = row.options.find((option) => option.id === selectedId);
    const proc = choice?.effect.proc;
    if (!choice || !proc) continue;
    const auraKind = proc.responses.map(talentAuraKind).find((kind) => kind !== null);
    if (!auraKind) continue;
    out.push({
      id: proc.id,
      auraKind,
      auraId: proc.id,
      iconAbilityId: choice.icon ?? proc.id,
      theme: playerClass,
      labelKey: null,
      talentChoice: choice,
    });
  }
  return out;
}

const TALENT_DEFAULT_META = new Map<string, AuraOverlayDefaultMeta>();
for (const [rawClass, rows] of Object.entries(CHOICE_ROWS)) {
  const playerClass = rawClass as PlayerClass;
  rows.rows.forEach((row, slot) => {
    for (const choice of row.options) {
      const proc = choice.effect.proc;
      if (!proc || !proc.responses.some((response) => talentAuraKind(response) !== null)) continue;
      TALENT_DEFAULT_META.set(proc.id, { playerClass, slot });
    }
  });
}

const BASE_DEFAULT_META: Readonly<Record<string, AuraOverlayDefaultMeta>> = {
  counterfang_window: { playerClass: 'hunter', slot: 6 },
  cold_blood: { playerClass: 'rogue', slot: 6 },
  inner_focus: { playerClass: 'priest', slot: 6 },
  elemental_mastery: { playerClass: 'shaman', slot: 6 },
};

export function auraOverlayDefaultMeta(id: AuraOverlayProcId): AuraOverlayDefaultMeta | undefined {
  return BASE_DEFAULT_META[id] ?? TALENT_DEFAULT_META.get(id);
}

function availableWarriorProcDefs(ids: ReadonlySet<string>): AuraOverlayProcDef[] {
  const out: AuraOverlayProcDef[] = [];
  if (has(ids, 'revenge')) {
    out.push({
      id: 'revenge_free',
      auraKind: 'revenge_free',
      iconAbilityId: 'revenge',
      theme: 'rage',
      labelKey: 'hudChrome.auraOverlay.procs.revenge',
    });
  }
  const battleAbility = has(ids, 'mortal_strike')
    ? 'mortal_strike'
    : has(ids, 'heroic_strike')
      ? 'heroic_strike'
      : null;
  if (battleAbility) {
    out.push({
      id: 'battle_trance',
      auraKind: 'battle_trance',
      iconAbilityId: battleAbility,
      theme: 'battle',
      labelKey: 'hudChrome.auraOverlay.procs.battleTrance',
    });
  }
  if (has(ids, 'raised_guard')) {
    out.push({
      id: 'raised_guard',
      auraKind: 'buff_dr_phys',
      auraId: 'raised_guard_dr',
      iconAbilityId: 'raised_guard',
      theme: 'battle',
      labelKey: null,
    });
  }
  if (has(ids, 'iron_resolve')) {
    out.push({
      id: 'iron_resolve',
      auraKind: 'absorb',
      auraId: 'iron_resolve',
      iconAbilityId: 'iron_resolve',
      theme: 'victory',
      labelKey: null,
    });
  }
  if (has(ids, 'overpower') && has(ids, 'mortal_strike')) {
    out.push({
      id: 'overpower_charge',
      auraKind: 'overpower_charge',
      iconAbilityId: 'overpower',
      theme: 'battle',
      labelKey: 'hudChrome.auraOverlay.procs.overpowerCharge',
    });
  }
  if (has(ids, 'sudden_death') && has(ids, 'execute')) {
    out.push({
      id: 'sudden_death',
      auraKind: 'sudden_death',
      iconAbilityId: 'execute',
      theme: 'death',
      labelKey: 'hudChrome.auraOverlay.procs.suddenDeath',
    });
  }
  if (has(ids, 'victory_rush')) {
    out.push({
      id: 'victory_rush',
      auraKind: 'victory_rush',
      iconAbilityId: 'victory_rush',
      theme: 'victory',
      labelKey: 'hudChrome.auraOverlay.procs.victoryRush',
    });
  }
  if (has(ids, 'enrage_passive') || has(ids, 'bloodthirst') || has(ids, 'red_harvest')) {
    out.push({
      id: 'enrage',
      auraKind: 'enrage',
      iconAbilityId: has(ids, 'bloodthirst') ? 'bloodthirst' : 'red_harvest',
      theme: 'rage',
      labelKey: 'hudChrome.auraOverlay.procs.enrage',
    });
  }
  return out;
}

function availableMageProcDefs(ids: ReadonlySet<string>): AuraOverlayProcDef[] {
  const out: AuraOverlayProcDef[] = [];
  if (has(ids, 'hot_streak')) {
    out.push(
      {
        id: 'heating_up',
        auraKind: 'internal_cd',
        auraId: 'heating_up',
        iconAbilityId: 'fireball',
        theme: 'fire',
        labelKey: 'hudChrome.auraOverlay.procs.heatingUp',
      },
      {
        id: 'hot_streak',
        auraKind: 'next_cast_free',
        auraId: 'hot_streak',
        iconAbilityId: 'hot_streak',
        theme: 'fire',
        labelKey: null,
      },
    );
  }
  if (has(ids, 'ice_lance') && has(ids, 'fingers_of_frost')) {
    out.push({
      id: 'fingers_of_frost',
      auraKind: 'fingers_of_frost',
      iconAbilityId: 'fingers_of_frost',
      theme: 'frost',
      labelKey: null,
    });
  }
  if (has(ids, 'flurry') && has(ids, 'brain_freeze')) {
    out.push({
      id: 'brain_freeze',
      auraKind: 'brain_freeze',
      iconAbilityId: 'brain_freeze',
      theme: 'frost',
      labelKey: null,
    });
  }
  if (has(ids, 'arcane_surge')) {
    out.push(
      {
        id: 'arcane_charge',
        auraKind: 'arcane_charge',
        auraId: 'arcane_surge',
        iconAbilityId: 'arcane_surge',
        theme: 'arcane',
        labelKey: 'hudChrome.auraOverlay.procs.arcaneCharge',
      },
      {
        id: 'aether_rush',
        auraKind: 'next_cast_free',
        auraId: 'aether_surge_free',
        iconAbilityId: 'arcane_surge',
        theme: 'arcane',
        labelKey: 'hudChrome.auraOverlay.procs.aetherRush',
      },
    );
  }
  if (has(ids, 'perfect_moment')) {
    out.push({
      id: 'perfect_moment',
      auraKind: 'perfect_moment',
      auraId: 'perfect_moment',
      iconAbilityId: 'perfect_moment',
      theme: 'arcane',
      labelKey: null,
    });
  }
  return out;
}

function availableClassProcDefs(
  playerClass: PlayerClass,
  ids: ReadonlySet<string>,
): AuraOverlayProcDef[] {
  switch (playerClass) {
    case 'hunter':
      return has(ids, 'mongoose_bite')
        ? [
            {
              id: 'counterfang_window',
              auraKind: 'counterfang_window',
              auraId: 'counterfang_window',
              iconAbilityId: 'mongoose_bite',
              theme: 'hunter',
              labelKey: null,
            },
          ]
        : [];
    case 'rogue':
      return has(ids, 'cold_blood')
        ? [
            {
              id: 'cold_blood',
              auraKind: 'next_attack_crit',
              auraId: 'cold_blood',
              iconAbilityId: 'cold_blood',
              theme: 'rogue',
              labelKey: null,
            },
          ]
        : [];
    case 'priest':
      return has(ids, 'inner_focus')
        ? [
            {
              id: 'inner_focus',
              auraKind: 'next_cast_free',
              auraId: 'inner_focus',
              iconAbilityId: 'inner_focus',
              theme: 'priest',
              labelKey: null,
            },
          ]
        : [];
    case 'shaman':
      return has(ids, 'elemental_mastery')
        ? [
            {
              id: 'elemental_mastery',
              auraKind: 'next_cast_instant',
              auraId: 'elemental_mastery',
              iconAbilityId: 'elemental_mastery',
              theme: 'shaman',
              labelKey: null,
            },
          ]
        : [];
    default:
      return [];
  }
}

export function availableAuraProcDefs(
  playerClass: PlayerClass,
  known: readonly KnownAbilityLike[],
  talents?: TalentAllocation,
): AuraOverlayProcDef[] {
  const ids = new Set(known.map((ability) => ability.def.id));
  const classDefs =
    playerClass === 'warrior'
      ? availableWarriorProcDefs(ids)
      : playerClass === 'mage'
        ? availableMageProcDefs(ids)
        : availableClassProcDefs(playerClass, ids);
  return [...classDefs, ...selectedTalentProcDefs(playerClass, talents)];
}

export function activeAuraProcIds(
  defs: readonly AuraOverlayProcDef[],
  auras: readonly AuraLike[],
): Set<AuraOverlayProcId> {
  const active = new Set<AuraOverlayProcId>();
  for (const def of defs) {
    if (auraOverlayProcIsActive(def, auras)) active.add(def.id);
  }
  return active;
}
