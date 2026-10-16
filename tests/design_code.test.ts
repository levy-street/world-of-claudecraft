// The character design code: every changeable creator feature carries a
// stable named value, and a full look round-trips through the exported code.
import { describe, expect, it } from 'vitest';
import {
  DESIGN_CODE_HEADER,
  DESIGN_FIELDS,
  decodeDesignCode,
  encodeDesignCode,
} from '../src/render/characters/design_code_core';
import {
  BEARD_STYLES,
  BLUSH_SHADES,
  BROW_STYLES,
  DEFAULT_APPEARANCE,
  EAR_STYLES,
  EARRING_MATERIAL_IDS,
  EARRING_STYLES,
  EYE_STYLES,
  FACE_SLIDERS,
  HAIR_STYLES,
  LIP_SHADES,
  MOUTH_STYLES,
  type ModularAppearance,
  normalizeAppearance,
  OUTFIT_COLORWAY_IDS,
  randomizeAppearance,
  SHADOW_SHADES,
} from '../src/render/characters/modular';
import {
  resolveWocHeadLook,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  wocHeadSlotIds,
} from '../src/render/characters/woc_head_catalog';

/** Deterministic LCG so the randomized round trip is reproducible. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function decodeOk(code: string) {
  const r = decodeDesignCode(code);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} for: ${code}`);
  return r;
}

describe('design code field registry', () => {
  it('gives every changeable creator feature a stable wire id, pinned', () => {
    // This list IS the format: reordering is safe, renaming or removing an id
    // breaks every code players have saved. New features append new ids.
    expect(DESIGN_FIELDS.map((f) => f.id)).toEqual([
      'body',
      'skin',
      'eyes',
      'eyecol',
      'brows',
      'mouth',
      'ears',
      'lashes',
      'lashcol',
      'face',
      'hair',
      'haircol',
      'beard',
      'outfit',
      'lips',
      'blush',
      'shadow',
      'earrings',
      'jewel',
      'headhair',
      'headnose',
      'headmouth',
      'headbrows',
      'headears',
      'headeyes',
      'headpiercing',
      'browcol',
      'headshape',
      'headbeard',
      'size',
    ]);
  });

  it('emits every field id in the exported code, values included', () => {
    const code = encodeDesignCode(DEFAULT_APPEARANCE);
    expect(code.startsWith(`${DESIGN_CODE_HEADER}; `)).toBe(true);
    for (const f of DESIGN_FIELDS) {
      expect(code).toMatch(new RegExp(`(^|; )${f.id}=`));
    }
    // spot-check the value side is the human-readable spelling, not an index
    expect(code).toContain('body=male');
    expect(code).toContain('hair=crew');
    expect(code).toContain('skin=27/46/68');
  });
});

describe('design code drift guard', () => {
  // Which catalog list backs each string-valued appearance field. A NEW
  // string field lands here (and in DESIGN_FIELDS) or this guard reds.
  const ALT_STYLE: Partial<Record<keyof ModularAppearance, readonly string[]>> = {
    hair: HAIR_STYLES,
    beard: BEARD_STYLES,
    brows: BROW_STYLES,
    earrings: EARRING_STYLES,
    earringMaterial: EARRING_MATERIAL_IDS,
    mouth: MOUTH_STYLES,
    eyeShape: EYE_STYLES,
    ears: EAR_STYLES,
    lipstick: LIP_SHADES,
    blush: BLUSH_SHADES,
    eyeshadow: SHADOW_SHADES,
    outfit: OUTFIT_COLORWAY_IDS,
    headHair: wocHeadSlotIds('hair'),
    headNose: wocHeadSlotIds('nose'),
    headMouth: wocHeadSlotIds('mouth'),
    headBrows: wocHeadSlotIds('brows'),
    headEars: wocHeadSlotIds('ears'),
    headEyes: wocHeadSlotIds('eyes'),
    headPiercing: WOC_PIERCING_IDS,
    headBeard: wocHeadSlotIds('beard'),
  };

  it('round-trips a non-default value for EVERY appearance field except body', () => {
    // The both-ways guard the id pin alone cannot be: mutate each model
    // field in turn and prove the mutation survives encode -> decode. A
    // field added to ModularAppearance without a DESIGN_FIELDS entry decodes
    // back to its default here and fails, instead of silently never
    // exporting (the shape of tests/appearance_wire_bounds.test.ts).
    const d = normalizeAppearance(DEFAULT_APPEARANCE);
    for (const key of Object.keys(d) as (keyof ModularAppearance)[]) {
      if (key === 'body') continue; // Fit Studio data, deliberately not in the code
      const current = d[key];
      let mutated: ModularAppearance;
      if (key === 'face') {
        mutated = { ...d, face: { ...d.face, nose: 0.4 } };
      } else if (key === 'headShape') {
        mutated = { ...d, headShape: { ...d.headShape, eyeTilt: 0.4 } };
      } else if (typeof current === 'boolean') {
        mutated = { ...d, [key]: !current };
      } else if (typeof current === 'number') {
        const next = key.endsWith('Hue') ? (current + 40) % 360 : current === 0.33 ? 0.44 : 0.33;
        mutated = { ...d, [key]: next };
      } else if (key === 'gender') {
        mutated = { ...d, gender: d.gender === 'male' ? 'female' : 'male' };
      } else {
        const alts = ALT_STYLE[key];
        expect(
          alts,
          `no mutation known for '${key}': give it a DESIGN_FIELDS codec and an ALT_STYLE row`,
        ).toBeDefined();
        mutated = { ...d, [key]: alts?.find((o) => o !== current) };
      }
      mutated = normalizeAppearance(mutated);
      const r = decodeDesignCode(encodeDesignCode(mutated));
      if (!r.ok) throw new Error(`decode failed for mutated '${key}'`);
      expect(r.coerced, key).toEqual([]);
      const got =
        key === 'face'
          ? r.appearance.face.nose
          : key === 'headShape'
            ? r.appearance.headShape.eyeTilt
            : r.appearance[key];
      const want = key === 'face' || key === 'headShape' ? 0.4 : mutated[key];
      if (typeof want === 'number') {
        const eps = key.endsWith('Hue') ? 0.05 : 0.005;
        expect(Math.abs((got as number) - want), key).toBeLessThanOrEqual(eps);
      } else {
        expect(got, key).toBe(want);
      }
    }
  });
});

describe('design code round trip', () => {
  const expectSameLook = (a: ModularAppearance, b: ModularAppearance) => {
    // styles are exact
    for (const k of [
      'gender',
      'hair',
      'beard',
      'brows',
      'eyeShape',
      'ears',
      'mouth',
      'earrings',
      'earringMaterial',
      'lipstick',
      'blush',
      'eyeshadow',
      'outfit',
      'lashes',
      'headHair',
      'headNose',
      'headMouth',
      'headBrows',
      'headEars',
      'headEyes',
      'headPiercing',
      'headBeard',
    ] as const) {
      expect(b[k], k).toBe(a[k]);
    }
    // the body size survives the percent's one-decimal rounding
    expect(Math.abs(b.bodyScale - a.bodyScale), 'bodyScale').toBeLessThanOrEqual(0.0005);
    // colours survive within the encoder's one-decimal rounding
    for (const k of [
      'skinHue',
      'skinSat',
      'skinLight',
      'hairHue',
      'hairSat',
      'hairLight',
      'eyeHue',
      'eyeSat',
      'eyeLight',
      'lashHue',
      'lashSat',
      'lashLight',
      'browHue',
      'browSat',
      'browLight',
    ] as const) {
      const eps = k.endsWith('Hue') ? 0.05 : 0.0005;
      expect(Math.abs(b[k] - a[k]), k).toBeLessThanOrEqual(eps);
    }
    for (const k of FACE_SLIDERS) {
      expect(Math.abs((b.face[k] ?? 0) - (a.face[k] ?? 0)), `face.${k}`).toBeLessThanOrEqual(0.005);
    }
    for (const k of WOC_HEAD_MORPH_KEYS) {
      expect(Math.abs(b.headShape[k] - a.headShape[k]), `headShape.${k}`).toBeLessThanOrEqual(
        0.005,
      );
    }
  };

  it('reproduces the default look exactly', () => {
    const r = decodeOk(encodeDesignCode(DEFAULT_APPEARANCE));
    expectSameLook(normalizeAppearance(DEFAULT_APPEARANCE), r.appearance);
    expect(r.ignored).toEqual([]);
    expect(r.coerced).toEqual([]);
  });

  it('reproduces 25 seeded randomized looks', () => {
    let base = normalizeAppearance(DEFAULT_APPEARANCE);
    const rand = seededRand(0xc0ffee);
    for (let i = 0; i < 25; i++) {
      base = randomizeAppearance({ ...base, gender: i % 2 === 0 ? 'female' : 'male' }, rand);
      const r = decodeOk(encodeDesignCode(base));
      expectSameLook(base, r.appearance);
      expect(r.coerced, `iteration ${i}`).toEqual([]);
    }
  });

  it('round-trips the finishing-pass fields the randomizer never moves', () => {
    // randomizeAppearance pins the makeup rows to 'none' and never rolls the
    // outfit, so the 25-look test above proves nothing about these five.
    const app = normalizeAppearance({
      ...DEFAULT_APPEARANCE,
      outfit: 'crimson',
      lipstick: 'ruby',
      blush: 'peach',
      eyeshadow: 'smoke',
      earrings: 'hoop',
      earringMaterial: 'jade',
    });
    const r = decodeOk(encodeDesignCode(app));
    expect(r.appearance.outfit).toBe('crimson');
    expect(r.appearance.lipstick).toBe('ruby');
    expect(r.appearance.blush).toBe('peach');
    expect(r.appearance.eyeshadow).toBe('smoke');
    expect(r.appearance.earrings).toBe('hoop');
    expect(r.appearance.earringMaterial).toBe('jade');
    expect(r.coerced).toEqual([]);
  });

  it('round-trips a sculpted face through named slider values', () => {
    const app = normalizeAppearance({
      ...DEFAULT_APPEARANCE,
      face: { ...DEFAULT_APPEARANCE.face, nose: -0.4, jaw: 0.2 },
    });
    const code = encodeDesignCode(app);
    expect(code).toContain('face=nose:-40,jaw:20');
    const r = decodeOk(code);
    expect(r.appearance.face.nose).toBeCloseTo(-0.4, 3);
    expect(r.appearance.face.jaw).toBeCloseTo(0.2, 3);
    expect(r.appearance.face.chin).toBe(0);
  });

  it('round-trips a WOC head-builder look, piercing, brow colour and shape included', () => {
    const app = normalizeAppearance({
      ...DEFAULT_APPEARANCE,
      gender: 'female',
      headHair: 'ponytail',
      headNose: 'button',
      headMouth: 'relaxed',
      headBrows: 'straight',
      headEars: 'pointed',
      headEyes: 'hooded',
      headPiercing: 'septum',
      browHue: 210,
      browSat: 0.3,
      browLight: 0.62,
      // the chin at its own rest value (0.65): unmoved, so not written
      headShape: { eyeSpacing: -0.4, eyeSize: 0.25, eyeTilt: 0, browHeight: 1, chinWidth: 0.65 },
    });
    const code = encodeDesignCode(app);
    expect(code).toContain('headhair=ponytail');
    expect(code).toContain('headpiercing=septum');
    expect(code).toContain('browcol=210/30/62');
    // only the moved sliders, camelCase kept for readability
    expect(code).toContain('headshape=eyeSpacing:-40,eyeSize:25,browHeight:100');
    const r = decodeOk(code);
    expectSameLook(app, r.appearance);
    expect(r.coerced).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it('keeps a code minted before the head builder importing, on the default head', () => {
    // the exact shape of a shipped code: every field this build knew then
    const old =
      'WOC1; body=male; skin=27/46/68; eyes=almond; eyecol=28/42/18; brows=soft; ' +
      'mouth=neutral; ears=round; lashes=off; lashcol=26/50/24; face=nose:-40; hair=crew; ' +
      'haircol=0/80/40; beard=none; outfit=classic; lips=none; blush=none; shadow=none; ' +
      'earrings=none; jewel=default';
    const r = decodeOk(old);
    expect(r.ignored).toEqual([]);
    expect(r.coerced).toEqual([]);
    expect(r.appearance.face.nose).toBeCloseTo(-0.4, 3);
    expect(r.appearance.headHair).toBe(DEFAULT_APPEARANCE.headHair);
    expect(r.appearance.headPiercing).toBe('none');
    // every face control on the authored face: each its OWN rest value (the
    // chin 0.65), never a blanket 0
    for (const k of WOC_HEAD_MORPH_KEYS) {
      expect(r.appearance.headShape[k], k).toBe(WOC_HEAD_MORPH_RANGE[k].def);
    }
    // no beard or size field: the male body's own beard and the authored size
    expect(r.appearance.headBeard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    expect(r.appearance.bodyScale).toBe(1);
    // the code has no opinion on the brows, so they follow ITS hair (red),
    // not the default brown
    expect(r.appearance.browHue).toBe(0);
    expect(r.appearance.browSat).toBeCloseTo(0.8, 6);
    expect(r.appearance.browLight).toBeCloseTo(0.4, 6);
  });

  it('keeps a code minted before the beard, chin and size importing cleanly', () => {
    // yesterday's shape: the head builder's first nine ids, a four-control shape
    const old =
      'WOC1; body=female; headhair=braid; headnose=button; headbrows=soft; ' +
      'headpiercing=none; browcol=26/50/24; headshape=eyeSize:20';
    const r = decodeOk(old);
    expect(r.ignored).toEqual([]);
    expect(r.coerced).toEqual([]);
    expect(r.appearance.headShape.eyeSize).toBeCloseTo(0.2, 6);
    // the chin it never named sits on the authored chin, not on 0
    expect(r.appearance.headShape.chinWidth).toBe(0.65);
    // a Type B code with no beard field comes out clean shaven (her own
    // type's default), not wearing Type A's boxed beard
    expect(r.appearance.headBeard).toBe('none');
    expect(r.appearance.bodyScale).toBe(1);
  });

  it('round-trips the beard, the chin and the body size', () => {
    const app = normalizeAppearance({
      ...DEFAULT_APPEARANCE,
      headBeard: 'handlebar',
      headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 0 },
      bodyScale: 0.95,
    });
    const code = encodeDesignCode(app);
    expect(code).toContain('headbeard=handlebar');
    // the chin moved off its rest value, so it is written, 0 included
    expect(code).toContain('headshape=chinWidth:0');
    expect(code).toContain('size=95');
    const r = decodeOk(code);
    expect(r.coerced).toEqual([]);
    expect(r.appearance.headBeard).toBe('handlebar');
    expect(r.appearance.headShape.chinWidth).toBe(0);
    expect(r.appearance.bodyScale).toBeCloseTo(0.95, 6);
    // the authored look writes neither: the chin rests, the size is 100
    const plain = encodeDesignCode(DEFAULT_APPEARANCE);
    expect(plain).toContain('headshape=;');
    expect(plain).toContain('size=100');
    expect(plain).toContain('headbeard=boxed');
  });

  it('clamps an out-of-range size and reports it; a damaged one fails the paste', () => {
    const small = decodeOk('WOC1; size=50');
    expect(small.appearance.bodyScale).toBe(0.95);
    expect(small.coerced).toEqual(['size']);
    const tall = decodeOk('WOC1; size=180');
    expect(tall.appearance.bodyScale).toBe(1.05);
    expect(tall.coerced).toEqual(['size']);
    const fine = decodeOk('WOC1; size=97.5');
    expect(fine.appearance.bodyScale).toBeCloseTo(0.975, 6);
    expect(fine.coerced).toEqual([]);
    expect(decodeOk('WOC1; headbeard=wizard').coerced).toEqual(['headbeard']);
    for (const bad of ['WOC1; size=', 'WOC1; size=big', 'WOC1; size=-80', 'WOC1; size=8e1']) {
      expect(decodeDesignCode(bad), bad).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it("keeps another head type's pick: it resolves per body at render time", () => {
    // Type B's bob on a Type A (male) body: a stored value, not damage
    const r = decodeOk('WOC1; body=male; headhair=bob; headnose=button');
    expect(r.coerced).toEqual([]);
    expect(r.appearance.headHair).toBe('bob');
    expect(r.appearance.headNose).toBe('button');
    // The premise: the bob is still Type B's alone. The ponytail this case first
    // used is fitted onto the Type A head now (like the braid and the waves), and
    // a style both heads offer is simply drawn, so nothing falls back.
    expect(WOC_HEAD_TYPES.a.slots.hair.map((x) => x.id)).not.toContain('bob');
    const drawn = resolveWocHeadLook('a', { hair: r.appearance.headHair });
    expect(drawn.hair).toBe(WOC_HEAD_TYPES.a.defaults.hair);
  });

  it('coerces an unknown head pick and reports an unknown head-shape slider', () => {
    const r = decodeOk('WOC1; headhair=dreadlocks; headpiercing=tongue; headshape=wings:50');
    expect(r.coerced).toEqual(['headhair', 'headpiercing']);
    expect(r.ignored).toEqual(['headshape.wings']);
    expect(r.appearance.headHair).toBe(DEFAULT_APPEARANCE.headHair);
    expect(r.appearance.headPiercing).toBe('none');
  });

  it('reads head-shape slider names case-insensitively and clamps past the rails', () => {
    const r = decodeOk('WOC1; headshape=EYESPACING:30,eyetilt:-250');
    expect(r.appearance.headShape.eyeSpacing).toBeCloseTo(0.3, 6);
    expect(r.appearance.headShape.eyeTilt).toBe(-1);
    expect(r.coerced).toEqual(['headshape']);
  });

  it('never carries body proportions: a code neither exports nor imports them', () => {
    const shaped = normalizeAppearance({
      ...DEFAULT_APPEARANCE,
      body: { ...DEFAULT_APPEARANCE.body, shoulders: 0.5 },
    });
    const code = encodeDesignCode(shaped);
    expect(code).not.toContain('shoulders');
    const r = decodeOk(code);
    // the decoder hands back the neutral body; the CALLER keeps the current one
    expect(r.appearance.body.shoulders).toBe(0);
  });
});

describe('design code import tolerance', () => {
  it('accepts case, stray whitespace, line breaks, and a trailing separator', () => {
    const r = decodeOk('woc1;\n  BODY=Female ;\r\n hair=MOHAWK;');
    expect(r.appearance.gender).toBe('female');
    expect(r.appearance.hair).toBe('mohawk');
  });

  it('fills missing fields from the default look (a short code is a design)', () => {
    const r = decodeOk('WOC1; body=female');
    expect(r.appearance.gender).toBe('female');
    expect(r.appearance.hair).toBe(DEFAULT_APPEARANCE.hair);
    // the female standard applies when the code says nothing about lashes
    expect(r.appearance.lashes).toBe(true);
  });

  it('imports around an unknown field and reports it', () => {
    const r = decodeOk('WOC1; sparkle=9; hair=mohawk');
    expect(r.ignored).toEqual(['sparkle']);
    expect(r.appearance.hair).toBe('mohawk');
  });

  it('imports around a future field id carrying digits or underscores', () => {
    // Every shipped client is frozen with the token regex it was built with,
    // so an additive id a later build introduces (`hair2`) has to land in
    // `ignored` on an old one. Failing the whole paste would break the
    // format's forward-compat promise for codes that are otherwise fine.
    const r = decodeOk('WOC1; hair2=braided; skin_tone=1/2/3; hair=mohawk');
    expect(r.ignored).toEqual(['hair2', 'skin_tone']);
    expect(r.appearance.hair).toBe('mohawk');
  });

  it('imports around an unknown face slider and reports it', () => {
    const r = decodeOk('WOC1; face=nose:20,wings:50');
    expect(r.ignored).toEqual(['face.wings']);
    expect(r.appearance.face.nose).toBeCloseTo(0.2, 3);
  });

  it('falls back and reports coercion for an off-catalog style', () => {
    const r = decodeOk('WOC1; hair=notastyle');
    expect(r.coerced).toEqual(['hair']);
    expect(r.appearance.hair).toBe(DEFAULT_APPEARANCE.hair);
  });

  it('treats a wire-legal but unknown id (leading digit) as coercion, not damage', () => {
    // the value charset matches the wire's STYLE_ID_RE: what the server
    // could store must never turn the whole paste into "malformed"
    const r = decodeOk('WOC1; hair=9lives');
    expect(r.coerced).toEqual(['hair']);
    expect(r.appearance.hair).toBe(DEFAULT_APPEARANCE.hair);
  });

  it('clamps and reports coercion for an out-of-range colour', () => {
    // skin lightness floor is 0.12; 5% is below it
    const r = decodeOk('WOC1; skin=27/46/5');
    expect(r.coerced).toEqual(['skin']);
    expect(r.appearance.skinLight).toBe(0.12);
  });
});

describe('design code failures', () => {
  it.each([
    ['', 'empty'],
    ['   \n ', 'empty'],
    ['definitely not a code', 'header'],
    ['WOC2; body=male', 'version'],
    ['WOC1; body', 'malformed'],
    ['WOC1; skin=1/2', 'malformed'],
    ['WOC1; skin=a/b/c', 'malformed'],
    // a truncated component must not silently import as zero
    ['WOC1; skin=27//68', 'malformed'],
    // off the wire charset (STYLE_ID_RE has no hyphen): damaged, not coerced
    ['WOC1; hair=semi-bald', 'malformed'],
    ['WOC1; lashes=maybe', 'malformed'],
    ['WOC1; face=nose-40', 'malformed'],
    ['WOC1; headshape=eyeTilt=20', 'malformed'],
    ['WOC1; browcol=1/2', 'malformed'],
    ['WOC1; headhair=semi-bald', 'malformed'],
  ] as const)('rejects %j with reason %s', (code, reason) => {
    expect(decodeDesignCode(code)).toEqual({ ok: false, reason });
  });

  it('rejects a paste past the length cap before parsing it', () => {
    const r = decodeDesignCode(`WOC1; ${'x'.repeat(9000)}`);
    expect(r).toEqual({ ok: false, reason: 'malformed' });
  });
});
