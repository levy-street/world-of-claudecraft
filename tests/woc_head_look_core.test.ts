// The WOC head look core (src/render/characters/woc_head_look_core.ts): a
// stored appearance to the head a body draws. Every dimension of the key has a
// decisive arm, because the renderer skips all scene work on an equal key.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  browColor,
  DEFAULT_APPEARANCE,
  eyeColor,
  hairColor,
  skinColor,
} from '../src/render/characters/modular';
import { WOC_WARRIOR_MANIFEST } from '../src/render/characters/woc_character_manifest';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_MORPHS,
  WOC_HEAD_TYPES,
  wocHeadAllUrls,
} from '../src/render/characters/woc_head_catalog';
import {
  hexToLinear,
  srgbToLinear,
  WOC_BODY_SKIN_REF,
  WOC_HEAD_TINT_TABLE,
  wocBodySkinRef,
  wocHeadBaldCrownWeight,
  wocHeadHairFallbackRef,
  wocHeadLookFromAppearance,
  wocHeadPortraitSignature,
  wocHeadTintRef,
  wocWornHidesHair,
} from '../src/render/characters/woc_head_look_core';

describe('wocHeadLookFromAppearance', () => {
  it('wears the body pick type and its defaults for no record', () => {
    const none = wocHeadLookFromAppearance(null);
    expect(none.type).toBe('a');
    expect(none.look).toEqual(WOC_HEAD_TYPES.a.defaults);
    const female = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, gender: 'female' });
    expect(female.type).toBe('b');
    // Type A's stored hairstyle resolves to Type B's default on a Type B body
    expect(female.look.hair).toBe(WOC_HEAD_TYPES.b.defaults.hair);
  });

  it('pins the built body type over the record gender', () => {
    const s = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, gender: 'female' }, 'a');
    expect(s.type).toBe('a');
    expect(s.look.hair).toBe(WOC_HEAD_TYPES.a.defaults.hair);
  });

  it('keeps valid picks and drops junk', () => {
    const s = wocHeadLookFromAppearance({
      ...DEFAULT_APPEARANCE,
      headHair: 'mohawk',
      headNose: 'not-a-nose',
      headPiercing: 'full',
    });
    expect(s.look.hair).toBe('mohawk');
    expect(s.look.nose).toBe('default');
    expect(s.look.piercing).toBe('full');
  });

  it('clamps the face controls and drives exactly the worn hairstyle tuck', () => {
    const s = wocHeadLookFromAppearance({
      ...DEFAULT_APPEARANCE,
      headHair: 'long',
      headShape: { eyeSpacing: 4, eyeSize: -9, eyeTilt: 0.25, browHeight: Number.NaN },
    });
    expect(s.morphs.FS_Eyes_Spacing).toBe(1);
    expect(s.morphs.FS_Eyes_Size).toBe(-1);
    expect(s.morphs.FS_Eyes_Tilt).toBe(0.25);
    expect(s.morphs.FS_Brows_Height).toBe(0);
    expect(s.tuck).toBe('FS_Tuck_long');
    expect(s.morphs.FS_Tuck_long).toBe(1);
    expect(s.morphs.FS_Tuck_swept).toBe(0);
    expect(s.morphs.FS_Tuck_mohawk).toBe(0);
    const bald = wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, headHair: 'bald' });
    expect(bald.tuck).toBeNull();
    expect(bald.morphs.FS_Tuck_swept).toBe(0);
  });

  it('drives the chin by name inside its own 0..1 range, resting at 0.65', () => {
    expect(WOC_HEAD_MORPHS.chinWidth).toBe('FS_Chin_Softness');
    const at = (chinWidth: unknown) =>
      wocHeadLookFromAppearance({
        ...DEFAULT_APPEARANCE,
        headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth } as never,
      }).morphs.FS_Chin_Softness;
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
    expect(at(0.3)).toBe(0.3);
    // a one-way control: negative clamps to the sculpted chin, never pushes past it
    expect(at(-0.7)).toBe(0);
    expect(at(4)).toBe(1);
    expect(at(Number.NaN)).toBe(0.65);
    // no record at all wears the authored chin
    expect(wocHeadLookFromAppearance(null).morphs.FS_Chin_Softness).toBe(0.65);
    // every control is emitted, each at its own rest value by default
    const rest = wocHeadLookFromAppearance(null).morphs;
    for (const k of WOC_HEAD_MORPH_KEYS) {
      expect(rest[WOC_HEAD_MORPHS[k]], k).toBe(WOC_HEAD_MORPH_RANGE[k].def);
    }
  });

  it('wears the bald crown at full weight exactly while the look is bald', () => {
    expect(WOC_HEAD_BALD_CROWN_MORPH).toBe('FS_Bald_Crown');
    for (const type of ['a', 'b'] as const) {
      const gender = WOC_HEAD_TYPES[type].fit;
      const bald = wocHeadLookFromAppearance({ gender, headHair: 'bald' });
      expect(bald.morphs.FS_Bald_Crown, `${type} bald`).toBe(1);
      for (const v of WOC_HEAD_TYPES[type].slots.hair) {
        if (v.id === 'bald') continue;
        const styled = wocHeadLookFromAppearance({ gender, headHair: v.id });
        expect(styled.morphs.FS_Bald_Crown, `${type} ${v.id}`).toBe(0);
        // ...and the worn style's tuck is the one driven
        expect(styled.morphs[`FS_Tuck_${v.id}`], `${type} ${v.id} tuck`).toBe(1);
      }
    }
    // the helm rule is the dressing's input, the look alone never raises it
    expect(wocHeadBaldCrownWeight({ ...WOC_HEAD_TYPES.a.defaults, hair: 'bald' }, false)).toBe(1);
    expect(wocHeadBaldCrownWeight({ ...WOC_HEAD_TYPES.a.defaults, hair: 'long' }, false)).toBe(0);
    expect(wocHeadBaldCrownWeight({ ...WOC_HEAD_TYPES.a.defaults, hair: 'long' }, true)).toBe(1);
    expect(wocHeadBaldCrownWeight({ ...WOC_HEAD_TYPES.b.defaults, hair: 'bald' }, true)).toBe(1);
    // another type's bald pick resolving to this type's default is NOT bald
    expect(
      wocHeadLookFromAppearance({ gender: 'male', headHair: 'braid' }).morphs.FS_Bald_Crown,
    ).toBe(0);
  });

  it('resolves the beard per type: kept where offered, the type default otherwise', () => {
    expect(wocHeadLookFromAppearance({ gender: 'male', headBeard: 'chops' }).look.beard).toBe(
      'chops',
    );
    expect(wocHeadLookFromAppearance({ gender: 'female', headBeard: 'goatee' }).look.beard).toBe(
      'goatee',
    );
    expect(wocHeadLookFromAppearance({ gender: 'female' }).look.beard).toBe('none');
    expect(wocHeadLookFromAppearance({ gender: 'male' }).look.beard).toBe('boxed');
    expect(wocHeadLookFromAppearance(null).look.beard).toBe(WOC_HEAD_TYPES.a.defaults.beard);
    expect(wocHeadLookFromAppearance(null, 'b').look.beard).toBe(WOC_HEAD_TYPES.b.defaults.beard);
  });

  it('turns the stored colours into linear RGB through the modular helpers', () => {
    const app = { ...DEFAULT_APPEARANCE, hairHue: 8, hairSat: 0.85, hairLight: 0.42 };
    const s = wocHeadLookFromAppearance(app);
    expect(s.colors.hair).toEqual(hexToLinear(hairColor(app)));
    expect(s.colors.skin).toEqual(hexToLinear(skinColor(app)));
    expect(s.colors.eye).toEqual(hexToLinear(eyeColor(app)));
    expect(s.colors.brow).toEqual(hexToLinear(browColor(app)));
    // linear, not sRGB: a mid channel decodes darker
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });

  it('changes the key on every dimension and keeps it on an equal look', () => {
    const base = wocHeadLookFromAppearance(DEFAULT_APPEARANCE);
    expect(wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE }).key).toBe(base.key);
    const variants = [
      { headHair: 'long' },
      { headHair: 'bald' },
      { headBeard: 'goatee' },
      { headBeard: 'none' },
      { headNose: 'broad' },
      { headMouth: 'full' },
      { headBrows: 'slim' },
      { headEars: 'large' },
      { headEyes: 'hooded' },
      { headPiercing: 'lobes' },
      { headShape: { ...DEFAULT_APPEARANCE.headShape, eyeSize: 0.5 } },
      { headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth: 0.1 } },
      { skinHue: 10 },
      { hairLight: 0.6 },
      { eyeHue: 200 },
      { browHue: 120 },
      { gender: 'female' as const },
    ];
    for (const v of variants) {
      expect(
        wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, ...v }).key,
        JSON.stringify(v),
      ).not.toBe(base.key);
    }
    // the body size is not the head: it draws the same head (and never re-keys it)
    expect(wocHeadLookFromAppearance({ ...DEFAULT_APPEARANCE, bodyScale: 0.8 }).key).toBe(base.key);
  });
});

describe('wocWornHidesHair', () => {
  it('hides the hair exactly while a hair-hiding helm is worn', () => {
    expect(wocWornHidesHair(WOC_WARRIOR_MANIFEST, { head: 'original_helm' })).toBe(true);
    expect(wocWornHidesHair(WOC_WARRIOR_MANIFEST, { head: null })).toBe(false);
    expect(wocWornHidesHair(WOC_WARRIOR_MANIFEST, { chest: 'original_chest' })).toBe(false);
    // an item in the wrong slot never counts
    expect(wocWornHidesHair(WOC_WARRIOR_MANIFEST, { chest: 'original_helm' })).toBe(false);
  });
});

describe('wocHeadTintRef (the measured per-material references)', () => {
  it('reads an exact pack material first', () => {
    expect(wocHeadTintRef('a', 'hair_swept')).toEqual({
      role: 'hair',
      ref: [0.0184, 0.0184, 0.0184],
    });
    expect(wocHeadTintRef('b', 'hair_waves')?.ref[0]).toBe(0.0354);
    expect(wocHeadTintRef('b', 'skin_nose')?.ref).toEqual([0.4564, 0.2664, 0.1981]);
    // the new styles: strands and scalp cap measured apart, beards as hair
    expect(wocHeadTintRef('a', 'hair_topknot')?.ref[0]).toBe(0.1282);
    expect(wocHeadTintRef('a', 'hair_topknot_scalp')?.ref[0]).toBe(0.0907);
    expect(wocHeadTintRef('b', 'hair_crown_scalp')?.ref[0]).toBe(0.1145);
    expect(wocHeadTintRef('a', 'hair_beard_boxed')).toEqual({
      role: 'hair',
      ref: [0.0603, 0.0603, 0.0603],
    });
    expect(wocHeadTintRef('b', 'hair_beard_handlebar')?.ref[0]).toBe(0.0957);
    // Type B's ears and brows are measured per side
    expect(wocHeadTintRef('b', 'skin_ear_R')?.ref).not.toEqual(
      wocHeadTintRef('b', 'skin_ear_L')?.ref,
    );
    expect(wocHeadTintRef('b', 'brow_R')?.ref).not.toEqual(wocHeadTintRef('b', 'brow_L')?.ref);
  });

  it('falls back to the shared role row for an unmeasured piece, the head base for an eyelid', () => {
    expect(wocHeadTintRef('a', 'brow_unmeasured')).toBe(WOC_HEAD_TINT_TABLE.a.brow);
    expect(wocHeadTintRef('b', 'eye_unmeasured')).toBe(WOC_HEAD_TINT_TABLE.b.eye);
    // an eyelid shell uses its head's base, on both types, every shape and side
    for (const type of ['a', 'b'] as const) {
      for (const shape of ['default', 'almond', 'hooded']) {
        for (const side of ['L', 'R']) {
          expect(wocHeadTintRef(type, `skin_eyelid_${shape}_${side}`)).toBe(
            WOC_HEAD_TINT_TABLE[type].skin_head,
          );
        }
      }
    }
    expect(wocHeadTintRef('a', 'hair_unmeasured')?.role).toBe('hair');
  });

  it('tints an unmeasured hairstyle or beard against the MEDIAN measured hair, never zero', () => {
    for (const type of ['a', 'b'] as const) {
      const measured = Object.values(WOC_HEAD_TINT_TABLE[type])
        .filter((r) => r.role === 'hair')
        .map((r) => r.ref[0])
        .sort((x, y) => x - y);
      const fallback = wocHeadHairFallbackRef(type);
      expect(fallback?.role).toBe('hair');
      const l = fallback?.ref[0] ?? 0;
      // strictly inside the measured spread whenever there are three or more
      // styles: neither the darkest nor the brightest bake decides the guess
      expect(l).toBe(measured[Math.floor((measured.length - 1) / 2)]);
      if (measured.length >= 3) {
        expect(l).toBeGreaterThan(measured[0]);
        expect(l).toBeLessThan(measured[measured.length - 1]);
      }
      expect(l).toBeGreaterThan(0);
      // any hair_ material the table has not measured takes it, beards included
      expect(wocHeadTintRef(type, 'hair_zzz_not_exported')).toEqual(fallback);
      expect(wocHeadTintRef(type, 'hair_beard_zzz')).toEqual(fallback);
      // a measured one keeps its exact row
      const exact = Object.entries(WOC_HEAD_TINT_TABLE[type]).find(([, r]) => r.role === 'hair');
      if (exact) expect(wocHeadTintRef(type, exact[0])).toBe(exact[1]);
    }
  });

  it('leaves liner, metal and unknown materials untinted', () => {
    expect(wocHeadTintRef('b', 'liner_L')).toBeNull();
    expect(wocHeadTintRef('a', 'metal_gold')).toBeNull();
    expect(wocHeadTintRef('a', 'Material.001')).toBeNull();
  });

  it("maps the body skin from the body's OWN measured skin, not the head's", () => {
    expect(wocBodySkinRef('a')).toBe(WOC_BODY_SKIN_REF.a);
    expect(wocBodySkinRef('b')).toBe(WOC_BODY_SKIN_REF.b);
    for (const type of ['a', 'b'] as const) {
      expect(wocBodySkinRef(type).role).toBe('skin');
      // the body's own atlas: skin only where it is painted (woc_skin_tint_core.ts), where
      // no head row carries a surface
      expect(wocBodySkinRef(type).surface).toBe('suit');
      for (const [name, row] of Object.entries(WOC_HEAD_TINT_TABLE[type])) {
        expect(row.surface, name).toBeUndefined();
      }
      // a head repaint must not move the body: the two refs are independent rows
      expect(wocBodySkinRef(type)).not.toBe(WOC_HEAD_TINT_TABLE[type].skin_head);
      expect(Math.min(...wocBodySkinRef(type).ref)).toBeGreaterThan(0);
    }
  });
});

/** The material names a type's shipped head library draws, across its split files (each
 *  GLB's JSON chunk, woc_head_catalog.ts wocHeadAllUrls), or null before its export. */
function packMaterials(type: 'a' | 'b'): string[] | null {
  const files = wocHeadAllUrls(type).map((url) => `public/${url}`);
  if (!files.some((file) => existsSync(file))) return null;
  const out: string[] = [];
  for (const file of files) {
    const buf = readFileSync(file);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
      materials?: { name?: string }[];
    };
    out.push(...(json.materials ?? []).map((m) => m.name ?? ''));
  }
  return out;
}

describe('the tint table follows the shipped packs (drift guard)', () => {
  const eyelid = (name: string) => name.startsWith('skin_eyelid_');
  const tinted = (name: string) => /^(hair|brow|skin|eye)_/.test(name);

  it.each(['a', 'b'] as const)('measures every tinted material the Type %s pack ships', (type) => {
    const mats = packMaterials(type);
    if (!mats) return; // the pack has not been exported yet
    // an unmeasured material would still draw (the role fallback), but against a
    // guessed reference: every shipped hair_, brow_, eye_ and non-eyelid skin_
    // material gets its own measured row, and no eyelid ever does
    const missing = mats.filter((m) => tinted(m) && !eyelid(m) && !WOC_HEAD_TINT_TABLE[type][m]);
    expect(missing).toEqual([]);
    expect(Object.keys(WOC_HEAD_TINT_TABLE[type]).filter(eyelid)).toEqual([]);
  });

  it.each(['a', 'b'] as const)(
    "carries the export report's measured rows for Type %s exactly",
    (type) => {
      const file = 'scripts/assets/woc_character/woc_head_pack.report.json';
      if (!existsSync(file)) return;
      const report = JSON.parse(readFileSync(file, 'utf8')) as {
        types: Record<
          string,
          { tint_table_rows?: Record<string, { role: string; ref?: number[]; refLum?: number }> }
        >;
      };
      const rows = report.types[type]?.tint_table_rows;
      if (!rows) return; // an older report, measured before the rows existed
      for (const [name, row] of Object.entries(rows)) {
        if (eyelid(name)) continue; // deliberately on the head base (see the table's doc)
        const want = row.refLum !== undefined ? [row.refLum, row.refLum, row.refLum] : row.ref;
        expect(WOC_HEAD_TINT_TABLE[type][name], `${type}.${name}`).toEqual({
          role: row.role,
          ref: want,
        });
      }
    },
  );
});

describe('wocHeadPortraitSignature', () => {
  // Type B's default head is clean shaven: DEFAULT_APPEARANCE carries Type A's boxed
  // beard as an explicit pick, which a Type B body DRAWS (both types fit every beard)
  const female = {
    ...DEFAULT_APPEARANCE,
    gender: 'female',
    headBeard: WOC_HEAD_TYPES.b.defaults.beard,
  };

  it('answers empty for no appearance and for either type default head', () => {
    expect(wocHeadPortraitSignature(null, 'a')).toBe('');
    expect(wocHeadPortraitSignature(undefined, 'b')).toBe('');
    expect(wocHeadPortraitSignature(DEFAULT_APPEARANCE, 'a')).toBe('');
    expect(wocHeadPortraitSignature(female, 'b')).toBe('');
    // a pre-builder record (no head fields at all) wears the defaults too
    expect(wocHeadPortraitSignature({ gender: 'male' }, 'a')).toBe('');
  });

  it('names the type, every resolved look id, then morphs and colours', () => {
    const sig = wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long' }, 'a');
    const d = WOC_HEAD_TYPES.a.defaults;
    const ids = ['a', 'long', d.beard, d.nose, d.mouth, d.brows, d.ears, d.eyes, d.piercing];
    expect(sig.startsWith(`${ids.join('.')}.`)).toBe(true);
    // deterministic: equal inputs, equal signature, no colon (a key segment)
    expect(wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long' }, 'a')).toBe(sig);
    expect(sig.includes(':')).toBe(false);
  });

  it('resolves another type pick to this type default, as the drawn head does', () => {
    // 'long' is a Type A hairstyle: on a Type B body it draws B's default
    expect(wocHeadPortraitSignature({ ...female, headHair: 'long' }, 'b')).toBe('');
  });

  it('changes with every colour role, and ignores a sub-quantum colour nudge', () => {
    const base = wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long' }, 'a');
    const roles = [
      { skinLight: 0.8 },
      { eyeHue: 200, eyeSat: 0.9, eyeLight: 0.5 },
      { hairHue: 200, hairSat: 0.9, hairLight: 0.6 },
      { browHue: 200, browSat: 0.9, browLight: 0.6 },
    ];
    for (const r of roles) {
      const sig = wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long', ...r }, 'a');
      expect(sig, JSON.stringify(r)).not.toBe(base);
    }
    // a colour nudge far below one 5-bit level keeps the default's (empty) key
    const nudged = { ...DEFAULT_APPEARANCE, skinHue: DEFAULT_APPEARANCE.skinHue + 0.01 };
    expect(skinColor(nudged)).toBe(skinColor(DEFAULT_APPEARANCE));
    expect(wocHeadPortraitSignature(nudged, 'a')).toBe('');
  });

  it('quantizes each face control to 0.05 steps', () => {
    const [k] = WOC_HEAD_MORPH_KEYS;
    const at = (v: number) =>
      wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headShape: { [k]: v } }, 'a');
    expect(at(0.01)).toBe('');
    expect(at(0.3)).not.toBe('');
    expect(at(0.3)).toBe(at(0.31));
    expect(at(0.3)).not.toBe(at(0.35));
    expect(at(-1)).not.toBe(at(1));
  });

  it('names the facial hair: every beard is its own head, on either type', () => {
    const a = (headBeard: string) =>
      wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long', headBeard }, 'a');
    const b = (headBeard: string) => wocHeadPortraitSignature({ ...female, headBeard }, 'b');
    const beards = WOC_HEAD_TYPES.a.slots.beard.map((v) => v.id);
    expect(new Set(beards.map(a)).size).toBe(beards.length);
    // the resolved id rides the third segment, right after the hairstyle
    expect(a('long').split('.').slice(0, 3)).toEqual(['a', 'long', 'long']);
    // a Type B face is clean shaven by default, a Type A one is not
    expect(b('none')).toBe('');
    expect(b('goatee')).not.toBe('');
    expect(b('goatee').split('.')[2]).toBe('goatee');
    expect(wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headBeard: 'none' }, 'a')).not.toBe(
      '',
    );
    // a pre-beard record (no headBeard) wears its OWN type's default, not Type A's
    const preBeardB: Record<string, unknown> = { ...female };
    delete preBeardB.headBeard;
    expect(wocHeadPortraitSignature(preBeardB, 'b')).toBe('');
  });

  it('quantizes the chin width inside its own 0..1 range, resting at its default', () => {
    const chin = (chinWidth: number) =>
      wocHeadPortraitSignature(
        { ...DEFAULT_APPEARANCE, headShape: { ...DEFAULT_APPEARANCE.headShape, chinWidth } },
        'a',
      );
    expect(WOC_HEAD_MORPH_KEYS).toContain('chinWidth');
    expect(chin(WOC_HEAD_MORPH_RANGE.chinWidth.def)).toBe('');
    expect(chin(0.9)).not.toBe('');
    expect(chin(0.9)).toBe(chin(0.91));
    expect(chin(0.9)).not.toBe(chin(0.95));
    expect(chin(0)).not.toBe(chin(1));
    // out of range clamps into it, like the drawn morph
    expect(chin(-1)).toBe(chin(0));
    expect(chin(3)).toBe(chin(1));
  });

  it('leaves the body size out: a headshot frames the face the same at any body scale', () => {
    const at = (bodyScale: number) =>
      wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, headHair: 'long', bodyScale }, 'a');
    expect(at(0.8)).toBe(at(1));
    expect(at(0.9)).toBe(at(1));
    expect(wocHeadPortraitSignature({ ...DEFAULT_APPEARANCE, bodyScale: 0.8 }, 'a')).toBe('');
  });
});
