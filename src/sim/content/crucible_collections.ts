// Raid crafting collections. Each profile has three slot choices and one
// two-piece signature. Acquisition and budgets are independent of Perfecting.
import { normalizePrimaryStats, primaryStatBudget } from '../item_budget';
import type { ProfessionRecipeRecord } from '../professions/types';
import type {
  ArmorType,
  CoreStats,
  ItemDef,
  ItemSet,
  LootEntry,
  PlayerClass,
  RecipeItemDef,
} from '../types';

export type CrucibleCollectionRole = 'physical' | 'caster' | 'tank' | 'healer';
export interface CrucibleCollection {
  readonly id: string;
  readonly name: string;
  readonly role: CrucibleCollectionRole;
  readonly armorType: ArmorType;
  readonly craftId: string;
  readonly itemIds: readonly string[];
}

interface Profile {
  id: string;
  label: string;
  role: CrucibleCollectionRole;
  armorType: ArmorType;
  classes: PlayerClass[];
  primary: Partial<CoreStats>;
}

const PROFILES: readonly Profile[] = [
  {
    id: 'crucible_str_mail',
    label: 'Striker',
    role: 'physical',
    armorType: 'mail',
    classes: ['warrior', 'paladin', 'shaman'],
    primary: { str: 17, sta: 8 },
  },
  {
    id: 'crucible_tank_mail',
    label: 'Guardian',
    role: 'tank',
    armorType: 'mail',
    classes: ['warrior', 'paladin', 'shaman'],
    primary: { str: 10, sta: 15 },
  },
  {
    id: 'crucible_caster_mail',
    label: 'Spellcaster',
    role: 'caster',
    armorType: 'mail',
    classes: ['shaman'],
    primary: { int: 17, sta: 8 },
  },
  {
    id: 'crucible_healer_mail',
    label: 'Healer',
    role: 'healer',
    armorType: 'mail',
    classes: ['paladin', 'shaman'],
    primary: { int: 14, spi: 7, sta: 4 },
  },
  {
    id: 'crucible_agi_leather',
    label: 'Skirmisher',
    role: 'physical',
    armorType: 'leather',
    classes: ['rogue', 'hunter'],
    primary: { agi: 17, sta: 8 },
  },
  {
    id: 'crucible_str_leather',
    label: 'Prowler',
    role: 'physical',
    armorType: 'leather',
    classes: ['druid'],
    primary: { str: 17, sta: 8 },
  },
  {
    id: 'crucible_tank_leather',
    label: 'Guardian',
    role: 'tank',
    armorType: 'leather',
    classes: ['druid'],
    primary: { agi: 7, str: 3, sta: 15 },
  },
  {
    id: 'crucible_caster_leather',
    label: 'Spellcaster',
    role: 'caster',
    armorType: 'leather',
    classes: ['druid'],
    primary: { int: 17, sta: 8 },
  },
  {
    id: 'crucible_healer_leather',
    label: 'Healer',
    role: 'healer',
    armorType: 'leather',
    classes: ['druid'],
    primary: { int: 14, spi: 7, sta: 4 },
  },
  {
    id: 'crucible_caster_cloth',
    label: 'Spellcaster',
    role: 'caster',
    armorType: 'cloth',
    classes: ['mage', 'priest', 'warlock'],
    primary: { int: 17, sta: 8 },
  },
  {
    id: 'crucible_healer_cloth',
    label: 'Healer',
    role: 'healer',
    armorType: 'cloth',
    classes: ['mage', 'priest'],
    primary: { int: 14, spi: 7, sta: 4 },
  },
];
const SLOTS = ['chest', 'waist', 'feet'] as const;
const CRAFTS = { mail: 'armorcrafting', leather: 'leatherworking', cloth: 'tailoring' } as const;
const STATION = { mail: 'forge', leather: 'tannery', cloth: 'loom' } as const;
const WEIGHT_NAME = { mail: 'Mail', leather: 'Leather', cloth: 'Cloth' } as const;
const SLOT_NAMES = {
  mail: ['Hauberk', 'Girdle', 'Sabatons'],
  leather: ['Jerkin', 'Belt', 'Boots'],
  cloth: ['Robe', 'Sash', 'Slippers'],
} as const;
const ARMOR = { mail: [380, 265, 255], leather: [215, 150, 145], cloth: [105, 75, 70] } as const;

export const CRUCIBLE_COLLECTIONS: readonly CrucibleCollection[] = Object.freeze(
  PROFILES.map((p) =>
    Object.freeze({
      id: p.id,
      name: `Crucible ${p.label}'s ${WEIGHT_NAME[p.armorType]}`,
      role: p.role,
      armorType: p.armorType,
      craftId: CRAFTS[p.armorType],
      itemIds: Object.freeze(SLOTS.map((slot) => `${p.id}_${slot}`)),
    }),
  ),
);

export const CRUCIBLE_COLLECTION_ITEMS: Record<string, ItemDef> = Object.fromEntries(
  PROFILES.flatMap((profile) =>
    SLOTS.map((slot, index) => {
      const id = `${profile.id}_${slot}`;
      const caster = profile.role === 'caster';
      const healer = profile.role === 'healer';
      const power = index === 0 ? 16 : 12;
      const item: ItemDef = {
        id,
        name: `Crucible ${profile.label}'s ${SLOT_NAMES[profile.armorType][index]}`,
        kind: 'armor',
        armorType: profile.armorType,
        slot,
        quality: 'epic',
        requiredLevel: 20,
        masterwrought: true,
        set: profile.id,
        requiredClass: [...profile.classes],
        stats: {
          ...normalizePrimaryStats(profile.primary, primaryStatBudget(35, 'epic', slot)),
          armor: ARMOR[profile.armorType][index],
        },
        critRating: caster || healer ? 25 : 60,
        hasteRating: caster || healer ? 60 : 25,
        ...(caster ? { spellPower: power } : {}),
        // Spell Power feeds healing too, and supports conversion-based healers.
        ...(healer ? { spellPower: power - 4, healPower: 4 } : {}),
        sellValue: index === 0 ? 12000 : 9000,
      };
      return [id, item];
    }),
  ),
);

export const CRUCIBLE_COLLECTION_PATTERNS: Record<string, RecipeItemDef> = Object.fromEntries(
  CRUCIBLE_COLLECTIONS.map((collection) => {
    const id = `pattern_${collection.id}`;
    const recipeIds = collection.itemIds.map((itemId) => `recipe_${itemId}`);
    return [
      id,
      {
        id,
        name: `Pattern: ${collection.name}`,
        kind: 'recipe',
        quality: 'epic',
        sellValue: 0,
        noVendorSell: true,
        teachesRecipeId: recipeIds[0],
        teachesRecipeIds: recipeIds,
      },
    ];
  }),
);

export const CRUCIBLE_COLLECTION_RECIPES: ProfessionRecipeRecord[] = CRUCIBLE_COLLECTIONS.flatMap(
  (collection) =>
    collection.itemIds.map((itemId) => ({
      id: `recipe_${itemId}`,
      professionId: collection.craftId,
      resultItemId: itemId,
      resultCount: 1,
      skillReq: 100,
      itemLevelBudget: 29,
      level: 29,
      acquisition: ['drop'],
      stationType: STATION[collection.armorType],
      reagents: [
        { itemId: 'lastflame_core', count: 3, noDiscount: true },
        ...(collection.armorType === 'mail'
          ? [
              { itemId: 'fine_thorium_ore', count: 6 },
              { itemId: 'fine_elderwood_log', count: 2 },
            ]
          : collection.armorType === 'leather'
            ? [
                { itemId: 'pristine_hide', count: 4 },
                { itemId: 'tanning_agent', count: 4 },
              ]
            : [
                { itemId: 'spider_silk', count: 8 },
                { itemId: 'spool_of_thread', count: 4 },
              ]),
      ],
    })),
);

export const CRUCIBLE_SIGNATURE_TEXT: Record<CrucibleCollectionRole, string> = {
  physical:
    "Your direct Physical damage and your pets' direct Physical damage build a charge, at most once per second. At 6 charges, you and your pets deal 8% more damage for 6 sec. Charges expire after 8 sec without a qualifying hit and cannot build during the damage bonus. Charges and the damage bonus end when you leave combat or stop wearing two pieces of this collection.",
  caster:
    "Your magic damage and your pets' magic damage build a charge, at most once per second, including damage over time. At 6 charges, you and your pets deal 8% more damage for 6 sec. Charges expire after 8 sec without a qualifying hit and cannot build during the damage bonus. Charges and the damage bonus end when you leave combat or stop wearing two pieces of this collection.",
  tank: 'Enemy damage starts a 10 sec counting period. When health lost during that period reaches 40% of your maximum health, gain a shield absorbing 8% of your maximum health for 6 sec. Can occur once every 20 sec. Absorbed damage and self-damage do not count. Stored damage and the shield end when you leave combat or stop wearing two pieces of this collection. The cooldown does not reset.',
  healer:
    "Healing an ally who is in combat turns 20% of your overhealing into a shield on that ally for 6 sec. Includes healing over time and damage converted into healing. This also works when healing yourself in combat. Protection from all wearers is limited to 5% of the recipient's maximum health. Additional overhealing fills the shield without extending its duration. This protection does not trigger other healing effects. Your shields end when the shielded ally leaves combat, you die, or you stop wearing two pieces of this collection.",
};
export const CRUCIBLE_COLLECTION_SETS: Record<string, ItemSet> = Object.fromEntries(
  CRUCIBLE_COLLECTIONS.map((collection) => [
    collection.id,
    {
      id: collection.id,
      name: collection.name,
      bonuses: [{ pieces: 2, effect: {}, text: CRUCIBLE_SIGNATURE_TEXT[collection.role] }],
    },
  ]),
);

const PATTERN_IDS = [...Object.keys(CRUCIBLE_COLLECTION_PATTERNS), 'formula_lastflame_zeal'];
export const CRUCIBLE_PROFESSION_PATTERN_LOOT: LootEntry[] = PATTERN_IDS.map((itemId) => ({
  itemId,
  chance: 0.025,
  rollGroup: 'crucible_profession_patterns',
}));
export const CRUCIBLE_PATTERN_VENDOR_STOCK = PATTERN_IDS.map((itemId) => ({
  itemId,
  sigilId: 'lastflame_core',
}));

export function crucibleCollectionForItem(itemId: string): CrucibleCollection | undefined {
  return CRUCIBLE_COLLECTIONS.find((collection) => collection.itemIds.includes(itemId));
}

export function crucibleCollectionFamilyForSet(setId: string): CrucibleCollectionRole | undefined {
  return CRUCIBLE_COLLECTIONS.find((collection) => collection.id === setId)?.role;
}
