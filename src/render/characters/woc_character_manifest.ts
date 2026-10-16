// The WOC modular character manifest, data-as-code: a typed port of the
// `character.manifest.json` (schema 1) the artist's handoff ships beside its
// packs. It names every part node the shipped files carry, which nodes each
// appearance variant and armor item selects, and the defaults. The renderer
// never invents a part name: `woc_parts_core.ts` resolves visibility from THIS
// table, and `tests/woc_character.test.ts` pins every node it names against
// the shipped files, because a renamed node fails silently (the body just
// loses a limb, the way the KayKit modular library would).
//
// Item ids here are ASSET ids (`original_helm`), never server item ids: the
// game item to asset mapping is the renderer-owned lookup in woc_parts_core.ts
// (woc_item_display.ts for an item that shows another set's piece).
//
// The files are split the way the artist delivers them (woc_armor_core.ts): one
// base and one animation library per body fit, and one armor file per set, fit
// and texture tier. An item names the SET whose file carries its nodes; a body
// loads its base once and each set the first time a character wears it.
// A base carries the body only. The head (face, neck, eyes, mouth, hair, brows)
// is the modular head library (woc_head_catalog.ts), streamed and hung on the
// `head` bone: the handoff's original face parts never ship, so `appearance`
// names no part of them. The slot table stays in the type for a future body
// part that IS cut into the base file.

import type { WocFit } from './woc_armor_core';

export interface WocAppearanceVariant {
  readonly label: string;
  readonly nodes: readonly string[];
}

export interface WocAppearanceSlot {
  readonly label: string;
  /** A required slot can never be set to null (the face, the neck). */
  readonly required: boolean;
  readonly variants: Readonly<Record<string, WocAppearanceVariant>>;
}

export interface WocArmorItem {
  readonly label: string;
  /** The manifest armor slot this asset fills (`armorSlots` key). */
  readonly slot: string;
  readonly nodes: readonly string[];
  /** Appearance slots hidden while this piece is worn: `hair` is the modular head's
   *  hairstyle (woc_head_look_core.ts wocWornHidesHair), which a helm or hood covers. */
  readonly hidesAppearance?: readonly string[];
  /** The armor set whose file carries these nodes (woc_armor_core.ts wocArmorPackUrl). */
  readonly set: string;
}

export interface WocCharacterManifest {
  readonly schemaVersion: 1;
  readonly rigId: string;
  /** The body fit: which base, animation library and armor fit the character loads. */
  readonly fit: WocFit;
  /** Nodes always shown: the skinned body. */
  readonly baseNodes: readonly string[];
  readonly appearance: Readonly<Record<string, WocAppearanceSlot>>;
  readonly defaultAppearance: Readonly<Record<string, string | null>>;
  readonly armorSlots: Readonly<Record<string, { readonly label: string }>>;
  readonly items: Readonly<Record<string, WocArmorItem>>;
  readonly defaultEquipment: Readonly<Record<string, string | null>>;
  readonly animationNames: readonly string[];
  /** A body atlas swapped in while one armor slot is worn: the paladin's
   *  under-armor cloth shows only under its chest plate, the GLB's own black
   *  suit otherwise. A `textures/skins` PNG shipped with its KTX2 sibling. */
  readonly underArmorAtlas?: { readonly slot: string; readonly url: string };
}

export const WOC_WARRIOR_MANIFEST: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'woc_humanoid_v1',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: {
    head: { label: 'Helmet' },
    chest: { label: 'Chest' },
    arms: { label: 'Shoulders' },
    hands: { label: 'Gloves' },
    waist: { label: 'Waist / tassets' },
    feet: { label: 'Boots' },
    legs: { label: 'Leg armor' },
    back: { label: 'Back' },
  },
  items: {
    original_helm: {
      label: 'Original helmet',
      slot: 'head',
      set: 'warrior',
      nodes: ['Armor_Original_Helm'],
      hidesAppearance: ['hair'],
    },
    original_chest: {
      label: 'Original chest',
      slot: 'chest',
      set: 'warrior',
      nodes: ['Armor_Original_Chest_Front', 'Armor_Original_Chest_Back'],
    },
    original_shoulders: {
      label: 'Original shoulders',
      slot: 'arms',
      set: 'warrior',
      nodes: ['Armor_Original_Shoulder_L', 'Armor_Original_Shoulder_R'],
    },
    original_gauntlets: {
      label: 'Original gloves',
      slot: 'hands',
      set: 'warrior',
      nodes: ['Armor_Original_Gauntlet_L', 'Armor_Original_Gauntlet_R'],
    },
    original_waist: {
      label: 'Original waist / tassets',
      slot: 'waist',
      set: 'warrior',
      nodes: ['Armor_Original_Waist'],
    },
    original_boots: {
      label: 'Original boots',
      slot: 'feet',
      set: 'warrior',
      nodes: ['Armor_Original_Boot_L', 'Armor_Original_Boot_R'],
    },
  },
  defaultEquipment: {
    head: 'original_helm',
    chest: 'original_chest',
    arms: 'original_shoulders',
    hands: 'original_gauntlets',
    waist: 'original_waist',
    feet: 'original_boots',
    legs: null,
    back: null,
  },
  // The 2026-09-24 animation set, in the shipped file's order (51 clips: the one-hand set, the
  // single-weapon *_Single set and, 2026-09-28, the dual-wield set: Combat_Idle_Dual,
  // Dual_Cross, Dual_Stab, Hit_Dual; Dual_Chop is its auto attack). The two-hand *_2H set left
  // the library 2026-09-30: no two-hand stance, a two-hander fights in one fist on the single
  // set (manifest.ts WOC_TWO_HAND).
  animationNames: [
    '1H_Chop',
    '1H_Chop_Single',
    '1H_Slash',
    '1H_Slash_Single',
    '2H_Chop',
    'Block',
    'Bow',
    'Cast_Loop',
    'Cast_Raise',
    'Cast_Shoot',
    'Cheer',
    'Clap',
    'Climb',
    'Combat_Idle',
    'Combat_Idle_Dual',
    'Combat_Idle_Single',
    'Cry',
    'Dance',
    'Death',
    'Dual_Chop',
    'Dual_Cross',
    'Dual_Stab',
    'Fall',
    'Flex',
    'Hit',
    'Hit_Dual',
    'Hit_Single',
    'Idle',
    'Idle_Look',
    'Jump',
    'Jump_Loop',
    'Kneel',
    'Land',
    'Laugh',
    'Lie_Idle',
    'Point',
    'Question',
    'Ranged_Shoot',
    'Roar',
    'Run',
    'Salute',
    'Sheathe',
    'Sit_Down',
    'Sit_Idle',
    'Strafe_Left',
    'Strafe_Right',
    'Swim',
    'Swim_Idle',
    'Walk',
    'Walk_Back',
    'Wave',
  ],
};

/** The paladin: the SAME body and 51 clips as the warrior (the male base and
 *  animation library), dressed from the paladin set. */
export const WOC_PALADIN_MANIFEST: WocCharacterManifest = {
  ...WOC_WARRIOR_MANIFEST,
  items: {
    paladin_helm: {
      label: 'Paladin helmet',
      slot: 'head',
      set: 'paladin',
      nodes: ['Armor_Paladin_Helm'],
      hidesAppearance: ['hair'],
    },
    paladin_chest: {
      label: 'Paladin chest',
      slot: 'chest',
      set: 'paladin',
      nodes: ['Armor_Paladin_Chest_Front', 'Armor_Paladin_Chest_Back'],
    },
    paladin_shoulders: {
      label: 'Paladin shoulders',
      slot: 'arms',
      set: 'paladin',
      nodes: ['Armor_Paladin_Shoulder_L', 'Armor_Paladin_Shoulder_R'],
    },
    paladin_gauntlets: {
      label: 'Paladin gloves',
      slot: 'hands',
      set: 'paladin',
      nodes: ['Armor_Paladin_Gauntlet_L', 'Armor_Paladin_Gauntlet_R'],
    },
    paladin_waist: {
      label: 'Paladin waist / tassets',
      slot: 'waist',
      set: 'paladin',
      nodes: ['Armor_Paladin_Waist'],
    },
    paladin_boots: {
      label: 'Paladin boots',
      slot: 'feet',
      set: 'paladin',
      nodes: ['Armor_Paladin_Boot_L', 'Armor_Paladin_Boot_R'],
    },
  },
  defaultEquipment: {
    head: 'paladin_helm',
    chest: 'paladin_chest',
    arms: 'paladin_shoulders',
    hands: 'paladin_gauntlets',
    waist: 'paladin_waist',
    feet: 'paladin_boots',
    legs: null,
    back: null,
  },
  // The handoff's "Paladin Body Underarmor" (the base pack's own body
  // material variant), extracted at its shipped 512 and encoded beside the
  // skin atlases; worn only under the chest plate (owner rule).
  underArmorAtlas: { slot: 'chest', url: 'textures/skins/woc/paladin_underarmor.png' },
};

/** The FEMALE warrior body (game-ready female-warrior handoff, 2026-09-17):
 *  its own body and fitted armor on the same canonical rig and the same 51
 *  clips; only the armor node names differ from the male's. Picked by the
 *  creation screen's female body choice (manifest.ts playerVisualKey).
 *
 *  Every female character shares ONE base (the split files, woc_armor_core.ts). */
export const WOC_WARRIOR_FEMALE_MANIFEST: WocCharacterManifest = {
  ...WOC_WARRIOR_MANIFEST,
  fit: 'female',
  items: {
    female_warrior_helm: {
      label: 'Female warrior helmet',
      slot: 'head',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Helm'],
      hidesAppearance: ['hair'],
    },
    female_warrior_chest: {
      label: 'Female warrior chest',
      slot: 'chest',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Chest_Front', 'Armor_Female_Warrior_Chest_Back'],
    },
    female_warrior_shoulders: {
      label: 'Female warrior shoulders',
      slot: 'arms',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Shoulder_L', 'Armor_Female_Warrior_Shoulder_R'],
    },
    female_warrior_gauntlets: {
      label: 'Female warrior gloves',
      slot: 'hands',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Gauntlet_L', 'Armor_Female_Warrior_Gauntlet_R'],
    },
    female_warrior_waist: {
      label: 'Female warrior waist / tassets',
      slot: 'waist',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Waist'],
    },
    female_warrior_boots: {
      label: 'Female warrior boots',
      slot: 'feet',
      set: 'warrior',
      nodes: ['Armor_Female_Warrior_Boot_L', 'Armor_Female_Warrior_Boot_R'],
    },
  },
  // The handoff previews with the helm off to show the face; the game keeps the
  // male's full-kit default so both bodies bake and portrait the same way.
  defaultEquipment: {
    head: 'female_warrior_helm',
    chest: 'female_warrior_chest',
    arms: 'female_warrior_shoulders',
    hands: 'female_warrior_gauntlets',
    waist: 'female_warrior_waist',
    feet: 'female_warrior_boots',
    legs: null,
    back: null,
  },
};

/** The FEMALE paladin: the shared female body and face (the 2026-09-17
 *  revision: eyebrows, the 498-triangle helm, rebaked single-material armor)
 *  in the female-paladin set (all but the helm reuse the female warrior's
 *  fitted armor geometry), with the chainmail under-layer swapped onto the
 *  female body's own UV layout while the chest plate is worn. */
export const WOC_PALADIN_FEMALE_MANIFEST: WocCharacterManifest = {
  ...WOC_WARRIOR_FEMALE_MANIFEST,
  items: {
    female_paladin_helm: {
      label: 'Female paladin helmet',
      slot: 'head',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Helm'],
      hidesAppearance: ['hair'],
    },
    female_paladin_chest: {
      label: 'Female paladin chest',
      slot: 'chest',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Chest_Front', 'Armor_Female_Paladin_Chest_Back'],
    },
    female_paladin_shoulders: {
      label: 'Female paladin shoulders',
      slot: 'arms',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Shoulder_L', 'Armor_Female_Paladin_Shoulder_R'],
    },
    female_paladin_gauntlets: {
      label: 'Female paladin gloves',
      slot: 'hands',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Gauntlet_L', 'Armor_Female_Paladin_Gauntlet_R'],
    },
    female_paladin_waist: {
      label: 'Female paladin waist / tassets',
      slot: 'waist',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Waist'],
    },
    female_paladin_boots: {
      label: 'Female paladin boots',
      slot: 'feet',
      set: 'paladin',
      nodes: ['Armor_Female_Paladin_Boot_L', 'Armor_Female_Paladin_Boot_R'],
    },
  },
  defaultEquipment: {
    head: 'female_paladin_helm',
    chest: 'female_paladin_chest',
    arms: 'female_paladin_shoulders',
    hands: 'female_paladin_gauntlets',
    waist: 'female_paladin_waist',
    feet: 'female_paladin_boots',
    legs: null,
    back: null,
  },
  underArmorAtlas: { slot: 'chest', url: 'textures/skins/woc/female_paladin_underarmor.png' },
};

// ---------------------------------------------------------------------------
// The seven equipment-only class sets (WOC Armor Studio, 2026-09-18): hunter,
// rogue, mage, priest, warlock, druid and shaman, each in both body fits. The
// handoff ships armor packs and a body base-color texture per set, no bodies,
// heads or clips: each set ships as its own armor file per fit and texture tier
// on the fit's shared base (scripts/assets/woc_character/build_woc_split.mjs,
// woc_armor_core.ts), the male warrior body or the female paladin revision's
// body and eyebrow face. Every set has the same ten pieces in six slots, so
// the manifests are minted from the naming convention the fragments follow:
// `Armor_<Class>_<Piece>` for the male fit, `Armor_Female_<Class>_<Piece>` for
// the female fit, item ids `<fit>_<class>_<piece>` straight from the artist's
// equipment manifests. Casters wear a hood in the head slot; druid and shaman
// a helm. tests/woc_character.test.ts pins every minted node against the
// shipped armor files.

/** The body fit a class set is minted for (woc_armor_core.ts WocFit). */
export type WocClassFit = WocFit;

/** The classes delivered as equipment sets on the shared bodies. */
export const WOC_CLASS_SETS = [
  'hunter',
  'rogue',
  'mage',
  'priest',
  'warlock',
  'druid',
  'shaman',
] as const;
export type WocClassSet = (typeof WOC_CLASS_SETS)[number];

const WOC_CLASS_HEAD_PIECE: Readonly<Record<WocClassSet, 'Hood' | 'Helm'>> = {
  hunter: 'Hood',
  rogue: 'Hood',
  mage: 'Hood',
  priest: 'Hood',
  warlock: 'Hood',
  druid: 'Helm',
  shaman: 'Helm',
};

const WOC_CLASS_LABELS: Readonly<Record<WocClassSet, string>> = {
  hunter: 'Hunter',
  rogue: 'Rogue',
  mage: 'Mage',
  priest: 'Priest',
  warlock: 'Warlock',
  druid: 'Druid',
  shaman: 'Shaman',
};

/** The body atlas a class set swaps in under its chest piece:
 *  `textures/skins/woc/<class>_underarmor.png` for the male fit,
 *  `female_<class>_underarmor.png` for the female fit. The url names the atlas the skin
 *  convention's way; only its KTX2 sibling ships (loadSkinTexInto requests the sibling), the
 *  PNG masters stay in the character source export. */
export function wocClassUnderArmorAtlas(cls: WocClassSet, fit: WocClassFit): string {
  return `textures/skins/woc/${fit === 'female' ? 'female_' : ''}${cls}_underarmor.png`;
}

/** Mint a class set's manifest on the fit's body manifest. */
export function wocClassManifest(cls: WocClassSet, fit: WocClassFit): WocCharacterManifest {
  const body = fit === 'female' ? WOC_PALADIN_FEMALE_MANIFEST : WOC_WARRIOR_MANIFEST;
  const label = WOC_CLASS_LABELS[cls];
  const prefix = `Armor_${fit === 'female' ? 'Female_' : ''}${label}`;
  const id = (piece: string) => `${fit}_${cls}_${piece}`;
  const head = WOC_CLASS_HEAD_PIECE[cls];
  const headId = id(head.toLowerCase());
  return {
    ...body,
    items: {
      [headId]: {
        label: `${label} ${head.toLowerCase()}`,
        slot: 'head',
        set: cls,
        nodes: [`${prefix}_${head}`],
        hidesAppearance: ['hair'],
      },
      [id('chest')]: {
        label: `${label} chest`,
        slot: 'chest',
        set: cls,
        nodes: [`${prefix}_Chest_Front`, `${prefix}_Chest_Back`],
      },
      [id('shoulders')]: {
        label: `${label} shoulders`,
        slot: 'arms',
        set: cls,
        nodes: [`${prefix}_Shoulder_L`, `${prefix}_Shoulder_R`],
      },
      [id('gauntlets')]: {
        label: `${label} gauntlets`,
        slot: 'hands',
        set: cls,
        nodes: [`${prefix}_Gauntlet_L`, `${prefix}_Gauntlet_R`],
      },
      [id('waist')]: {
        label: `${label} waist`,
        slot: 'waist',
        set: cls,
        nodes: [`${prefix}_Waist`],
      },
      [id('boots')]: {
        label: `${label} boots`,
        slot: 'feet',
        set: cls,
        nodes: [`${prefix}_Boot_L`, `${prefix}_Boot_R`],
      },
    },
    defaultEquipment: {
      head: headId,
      chest: id('chest'),
      arms: id('shoulders'),
      hands: id('gauntlets'),
      waist: id('waist'),
      feet: id('boots'),
      legs: null,
      back: null,
    },
    underArmorAtlas: { slot: 'chest', url: wocClassUnderArmorAtlas(cls, fit) },
  };
}

export const WOC_HUNTER_MANIFEST = wocClassManifest('hunter', 'male');
export const WOC_HUNTER_FEMALE_MANIFEST = wocClassManifest('hunter', 'female');
export const WOC_ROGUE_MANIFEST = wocClassManifest('rogue', 'male');
export const WOC_ROGUE_FEMALE_MANIFEST = wocClassManifest('rogue', 'female');
export const WOC_MAGE_MANIFEST = wocClassManifest('mage', 'male');
export const WOC_MAGE_FEMALE_MANIFEST = wocClassManifest('mage', 'female');
export const WOC_PRIEST_MANIFEST = wocClassManifest('priest', 'male');
export const WOC_PRIEST_FEMALE_MANIFEST = wocClassManifest('priest', 'female');
export const WOC_WARLOCK_MANIFEST = wocClassManifest('warlock', 'male');
export const WOC_WARLOCK_FEMALE_MANIFEST = wocClassManifest('warlock', 'female');
export const WOC_DRUID_MANIFEST = wocClassManifest('druid', 'male');
export const WOC_DRUID_FEMALE_MANIFEST = wocClassManifest('druid', 'female');
export const WOC_SHAMAN_MANIFEST = wocClassManifest('shaman', 'male');
export const WOC_SHAMAN_FEMALE_MANIFEST = wocClassManifest('shaman', 'female');
