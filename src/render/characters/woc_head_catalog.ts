// The WOC head builder's option catalog: which modular head pieces each body
// type offers, the node names they ship under in the head packs, and the rule
// that turns a stored look into the set of nodes drawn. Pure data plus pure
// functions (no three.js, no DOM), so the renderer, the creation UI, the
// appearance normalizer and a Vitest all read the same table.
//
// Two head types, one per body fit: Type A rides the male rig and Type B the
// female rig. Each type's pieces come from its own Face Studio authoring file
// (Type A: head-options-20260929/WOC_Male_Expanded.blend, Type B:
// head-options-20260929/WOC_Female_Expanded.blend), fitted onto the
// rig's head bone and exported by scripts/assets/woc_character/woc_head_pack.py
// as one pack per type, which ships cut into the split files below (the split
// head library). Every piece is a rigid mesh hanging from the `head` bone
// (the same shape the armor packs' rigid parts take), so the runtime hangs it
// through the WOC rigid-part binder.
//
// Node naming (the contract with the export script):
//   WocHead_<T>_base                      the head itself (always drawn)
//   WocHead_<T>_<slot>_<variant>          a centred piece (hair, beard, nose, mouth)
//   WocHead_<T>_<slot>_<variant>_<L|R>    a paired piece (brows, ears, eyes)
//   WocHead_<T>_piercing_<site>           one piercing site (see PIERCING_SITES)
// where <T> is the type letter in upper case. Material names carry the tint
// role as a prefix (skin_, eye_, hair_, brow_, liner_, metal_): see
// WocHeadTintRole.

/** The head type a body fit wears. */
export type WocHeadType = 'a' | 'b';

/** The swappable feature slots, in creation-menu order. */
export type WocHeadSlot = 'hair' | 'beard' | 'nose' | 'mouth' | 'brows' | 'ears' | 'eyes';

export const WOC_HEAD_SLOTS: readonly WocHeadSlot[] = [
  'hair',
  'beard',
  'nose',
  'mouth',
  'brows',
  'ears',
  'eyes',
];

/** Slots whose pieces come as a left/right pair. */
const PAIRED_SLOTS: ReadonlySet<WocHeadSlot> = new Set<WocHeadSlot>(['brows', 'ears', 'eyes']);

/** Piercing sites, as authored on both heads. */
export const WOC_PIERCING_SITES = [
  'lobe_l',
  'lobe_r',
  'rim_l',
  'rim_r',
  'nostril',
  'septum',
  'brow',
  'lip',
] as const;
export type WocPiercingSite = (typeof WOC_PIERCING_SITES)[number];

/** The piercing choice is a preset of sites (one stored id, not eight toggles). */
export const WOC_PIERCING_PRESETS: Readonly<Record<string, readonly WocPiercingSite[]>> = {
  none: [],
  lobes: ['lobe_l', 'lobe_r'],
  ears: ['lobe_l', 'lobe_r', 'rim_l', 'rim_r'],
  brow: ['brow'],
  nose: ['nostril'],
  septum: ['septum'],
  lip: ['lip'],
  full: ['lobe_l', 'lobe_r', 'rim_l', 'rim_r', 'nostril', 'brow', 'lip'],
};
export const WOC_PIERCING_IDS: readonly string[] = Object.keys(WOC_PIERCING_PRESETS);

/** A stored head look: one variant id per slot plus the piercing preset. Ids
 *  are bare lowercase words so they pass the appearance wire charset. */
export interface WocHeadLook {
  hair: string;
  beard: string;
  nose: string;
  mouth: string;
  brows: string;
  ears: string;
  eyes: string;
  piercing: string;
}

/** The continuous face controls, driven by the Face Studio shape keys the head
 *  pieces carry as morph targets (each piece carries the ones that move it: the
 *  chin moves the head, lips, nose and worn facial hair together). */
export const WOC_HEAD_MORPHS = {
  eyeSpacing: 'FS_Eyes_Spacing',
  eyeSize: 'FS_Eyes_Size',
  eyeTilt: 'FS_Eyes_Tilt',
  browHeight: 'FS_Brows_Height',
  /** Stored as Face Studio's Chin softness, the morph influence as authored:
   *  0 = the sculpted, widest jaw, 1 = the narrowest, softest chin (measured in
   *  game). The builder's Chin Width slider shows it inverted (width = 1 - value). */
  chinWidth: 'FS_Chin_Softness',
} as const;
export type WocHeadMorph = keyof typeof WOC_HEAD_MORPHS;
export const WOC_HEAD_MORPH_KEYS = Object.keys(WOC_HEAD_MORPHS) as WocHeadMorph[];

/** Each control's stored range and default (the morph influence IS the value).
 *  The eye and brow controls push both ways from the sculpt; the chin only
 *  softens, and opens at the authoring file's own 0.65. */
export const WOC_HEAD_MORPH_RANGE: Readonly<
  Record<WocHeadMorph, { readonly min: number; readonly max: number; readonly def: number }>
> = {
  eyeSpacing: { min: -1, max: 1, def: 0 },
  eyeSize: { min: -1, max: 1, def: 0 },
  eyeTilt: { min: -1, max: 1, def: 0 },
  browHeight: { min: -1, max: 1, def: 0 },
  chinWidth: { min: 0, max: 1, def: 0.65 },
};

/** The head base's shorter bald scalp, applied at full weight while the look is
 *  bald (hair 'bald'); every hairstyle wears the original fitted scalp. */
export const WOC_HEAD_BALD_CROWN_MORPH = 'FS_Bald_Crown';

/** The morph that tucks the scalp and ears in under a hairstyle, when the head
 *  was authored with one for it (Face Studio's per-style scalp tuck). */
export function wocHeadTuckMorph(hairId: string): string {
  return `FS_Tuck_${hairId}`;
}

/** How a material is recoloured, read from its name prefix. */
export type WocHeadTintRole = 'skin' | 'eye' | 'hair' | 'brow' | 'liner' | 'metal';
const TINT_PREFIXES: readonly WocHeadTintRole[] = ['skin', 'eye', 'hair', 'brow', 'liner', 'metal'];

/** The tint role a head material's name declares, or null for an untinted one. */
export function wocHeadTintRole(materialName: string): WocHeadTintRole | null {
  const lower = materialName.toLowerCase();
  for (const role of TINT_PREFIXES) if (lower.startsWith(`${role}_`)) return role;
  return null;
}

/** One selectable variant: its stored id and the i18n key of its label. */
export interface WocHeadVariant {
  readonly id: string;
  readonly labelKey: string;
}

export interface WocHeadTypeDef {
  readonly type: WocHeadType;
  readonly fit: 'male' | 'female';
  /** The i18n key of the type's name in the body-type picker. */
  readonly labelKey: string;
  readonly slots: Readonly<Record<WocHeadSlot, readonly WocHeadVariant[]>>;
  readonly defaults: WocHeadLook;
}

const v = (slot: WocHeadSlot, id: string): WocHeadVariant => ({
  id,
  labelKey: `auth.wocHead.${slot}.${id}`,
});

/** Facial hair, the same eight styles fitted to both heads, plus clean shaven. */
const BEARDS: readonly WocHeadVariant[] = [
  v('beard', 'none'),
  v('beard', 'moustache'),
  v('beard', 'handlebar'),
  v('beard', 'goatee'),
  v('beard', 'chin'),
  v('beard', 'boxed'),
  v('beard', 'long'),
  v('beard', 'chops'),
  v('beard', 'chinstrap'),
];

export const WOC_HEAD_TYPES: Readonly<Record<WocHeadType, WocHeadTypeDef>> = {
  a: {
    type: 'a',
    fit: 'male',
    labelKey: 'auth.bodyTypeA',
    slots: {
      hair: [
        v('hair', 'swept'),
        v('hair', 'long'),
        v('hair', 'mohawk'),
        v('hair', 'quiff'),
        v('hair', 'undercut'),
        v('hair', 'topknot'),
        v('hair', 'shoulder'),
        // Type B's styles, fitted onto the Type A head (owner call 2026-10-01)
        v('hair', 'ponytail'),
        v('hair', 'braid'),
        v('hair', 'waves'),
        v('hair', 'bald'),
      ],
      beard: BEARDS,
      nose: [v('nose', 'default'), v('nose', 'broad'), v('nose', 'aquiline')],
      mouth: [v('mouth', 'default'), v('mouth', 'full'), v('mouth', 'smirk')],
      brows: [
        v('brows', 'default'),
        v('brows', 'slim'),
        v('brows', 'arched'),
        v('brows', 'relaxed'),
        v('brows', 'soft_arch'),
        v('brows', 'rounded'),
      ],
      ears: [v('ears', 'default'), v('ears', 'large'), v('ears', 'pointed')],
      eyes: [v('eyes', 'default'), v('eyes', 'almond'), v('eyes', 'hooded')],
    },
    // the authoring file's opening look (short boxed beard, relaxed brows), with the swept
    // hairstyle as the default (owner call 2026-10-01; it was the topknot)
    defaults: {
      hair: 'swept',
      beard: 'boxed',
      nose: 'default',
      mouth: 'default',
      brows: 'relaxed',
      ears: 'default',
      eyes: 'default',
      piercing: 'none',
    },
  },
  b: {
    type: 'b',
    fit: 'female',
    labelKey: 'auth.bodyTypeB',
    slots: {
      hair: [
        v('hair', 'waves'),
        v('hair', 'ponytail'),
        v('hair', 'braid'),
        v('hair', 'bob'),
        v('hair', 'crown'),
        v('hair', 'twins'),
        v('hair', 'curls'),
        // Type A's styles, fitted onto the Type B head (owner call 2026-10-01)
        v('hair', 'undercut'),
        v('hair', 'topknot'),
        v('hair', 'shoulder'),
        v('hair', 'bald'),
      ],
      beard: BEARDS,
      nose: [v('nose', 'default'), v('nose', 'button'), v('nose', 'soft')],
      mouth: [
        v('mouth', 'default'),
        v('mouth', 'full'),
        v('mouth', 'relaxed'),
        v('mouth', 'cupids_bow'),
        v('mouth', 'narrow'),
        v('mouth', 'thin'),
        v('mouth', 'rounded'),
      ],
      brows: [
        v('brows', 'default'),
        v('brows', 'soft'),
        v('brows', 'straight'),
        v('brows', 'relaxed'),
        v('brows', 'soft_arch'),
        v('brows', 'rounded'),
      ],
      ears: [v('ears', 'default'), v('ears', 'round'), v('ears', 'pointed')],
      eyes: [v('eyes', 'default'), v('eyes', 'almond'), v('eyes', 'hooded')],
    },
    // the authoring file's own opening look (braid, relaxed brows), clean shaven
    defaults: {
      hair: 'braid',
      beard: 'none',
      nose: 'default',
      mouth: 'default',
      brows: 'relaxed',
      ears: 'default',
      eyes: 'default',
      piercing: 'none',
    },
  },
};

// --- the split head library -------------------------------------------------
//
// Each type's library ships SPLIT (scripts/assets/woc_character/woc_head_pack_split.mjs
// cuts the compressed pack by these rules), so a character downloads only what it
// wears: one CORE file (the head and every small face piece, which share textures and
// swap instantly in the builder), one file per hairstyle (the hair and its scalp), and
// the facial hair grouped by the texture atlas it shares (seven styles cut from one
// source share one atlas; the handlebar has its own). Every file keeps the rig's bone
// hierarchy and hangs its pieces under `head`, exactly like the whole pack did.

const PACK_DIR = 'models/chars/players/woc';

/** Beard ids that live in their own file (a texture of their own); every other
 *  beard shares the group file. */
const BEARDS_WITH_OWN_FILE: ReadonlySet<string> = new Set(['handlebar']);

/** A type's core file: the base head, eyes, brows, noses, lips, ears, piercings. */
export function wocHeadCoreUrl(type: WocHeadType): string {
  return `${PACK_DIR}/head_type_${type}_core.glb`;
}

/** The file one hair or beard variant ships in, or null for a variant with no
 *  mesh (bald, clean shaven). Every other slot rides the core file. */
export function wocHeadPieceUrl(type: WocHeadType, slot: WocHeadSlot, id: string): string | null {
  if (slot === 'hair') return id === 'bald' ? null : `${PACK_DIR}/head_type_${type}_hair_${id}.glb`;
  if (slot === 'beard') {
    if (id === 'none') return null;
    return BEARDS_WITH_OWN_FILE.has(id)
      ? `${PACK_DIR}/head_type_${type}_beard_${id}.glb`
      : `${PACK_DIR}/head_type_${type}_beards.glb`;
  }
  return wocHeadCoreUrl(type);
}

/** Every file of a type's split library (the export writes exactly these). */
export function wocHeadAllUrls(type: WocHeadType): string[] {
  const out = new Set<string>([wocHeadCoreUrl(type)]);
  for (const slot of ['hair', 'beard'] as const) {
    for (const x of WOC_HEAD_TYPES[type].slots[slot]) {
      const url = wocHeadPieceUrl(type, slot, x.id);
      if (url) out.add(url);
    }
  }
  return [...out];
}

/** The files a look needs drawn: the core, plus its hair and beard files. */
export function wocHeadLookUrls(
  type: WocHeadType,
  look: Partial<WocHeadLook> | null | undefined,
): string[] {
  const resolved = resolveWocHeadLook(type, look);
  const out = new Set<string>([wocHeadCoreUrl(type)]);
  for (const slot of ['hair', 'beard'] as const) {
    const url = wocHeadPieceUrl(type, slot, resolved[slot]);
    if (url) out.add(url);
  }
  return [...out];
}

/** The head type a stored body pick wears (male body = Type A, female = Type B). */
export function wocHeadTypeForGender(gender: string | undefined | null): WocHeadType {
  return gender === 'female' ? 'b' : 'a';
}

/** Every variant id any type offers in a slot (the union the normalizer allows). */
export function wocHeadSlotIds(slot: WocHeadSlot): string[] {
  const out = new Set<string>();
  for (const def of Object.values(WOC_HEAD_TYPES)) for (const x of def.slots[slot]) out.add(x.id);
  return [...out];
}

/** A look made valid for one type: an id the type does not offer (another
 *  type's hairstyle after a body-type switch, a retired id, junk) falls back
 *  to that type's default for the slot. */
export function resolveWocHeadLook(
  type: WocHeadType,
  look: Partial<WocHeadLook> | null | undefined,
): WocHeadLook {
  const def = WOC_HEAD_TYPES[type];
  const pick = (slot: WocHeadSlot): string => {
    const want = look?.[slot];
    return def.slots[slot].some((x) => x.id === want) ? (want as string) : def.defaults[slot];
  };
  const piercing = look?.piercing;
  return {
    hair: pick('hair'),
    beard: pick('beard'),
    nose: pick('nose'),
    mouth: pick('mouth'),
    brows: pick('brows'),
    ears: pick('ears'),
    eyes: pick('eyes'),
    // own ids only: `in` would also accept an inherited name ('constructor'), which
    // the appearance sanitizer's id pattern lets through and no preset list backs
    piercing:
      typeof piercing === 'string' && WOC_PIERCING_IDS.includes(piercing)
        ? piercing
        : def.defaults.piercing,
  };
}

const letter = (type: WocHeadType): string => type.toUpperCase();

/** The base head node of a type. */
export function wocHeadBaseNode(type: WocHeadType): string {
  return `WocHead_${letter(type)}_base`;
}

/** The node names one slot variant draws ([] for a variant with no mesh: bald,
 *  clean shaven). */
export function wocHeadVariantNodes(type: WocHeadType, slot: WocHeadSlot, id: string): string[] {
  if ((slot === 'hair' && id === 'bald') || (slot === 'beard' && id === 'none')) return [];
  const stem = `WocHead_${letter(type)}_${slot}_${id}`;
  return PAIRED_SLOTS.has(slot) ? [`${stem}_L`, `${stem}_R`] : [stem];
}

/** The node name of one piercing site. */
export function wocHeadPiercingNode(type: WocHeadType, site: WocPiercingSite): string {
  return `WocHead_${letter(type)}_piercing_${site}`;
}

/** Every node a type's head pack ships (the full library, drawn or not). */
export function wocHeadAllNodes(type: WocHeadType): string[] {
  const def = WOC_HEAD_TYPES[type];
  const out = [wocHeadBaseNode(type)];
  for (const slot of WOC_HEAD_SLOTS) {
    for (const x of def.slots[slot]) out.push(...wocHeadVariantNodes(type, slot, x.id));
  }
  for (const site of WOC_PIERCING_SITES) out.push(wocHeadPiercingNode(type, site));
  return out;
}

/** Slots a worn helm hides (its shell covers them; the face and facial hair stay). */
export const WOC_HEAD_HIDDEN_UNDER_HELM: readonly WocHeadSlot[] = ['hair'];

/** The nodes a look draws. `helm` is true while a helm (or hood) is shown. */
export function wocHeadVisibleNodes(
  type: WocHeadType,
  look: Partial<WocHeadLook> | null | undefined,
  opts: { helm: boolean },
): string[] {
  const resolved = resolveWocHeadLook(type, look);
  const out = [wocHeadBaseNode(type)];
  for (const slot of WOC_HEAD_SLOTS) {
    if (opts.helm && WOC_HEAD_HIDDEN_UNDER_HELM.includes(slot)) continue;
    out.push(...wocHeadVariantNodes(type, slot, resolved[slot]));
  }
  for (const site of WOC_PIERCING_PRESETS[resolved.piercing] ?? []) {
    out.push(wocHeadPiercingNode(type, site));
  }
  return out;
}
