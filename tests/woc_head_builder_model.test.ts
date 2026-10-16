import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, WOC_BODY_SCALE_RANGE } from '../src/render/characters/modular';
import {
  creationFocusPose,
  easeCamPose,
  FOCUS_EASE_SECONDS,
  PREVIEW_FRAMING,
} from '../src/render/characters/preview_framing';
import {
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
} from '../src/render/characters/woc_head_catalog';
import { hasTranslation } from '../src/ui/i18n';
import {
  browsMatchHair,
  categoryLabelKey,
  categorySections,
  EYE_BROW_MORPHS,
  FACE_MORPHS,
  focusForCategory,
  hexToHsl,
  hslToCss,
  matchBrowsToHair,
  matchSwatch,
  morphShown,
  pickOption,
  randomizeFace,
  readFace,
  resetFace,
  rovingTabStop,
  SLOT_FIELD,
  setBodyScale,
  setColor,
  setShape,
  setSlider,
  sliderFill,
  sliderReadout,
  stepCategory,
  targetColor,
  WOC_BUILDER_CATEGORIES,
  WOC_EYE_COLORS,
  WOC_HAIR_COLORS,
  WOC_SKIN_TONES,
  type WocBuilderSection,
  type WocFaceAppearance,
} from '../src/ui/woc_head_builder_model';

// The WOC face builder's view model: the menu, the per-type option lists, the
// sliders and their readouts, the transitions, and the creation camera focus
// it drives.

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

type Of<K extends WocBuilderSection['kind']> = Extract<WocBuilderSection, { kind: K }>;
function only<K extends WocBuilderSection['kind']>(s: WocBuilderSection, kind: K): Of<K> {
  if (s.kind !== kind) throw new Error(`expected a ${kind} section, got ${s.kind}`);
  return s as Of<K>;
}
const sliders = (ss: readonly WocBuilderSection[]) =>
  ss.filter((s): s is Of<'slider'> => s.kind === 'slider');

describe('menu', () => {
  it('lists the categories in the creator order, Facial Hair after Hairstyle', () => {
    expect(WOC_BUILDER_CATEGORIES).toEqual([
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
    ]);
  });

  it('frames the body for the body pick and the face for everything else', () => {
    expect(focusForCategory('bodyType')).toBe('body');
    expect(focusForCategory(null)).toBe('body');
    for (const c of WOC_BUILDER_CATEGORIES.filter((c) => c !== 'bodyType')) {
      expect(focusForCategory(c)).toBe('face');
    }
    expect(focusForCategory('facialHair')).toBe('face');
  });

  it('roves the menu with arrows, Home and End, wrapping at the ends', () => {
    expect(stepCategory('bodyType', 'ArrowDown')).toBe('skinTone');
    expect(stepCategory('bodyType', 'ArrowUp')).toBe('piercings');
    expect(stepCategory('piercings', 'ArrowRight')).toBe('bodyType');
    expect(stepCategory('hairstyle', 'ArrowDown')).toBe('facialHair');
    expect(stepCategory('face', 'Home')).toBe('bodyType');
    expect(stepCategory('face', 'End')).toBe('piercings');
    expect(stepCategory('face', 'a')).toBeNull();
  });

  it('parks a radio group Tab stop on the checked radio', () => {
    expect(rovingTabStop([false, false, true, false])).toBe(2);
    // nothing checked (a custom colour): the first radio holds the stop
    expect(rovingTabStop([false, false, false])).toBe(0);
  });
});

describe('palettes', () => {
  it('ships 16 skin tones, porcelain to ebony, evenly stepped light to deep', () => {
    expect(WOC_SKIN_TONES).toHaveLength(16);
    expect(WOC_SKIN_TONES[0].id).toBe('porcelain');
    expect(WOC_SKIN_TONES.at(-1)?.id).toBe('ebony');
    expect(new Set(WOC_SKIN_TONES.map((s) => s.id)).size).toBe(16);
    for (let i = 1; i < WOC_SKIN_TONES.length; i++) {
      const step = WOC_SKIN_TONES[i - 1].light - WOC_SKIN_TONES[i].light;
      // well spaced: no two tones crowd each other, no gap swallows a tone
      expect(step).toBeGreaterThanOrEqual(0.035);
      expect(step).toBeLessThanOrEqual(0.07);
    }
    for (const s of WOC_SKIN_TONES) {
      // inside the stored skin clamp (normalizeAppearance: 0.12..0.95) and the
      // warm band a natural tone lives in
      expect(s.light).toBeGreaterThanOrEqual(0.12);
      expect(s.light).toBeLessThanOrEqual(0.95);
      expect(s.hue).toBeGreaterThanOrEqual(10);
      expect(s.hue).toBeLessThanOrEqual(45);
    }
  });

  it('ships 10 eye colours and 12 hair colours', () => {
    expect(WOC_EYE_COLORS).toHaveLength(10);
    expect(WOC_HAIR_COLORS).toHaveLength(12);
    const eyes = WOC_EYE_COLORS.map((s) => s.id);
    for (const want of ['green', 'blue', 'grey', 'hazel', 'brown', 'amber', 'violet']) {
      expect(eyes).toContain(want);
    }
    const hair = WOC_HAIR_COLORS.map((s) => s.id);
    expect(hair[0]).toBe('platinum');
    for (const want of ['black', 'auburn', 'red', 'silver']) expect(hair).toContain(want);
  });

  it('an untouched character lights a named swatch in every colour, never Custom', () => {
    // Custom is for a colour no preset names; the default look is a preset.
    const a = readFace({ ...DEFAULT_APPEARANCE });
    for (const cat of ['skinTone', 'eyeColor', 'hairColor'] as const) {
      const s = only(categorySections(cat, a)[0], 'swatches');
      expect(s.custom, cat).toBe(false);
      expect(
        s.swatches.filter((w) => w.selected),
        cat,
      ).toHaveLength(1);
    }
    const brow = only(categorySections('browColor', a)[0], 'swatches');
    expect(brow.matchHair).toBe(true);
    expect(brow.custom).toBe(false);
  });

  it('a swatch committed through the 8-bit custom control still reads as that swatch', () => {
    // the <input type=color> speaks #rrggbb only: dark swatches come back a
    // little off in HSL (eye darkBrown's hue 22 returns as 20.9) and must not
    // light Custom
    for (const palette of [WOC_SKIN_TONES, WOC_EYE_COLORS, WOC_HAIR_COLORS]) {
      for (const w of palette) {
        const back = hexToHsl(hslToCss(w.hue, w.sat, w.light))!;
        expect(matchSwatch(palette, back.hue, back.sat, back.light)?.id, w.id).toBe(w.id);
      }
    }
  });

  it('round-trips hex and HSL for the custom colour control', () => {
    for (const s of [...WOC_HAIR_COLORS, ...WOC_SKIN_TONES]) {
      const back = hexToHsl(hslToCss(s.hue, s.sat, s.light));
      expect(back).not.toBeNull();
      expect(hslToCss(back!.hue, back!.sat, back!.light)).toBe(hslToCss(s.hue, s.sat, s.light));
    }
    expect(hexToHsl('#ff0000')).toEqual({ hue: 0, sat: 1, light: 0.5 });
    expect(hexToHsl('nope')).toBeNull();
  });
});

describe('readFace', () => {
  it('fills defaults and resolves head ids for the body type', () => {
    const a = readFace({ gender: 'male' });
    expect(a.headHair).toBe(WOC_HEAD_TYPES.a.defaults.hair);
    expect(a.headBeard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    expect(a.headPiercing).toBe('none');
    expect(a.bodyScale).toBe(1);
    expect(a.headShape).toEqual({
      eyeSpacing: 0,
      eyeSize: 0,
      eyeTilt: 0,
      browHeight: 0,
      chinWidth: WOC_HEAD_MORPH_RANGE.chinWidth.def,
    });
    // a missing brow colour follows the hair
    expect(browsMatchHair(a)).toBe(true);
    expect(readFace({ gender: 'female' }).headBeard).toBe(WOC_HEAD_TYPES.b.defaults.beard);
  });

  it('drops a pick the head type does not offer, and junk', () => {
    const b = readFace({ gender: 'female', headHair: 'mohawk', headNose: 'zzz', headBeard: 'zzz' });
    expect(b.headHair).toBe(WOC_HEAD_TYPES.b.defaults.hair);
    expect(b.headNose).toBe('default');
    expect(b.headBeard).toBe('none');
  });

  it('clamps every face control to its own range and the body size to 95..105%', () => {
    const clamped = readFace({
      bodyScale: 0.5,
      headShape: {
        eyeSpacing: 5,
        eyeSize: -9,
        eyeTilt: 0.3,
        browHeight: Number.NaN,
        chinWidth: -0.4,
      },
    });
    expect(clamped.headShape).toEqual({
      eyeSpacing: 1,
      eyeSize: -1,
      eyeTilt: 0.3,
      browHeight: 0,
      // the chin only softens: below its floor is its floor
      chinWidth: 0,
    });
    expect(clamped.bodyScale).toBe(WOC_BODY_SCALE_RANGE.min);
    expect(readFace({ headShape: { chinWidth: 3 } as never }).headShape.chinWidth).toBe(1);
    expect(readFace({ bodyScale: 1.4 }).bodyScale).toBe(1.05);
    expect(readFace({ bodyScale: Number.NaN }).bodyScale).toBe(1);
    expect(readFace({ bodyScale: 0.97 }).bodyScale).toBe(0.97);
  });
});

describe('categorySections', () => {
  it('offers Type A and Type B with a decorative letter tile, never a gender label', () => {
    const [s] = categorySections('bodyType', readFace({ gender: 'female' }));
    const opts = only(s, 'options');
    expect(opts.options.map((o) => o.labelKey)).toEqual(['auth.bodyTypeA', 'auth.bodyTypeB']);
    expect(opts.options.map((o) => o.selected)).toEqual([false, true]);
    expect(opts.options.map((o) => o.glyphKey)).toEqual([
      'auth.wocBuilder.bodyGlyph.a',
      'auth.wocBuilder.bodyGlyph.b',
    ]);
  });

  it('puts a Body Size slider under the body pick, -5 .. 0 .. +5 in whole percents', () => {
    const ss = categorySections('bodyType', readFace({ bodyScale: 0.97 }));
    expect(ss.map((s) => s.kind)).toEqual(['options', 'slider']);
    const size = only(ss[1], 'slider');
    expect(size).toMatchObject({
      target: 'bodyScale',
      labelKey: 'auth.wocBuilder.slider.bodyScale',
      value: 0.97,
      min: 0.95,
      max: 1.05,
      step: 0.01,
      def: 1,
      readout: 'offset',
      ticks: [0.95, 1, 1.05],
    });
    // a fresh look starts on the normal height
    expect(only(categorySections('bodyType', readFace({}))[1], 'slider').value).toBe(1);
  });

  it('lists each head type its own hairstyles, the new ones included', () => {
    const hairA = only(categorySections('hairstyle', readFace({ gender: 'male' }))[0], 'options');
    const hairB = only(categorySections('hairstyle', readFace({ gender: 'female' }))[0], 'options');
    const a = hairA.options.map((o) => o.id);
    const b = hairB.options.map((o) => o.id);
    expect(a).toEqual(WOC_HEAD_TYPES.a.slots.hair.map((v) => v.id));
    expect(b).toEqual(WOC_HEAD_TYPES.b.slots.hair.map((v) => v.id));
    for (const id of ['quiff', 'undercut', 'topknot', 'shoulder', 'bald']) expect(a).toContain(id);
    for (const id of ['bob', 'crown', 'twins', 'curls', 'bald']) expect(b).toContain(id);
    expect(b).not.toContain('mohawk');
  });

  it('offers Facial Hair on both body types: Clean Shaven first, then the eight styles', () => {
    for (const gender of ['male', 'female'] as const) {
      const a = readFace({ gender });
      const [s, ...rest] = categorySections('facialHair', a);
      expect(rest).toEqual([]);
      const opts = only(s, 'options');
      expect(opts.target).toBe('beard');
      expect(opts.labelKey).toBeNull();
      expect(opts.options.map((o) => o.id)).toEqual([
        'none',
        'moustache',
        'handlebar',
        'goatee',
        'chin',
        'boxed',
        'long',
        'chops',
        'chinstrap',
      ]);
      expect(opts.options.filter((o) => o.selected).map((o) => o.id)).toEqual([a.headBeard]);
    }
  });

  it('builds Face from nose, lips and ears with the Chin Width slider under them, reading WIDTH', () => {
    const face = categorySections('face', readFace({}));
    expect(face.map((s) => (s.kind === 'options' ? s.target : s.kind))).toEqual([
      'nose',
      'mouth',
      'ears',
      'slider',
    ]);
    const chin = only(face[3], 'slider');
    // stored softness 0.65 (the authored chin) is shown as width 1 - 0.65
    expect(chin).toMatchObject({
      target: 'chinWidth',
      labelKey: 'auth.wocBuilder.slider.chinWidth',
      value: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      def: 0.35,
      readout: 'percent',
    });
    expect(sliderReadout(chin.readout, chin.value)).toBe('35%');
    // the widest jaw (softness 0) reads 100%, the softest chin (1) reads 0%
    const wide = only(
      categorySections('face', setShape(readFace({}), 'chinWidth', 0))[3],
      'slider',
    );
    expect(wide.value).toBe(1);
    const soft = only(
      categorySections('face', setShape(readFace({}), 'chinWidth', 1))[3],
      'slider',
    );
    expect(soft.value).toBe(0);
  });

  it('flips only the chin: the eye and brow controls show what they store', () => {
    expect(morphShown('chinWidth', 0.65)).toBe(0.35);
    expect(morphShown('chinWidth', morphShown('chinWidth', 0.2))).toBe(0.2);
    for (const k of EYE_BROW_MORPHS) expect(morphShown(k, -0.4)).toBe(-0.4);
  });

  it('builds Eyes and Brows from the eye and brow rows plus four signed sliders', () => {
    const eb = categorySections('eyesBrows', readFace({}));
    expect(sliders(eb).map((s) => s.target)).toEqual([
      'eyeSpacing',
      'eyeSize',
      'eyeTilt',
      'browHeight',
    ]);
    for (const s of sliders(eb)) {
      // whole-percent steps, so the input never snaps a stored value away from
      // the readout beside it
      expect(s).toMatchObject({ min: -1, max: 1, step: 0.01, def: 0, readout: 'signed' });
    }
  });

  it('places every face control in exactly one category (a new morph cannot go missing)', () => {
    const a = readFace({});
    const placed = WOC_BUILDER_CATEGORIES.flatMap((c) =>
      sliders(categorySections(c, a)).map((s) => s.target),
    );
    expect([...placed].sort()).toEqual([...WOC_HEAD_MORPH_KEYS, 'bodyScale'].sort());
    expect([...EYE_BROW_MORPHS, ...FACE_MORPHS].sort()).toEqual([...WOC_HEAD_MORPH_KEYS].sort());
  });

  it('marks a palette swatch, or custom for an off-palette colour, skin included', () => {
    const tone = WOC_SKIN_TONES[3];
    const on = only(
      categorySections(
        'skinTone',
        setColor(readFace({}), 'skin', tone.hue, tone.sat, tone.light),
      )[0],
      'swatches',
    );
    expect(on.swatches.filter((s) => s.selected).map((s) => s.id)).toEqual([tone.id]);
    expect(on.custom).toBe(false);
    const off = only(
      categorySections('skinTone', setColor(readFace({}), 'skin', 29, 0.41, 0.5))[0],
      'swatches',
    );
    expect(off.custom).toBe(true);
    expect(off.swatches.some((s) => s.selected)).toBe(false);
    const offHair = only(
      categorySections('hairColor', setColor(readFace({}), 'hair', 123, 0.33, 0.44))[0],
      'swatches',
    );
    expect(offHair.custom).toBe(true);
  });

  it('names the skin custom control apart from the other colours', () => {
    const a = readFace({});
    const aria = (cat: 'skinTone' | 'eyeColor' | 'hairColor' | 'browColor') =>
      only(categorySections(cat, a)[0], 'swatches').customLabelKey;
    expect(aria('skinTone')).toBe('auth.wocBuilder.customSkinAria');
    for (const cat of ['eyeColor', 'hairColor', 'browColor'] as const) {
      expect(aria(cat)).toBe('auth.wocBuilder.customColorAria');
    }
  });

  it('lists every piercing preset', () => {
    const [s] = categorySections('piercings', readFace({}));
    expect(only(s, 'options').options.map((o) => o.id)).toEqual([...WOC_PIERCING_IDS]);
  });
});

describe('slider readouts', () => {
  it('reads a signed control as its step from the sculpt, through the formatter', () => {
    expect(sliderReadout('signed', 0.2)).toBe('+20');
    expect(sliderReadout('signed', -0.35)).toBe('-35');
    expect(sliderReadout('signed', 0)).toBe('0');
    // a rounding to zero is zero, never "-0"
    expect(sliderReadout('signed', -0.001)).toBe('0');
    expect(sliderReadout('signed', 1)).toBe('+100');
  });

  it('reads the body size as its offset from the normal height, 0 in the middle', () => {
    expect(sliderReadout('offset', 1)).toBe('0');
    expect(sliderReadout('offset', 0.95)).toBe('-5');
    expect(sliderReadout('offset', 1.05)).toBe('+5');
    expect(sliderReadout('offset', 0.97)).toBe('-3');
    expect(sliderReadout('offset', 1.02)).toBe('+2');
  });

  it('reads the chin as a percentage', () => {
    expect(sliderReadout('percent', 0.65)).toBe('65%');
    expect(sliderReadout('percent', 0)).toBe('0%');
    expect(sliderReadout('percent', 0.8)).toBe('80%');
    expect(sliderReadout('percent', 0.87)).toBe('87%');
    expect(sliderReadout('percent', 1)).toBe('100%');
  });

  it('localizes the readout (the formatter, not string building)', async () => {
    const { formatNumber } = await import('../src/ui/i18n');
    // what fr_FR's percent looks like, spelled by Intl itself
    const fr = formatNumber(0.65, { style: 'percent', maximumFractionDigits: 0 }, 'fr_FR');
    expect(fr).not.toBe('65%');
    expect(fr.replace(/\s/g, '')).toBe('65%');
  });

  it('fills the track by where the value sits in its range', () => {
    expect(sliderFill({ min: -1, max: 1 }, 0)).toBe(50);
    expect(sliderFill({ min: 0.8, max: 1 }, 0.8)).toBe(0);
    expect(sliderFill({ min: 0.8, max: 1 }, 0.9)).toBeCloseTo(50, 6);
    expect(sliderFill({ min: 0, max: 1 }, 0.65)).toBeCloseTo(65, 6);
    expect(sliderFill({ min: 0, max: 1 }, 7)).toBe(100);
    expect(sliderFill({ min: 1, max: 1 }, 1)).toBe(0);
  });
});

describe('transitions', () => {
  it('a body-type switch keeps shared picks and the body size, and re-defaults the rest', () => {
    const a = pickOption(
      pickOption(setBodyScale(readFace({ gender: 'male' }), 0.96), 'hair', 'mohawk'),
      'ears',
      'pointed',
    );
    const b = pickOption(a, 'bodyType', 'female');
    expect(b.gender).toBe('female');
    // Type B has no mohawk: its default
    expect(b.headHair).toBe(WOC_HEAD_TYPES.b.defaults.hair);
    // pointed ears are on both heads: the pick survives the switch
    expect(b.headEars).toBe('pointed');
    expect(b.bodyScale).toBe(0.96);
    expect(pickOption(b, 'bodyType', 'female')).toBe(b);
  });

  it('facial hair always takes the new body type default on a switch, like the lashes', () => {
    // every beard is on both heads, yet a switch never carries one across:
    // Type B opens clean shaven and Type A on its boxed beard
    const bearded = pickOption(readFace({ gender: 'male' }), 'beard', 'long');
    expect(pickOption(bearded, 'bodyType', 'female').headBeard).toBe(
      WOC_HEAD_TYPES.b.defaults.beard,
    );
    const goatee = pickOption(readFace({ gender: 'female' }), 'beard', 'goatee');
    expect(pickOption(goatee, 'bodyType', 'male').headBeard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    // and a Type B pick made after the switch sticks
    const b = pickOption(pickOption(bearded, 'bodyType', 'female'), 'beard', 'chops');
    expect(b.headBeard).toBe('chops');
  });

  it('an untouched default follows the body: a fresh Type A switched to Type B is clean shaven', () => {
    // Every beard is on both heads, so a bare id check would carry Type A's
    // DEFAULT boxed beard onto Type B. A default is not a choice: it follows
    // the body. (Seen on the turntable: a plain Type B click grew a beard.)
    const a = readFace({ gender: 'male' });
    expect(a.headBeard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    const b = pickOption(a, 'bodyType', 'female');
    expect(b.headBeard).toBe(WOC_HEAD_TYPES.b.defaults.beard);
    // and back: the untouched clean shave takes Type A's default again
    expect(pickOption(b, 'bodyType', 'male').headBeard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    // every other slot sits on the new type's defaults too
    for (const slot of WOC_HEAD_SLOTS) {
      expect(b[SLOT_FIELD[slot]], slot).toBe(WOC_HEAD_TYPES.b.defaults[slot]);
    }
  });

  it('picks a facial hair style, and back to clean shaven', () => {
    const a = pickOption(readFace({ gender: 'female' }), 'beard', 'goatee');
    expect(a.headBeard).toBe('goatee');
    expect(pickOption(a, 'beard', 'none').headBeard).toBe('none');
    // an id no head offers is refused, not stored
    expect(pickOption(a, 'beard', 'braids').headBeard).toBe(WOC_HEAD_TYPES.b.defaults.beard);
  });

  it('moves any slider through one entry point, clamped to its own range', () => {
    const a = readFace({});
    expect(setSlider(a, 'bodyScale', 0.95).bodyScale).toBe(0.95);
    expect(setSlider(a, 'bodyScale', 0.2).bodyScale).toBe(0.95);
    expect(setSlider(a, 'bodyScale', 1.6).bodyScale).toBe(1.05);
    // the chin slider shows width; storage keeps the authored softness
    expect(setSlider(a, 'chinWidth', 0.3).headShape.chinWidth).toBe(0.7);
    expect(setSlider(a, 'chinWidth', 1).headShape.chinWidth).toBe(0);
    // past the widest is the widest (softness clamps at its floor)
    expect(setSlider(a, 'chinWidth', 2).headShape.chinWidth).toBe(0);
    expect(setSlider(a, 'chinWidth', -1).headShape.chinWidth).toBe(1);
    expect(setSlider(a, 'eyeTilt', -0.4).headShape.eyeTilt).toBe(-0.4);
    // one control moves, the rest hold
    const moved = setShape(a, 'chinWidth', 0.1);
    expect({ ...moved.headShape, chinWidth: a.headShape.chinWidth }).toEqual(a.headShape);
  });

  it('hair colour carries matching brows, not broken ones, and facial hair has no colour of its own', () => {
    const red = WOC_HAIR_COLORS.find((s) => s.id === 'red')!;
    const black = WOC_HAIR_COLORS.find((s) => s.id === 'black')!;
    const matched = setColor(readFace({}), 'hair', red.hue, red.sat, red.light);
    expect(browsMatchHair(matched)).toBe(true);
    expect(matched.browHue).toBe(red.hue);
    const broken = setColor(matched, 'brow', black.hue, black.sat, black.light);
    const moved = setColor(broken, 'hair', 44, 0.6, 0.62);
    expect(moved.browHue).toBe(black.hue);
    expect(browsMatchHair(matchBrowsToHair(moved))).toBe(true);
    // the renderer tints the beard with the hair colour: the model carries no
    // beard colour a Hair Color pick could leave behind
    expect(Object.keys(matched).filter((k) => /beard(Hue|Sat|Light)/i.test(k))).toEqual([]);
  });

  it('a custom skin tone lands and reads back as the colour the control shows', () => {
    const hsl = hexToHsl('#8d5a3b')!;
    const a = setColor(readFace({}), 'skin', hsl.hue, hsl.sat, hsl.light);
    const cur = targetColor(a, 'skin');
    expect(hslToCss(cur.hue, cur.sat, cur.light)).toBe('#8d5a3b');
    expect(only(categorySections('skinTone', a)[0], 'swatches').custom).toBe(true);
  });

  it('reset keeps the body type and the body size, and nothing else', () => {
    const edited = setShape(
      pickOption(
        pickOption(setBodyScale(readFace({ gender: 'female' }), 1.02), 'piercing', 'full'),
        'beard',
        'boxed',
      ),
      'chinWidth',
      0.1,
    );
    const r = resetFace(edited);
    expect(r).toEqual(readFace({ gender: 'female', bodyScale: 1.02 }));
    expect(r.bodyScale).toBe(1.02);
    expect(r.headBeard).toBe('none');
    expect(r.headShape.chinWidth).toBe(0.65);
    // and the reset look lights named swatches again
    expect(only(categorySections('skinTone', r)[0], 'swatches').custom).toBe(false);
  });

  it('randomize keeps the body and only rolls palette colours and offered ids', () => {
    const rand = seeded(7);
    const beardsA = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const base = setBodyScale(readFace({ gender: i % 2 ? 'female' : 'male' }), 0.97);
      const r = randomizeFace(base, rand);
      expect(r.gender).toBe(base.gender);
      expect(r.bodyScale).toBe(0.97);
      const def = WOC_HEAD_TYPES[r.gender === 'female' ? 'b' : 'a'];
      for (const slot of WOC_HEAD_SLOTS) {
        expect(def.slots[slot].map((v) => v.id)).toContain(r[SLOT_FIELD[slot]] as string);
      }
      expect(WOC_PIERCING_IDS).toContain(r.headPiercing);
      expect(WOC_SKIN_TONES.some((s) => s.hue === r.skinHue && s.light === r.skinLight)).toBe(true);
      // the owner rule: a Type B roll is always clean shaven
      if (r.gender === 'female') expect(r.headBeard).toBe('none');
      else beardsA.add(r.headBeard);
      for (const k of WOC_HEAD_MORPH_KEYS) {
        const range = WOC_HEAD_MORPH_RANGE[k];
        const v = r.headShape[k];
        expect(v).toBeGreaterThanOrEqual(range.def - 0.6 * (range.def - range.min) - 1e-9);
        expect(v).toBeLessThanOrEqual(range.def + 0.6 * (range.max - range.def) + 1e-9);
      }
    }
    // Type A rolls land both bearded and clean shaven
    expect(beardsA.has('none')).toBe(true);
    expect([...beardsA].filter((b) => b !== 'none').length).toBeGreaterThan(2);
  });

  it('a pierced roll always wears a piercing (the preset draw never lands on none)', () => {
    // draws 1..5 are the colours, 6 the pierced-or-not roll, 7 the preset pick
    let i = 0;
    const rand = () => {
      i++;
      if (i === 6) return 0.9; // pierced
      if (i === 7) return 0; // the first preset on offer
      return 0.5;
    };
    const r = randomizeFace(readFace({ gender: 'male' }), rand);
    expect(r.headPiercing).not.toBe('none');
    expect(r.headPiercing).toBe(WOC_PIERCING_IDS.filter((id) => id !== 'none')[0]);
  });

  it('randomize is a pure function of the stream', () => {
    const base = readFace({ gender: 'male' });
    expect(randomizeFace(base, seeded(42))).toEqual(randomizeFace(base, seeded(42)));
  });
});

describe('every key the builder renders exists in the English catalog', () => {
  it('categories, sections, sliders, options, swatches, glyphs and aria names', () => {
    const keys = new Set<string>();
    for (const cat of WOC_BUILDER_CATEGORIES) keys.add(categoryLabelKey(cat));
    for (const gender of ['male', 'female'] as const) {
      const a: WocFaceAppearance = readFace({ gender });
      for (const cat of WOC_BUILDER_CATEGORIES) {
        for (const s of categorySections(cat, a)) {
          if (s.labelKey) keys.add(s.labelKey);
          if (s.kind === 'options') {
            for (const o of s.options) {
              keys.add(o.labelKey);
              if (o.glyphKey) keys.add(o.glyphKey);
            }
          }
          if (s.kind === 'swatches') {
            keys.add(s.customLabelKey);
            for (const w of s.swatches) keys.add(w.labelKey);
          }
        }
      }
    }
    // every variant of every slot on both heads, whether a category lists it or not
    for (const def of Object.values(WOC_HEAD_TYPES)) {
      keys.add(def.labelKey);
      for (const slot of WOC_HEAD_SLOTS) for (const v of def.slots[slot]) keys.add(v.labelKey);
    }
    const missing = [...keys].filter((k) => !hasTranslation(k, 'en'));
    expect(missing).toEqual([]);
    // anti-vacuity: the new labels are among the ones checked
    for (const k of [
      'auth.wocBuilder.cat.facialHair',
      'auth.wocBuilder.slider.chinWidth',
      'auth.wocBuilder.slider.bodyScale',
      'auth.wocBuilder.customSkinAria',
      'auth.wocHead.beard.none',
      'auth.wocHead.hair.curls',
      'auth.wocHead.mouth.cupids_bow',
      'auth.wocHead.brows.soft_arch',
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });
});

describe('creation focus camera', () => {
  it('body focus is the sheet framing, centred', () => {
    const s = PREVIEW_FRAMING.sheet;
    expect(creationFocusPose('body', 1.6)).toEqual({ x: 0, y: s.y, z: s.z, lookY: s.lookY });
  });

  it('face focus closes in, aims near the head and slides the character right', () => {
    const f = creationFocusPose('face', 1.6);
    expect(f.z).toBeLessThan(2);
    expect(f.lookY).toBeGreaterThan(1.3);
    expect(f.lookY).toBeLessThan(1.72);
    // camera slid left = character right of centre
    expect(f.x).toBeLessThan(0);
  });

  it('a phone-sized stage frames the face tight and centred, landscape or portrait', () => {
    const headH = 0.63;
    const desk = creationFocusPose('face', 1.6, 2.64, headH, { w: 1440, h: 900 });
    const phone = creationFocusPose('face', 1.05, 2.64, headH, { w: 314, h: 300 });
    const sideways = creationFocusPose('face', 2.2, 2.64, headH, { w: 440, h: 200 });
    // closer than the desktop close-up on both phone stages
    expect(phone.z).toBeLessThan(desk.z);
    expect(sideways.z).toBeLessThan(desk.z);
    // centred: only the docked desktop stage slides the face clear of the editor
    expect(desk.x).toBeLessThan(0);
    expect(phone.x).toBe(0);
    expect(sideways.x).toBe(0);
    // the head fills most of a small stage: about 1.65 heads of frame height
    const tanV = Math.tan((45 / 2) * (Math.PI / 180));
    expect(2 * phone.z * tanV).toBeCloseTo(1.65 * headH, 6);
  });

  it('a phone stage (sticky, near square) keeps the face centred', () => {
    expect(creationFocusPose('face', 1.17).x).toBe(0);
  });

  it('a portrait stage backs off to fit the shoulders and stays centred', () => {
    const phone = creationFocusPose('face', 0.5);
    const desk = creationFocusPose('face', 1.6);
    expect(phone.z).toBeGreaterThan(desk.z);
    expect(phone.x).toBe(0);
  });

  it('eases with a smoothstep over the fraction, clamped at both ends', () => {
    const a = creationFocusPose('body', 1.6);
    const b = creationFocusPose('face', 1.6);
    expect(easeCamPose(a, b, 0)).toEqual(a);
    expect(easeCamPose(a, b, 1)).toEqual(b);
    expect(easeCamPose(a, b, 2)).toEqual(b);
    expect(easeCamPose(a, b, 0.5).z).toBeCloseTo((a.z + b.z) / 2, 6);
    expect(FOCUS_EASE_SECONDS).toBeCloseTo(0.45, 6);
  });
});
