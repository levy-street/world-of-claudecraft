import {
  PROCEDURAL_LEGENDARY_POWER_IDS,
  PROCEDURAL_LEGENDARY_POWERS,
  type ProceduralLegendaryPowerId,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../../content/procedural_legendary_powers';
import {
  PROCEDURAL_LEGENDARY_SIGNATURE_SHARE,
  proceduralBossLegendarySignatures,
} from '../../content/procedural_legendary_sources';
import {
  type AffixDefinition,
  baseEligibleForAffix,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_BASE_POOLS,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_RARE_FIRST_WORD_IDS,
  PROCEDURAL_RARE_SECOND_WORD_IDS,
  PROCEDURAL_RARITIES,
  PROCEDURAL_RARITY_TABLES,
  type ProceduralItemBase,
  type RarityTable,
  type WeightedAffixCount,
} from '../../content/procedural_loot';
import { PROCEDURAL_BASE_ITEMS } from '../../content/procedural_loot/item_defs';
import type {
  GeneratedItemName,
  ItemDropContext,
  ProceduralItemInstance,
  ProceduralRarity,
  RolledAffix,
} from '../../procedural_item';
import { Rng } from '../../rng';
import type { ItemInstancePayload, PlayerClass } from '../../types';
import {
  allocateProceduralAffixes,
  calculateProceduralBudget,
  findProceduralBudgetFeasibleAffixSet,
  ProceduralBudgetAllocationError,
} from './budget';
import { proceduralLootUsabilityMultiplier } from './smart_loot';

export { calculateProceduralBudget } from './budget';

type ActiveRarity = Exclude<ProceduralRarity, 'mythic'>;
export interface GenerateProceduralItemInput {
  seed: number;
  uid: string;
  context: ItemDropContext;
  basePoolId: string;
  rarityTableId: string;
  sourceItemLevel: number;
  personalLootClass?: PlayerClass;
  lootRecipientClasses?: readonly PlayerClass[];
  forcedBaseId?: string;
  forcedRarity?: ActiveRarity;
  forcedItemLevel?: number;
}

export interface GeneratedProceduralDrop {
  itemId: string;
  instance: ItemInstancePayload & { procedural: ProceduralItemInstance };
}

function weightedIndexFromRoll(selectionRoll: number, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) throw new Error('weighted selection requires positive total weight');
  let cursor = selectionRoll * total;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return i;
  }
  return weights.length - 1;
}

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  return weightedIndexFromRoll(rng.next(), weights);
}

function rarityFromTable(rng: Rng, table: RarityTable): ActiveRarity {
  const entries = Object.entries(table.weights) as [ActiveRarity, number][];
  return entries[
    weightedIndex(
      rng,
      entries.map(([, weight]) => weight),
    )
  ][0];
}

function baseHasCompatibleLegendary(
  base: ProceduralItemBase,
  personalLootClass: PlayerClass | undefined,
): boolean {
  return PROCEDURAL_LEGENDARY_POWER_IDS.some((id) =>
    proceduralLegendaryPowerCompatibleWithBase(
      PROCEDURAL_LEGENDARY_POWERS[id],
      base,
      personalLootClass,
    ),
  );
}

function chooseBase(
  rng: Rng,
  input: GenerateProceduralItemInput,
  rarity: ActiveRarity,
): ProceduralItemBase {
  const pool = PROCEDURAL_BASE_POOLS[input.basePoolId];
  if (!pool) throw new Error(`unknown procedural base pool ${input.basePoolId}`);
  const poolBases = pool.baseIds.map((id) => PROCEDURAL_ITEM_BASES[id]);
  if (poolBases.some((base) => !base))
    throw new Error(`procedural base pool ${input.basePoolId} contains an unknown base`);
  const bases = input.forcedBaseId
    ? poolBases
    : poolBases.filter(
        (base) =>
          base.sourceLevel <= input.sourceItemLevel &&
          (rarity !== 'legendary' || baseHasCompatibleLegendary(base, input.personalLootClass)),
      );
  if (bases.length === 0)
    throw new Error(
      `procedural base pool ${input.basePoolId} has no base at source level ${input.sourceItemLevel}`,
    );
  const lootRecipientClasses =
    input.lootRecipientClasses ?? (input.personalLootClass ? [input.personalLootClass] : []);
  const weights = bases.map((base) => {
    const definition = PROCEDURAL_BASE_ITEMS[base.id];
    if (!definition) throw new Error(`procedural base ${base.id} has no item definition`);
    return base.dropWeight * proceduralLootUsabilityMultiplier(definition, lootRecipientClasses);
  });
  const signatureIds =
    rarity === 'legendary'
      ? new Set(proceduralBossLegendarySignatures(input.context.sourceTemplateId))
      : new Set<ProceduralLegendaryPowerId>();
  const signatureBases = bases.filter((base) =>
    [...signatureIds].some((id) =>
      proceduralLegendaryPowerCompatibleWithBase(
        PROCEDURAL_LEGENDARY_POWERS[id],
        base,
        input.personalLootClass,
      ),
    ),
  );
  let selected: ProceduralItemBase;
  if (signatureBases.length > 0) {
    const selectionRoll = rng.next();
    const useSignatureBranch = selectionRoll < PROCEDURAL_LEGENDARY_SIGNATURE_SHARE;
    const branch = useSignatureBranch ? signatureBases : bases;
    const branchRoll = useSignatureBranch
      ? selectionRoll / PROCEDURAL_LEGENDARY_SIGNATURE_SHARE
      : (selectionRoll - PROCEDURAL_LEGENDARY_SIGNATURE_SHARE) /
        (1 - PROCEDURAL_LEGENDARY_SIGNATURE_SHARE);
    const branchWeights = branch.map((base) => weights[bases.indexOf(base)]);
    selected = branch[weightedIndexFromRoll(branchRoll, branchWeights)];
  } else {
    selected = bases[weightedIndex(rng, weights)];
  }
  if (!input.forcedBaseId) return selected;
  const forced = PROCEDURAL_ITEM_BASES[input.forcedBaseId];
  if (!forced || !pool.baseIds.includes(forced.id))
    throw new Error(`forced base ${input.forcedBaseId} is not in pool ${input.basePoolId}`);
  if (rarity === 'legendary' && !baseHasCompatibleLegendary(forced, input.personalLootClass))
    throw new Error(
      `forced base ${input.forcedBaseId} has no compatible legendary power` +
        (input.personalLootClass ? ` for ${input.personalLootClass}` : ''),
    );
  return forced;
}

function itemLevelFromSource(rng: Rng, sourceItemLevel: number, rarity: ActiveRarity): number {
  const variance = rng.int(-1, 1);
  const rarityBonus = rarity === 'legendary' ? 2 : rarity === 'epic' ? 1 : 0;
  return Math.max(1, Math.min(40, Math.floor(sourceItemLevel) + variance + rarityBonus));
}

function countFromWeights(rng: Rng, counts: readonly WeightedAffixCount[]): number {
  return counts[
    weightedIndex(
      rng,
      counts.map((entry) => entry.weight),
    )
  ].count;
}

function eligibleAffixes(base: ProceduralItemBase, itemLevel: number): AffixDefinition[] {
  return Object.values(PROCEDURAL_AFFIXES).filter(
    (affix) =>
      itemLevel >= affix.minItemLevel &&
      (affix.maxItemLevel === undefined || itemLevel <= affix.maxItemLevel) &&
      baseEligibleForAffix(base, affix),
  );
}

function affixWeight(affix: AffixDefinition, cls: PlayerClass | undefined): number {
  return affix.weight * (cls ? (affix.classBias?.[cls] ?? 1) : 1);
}

function affixesCompatible(
  candidate: AffixDefinition,
  selected: readonly AffixDefinition[],
): boolean {
  if (selected.some((affix) => affix.family === candidate.family)) return false;
  const selectedGroups = new Set(selected.flatMap((affix) => affix.exclusiveGroups ?? []));
  return !candidate.exclusiveGroups?.some((group) => selectedGroups.has(group));
}

function selectAffixes(
  rng: Rng,
  pool: AffixDefinition[],
  count: number,
  cls: PlayerClass | undefined,
): AffixDefinition[] {
  const remaining = [...pool];
  const selected: AffixDefinition[] = [];
  while (selected.length < count) {
    const candidates = remaining.filter((affix) => affixesCompatible(affix, selected));
    if (candidates.length === 0)
      throw new Error(`affix pool exhausted after ${selected.length} of ${count} selections`);
    const choice =
      candidates[
        weightedIndex(
          rng,
          candidates.map((affix) => affixWeight(affix, cls)),
        )
      ];
    selected.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  return selected;
}

function quantize(value: number, step = 1): number {
  const digits = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number((Math.round(value / step) * step).toFixed(digits));
}

function forcedItemLevel(value: number | undefined, rolled: number): number {
  if (value === undefined) return rolled;
  if (!Number.isFinite(value)) throw new Error('forced item level must be finite');
  return Math.max(1, Math.min(40, Math.trunc(value)));
}

function legendaryPowerFromRoll(
  selectionRoll: number,
  rollValue: number,
  base: ProceduralItemBase,
  personalLootClass: PlayerClass | undefined,
  sourceTemplateId: string | undefined,
): {
  powerId: string;
  powerRevision: 1;
  rolls: Record<string, number>;
} {
  const compatible = PROCEDURAL_LEGENDARY_POWER_IDS.map(
    (id) => PROCEDURAL_LEGENDARY_POWERS[id],
  ).filter((power) => proceduralLegendaryPowerCompatibleWithBase(power, base, personalLootClass));
  if (compatible.length === 0) throw new Error(`no legendary power is compatible with ${base.id}`);
  const signatures = new Set(proceduralBossLegendarySignatures(sourceTemplateId));
  const preferred = compatible.filter((power) => signatures.has(power.id));
  let power: (typeof compatible)[number];
  if (preferred.length > 0 && selectionRoll < PROCEDURAL_LEGENDARY_SIGNATURE_SHARE) {
    const signatureRoll = selectionRoll / PROCEDURAL_LEGENDARY_SIGNATURE_SHARE;
    power = preferred[Math.min(preferred.length - 1, Math.floor(signatureRoll * preferred.length))];
  } else {
    const globalRoll =
      preferred.length > 0
        ? (selectionRoll - PROCEDURAL_LEGENDARY_SIGNATURE_SHARE) /
          (1 - PROCEDURAL_LEGENDARY_SIGNATURE_SHARE)
        : selectionRoll;
    power = compatible[Math.min(compatible.length - 1, Math.floor(globalRoll * compatible.length))];
  }
  const rolls = Object.fromEntries(
    Object.entries(power.rolls).map(([key, range]) => [
      key,
      Math.max(
        range.min,
        Math.min(range.max, quantize(range.min + (range.max - range.min) * rollValue, range.step)),
      ),
    ]),
  );
  return { powerId: power.id, powerRevision: power.revision, rolls };
}

function generatedName(
  rarity: ActiveRarity,
  base: ProceduralItemBase,
  rolled: readonly RolledAffix[],
  firstWordRoll: number,
  secondWordRoll: number,
): GeneratedItemName {
  if (rarity === 'rare' || rarity === 'epic') {
    return {
      baseId: base.id,
      rareWordIds: [
        PROCEDURAL_RARE_FIRST_WORD_IDS[
          Math.floor(firstWordRoll * PROCEDURAL_RARE_FIRST_WORD_IDS.length)
        ],
        PROCEDURAL_RARE_SECOND_WORD_IDS[
          Math.floor(secondWordRoll * PROCEDURAL_RARE_SECOND_WORD_IDS.length)
        ],
      ],
    };
  }
  if (rarity === 'magic') {
    const dominant = [...rolled].sort(
      (a, b) => b.budget - a.budget || a.affixId.localeCompare(b.affixId),
    )[0];
    const definition = dominant ? PROCEDURAL_AFFIXES[dominant.affixId] : undefined;
    return {
      baseId: base.id,
      ...(definition?.position === 'prefix' && {
        prefixId: definition.nameFragmentId,
      }),
      ...(definition?.position === 'suffix' && {
        suffixId: definition.nameFragmentId,
      }),
    };
  }
  return { baseId: base.id };
}

export function generateProceduralItem(
  input: GenerateProceduralItemInput,
): GeneratedProceduralDrop {
  if (!Number.isInteger(input.seed) || input.seed < 1 || input.seed > 0xffffffff) {
    throw new Error('procedural item seed must be an integer from 1 to 4294967295');
  }

  const rng = new Rng(input.seed);

  // Fixed draw order:
  // 1 rarity, 2 base, 3 item level, 4 affix count, 5 selections,
  // 6 budget shares, 7 budget values, 8 legendary selection, 9 legendary rolls,
  // 10 two name-fragment draws. Forced development values still consume their
  // normal draw before overriding it.
  const rarityTable = PROCEDURAL_RARITY_TABLES[input.rarityTableId];
  if (!rarityTable) throw new Error(`unknown rarity table ${input.rarityTableId}`);
  const rolledRarity = rarityFromTable(rng, rarityTable);
  const rarity = input.forcedRarity ?? rolledRarity;
  const base = chooseBase(rng, input, rarity);
  const itemLevel = forcedItemLevel(
    input.forcedItemLevel,
    itemLevelFromSource(rng, input.sourceItemLevel, rarity),
  );
  const rarityDef = PROCEDURAL_RARITIES[rarity];
  const affixCount = countFromWeights(rng, rarityDef.affixCounts);
  const canonicalBudget = calculateProceduralBudget(base, itemLevel, rarity);
  const affixPool = eligibleAffixes(base, itemLevel);
  const selected = selectAffixes(rng, affixPool, affixCount, input.personalLootClass);
  const shareRolls = selected.map(() => rng.next());
  const valueRolls = selected.map(() => rng.next());
  let affixes: RolledAffix[];
  try {
    affixes = allocateProceduralAffixes({
      affixes: selected,
      itemLevel,
      rarity,
      canonicalBudget,
      shareRolls,
      valueRolls,
    });
  } catch (error) {
    if (!(error instanceof ProceduralBudgetAllocationError)) throw error;
    const fallback = findProceduralBudgetFeasibleAffixSet({
      pool: affixPool,
      count: affixCount,
      itemLevel,
      rarity,
      canonicalBudget,
    });
    if (!fallback) throw error;
    affixes = allocateProceduralAffixes({
      affixes: fallback,
      itemLevel,
      rarity,
      canonicalBudget,
      shareRolls,
      valueRolls,
    });
  }

  const legendarySelectionRoll = rng.next();
  const legendaryMagnitudeRoll = rng.next();
  const legendary =
    rarity === 'legendary'
      ? legendaryPowerFromRoll(
          legendarySelectionRoll,
          legendaryMagnitudeRoll,
          base,
          input.personalLootClass,
          input.context.sourceTemplateId,
        )
      : null;
  const firstNameRoll = rng.next();
  const secondNameRoll = rng.next();

  const procedural: ProceduralItemInstance = {
    version: 1,
    uid: input.uid,
    baseId: base.id,
    itemLevel,
    rarity,
    affixes,
    ...(legendary && {
      legendaryPowerId: legendary.powerId,
      powerRevision: legendary.powerRevision,
      legendaryRolls: legendary.rolls,
    }),
    generatedName: legendary
      ? { baseId: base.id, legendaryNameId: legendary.powerId }
      : generatedName(rarity, base, affixes, firstNameRoll, secondNameRoll),
    seed: input.seed >>> 0,
    dropContext: {
      ...input.context,
      ...(input.context.sourceTags && {
        sourceTags: [...input.context.sourceTags],
      }),
    },
  };

  return { itemId: base.id, instance: { procedural } };
}
