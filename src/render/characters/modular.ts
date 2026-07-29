// Modular character composition, pure data + selection math, no three.js.
//
// The modular warrior ships as ONE GLB (`models/chars/modular/warrior_modular.glb`)
// holding every body part, hair style, face part and armour slot piece, all
// skinned to the same KayKit `Rig_Medium` the class rigs use. Composing a
// character is therefore just *picking node names*: assets.ts prunes the parsed
// scene to the picked set, merges what is left by material (rig_merge.ts) and
// caches the result per loadout, so a composed body still costs ~1 draw per
// material rather than one per part.
//
// This module owns the picking and the colour math so both are unit-testable
// without a GL context (`tests/modular_character.test.ts`).

import { UNDERHAIR } from './underhair.generated';

/** Visual key of the modular warrior (manifest.ts VISUALS), the fallback for
 *  a claimed look whose class has no modular def of its own. Every real class
 *  resolves through manifest.ts modularVisualKey instead. */
export const MODULAR_WARRIOR_KEY = 'player_warrior_modular';

export type Gender = 'male' | 'female';

/** Armour slots. A worn piece REPLACES the base body part(s) it covers, except
 *  `back`, which is additive (the cape has nothing underneath). */
export type ArmorSlot = 'head' | 'chest' | 'arms' | 'hands' | 'legs' | 'feet' | 'back';

export const ARMOR_SLOTS: readonly ArmorSlot[] = [
  'head',
  'chest',
  'arms',
  'hands',
  'legs',
  'feet',
  'back',
];

/**
 * Every haircut, in the order the picker lists them: no hair, the two clipper
 * lengths, then sixteen sculpts running short to long.
 *
 * `bald`, `buzz` and `crew` are not geometry, they are a texture decal on the
 * bare head (stubble.ts), because at that length what you are looking at is
 * scalp THROUGH hair rather than a shape with a silhouette.
 *
 * Everything else is a SCULPT, imported from tmp/modular/hair_src/ and fitted
 * to both heads by tmp/modular/hairimp.py. The library used to be parametric,
 * volumes generated on the skull ellipsoid by hair2.py, which gave twenty-odd
 * styles that were all correct and all interchangeable, because a puff profile
 * and a coverage triple cannot describe the thing that makes a haircut a
 * haircut. Those are gone. `messy` is the one style that spans both eras: it
 * was the first sculpt fitted, and it is the same Messy Short Spikes concept,
 * refitted through the general pipeline rather than its own.
 */
export type HairStyle =
  | 'bald'
  | 'buzz'
  | 'crew'
  | 'crewcut'
  | 'pixie'
  | 'sweptpixie'
  | 'quiff'
  | 'sidepart'
  | 'messy'
  | 'curlycap'
  | 'pompadour'
  | 'sweptback'
  | 'fauxhawk'
  | 'mohawk'
  | 'topknot'
  | 'warriorbraid'
  | 'highbun'
  | 'lowbun'
  | 'braidcrown'
  | 'afro'
  | 'curlyafro'
  | 'chinbob'
  | 'bluntbangs'
  | 'wavybob'
  | 'asymbob'
  | 'curtains'
  | 'highpony'
  | 'sidepony'
  | 'halfbun'
  | 'layered'
  | 'curls'
  | 'longwavy'
  | 'longcenterpart'
  | 'longpart'
  | 'mullet'
  | 'twinbraids'
  | 'lowpony'
  | 'fantasybraid';
export type BeardStyle =
  | 'none'
  | 'stubble'
  | 'scruff'
  | 'mutton'
  | 'goatee'
  | 'chinpuff'
  | 'stache'
  | 'horseshoe'
  | 'shortbox'
  | 'full'
  | 'vikingb'
  | 'wizard'
  | 'stubblebeard';
export type BrowStyle =
  | 'none'
  | 'soft'
  | 'thick'
  | 'angled'
  | 'flat'
  | 'arched'
  | 'thin'
  | 'bushy'
  | 'worried'
  | 'sharp'
  | 'round';
/** Eye SHAPE. Size is the `eyes` slider and colour is its own wheel, so these
 *  are purely outline: lid flatness, corner droop and tilt. */
export type EyeStyle =
  | 'round'
  | 'almond'
  | 'narrow'
  | 'wide'
  | 'sharp'
  | 'droopy'
  | 'sleepy'
  | 'wideset'
  | 'cat'
  | 'doe';
export type EarStyle = 'round' | 'pointed' | 'small' | 'wide';

/** Continuous face controls, each -1..1, driven by a matching PAIR of morph
 *  targets (`nose_up` / `nose_dn`) so one slider can push either way. */
export type FaceSlider = 'nose' | 'eyes' | 'jaw' | 'brow' | 'cheeks' | 'chin' | 'ears' | 'smirk';
export const FACE_SLIDERS: readonly FaceSlider[] = [
  'nose',
  'eyes',
  'ears',
  'jaw',
  'brow',
  'cheeks',
  'chin',
  // The smirk used to be baked into the head mesh, so every character wore it.
  // The base is symmetric now and this dials it in on purpose.
  'smirk',
];
/** The mouth is its OWN PART, like the eyes, it used to be a crease in the head
 *  driven by exclusive morphs.
 *
 *  Measured, neither head actually had a mouth: a 15mm dent on the male that had
 *  faded to nothing by x=0.06, and none at all on the female. What the female
 *  was showing was the shading of her triangulation, which is why hers "looked
 *  cleaner", there was less there to look wrong. A 13-vertex band cannot hold a
 *  mouth, so no amount of morph tuning was going to make one even.
 *
 *  As a part it can have lips that stand PROUD of the skin (a dent only goes
 *  inward), it is mirror-symmetric by construction rather than by two ray casts
 *  agreeing, and the open styles can be a different mesh, with an aperture, a
 *  dark cavity and their own teeth, rather than a deformation of a closed one. */
export type MouthStyle =
  | 'neutral'
  | 'lips'
  | 'smile'
  | 'frown'
  | 'wide'
  | 'pout'
  | 'grin'
  | 'open'
  | 'awe';
export const MOUTH_STYLES: readonly MouthStyle[] = [
  'neutral',
  'lips',
  'smile',
  'frown',
  'wide',
  'pout',
  'grin',
  'open',
  'awe',
];
export type FaceShape = Record<FaceSlider, number>;
export const NEUTRAL_FACE: FaceShape = {
  nose: 0,
  eyes: 0,
  ears: 0,
  jaw: 0,
  brow: 0,
  cheeks: 0,
  chin: 0,
  smirk: 0,
};

/** Body sliders, the face sliders' pattern on the trunk and limbs: each maps
 *  to a `body_<key>_up` / `body_<key>_dn` shape-key pair baked by
 *  tmp/modular/bodykeys.py onto the body parts. They are silhouette bulges,
 *  never bone moves, the hand grows about the wrist, the hips widen in
 *  place, so weapon grips and the walk cycle are untouched. Parts carrying
 *  morphs stay out of mergeSkinnedParts, and only the LOCAL player composes
 *  a modular body, so the extra draws never multiply across a crowd. */
export type BodySlider = 'shoulders' | 'chest' | 'hips' | 'hands' | 'elbows' | 'knees' | 'feet';
export const BODY_SLIDERS: readonly BodySlider[] = [
  'shoulders',
  'chest',
  'hips',
  'hands',
  'elbows',
  'knees',
  'feet',
];
export type BodyShape = Record<BodySlider, number>;
export const NEUTRAL_BODY: BodyShape = {
  shoulders: 0,
  chest: 0,
  hips: 0,
  hands: 0,
  elbows: 0,
  knees: 0,
  feet: 0,
};
/** Jewellery: earrings, and on some sets a face piercing too. One slot, because
 *  a set is a LOOK, the elf's crescent comes with the brow bar that matches it
 * and because a second picker row for two pieces of metal is not a feature.
 *
 *  Rebuilt 2026-08-03 (tmp/modular/jewel.py). The old set was ten variations on
 *  a hoop, and none of them touched the ear: every piece hung from a
 *  hand-written anchor 20mm above and 70mm outboard of the lobe, so the whole
 *  row rendered as metal floating beside the head. */
export type EarringStyle =
  | 'none'
  | 'stud'
  | 'hoop'
  | 'bone'
  | 'bonehoop'
  | 'moon'
  | 'moonstar'
  | 'feather'
  | 'runic'
  | 'cuff'
  | 'chain'
  | 'septum'
  | 'warden';

// --- makeup ----------------------------------------------------------------
//
// Three layers, each a short list of named shades with `none` first, so one
// control carries both "is it on" and "which colour", and OFF is simply the
// first swatch. A colour WHEEL would be wrong here: skin, hair and eyes are
// continuous because any value of them is a person, whereas makeup is a product
// you own in a few shades.
//
// Lipstick is a material tint, not a decal. The mouth stopped being a crease in
// the head and became its own part standing proud of the skin
// (see the mouth notes above), so a decal painted on the head at the lip band
// lands BEHIND the lips and is never seen. The part already carries the lip
// body on `mod_skin` and the mouth line on `mod_mouth`, so recolouring the
// first of those is the whole feature, no geometry, no texture, no draw call.
// Blush and eyeshadow have no part in the way (cheek and eyelid are bare head
// skin) and are a decal: see makeup.ts.

export type LipShade = 'none' | 'rose' | 'coral' | 'ruby' | 'berry' | 'plum' | 'nude';
export type BlushShade = 'none' | 'peach' | 'rose' | 'warm' | 'mauve';
export type ShadowShade = 'none' | 'smoke' | 'bronze' | 'plum' | 'teal' | 'rose';

export const LIP_SHADES: readonly LipShade[] = [
  'none',
  'rose',
  'coral',
  'ruby',
  'berry',
  'plum',
  'nude',
];
export const BLUSH_SHADES: readonly BlushShade[] = ['none', 'peach', 'rose', 'warm', 'mauve'];
export const SHADOW_SHADES: readonly ShadowShade[] = [
  'none',
  'smoke',
  'bronze',
  'plum',
  'teal',
  'rose',
];

/** sRGB hex per shade. `none` carries no colour and is never looked up, the
 *  swatch for it is drawn as an empty chip by the customizer. */
export const LIP_COLORS: Record<Exclude<LipShade, 'none'>, number> = {
  rose: 0xc4677a,
  coral: 0xd9705c,
  ruby: 0xa8213a,
  berry: 0x8e2f52,
  plum: 0x6d2b47,
  nude: 0xb98274,
};
export const BLUSH_COLORS: Record<Exclude<BlushShade, 'none'>, number> = {
  peach: 0xe08a6b,
  rose: 0xd4718a,
  warm: 0xc9604f,
  mauve: 0xa96b83,
};
export const SHADOW_COLORS: Record<Exclude<ShadowShade, 'none'>, number> = {
  smoke: 0x5a5560,
  bronze: 0x8a5c34,
  plum: 0x6b3f63,
  teal: 0x35636a,
  rose: 0xa8617a,
};

/** The colour a shade paints with, or null for `none`. */
export function lipColor(shade: LipShade): number | null {
  return shade === 'none' ? null : LIP_COLORS[shade];
}
export function blushColor(shade: BlushShade): number | null {
  return shade === 'none' ? null : BLUSH_COLORS[shade];
}
export function shadowColor(shade: ShadowShade): number | null {
  return shade === 'none' ? null : SHADOW_COLORS[shade];
}

// Shortest first (mirroring HAIR_IMPORT_ORDER in tmp/modular/hairimp.py), so
// the picker reads as a length ramp rather than as the order the sculpts
// happened to arrive in.
export const HAIR_STYLES: readonly HairStyle[] = [
  'bald',
  'buzz',
  'crew',
  'crewcut',
  'pixie',
  'sweptpixie',
  'quiff',
  'sidepart',
  'messy',
  'curlycap',
  'pompadour',
  'sweptback',
  'fauxhawk',
  'mohawk',
  'topknot',
  'warriorbraid',
  'highbun',
  'lowbun',
  'braidcrown',
  'afro',
  'curlyafro',
  'chinbob',
  'bluntbangs',
  'wavybob',
  'asymbob',
  'curtains',
  'highpony',
  'sidepony',
  'halfbun',
  'layered',
  'curls',
  'longwavy',
  'longcenterpart',
  'longpart',
  'mullet',
  'twinbraids',
  'lowpony',
  'fantasybraid',
];
export const BEARD_STYLES: readonly BeardStyle[] = [
  'none',
  'stubble',
  'scruff',
  'mutton',
  'goatee',
  'chinpuff',
  'stache',
  'horseshoe',
  'shortbox',
  'full',
  'vikingb',
  // `stubblebeard` is the GEOMETRY stubble sculpt and is deliberately distinct
  // from `stubble`, which is the painted decal.
  'wizard',
  'stubblebeard',
];
export const BROW_STYLES: readonly BrowStyle[] = [
  'none',
  'soft',
  'thick',
  'angled',
  'flat',
  'arched',
  'thin',
  'bushy',
  'worried',
  'sharp',
  'round',
];
export const EYE_STYLES: readonly EyeStyle[] = [
  'round',
  'almond',
  'narrow',
  'wide',
  'sharp',
  'droopy',
  'sleepy',
  'wideset',
  'cat',
  'doe',
];
export const EAR_STYLES: readonly EarStyle[] = ['round', 'pointed', 'small', 'wide'];
export const EARRING_STYLES: readonly EarringStyle[] = [
  'none',
  'stud',
  'hoop',
  'bone',
  'bonehoop',
  'moon',
  'moonstar',
  'feather',
  'runic',
  'cuff',
  'chain',
  'septum',
  'warden',
];

/** A character's authored look. Colours are stored as HSL so the creation UI's
 *  wheel (hue + saturation) and its light/dark slider map to the stored value
 *  directly, and so a stored appearance stays meaningful if the palette shifts. */
export interface ModularAppearance {
  gender: Gender;
  hair: HairStyle;
  beard: BeardStyle;
  brows: BrowStyle;
  earrings: EarringStyle;
  /** what the worn piercing set is MADE of; 'default' keeps the atlas ride */
  earringMaterial: EarringMaterial;
  /** skin: hue 0..360, saturation 0..1, lightness 0..1 */
  skinHue: number;
  skinSat: number;
  skinLight: number;
  hairHue: number;
  hairSat: number;
  hairLight: number;
  /** -1..1 per feature; 0 is the sculpted default. */
  face: FaceShape;
  /** -1..1 per body region; 0 is the sculpted default. */
  body: BodyShape;
  mouth: MouthStyle;
  eyeShape: EyeStyle;
  ears: EarStyle;
  /** KayKit models a lash flicking off the outer corner of the eye. It is its
   *  own part here so it can be switched off, and its own MATERIAL so it can be
   *  coloured apart from the hair.
   *
   *  Standard on the FEMALE body and off on the male, see {@link defaultLashes}.
   *  Still a free toggle either way; only the default and the randomiser are
   *  gendered. */
  lashes: boolean;
  lashHue: number;
  lashSat: number;
  lashLight: number;
  eyeHue: number;
  eyeSat: number;
  eyeLight: number;
  /** Makeup. All three are OFF by default (`'none'`) and are picked from a
   *  short list of shades rather than a colour wheel, see MAKEUP_SHADES. */
  lipstick: LipShade;
  blush: BlushShade;
  eyeshadow: ShadowShade;
  /** The colorway the worn armour is dyed with, `classic` is the atlas as
   *  authored. One choice re-dyes whatever set (or mix of sets) is worn, each
   *  material through its own set's band; see OUTFIT_COLORWAYS. */
  outfit: OutfitColorway;
}

export const DEFAULT_APPEARANCE: ModularAppearance = {
  gender: 'male',
  hair: 'crew',
  beard: 'none',
  brows: 'soft',
  earrings: 'none',
  earringMaterial: 'default',
  skinHue: 27,
  skinSat: 0.46,
  skinLight: 0.68,
  hairHue: 26,
  hairSat: 0.5,
  hairLight: 0.24,
  face: NEUTRAL_FACE,
  body: NEUTRAL_BODY,
  mouth: 'neutral',
  eyeShape: 'almond',
  ears: 'round',
  // the default body is male, and lashes are the female standard
  lashes: false,
  // starts on the hair's default so the out-of-the-box look still reads as
  // "lashes match the hair"; the wheel is there to break that on purpose
  lashHue: 26,
  lashSat: 0.5,
  lashLight: 0.24,
  eyeHue: 28,
  eyeSat: 0.42,
  eyeLight: 0.18,
  // Makeup is opt-in on every body, male or female: it is a thing you put on,
  // not a thing a face comes with.
  lipstick: 'none',
  blush: 'none',
  eyeshadow: 'none',
  outfit: 'classic',
};

/** The seven KayKit class kits, all carved into the same slots and all fitted
 *  to the same body (see tmp/modular/classfit.py). A set does not have to fill
 *  every slot: the sets with no helmet leave `head` alone so the character's own
 *  hair shows, and the mage has no `hands` piece because KayKit models its hands
 *  as bare flesh, wearing it should show the player's hands, not a peach mitten
 *  painted from the mage atlas. */
export type ArmorSetId = 'knight' | 'barbarian' | 'druid' | 'mage' | 'paladin' | 'ranger' | 'rogue';

export const ARMOR_SETS: readonly ArmorSetId[] = [
  'knight',
  'barbarian',
  'druid',
  'mage',
  'paladin',
  'ranger',
  'rogue',
];

/** Which armour set fills each slot. Absent (or null) means the slot is empty
 *  and the bare body shows through. */
export type ArmorLoadout = Partial<Record<ArmorSlot, ArmorSetId | null>>;

/** The kit a class wears out of the box, the same pairing the fixed class
 *  rigs already ship (the shaman wears the barbarian model, the priest and
 *  warlock the mage's robes, the hunter the ranger leathers), so a composed
 *  character reads as their class at a glance until real armour mapping
 *  arrives. Keyed by sim PlayerClass name; kept here with the set tables so a
 *  new kit and its wearer land in one place. */
export const CLASS_ARMOR_SETS: Record<string, ArmorSetId> = {
  warrior: 'knight',
  paladin: 'paladin',
  hunter: 'ranger',
  rogue: 'rogue',
  priest: 'mage',
  shaman: 'barbarian',
  mage: 'mage',
  warlock: 'mage',
  druid: 'druid',
};

/** The default kit for a class, knight (the warrior's) when unknown. */
export function classArmorSet(cls: string): ArmorSetId {
  return CLASS_ARMOR_SETS[cls] ?? 'knight';
}

/** Everything the renderer needs to compose one character. */
export interface ModularLook {
  app: ModularAppearance;
  worn: ArmorLoadout;
}

/** Every slot filled from one set. Slots that set has no piece for resolve to
 *  nothing, so this stays correct for the sets missing a helm or gauntlets. */
export function fullSet(set: ArmorSetId): ArmorLoadout {
  const out: ArmorLoadout = {};
  for (const slot of ARMOR_SLOTS) out[slot] = set;
  return out;
}

export const KNIGHT_FULL: ArmorLoadout = fullSet('knight');

/** What a modular visual composes when no per-entity look was supplied.
 *
 *  This is the FULL kit, helm included, because prepareVisual() measures the
 *  normalization scale off it: `normScale = def.height / measuredHeight`, so
 *  measuring a bare-headed body would scale the whole warrior up ~9% to make
 *  the shorter silhouette reach `def.height`, a modular warrior would stand
 *  visibly chunkier than a paladin. Measuring the helmed silhouette (exactly
 *  what `player_warrior` measures, since its `show` keeps Knight_Helmet) keeps
 *  BODY scale identical between the two, and removing the helm then simply
 *  lowers the silhouette, as it should. */
export const DEFAULT_LOOK: ModularLook = {
  app: DEFAULT_APPEARANCE,
  worn: KNIGHT_FULL,
};

// --- node-name tables (must match the exported GLB; see tmp/modular/) --------

/** Base body part nodes per gender, keyed by the armour slot that hides them. */
const BODY_BY_SLOT: Record<Gender, Record<ArmorSlot, readonly string[]>> = {
  male: {
    head: ['M_Head'],
    chest: ['M_Torso'],
    arms: ['M_ArmL', 'M_ArmR'],
    hands: ['M_HandL', 'M_HandR'],
    legs: ['M_LegL', 'M_LegR'],
    feet: ['M_FootL', 'M_FootR'],
    back: [],
  },
  female: {
    head: ['F_Head'],
    chest: ['F_Torso'],
    arms: ['F_ArmL', 'F_ArmR'],
    hands: ['F_HandL', 'F_HandR'],
    legs: ['F_LegL', 'F_LegR'],
    feet: ['F_FootL', 'F_FootR'],
    back: [],
  },
};

/** Underclothing, and the slot whose armour REPLACES it, or `null` for a piece
 *  armour never replaces.
 *
 *  The loincloth is not additive: under a set of tassets it pokes through them,
 *  and it has nothing left to cover once the slot is filled. So it is drawn
 *  only while `legs` is bare.
 *
 *  The chest wrap is the exception (Troy, 2026-08-03) and answers to no slot at
 *  all. Several sets are cut open at the chest or the midriff, the druid and
 *  the rogue most of all, and replacing the wrap with them puts a bare chest
 *  under the gap rather than armour over the wrap. It is clamped against every
 *  set in turn at authoring time (garment.py), so it fits under the closed ones
 *  too. */
const UNDERWEAR: Record<Gender, readonly { node: string; slot: ArmorSlot | null }[]> = {
  male: [{ node: 'M_Loin', slot: 'legs' }],
  female: [
    { node: 'F_Loin', slot: 'legs' },
    { node: 'F_Top', slot: null },
  ],
};

/** Does `worn` actually put a piece on this slot? A set that has no piece for
 *  the slot (a helmless kit, the mage's bare hands) does not count as covering
 *  it. */
export function slotCovered(worn: ArmorLoadout, slot: ArmorSlot): boolean {
  const set = worn[slot];
  return !!set && (ARMOR_BY_SET[set]?.[slot].length ?? 0) > 0;
}

// --- helm kinds --------------------------------------------------------------
//
// Headgear is not one thing (Troy, 2026-08-06). A FULL helm is a closed shell:
// it swallows the hair, the ears and the earrings on them, and the beard,
// nothing of the head's dressing survives it. A HAT sits ON the head: the ears
// stay (and the piercings with them), the beard stays, and the hair follows
// the length rule below. The sets with no head piece are neither.

/** What a look's headgear is: nothing, a hat, or a closed helm. */
export type HelmKind = 'none' | 'hat' | 'full';

/** Every head piece in the kit, classified. The knight's helm has a visor and
 *  the paladin's is a crusader bucket, closed shells both. The barbarian's
 *  bear hood and the mage's pointed hat are hats: open at the face AND at the
 *  sides, so the ears are genuinely on screen. A set absent here has no head
 *  piece at all. An unknown future set defaults to `full` in helmKind(), the
 *  conservative read, since a closed shell showing hair through it is the worse
 *  artifact. */
export const HELM_KIND_BY_SET: Partial<Record<ArmorSetId, 'hat' | 'full'>> = {
  knight: 'full',
  paladin: 'full',
  barbarian: 'hat',
  mage: 'hat',
};

/** The headgear a loadout actually wears. Tests the slot for a real PIECE,
 *  exactly like the old boolean did: wearing the druid "head slot" (no piece)
 *  is `none`, not a hat. */
export function helmKind(worn: ArmorLoadout): HelmKind {
  if (!slotCovered(worn, 'head')) return 'none';
  return HELM_KIND_BY_SET[worn.head as ArmorSetId] ?? 'full';
}

/** Styles whose fall hangs clear of a hat's rim, chin-length and below. Under
 *  a hat these render as `layered` (shoulder-length loose hair): the hat
 *  swallows the styled top, but hair that long must still BE there below it.
 *  Everything else, the decal cuts, the short shells, and the updos (buns,
 *  topknot, braidcrown, whose whole shape is hair pulled UP into the hat),
 *  renders as no volume at all, scalp growth showing as usual. */
const LONG_HAIR = new Set<HairStyle>([
  'chinbob',
  'bluntbangs',
  'wavybob',
  'asymbob',
  'curtains',
  'highpony',
  'sidepony',
  'halfbun',
  'layered',
  'curls',
  'longwavy',
  'longcenterpart',
  'longpart',
  'mullet',
  'twinbraids',
  'lowpony',
  'fantasybraid',
  'warriorbraid',
]);

/** Whether a style reads as long hair (used by the hat rule). */
export function isLongHair(hair: HairStyle): boolean {
  return LONG_HAIR.has(hair);
}

/** The hair VOLUME a look renders once headgear is considered: the style's own
 *  under no headgear, nothing under a full helm, and under a hat nothing for
 *  short cuts but `layered` for long ones. */
export function effectiveHairStyle(hair: HairStyle, kind: HelmKind): HairStyle | null {
  if (kind === 'none') return hair;
  if (kind === 'hat') return isLongHair(hair) ? 'layered' : null;
  return null;
}

/** Node names per set per slot. A missing slot is deliberate, not an omission:
 *  see ArmorSetId. */
const ARMOR_BY_SET: Record<ArmorSetId, Record<ArmorSlot, readonly string[]>> = {
  knight: {
    head: ['Armor_knight_Head', 'Armor_knight_Head1'],
    chest: ['Armor_knight_Chest'],
    arms: ['Armor_knight_ArmL', 'Armor_knight_ArmR'],
    hands: ['Armor_knight_HandL', 'Armor_knight_HandR'],
    legs: ['Armor_knight_LegL', 'Armor_knight_LegR'],
    feet: ['Armor_knight_FootL', 'Armor_knight_FootR'],
    back: ['Armor_knight_Back'],
  },
  barbarian: {
    head: ['Armor_barbarian_Head'],
    chest: ['Armor_barbarian_Chest'],
    arms: ['Armor_barbarian_ArmL', 'Armor_barbarian_ArmR'],
    hands: ['Armor_barbarian_HandL', 'Armor_barbarian_HandR'],
    legs: ['Armor_barbarian_LegL', 'Armor_barbarian_LegR'],
    feet: ['Armor_barbarian_FootL', 'Armor_barbarian_FootR'],
    back: [],
  },
  druid: {
    head: [],
    chest: ['Armor_druid_Chest'],
    arms: ['Armor_druid_ArmL', 'Armor_druid_ArmR'],
    hands: ['Armor_druid_HandL', 'Armor_druid_HandR'],
    legs: ['Armor_druid_LegL', 'Armor_druid_LegR'],
    feet: ['Armor_druid_FootL', 'Armor_druid_FootR'],
    back: ['Armor_druid_Back'],
  },
  mage: {
    head: ['Armor_mage_Head'],
    chest: ['Armor_mage_Chest'],
    arms: ['Armor_mage_ArmL', 'Armor_mage_ArmR'],
    hands: [],
    legs: ['Armor_mage_LegL', 'Armor_mage_LegR'],
    feet: ['Armor_mage_FootL', 'Armor_mage_FootR'],
    back: ['Armor_mage_Back'],
  },
  paladin: {
    head: ['Armor_paladin_Head'],
    chest: ['Armor_paladin_Chest'],
    arms: ['Armor_paladin_ArmL', 'Armor_paladin_ArmR'],
    hands: ['Armor_paladin_HandL', 'Armor_paladin_HandR'],
    legs: ['Armor_paladin_LegL', 'Armor_paladin_LegR'],
    feet: ['Armor_paladin_FootL', 'Armor_paladin_FootR'],
    back: ['Armor_paladin_Back'],
  },
  ranger: {
    head: [],
    chest: ['Armor_ranger_Chest'],
    arms: ['Armor_ranger_ArmL', 'Armor_ranger_ArmR'],
    hands: ['Armor_ranger_HandL', 'Armor_ranger_HandR'],
    legs: ['Armor_ranger_LegL', 'Armor_ranger_LegR'],
    feet: ['Armor_ranger_FootL', 'Armor_ranger_FootR'],
    back: ['Armor_ranger_Back', 'Armor_ranger_Back1'],
  },
  rogue: {
    head: [],
    chest: ['Armor_rogue_Chest'],
    arms: ['Armor_rogue_ArmL', 'Armor_rogue_ArmR'],
    hands: ['Armor_rogue_HandL', 'Armor_rogue_HandR'],
    legs: ['Armor_rogue_LegL', 'Armor_rogue_LegR'],
    feet: ['Armor_rogue_FootL', 'Armor_rogue_FootR'],
    back: ['Armor_rogue_Back'],
  },
};

/** Every style but the three shortest is one imported sculpt, fitted to both
 *  heads (tmp/modular/hairimp.py) and shipped as a single `H2_*` node, one
 *  mesh for both genders, which is true because the fit clamps the shell clear
 *  of BOTH heads rather than because the two skulls are alike.
 *
 *  `bald`, `buzz` and `crew` name no node: the two clipper lengths are a
 *  texture decal on the bare head (see stubble.ts), because at that length what
 *  you are looking at is scalp through hair rather than a shape with a
 *  silhouette. The head is picked as it always was and the decal is built from
 *  its own surface at compose time. */
// A tailed style lists its E2_band_* cuff next to the volume: the band is the
// metal tie the tail hangs from (tmp/modular/bands.py), worn whenever the hair
// is. The E2_ prefix routes it through the jewel material path in assets.ts,
// knight-atlas gold by default, the player's piercing preset when one is
// picked, whether or not any earring is worn.
const HAIR_NODES: Record<HairStyle, readonly string[]> = {
  bald: [],
  buzz: [],
  crew: [],
  crewcut: ['H2_crewcut'],
  pixie: ['H2_pixie'],
  sweptpixie: ['H2_sweptpixie'],
  quiff: ['H2_quiff'],
  sidepart: ['H2_sidepart'],
  messy: ['H2_messy'],
  curlycap: ['H2_curlycap'],
  pompadour: ['H2_pompadour'],
  sweptback: ['H2_sweptback'],
  fauxhawk: ['H2_fauxhawk'],
  mohawk: ['H2_mohawk'],
  topknot: ['H2_topknot', 'E2_band_topknot'],
  warriorbraid: ['H2_warriorbraid', 'E2_band_warriorbraid'],
  highbun: ['H2_highbun'],
  lowbun: ['H2_lowbun'],
  braidcrown: ['H2_braidcrown'],
  afro: ['H2_afro'],
  curlyafro: ['H2_curlyafro'],
  chinbob: ['H2_chinbob'],
  bluntbangs: ['H2_bluntbangs'],
  wavybob: ['H2_wavybob'],
  asymbob: ['H2_asymbob'],
  curtains: ['H2_curtains'],
  highpony: ['H2_highpony', 'E2_band_highpony'],
  sidepony: ['H2_sidepony', 'E2_band_sidepony'],
  halfbun: ['H2_halfbun'],
  layered: ['H2_layered'],
  curls: ['H2_curls'],
  longwavy: ['H2_longwavy'],
  longcenterpart: ['H2_longcenterpart'],
  longpart: ['H2_longpart'],
  mullet: ['H2_mullet'],
  twinbraids: ['H2_twinbraids', 'E2_band_twinbraids'],
  lowpony: ['H2_lowpony', 'E2_band_lowpony'],
  fantasybraid: ['H2_fantasybraid', 'E2_band_fantasybraid'],
};

/** Beards are their own slot: a style can pair any beard with any hair.
 *  Every volume is a Fit Studio sculpt (BI_*), the parametric B2_ placeholder
 *  set is retired; saved looks that wore one land on the nearest sculpt via
 *  BEARD_LEGACY. */
const BEARD_NODES: Record<BeardStyle, readonly string[]> = {
  none: [],
  stubble: [],
  scruff: [],
  mutton: ['BI_mutton'],
  goatee: ['BI_goatee'],
  chinpuff: ['BI_chinpuff'],
  stache: ['BI_stache'],
  horseshoe: ['BI_horseshoe'],
  shortbox: ['BI_shortbox'],
  full: ['BI_full'],
  vikingb: ['BI_vikingb', 'E2_band_vikingb'],
  // No band on the wizard beard: it tapers to a point rather than being
  // gathered, so a cuff reads as a bead stuck on it instead of as a tie.
  wizard: ['BI_wizard'],
  stubblebeard: ['BI_stubblebeard'],
};

/** Retired hairstyles → the closest surviving style (same idea as
 *  BEARD_LEGACY below). `slickback` removed 2026-08-07 (Troy). */
const HAIR_LEGACY: Record<string, HairStyle> = {
  slickback: 'sweptback',
};

/** Retired placeholder styles → the closest surviving sculpt, so an old save
 *  keeps a beard of roughly the same silhouette instead of going clean-shaven. */
const BEARD_LEGACY: Record<string, BeardStyle> = {
  chinstrap: 'shortbox',
  sideburns: 'mutton',
  circle: 'goatee',
  vandyke: 'goatee',
  anchor: 'goatee',
  soulpatch: 'chinpuff',
  handlebar: 'stache',
  garibaldi: 'full',
  ducktail: 'full',
  bandholz: 'full',
  viking: 'vikingb',
};

/** Earrings mirror onto BOTH ears and fit either head. */
const EARRING_NODES: Record<EarringStyle, readonly string[]> = {
  none: [],
  stud: ['E2_stud'],
  hoop: ['E2_hoop'],
  bone: ['E2_bone'],
  bonehoop: ['E2_bonehoop'],
  moon: ['E2_moon'],
  moonstar: ['E2_moonstar'],
  feather: ['E2_feather'],
  runic: ['E2_runic'],
  cuff: ['E2_cuff'],
  chain: ['E2_chain'],
  septum: ['E2_septum'],
  warden: ['E2_warden'],
};

function hairNodes(_gender: Gender, style: HairStyle): readonly string[] {
  return HAIR_NODES[style] ?? [];
}

/** Eyes, brows, lashes and ears are their own parts (they used to be islands
 *  inside the head mesh, which is why none of them could be swapped or scaled)
 * and every one of them is built PER HEAD.
 *
 *  They are projected onto the face they sit on, and the two heads are separate
 *  sculpts rather than one scaled copy, so a part built against the male head
 *  lands inside the female one: shipping a single set left every female
 *  character with no eyes at all. The gender prefix is the same convention the
 *  fuzz caps and stubble patches already use, for the same reason. */
function facePart(gender: Gender, kind: string, style: string): string {
  return `${gender === 'female' ? 'F' : 'M'}_${kind}_${style}`;
}

function browNodes(gender: Gender, style: BrowStyle): readonly string[] {
  return style === 'none' ? [] : [facePart(gender, 'Brow', style)];
}

function eyeNodes(gender: Gender, style: EyeStyle): readonly string[] {
  return [facePart(gender, 'Eye', EYE_STYLES.includes(style) ? style : 'almond')];
}

function lashNodes(gender: Gender, style: EyeStyle, on: boolean): readonly string[] {
  if (!on) return [];
  return [facePart(gender, 'Lash', EYE_STYLES.includes(style) ? style : 'almond')];
}

function earNodes(gender: Gender, style: EarStyle): readonly string[] {
  return [facePart(gender, 'Ear', EAR_STYLES.includes(style) ? style : 'round')];
}

function mouthNodes(gender: Gender, style: MouthStyle): readonly string[] {
  return [facePart(gender, 'Mouth', MOUTH_STYLES.includes(style) ? style : 'neutral')];
}

function beardNodes(_gender: Gender, style: BeardStyle): readonly string[] {
  return BEARD_NODES[style] ?? [];
}

// --- decal styles ----------------------------------------------------------
//
// Four styles are growth too short to have a shape of its own: at buzz/stubble
// length you are looking at scalp THROUGH hair. They used to ship as geometry,
// a flat-alpha copy of the head's own faces, lifted a few millimetres, which
// gave a wash with no grain and an outline that landed wherever the head's
// coarse triangles fell. They are a texture decal now (stubble.ts), so they
// name no part: the selection below is all the picking they need, and with none
// of them chosen NOTHING is added to the head at all.

/** Hair styles drawn as a scalp decal. */
export type ScalpDecal = 'buzz' | 'crew';
/** Beard styles drawn as a jaw decal. */
export type BeardDecal = 'stubble' | 'scruff';

/**
 * The under-hair scalp patterns a hair volume can wear, the two clipper cuts
 * plus solid washes, shaped hairlines and fades. Twinned with SCALP_CUTS /
 * SCALP_SPECS in stubble.ts (the compiler holds those Records complete) and
 * with the allowlist in scripts/asset_pipeline/lib/fit_studio.mjs.
 */
export const UNDERHAIR_STYLES = [
  'buzz',
  'crew',
  'solid',
  'solid_high',
  'widow',
  'receded',
  'low_fade',
  'high_fade',
  'sparse',
  'horseshoe',
] as const;
export type UnderhairStyle = (typeof UNDERHAIR_STYLES)[number];

export const SCALP_DECALS: Partial<Record<HairStyle, ScalpDecal>> = {
  buzz: 'buzz',
  crew: 'crew',
};

/**
 * The scalp decal worn UNDER a hair volume.
 *
 * A hair volume is a shell around the skull with a hairline at its rim, and
 * between the rim and the strands you can see bare scalp, most obviously
 * through a spiky style, where the gaps between the spikes ARE the style.
 * Painting growth under the shell fills those in, so a gap reads as hair rather
 * than as a hole in the head.
 *
 * That growth is the BUZZ decal itself, not a lookalike (Troy, 2026-08-03): the
 * stubble under a haircut has to be the same stubble you get by picking the
 * buzz cut on its own. It was briefly its own `roots` variant with its own
 * density, which made it a second texture that merely resembled the first,
 * exactly the thing to avoid, and a duplicate 1024² map in the cache for no
 * visual difference. Returning `buzz` makes them the same by construction.
 *
 * Every style qualifies except `bald`, the one look that means "no growth", so
 * giving it stubble would take the only shaved head away, and except the two
 * that already ARE a scalp decal, which would otherwise be drawn twice.
 *
 * WHICH pattern a style wears is the designer's per-style call, authored with
 * the style's anchor in the Fit Studio and shipped via underhair.generated.ts
 * (written by lib/fit_studio.mjs on save, never hand-edit it). `'none'`
 * switches the under-layer off for that style; an unknown or missing entry
 * falls back to the classic buzz growth.
 */
export function baseScalpDecal(hair: HairStyle): UnderhairStyle | null {
  if (hair === 'bald') return null;
  const asDecal = SCALP_DECALS[hair];
  if (asDecal) return asDecal;
  const pick = UNDERHAIR[hair];
  if (pick === 'none') return null;
  return pick && (UNDERHAIR_STYLES as readonly string[]).includes(pick)
    ? (pick as UnderhairStyle)
    : 'buzz';
}
export const BEARD_DECALS: Partial<Record<BeardStyle, BeardDecal>> = {
  stubble: 'stubble',
  scruff: 'scruff',
};

export interface StubbleSelection {
  scalp: UnderhairStyle | null;
  beard: BeardDecal | null;
}

/**
 * Which decals a look wears.
 *
 * The scalp growth survives every kind of headgear: a decal is the head's own
 * surface a fraction of a millimetre out, and what shows of the head, the
 * face opening of a full helm, everything below a hat's rim, shows the
 * growth with it. Dropping it made a character's stubble come and go with
 * their headgear.
 *
 * The BEARD follows the helm kind (Troy, 2026-08-06):
 * - full helm: no beard at all. The shell closes over the jaw, so neither the
 *   volume nor the growth it would leave has anywhere to show.
 * - hat: the beard is untouched, the volume stays on (see modularPartNames),
 *   so the decal rule here is exactly the bare-headed one.
 */
export function stubbleDecals(app: ModularAppearance, worn: ArmorLoadout = {}): StubbleSelection {
  const kind = helmKind(worn);
  const beard = kind === 'full' ? null : (BEARD_DECALS[app.beard] ?? null);
  return { scalp: baseScalpDecal(app.hair), beard };
}

/** `''` when the look wears no decal, the whole selection in one cache key. */
export function stubbleDecalKey(app: ModularAppearance, worn: ArmorLoadout = {}): string {
  const sel = stubbleDecals(app, worn);
  if (!sel.scalp && !sel.beard) return '';
  return `${sel.scalp ?? '-'}/${sel.beard ?? '-'}`;
}

/** The face-paint a look wears. */
export interface MakeupSelection {
  lipstick: LipShade;
  blush: BlushShade;
  eyeshadow: ShadowShade;
}

/** Makeup survives a helm, for the same reason the growth decals do: every helm
 *  in the set is open at the face, so the lips, cheeks and lids it paints are
 *  all still on screen. (Troy, 2026-08-03, it used to be dropped.)
 *
 *  `_worn` is unread for exactly that reason, and stays in the signature so
 *  this matches every other selector here, and so a closed-face helm, if one
 *  is ever added, has somewhere to be handled. */
export function makeupSelection(app: ModularAppearance, _worn: ArmorLoadout = {}): MakeupSelection {
  return {
    lipstick: app.lipstick ?? 'none',
    blush: app.blush ?? 'none',
    eyeshadow: app.eyeshadow ?? 'none',
  };
}

/** Whether anything is painted on at all, the cheap gate before building a
 *  decal or cloning a material. */
export function wearsMakeup(sel: MakeupSelection): boolean {
  return sel.lipstick !== 'none' || sel.blush !== 'none' || sel.eyeshadow !== 'none';
}

/** Only blush and eyeshadow reach the DECAL; lipstick is a material tint on the
 *  mouth part, so a look wearing lipstick alone adds no mesh at all. */
export function wearsFaceDecal(sel: MakeupSelection): boolean {
  return sel.blush !== 'none' || sel.eyeshadow !== 'none';
}

/** `''` when the face is bare, the whole makeup selection in one cache key. */
export function makeupKey(app: ModularAppearance, worn: ArmorLoadout = {}): string {
  const sel = makeupSelection(app, worn);
  if (!wearsMakeup(sel)) return '';
  return `${sel.lipstick}/${sel.blush}/${sel.eyeshadow}`;
}

/** Material names in the GLB. The first two are recoloured per character; the
 *  armour materials keep their class atlas (and its SKINS swaps). */
export const MAT_SKIN = 'mod_skin';
/** The body parts' skin: same tint as MAT_SKIN, plus the low-key detail atlas
 *  (navel/nipples/creases, tmp/modular/bodydetail.py) multiplied under it. Its
 *  own material because a texture on shared mod_skin would sample undefined
 *  UVs on the face parts. */
export const MAT_SKIN_DETAIL = 'mod_skin_detail';
export const MAT_HAIR = 'mod_hair';
export const MAT_EYE = 'mod_eye';
/** The eyelash. Its own material, NOT the hair one: it has its own wheel. */
export const MAT_LASH = 'mod_lash';
/** The underclothing. Its own material, NOT the skin one: it must keep its
 *  colour when the player drags the skin-tone wheel. */
export const MAT_CLOTH = 'mod_cloth';
/** The stubble/buzz decal. Built at runtime rather than shipped in the GLB, but
 *  recoloured with the HAIR colour on the same path as everything else that is
 *  hair, it is alpha-blended, so it cannot share the hair material. */
export const MAT_STUBBLE = 'mod_stubble';
/** Blush and eyeshadow. Like the stubble decal it is built at runtime rather
 *  than shipped in the GLB, but unlike it, the COLOURS are baked into the map
 *  (two layers, two shades, one material), so this one is never tinted. */
export const MAT_MAKEUP = 'mod_makeup';
/** Teeth. Never recoloured, they are teeth. */
export const MAT_TOOTH = 'mod_tooth';
/** The mouth line and the inside of an open mouth.
 *
 *  NOT `mod_eye`, even though both are near-black: `recolored()` routes mod_eye
 *  through the player's EYE wheel, so sharing it painted the mouth line to match
 *  the irises, pick blue eyes and you got a blue mouth. Its colour also has to
 *  differ from mod_eye's for a second reason: the glTF exporter merges materials
 *  whose settings are identical, so an exact copy comes back out of the asset AS
 *  mod_eye and the bug returns silently. */
export const MAT_MOUTH = 'mod_mouth';

/** Armour materials, one per class atlas, plus the paladin's second (metallic)
 *  slot, whose per-face split is what gives that set its metal highlights. */
export const ARMOR_MATERIALS: ReadonlySet<string> = new Set<string>([
  ...ARMOR_SETS,
  'paladin_metallic',
]);

export function isArmorMaterial(name: string | undefined | null): boolean {
  return !!name && ARMOR_MATERIALS.has(name);
}

// --- jewellery materials ------------------------------------------------------
//
// The Fit Studio has always been able to give a piercing set a real PBR
// material instead of its ride on the knight atlas (jewel.py JEWEL_MATERIALS,
// picked per set and baked at build time). Troy, 2026-08-07: put that picker
// in the game, so the PLAYER chooses the metal or stone their earrings are
// made of.
//
// Runtime rather than build time, because it is now a per-character choice:
// `assembleModular` swaps the material on the `E2_*` meshes only. `default`
// keeps the authored atlas ride, which is the one look that varies WITHIN a
// set (the runic set is iron with a gold stud), every named material is one
// substance across the whole set, exactly as the studio bakes it.
//
// Colours are the sRGB form of jewel.py's LINEAR baseColorFactor values
// (converted through the sRGB transfer function, not eyeballed), so a set the
// designer bakes and one the player picks land on the same colour.
export type EarringMaterial =
  | 'default'
  | 'gold'
  | 'silver'
  | 'bone'
  | 'iron'
  | 'copper'
  | 'bronze'
  | 'obsidian'
  | 'jade'
  | 'amethyst'
  | 'ruby'
  | 'pearl'
  | 'turquoise';

export interface JewelMaterialSpec {
  color: number;
  metalness: number;
  roughness: number;
}

/** Twinned with JEWEL_MATERIALS in tmp/modular/jewel.py and the preset table
 *  in scripts/asset_pipeline/fit_studio/anchors.js, keep the three in sync. */
export const EARRING_MATERIALS: Record<Exclude<EarringMaterial, 'default'>, JewelMaterialSpec> = {
  gold: { color: 0xebcb76, metalness: 1.0, roughness: 0.34 },
  silver: { color: 0xdadee3, metalness: 1.0, roughness: 0.28 },
  bone: { color: 0xe1d7c4, metalness: 0.0, roughness: 0.62 },
  iron: { color: 0x65696f, metalness: 1.0, roughness: 0.52 },
  copper: { color: 0xd79773, metalness: 1.0, roughness: 0.38 },
  bronze: { color: 0xbc9b69, metalness: 1.0, roughness: 0.42 },
  obsidian: { color: 0x2c2c38, metalness: 0.0, roughness: 0.1 },
  jade: { color: 0x69a681, metalness: 0.0, roughness: 0.32 },
  amethyst: { color: 0x9e65bf, metalness: 0.0, roughness: 0.16 },
  ruby: { color: 0xb33855, metalness: 0.0, roughness: 0.16 },
  pearl: { color: 0xf0ebe3, metalness: 0.15, roughness: 0.22 },
  turquoise: { color: 0x59bcbc, metalness: 0.0, roughness: 0.36 },
};

export const EARRING_MATERIAL_IDS: readonly EarringMaterial[] = [
  'default',
  ...(Object.keys(EARRING_MATERIALS) as Exclude<EarringMaterial, 'default'>[]),
];

/** What to paint an `E2_*` mesh with, or null to leave the atlas alone
 *  (`default`, an unknown id from an old save, or no earrings worn). */
export function earringMaterialSpec(app: ModularAppearance): JewelMaterialSpec | null {
  if (app.earrings === 'none') return null;
  return pickedJewelMaterial(app);
}

/** The material a HAIR BAND wears.
 *
 *  The same picker as the piercings, a band rides the jewel material path
 *  because its node is `E2_band_*`, but it must NOT be gated on the earring
 *  slot the way earringMaterialSpec is. A band is worn with the HAIR, so a
 *  player wearing no piercings at all still has a tie in their chosen metal,
 *  and moving the picker has to repaint it (Troy, 2026-08-07: "the jewellery
 *  material doesn't seem to be changing the hair bands"). */
export function bandMaterialSpec(app: ModularAppearance): JewelMaterialSpec | null {
  return pickedJewelMaterial(app);
}

function pickedJewelMaterial(app: ModularAppearance): JewelMaterialSpec | null {
  const id = app.earringMaterial;
  if (!id || id === 'default') return null;
  return EARRING_MATERIALS[id as Exclude<EarringMaterial, 'default'>] ?? null;
}

/** Swatch chip colour: the material's own colour, or null for `default`,
 *  which the swatch row draws as the "as authored" chip. */
export function earringSwatchHex(id: EarringMaterial): number | null {
  return id === 'default'
    ? null
    : (EARRING_MATERIALS[id as Exclude<EarringMaterial, 'default'>]?.color ?? null);
}

// --- outfit colorways --------------------------------------------------------
//
// Each class atlas keeps its leather, wood and metal in the 0 to 30° hue band and
// puts the set's SIGNATURE cloth in one distinct accent band (measured from
// the shipped atlases): the knight's crimson, the paladin's and ranger's teal,
// the rogue's green, the mage's violet-through-pink, the druid's leaf range.
// A colorway re-dyes that band ONLY, rotate its hue to a target, scale its
// saturation and lightness, so straps stay leather and plate stays steel
// while the outfit itself changes colour. The shader does the work at draw
// time (assets.ts armorDyed): the atlases ship ktx2-compressed, so there are
// no pixels to edit on the CPU, and one uniform-driven program serves every
// set and every colorway.

/** Where a set's dyeable cloth lives in its atlas: band centre + half-width,
 *  in degrees of hue. `paladin_metallic` shares the paladin's band, it is the
 *  same atlas through a second (metallic) material. */
export const ARMOR_DYE_BANDS: Record<ArmorSetId, { ref: number; band: number }> = {
  knight: { ref: 350, band: 28 },
  barbarian: { ref: 195, band: 28 },
  druid: { ref: 105, band: 55 },
  mage: { ref: 285, band: 62 },
  paladin: { ref: 200, band: 32 },
  ranger: { ref: 195, band: 30 },
  rogue: { ref: 155, band: 32 },
};

export type OutfitColorway =
  | 'classic'
  | 'crimson'
  | 'ember'
  | 'gold'
  | 'forest'
  | 'emerald'
  | 'teal'
  | 'azure'
  | 'royal'
  | 'violet'
  | 'magenta'
  | 'rose'
  | 'onyx'
  | 'ivory'
  | 'gilded'
  | 'bonewrought'
  | 'obsidian'
  | 'verdigris'
  | 'bloodforged';

export interface OutfitColorwayDef {
  id: OutfitColorway;
  /** target hue the set's cloth band rotates to; null keeps the native hue
   *  (the sat/light scales still apply, which is what makes onyx and ivory). */
  hue: number | null;
  sat: number;
  light: number;
}

/** The single-band hue colorways, `classic` (the untouched atlas) first. One
 *  list serves every set: the dye targets an absolute hue, so "crimson" is
 *  crimson on a knight and on a druid alike, each through its own band. */
export const OUTFIT_COLORWAYS: readonly OutfitColorwayDef[] = [
  { id: 'classic', hue: null, sat: 1, light: 1 },
  { id: 'crimson', hue: 350, sat: 1.15, light: 0.95 },
  { id: 'ember', hue: 22, sat: 1.2, light: 1.0 },
  { id: 'gold', hue: 46, sat: 1.15, light: 1.1 },
  { id: 'forest', hue: 130, sat: 0.95, light: 0.9 },
  { id: 'emerald', hue: 160, sat: 1.2, light: 0.95 },
  { id: 'teal', hue: 185, sat: 1.05, light: 1.0 },
  { id: 'azure', hue: 215, sat: 1.15, light: 1.0 },
  { id: 'royal', hue: 250, sat: 1.1, light: 0.95 },
  { id: 'violet', hue: 278, sat: 1.1, light: 1.0 },
  { id: 'magenta', hue: 320, sat: 1.15, light: 1.0 },
  { id: 'rose', hue: 340, sat: 0.8, light: 1.25 },
  { id: 'onyx', hue: null, sat: 0.22, light: 0.55 },
  { id: 'ivory', hue: null, sat: 0.18, light: 1.45 },
];

// --- material colorways ------------------------------------------------------
//
// The KayKit class atlases share one construction (measured per part from the
// shipped ktx2 atlases, tmp scratch histogram): a bright warm TRIM swatch
// (h~26 s~0.32 v~0.96), brown LEATHER (h~17 s~0.55 v~0.66), near-gray STEEL
// at several values (s <= ~0.10), and each set's saturated accent CLOTH in
// its ARMOR_DYE_BANDS band. A material colorway re-dresses each of those
// zones with its own rule, bright plate to gold, steel to bronze, leather to
// mahogany, so every part of a set reads as a different material instead of
// one flat repaint. Rules select in HSV (hue band + sat/val trapezoids, all
// measured off the atlas, never guessed) and remap hue/sat/val; the shader
// (assets.ts attachArmorDye) evaluates every rule from the ORIGINAL texel so
// overlapping edges blend instead of compounding.

/** One dye rule: an HSV zone selector plus the remap applied inside it.
 *  Selector edges are smoothstep pairs; omit a bound to leave it open.
 *  JSON-safe on purpose, specs ride Material.userData across clones. */
export interface DyeRule {
  /** hue selector: band centre + width, weight 1 inside 0.7*band falling to 0
   *  at band (the legacy dye's curve). A band >= 400 selects every hue. */
  ref: number;
  band: number;
  /** saturation window [lo0,lo1,hi0,hi1]: smoothstep in over lo0..lo1, out
   *  over hi0..hi1. */
  sat: readonly [number, number, number, number];
  /** value (brightness) window, same shape. */
  val: readonly [number, number, number, number];
  /** hue remap: 'keep' leaves the texel's hue; 'abs' pins hue to `hue` (what
   *  gray steel needs, its native hue is noise); 'rel' rotates the band so
   *  in-band variation survives (the legacy dye's behaviour). */
  hueMode: 'keep' | 'abs' | 'rel';
  hue: number;
  /** sat' = clamp(sat * satMul + satAdd), the ADD is what lets near-gray
   *  steel take real gold saturation (a multiplier of gray stays gray). */
  satMul: number;
  satAdd: number;
  /** val' = clamp(val * valMul + valAdd), the ADD compresses toward a target
   *  (bone from dark iron AND bright steel) instead of scaling past white. */
  valMul: number;
  valAdd: number;
}

const OPEN_LO = [-2, -1] as const;
const OPEN_HI = [2, 3] as const;
const ANY_HUE = 999;

/** Zone selectors, shared across sets except where a set's atlas disagrees
 *  (measured: the barbarian's fur sits at s~0.13 just above steel, the
 *  knight's crimson brushes the leather hues, the druid's cloth is TWO greens
 *  55° apart). A selector is the sel-half of a DyeRule. */
interface DyeZoneSel {
  ref: number;
  band: number;
  sat: readonly [number, number, number, number];
  val: readonly [number, number, number, number];
}
interface SetDyeZones {
  steel: DyeZoneSel;
  /** the dark recesses of the steel zone (joints, chainmail shadow), listed
   *  AFTER steel so its treatment wins where the two overlap. */
  steelShadow: DyeZoneSel;
  bright: DyeZoneSel;
  leather: DyeZoneSel;
  cloth: DyeZoneSel;
}

function zonesFor(set: ArmorSetId): SetDyeZones {
  const accent = ARMOR_DYE_BANDS[set];
  // Selector edges are WIDE feathers on purpose (2026-08-07, Troy: "blocky
  // textures"): the atlases ship basis-compressed, whose 4x4 blocks jitter
  // sat/val by up to ~0.04, and the KayKit swatches are vertical gradients,
  // a narrow smoothstep edge turns both into hard patchwork at the boundary.
  // Every edge below sits in a measured gap between texel clusters (UV-
  // sampled histograms of the shipped atlases) with enough feather that a
  // gradient crosses it gradually.
  //
  // barbarian: the fur pelt lives at s 0.11-0.20 right above the true steel
  // (studs/buckles, s <= 0.05). The old gate [0.09,0.13] sliced the fur's own
  // gradient in half, half-dyed fur was the visible blockiness. The gate now
  // closes UNDER the fur so the whole pelt stays fur.
  // ([0.06,0.12] and not lower: the set's blued-steel trim measures s~0.09
  // cool-hued and still wants ~half the treatment; the fur's brightest tips
  // at s 0.11 catch at most ~16% through a wide feather, which reads as
  // sheen, not patchwork.)
  const steelSatHi: readonly [number, number] = set === 'barbarian' ? [0.06, 0.12] : [0.12, 0.28];
  const cloth: DyeZoneSel = {
    // the knight's crimson brushes the leather hues from the other side, so
    // its band narrows; the druid's moss (h~60) and leaf (h~163) greens need
    // the full wide band
    ref: set === 'knight' ? 350 : set === 'druid' ? 110 : accent.ref,
    band: set === 'knight' ? 22 : set === 'druid' ? 68 : accent.band,
    sat: [0.24, 0.34, ...OPEN_HI],
    val: [...OPEN_LO, ...OPEN_HI],
  };
  return {
    steel: {
      ref: 0,
      band: ANY_HUE,
      sat: [...OPEN_LO, ...steelSatHi],
      val: [...OPEN_LO, ...OPEN_HI],
    },
    steelShadow: {
      ref: 0,
      band: ANY_HUE,
      sat: [...OPEN_LO, ...steelSatHi],
      val: [...OPEN_LO, 0.45, 0.6],
    },
    // the DOMINANT surface on every set (measured 20-60% of vertices): the
    // warm pale swatch KayKit paints plate brights, robes and pads with,
    // this zone is where a colorway's signature material has to land or the
    // armour visibly doesn't change. The sat window reaches 0.72-0.80 so the
    // paladin's SATURATED gold trim (h 31-43, s 0.6-0.7, v 0.9+), measured
    // in no zone at all before, so it sat undyed next to dyed plate, lands
    // here; the val floor reaches down the swatch gradient instead of
    // cutting across it.
    bright: { ref: 26, band: 34, sat: [0.2, 0.26, 0.72, 0.8], val: [0.72, 0.84, ...OPEN_HI] },
    // sat-lo feather widened below the mid-brown gradient (ranger straps
    // measured s 0.41-0.62 across one strap) so a strap dyes as one piece.
    leather: { ref: 17, band: 26, sat: [0.3, 0.4, 0.68, 0.76], val: [...OPEN_LO, 0.8, 0.88] },
    cloth,
  };
}

/** The remap half of a DyeRule. */
interface DyeOut {
  hueMode: 'keep' | 'abs' | 'rel';
  hue?: number;
  satMul?: number;
  satAdd?: number;
  valMul?: number;
  valAdd?: number;
}

/** A material colorway names one treatment per zone; omitting a zone leaves
 *  that material as authored. */
type MaterialColorwayId = 'gilded' | 'bonewrought' | 'obsidian' | 'verdigris' | 'bloodforged';
const MATERIAL_COLORWAY_DEFS: Record<
  MaterialColorwayId,
  Partial<Record<keyof SetDyeZones, DyeOut>>
> = {
  // gold plate (the steel zone IS the plate on the metal sets), richer gold
  // trim and robes, mahogany straps, the set's cloth deepened rich
  gilded: {
    steel: { hueMode: 'abs', hue: 44, satMul: 0.5, satAdd: 0.36, valMul: 0.92, valAdd: 0.05 },
    bright: { hueMode: 'abs', hue: 46, satMul: 1.1, satAdd: 0.12, valMul: 0.9 },
    leather: { hueMode: 'abs', hue: 8, satMul: 1.05, valMul: 0.72 },
    cloth: { hueMode: 'keep', satMul: 1.2, satAdd: 0.05, valMul: 0.82 },
  },
  // pale carved-bone plate, aged parchment-hide trim, charcoal straps
  bonewrought: {
    steel: { hueMode: 'abs', hue: 40, satMul: 0.3, satAdd: 0.1, valMul: 0.45, valAdd: 0.5 },
    bright: { hueMode: 'abs', hue: 35, satMul: 0.8, valMul: 0.78 },
    leather: { hueMode: 'keep', satMul: 0.35, valMul: 0.42 },
    cloth: { hueMode: 'keep', satMul: 0.5, valMul: 0.55 },
  },
  // black glass armour with a violet cast, ember cloth burning through it
  obsidian: {
    steel: { hueMode: 'abs', hue: 272, satMul: 0.2, satAdd: 0.04, valMul: 0.3, valAdd: 0.02 },
    bright: { hueMode: 'abs', hue: 272, satMul: 0.3, satAdd: 0.04, valMul: 0.3, valAdd: 0.03 },
    leather: { hueMode: 'keep', satMul: 0.5, valMul: 0.4 },
    cloth: { hueMode: 'abs', hue: 18, satMul: 0.9, satAdd: 0.2, valMul: 0.55, valAdd: 0.08 },
  },
  // polished copper plate, green patina blooming in the recesses, parchment cloth
  verdigris: {
    steel: { hueMode: 'abs', hue: 18, satMul: 0.8, satAdd: 0.34, valMul: 0.78 },
    steelShadow: {
      hueMode: 'abs',
      hue: 162,
      satMul: 0.5,
      satAdd: 0.25,
      valMul: 1.05,
      valAdd: 0.05,
    },
    bright: { hueMode: 'abs', hue: 158, satMul: 0.5, satAdd: 0.06, valMul: 0.88 },
    leather: { hueMode: 'abs', hue: 14, satMul: 0.9, valMul: 0.7 },
    cloth: { hueMode: 'abs', hue: 45, satMul: 0.25, satAdd: 0.05, valMul: 1.05, valAdd: 0.15 },
  },
  // blood-quenched iron plate, oxblood bronze trim and straps, crimson cloth
  bloodforged: {
    steel: { hueMode: 'abs', hue: 356, satMul: 0.4, satAdd: 0.14, valMul: 0.45, valAdd: 0.02 },
    bright: { hueMode: 'abs', hue: 3, satMul: 0.85, satAdd: 0.18, valMul: 0.5 },
    leather: { hueMode: 'abs', hue: 358, satMul: 1.15, valMul: 0.72 },
    cloth: { hueMode: 'abs', hue: 352, satMul: 1.1, satAdd: 0.12, valMul: 0.8 },
  },
};
export const MATERIAL_COLORWAY_IDS = Object.keys(
  MATERIAL_COLORWAY_DEFS,
) as readonly MaterialColorwayId[];

export const OUTFIT_COLORWAY_IDS: readonly OutfitColorway[] = [
  ...OUTFIT_COLORWAYS.map((c) => c.id),
  ...MATERIAL_COLORWAY_IDS,
];

function materialColorwayRules(set: ArmorSetId, id: MaterialColorwayId): DyeRule[] {
  const zones = zonesFor(set);
  const def = MATERIAL_COLORWAY_DEFS[id];
  const rules: DyeRule[] = [];
  for (const zone of ['steel', 'steelShadow', 'bright', 'leather', 'cloth'] as const) {
    const out = def[zone];
    if (!out) continue;
    const sel = zones[zone];
    rules.push({
      ref: sel.ref,
      band: sel.band,
      sat: sel.sat,
      val: sel.val,
      hueMode: out.hueMode,
      hue: out.hue ?? 0,
      satMul: out.satMul ?? 1,
      satAdd: out.satAdd ?? 0,
      valMul: out.valMul ?? 1,
      valAdd: out.valAdd ?? 0,
    });
  }
  return rules;
}

/** The armour set a material belongs to, or null for non-armour materials. */
export function armorMaterialSet(name: string | undefined | null): ArmorSetId | null {
  if (!name || !ARMOR_MATERIALS.has(name)) return null;
  return (name === 'paladin_metallic' ? 'paladin' : name) as ArmorSetId;
}

/** Everything the dye shader needs for one material under one colorway, or
 *  null when there is nothing to do (`classic`, an unknown id from an old
 *  save, or a non-armour material). A legacy hue colorway compiles to a
 *  single rule identical to the old shader's behaviour. */
export function outfitDye(
  materialName: string | undefined | null,
  outfit: OutfitColorway | undefined,
): { rules: DyeRule[] } | null {
  const set = armorMaterialSet(materialName);
  if (!set || !outfit || outfit === 'classic') return null;
  if ((MATERIAL_COLORWAY_IDS as readonly string[]).includes(outfit)) {
    return { rules: materialColorwayRules(set, outfit as MaterialColorwayId) };
  }
  const def = OUTFIT_COLORWAYS.find((c) => c.id === outfit);
  if (!def) return null;
  const { ref, band } = ARMOR_DYE_BANDS[set];
  return {
    rules: [
      {
        ref,
        band,
        // Cloth-only gate. This was the legacy metal gate smoothstep(0.10,
        // 0.22, sat), which let the ranger/paladin/barbarian SHIRT's cool
        // near-gray shading texels (h~180-210, s 0.09-0.15, inside the teal
        // accent band) catch partial dye and read as blocky patches on the
        // cream cloth (Troy, 2026-08-07). Every set's true accent cloth
        // measures s >= 0.41, so the floor sits well above the grays with a
        // wide feather; matches the material-colorway cloth zone's sat edge.
        sat: [0.24, 0.36, ...OPEN_HI],
        val: [...OPEN_LO, ...OPEN_HI],
        hueMode: def.hue === null ? 'keep' : 'rel',
        hue: def.hue ?? 0,
        satMul: def.sat,
        satAdd: 0,
        valMul: def.light,
        valAdd: 0,
      },
    ],
  };
}

// --- swatch chips ------------------------------------------------------------

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** TS mirror of the shader: one texel (h,s,v) through a rule list. Used only
 *  to render honest swatch chips, the chip shows the actual treatment the
 *  zone's measured anchor colour would get. */
function applyDyeRules(
  rules: readonly DyeRule[],
  h: number,
  s: number,
  v: number,
): [number, number, number] {
  let [ro, so, vo] = [h, s, v];
  for (const r of rules) {
    const dHue = ((h - r.ref + 540) % 360) - 180;
    let w = 1 - smoothstep(r.band * 0.7, r.band, Math.abs(dHue));
    w *= smoothstep(r.sat[0], r.sat[1], s) * (1 - smoothstep(r.sat[2], r.sat[3], s));
    w *= smoothstep(r.val[0], r.val[1], v) * (1 - smoothstep(r.val[2], r.val[3], v));
    if (w <= 0.001) continue;
    const nh =
      r.hueMode === 'keep' ? h : r.hueMode === 'abs' ? r.hue : (((r.hue + dHue) % 360) + 360) % 360;
    const ns = Math.max(0, Math.min(1, s * r.satMul + r.satAdd));
    const nv = Math.max(0, Math.min(1, v * r.valMul + r.valAdd));
    ro = ro + (nh - ro) * w;
    so = so + (ns - so) * w;
    vo = vo + (nv - vo) * w;
  }
  return [ro, so, vo];
}

function hsvToHex(h: number, s: number, v: number): number {
  // chip-only conversion; the customizer speaks HSL elsewhere
  const l = v * (1 - s / 2);
  const sl = l <= 0 || l >= 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return hslToHex(h, sl, l);
}

/** The chip colour the customizer draws for a colorway on a given set: the
 *  set's own band centre under `classic`, the dye target otherwise. */
export function outfitSwatchHex(set: ArmorSetId, id: OutfitColorway): number {
  if ((MATERIAL_COLORWAY_IDS as readonly string[]).includes(id)) {
    return outfitSwatchHexes(set, id)[0];
  }
  const def = OUTFIT_COLORWAYS.find((c) => c.id === id) ?? OUTFIT_COLORWAYS[0];
  const hue = def.hue ?? ARMOR_DYE_BANDS[set].ref;
  const sat = Math.max(0, Math.min(1, 0.62 * def.sat));
  const light = Math.max(0.06, Math.min(0.94, 0.48 * def.light));
  return hslToHex(hue, sat, light);
}

/** Gradient stops for a colorway chip. A hue colorway is one flat stop; a
 *  material colorway shows what its rules do to the set's measured steel,
 *  bright-plate and cloth anchors, so the chip is an honest three-material preview. */
export function outfitSwatchHexes(set: ArmorSetId, id: OutfitColorway): number[] {
  if (!(MATERIAL_COLORWAY_IDS as readonly string[]).includes(id)) {
    return [outfitSwatchHex(set, id)];
  }
  const rules = materialColorwayRules(set, id as MaterialColorwayId);
  const accent = zonesFor(set).cloth;
  const anchors: [number, number, number][] = [
    [30, 0.05, 0.8], // steel plate
    [26, 0.32, 0.96], // bright trim
    [accent.ref, 0.75, 0.62], // cloth
  ];
  return anchors.map(([h, s, v]) => hsvToHex(...applyDyeRules(rules, h, s, v)));
}

/** Every node name the modular GLB is expected to contain (asset contract). */
export function allModularNodes(): string[] {
  const out = new Set<string>();
  for (const g of ['male', 'female'] as Gender[]) {
    for (const s of ARMOR_SLOTS) for (const n of BODY_BY_SLOT[g][s]) out.add(n);
    for (const u of UNDERWEAR[g]) out.add(u.node);
  }
  for (const set of Object.values(ARMOR_BY_SET)) {
    for (const s of ARMOR_SLOTS) for (const n of set[s]) out.add(n);
  }
  for (const n of Object.values(HAIR_NODES).flat()) out.add(n);
  for (const g of ['male', 'female'] as Gender[]) {
    for (const st of HAIR_STYLES) for (const n of hairNodes(g, st)) out.add(n);
  }
  for (const n of Object.values(BEARD_NODES).flat()) out.add(n);
  for (const g of ['male', 'female'] as Gender[]) {
    for (const b of BEARD_STYLES) for (const n of beardNodes(g, b)) out.add(n);
  }
  for (const g of ['male', 'female'] as Gender[]) {
    for (const e of EYE_STYLES) {
      for (const n of eyeNodes(g, e)) out.add(n);
      for (const n of lashNodes(g, e, true)) out.add(n);
    }
    for (const e of EAR_STYLES) for (const n of earNodes(g, e)) out.add(n);
    for (const b of BROW_STYLES) for (const n of browNodes(g, b)) out.add(n);
    for (const m of MOUTH_STYLES) for (const n of mouthNodes(g, m)) out.add(n);
  }
  for (const n of Object.values(EARRING_NODES).flat()) out.add(n);
  return [...out].sort();
}

/**
 * The node names a given appearance + armour loadout resolves to.
 *
 * A worn slot swaps its base parts out for the armour piece, so nothing is ever
 * drawn twice and the bare body never z-fights through plate. `back` is the one
 * additive slot. Hair and brows are dropped under a helm, KayKit's helmet is a
 * closed shell and loose hair pokes straight through it.
 */
export function modularPartNames(app: ModularAppearance, worn: ArmorLoadout = {}): string[] {
  const body = BODY_BY_SLOT[app.gender] ?? BODY_BY_SLOT.male;
  const out: string[] = [];
  // Eyes are body and no headgear in the set covers them, so they are always
  // drawn. The EARS survive a hat (it sits above them) but not a full helm,
  // the shell sits where the ear is and the ear pokes straight out through it,
  // so a closed-helm character loses the ears (and with them the earrings,
  // which hang off the lobe). helmKind() tests for an actual head PIECE, not
  // for the slot being set: druid / ranger / rogue have no headgear, so
  // wearing one of those "head slots" must change nothing.
  const helm = helmKind(worn);
  out.push(...eyeNodes(app.gender, app.eyeShape));
  out.push(...lashNodes(app.gender, app.eyeShape, app.lashes !== false));
  // The mouth is drawn for the same reason the eyes are: every piece of
  // headgear in the set is open at the face, and the mouth is inside that
  // opening.
  out.push(...mouthNodes(app.gender, app.mouth ?? 'neutral'));
  if (helm !== 'full') out.push(...earNodes(app.gender, app.ears));
  for (const slot of ARMOR_SLOTS) {
    // The body is ALWAYS drawn and armour layers over it. Hiding the covered
    // part is the cheaper option, but KayKit plate is open at the neck, wrists
    // and between chest and legs, so hiding it leaves holes you can see through
    // instead of skin. The base body is sized to sit inside the plate.
    out.push(...body[slot]);
    const setId = worn[slot] ?? null;
    const set = setId ? ARMOR_BY_SET[setId] : null;
    if (set) out.push(...set[slot]);
  }
  for (const { node, slot } of UNDERWEAR[app.gender] ?? UNDERWEAR.male) {
    if (slot === null || !slotCovered(worn, slot)) out.push(node);
  }
  // The BROWS stay on under any headgear: every piece in the set is open at
  // the face, the brow ridge is inside that opening, and a browless face reads
  // as a mannequin behind the visor.
  out.push(...browNodes(app.gender, app.brows));
  // Hair follows the helm kind: its own volume bare-headed, nothing under a
  // closed helm (the shell swallows it), and under a hat the length rule,
  // short cuts and updos tuck away to nothing, long falls render as `layered`
  // hanging below the brim (see effectiveHairStyle).
  const hair = effectiveHairStyle(app.hair, helm);
  if (hair) out.push(...hairNodes(app.gender, hair));
  // The beard and the earrings ride the same distinction: a hat leaves the jaw
  // and the ears alone, a full helm closes over both.
  if (helm !== 'full') {
    out.push(...beardNodes(app.gender, app.beard));
    out.push(...EARRING_NODES[app.earrings]);
  }
  return out;
}

/** Stable cache key for a composed variant: geometry depends only on the part
 *  set, never on the colours (those are material-level). */
export function modularGeometryKey(app: ModularAppearance, worn: ArmorLoadout = {}): string {
  return modularPartNames(app, worn).join(',');
}

/** Every morph target a face or body SLIDER can drive, both halves of each
 *  pair. The in-place writer needs the whole list, not just the non-zero half:
 *  returning a slider to neutral has to clear the influence it set. */
export const MORPH_SLIDER_TARGETS: readonly string[] = [
  ...FACE_SLIDERS.flatMap((k) => [`${k}_up`, `${k}_dn`]),
  ...BODY_SLIDERS.flatMap((k) => [`body_${k}_up`, `body_${k}_dn`]),
];

/** The part of the look a REBUILD depends on: geometry, decals, materials.
 *
 *  Everything the slider morphs do not cover, which is why they are excluded:
 *  three copies morphTargetInfluences per instance, so a slider moves on the
 *  live body (CharacterVisual.applyModularSliders) instead of disposing it and
 *  cloning a new one per 5% step of a drag.
 *
 *  The decal styles belong HERE and not in the geometry key: they add no part,
 *  so buzz and bald compose the same cached variant, but they are absolutely a
 *  visible change and the preview has to rebuild for them. */
export function modularBuildSignature(app: ModularAppearance, worn: ArmorLoadout = {}): string {
  return [
    modularGeometryKey(app, worn),
    stubbleDecalKey(app, worn),
    app.skinHue.toFixed(1),
    app.skinSat.toFixed(3),
    app.skinLight.toFixed(3),
    app.hairHue.toFixed(1),
    app.hairSat.toFixed(3),
    app.hairLight.toFixed(3),
    // the mouth is a PART, so modularGeometryKey above already carries it
    // the jewellery material only repaints the E2 meshes, so like the outfit
    // colorway it is a signature field and never a geometry one
    app.earringMaterial ?? 'default',
    (app.eyeHue ?? 0).toFixed(1),
    (app.eyeSat ?? 0).toFixed(3),
    (app.eyeLight ?? 0).toFixed(3),
    (app.lashHue ?? 0).toFixed(1),
    (app.lashSat ?? 0).toFixed(3),
    (app.lashLight ?? 0).toFixed(3),
    // Makeup belongs here and NOT in modularGeometryKey for the same reason the
    // decals do: lipstick only recolours a part the look already has, and the
    // blush/eyeshadow decal is cut from the head at compose time. Neither adds
    // a node, so the geometry is shared with a bare face, but a shade change
    // still has to rebuild the variant, or the creation turntable looks dead.
    makeupKey(app, worn),
    // The outfit colorway is a material dye on the armour pieces: no node
    // changes, but the look absolutely does.
    app.outfit ?? 'classic',
  ].join('|');
}

/** Identity of the WHOLE look, sliders included: "is this the same character?".
 *
 *  What a cached artefact of the finished body (a portrait snapshot) keys on,
 *  as opposed to modularBuildSignature, which answers the narrower "does the
 *  body have to be rebuilt?". Composed from it so the two cannot drift. */
export function modularSignature(app: ModularAppearance, worn: ArmorLoadout = {}): string {
  return [
    modularBuildSignature(app, worn),
    // geometry is shared across face shapes (morphs are per-instance), so the
    // face belongs in the SIGNATURE but never in modularGeometryKey
    FACE_SLIDERS.map((k) => (app.face?.[k] ?? 0).toFixed(2)).join(','),
    // the body sliders are morphs too, same rule
    BODY_SLIDERS.map((k) => (app.body?.[k] ?? 0).toFixed(2)).join(','),
  ].join('|');
}

/**
 * Morph-target influences for a look, by target NAME.
 *
 * A slider maps to a PAIR, `nose_up` at +v, `nose_dn` at -v, because a morph
 * influence cannot go negative. Only the non-zero half is emitted, so a neutral
 * face costs nothing.
 *
 * The mouth is NOT here: it is a part swap now (see `MouthStyle`), so it is
 * carried by `modularPartNames` and reaches the geometry cache key for free.
 */
export function morphInfluences(app: ModularAppearance): Map<string, number> {
  const out = new Map<string, number>();
  const face = app.face ?? NEUTRAL_FACE;
  for (const key of FACE_SLIDERS) {
    const v = Math.max(-1, Math.min(1, face[key] ?? 0));
    if (v > 0) out.set(`${key}_up`, v);
    else if (v < 0) out.set(`${key}_dn`, -v);
  }
  // Body regions ride the same pair convention, prefixed so a body key can
  // never collide with a face slider of the same name.
  const body = app.body ?? NEUTRAL_BODY;
  for (const key of BODY_SLIDERS) {
    const v = Math.max(-1, Math.min(1, body[key] ?? 0));
    if (v > 0) out.set(`body_${key}_up`, v);
    else if (v < 0) out.set(`body_${key}_dn`, -v);
  }
  // The ear STYLE is a part swap, but an earring cannot be swapped with it
  // without shipping one earring per ear per style. It carries a morph per
  // style instead, moving it onto that ear's lobe, the lobe travels 32mm up
  // for `small` and 15mm down and 20mm out for `wide`, so a fixed earring hangs
  // in mid air. `round` is the base shape and so has no morph, like the neutral
  // mouth. Only the earring meshes carry these; applyMorphs ignores the rest.
  if (app.ears && app.ears !== 'round') out.set(`ear_${app.ears}`, 1);
  // The FACE piercings (septum ring, nostril stud, brow bar) are built once
  // against the male head like the earrings are, but unlike the ears, the two
  // heads' noses genuinely differ (the female septum sits ~17mm higher), so a
  // male-seated ring hangs in open air under her nose. `jewel_f` reseats just
  // those pieces; only the sets that have one carry the target.
  if (app.gender === 'female') out.set('jewel_f', 1);
  return out;
}

// --- colour ----------------------------------------------------------------

function hue2rgb(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

/** HSL (h in degrees, s/l in 0..1) to a packed 0xRRGGBB int. */
export function hslToHex(h: number, s: number, l: number): number {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  let r: number;
  let g: number;
  let b: number;
  if (ss === 0) {
    r = g = b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hue2rgb(p, q, hh + 1 / 3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1 / 3);
  }
  const to = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

export function skinColor(app: ModularAppearance): number {
  return hslToHex(app.skinHue, app.skinSat, app.skinLight);
}

export function hairColor(app: ModularAppearance): number {
  return hslToHex(app.hairHue, app.hairSat, app.hairLight);
}

export function eyeColor(app: ModularAppearance): number {
  return hslToHex(app.eyeHue ?? 28, app.eyeSat ?? 0.42, app.eyeLight ?? 0.18);
}

// --- randomiser style pools --------------------------------------------------
//
// These gate the DICE ONLY. The customizer's own pickers still offer every
// style to every body, a female character can still be given a full beard or
// a flat-top by hand, and that is deliberate. What the randomiser owes the
// player is a plausible character on the first roll, and rolling a beard onto
// a female body (Troy, 2026-08-07) reads as a bug rather than as a choice.
//
// Anything not named in either set is UNISEX and rolls for both, which is
// where most of the library sits, the two lists are the leaning tails, not a
// partition.
const MASCULINE_ROLL_HAIR = new Set<HairStyle>([
  'bald',
  'buzz',
  'crew',
  'crewcut',
  'quiff',
  'sidepart',
  'pompadour',
  'sweptback',
  'mullet',
]);
const FEMININE_ROLL_HAIR = new Set<HairStyle>([
  'pixie',
  'sweptpixie',
  'chinbob',
  'bluntbangs',
  'wavybob',
  'asymbob',
  'sidepony',
  'twinbraids',
  'braidcrown',
  'highbun',
]);

/** The styles the randomiser draws from for a body: everything except the
 *  other gender's leaning tail. Exported so the pools are testable and so a
 *  caller that wants "a random look for this gender" gets the same answer. */
export function randomHairStyles(gender: Gender): readonly HairStyle[] {
  const skip = gender === 'female' ? MASCULINE_ROLL_HAIR : FEMININE_ROLL_HAIR;
  return HAIR_STYLES.filter((h) => !skip.has(h));
}

/**
 * A random character, keeping the gender the player already chose.
 *
 * Pure, and takes its randomness as an argument, so a test can pin it. Colours
 * are drawn from RANGES rather than uniformly over the wheel: hair and eyes get
 * the whole hue circle (this is a game with purple-haired warriors in it), but
 * skin stays inside a believable arc, a uniform hue there just produces green
 * people, which reads as a bug rather than as a choice.
 */
export function randomizeAppearance(
  base: ModularAppearance,
  rand: () => number = Math.random,
): ModularAppearance {
  const of = <T>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
  const span = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const hairHue = span(0, 360);
  const hairSat = span(0.05, 0.85);
  const hairLight = span(0.05, 0.8);
  // Facial hair is rolled for the MALE body only (Troy, 2026-08-07), and
  // that covers the painted stubble/scruff decals too, since those are
  // facial hair the same as a volume is. A female roll is always clean; the
  // beard picker still reaches her if the player wants one.
  // Among male rolls most still come out clean-shaven: a beard should feel
  // like a result, not the default.
  // Both draws happen either way so the random STREAM does not depend on the
  // gender, a seeded test rolling the same sequence gets the same eyes and
  // skin on both bodies, and only the facial hair differs.
  const beardRoll = rand();
  const beardPick = of(BEARD_STYLES);
  const beard = base.gender === 'female' || beardRoll < 0.34 ? 'none' : beardPick;
  // the lash usually follows the hair, because that is what it does on a real
  // head, the wheel exists for the times it should not
  const matchLash = rand() < 0.7;
  return normalizeAppearance({
    ...base,
    hair: of(randomHairStyles(base.gender)),
    beard,
    brows: of(BROW_STYLES),
    eyeShape: of(EYE_STYLES),
    ears: of(EAR_STYLES),
    earrings: of(EARRING_STYLES),
    // most rolls keep the authored atlas look; a named material should read
    // as a deliberate touch rather than the norm
    earringMaterial: rand() < 0.55 ? 'default' : of(EARRING_MATERIAL_IDS),
    mouth: of(MOUTH_STYLES),
    // not a roll: lashes are the female standard, so the randomiser gives them
    // to every female body and to no male one. (Gender is the one field the
    // randomiser keeps, so `base` is the body being rolled for.)
    lashes: defaultLashes(base.gender),
    // Makeup is off here for the same reason it is off in DEFAULT_APPEARANCE:
    // it is opt-in, and a randomiser that paints it on is a randomiser that
    // takes the opting-in away.
    lipstick: 'none',
    blush: 'none',
    eyeshadow: 'none',
    skinHue: span(18, 38),
    skinSat: span(0.22, 0.62),
    skinLight: span(0.22, 0.86),
    hairHue,
    hairSat,
    hairLight,
    eyeHue: span(0, 360),
    eyeSat: span(0.15, 0.9),
    eyeLight: span(0.1, 0.55),
    lashHue: matchLash ? hairHue : span(0, 360),
    lashSat: matchLash ? hairSat : span(0.1, 0.85),
    lashLight: matchLash ? hairLight : span(0.05, 0.7),
    // kept off the rails: at +-1 every slider at once reads as a caricature
    face: Object.fromEntries(FACE_SLIDERS.map((k) => [k, span(-0.7, 0.7)])) as FaceShape,
    // gentler than the face: a randomised silhouette should read as a build,
    // not a caricature
    body: Object.fromEntries(BODY_SLIDERS.map((k) => [k, span(-0.35, 0.35)])) as BodyShape,
  });
}

/** Whether a body wears lashes unless told otherwise: the female standard, and
 *  off on the male. It is only the DEFAULT that is gendered, the customizer's
 *  toggle still reaches both, so a male character can wear them on purpose. The
 *  gender row applies this on a switch, which is what makes "standard on the
 *  female" true of a body you change your mind about. */
export function defaultLashes(gender: Gender): boolean {
  return gender === 'female';
}

export function lashColor(app: ModularAppearance): number {
  return hslToHex(app.lashHue ?? 26, app.lashSat ?? 0.5, app.lashLight ?? 0.24);
}

/** Clamp a stored/deserialized appearance into range, filling gaps with the
 *  default. Anything off the known style lists falls back rather than throwing,
 *  so an old save (or a hand-edited one) can never blank a character. */
export function normalizeAppearance(
  a: Partial<ModularAppearance> | null | undefined,
): ModularAppearance {
  const d = DEFAULT_APPEARANCE;
  const num = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    gender: a?.gender === 'female' ? 'female' : 'male',
    hair: pick(HAIR_LEGACY[a?.hair as string] ?? a?.hair, HAIR_STYLES, d.hair),
    beard: pick(BEARD_LEGACY[a?.beard as string] ?? a?.beard, BEARD_STYLES, d.beard),
    brows: pick(a?.brows, BROW_STYLES, d.brows),
    earrings: pick(a?.earrings, EARRING_STYLES, d.earrings),
    earringMaterial: pick(a?.earringMaterial, EARRING_MATERIAL_IDS, d.earringMaterial),
    skinHue: num(a?.skinHue, d.skinHue, 0, 360),
    skinSat: num(a?.skinSat, d.skinSat, 0, 1),
    skinLight: num(a?.skinLight, d.skinLight, 0.12, 0.95),
    hairHue: num(a?.hairHue, d.hairHue, 0, 360),
    hairSat: num(a?.hairSat, d.hairSat, 0, 1),
    hairLight: num(a?.hairLight, d.hairLight, 0.02, 0.95),
    eyeShape: pick(a?.eyeShape, EYE_STYLES, d.eyeShape),
    ears: pick(a?.ears, EAR_STYLES, d.ears),
    lipstick: pick(a?.lipstick, LIP_SHADES, d.lipstick),
    blush: pick(a?.blush, BLUSH_SHADES, d.blush),
    eyeshadow: pick(a?.eyeshadow, SHADOW_SHADES, d.eyeshadow),
    // an appearance saved before lashes existed has no opinion, so it gets the
    // gender's default rather than being read as "switched off"
    lashes:
      typeof a?.lashes === 'boolean'
        ? a.lashes
        : defaultLashes(a?.gender === 'female' ? 'female' : 'male'),
    lashHue: num(a?.lashHue, d.lashHue, 0, 360),
    lashSat: num(a?.lashSat, d.lashSat, 0, 1),
    lashLight: num(a?.lashLight, d.lashLight, 0.02, 0.95),
    eyeHue: num(a?.eyeHue, d.eyeHue, 0, 360),
    eyeSat: num(a?.eyeSat, d.eyeSat, 0, 1),
    eyeLight: num(a?.eyeLight, d.eyeLight, 0.03, 0.9),
    face: Object.fromEntries(
      FACE_SLIDERS.map((k) => [k, num(a?.face?.[k], 0, -1, 1)]),
    ) as FaceShape,
    body: Object.fromEntries(
      BODY_SLIDERS.map((k) => [k, num(a?.body?.[k], 0, -1, 1)]),
    ) as BodyShape,
    mouth: pick(a?.mouth, MOUTH_STYLES, d.mouth),
    outfit: pick(a?.outfit, OUTFIT_COLORWAY_IDS, d.outfit),
  };
}
