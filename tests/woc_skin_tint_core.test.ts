// Skin colour changes ONLY skin (src/render/characters/woc_skin_tint_core.ts): which
// mesh of a WOC body takes a tint, how strongly under each body atlas, and which
// texels of the body's own suit atlas count as skin. Node-only (RENDER_PURE_CORES):
// no Three, no DOM. The near rig, the far LOD and the wiki viewer all read this one
// rule (tests/woc_head_dressing.test.ts, tests/woc_far_equipment.test.ts and
// tests/guide_viewer_woc_head.test.ts pin each consumer against it).
import { describe, expect, it } from 'vitest';
import {
  srgbToLinear,
  WOC_BODY_SKIN_REF,
  WOC_HEAD_TINT_TABLE,
  WOC_HEAD_TINTED_ROLES,
  type WocLinearRgb,
} from '../src/render/characters/woc_head_look_core';
import {
  WOC_SKIN_BODY_NODES,
  WOC_SUIT_SKIN_GATE,
  WOC_SUIT_SKIN_GATE_GLSL,
  wocBodyAtlasOf,
  wocMeshTint,
  wocSuitSkinGate,
  wocSuitSkinShare,
  wocTintStrength,
} from '../src/render/characters/woc_skin_tint_core';

type Rgb8 = readonly [number, number, number];

/** An 8-bit sRGB texel (as the shipped atlas decodes) in the linear space the shader keys in. */
const texel = (r: number, g: number, b: number): WocLinearRgb => [
  srgbToLinear(r / 255),
  srgbToLinear(g / 255),
  srgbToLinear(b / 255),
];

describe('wocBodyAtlasOf', () => {
  it('reads a swapped-in under-armor atlas, and the base suit otherwise', () => {
    expect(wocBodyAtlasOf('textures/skins/woc/priest_underarmor.png')).toBe('underArmor');
    expect(wocBodyAtlasOf(null)).toBe('suit');
    expect(wocBodyAtlasOf(undefined)).toBe('suit');
    expect(wocBodyAtlasOf('')).toBe('suit');
  });
});

describe('wocMeshTint: which mesh takes which tint', () => {
  it("gives the body nodes the body's own skin key, per head type", () => {
    for (const type of ['a', 'b'] as const) {
      for (const name of ['Character_Body', 'Character_Body_bodymerged']) {
        expect(wocMeshTint({ name }, type), name).toBe(WOC_BODY_SKIN_REF[type]);
      }
      // the skin colour, through the suit key (never a head piece's plain skin band)
      expect(WOC_BODY_SKIN_REF[type].role).toBe('skin');
      expect(WOC_BODY_SKIN_REF[type].surface).toBe('suit');
    }
    expect([...WOC_SKIN_BODY_NODES].sort()).toEqual([
      'Character_Body',
      'Character_Body_bodymerged',
    ]);
  });

  it('never tints an armor part, whatever it is named, nor any other mesh', () => {
    expect(wocMeshTint({ name: 'Character_Body', armorPart: true }, 'a')).toBeNull();
    expect(wocMeshTint({ name: 'Armor_Priest_Chest_Front' }, 'a')).toBeNull();
    expect(wocMeshTint({ name: 'Armor_Priest_Chest_Front', armorPart: true }, 'b')).toBeNull();
    expect(wocMeshTint({ name: 'class_halo' }, 'a')).toBeNull();
    // close is not the body: only the two named nodes carry its skin paint
    expect(wocMeshTint({ name: 'Character_Body_2' }, 'a')).toBeNull();
    expect(wocMeshTint({ name: 'character_body' }, 'a')).toBeNull();
  });

  it("gives a hung head piece its own role and reference, with no surface of the body's", () => {
    const ref: WocLinearRgb = [0.2346, 0.1195, 0.0865];
    for (const role of WOC_HEAD_TINTED_ROLES) {
      const tint = wocMeshTint({ name: 'WocHead_A_base', role, ref }, 'a');
      expect(tint).toEqual({ role, ref });
      expect(tint?.surface).toBeUndefined();
    }
    // a piece stamped with a role but no measured reference keeps its baked colour
    expect(wocMeshTint({ name: 'WocHead_A_base', role: 'skin', ref: null }, 'a')).toBeNull();
    expect(wocMeshTint({ name: 'WocHead_A_base', role: 'hair' }, 'a')).toBeNull();
    // the stamp wins over the name: a head piece is never keyed as the body
    expect(wocMeshTint({ name: 'Character_Body', role: 'hair', ref }, 'a')).toEqual({
      role: 'hair',
      ref,
    });
  });
});

describe('wocTintStrength: an under-armor atlas has no skin on it', () => {
  it("switches the body's tint off under a class under-armor atlas, on under its own suit", () => {
    for (const type of ['a', 'b'] as const) {
      const body = WOC_BODY_SKIN_REF[type];
      expect(wocTintStrength(body, 'suit')).toBe(1);
      expect(wocTintStrength(body, 'underArmor')).toBe(0);
    }
  });

  it('never weakens a head piece, whatever the body wears', () => {
    for (const type of ['a', 'b'] as const) {
      for (const [name, tint] of Object.entries(WOC_HEAD_TINT_TABLE[type])) {
        expect(wocTintStrength(tint, 'suit'), name).toBe(1);
        expect(wocTintStrength(tint, 'underArmor'), name).toBe(1);
      }
    }
    // the surface decides, never the role: a plain skin tint (the face) stays full
    expect(wocTintStrength({}, 'underArmor')).toBe(1);
    expect(wocTintStrength({ surface: undefined }, 'underArmor')).toBe(1);
  });
});

describe('the suit key: only skin paint takes the tone', () => {
  // Texels read off the shipped base atlases (the KTX2's own decoded texels, 8-bit
  // sRGB), each named for what draws it on the body.
  const MALE = WOC_BODY_SKIN_REF.a.ref;
  const FEMALE = WOC_BODY_SKIN_REF.b.ref;

  it('passes the hands at full weight', () => {
    // the hand skin's median texel, each fit
    expect(wocSuitSkinGate(texel(157, 115, 90), MALE)).toBe(1);
    expect(wocSuitSkinGate(texel(180, 124, 97), FEMALE)).toBe(1);
    // its bright end too
    expect(wocSuitSkinGate(texel(167, 124, 96), MALE)).toBe(1);
    expect(wocSuitSkinGate(texel(187, 130, 108), FEMALE)).toBe(1);
    // the reference is its own median: exactly the full share
    expect(wocSuitSkinShare(MALE, MALE)).toBeCloseTo(1, 6);
    expect(wocSuitSkinShare(FEMALE, FEMALE)).toBeCloseTo(1, 6);
  });

  it('rejects the suit itself', () => {
    // the commonest suit texel, each fit: a dark neutral
    expect(wocSuitSkinGate(texel(50, 50, 46), MALE)).toBe(0);
    expect(wocSuitSkinGate(texel(54, 54, 54), FEMALE)).toBe(0);
    expect(wocSuitSkinGate([0, 0, 0], MALE)).toBe(0);
  });

  it('rejects the brown stitching, which sits in the skin hue band', () => {
    // the stitching's median texel and its 99th percentile, each fit: the plain skin
    // band tints every one of these at full weight (the bug this gate closes)
    const male: Rgb8[] = [
      [65, 56, 50],
      [81, 63, 53],
      [97, 71, 52],
    ];
    for (const [r, g, b] of male) {
      expect(wocSuitSkinGate(texel(r, g, b), MALE), `${r},${g},${b}`).toBe(0);
    }
    const female: Rgb8[] = [
      [56, 47, 40],
      [86, 74, 65],
      [97, 71, 65],
    ];
    for (const [r, g, b] of female) {
      expect(wocSuitSkinGate(texel(r, g, b), FEMALE), `${r},${g},${b}`).toBe(0);
    }
  });

  it('rejects a light seam highlight: bright enough, but with a third of the pigment', () => {
    // the female thigh seam: over half the skin's luminance, so luminance alone
    // would pass it; its red over blue is what falls short
    const seam = texel(123, 103, 91);
    const lum = (c: WocLinearRgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(seam) / lum(FEMALE)).toBeGreaterThan(WOC_SUIT_SKIN_GATE.lo);
    expect(wocSuitSkinShare(seam, FEMALE)).toBeLessThan(WOC_SUIT_SKIN_GATE.lo);
    expect(wocSuitSkinGate(seam, FEMALE)).toBe(0);
    expect(wocSuitSkinGate(texel(138, 123, 110), FEMALE)).toBe(0);
  });

  it('rejects a saturated but dark brown: pigment alone is not skin either', () => {
    // enough red over blue for the gate, at a quarter of the skin's luminance
    const brown = texel(120, 50, 20);
    expect((brown[0] - brown[2]) / (MALE[0] - MALE[2])).toBeGreaterThan(WOC_SUIT_SKIN_GATE.hi);
    expect(wocSuitSkinGate(brown, MALE)).toBe(0);
  });

  it('fades in between the two ends, monotonically', () => {
    // skin paint dimming toward the suit (an island edge): the share falls with it
    const mix = (a: number): WocLinearRgb => {
      const suit = texel(50, 50, 46);
      return [0, 1, 2].map((i) => MALE[i] * a + suit[i] * (1 - a)) as unknown as WocLinearRgb;
    };
    let last = -1;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const g = wocSuitSkinGate(mix(a), MALE);
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      last = g;
    }
    expect(wocSuitSkinGate(mix(0.3), MALE)).toBe(0);
    expect(wocSuitSkinGate(mix(0.5), MALE)).toBeGreaterThan(0);
    expect(wocSuitSkinGate(mix(0.5), MALE)).toBeLessThan(1);
    expect(wocSuitSkinGate(mix(0.7), MALE)).toBe(1);
  });

  it('keeps the gate window ordered and inside the share range', () => {
    expect(WOC_SUIT_SKIN_GATE.lo).toBeGreaterThan(0);
    expect(WOC_SUIT_SKIN_GATE.hi).toBeGreaterThan(WOC_SUIT_SKIN_GATE.lo);
    expect(WOC_SUIT_SKIN_GATE.hi).toBeLessThan(1);
    // the pigment share divides by the reference's red over blue: both fits have plenty
    for (const type of ['a', 'b'] as const) {
      const ref = WOC_BODY_SKIN_REF[type].ref;
      expect(ref[0] - ref[2]).toBeGreaterThan(0.1);
    }
  });

  it('mints the shader line from the same numbers', () => {
    // literal on purpose: the GLSL is what draws, the constant only what a test reads
    expect(WOC_SUIT_SKIN_GATE).toEqual({ lo: 0.45, hi: 0.6 });
    expect(WOC_SUIT_SKIN_GATE_GLSL).toBe(
      'w *= smoothstep(0.45, 0.6, min(lc / lr, (c.r - c.b) / max(r.r - r.b, 1.0e-4)));',
    );
  });
});
