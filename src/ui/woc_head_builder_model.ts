// The WOC face builder's pure view model: the category menu, the option lists
// each category offers for the current head type, the swatch palettes, the
// slider specs and readouts, and every state transition the painter
// (woc_head_builder.ts) performs. DOM-free and three-free, so a Vitest drives
// the whole builder model directly and the painter stays a thin consumer.
// (Named _model, not _core: it reads the render-side head catalog, pure data,
// which a registered UI pure core may not import.)
//
// The builder edits the WOC modular-head fields of a character's appearance
// (headHair ... headPiercing, headShape, the brow colour) plus the shared
// body pick, the body size and the skin/hair/eye colours. The option ids come
// straight from the head catalog (src/render/characters/woc_head_catalog.ts),
// so a variant added there shows up here with no UI change. Facial hair has
// no colour of its own: the renderer tints it with the hair colour, so one
// Hair Color pick recolours hair and beard together.

import {
  clampWocBodyScale,
  DEFAULT_APPEARANCE,
  WOC_BODY_SCALE_RANGE,
} from '../render/characters/modular';
import {
  resolveWocHeadLook,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  type WocHeadLook,
  type WocHeadMorph,
  type WocHeadSlot,
  type WocHeadType,
  wocHeadTypeForGender,
} from '../render/characters/woc_head_catalog';
import { formatNumber } from './i18n';
import { rovingTarget } from './roving_index';

/** The continuous face controls, each within its WOC_HEAD_MORPH_RANGE. */
export type WocHeadShape = Record<WocHeadMorph, number>;

/** The appearance fields the builder reads and writes. Structural, so the full
 *  ModularAppearance satisfies it once it carries the WOC head fields. */
export interface WocFaceAppearance {
  gender: 'male' | 'female';
  /** Uniform body size, WOC_BODY_SCALE_RANGE (1 = as authored). */
  bodyScale: number;
  skinHue: number;
  skinSat: number;
  skinLight: number;
  hairHue: number;
  hairSat: number;
  hairLight: number;
  eyeHue: number;
  eyeSat: number;
  eyeLight: number;
  browHue: number;
  browSat: number;
  browLight: number;
  headHair: string;
  headBeard: string;
  headNose: string;
  headMouth: string;
  headBrows: string;
  headEars: string;
  headEyes: string;
  headPiercing: string;
  headShape: WocHeadShape;
}

/** The menu, in order (the reference creator's, plus Piercings last). */
export type WocBuilderCategory =
  | 'bodyType'
  | 'skinTone'
  | 'face'
  | 'eyesBrows'
  | 'eyeColor'
  | 'hairstyle'
  | 'facialHair'
  | 'hairColor'
  | 'browColor'
  | 'piercings';

export const WOC_BUILDER_CATEGORIES: readonly WocBuilderCategory[] = [
  'bodyType',
  'skinTone',
  'face',
  'eyesBrows',
  'eyeColor',
  'hairstyle',
  'facialHair',
  'hairColor',
  'browColor',
  'piercings',
];

/** The label key of each category (auth.wocBuilder.cat.<id>). */
export function categoryLabelKey(cat: WocBuilderCategory): string {
  return `auth.wocBuilder.cat.${cat}`;
}

/** Where the creation camera should sit while a category is open: the body
 *  pick shows the whole character, every other category edits the face. */
export type WocBuilderFocus = 'face' | 'body';

export function focusForCategory(cat: WocBuilderCategory | null): WocBuilderFocus {
  return cat === null || cat === 'bodyType' ? 'body' : 'face';
}

// --- palettes ----------------------------------------------------------------

/** One colour swatch: a stored HSL triple plus its accessible name key. */
export interface WocSwatch {
  readonly id: string;
  readonly labelKey: string;
  readonly hue: number;
  readonly sat: number;
  readonly light: number;
}

const sw = (group: string, id: string, hue: number, sat: number, light: number): WocSwatch => ({
  id,
  labelKey: `auth.wocBuilder.${group}.${id}`,
  hue,
  sat,
  light,
});

/** Skin tones, light to deep, evenly stepped in lightness with the undertones
 *  mixed along the way (pink, neutral, golden, olive, red-brown). Custom
 *  reaches everything between. */
export const WOC_SKIN_TONES: readonly WocSwatch[] = [
  sw('skin', 'porcelain', 27, 0.52, 0.88),
  sw('skin', 'ivory', 34, 0.46, 0.83),
  sw('skin', 'rose', 14, 0.46, 0.78),
  sw('skin', 'peach', 24, 0.55, 0.73),
  // DEFAULT_APPEARANCE's skin, to the digit: an untouched character lights a
  // named swatch rather than Custom (the same holds in the other palettes)
  sw('skin', 'fair', 27, 0.46, 0.68),
  sw('skin', 'beige', 32, 0.42, 0.63),
  sw('skin', 'sand', 34, 0.4, 0.59),
  sw('skin', 'honey', 30, 0.47, 0.55),
  sw('skin', 'olive', 38, 0.28, 0.51),
  sw('skin', 'caramel', 26, 0.46, 0.47),
  sw('skin', 'tan', 23, 0.44, 0.43),
  sw('skin', 'bronze', 21, 0.46, 0.38),
  sw('skin', 'chestnut', 16, 0.44, 0.33),
  sw('skin', 'umber', 21, 0.42, 0.28),
  sw('skin', 'mahogany', 14, 0.38, 0.22),
  sw('skin', 'ebony', 20, 0.33, 0.16),
];

export const WOC_EYE_COLORS: readonly WocSwatch[] = [
  // the default eye colour
  sw('eye', 'brown', 28, 0.42, 0.18),
  sw('eye', 'darkBrown', 22, 0.45, 0.1),
  sw('eye', 'hazel', 40, 0.45, 0.35),
  sw('eye', 'amber', 36, 0.85, 0.45),
  sw('eye', 'green', 115, 0.4, 0.35),
  sw('eye', 'teal', 176, 0.45, 0.34),
  sw('eye', 'blue', 210, 0.6, 0.45),
  sw('eye', 'paleBlue', 200, 0.4, 0.68),
  sw('eye', 'grey', 210, 0.08, 0.5),
  sw('eye', 'violet', 275, 0.45, 0.45),
];

/** Hair colours, platinum to black, then the naturals' outliers. Also the
 *  eyebrow palette, and (through the hair tint) the facial hair's. */
export const WOC_HAIR_COLORS: readonly WocSwatch[] = [
  sw('hairColor', 'platinum', 48, 0.55, 0.86),
  sw('hairColor', 'blonde', 44, 0.6, 0.62),
  sw('hairColor', 'golden', 38, 0.62, 0.47),
  sw('hairColor', 'copper', 20, 0.72, 0.42),
  sw('hairColor', 'red', 6, 0.7, 0.38),
  sw('hairColor', 'auburn', 12, 0.55, 0.27),
  sw('hairColor', 'lightBrown', 28, 0.4, 0.38),
  // the default hair (and brow) colour
  sw('hairColor', 'brown', 26, 0.5, 0.24),
  sw('hairColor', 'darkBrown', 20, 0.35, 0.14),
  sw('hairColor', 'black', 220, 0.1, 0.07),
  sw('hairColor', 'silver', 210, 0.06, 0.72),
  sw('hairColor', 'white', 40, 0.1, 0.92),
];

/** The swatch a stored colour matches, or null for a custom colour. */
export function matchSwatch(
  palette: readonly WocSwatch[],
  hue: number,
  sat: number,
  light: number,
): WocSwatch | null {
  for (const s of palette) {
    if (sameColor(s.hue, s.sat, s.light, hue, sat, light)) return s;
  }
  return null;
}

function sameColor(
  h1: number,
  s1: number,
  l1: number,
  h2: number,
  s2: number,
  l2: number,
): boolean {
  const dh = Math.abs(((((h1 - h2) % 360) + 540) % 360) - 180);
  if (dh < 0.6 && Math.abs(s1 - s2) < 0.006 && Math.abs(l1 - l2) < 0.006) return true;
  // the same 8-bit colour: the custom control (an <input type=color>) speaks
  // only #rrggbb, so a dark swatch committed through it comes back a little off
  // in HSL (hue 20.9 for 22) and must still read as that swatch, not Custom
  return hslToCss(h1, s1, l1) === hslToCss(h2, s2, l2);
}

/** Whether the brows wear the hair colour (the "Match hair" default). */
export function browsMatchHair(a: WocFaceAppearance): boolean {
  return sameColor(a.browHue, a.browSat, a.browLight, a.hairHue, a.hairSat, a.hairLight);
}

/** What a colour section edits. */
export type WocColorTarget = 'skin' | 'eye' | 'hair' | 'brow';

/** The stored colour one target currently wears. */
export function targetColor(
  a: WocFaceAppearance,
  target: WocColorTarget,
): { hue: number; sat: number; light: number } {
  switch (target) {
    case 'skin':
      return { hue: a.skinHue, sat: a.skinSat, light: a.skinLight };
    case 'eye':
      return { hue: a.eyeHue, sat: a.eyeSat, light: a.eyeLight };
    case 'hair':
      return { hue: a.hairHue, sat: a.hairSat, light: a.hairLight };
    case 'brow':
      return { hue: a.browHue, sat: a.browSat, light: a.browLight };
  }
}

/** The custom colour control's accessible name per target: skin names its own
 *  (a skin tone is not "a colour" to a screen-reader user choosing one). */
const CUSTOM_ARIA: Readonly<Record<WocColorTarget, string>> = {
  skin: 'auth.wocBuilder.customSkinAria',
  eye: 'auth.wocBuilder.customColorAria',
  hair: 'auth.wocBuilder.customColorAria',
  brow: 'auth.wocBuilder.customColorAria',
};

// --- reading a stored appearance ------------------------------------------------

type AnyLook = Partial<WocFaceAppearance> & { gender?: string };

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

/** The head type an appearance's body pick wears. */
export function headTypeOf(a: { gender?: string }): WocHeadType {
  return wocHeadTypeForGender(a.gender);
}

/** The builder's full view of an appearance: every field present, head ids
 *  valid for the body's head type, shape values and body size clamped to
 *  their ranges, a missing brow colour following the hair. Never throws on
 *  junk. */
export function readFace(a: AnyLook | null | undefined): WocFaceAppearance {
  const d = DEFAULT_APPEARANCE;
  const gender = a?.gender === 'female' ? 'female' : 'male';
  const type = wocHeadTypeForGender(gender);
  const look = resolveWocHeadLook(type, {
    hair: a?.headHair,
    beard: a?.headBeard,
    nose: a?.headNose,
    mouth: a?.headMouth,
    brows: a?.headBrows,
    ears: a?.headEars,
    eyes: a?.headEyes,
    piercing: a?.headPiercing,
  });
  const hairHue = num(a?.hairHue, d.hairHue, 0, 360);
  const hairSat = num(a?.hairSat, d.hairSat, 0, 1);
  const hairLight = num(a?.hairLight, d.hairLight, 0, 1);
  const shape = {} as WocHeadShape;
  for (const k of WOC_HEAD_MORPH_KEYS) {
    const r = WOC_HEAD_MORPH_RANGE[k];
    shape[k] = num(a?.headShape?.[k], r.def, r.min, r.max);
  }
  return {
    gender,
    // the normalizer's own clamp, so the builder and the stored look agree
    bodyScale: clampWocBodyScale(a?.bodyScale),
    skinHue: num(a?.skinHue, d.skinHue, 0, 360),
    skinSat: num(a?.skinSat, d.skinSat, 0, 1),
    skinLight: num(a?.skinLight, d.skinLight, 0, 1),
    hairHue,
    hairSat,
    hairLight,
    eyeHue: num(a?.eyeHue, d.eyeHue, 0, 360),
    eyeSat: num(a?.eyeSat, d.eyeSat, 0, 1),
    eyeLight: num(a?.eyeLight, d.eyeLight, 0, 1),
    browHue: num(a?.browHue, hairHue, 0, 360),
    browSat: num(a?.browSat, hairSat, 0, 1),
    browLight: num(a?.browLight, hairLight, 0, 1),
    ...lookFields(look),
    headShape: shape,
  };
}

function lookFields(
  look: WocHeadLook,
): Pick<
  WocFaceAppearance,
  | 'headHair'
  | 'headBeard'
  | 'headNose'
  | 'headMouth'
  | 'headBrows'
  | 'headEars'
  | 'headEyes'
  | 'headPiercing'
> {
  return {
    headHair: look.hair,
    headBeard: look.beard,
    headNose: look.nose,
    headMouth: look.mouth,
    headBrows: look.brows,
    headEars: look.ears,
    headEyes: look.eyes,
    headPiercing: look.piercing,
  };
}

/** The stored fields that hold a head-slot variant id. */
export type WocHeadIdField =
  | 'headHair'
  | 'headBeard'
  | 'headNose'
  | 'headMouth'
  | 'headBrows'
  | 'headEars'
  | 'headEyes';

/** The stored field each head slot writes. */
export const SLOT_FIELD: Readonly<Record<WocHeadSlot, WocHeadIdField>> = {
  hair: 'headHair',
  beard: 'headBeard',
  nose: 'headNose',
  mouth: 'headMouth',
  brows: 'headBrows',
  ears: 'headEars',
  eyes: 'headEyes',
};

// --- the menu model ---------------------------------------------------------------

/** One choosable option row entry (a variant, a body type, a preset). */
export interface WocBuilderOption {
  readonly id: string;
  readonly labelKey: string;
  readonly selected: boolean;
  /** body types only: the decorative letter tile's key (the label carries the
   *  meaning, so the painter hides the tile from assistive tech) */
  readonly glyphKey?: string;
}

/** What a slider drives: a face morph, or the body size. */
export type WocSliderTarget = WocHeadMorph | 'bodyScale';

/** How a slider's readout reads: the signed step from the sculpt (-100..+100,
 *  0 = as sculpted) for a control that pushes both ways, a percentage for one
 *  with a floor (the chin width's 0..100%), or the whole-percent offset from the
 *  authored size (the body: -5 .. 0 .. +5, 0 = normal height). */
export type WocSliderReadout = 'signed' | 'percent' | 'offset';

/** What an options section writes: a head slot, the body pick, or the
 *  piercing preset. */
export type WocOptionTarget = WocHeadSlot | 'bodyType' | 'piercing';

/** One block inside a category's panel. */
export type WocBuilderSection =
  | {
      readonly kind: 'options';
      readonly target: WocOptionTarget;
      readonly labelKey: string | null;
      readonly options: readonly WocBuilderOption[];
    }
  | {
      readonly kind: 'swatches';
      readonly target: WocColorTarget;
      readonly labelKey: string | null;
      readonly swatches: readonly (WocSwatch & { readonly selected: boolean })[];
      /** brows only: the "Match hair" chip and whether it is on */
      readonly matchHair?: boolean;
      /** whether the stored colour is off-palette (the custom control lights) */
      readonly custom: boolean;
      /** the custom colour control's accessible name */
      readonly customLabelKey: string;
    }
  | {
      readonly kind: 'slider';
      readonly target: WocSliderTarget;
      readonly labelKey: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      /** where a double-click puts it back */
      readonly def: number;
      readonly readout: WocSliderReadout;
      /** values marked under the track, evenly spaced, in the slider's units
       *  (read out like the value), so the scale and its middle are plain */
      readonly ticks?: readonly number[];
    };

export type WocSliderSection = Extract<WocBuilderSection, { kind: 'slider' }>;

const SLOT_SECTION_LABEL: Readonly<Partial<Record<WocHeadSlot, string>>> = {
  nose: 'auth.wocBuilder.section.nose',
  mouth: 'auth.wocBuilder.section.mouth',
  brows: 'auth.wocBuilder.section.brows',
  ears: 'auth.wocBuilder.section.ears',
  eyes: 'auth.wocBuilder.section.eyes',
};

/** The Eyes and Brows sliders, in panel order. */
export const EYE_BROW_MORPHS: readonly WocHeadMorph[] = [
  'eyeSpacing',
  'eyeSize',
  'eyeTilt',
  'browHeight',
];

/** The Face category's sliders, under its variant rows. */
export const FACE_MORPHS: readonly WocHeadMorph[] = ['chinWidth'];

/** Every slider steps by whole percents of its value: a coarser step would let
 *  the range input snap a stored value (a roll lands anywhere) away from the
 *  readout and aria-valuetext beside it. */
const SLIDER_STEP = 0.01;

/** Face controls whose slider reads the other way from the stored morph. The
 *  stored chinWidth is Face Studio's chin SOFTNESS as authored (0 = the widest,
 *  sculpted jaw; 1 = the narrowest, softest chin), and the slider shows WIDTH:
 *  shown = 1 - stored, so the authored 0.65 reads 35%. */
const INVERTED_MORPHS: ReadonlySet<WocHeadMorph> = new Set<WocHeadMorph>(['chinWidth']);

/** A stored morph value as its slider shows it, and back: the flip across the
 *  range is its own inverse. Rounded so 1 - 0.65 is 0.35, not 0.35000000000000003. */
export function morphShown(k: WocHeadMorph, v: number): number {
  if (!INVERTED_MORPHS.has(k)) return v;
  const r = WOC_HEAD_MORPH_RANGE[k];
  return Math.round((r.min + r.max - v) * 1e6) / 1e6;
}

/** The label key of one slider (auth.wocBuilder.slider.<target>). */
export function sliderLabelKey(k: WocSliderTarget): string {
  return `auth.wocBuilder.slider.${k}`;
}

/** The label key of one piercing preset (auth.wocBuilder.piercing.<id>). */
export function piercingLabelKey(id: string): string {
  return `auth.wocBuilder.piercing.${id}`;
}

function slotSection(
  a: WocFaceAppearance,
  slot: WocHeadSlot,
  labelled: boolean,
): WocBuilderSection {
  const def = WOC_HEAD_TYPES[headTypeOf(a)];
  const current = a[SLOT_FIELD[slot]];
  return {
    kind: 'options',
    target: slot,
    labelKey: labelled ? (SLOT_SECTION_LABEL[slot] ?? null) : null,
    options: def.slots[slot].map((x) => ({
      id: x.id,
      labelKey: x.labelKey,
      selected: x.id === current,
    })),
  };
}

function morphSlider(a: WocFaceAppearance, k: WocHeadMorph): WocSliderSection {
  const r = WOC_HEAD_MORPH_RANGE[k];
  return {
    kind: 'slider',
    target: k,
    labelKey: sliderLabelKey(k),
    value: morphShown(k, a.headShape[k]),
    min: r.min,
    max: r.max,
    step: SLIDER_STEP,
    def: morphShown(k, r.def),
    readout: r.min < 0 ? 'signed' : 'percent',
  };
}

function bodyScaleSlider(a: WocFaceAppearance): WocSliderSection {
  const r = WOC_BODY_SCALE_RANGE;
  return {
    kind: 'slider',
    target: 'bodyScale',
    labelKey: sliderLabelKey('bodyScale'),
    value: a.bodyScale,
    min: r.min,
    max: r.max,
    step: SLIDER_STEP,
    def: r.def,
    readout: 'offset',
    ticks: [r.min, r.def, r.max],
  };
}

function swatchSection(
  target: WocColorTarget,
  palette: readonly WocSwatch[],
  a: WocFaceAppearance,
  extra: { matchHair?: boolean } = {},
): WocBuilderSection {
  const { hue, sat, light } = targetColor(a, target);
  const hit = extra.matchHair ? null : matchSwatch(palette, hue, sat, light);
  return {
    kind: 'swatches',
    target,
    labelKey: null,
    swatches: palette.map((s) => ({ ...s, selected: hit?.id === s.id })),
    ...(extra.matchHair !== undefined ? { matchHair: extra.matchHair } : {}),
    custom: !extra.matchHair && hit === null,
    customLabelKey: CUSTOM_ARIA[target],
  };
}

/** The sections a category's panel shows for an appearance. */
export function categorySections(
  cat: WocBuilderCategory,
  a: WocFaceAppearance,
): WocBuilderSection[] {
  switch (cat) {
    case 'bodyType':
      return [
        {
          kind: 'options',
          target: 'bodyType',
          labelKey: null,
          options: (['a', 'b'] as const).map((type) => {
            const def = WOC_HEAD_TYPES[type];
            return {
              id: def.fit,
              labelKey: def.labelKey,
              selected: a.gender === def.fit,
              glyphKey: `auth.wocBuilder.bodyGlyph.${type}`,
            };
          }),
        },
        bodyScaleSlider(a),
      ];
    case 'skinTone':
      return [swatchSection('skin', WOC_SKIN_TONES, a)];
    case 'face':
      return [
        slotSection(a, 'nose', true),
        slotSection(a, 'mouth', true),
        slotSection(a, 'ears', true),
        ...FACE_MORPHS.map((k) => morphSlider(a, k)),
      ];
    case 'eyesBrows':
      return [
        slotSection(a, 'eyes', true),
        slotSection(a, 'brows', true),
        ...EYE_BROW_MORPHS.map((k) => morphSlider(a, k)),
      ];
    case 'eyeColor':
      return [swatchSection('eye', WOC_EYE_COLORS, a)];
    case 'hairstyle':
      return [slotSection(a, 'hair', false)];
    case 'facialHair':
      return [slotSection(a, 'beard', false)];
    case 'hairColor':
      return [swatchSection('hair', WOC_HAIR_COLORS, a)];
    case 'browColor':
      return [swatchSection('brow', WOC_HAIR_COLORS, a, { matchHair: browsMatchHair(a) })];
    case 'piercings':
      return [
        {
          kind: 'options',
          target: 'piercing',
          labelKey: null,
          options: WOC_PIERCING_IDS.map((id) => ({
            id,
            labelKey: piercingLabelKey(id),
            selected: id === a.headPiercing,
          })),
        },
      ];
  }
}

/** A slider's readout, through the locale's number formatter: "+20" / "-35" /
 *  "0" for a signed control, "65%" for a percentage, "-5" / "0" / "+5" for the
 *  body's offset from its authored size. */
export function sliderReadout(readout: WocSliderReadout, value: number): string {
  if (readout === 'percent') {
    return formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
  }
  const steps = readout === 'offset' ? value - 1 : value;
  return formatNumber(Math.round(steps * 100), {
    signDisplay: 'exceptZero',
    maximumFractionDigits: 0,
  });
}

/** How far along its track a slider value sits, 0..100 (the fill gradient). */
export function sliderFill(s: Pick<WocSliderSection, 'min' | 'max'>, value: number): number {
  const span = s.max - s.min;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(100, ((value - s.min) / span) * 100));
}

// --- transitions (each returns the NEXT full face state) ---------------------

/** Switch the body type. Facial hair always takes the new body's default on
 *  a switch, the way the lashes follow the body in the KayKit creator: Type B
 *  opens clean shaven and Type A on its boxed beard, whatever the last body
 *  wore (the Facial Hair list still offers every style to both). Every other
 *  pick carries over where the new head offers it; one it does not offer falls
 *  back to its default (a Type A hairstyle is not on the Type B head), and one
 *  still on the OLD type's default was never made, so it follows the body to
 *  the new type's default too. The body size carries over. */
export function setBodyType(a: WocFaceAppearance, gender: 'male' | 'female'): WocFaceAppearance {
  if (a.gender === gender) return a;
  const from = WOC_HEAD_TYPES[headTypeOf(a)].defaults;
  const to = WOC_HEAD_TYPES[wocHeadTypeForGender(gender)].defaults;
  const untouched: Partial<Pick<WocFaceAppearance, WocHeadIdField | 'headPiercing'>> = {};
  for (const slot of WOC_HEAD_SLOTS) {
    const field = SLOT_FIELD[slot];
    if (a[field] === from[slot]) untouched[field] = to[slot];
  }
  if (a.headPiercing === from.piercing) untouched.headPiercing = to.piercing;
  return readFace({ ...a, gender, ...untouched, headBeard: to.beard });
}

/** Pick an option in an options section. */
export function pickOption(
  a: WocFaceAppearance,
  target: WocOptionTarget,
  id: string,
): WocFaceAppearance {
  if (target === 'bodyType') return setBodyType(a, id === 'female' ? 'female' : 'male');
  if (target === 'piercing') return readFace({ ...a, headPiercing: id });
  return readFace({ ...a, [SLOT_FIELD[target]]: id });
}

/** Apply a colour to one target. A hair colour change carries matching brows
 *  along, so "Match hair" stays true until the player breaks it on purpose.
 *  (Facial hair needs nothing here: it wears the hair colour.) */
export function setColor(
  a: WocFaceAppearance,
  target: WocColorTarget,
  hue: number,
  sat: number,
  light: number,
): WocFaceAppearance {
  switch (target) {
    case 'skin':
      return readFace({ ...a, skinHue: hue, skinSat: sat, skinLight: light });
    case 'eye':
      return readFace({ ...a, eyeHue: hue, eyeSat: sat, eyeLight: light });
    case 'brow':
      return readFace({ ...a, browHue: hue, browSat: sat, browLight: light });
    case 'hair': {
      const follow = browsMatchHair(a);
      return readFace({
        ...a,
        hairHue: hue,
        hairSat: sat,
        hairLight: light,
        ...(follow ? { browHue: hue, browSat: sat, browLight: light } : {}),
      });
    }
  }
}

/** Put the brows back on the hair colour. */
export function matchBrowsToHair(a: WocFaceAppearance): WocFaceAppearance {
  return readFace({ ...a, browHue: a.hairHue, browSat: a.hairSat, browLight: a.hairLight });
}

/** Set one face morph's STORED value (clamped to its range). */
export function setShape(a: WocFaceAppearance, k: WocHeadMorph, value: number): WocFaceAppearance {
  return readFace({ ...a, headShape: { ...a.headShape, [k]: value } });
}

/** Set the body size (clamped to WOC_BODY_SCALE_RANGE). */
export function setBodyScale(a: WocFaceAppearance, value: number): WocFaceAppearance {
  return readFace({ ...a, bodyScale: value });
}

/** Move any slider section's target to the value its slider SHOWS (the chin
 *  width is written back as the softness it is stored as). */
export function setSlider(
  a: WocFaceAppearance,
  target: WocSliderTarget,
  value: number,
): WocFaceAppearance {
  return target === 'bodyScale'
    ? setBodyScale(a, value)
    : setShape(a, target, morphShown(target, value));
}

/** Reset to the default look, keeping the body: its type AND its size (both
 *  live in the Body Type category, a pick about the character's frame rather
 *  than its face). */
export function resetFace(a: WocFaceAppearance): WocFaceAppearance {
  return readFace({ gender: a.gender, bodyScale: a.bodyScale });
}

/** A random look for the same body (type and size kept, as Reset keeps them).
 *  Colours come from the palettes (a random swatch reads as a choice, a random
 *  HSL reads as a bug); piercings and strong shape values stay the exception
 *  rather than the rule. Facial hair follows the owner's roll rule (Troy,
 *  2026-08-07, recorded on the KayKit beard in randomizeAppearance): facial
 *  hair is rolled for the male fit only, so a Type B roll is always clean
 *  shaven and a Type A roll comes out bearded about two times in three; the
 *  Facial Hair list still offers every style to both. Every draw happens
 *  either way, so a seeded stream does not depend on the body type. */
export function randomizeFace(a: WocFaceAppearance, rand: () => number): WocFaceAppearance {
  const of = <T>(xs: readonly T[]): T =>
    xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
  const def = WOC_HEAD_TYPES[headTypeOf(a)];
  const skin = of(WOC_SKIN_TONES);
  const eye = of(WOC_EYE_COLORS);
  const hair = of(WOC_HAIR_COLORS);
  const browPick = of(WOC_HAIR_COLORS);
  const brow = rand() < 0.75 ? hair : browPick;
  const piercingRoll = rand();
  const piercingPick = of(WOC_PIERCING_IDS.filter((id) => id !== 'none'));
  const beardRoll = rand();
  const beardPick = of(def.slots.beard.filter((x) => x.id !== 'none'));
  const bearded = def.fit === 'male' && beardRoll >= 0.34;
  // off the rails like the KayKit face: up to 60% of the way to either end of
  // each control's range, measured from its default, rounded to the hundredth
  const shape = {} as WocHeadShape;
  for (const k of WOC_HEAD_MORPH_KEYS) {
    const r = WOC_HEAD_MORPH_RANGE[k];
    const push = rand() * 1.2 - 0.6;
    const v = push < 0 ? r.def + push * (r.def - r.min) : r.def + push * (r.max - r.def);
    shape[k] = Math.round(v * 100) / 100;
  }
  return readFace({
    gender: a.gender,
    bodyScale: a.bodyScale,
    skinHue: skin.hue,
    skinSat: skin.sat,
    skinLight: skin.light,
    eyeHue: eye.hue,
    eyeSat: eye.sat,
    eyeLight: eye.light,
    hairHue: hair.hue,
    hairSat: hair.sat,
    hairLight: hair.light,
    browHue: brow.hue,
    browSat: brow.sat,
    browLight: brow.light,
    headHair: of(def.slots.hair).id,
    headBeard: bearded ? beardPick.id : 'none',
    headNose: of(def.slots.nose).id,
    headMouth: of(def.slots.mouth).id,
    headBrows: of(def.slots.brows).id,
    headEars: of(def.slots.ears).id,
    headEyes: of(def.slots.eyes).id,
    headPiercing: piercingRoll < 0.6 ? 'none' : piercingPick,
    headShape: shape,
  });
}

// --- the menu's own state -------------------------------------------------------

export interface WocBuilderMenuState {
  /** the open category (the panel beside the menu shows its options) */
  readonly open: WocBuilderCategory;
}

export const INITIAL_MENU: WocBuilderMenuState = { open: 'bodyType' };

export function openCategory(
  _s: WocBuilderMenuState,
  cat: WocBuilderCategory,
): WocBuilderMenuState {
  return { open: cat };
}

/** Roving-focus movement through the menu (arrow keys, Home/End), through the
 *  shared roving helper every tablist and radio group in src/ui uses. */
export function stepCategory(cat: WocBuilderCategory, key: string): WocBuilderCategory | null {
  const list = WOC_BUILDER_CATEGORIES;
  const next = rovingTarget(key, list.indexOf(cat), list.length, 'both');
  return next === null ? null : list[next];
}

/** The one radio of a group that sits in the Tab order: the checked one, or
 *  the first when none is (a custom colour checks no swatch). */
export function rovingTabStop(checked: readonly boolean[]): number {
  const i = checked.indexOf(true);
  return i < 0 ? 0 : i;
}

// --- colour conversion for the custom control -------------------------------------

/** #rrggbb to stored HSL (hue 0..360, sat and light 0..1); null on junk. */
export function hexToHsl(hex: string): { hue: number; sat: number; light: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0, light };
  const sat = d / (1 - Math.abs(2 * light - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, sat: Math.min(1, sat), light };
}

/** Stored HSL to #rrggbb (the swatch fill and the custom control's value). */
export function hslToCss(hue: number, sat: number, light: number): string {
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = light - c / 2;
  const to = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
