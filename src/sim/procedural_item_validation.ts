import {
  proceduralLegendaryPower,
  proceduralLegendaryPowerCompatibleWithBase,
} from './content/procedural_legendary_powers';
import {
  baseEligibleForAffix,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_RARE_FIRST_WORD_IDS,
  PROCEDURAL_RARE_SECOND_WORD_IDS,
  PROCEDURAL_RARITIES,
} from './content/procedural_loot';
import {
  cloneProceduralItemInstance,
  type GeneratedItemName,
  type ItemDropContext,
  type ProceduralItemInstance,
  type ProceduralRarity,
  type RolledAffix,
} from './procedural_item';
import type { EquipSlot, InvSlot, ItemInstancePayload } from './types';

const MAX_AFFIXES = 5;
const MAX_IMPLICITS = 2;
const MAX_VALUES_PER_AFFIX = 4;
const MAX_NUMERIC_MAGNITUDE = 10_000;
const MAX_SOURCE_TAGS = 8;
const MAX_SOURCE_TAG_LENGTH = 32;
const MAX_PAYLOAD_STRING = 96;
const UID_PATTERN = /^pi1:[a-z0-9][a-z0-9_-]{0,31}:\d{1,24}$/;
const ACTIVE_RARITIES = new Set<ProceduralRarity>(['common', 'magic', 'rare', 'epic', 'legendary']);
const DROP_SOURCES = new Set<ItemDropContext['source']>([
  'world',
  'rare',
  'dungeon',
  'delve',
  'raid',
  'dev',
]);
const LEGACY_ROLLED_STAT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const RARE_FIRST_IDS = new Set<string>(PROCEDURAL_RARE_FIRST_WORD_IDS);
const RARE_SECOND_IDS = new Set<string>(PROCEDURAL_RARE_SECOND_WORD_IDS);

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function success<T>(value: T): ValidationSuccess<T> {
  return { ok: true, value };
}

function failure(error: string): ValidationFailure {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function boundedString(value: unknown, max = MAX_PAYLOAD_STRING): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function integer(value: unknown, min: number, max: number): value is number {
  return finiteNumber(value, min, max) && Number.isInteger(value);
}

function sanitizeStringArray(value: unknown, maxCount: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxCount) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (!boundedString(entry, maxLength)) return null;
    out.push(entry);
  }
  return out;
}

function sanitizeDropContext(value: unknown): ItemDropContext | null {
  if (!isRecord(value) || !DROP_SOURCES.has(value.source as ItemDropContext['source'])) return null;
  if (!integer(value.sourceEntityId, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!integer(value.sourceSpawnSequence, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!integer(value.lootSlotIndex, 0, 1024)) return null;
  if (value.recipientId !== undefined && !integer(value.recipientId, 0, Number.MAX_SAFE_INTEGER))
    return null;
  if (
    value.sourceTemplateId !== undefined &&
    !boundedString(value.sourceTemplateId, MAX_PAYLOAD_STRING)
  )
    return null;
  const sourceTags =
    value.sourceTags === undefined
      ? undefined
      : sanitizeStringArray(value.sourceTags, MAX_SOURCE_TAGS, MAX_SOURCE_TAG_LENGTH);
  if (value.sourceTags !== undefined && sourceTags === null) return null;
  return {
    source: value.source as ItemDropContext['source'],
    sourceEntityId: value.sourceEntityId,
    sourceSpawnSequence: value.sourceSpawnSequence,
    lootSlotIndex: value.lootSlotIndex,
    ...(value.recipientId !== undefined && { recipientId: value.recipientId as number }),
    ...(value.sourceTemplateId !== undefined && {
      sourceTemplateId: value.sourceTemplateId as string,
    }),
    ...(sourceTags && { sourceTags }),
  };
}

function sanitizeRolledAffix(
  value: unknown,
  baseId: string,
  itemLevel: number,
): ValidationResult<RolledAffix> {
  if (!isRecord(value)) return failure('affix must be an object');
  if (!boundedString(value.affixId, 64)) return failure('invalid affix id');
  const definition = PROCEDURAL_AFFIXES[value.affixId];
  if (!definition) return failure(`unknown affix ${value.affixId}`);
  const base = PROCEDURAL_ITEM_BASES[baseId];
  if (!baseEligibleForAffix(base, definition))
    return failure(`affix ${definition.id} is incompatible with base ${baseId}`);
  if (value.family !== definition.family) return failure(`affix ${definition.id} family mismatch`);
  if (value.position !== definition.position)
    return failure(`affix ${definition.id} position mismatch`);
  if (!integer(value.tier, 1, 32)) return failure(`affix ${definition.id} has invalid tier`);
  const tier = definition.tiers.find((entry) => entry.tier === value.tier);
  if (!tier || tier.minItemLevel > itemLevel)
    return failure(`affix ${definition.id} tier is invalid for item level`);
  if (value.revision !== 1) return failure(`affix ${definition.id} has unsupported revision`);
  if (!finiteNumber(value.budget, 0, MAX_NUMERIC_MAGNITUDE))
    return failure(`affix ${definition.id} has invalid budget`);
  if (!isRecord(value.values) || !isRecord(value.ranges))
    return failure(`affix ${definition.id} values and ranges must be objects`);
  const valueEntries = Object.entries(value.values);
  if (valueEntries.length < 1 || valueEntries.length > MAX_VALUES_PER_AFFIX)
    return failure(`affix ${definition.id} has invalid value count`);
  if (Object.keys(value.ranges).length !== valueEntries.length)
    return failure(`affix ${definition.id} range count mismatch`);

  const values: Record<string, number> = {};
  const ranges: RolledAffix['ranges'] = {};
  for (const [stat, numericValue] of valueEntries) {
    if (!(stat in tier.rolls)) return failure(`affix ${definition.id} has unknown stat ${stat}`);
    if (!finiteNumber(numericValue, -MAX_NUMERIC_MAGNITUDE, MAX_NUMERIC_MAGNITUDE))
      return failure(`affix ${definition.id} has invalid value for ${stat}`);
    const range = value.ranges[stat];
    if (!isRecord(range)) return failure(`affix ${definition.id} has no range for ${stat}`);
    if (
      !finiteNumber(range.min, -MAX_NUMERIC_MAGNITUDE, MAX_NUMERIC_MAGNITUDE) ||
      !finiteNumber(range.max, -MAX_NUMERIC_MAGNITUDE, MAX_NUMERIC_MAGNITUDE) ||
      range.min > range.max ||
      numericValue < range.min ||
      numericValue > range.max
    )
      return failure(`affix ${definition.id} has invalid range for ${stat}`);
    values[stat] = numericValue;
    ranges[stat] = { min: range.min, max: range.max };
  }

  return success({
    affixId: definition.id,
    family: definition.family,
    position: definition.position,
    tier: value.tier,
    revision: 1,
    budget: value.budget,
    values,
    ranges,
  });
}

function sanitizeGeneratedName(
  value: unknown,
  baseId: string,
  rarity: ProceduralRarity,
  affixes: readonly RolledAffix[],
): GeneratedItemName | null {
  if (!isRecord(value) || value.baseId !== baseId) return null;
  const fragmentIds = new Set(
    affixes
      .map((affix) => PROCEDURAL_AFFIXES[affix.affixId]?.nameFragmentId)
      .filter((id): id is string => Boolean(id)),
  );
  if (value.prefixId !== undefined && !fragmentIds.has(value.prefixId as string)) return null;
  if (value.suffixId !== undefined && !fragmentIds.has(value.suffixId as string)) return null;
  let rareWordIds: [string, string] | undefined;
  if (value.rareWordIds !== undefined) {
    if (
      !Array.isArray(value.rareWordIds) ||
      value.rareWordIds.length !== 2 ||
      !RARE_FIRST_IDS.has(value.rareWordIds[0]) ||
      !RARE_SECOND_IDS.has(value.rareWordIds[1])
    )
      return null;
    rareWordIds = [value.rareWordIds[0], value.rareWordIds[1]];
  }
  if ((rarity === 'rare' || rarity === 'epic') && !rareWordIds) return null;
  if (rarity === 'magic' && !value.prefixId && !value.suffixId) return null;
  if (
    value.legendaryNameId !== undefined &&
    !boundedString(value.legendaryNameId, MAX_PAYLOAD_STRING)
  )
    return null;
  return {
    baseId,
    ...(value.prefixId !== undefined && { prefixId: value.prefixId as string }),
    ...(value.suffixId !== undefined && { suffixId: value.suffixId as string }),
    ...(rareWordIds && { rareWordIds }),
    ...(value.legendaryNameId !== undefined && {
      legendaryNameId: value.legendaryNameId as string,
    }),
  };
}

export function sanitizeProceduralItemInstance(
  value: unknown,
  expectedBaseId?: string,
): ValidationResult<ProceduralItemInstance> {
  if (!isRecord(value)) return failure('procedural item must be an object');
  if (value.version !== 1) return failure('unsupported procedural item version');
  if (!boundedString(value.uid, 64) || !UID_PATTERN.test(value.uid))
    return failure('invalid procedural item uid');
  if (!boundedString(value.baseId, 64) || !PROCEDURAL_ITEM_BASES[value.baseId])
    return failure('unknown procedural base');
  if (expectedBaseId !== undefined && value.baseId !== expectedBaseId)
    return failure('procedural base does not match container item id');
  if (!integer(value.itemLevel, 1, 40)) return failure('invalid procedural item level');
  if (!ACTIVE_RARITIES.has(value.rarity as ProceduralRarity))
    return failure('invalid procedural rarity');
  if (!integer(value.seed, 1, 0xffffffff)) return failure('invalid procedural seed');
  if (!Array.isArray(value.affixes) || value.affixes.length > MAX_AFFIXES)
    return failure('invalid procedural affix count');
  if (
    value.implicits !== undefined &&
    (!Array.isArray(value.implicits) || value.implicits.length > MAX_IMPLICITS)
  )
    return failure('invalid procedural implicit count');
  if (value.implicits !== undefined)
    return failure('procedural implicits are not active in payload version 1');

  const affixes: RolledAffix[] = [];
  const families = new Set<string>();
  for (const entry of value.affixes) {
    const result = sanitizeRolledAffix(entry, value.baseId, value.itemLevel);
    if (!result.ok) return result;
    if (families.has(result.value.family)) return failure('duplicate procedural affix family');
    families.add(result.value.family);
    affixes.push(result.value);
  }
  const rarity = value.rarity as Exclude<ProceduralRarity, 'mythic'>;
  const allowedCounts: number[] = PROCEDURAL_RARITIES[rarity].affixCounts.map(
    (entry) => entry.count,
  );
  if (!allowedCounts.includes(affixes.length))
    return failure('affix count does not match procedural rarity');
  const generatedName = sanitizeGeneratedName(value.generatedName, value.baseId, rarity, affixes);
  if (!generatedName) return failure('invalid generated item name');
  let legendaryPowerId: string | undefined;
  let powerRevision: 1 | undefined;
  let legendaryRolls: Record<string, number> | undefined;
  if (rarity === 'legendary') {
    if (!boundedString(value.legendaryPowerId, 64)) return failure('invalid legendary power id');
    const power = proceduralLegendaryPower(value.legendaryPowerId);
    if (!power) return failure('unknown legendary power');
    if (value.powerRevision !== power.revision)
      return failure('unsupported legendary power revision');
    if (!proceduralLegendaryPowerCompatibleWithBase(power, PROCEDURAL_ITEM_BASES[value.baseId]))
      return failure('legendary power is incompatible with base');
    if (!isRecord(value.legendaryRolls)) return failure('invalid legendary rolls');
    const expectedRollKeys = Object.keys(power.rolls).sort();
    if (Object.keys(value.legendaryRolls).sort().join('\0') !== expectedRollKeys.join('\0'))
      return failure('legendary roll keys do not match power');
    legendaryRolls = {};
    for (const key of expectedRollKeys) {
      const roll = value.legendaryRolls[key];
      const range = power.rolls[key];
      if (!finiteNumber(roll, range.min, range.max))
        return failure(`invalid legendary roll ${key}`);
      const steps = (roll - range.min) / range.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8)
        return failure(`legendary roll ${key} is not quantized`);
      legendaryRolls[key] = roll;
    }
    if (generatedName.legendaryNameId !== power.id)
      return failure('legendary generated name does not match power');
    legendaryPowerId = power.id;
    powerRevision = power.revision;
  } else if (
    value.legendaryPowerId !== undefined ||
    value.powerRevision !== undefined ||
    value.legendaryRolls !== undefined ||
    generatedName.legendaryNameId !== undefined
  ) {
    return failure('non-legendary item carries legendary power fields');
  }
  const dropContext =
    value.dropContext === undefined ? undefined : sanitizeDropContext(value.dropContext);
  if (value.dropContext !== undefined && !dropContext)
    return failure('invalid procedural drop context');

  const item: ProceduralItemInstance = {
    version: 1,
    uid: value.uid,
    baseId: value.baseId,
    itemLevel: value.itemLevel,
    rarity,
    affixes,
    ...(legendaryPowerId && {
      legendaryPowerId,
      powerRevision,
      legendaryRolls,
    }),
    generatedName,
    seed: value.seed,
    ...(dropContext && { dropContext }),
  };
  return success(cloneProceduralItemInstance(item));
}

function sanitizeNumberRecord(
  value: unknown,
  keys: ReadonlySet<string> | null,
  maxEntries: number,
  min: number,
  max: number,
): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > maxEntries) return null;
  const out: Record<string, number> = {};
  for (const [key, entry] of entries) {
    if (!LEGACY_ROLLED_STAT_KEY.test(key)) return null;
    if ((keys && !keys.has(key)) || !finiteNumber(entry, min, max)) return null;
    out[key] = entry;
  }
  return out;
}

export function sanitizeItemInstancePayload(
  value: unknown,
  expectedBaseId?: string,
): ValidationResult<ItemInstancePayload> {
  if (!isRecord(value)) return failure('item instance payload must be an object');
  const out: ItemInstancePayload = {};
  if (value.signer !== undefined) {
    if (!boundedString(value.signer, 80)) return failure('invalid item signer');
    out.signer = value.signer;
  }
  if (value.charges !== undefined) {
    const charges = sanitizeNumberRecord(value.charges, null, 16, 0, 9999);
    if (!charges || Object.values(charges).some((entry) => !Number.isInteger(entry)))
      return failure('invalid item charges');
    out.charges = charges;
  }
  if (value.rolled !== undefined) {
    if (!isRecord(value.rolled)) return failure('invalid legacy rolled payload');
    const quality =
      value.rolled.quality === undefined
        ? undefined
        : boundedString(value.rolled.quality, 32)
          ? value.rolled.quality
          : null;
    if (quality === null) return failure('invalid legacy rolled quality');
    const stats =
      value.rolled.stats === undefined
        ? undefined
        : sanitizeNumberRecord(value.rolled.stats, null, 32, -1000, 1000);
    if (value.rolled.stats !== undefined && !stats) return failure('invalid legacy rolled stats');
    if (value.rolled.masterwork !== undefined && typeof value.rolled.masterwork !== 'boolean')
      return failure('invalid legacy masterwork flag');
    out.rolled = {
      ...(quality && { quality }),
      ...(stats && { stats }),
      ...(value.rolled.masterwork !== undefined && {
        masterwork: value.rolled.masterwork,
      }),
    };
  }
  if (value.enchant !== undefined) {
    if (!boundedString(value.enchant, 64)) return failure('invalid item enchant');
    out.enchant = value.enchant;
  }
  if (value.boundTo !== undefined) {
    if (!integer(value.boundTo, 0, Number.MAX_SAFE_INTEGER)) return failure('invalid item binding');
    out.boundTo = value.boundTo;
  }
  if (value.bindOnTrade !== undefined) {
    if (typeof value.bindOnTrade !== 'boolean') return failure('invalid bind-on-trade flag');
    out.bindOnTrade = value.bindOnTrade;
  }
  if (value.procedural !== undefined) {
    const procedural = sanitizeProceduralItemInstance(value.procedural, expectedBaseId);
    if (!procedural.ok) return procedural;
    out.procedural = procedural.value;
  }
  if (Object.keys(out).length === 0) return failure('empty item instance payload');
  return success(out);
}

export interface ProceduralUidContainers {
  inventory?: readonly InvSlot[];
  bank?: readonly InvSlot[];
  buyback?: readonly InvSlot[];
  mail?: readonly InvSlot[];
  equipmentInstance?: Partial<Record<EquipSlot, ItemInstancePayload>>;
}

export function duplicateProceduralItemUids(containers: ProceduralUidContainers): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const visit = (payload: ItemInstancePayload | undefined, count = 1) => {
    const uid = payload?.procedural?.uid;
    if (!uid) return;
    // A single counted slot with one UID and count > 1 is already a duplicate,
    // even before comparing it with any other container.
    if (count > 1 || seen.has(uid)) duplicates.add(uid);
    else seen.add(uid);
  };
  for (const slot of containers.inventory ?? []) visit(slot.instance, slot.count);
  for (const slot of containers.bank ?? []) visit(slot.instance, slot.count);
  for (const slot of containers.buyback ?? []) visit(slot.instance, slot.count);
  for (const slot of containers.mail ?? []) visit(slot.instance, slot.count);
  for (const slot of Object.values(containers.equipmentInstance ?? {})) visit(slot);
  return [...duplicates].sort();
}
