import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyModularSliderMorphs } from '../src/render/characters/assets';
import {
  type ClipMap,
  modularVisualKey,
  VISUALS,
  visualKeyFor,
} from '../src/render/characters/manifest';
import {
  ARMOR_DYE_BANDS,
  ARMOR_MATERIALS,
  ARMOR_SETS,
  allModularNodes,
  BEARD_STYLES,
  BODY_SLIDERS,
  BROW_STYLES,
  bandMaterialSpec,
  classArmorSet,
  DEFAULT_APPEARANCE,
  EAR_STYLES,
  EARRING_MATERIAL_IDS,
  EARRING_MATERIALS,
  EYE_STYLES,
  earringMaterialSpec,
  earringSwatchHex,
  FACE_SLIDERS,
  fullSet,
  HAIR_STYLES,
  hslToHex,
  isArmorMaterial,
  isLongHair,
  KNIGHT_FULL,
  MATERIAL_COLORWAY_IDS,
  MODULAR_WARRIOR_KEY,
  MORPH_SLIDER_TARGETS,
  MOUTH_STYLES,
  type ModularAppearance,
  modularBuildSignature,
  modularGeometryKey,
  modularPartNames,
  modularSignature,
  morphInfluences,
  NEUTRAL_FACE,
  normalizeAppearance,
  OUTFIT_COLORWAY_IDS,
  OUTFIT_COLORWAYS,
  outfitDye,
  outfitSwatchHex,
  outfitSwatchHexes,
  randomHairStyles,
  randomizeAppearance,
  slotCovered,
  stubbleDecalKey,
  stubbleDecals,
} from '../src/render/characters/modular';
import { UNDERHAIR } from '../src/render/characters/underhair.generated';
import type { PlayerClass } from '../src/sim/types';
import { ALL_CLASSES, isMechWearer } from '../src/sim/types';

const app = (over: Partial<ModularAppearance> = {}): ModularAppearance => ({
  ...DEFAULT_APPEARANCE,
  ...over,
});

describe('modularPartNames', () => {
  it('shows the bare body for every empty slot', () => {
    const parts = modularPartNames(app({ hair: 'bald', brows: 'none' }));
    // No lash part: the default body is male and lashes are the female
    // standard (see `defaultLashes`). The female's bare body is the same list
    // with F_ tags and her lash, asserted just below.
    expect(parts.sort()).toEqual(
      [
        'M_Ear_round',
        'M_Eye_almond',
        'M_Mouth_neutral',
        'M_ArmL',
        'M_ArmR',
        'M_FootL',
        'M_FootR',
        'M_HandL',
        'M_HandR',
        'M_Head',
        'M_LegL',
        'M_LegR',
        'M_Loin',
        'M_Torso',
      ].sort(),
    );
    // ...and the female's bare body is the same list F-tagged, plus the lash
    // once it is asked for. (Asked for explicitly here: `app()` spreads
    // DEFAULT_APPEARANCE, whose lashes:false is the MALE default and counts as
    // an opinion, the gender default only fills a value that is absent, which
    // is what the customizer's gender row and a fresh save go through.)
    const fem = modularPartNames(
      app({ gender: 'female', hair: 'bald', brows: 'none', lashes: true }),
    );
    expect(fem).toContain('F_Lash_almond');
    // every male part has an F-tagged twin; she also wears the chest wrap,
    // which the male body has no counterpart for
    for (const n of parts) expect(fem, n).toContain(n.replace(/^M_/, 'F_'));
    expect(fem).toContain('F_Top');
  });

  // Underclothing is REPLACED by armour rather than layered under it: worn
  // underneath a set of tassets it just pokes through them, and it has nothing
  // left to cover anyway.
  it('draws the underclothing only while its slot is bare', () => {
    const bare = modularPartNames(app());
    expect(bare).toContain('M_Loin');
    expect(modularPartNames(app(), KNIGHT_FULL)).not.toContain('M_Loin');
    expect(modularPartNames(app(), { legs: 'knight' })).not.toContain('M_Loin');
    // a set on some OTHER slot leaves it alone
    expect(modularPartNames(app(), { chest: 'knight' })).toContain('M_Loin');

    const f = app({ gender: 'female' });
    expect(modularPartNames(f)).toEqual(expect.arrayContaining(['F_Loin', 'F_Top']));
    // The chest wrap is the exception and answers to no slot: several sets are
    // cut open at the chest or the midriff, and replacing the wrap with them
    // puts a BARE chest under the gap rather than armour over the wrap.
    for (const set of ARMOR_SETS) {
      expect(modularPartNames(f, fullSet(set)), set).toContain('F_Top');
    }
    expect(modularPartNames(f, { chest: 'rogue' })).toContain('F_Top');
    // ...while the loincloth still goes: under tassets it just pokes through.
    expect(modularPartNames(f, { chest: 'rogue' })).toContain('F_Loin');
    expect(modularPartNames(f, { legs: 'rogue' })).not.toContain('F_Loin');
    expect(modularPartNames(f, KNIGHT_FULL)).not.toContain('F_Loin');
  });

  // A set with no piece for the slot does not cover it, so wearing the mage
  // must not strip the hands' underclothing logic of its meaning either.
  it('treats a slot a set has no piece for as uncovered', () => {
    expect(slotCovered({ hands: 'mage' }, 'hands')).toBe(false);
    expect(slotCovered({ hands: 'paladin' }, 'hands')).toBe(true);
    expect(slotCovered({ head: 'rogue' }, 'head')).toBe(false);
    expect(slotCovered({}, 'legs')).toBe(false);
  });

  it('layers armour OVER the body so skin shows through the gaps', () => {
    const parts = modularPartNames(app(), { chest: 'knight' });
    expect(parts).toContain('Armor_knight_Chest');
    // the torso stays: KayKit plate is open at the neck and waist, and hiding
    // the body there leaves see-through holes rather than skin
    expect(parts).toContain('M_Torso');
    expect(parts).toContain('M_ArmL');
    expect(parts).toContain('M_LegR');
  });

  it('layers the cape over the torso, `back` is the additive slot', () => {
    const parts = modularPartNames(app(), { back: 'knight' });
    expect(parts).toContain('Armor_knight_Back');
    expect(parts).toContain('M_Torso');
  });

  // Under a helm: hair and beard go (closed shell, they poke through), the EARS
  // go (the helm sits exactly where the ear is), the earrings go with the ear
  // they hang on -- but the BROWS stay, because every KayKit helm is open at the
  // face and a browless face behind a visor reads as a mannequin.
  it('drops hair, beard, ears and earrings under a helm but keeps the brows', () => {
    const look = app({
      hair: 'longpart',
      brows: 'thick',
      beard: 'full',
      earrings: 'hoop',
      ears: 'pointed',
    });
    const bare = modularPartNames(look);
    expect(bare).toContain('H2_longpart');
    expect(bare).toContain('BI_full');
    expect(bare).toContain('E2_hoop');
    expect(bare).toContain('M_Ear_pointed');
    expect(bare).toContain('M_Brow_thick');

    const helmed = modularPartNames(look, { head: 'knight' });
    expect(helmed).toContain('Armor_knight_Head');
    expect(helmed).not.toContain('H2_longpart');
    expect(helmed).not.toContain('BI_full');
    expect(helmed).not.toContain('E2_hoop');
    expect(helmed).not.toContain('M_Ear_pointed');
    expect(helmed).toContain('M_Brow_thick');
    // the eyes are never hidden: no helm in the set covers them
    expect(helmed).toContain('M_Eye_almond');
    // the paladin bucket is the other closed shell and behaves identically
    const bucket = modularPartNames(look, { head: 'paladin' });
    expect(bucket).not.toContain('H2_longpart');
    expect(bucket).not.toContain('M_Ear_pointed');
  });

  // A HAT (the barbarian's bear hood, the mage's pointed hat) sits ON the head
  // rather than closing around it: the ears stay, the earrings on them stay,
  // and the beard stays. Hair follows the length rule: short cuts and updos
  // tuck away to nothing, long falls swap to `layered` hanging below the brim.
  it('keeps ears, earrings and beard under a hat; hair follows the length rule', () => {
    for (const set of ['barbarian', 'mage'] as const) {
      const short = modularPartNames(
        app({ hair: 'crewcut', beard: 'full', earrings: 'hoop', ears: 'pointed' }),
        { head: set },
      );
      expect(short, set).toContain('M_Ear_pointed');
      expect(short, set).toContain('E2_hoop');
      expect(short, set).toContain('BI_full');
      expect(short, set).not.toContain('H2_crewcut');
      expect(
        short.some((n) => n.startsWith('H2_')),
        set,
      ).toBe(false);

      const long = modularPartNames(app({ hair: 'longpart' }), { head: set });
      expect(long, set).not.toContain('H2_longpart');
      expect(long, set).toContain('H2_layered');
    }
    // every style resolves under a hat: long falls become layered, the rest
    // (decal cuts, short shells, updos) render no volume at all
    for (const hair of HAIR_STYLES) {
      const parts = modularPartNames(app({ hair }), { head: 'mage' });
      const h2 = parts.filter((n) => n.startsWith('H2_'));
      expect(h2, hair).toEqual(isLongHair(hair) ? ['H2_layered'] : []);
    }
  });

  // A set with no head piece is not "helmed", so none of the above applies.
  it('keeps the ears for a set that has no helm', () => {
    for (const set of ['druid', 'ranger', 'rogue'] as const) {
      const parts = modularPartNames(app({ ears: 'pointed', earrings: 'hoop' }), fullSet(set));
      expect(parts, set).toContain('M_Ear_pointed');
      expect(parts, set).toContain('E2_hoop');
    }
  });

  // Only some sets have headgear. Treating "the head slot is set" as "helmed"
  // would shave a rogue bald for wearing a set that has no helm at all.
  it('keeps the hair for a set with no head piece', () => {
    const look = app({ hair: 'longpart', brows: 'thick' });
    for (const set of ['druid', 'ranger', 'rogue'] as const) {
      const parts = modularPartNames(look, fullSet(set));
      expect(parts, set).toContain('H2_longpart');
      expect(parts, set).toContain('M_Brow_thick');
    }
  });

  it('shows the bare hands for the mage, whose hands KayKit models as flesh', () => {
    const parts = modularPartNames(app(), fullSet('mage'));
    expect(parts).toContain('M_HandL');
    expect(parts.some((n) => n.startsWith('Armor_mage_Hand'))).toBe(false);
    // ...but the sets that DO have gauntlets still get them
    expect(modularPartNames(app(), fullSet('paladin'))).toContain('Armor_paladin_HandL');
  });

  it('gives every set a distinct part list', () => {
    const keys = ARMOR_SETS.map((s) => modularGeometryKey(app(), fullSet(s)));
    expect(new Set(keys).size).toBe(ARMOR_SETS.length);
  });

  it('mixes slots from different sets', () => {
    const parts = modularPartNames(app(), { chest: 'paladin', legs: 'rogue', back: 'mage' });
    expect(parts).toContain('Armor_paladin_Chest');
    expect(parts).toContain('Armor_rogue_LegL');
    expect(parts).toContain('Armor_mage_Back');
  });

  it('emits the node for a hair style', () => {
    const parts = modularPartNames(app({ hair: 'warriorbraid' }));
    expect(parts).toContain('H2_warriorbraid');
  });

  it('switches the whole body between genders', () => {
    const f = modularPartNames(app({ gender: 'female' }));
    expect(f).toContain('F_Head');
    expect(f).toContain('F_Torso');
    expect(f.some((n) => n.startsWith('M_'))).toBe(false);
  });

  it('never repeats a part, for any set', () => {
    for (const set of ARMOR_SETS) {
      const parts = modularPartNames(app(), fullSet(set));
      expect(new Set(parts).size, set).toBe(parts.length);
    }
  });
});

describe('face morphs', () => {
  it('splits a signed slider across the up/down pair', () => {
    const m = morphInfluences(app({ face: { ...NEUTRAL_FACE, nose: 0.6, jaw: -0.4 } }));
    expect(m.get('nose_up')).toBeCloseTo(0.6);
    expect(m.has('nose_dn')).toBe(false);
    expect(m.get('jaw_dn')).toBeCloseTo(0.4);
    expect(m.has('jaw_up')).toBe(false);
  });

  it('emits nothing for a neutral face, so the default costs no morph work', () => {
    expect(morphInfluences(app()).size).toBe(0);
  });

  // The smirk was baked into the head mesh, so it was every character's resting
  // face. symmetrize_head() took it out; it is a slider like any other now.
  it('has a symmetric default and drives the smirk from a slider', () => {
    expect(morphInfluences(app()).has('smirk_up')).toBe(false);
    expect(
      morphInfluences(app({ face: { ...NEUTRAL_FACE, smirk: 0.7 } })).get('smirk_up'),
    ).toBeCloseTo(0.7);
  });

  it('scales the ears from the same slider mechanism', () => {
    expect(morphInfluences(app({ face: { ...NEUTRAL_FACE, ears: -1 } })).get('ears_dn')).toBe(1);
  });

  // The mouth stopped being a crease in the head and became its own part, so it
  // is a node SWAP now and must not leave a morph behind: `mouth_smile` still
  // exists on the shipped head (stubble.ts reads the mouth targets to find the
  // lips), and driving it as well would deform the face under the part.
  it('swaps the mouth as a part and drives no mouth morph', () => {
    for (const style of MOUTH_STYLES) {
      const parts = modularPartNames(app({ mouth: style }));
      expect(parts, style).toContain(`M_Mouth_${style}`);
      expect(
        parts.filter((p) => p.includes('Mouth_')),
        style,
      ).toHaveLength(1);
      expect(
        [...morphInfluences(app({ mouth: style })).keys()].filter((k) => k.startsWith('mouth_')),
      ).toEqual([]);
    }
    expect(modularPartNames(app({ gender: 'female', mouth: 'grin' }))).toContain('F_Mouth_grin');
  });

  it('falls back to neutral rather than naming a node the GLB has no part for', () => {
    expect(modularPartNames(app({ mouth: 'kiss' as never }))).toContain('M_Mouth_neutral');
  });

  it('clamps a corrupt stored value rather than emitting a wild influence', () => {
    const a = normalizeAppearance({ face: { nose: 99, chin: -99 } } as never);
    expect(a.face.nose).toBe(1);
    expect(a.face.chin).toBe(-1);
    expect(a.mouth).toBe('neutral');
    const m = morphInfluences(a);
    expect(m.get('nose_up')).toBe(1);
    expect(m.get('chin_dn')).toBe(1);
  });

  // Morph influences are per-INSTANCE while geometry is shared, so the face must
  // never reach the geometry cache key or every slider tick strands a variant.
  it('keys geometry independently of the face but the signature on it', () => {
    const plain = app();
    const shaped = app({ face: { ...NEUTRAL_FACE, jaw: 1 } });
    expect(modularGeometryKey(shaped)).toBe(modularGeometryKey(plain));
    expect(modularSignature(shaped)).not.toBe(modularSignature(plain));
  });

  // ...but the mouth is a PART, so unlike the sliders it must reach the geometry
  // key, it names a different node and cannot share a cached variant.
  it('keys geometry on the mouth, which is a part rather than a slider', () => {
    expect(modularGeometryKey(app({ mouth: 'open' }))).not.toBe(modularGeometryKey(app()));
  });
});

// buzz / crew / stubble / scruff are a texture decal on the bare head, not
// geometry (see stubble.ts). So they add NO part, which is exactly what has to
// be gated, because the failure mode is silent: a stale table naming the dead
// `M_Fuzz_buzz` node would keep rendering the old flat-alpha layer under the new
// decal, and switching the style off would leave the face wearing the other one.
describe('the shortest cuts are a decal, not a part', () => {
  it('adds no geometry for a decal style, and none for none at all', () => {
    const bald = modularPartNames(app({ hair: 'bald', beard: 'none' }));
    for (const hair of ['buzz', 'crew'] as const) {
      for (const beard of ['stubble', 'scruff'] as const) {
        expect(modularPartNames(app({ hair, beard })), `${hair}/${beard}`).toEqual(bald);
      }
    }
    expect(bald.some((n) => /Fuzz|Stub/.test(n))).toBe(false);
    // ...while a real hair shell or beard volume is still one shared mesh
    expect(modularPartNames(app({ hair: 'warriorbraid', beard: 'vikingb' }))).toEqual(
      expect.arrayContaining(['H2_warriorbraid', 'BI_vikingb']),
    );
    expect(modularPartNames(app({ gender: 'female', hair: 'warriorbraid' }))).toContain(
      'H2_warriorbraid',
    );
  });

  it('reports the decal selection, and drops it under a helm', () => {
    expect(stubbleDecals(app({ hair: 'buzz', beard: 'scruff' }))).toEqual({
      scalp: 'buzz',
      beard: 'scruff',
    });
    expect(stubbleDecals(app({ hair: 'crew', beard: 'full' }))).toEqual({
      scalp: 'crew',
      beard: null,
    });
    // A hair VOLUME is worn over growth: the shell has a hairline at its rim
    // and gaps between its strands, and what shows through both is scalp;
    // without this a spiky cut shows bare head between the spikes. The DEFAULT
    // growth is the buzz decal itself, the same stubble the picker gives you
    // when buzz is the whole style, for every style the Fit Studio has not
    // authored an under-layer for. Picked dynamically: which styles carry an
    // authored entry is designer data that grows over time.
    const unauthored = HAIR_STYLES.find(
      (h) => h !== 'bald' && h !== 'buzz' && h !== 'crew' && !UNDERHAIR[h],
    )!;
    expect(stubbleDecals(app({ hair: unauthored, beard: 'stubble' }))).toEqual({
      scalp: 'buzz',
      beard: 'stubble',
    });
    // An AUTHORED style wears the under-layer its anchor named instead
    // (underhair.generated.ts, written beside the seat in the Fit Studio):
    // 'messy' is a spiky cut whose gaps read better over a low fade.
    expect(stubbleDecals(app({ hair: 'messy', beard: 'none' }))).toEqual({
      scalp: 'low_fade',
      beard: null,
    });
    // ...and an authored 'none' means the volume covers enough that any growth
    // under it would only ever be z-fighting (the afro's full shell).
    expect(stubbleDecals(app({ hair: 'afro', beard: 'none' }))).toEqual({
      scalp: null,
      beard: null,
    });
    // ...but bald is the one look that means NO growth, and buzz/crew are
    // already a scalp decal, giving those roots as well would draw two.
    expect(stubbleDecals(app({ hair: 'bald', beard: 'none' }))).toEqual({
      scalp: null,
      beard: null,
    });
    // Every style resolves to SOME decision: bald and an authored 'none' wear
    // nothing, crew wears its own cut, an authored style wears what its anchor
    // named, and everything else falls back to the buzz growth.
    for (const hair of HAIR_STYLES) {
      const scalp = stubbleDecals(app({ hair })).scalp;
      if (hair === 'bald' || UNDERHAIR[hair] === 'none') expect(scalp, hair).toBeNull();
      else if (hair === 'crew') expect(scalp, hair).toBe('crew');
      else if (UNDERHAIR[hair]) expect(scalp, hair).toBe(UNDERHAIR[hair]);
      else expect(scalp, hair).toBe('buzz');
    }
    // The SCALP decal survives every kind of headgear, it is the head's own
    // surface a fraction of a millimetre out, and what shows of the head shows
    // the growth with it.
    expect(stubbleDecals(app({ hair: 'buzz', beard: 'scruff' }), KNIGHT_FULL).scalp).toBe('buzz');
    // A FULL helm closes over the jaw: no beard of any kind survives it.
    for (const beard of BEARD_STYLES) {
      expect(stubbleDecals(app({ beard }), KNIGHT_FULL).beard, beard).toBeNull();
    }
    // A HAT leaves the jaw alone: the beard volume stays on (see the part
    // composition tests), so the decal rule is exactly the bare-headed one.
    for (const beard of BEARD_STYLES) {
      const hatted = stubbleDecals(app({ beard }), fullSet('barbarian')).beard;
      const bare = stubbleDecals(app({ beard })).beard;
      expect(hatted, beard).toBe(bare);
    }
    // a set with no helm piece does not count as covering the head, so a beard
    // worn under one keeps its own volume and its own decal
    expect(stubbleDecals(app({ hair: 'buzz' }), fullSet('rogue')).scalp).toBe('buzz');
    expect(stubbleDecals(app({ beard: 'stubble' }), fullSet('rogue')).beard).toBe('stubble');
  });

  // The decal adds no part, so buzz and bald compose the SAME cached variant.
  // If the styles did not reach the signature, the creation turntable would
  // never rebuild for them and the chip would look dead.
  it('keys the signature on the decal even though the geometry is shared', () => {
    const bald = app({ hair: 'bald', beard: 'none' });
    const buzz = app({ hair: 'buzz', beard: 'none' });
    const scruff = app({ hair: 'bald', beard: 'scruff' });
    expect(modularGeometryKey(buzz)).toBe(modularGeometryKey(bald));
    expect(modularSignature(buzz)).not.toBe(modularSignature(bald));
    expect(modularSignature(scruff)).not.toBe(modularSignature(bald));
    expect(modularSignature(scruff)).not.toBe(modularSignature(buzz));
    expect(stubbleDecalKey(bald)).toBe('');
  });
});

describe('swappable face parts', () => {
  it('picks the eye part, which armour never hides', () => {
    // lashes explicitly ON: this is about WHICH lash part gets picked, and the
    // male body's default is off (they are the female standard)
    const a = app({ eyeShape: 'cat', ears: 'pointed', lashes: true });
    for (const worn of [{}, KNIGHT_FULL]) {
      const parts = modularPartNames(a, worn);
      expect(parts).toContain('M_Eye_cat');
      expect(parts).toContain('M_Lash_cat');
    }
    // ...unlike the ear, which a helm replaces rather than covers
    expect(modularPartNames(a)).toContain('M_Ear_pointed');
    expect(modularPartNames(a, KNIGHT_FULL)).not.toContain('M_Ear_pointed');
  });

  it('offers ten brows, ten eye shapes and four ears', () => {
    expect(BROW_STYLES.filter((b) => b !== 'none')).toHaveLength(10);
    expect(EYE_STYLES).toHaveLength(10);
    expect(EAR_STYLES).toHaveLength(4);
  });

  it('falls back to a real part when the stored style is junk', () => {
    const parts = modularPartNames(
      normalizeAppearance({ eyeShape: 'laser', ears: 'elf' } as never),
    );
    expect(parts).toContain('M_Eye_almond');
    expect(parts).toContain('M_Ear_round');
  });

  // The two heads are separate sculpts, not one scaled copy: a patch projected
  // onto the male head lands INSIDE the female one, and shipping a single set
  // left every female character with no eyes at all. Every part that sits on
  // the face therefore has to come from the matching head.
  it('takes every face part from the head it will sit on', () => {
    for (const [gender, tag] of [
      ['male', 'M_'],
      ['female', 'F_'],
    ] as const) {
      const parts = modularPartNames(
        // lashes on for both bodies: the point here is which HEAD each part is
        // taken from, not whether the male wears them by default
        app({ gender, eyeShape: 'doe', brows: 'bushy', ears: 'wide', lashes: true }),
      );
      for (const kind of ['Eye_doe', 'Lash_doe', 'Brow_bushy', 'Ear_wide']) {
        expect(parts, `${gender} ${kind}`).toContain(tag + kind);
        expect(parts, `${gender} ${kind}`).not.toContain((tag === 'M_' ? 'F_' : 'M_') + kind);
      }
    }
  });

  it('switches the lash off without touching the eye it hangs on', () => {
    const on = modularPartNames(app({ eyeShape: 'sharp', lashes: true }));
    const off = modularPartNames(app({ eyeShape: 'sharp', lashes: false }));
    expect(on).toContain('M_Lash_sharp');
    expect(off).not.toContain('M_Lash_sharp');
    expect(off).toContain('M_Eye_sharp');
  });

  // A look saved before lashes existed has no opinion about them, and reading
  // that silence as "off" would quietly shave every existing character.
  it('defaults the lash on for an appearance that predates it', () => {
    expect(normalizeAppearance({ gender: 'female' }).lashes).toBe(true);
    expect(normalizeAppearance({ lashes: false }).lashes).toBe(false);
  });
});

describe('cache keys', () => {
  it('keys geometry on the part set only, so a recolour reuses the variant', () => {
    const a = app();
    const b = app({ skinHue: 300, skinLight: 0.2, hairHue: 90 });
    expect(modularGeometryKey(a)).toBe(modularGeometryKey(b));
    expect(modularSignature(a)).not.toBe(modularSignature(b));
  });

  it('keys the signature on the part set too', () => {
    expect(modularSignature(app({ hair: 'crew' }))).not.toBe(
      modularSignature(app({ hair: 'curlycap' })),
    );
  });
});

describe('hslToHex', () => {
  it('maps the primaries', () => {
    expect(hslToHex(0, 1, 0.5)).toBe(0xff0000);
    expect(hslToHex(120, 1, 0.5)).toBe(0x00ff00);
    expect(hslToHex(240, 1, 0.5)).toBe(0x0000ff);
  });

  it('handles greys and wraps hue', () => {
    expect(hslToHex(0, 0, 1)).toBe(0xffffff);
    expect(hslToHex(0, 0, 0)).toBe(0x000000);
    expect(hslToHex(360, 1, 0.5)).toBe(hslToHex(0, 1, 0.5));
    expect(hslToHex(-120, 1, 0.5)).toBe(hslToHex(240, 1, 0.5));
  });
});

describe('normalizeAppearance', () => {
  it('fills a null appearance with the default', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  // A RETIRED style, not an invented one: this is the case that actually
  // happens. `spiky` was a real choice until the parametric library was
  // replaced by sculpts, and every character created before that has it stored
  // on their appearance, so loading them must land on the default rather than
  // throw or leave them with a style that no longer names a node.
  it('falls back rather than throwing on unknown styles', () => {
    const a = normalizeAppearance({ hair: 'spiky', brows: 'monobrow' } as never);
    expect(a.hair).toBe(DEFAULT_APPEARANCE.hair);
    expect(a.brows).toBe(DEFAULT_APPEARANCE.brows);
  });

  it('clamps out-of-range colour values', () => {
    const a = normalizeAppearance({ skinLight: 99, skinSat: -3, hairHue: 1e9 });
    expect(a.skinLight).toBeLessThanOrEqual(0.95);
    expect(a.skinSat).toBe(0);
    expect(a.hairHue).toBe(360);
  });

  it('keeps a valid outfit colorway and falls back on an unknown one', () => {
    expect(normalizeAppearance({ outfit: 'crimson' }).outfit).toBe('crimson');
    expect(normalizeAppearance({ outfit: 'plaid' } as never).outfit).toBe('classic');
    expect(normalizeAppearance(null).outfit).toBe('classic');
  });
});

// The Fit Studio's designer-side jewellery presets, handed to the player: the
// pick repaints the E2 meshes only and never touches geometry.
// The Combat Mech is a whole REPLACEMENT body, not a layer over the character.
// Two bodies in the same space intersect, so the guarantee has to hold by
// construction rather than by each call site remembering to check.
describe('the mech cosmetic replaces the character', () => {
  const mechPlayer = { kind: 'player', templateId: 'warrior', skinCatalog: 'mech' };
  const normalPlayer = { kind: 'player', templateId: 'warrior', skinCatalog: 'class' };

  it('identifies a wearer through one shared predicate', () => {
    expect(isMechWearer(mechPlayer as never)).toBe(true);
    expect(isMechWearer(normalPlayer as never)).toBe(false);
    // a mob or npc can never be one, whatever it carries
    expect(isMechWearer({ kind: 'mob', templateId: 'bandit' } as never)).toBe(false);
    expect(isMechWearer(null)).toBe(false);
  });

  it('routes a wearer to the mech body, never to a composed one', () => {
    expect(visualKeyFor(mechPlayer as never)).toBe('player_mech');
    expect(visualKeyFor(normalPlayer as never)).toBe('player_warrior');
  });

  // The structural half of the guarantee: only a `modular` def composes a
  // character at all, so even a look handed to the mech by mistake cannot put
  // a second body inside it.
  it('gives the mech a NON-modular def, so no look can compose onto it', () => {
    expect(VISUALS.player_mech).toBeDefined();
    expect(VISUALS.player_mech.modular).toBeFalsy();
    // ...while every class's composed variant is modular, so the two paths
    // cannot be confused
    for (const cls of ['warrior', 'mage', 'druid'] as const) {
      expect(VISUALS[modularVisualKey(cls)]?.modular, cls).toBe(true);
    }
  });
});

describe('earring materials', () => {
  it('paints only when a material is named AND a set is worn', () => {
    expect(earringMaterialSpec(app({ earrings: 'hoop', earringMaterial: 'default' }))).toBeNull();
    // no earrings worn: nothing to paint, whatever the stored material says
    expect(earringMaterialSpec(app({ earrings: 'none', earringMaterial: 'gold' }))).toBeNull();
    expect(earringMaterialSpec(app({ earrings: 'hoop', earringMaterial: 'gold' }))).toEqual(
      EARRING_MATERIALS.gold,
    );
  });

  // A hair band rides the same picker and the same E2_ material path, but it
  // is worn with the HAIR, so unlike an earring it must not be gated on the
  // earring slot, or a player with no piercings could never change the metal
  // on their ponytail tie.
  it('paints a hair band from the same picker even with no piercings worn', () => {
    expect(bandMaterialSpec(app({ earrings: 'none', earringMaterial: 'silver' }))).toEqual(
      EARRING_MATERIALS.silver,
    );
    expect(bandMaterialSpec(app({ earrings: 'hoop', earringMaterial: 'silver' }))).toEqual(
      EARRING_MATERIALS.silver,
    );
    // ...and still falls back to the authored atlas gold when none is picked
    expect(bandMaterialSpec(app({ earrings: 'none', earringMaterial: 'default' }))).toBeNull();
  });

  it('exposes every preset, with default leading and no chip colour', () => {
    expect(EARRING_MATERIAL_IDS[0]).toBe('default');
    expect(earringSwatchHex('default')).toBeNull();
    for (const id of EARRING_MATERIAL_IDS.slice(1)) {
      const spec = earringMaterialSpec(app({ earrings: 'hoop', earringMaterial: id }));
      expect(spec, id).not.toBeNull();
      expect(earringSwatchHex(id), id).toBe(spec!.color);
      expect(spec!.metalness, id).toBeGreaterThanOrEqual(0);
      expect(spec!.roughness, id).toBeGreaterThan(0);
    }
  });

  it('is a MATERIAL choice: it moves the signature but never the geometry key', () => {
    const a = app({ earrings: 'hoop', earringMaterial: 'default' });
    const b = app({ earrings: 'hoop', earringMaterial: 'ruby' });
    expect(modularGeometryKey(b)).toBe(modularGeometryKey(a));
    expect(modularSignature(b)).not.toBe(modularSignature(a));
  });

  it('falls back to default on a look saved before it existed', () => {
    expect(normalizeAppearance({ earrings: 'hoop' }).earringMaterial).toBe('default');
    expect(normalizeAppearance({ earringMaterial: 'unobtainium' } as never).earringMaterial).toBe(
      'default',
    );
  });
});

describe('outfit colorways', () => {
  it('lists classic first and every id exactly once', () => {
    expect(OUTFIT_COLORWAYS[0].id).toBe('classic');
    const ids = OUTFIT_COLORWAYS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // "many nice colorways": the picker should genuinely offer a spread
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every set a dye band and every material a resolution', () => {
    for (const set of ARMOR_SETS) {
      const band = ARMOR_DYE_BANDS[set];
      expect(band.ref, set).toBeGreaterThanOrEqual(0);
      expect(band.ref, set).toBeLessThan(360);
      expect(band.band, set).toBeGreaterThan(0);
    }
    // the paladin's second (metallic) material dyes through the paladin band
    expect(outfitDye('paladin_metallic', 'crimson')).toEqual(outfitDye('paladin', 'crimson'));
  });

  it('dyes armour materials only, and only for a real non-classic colorway', () => {
    expect(outfitDye('knight', 'classic')).toBeNull();
    expect(outfitDye('mod_skin', 'crimson')).toBeNull();
    expect(outfitDye('knight', 'plaid' as never)).toBeNull();
    const dye = outfitDye('knight', 'crimson')!;
    expect(dye.rules).toHaveLength(1);
    expect(dye.rules[0].hue).toBe(350);
    expect(dye.rules[0].hueMode).toBe('rel');
    expect(dye.rules[0].ref).toBe(ARMOR_DYE_BANDS.knight.ref);
  });

  it('compiles a material colorway to multi-zone rules on every set', () => {
    for (const set of ARMOR_SETS) {
      for (const id of MATERIAL_COLORWAY_IDS) {
        const dye = outfitDye(set, id)!;
        // several zones, each treated differently, within the shader's cap
        expect(dye.rules.length, `${set}/${id}`).toBeGreaterThanOrEqual(3);
        expect(dye.rules.length, `${set}/${id}`).toBeLessThanOrEqual(5);
        // at least one rule reaches into the near-gray steel the legacy dye
        // gated out, that is the whole point of a material colorway
        expect(
          dye.rules.some(
            (r) => r.sat[0] < 0.1 && (r.satAdd !== 0 || r.satMul !== 1 || r.valMul !== 1),
          ),
          `${set}/${id} touches steel`,
        ).toBe(true);
      }
    }
  });

  it('keeps material colorway ids pickable and persistable', () => {
    for (const id of MATERIAL_COLORWAY_IDS) {
      expect(OUTFIT_COLORWAY_IDS).toContain(id);
      expect(normalizeAppearance({ outfit: id }).outfit).toBe(id);
    }
  });

  it('reaches the signature without touching the geometry key', () => {
    const a = app({});
    const b = app({ outfit: 'crimson' });
    expect(modularGeometryKey(a, KNIGHT_FULL)).toBe(modularGeometryKey(b, KNIGHT_FULL));
    expect(modularSignature(a, KNIGHT_FULL)).not.toBe(modularSignature(b, KNIGHT_FULL));
  });

  it('draws a distinct swatch chip per colorway on every set', () => {
    for (const set of ARMOR_SETS) {
      const hexes = OUTFIT_COLORWAYS.map((c) => outfitSwatchHex(set, c.id));
      // classic shares the set's native hue family with at most one dye target
      expect(new Set(hexes).size).toBeGreaterThanOrEqual(OUTFIT_COLORWAYS.length - 2);
    }
  });

  it('draws a multi-stop chip per material colorway, distinct across colorways', () => {
    for (const set of ARMOR_SETS) {
      const chips = MATERIAL_COLORWAY_IDS.map((id) => outfitSwatchHexes(set, id));
      for (const stops of chips) expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(new Set(chips.map((c) => c.join(','))).size).toBe(chips.length);
    }
    // a hue colorway stays a flat single-stop chip
    expect(outfitSwatchHexes('knight', 'crimson')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Asset contract: modular.ts picks parts BY NODE NAME. A rename (or a dropped
// part) in a re-export makes that part silently vanish from every composed
// character, nothing throws, the body just loses a limb. This gate compares
// the tables against the GLB actually served out of public/.
// ---------------------------------------------------------------------------
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function glbJson(publicPath: string): {
  nodes?: { name?: string; mesh?: number }[];
  materials?: { name?: string }[];
  meshes?: { primitives?: { material?: number }[] }[];
} {
  const buf = readFileSync(publicPath);
  expect(buf.readUInt32LE(0), `${publicPath} magic`).toBe(GLB_MAGIC);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === CHUNK_JSON) {
      return JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + length));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${publicPath} has no JSON chunk`);
}

describe('modular GLB contract', () => {
  const def = VISUALS[MODULAR_WARRIOR_KEY];
  const path = fileURLToPath(new URL(`../public/${def.url}`, import.meta.url));

  it('is registered as a modular def', () => {
    expect(def.modular).toBe(true);
  });

  it('ships every node the part tables name', () => {
    const json = glbJson(path);
    const present = new Set((json.nodes ?? []).map((n) => n.name ?? ''));
    const missing = allModularNodes().filter((n) => !present.has(n));
    expect(missing, `missing from ${def.url}`).toEqual([]);
  });

  // The mouth line and the open cavity are near-black, and so is the eye, but
  // `recolored()` routes mod_eye through the player's EYE wheel, so sharing that
  // material painted the mouth line to match the irises. It is its own material
  // now, and the exporter MERGES materials whose settings are identical, so the
  // two staying distinct in the shipped asset is the thing worth pinning.
  it('draws the mouth on its own dark material, never the recoloured eye one', () => {
    const json = glbJson(path);
    const mats = (json.materials ?? []).map((m) => m.name ?? '');
    const nodes = json.nodes ?? [];
    const mouths = nodes.filter((n) => (n.name ?? '').includes('_Mouth_'));
    expect(mouths.length).toBe(MOUTH_STYLES.length * 2);
    let sawMouthMat = false;
    for (const n of mouths) {
      const mesh = n.mesh === undefined ? undefined : json.meshes?.[n.mesh];
      const used = (mesh?.primitives ?? []).map((p) =>
        p.material === undefined ? '' : mats[p.material],
      );
      expect(used, `${n.name} materials`).not.toContain('mod_eye');
      expect(used, `${n.name} materials`).toContain('mod_skin');
      if (used.includes('mod_mouth')) sawMouthMat = true;
    }
    expect(sawMouthMat, 'no mouth uses mod_mouth').toBe(true);
  });

  it('ships every runtime material, including one atlas per set', () => {
    const json = glbJson(path);
    const names = new Set((json.materials ?? []).map((m) => m.name ?? ''));
    // mod_lash is the one that needs watching: the glTF exporter MERGES
    // materials whose settings are identical, so authoring it as a copy of
    // mod_hair (which is what "a lash is hair" wanted) silently shipped one
    // material under the other's name, with the lash wheel wired to nothing.
    for (const m of [
      'mod_skin',
      'mod_hair',
      'mod_eye',
      'mod_lash',
      'mod_cloth',
      'mod_mouth',
      'mod_tooth',
      ...ARMOR_MATERIALS,
    ]) {
      expect(names, `material ${m}`).toContain(m);
    }
  });

  it('puts the lash on its own material and the brow on the hair one', () => {
    const json = glbJson(path);
    const matName = (i: number) => json.materials?.[i]?.name ?? '';
    const nodeMat = (node: string) => {
      const n = (json.nodes ?? []).find((x) => x.name === node);
      const mesh = json.meshes?.[n?.mesh ?? -1];
      return matName(mesh?.primitives?.[0]?.material ?? -1);
    };
    expect(nodeMat('M_Lash_almond')).toBe('mod_lash');
    expect(nodeMat('F_Lash_cat')).toBe('mod_lash');
    expect(nodeMat('M_Brow_soft')).toBe('mod_hair');
    // Hair ships FLAT: a strand texture was tried on 2026-08-07 and pulled the
    // same day (Troy: "remove the hair texture it doesn't look very good").
    // Every hair and beard is back on the one untextured mod_hair.
    expect(nodeMat('H2_afro')).toBe('mod_hair');
    expect(nodeMat('H2_lowpony')).toBe('mod_hair');
    expect(nodeMat('BI_vikingb')).toBe('mod_hair');
  });

  // assembleModular tags a mesh as `bodyMesh` off this predicate, which gates
  // the legacy per-class skin-atlas swap. Miss a set and its plate stops
  // responding to skins; catch mod_skin by accident and a skin override
  // repaints the colour-picked flesh.
  it('classifies exactly the armour materials as armour', () => {
    for (const set of ARMOR_SETS) expect(isArmorMaterial(set), set).toBe(true);
    expect(isArmorMaterial('paladin_metallic')).toBe(true);
    for (const m of ['mod_skin', 'mod_hair', 'mod_eye', 'mod_cloth', '', null, undefined]) {
      expect(isArmorMaterial(m as string), String(m)).toBe(false);
    }
  });
});

// The brows are the one part where asymmetry is immediately obvious on a face,
// and the generator gets there by mirroring an azimuth, so every OTHER
// per-vertex quantity has to be side-independent. The first version tilted the
// brow's height by `sgn * f`, lifting the outer end on one side and the inner
// end on the other; it looked wonky and nothing caught it. This decodes the
// shipped positions and demands a true reflection.
describe('brow mirror symmetry', () => {
  const def = VISUALS[MODULAR_WARRIOR_KEY];
  const path = fileURLToPath(new URL(`../public/${def.url}`, import.meta.url));

  it.each(['M_Brow_soft', 'M_Brow_thick', 'F_Brow_soft', 'F_Brow_angled'])(
    '%s reflects across x=0',
    async (node) => {
      const { NodeIO } = await import('@gltf-transform/core');
      const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
      const { MeshoptDecoder } = await import('meshoptimizer');
      const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
      const doc = await io.read(path);
      const target = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === node);
      expect(target, `${node} present`).toBeTruthy();
      const prim = target?.getMesh()?.listPrimitives()[0];
      const pos = prim?.getAttribute('POSITION');
      expect(pos, `${node} positions`).toBeTruthy();

      const pts: [number, number, number][] = [];
      for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
        const v = pos?.getElement(i, [0, 0, 0]) as number[];
        pts.push([v[0], v[1], v[2]]);
      }
      // Positions survive a 14-bit quantize, so compare with a tolerance well
      // under the ~0.05 asymmetry the old bug produced but well over the grid.
      const EPS = 2e-3;
      const unmatched = pts.filter(
        ([x, y, z]) =>
          !pts.some(
            ([a, b, c]) =>
              Math.abs(a + x) <= EPS && Math.abs(b - y) <= EPS && Math.abs(c - z) <= EPS,
          ),
      );
      expect(unmatched.length, `${node} vertices with no mirror partner`).toBe(0);
    },
  );
});

// One side of the head shading faceted while the other looked clean was NOT a
// triangulation-symmetry problem, which is what it was first diagnosed as. It
// was inverted winding: a pass that rebuilt the left half as a reflection ended
// with a global recalc_face_normals(), KayKit's heads carry 114 non-manifold
// edges of their own, the recalc could not resolve an orientation across them,
// and it flipped 100 of 419 rebuilt faces INWARD. An inverted normal among
// smooth neighbours is a hard shading break.
//
// So this gates the property that actually decides how the face reads: every
// triangle is wound to agree with its own shading, and nothing ships flat.
describe('head shading', () => {
  const def = VISUALS[MODULAR_WARRIOR_KEY];
  const path = fileURLToPath(new URL(`../public/${def.url}`, import.meta.url));

  const decode = async (node: string) => {
    const { NodeIO } = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
    const { MeshoptDecoder } = await import('meshoptimizer');
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path);
    const prim = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === node)
      ?.getMesh()
      ?.listPrimitives()[0];
    const pos = prim?.getAttribute('POSITION');
    const nor = prim?.getAttribute('NORMAL');
    const idx = prim?.getIndices();
    expect(pos, `${node} positions`).toBeTruthy();
    expect(nor, `${node} normals`).toBeTruthy();
    const P: number[][] = [];
    const N: number[][] = [];
    for (let i = 0; i < (pos?.getCount() ?? 0); i++) {
      P.push(pos?.getElement(i, [0, 0, 0]) as number[]);
      N.push(nor?.getElement(i, [0, 0, 0]) as number[]);
    }
    const count = idx ? idx.getCount() : P.length;
    const tris: number[][] = [];
    for (let t = 0; t < count; t += 3) {
      tris.push([0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k)));
    }
    return { P, N, tris };
  };

  it.each(['M_Head', 'F_Head'])(
    '%s winds every triangle to agree with its shading',
    async (node) => {
      const { P, N, tris } = await decode(node);
      const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const cross = (a: number[], b: number[]) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const inverted: number[][] = [];
      for (const [a, b, c] of tris) {
        const fn = cross(sub(P[b], P[a]), sub(P[c], P[a]));
        // the smooth normal the renderer will actually use across this triangle
        const sn = [0, 1, 2].map((k) => (N[a][k] + N[b][k] + N[c][k]) / 3);
        if (dot(fn, sn) < 0) inverted.push(P[a]);
      }
      expect(inverted.length, `${node} triangles wound against their normals`).toBe(0);
    },
  );

  // What ships is the mesh's per-face smooth flags: `shade_smooth_by_angle` is a
  // modifier in Blender 4.1+ and the export runs with export_apply=False, so a
  // face built by bmesh (which defaults to FLAT) exports flat unless the
  // authoring pass says otherwise. A whole layer came out faceted on that alone.
  //
  // Heads only. The stubble and the scalp caps are SUBDIVIDED copies of head
  // triangles, so their sub-triangles are coplanar by construction and a
  // smooth normal there is indistinguishable from a flat one, the heuristic
  // reports ~23% on a mesh Blender confirms is 100% smooth. On the heads it
  // separates cleanly: 0.3% when right and 30% when broken.
  it.each(['M_Head', 'F_Head'])('%s ships smooth normals, not per-face ones', async (node) => {
    const { P, N, tris } = await decode(node);
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const unit = (v: number[]) => {
      const l = Math.hypot(...v) || 1;
      return v.map((x) => x / l);
    };
    // A flat-shaded triangle has all three corner normals equal to its own
    // face normal. Some genuinely planar regions do too, so this bounds the
    // SHARE rather than demanding zero, the defect was a third of a mesh.
    let flat = 0;
    for (const [a, b, c] of tris) {
      const fn = unit(cross(sub(P[b], P[a]), sub(P[c], P[a])));
      if ([a, b, c].every((i) => Math.abs(dot(unit(N[i]), fn)) > 0.999)) flat++;
    }
    expect(flat / tris.length, `${node} share of flat-shaded triangles`).toBeLessThan(0.12);
  });
});

describe('randomizeAppearance', () => {
  // Seeded, so this asserts the actual behaviour rather than "it changed".
  const seeded = (start = 0.123) => {
    let s = start;
    return () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    };
  };

  // "after picking gender", the body is the one choice the roll must respect.
  it('keeps the gender and rolls everything else', () => {
    const base = app({ gender: 'female', hair: 'bald', brows: 'none' });
    const rolled = randomizeAppearance(base, seeded());
    expect(rolled.gender).toBe('female');
    expect(modularPartNames(rolled)).toContain('F_Head');
  });

  it('only ever produces a valid, renderable look', () => {
    const rand = seeded(0.777);
    for (let i = 0; i < 200; i++) {
      const a = randomizeAppearance(app(), rand);
      // normalizeAppearance is the contract for "renderable"; a roll that needed
      // clamping would come back different from itself
      expect(normalizeAppearance(a)).toEqual(a);
      for (const n of modularPartNames(a)) expect(n).toBeTruthy();
      for (const k of FACE_SLIDERS) expect(Math.abs(a.face[k])).toBeLessThanOrEqual(1);
    }
  });

  // The dice are gendered even though the pickers are not: rolling a beard
  // onto a female body reads as a bug, not as a choice.
  it('never rolls facial hair onto a female body, and does roll it onto a male one', () => {
    const rand = seeded(0.404);
    const femaleBeards = new Set<string>();
    const maleBeards = new Set<string>();
    for (let i = 0; i < 400; i++) {
      femaleBeards.add(randomizeAppearance(app({ gender: 'female' }), rand).beard);
      maleBeards.add(randomizeAppearance(app({ gender: 'male' }), rand).beard);
    }
    expect([...femaleBeards]).toEqual(['none']);
    // the male pool must actually reach the volumes AND the painted decals
    expect(maleBeards.size).toBeGreaterThan(5);
    expect([...maleBeards].some((b) => b === 'stubble' || b === 'scruff')).toBe(true);
  });

  it('draws hair from the gender pools, sharing the unisex middle', () => {
    const rand = seeded(0.55);
    const seen = { male: new Set<string>(), female: new Set<string>() };
    for (let i = 0; i < 600; i++) {
      for (const g of ['male', 'female'] as const) {
        seen[g].add(randomizeAppearance(app({ gender: g }), rand).hair);
      }
    }
    // each gender's leaning tail is exclusive to it...
    for (const h of ['buzz', 'crewcut', 'pompadour', 'mullet']) {
      expect(seen.male.has(h), `male rolls ${h}`).toBe(true);
      expect(seen.female.has(h), `female never rolls ${h}`).toBe(false);
    }
    for (const h of ['pixie', 'wavybob', 'twinbraids', 'braidcrown']) {
      expect(seen.female.has(h), `female rolls ${h}`).toBe(true);
      expect(seen.male.has(h), `male never rolls ${h}`).toBe(false);
    }
    // ...while the unisex middle stays available to both, so neither pool
    // collapses to a handful of styles
    for (const h of ['mohawk', 'topknot', 'afro', 'longwavy']) {
      expect(seen.male.has(h) && seen.female.has(h), `both roll ${h}`).toBe(true);
    }
    expect(randomHairStyles('male').length).toBeGreaterThan(20);
    expect(randomHairStyles('female').length).toBeGreaterThan(20);
    // every pooled style must be a real, renderable style
    for (const g of ['male', 'female'] as const) {
      for (const h of randomHairStyles(g)) expect(HAIR_STYLES).toContain(h);
    }
  });

  // A uniform hue over the whole wheel makes green people, which reads as a bug.
  it('keeps skin inside a believable arc while hair roams the whole wheel', () => {
    const rand = seeded(0.31);
    const hues: number[] = [];
    for (let i = 0; i < 200; i++) {
      const a = randomizeAppearance(app(), rand);
      expect(a.skinHue).toBeGreaterThanOrEqual(18);
      expect(a.skinHue).toBeLessThanOrEqual(38);
      hues.push(a.hairHue);
    }
    expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(180);
  });
});

// ---------------------------------------------------------------------------
// Per-class modular defs: every class composes through its own
// `player_<class>_modular` def, derived from the class def, same clips,
// ability mapping and hand layout, body swapped for the shared part library.
// The class GLB rides along as a clip source, so the per-class synthesized
// attacks (Shield_Bash, Garrote_Choke, the bow draws) must all RESOLVE against
// the union of the part library's clips and the anim sources, a clip that
// does not is a silent T-pose in game, nothing throws.
// ---------------------------------------------------------------------------
function glbClipNames(publicPath: string): Set<string> {
  const json = glbJson(publicPath) as { animations?: { name?: string }[] };
  return new Set((json.animations ?? []).map((a) => a.name ?? ''));
}

function referencedClips(clips: ClipMap): string[] {
  const out = new Set<string>();
  const add = (v?: string) => {
    if (v) out.add(v);
  };
  add(clips.idle);
  add(clips.walk);
  add(clips.run);
  add(clips.walkBack);
  clips.attack.forEach(add);
  for (const v of Object.values(clips.attackByAbility ?? {})) add(v);
  add(clips.attackByHand?.twohand);
  add(clips.attackByHand?.dualwield);
  add(clips.death);
  (clips.hit ?? []).forEach(add);
  add(clips.cast);
  add(clips.sitDown);
  add(clips.sitIdle);
  add(clips.swim);
  add(clips.jump);
  add(clips.stow);
  add(clips.flourish);
  for (const spec of Object.values(clips.emote ?? {})) for (const c of spec?.clips ?? []) add(c);
  return [...out];
}

describe('per-class modular defs', () => {
  // ALL_CLASSES, not a local copy: the defs are generated from that same list,
  // so a tenth class arrives in this suite instead of quietly skipping it.
  const PLAYER_CLASSES: PlayerClass[] = ALL_CLASSES;

  it.each(PLAYER_CLASSES)('player_%s_modular mirrors its class def', (cls) => {
    const key = modularVisualKey(cls);
    const def = VISUALS[key];
    const base = VISUALS[`player_${cls}`];
    expect(def, key).toBeTruthy();
    expect(def.modular).toBe(true);
    // one shared part library for every class
    expect(def.url).toBe(VISUALS[MODULAR_WARRIOR_KEY].url);
    // class parity: the fixed rig's clip map and hand layout, verbatim
    expect(def.clips).toEqual(base.clips);
    expect(def.attach).toEqual(base.attach);
    expect(def.weaponSlots).toEqual(base.weaponSlots);
    expect(def.offhandSlot).toBe(base.offhandSlot);
    // the class GLB leads the anim sources (per-class synthesized attacks)
    expect(def.animUrls?.[0]).toBe(base.url);
    // never class-tinted (the skin/hair wheels own the colours) and no stale
    // accessory allowlist (the composed body has nothing baked to allow)
    expect(def.tint).toBeUndefined();
    expect(def.show).toBeUndefined();
  });

  it.each(PLAYER_CLASSES)('player_%s_modular resolves every clip it names', (cls) => {
    const def = VISUALS[modularVisualKey(cls)];
    const names = new Set<string>();
    for (const p of [def.url, ...(def.animUrls ?? [])]) {
      const path = fileURLToPath(new URL(`../public/${p}`, import.meta.url));
      for (const n of glbClipNames(path)) names.add(n);
    }
    const missing = referencedClips(def.clips).filter((c) => !names.has(c));
    expect(missing, `unresolvable clips for ${cls}`).toEqual([]);
  });

  it('gives every class a real default kit, knight when unknown', () => {
    for (const cls of PLAYER_CLASSES) expect(ARMOR_SETS).toContain(classArmorSet(cls));
    expect(classArmorSet('not_a_class')).toBe('knight');
  });
});

// A face slider is a per-instance morph influence over SHARED geometry, so
// moving one must not force a rebuild: the creator emits on every `input`
// event (5% steps, so about 40 per drag) and on every colour-wheel
// `pointermove`, and each rebuild disposes the character and clones a fresh
// one. The two signatures encode that split, so pin the split itself.
describe('slider morphs move on the live body, not through a rebuild', () => {
  const NEUTRAL = app();
  const SHAPED = app({ face: { ...DEFAULT_APPEARANCE.face, nose: 0.6 } });
  const BUILT = app({ hair: 'curlycap' }); // DEFAULT_APPEARANCE.hair is 'crew'

  it('leaves the BUILD signature alone when only a face slider moves', () => {
    expect(modularBuildSignature(SHAPED)).toBe(modularBuildSignature(NEUTRAL));
  });

  it('still separates them in the FULL signature (the portrait key)', () => {
    // Same body, different face: one cached headshot must not serve both.
    expect(modularSignature(SHAPED)).not.toBe(modularSignature(NEUTRAL));
  });

  it('rebuilds for anything that is not a slider', () => {
    expect(modularBuildSignature(BUILT)).not.toBe(modularBuildSignature(NEUTRAL));
  });

  it('covers every slider a player can move, both directions', () => {
    // The in-place writer walks this list, so a slider missing from it would
    // move the preview and never come back to neutral.
    for (const key of FACE_SLIDERS) {
      expect(MORPH_SLIDER_TARGETS, key).toContain(`${key}_up`);
      expect(MORPH_SLIDER_TARGETS, key).toContain(`${key}_dn`);
    }
    for (const key of BODY_SLIDERS) {
      expect(MORPH_SLIDER_TARGETS, key).toContain(`body_${key}_up`);
      expect(MORPH_SLIDER_TARGETS, key).toContain(`body_${key}_dn`);
    }
  });

  it('every target the writer knows is one a slider can actually produce', () => {
    // Both directions, so a renamed pair fails here rather than silently
    // writing zeros onto a target the sliders no longer drive.
    const reachable = new Set<string>();
    for (const key of FACE_SLIDERS) {
      for (const v of [1, -1])
        for (const n of morphInfluences(
          app({ face: { ...DEFAULT_APPEARANCE.face, [key]: v } }),
        ).keys())
          reachable.add(n);
    }
    for (const key of BODY_SLIDERS) {
      for (const v of [1, -1])
        for (const n of morphInfluences(
          app({ body: { ...DEFAULT_APPEARANCE.body, [key]: v } }),
        ).keys())
          reachable.add(n);
    }
    for (const name of MORPH_SLIDER_TARGETS) expect(reachable, name).toContain(name);
  });
});

describe('applyModularSliderMorphs', () => {
  const meshWith = (names: string[]): THREE.Mesh => {
    const mesh = new THREE.Mesh();
    mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
    mesh.morphTargetInfluences = names.map(() => 0);
    return mesh;
  };

  it('writes the active half of a pair', () => {
    const mesh = meshWith(['nose_up', 'nose_dn']);
    applyModularSliderMorphs(mesh, app({ face: { ...DEFAULT_APPEARANCE.face, nose: 0.5 } }));
    expect(mesh.morphTargetInfluences).toEqual([0.5, 0]);
  });

  it('CLEARS an influence when the slider returns to neutral', () => {
    // The build path only writes the non-zero half, which is right on a fresh
    // clone and wrong here: this runs over a body that already carries the
    // old value, so dragging back to centre has to zero it.
    const mesh = meshWith(['nose_up', 'nose_dn']);
    applyModularSliderMorphs(mesh, app({ face: { ...DEFAULT_APPEARANCE.face, nose: 0.5 } }));
    applyModularSliderMorphs(mesh, app());
    expect(mesh.morphTargetInfluences).toEqual([0, 0]);
  });

  it('flips to the other half of the pair on a negative value', () => {
    const mesh = meshWith(['jaw_up', 'jaw_dn']);
    applyModularSliderMorphs(mesh, app({ face: { ...DEFAULT_APPEARANCE.face, jaw: -0.25 } }));
    expect(mesh.morphTargetInfluences).toEqual([0, 0.25]);
  });

  it('leaves morph targets it does not own untouched', () => {
    // ear_small / jewel_f are part-driven, not slider-driven: they change only
    // with the part set, which rebuilds anyway. Clearing them here would undo
    // the seat the build applied.
    const mesh = meshWith(['ear_small', 'nose_up']);
    mesh.morphTargetInfluences = [1, 0];
    applyModularSliderMorphs(mesh, app());
    expect(mesh.morphTargetInfluences).toEqual([1, 0]);
  });

  it('reaches meshes anywhere under the root, and skips those with no morphs', () => {
    const root = new THREE.Object3D();
    const child = new THREE.Object3D();
    const mesh = meshWith(['nose_up', 'nose_dn']);
    const plain = new THREE.Mesh();
    child.add(mesh);
    root.add(child);
    root.add(plain);
    expect(() =>
      applyModularSliderMorphs(root, app({ face: { ...DEFAULT_APPEARANCE.face, nose: 1 } })),
    ).not.toThrow();
    expect(mesh.morphTargetInfluences).toEqual([1, 0]);
  });
});
