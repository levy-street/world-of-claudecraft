// The WOC head builder's half of the stored look (ModularAppearance's head*
// fields, the brow colour and headShape): what normalizeAppearance keeps,
// what it clamps, what an old save turns into, and the rule that per-type
// validity is a RENDER-time call (resolveWocHeadLook), never a stored rewrite.
import { describe, expect, it } from 'vitest';
import {
  browColor,
  DEFAULT_APPEARANCE,
  hslToHex,
  type ModularAppearance,
  NEUTRAL_HEAD_SHAPE,
  normalizeAppearance,
  randomizeAppearance,
  WOC_BODY_SCALE_RANGE,
  wocBodyScaleOf,
  wocHeadLookOf,
} from '../src/render/characters/modular';
import {
  resolveWocHeadLook,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  wocHeadSlotIds,
  wocHeadTypeForGender,
} from '../src/render/characters/woc_head_catalog';
import { sanitizeAppearance } from '../src/world_api/appearance';

const HEAD_KEYS = {
  hair: 'headHair',
  beard: 'headBeard',
  nose: 'headNose',
  mouth: 'headMouth',
  brows: 'headBrows',
  ears: 'headEars',
  eyes: 'headEyes',
} as const;

describe('WOC head builder defaults', () => {
  it("starts every look on Type A's defaults, brows on the hair, the authored shape", () => {
    const a = normalizeAppearance(null);
    const defaults = WOC_HEAD_TYPES.a.defaults;
    expect(wocHeadLookOf(a)).toEqual(defaults);
    // the swept hairstyle (owner call 2026-10-01) and the authoring file's short boxed beard
    expect(a.headHair).toBe('swept');
    expect(a.headBeard).toBe('boxed');
    expect(a.headPiercing).toBe('none');
    expect([a.browHue, a.browSat, a.browLight]).toEqual([
      DEFAULT_APPEARANCE.hairHue,
      DEFAULT_APPEARANCE.hairSat,
      DEFAULT_APPEARANCE.hairLight,
    ]);
    // every control at its range default: the chin opens at 0.65, not 0
    expect(a.headShape).toEqual({
      eyeSpacing: 0,
      eyeSize: 0,
      eyeTilt: 0,
      browHeight: 0,
      chinWidth: 0.65,
    });
    expect(Object.keys(NEUTRAL_HEAD_SHAPE).sort()).toEqual([...WOC_HEAD_MORPH_KEYS].sort());
    for (const k of WOC_HEAD_MORPH_KEYS) {
      expect(NEUTRAL_HEAD_SHAPE[k], k).toBe(WOC_HEAD_MORPH_RANGE[k].def);
    }
    // the authored body size
    expect(a.bodyScale).toBe(1);
    expect(DEFAULT_APPEARANCE.bodyScale).toBe(WOC_BODY_SCALE_RANGE.def);
  });

  it('fills an old stored look (no head fields) with the defaults, brows following ITS hair', () => {
    // a real pre-head-builder row: custom red hair, no brow colour, no head
    const old = { gender: 'male', hair: 'crew', hairHue: 4, hairSat: 0.8, hairLight: 0.35 };
    const a = normalizeAppearance(old as Partial<ModularAppearance>);
    expect(wocHeadLookOf(a)).toEqual(WOC_HEAD_TYPES.a.defaults);
    expect(a.headShape).toEqual(NEUTRAL_HEAD_SHAPE);
    expect(a.bodyScale).toBe(1);
    expect([a.browHue, a.browSat, a.browLight]).toEqual([4, 0.8, 0.35]);
    // ...and each channel follows on its own, so a partial brow colour keeps
    // what it has
    const partial = normalizeAppearance({ ...old, browHue: 200 } as Partial<ModularAppearance>);
    expect([partial.browHue, partial.browSat, partial.browLight]).toEqual([200, 0.8, 0.35]);
  });

  it("fills a missing pick from the body's OWN type, so an old Type B look grows no beard", () => {
    // Both types offer every beard, so a Type A fallback would keep: a female
    // look saved before the beard slot existed must come out clean shaven.
    const oldFemale = normalizeAppearance({ gender: 'female', hair: 'pixie' });
    expect(oldFemale.headBeard).toBe(WOC_HEAD_TYPES.b.defaults.beard);
    expect(oldFemale.headBeard).toBe('none');
    expect(wocHeadLookOf(oldFemale)).toEqual(WOC_HEAD_TYPES.b.defaults);
    // ...and the male one opens on Type A's own beard
    expect(normalizeAppearance({ gender: 'male' }).headBeard).toBe('boxed');
    // a real pick is kept on either body: the builder offers every beard to both
    expect(normalizeAppearance({ gender: 'female', headBeard: 'goatee' }).headBeard).toBe('goatee');
    expect(normalizeAppearance({ gender: 'male', headBeard: 'none' }).headBeard).toBe('none');
  });

  it('is a fixed point: a normalized look normalizes to itself', () => {
    const a = normalizeAppearance({
      headHair: 'braid',
      headBeard: 'chops',
      headShape: { ...NEUTRAL_HEAD_SHAPE, eyeTilt: 0.5, chinWidth: 0.1 },
      bodyScale: 0.95,
    });
    expect(normalizeAppearance(a)).toEqual(a);
  });
});

describe('WOC head builder picks', () => {
  it('keeps every id some head type offers, in every slot', () => {
    for (const slot of WOC_HEAD_SLOTS) {
      for (const id of wocHeadSlotIds(slot)) {
        const a = normalizeAppearance({ [HEAD_KEYS[slot]]: id });
        expect(a[HEAD_KEYS[slot]], `${slot}=${id}`).toBe(id);
      }
    }
    for (const id of WOC_PIERCING_IDS) {
      expect(normalizeAppearance({ headPiercing: id }).headPiercing).toBe(id);
    }
  });

  it('falls back to the default on junk, per slot, never throwing', () => {
    for (const junk of ['spiky', 'SWEPT', '', 'x'.repeat(40), 42, null, {}, ['swept'], true]) {
      const raw = Object.fromEntries(
        [...Object.values(HEAD_KEYS), 'headPiercing'].map((k) => [k, junk]),
      );
      const a = normalizeAppearance(raw as Partial<ModularAppearance>);
      expect(wocHeadLookOf(a), JSON.stringify(junk)).toEqual(WOC_HEAD_TYPES.a.defaults);
    }
    // a retired KayKit id stored in a head field is junk to the head builder
    expect(normalizeAppearance({ headHair: 'crew' }).headHair).toBe(WOC_HEAD_TYPES.a.defaults.hair);
    expect(normalizeAppearance({ headPiercing: 'tongue' }).headPiercing).toBe('none');
    // the KayKit beard ids are not WOC beards either ('stubble', 'full')
    expect(normalizeAppearance({ headBeard: 'stubble' }).headBeard).toBe('boxed');
    expect(normalizeAppearance({ gender: 'female', headBeard: 'full' }).headBeard).toBe('none');
  });

  it('keeps a Type B pick on a male (Type A) body; the renderer resolves it', () => {
    const a = normalizeAppearance({
      gender: 'male',
      headHair: 'curls',
      headNose: 'button',
      headEars: 'pointed',
    });
    // stored as picked: a body-type switch must never rewrite the choice
    expect(a.headHair).toBe('curls');
    expect(a.headNose).toBe('button');
    // drawn on the worn type: Type A has no curly updo or button nose, so those
    // fall back to its defaults, and the pointed ears both types share survive
    const onA = resolveWocHeadLook(wocHeadTypeForGender(a.gender), wocHeadLookOf(a));
    expect(onA.hair).toBe(WOC_HEAD_TYPES.a.defaults.hair);
    expect(onA.nose).toBe('default');
    expect(onA.ears).toBe('pointed');
    // switching the body to Type B brings the stored pick straight back
    const onB = resolveWocHeadLook(wocHeadTypeForGender('female'), wocHeadLookOf(a));
    expect(onB.hair).toBe('curls');
    expect(onB.nose).toBe('button');
  });
});

describe('WOC head builder numbers', () => {
  it('clamps the brow colour to the hair ranges', () => {
    const a = normalizeAppearance({ browHue: 1e9, browSat: -3, browLight: 0 });
    expect(a.browHue).toBe(360);
    expect(a.browSat).toBe(0);
    expect(a.browLight).toBe(0.02);
    const b = normalizeAppearance({ browHue: -5, browSat: 7, browLight: 2 });
    expect([b.browHue, b.browSat, b.browLight]).toEqual([0, 1, 0.95]);
  });

  it('treats a non-finite or non-numeric brow channel as absent (it follows the hair)', () => {
    const a = normalizeAppearance({
      hairHue: 90,
      browHue: Number.NaN,
      browSat: Number.POSITIVE_INFINITY,
      browLight: '0.5' as unknown as number,
    });
    expect([a.browHue, a.browSat, a.browLight]).toEqual([90, a.hairSat, a.hairLight]);
  });

  it('clamps every head-shape control to its OWN range and drops anything else', () => {
    const a = normalizeAppearance({
      headShape: {
        eyeSpacing: 5,
        eyeSize: -9,
        eyeTilt: Number.NaN,
        browHeight: 0.25,
        jaw: 1,
      } as unknown as ModularAppearance['headShape'],
    });
    // the chin was never given: its own default, not 0
    expect(a.headShape).toEqual({
      eyeSpacing: 1,
      eyeSize: -1,
      eyeTilt: 0,
      browHeight: 0.25,
      chinWidth: 0.65,
    });
    // the chin only softens: 0..1, so a negative clamps to the sculpted chin
    const chin = (v: unknown) =>
      normalizeAppearance({
        headShape: { chinWidth: v } as unknown as ModularAppearance['headShape'],
      }).headShape.chinWidth;
    expect(chin(-0.5)).toBe(0);
    expect(chin(3)).toBe(1);
    expect(chin(0.3)).toBe(0.3);
    expect(chin(Number.NaN)).toBe(0.65);
    expect(chin('0.3')).toBe(0.65);
    // the table is the authority: every control clamps to exactly its row
    for (const k of WOC_HEAD_MORPH_KEYS) {
      const r = WOC_HEAD_MORPH_RANGE[k];
      const at = (v: number) =>
        normalizeAppearance({ headShape: { [k]: v } as unknown as ModularAppearance['headShape'] })
          .headShape[k];
      expect(at(-1e6), `${k} floor`).toBe(r.min);
      expect(at(1e6), `${k} ceiling`).toBe(r.max);
    }
    // a map that is not a map is the neutral shape
    for (const junk of [null, 'eyeTilt', 3, [0.5]]) {
      const b = normalizeAppearance({
        headShape: junk as unknown as ModularAppearance['headShape'],
      });
      expect(b.headShape, JSON.stringify(junk)).toEqual(NEUTRAL_HEAD_SHAPE);
    }
  });

  it('clamps the body size to 0.95..1.05 (5% either way), the authored size for junk', () => {
    const size = (v: unknown) =>
      normalizeAppearance({ bodyScale: v } as unknown as Partial<ModularAppearance>).bodyScale;
    expect(size(0.95)).toBe(0.95);
    expect(size(1.05)).toBe(1.05);
    expect(size(1)).toBe(1);
    expect(size(0.5)).toBe(0.95);
    expect(size(-3)).toBe(0.95);
    expect(size(1.4)).toBe(1.05);
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, '0.9', null, {}, true]) {
      expect(size(junk), JSON.stringify(junk)).toBe(1);
    }
    expect([WOC_BODY_SCALE_RANGE.min, WOC_BODY_SCALE_RANGE.max]).toEqual([0.95, 1.05]);
    // the normal height is the default and sits in the middle of the slider
    expect(WOC_BODY_SCALE_RANGE.def).toBe(1);
    // the per-frame read agrees with the normalizer on a raw wire record
    expect(wocBodyScaleOf({ bodyScale: 0.97 })).toBe(0.97);
    expect(wocBodyScaleOf({ bodyScale: 1.03 })).toBe(1.03);
    expect(wocBodyScaleOf({ bodyScale: 0.1 })).toBe(0.95);
    expect(wocBodyScaleOf({ bodyScale: '0.85' })).toBe(1);
    expect(wocBodyScaleOf(null)).toBe(1);
    expect(wocBodyScaleOf(undefined)).toBe(1);
    expect(wocBodyScaleOf({})).toBe(1);
  });

  it('tints the brows from the brow colour, not the hair', () => {
    const a = normalizeAppearance({ hairHue: 30, browHue: 220, browSat: 0.6, browLight: 0.4 });
    expect(browColor(a)).toBe(hslToHex(220, 0.6, 0.4));
    expect(browColor(a)).not.toBe(hslToHex(a.hairHue, a.hairSat, a.hairLight));
  });
});

describe('WOC head builder on the wire', () => {
  it('survives sanitize then normalize unchanged (the relog path)', () => {
    const a = normalizeAppearance({
      gender: 'female',
      headHair: 'braid',
      headMouth: 'full',
      headPiercing: 'ears',
      headBeard: 'moustache',
      browHue: 300,
      browSat: 0.2,
      browLight: 0.7,
      headShape: {
        eyeSpacing: 0.1,
        eyeSize: -0.2,
        eyeTilt: 0.3,
        browHeight: -0.4,
        chinWidth: 0.2,
      },
      bodyScale: 0.97,
    });
    const stored = sanitizeAppearance(JSON.parse(JSON.stringify(a)));
    expect(normalizeAppearance(stored as Partial<ModularAppearance>)).toEqual(a);
    // the three newest fields really rode the wire (not refilled by defaults)
    expect(stored?.headBeard).toBe('moustache');
    expect(stored?.bodyScale).toBe(0.97);
    expect((stored?.headShape as Record<string, number> | undefined)?.chinWidth).toBe(0.2);
  });
});

describe('randomizeAppearance and the WOC head', () => {
  const seeded = (start = 0.123) => {
    let s = start;
    return () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    };
  };

  it("rolls the head from the body's own type, always a renderable look", () => {
    const rand = seeded(0.618);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const gender = i % 2 === 0 ? 'female' : 'male';
      const a = randomizeAppearance(normalizeAppearance({ gender }), rand);
      const type = wocHeadTypeForGender(gender);
      // own-type ids only: resolving against the worn type changes nothing
      expect(resolveWocHeadLook(type, wocHeadLookOf(a))).toEqual(wocHeadLookOf(a));
      expect(normalizeAppearance(a)).toEqual(a);
      for (const k of WOC_HEAD_MORPH_KEYS) expect(Math.abs(a.headShape[k])).toBeLessThanOrEqual(1);
      seen.add(`${gender}:${a.headHair}`);
    }
    // the dice reach the whole of each type's hair list
    for (const type of ['a', 'b'] as const) {
      const gender = WOC_HEAD_TYPES[type].fit;
      for (const v of WOC_HEAD_TYPES[type].slots.hair) {
        expect(seen.has(`${gender}:${v.id}`), `${gender} rolls ${v.id}`).toBe(true);
      }
    }
  });

  it('usually matches the brows to the rolled hair, and rolls piercings as a minority', () => {
    const rand = seeded(0.271);
    let matched = 0;
    let pierced = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const a = randomizeAppearance(DEFAULT_APPEARANCE, rand);
      if (a.browHue === a.hairHue && a.browSat === a.hairSat && a.browLight === a.hairLight) {
        matched++;
      }
      if (a.headPiercing !== 'none') pierced++;
    }
    expect(matched / n).toBeGreaterThan(0.6);
    expect(matched).toBeLessThan(n);
    expect(pierced).toBeGreaterThan(0);
    expect(pierced / n).toBeLessThan(0.5);
  });

  it('rolls beards mostly on Type A, rarely on Type B, always a beard its type offers', () => {
    const rand = seeded(0.414);
    const n = 400;
    const bearded = { a: 0, b: 0 };
    const styles = new Set<string>();
    for (let i = 0; i < n; i++) {
      const gender = i % 2 === 0 ? 'female' : 'male';
      const a = randomizeAppearance(normalizeAppearance({ gender }), rand);
      const type = wocHeadTypeForGender(gender);
      expect(WOC_HEAD_TYPES[type].slots.beard.map((v) => v.id)).toContain(a.headBeard);
      if (a.headBeard !== 'none') {
        bearded[type]++;
        if (type === 'a') styles.add(a.headBeard);
      }
    }
    const half = n / 2;
    expect(bearded.a / half).toBeGreaterThan(0.6);
    expect(bearded.a).toBeLessThan(half);
    expect(bearded.b / half).toBeLessThan(0.15);
    // the Type A dice reach every beard style
    const all = WOC_HEAD_TYPES.a.slots.beard.filter((v) => v.id !== 'none');
    for (const v of all) expect(styles.has(v.id), `rolls ${v.id}`).toBe(true);
  });

  it('rolls the chin inside its own range and the body size mostly authored', () => {
    const rand = seeded(0.777);
    const n = 400;
    let resized = 0;
    const chins: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = randomizeAppearance(DEFAULT_APPEARANCE, rand);
      const chin = a.headShape.chinWidth;
      // the middle 60% of 0..1, off the rails like the other controls
      expect(chin).toBeGreaterThanOrEqual(0.2);
      expect(chin).toBeLessThanOrEqual(0.8);
      chins.push(chin);
      expect(a.bodyScale).toBeGreaterThanOrEqual(0.95);
      expect(a.bodyScale).toBeLessThanOrEqual(1.05);
      // on the slider's hundredth step
      expect(Math.round(a.bodyScale * 100) / 100).toBe(a.bodyScale);
      if (a.bodyScale !== 1) resized++;
    }
    // the chin really spans its band, not a constant
    expect(Math.max(...chins) - Math.min(...chins)).toBeGreaterThan(0.4);
    expect(resized).toBeGreaterThan(0);
    expect(resized / n).toBeLessThan(0.4);
  });

  it('rolls the head fresh, whatever head the base carried', () => {
    // the roll keeps only the body pick; a base's head is not an input
    const a = randomizeAppearance(DEFAULT_APPEARANCE, seeded(0.9));
    const b = randomizeAppearance(
      normalizeAppearance({
        headHair: 'mohawk',
        headBeard: 'long',
        headPiercing: 'full',
        browHue: 5,
        bodyScale: 0.95,
      }),
      seeded(0.9),
    );
    expect(b).toEqual(a);
  });
});
