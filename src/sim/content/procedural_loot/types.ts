import type { ItemTag, ProceduralAffixPosition, ProceduralRarity } from '../../procedural_item';
import type { ArmorType, ItemSlot, PlayerClass, WeaponHand } from '../../types';

export type ProceduralBaseKind = 'weapon' | 'armor' | 'held_offhand';

export interface ProceduralBaseWeapon {
  speed: number;
  damageSpread: number;
}

export interface ProceduralItemBase {
  id: string;
  name: string;
  kind: ProceduralBaseKind;
  slot: ItemSlot;
  armorType?: ArmorType;
  hand?: WeaponHand;
  requiredClass?: PlayerClass[];
  sourceLevel: number;
  baseArmor?: number;
  baseWeapon?: ProceduralBaseWeapon;
  tags: ItemTag[];
  implicitIds?: string[];
  visualItemId: string;
  weaponVisualId?: string;
  slotMultiplier: number;
}

export interface NumericRoll {
  min: number;
  max: number;
  step?: number;
}

export interface AffixTier {
  tier: number;
  minItemLevel: number;
  budgetCost: number;
  rolls: Record<string, NumericRoll>;
}

export interface AffixDefinition {
  id: string;
  family: string;
  position: ProceduralAffixPosition;
  displayName: string;
  nameFragmentId?: string;
  tags: ItemTag[];
  excludedTags?: ItemTag[];
  minItemLevel: number;
  maxItemLevel?: number;
  weight: number;
  tiers: AffixTier[];
  exclusiveGroups?: string[];
  classBias?: Partial<Record<PlayerClass, number>>;
}

export interface WeightedAffixCount {
  count: number;
  weight: number;
}

export interface RarityDefinition {
  id: Exclude<ProceduralRarity, 'mythic'>;
  affixCounts: WeightedAffixCount[];
  budgetMultiplier: number;
  rollFloor: number;
}

export interface RarityTable {
  id: string;
  weights: Partial<Record<Exclude<ProceduralRarity, 'mythic'>, number>>;
}

export interface ProceduralBasePool {
  id: string;
  baseIds: string[];
}
