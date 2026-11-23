// The spirit veil's palettes and knobs (src/render/characters/
// spirit_veil_palette_core.ts over ghost_veil.ts): the chosen values, what a
// veiled rig keeps per palette, and how a palette, the source's own colour and
// its outfit dye reach the shared programs as uniform values only, never as a
// program key. The real-driver half (zero new programs, keepColor 0 against
// the previous shader, dye pixels) is tests/browser/spirit_veil_programs.

import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachArmorDye } from '../src/render/characters/armor_dye';
import {
  createSpiritVeilMaterial,
  SPIRIT_VEIL_LOOK,
  spiritVeilDepthMaterial,
  spiritVeilPaletteOf,
} from '../src/render/characters/ghost_veil';
import type { DyeRule } from '../src/render/characters/modular';
import {
  SPIRIT_VEIL_PALETTES,
  SPIRIT_VEIL_POLICY,
  type SpiritVeilPalette,
} from '../src/render/characters/spirit_veil_palette_core';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Run a material's hook the way three does, on a fresh copy of its lib
 *  shader, and hand back what it produced. */
function compiled(material: THREE.Material, lib: 'basic' | 'standard' = 'basic'): Shader {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  } as unknown as Shader;
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
}

const RULE: DyeRule = {
  ref: 40,
  band: 30,
  sat: [0.1, 0.2, 0.8, 0.9],
  val: [0.1, 0.2, 0.8, 0.9],
  hue: 200,
  hueMode: 'abs',
  satMul: 1,
  satAdd: 0,
  valMul: 1,
  valAdd: 0,
};

describe('the veil palettes', () => {
  it('pins the chosen values', () => {
    const expected: Record<SpiritVeilPalette, unknown> = {
      spirit: {
        tint: 0x7cade1,
        deep: 0x213055,
        rim: 0x90c0ff,
        rimStrength: 2.69,
        opacity: 0.24,
        rise: 1.1,
        shimmer: 0.012,
        keepColor: 0,
        band: 0.3,
      },
      wolf: {
        tint: 0xb1a99a,
        deep: 0x787878,
        rim: 0xa3a39e,
        rimStrength: 1.15,
        opacity: 0.23,
        rise: 0.72,
        shimmer: 0,
        keepColor: 1,
        band: 0.3,
      },
      march: {
        tint: 0xffe2a0,
        deep: 0x5a4420,
        rim: 0xffd27a,
        rimStrength: 1.03,
        opacity: 0.12,
        rise: 0.6,
        shimmer: 0.01,
        keepColor: 1,
        band: 0.22,
      },
      'stealth-rogue': {
        tint: 0x6b7690,
        deep: 0x854686,
        rim: 0x9f3e2d,
        rimStrength: 2.55,
        opacity: 0.08,
        rise: 1.1,
        shimmer: 0,
        keepColor: 0.65,
        band: 0,
      },
      'stealth-other': {
        tint: 0x6b7690,
        deep: 0x0d1018,
        rim: 0x725d4f,
        rimStrength: 0.21,
        opacity: 0.31,
        rise: 0.49,
        shimmer: 0,
        keepColor: 0.58,
        band: 0.36,
      },
      moonkin: {
        tint: 0x9373dd,
        deep: 0x3a2270,
        rim: 0xc9b8f5,
        rimStrength: 0.45,
        opacity: 0.71,
        rise: 1.1,
        shimmer: 0,
        keepColor: 0,
        band: 0.3,
      },
      'soul-rend': {
        tint: 0x552a2a,
        deep: 0x2b0303,
        rim: 0x930b0b,
        rimStrength: 1.07,
        opacity: 0.8,
        rise: 0.81,
        shimmer: 0,
        keepColor: 0,
        band: 1,
      },
    };
    expect(SPIRIT_VEIL_PALETTES).toEqual(expected);
    expect(SPIRIT_VEIL_LOOK).toBe(SPIRIT_VEIL_PALETTES.spirit);
  });

  it('pins what a veiled rig keeps, per palette', () => {
    expect(SPIRIT_VEIL_POLICY).toEqual({
      spirit: { castsShadow: false, weaponVfx: false },
      wolf: { castsShadow: false, weaponVfx: false },
      march: { castsShadow: false, weaponVfx: true },
      'stealth-rogue': { castsShadow: false, weaponVfx: false },
      'stealth-other': { castsShadow: false, weaponVfx: false },
      moonkin: { castsShadow: true, weaponVfx: true },
      'soul-rend': { castsShadow: false, weaponVfx: true },
    });
  });
});

describe('a palette is uniform values on the shared programs', () => {
  it('keys every palette, source colour and dye to the same three program keys (v2)', () => {
    const plain = new THREE.MeshStandardMaterial({ color: 0x336699 });
    const dyed = new THREE.MeshStandardMaterial();
    attachArmorDye(dyed, { rules: [RULE] });
    const decalSource = new THREE.MeshStandardMaterial({ transparent: true });
    const keys = new Set<string>();
    for (const palette of Object.keys(SPIRIT_VEIL_PALETTES) as SpiritVeilPalette[]) {
      for (const source of [plain, dyed]) {
        keys.add(createSpiritVeilMaterial(source, palette).customProgramCacheKey());
      }
      keys.add(`decal ${createSpiritVeilMaterial(decalSource, palette).customProgramCacheKey()}`);
      keys.add(`depth ${spiritVeilDepthMaterial('depth:s:0', palette).customProgramCacheKey()}`);
    }
    expect([...keys].sort()).toEqual([
      'decal spirit-veil-decal-v2',
      'depth spirit-veil-depth-v2',
      'spirit-veil-color-v2',
    ]);
  });

  it('writes the same shader text for every palette, colour and dye, per pass: only the values move', () => {
    const texts = { color: new Set<string>(), decal: new Set<string>(), depth: new Set<string>() };
    const text = (s: Shader) => `${s.vertexShader}\n${s.fragmentShader}`;
    const dyed = new THREE.MeshStandardMaterial();
    attachArmorDye(dyed, { rules: [RULE] });
    for (const palette of Object.keys(SPIRIT_VEIL_PALETTES) as SpiritVeilPalette[]) {
      for (const source of [new THREE.MeshStandardMaterial({ color: 0x123456 }), dyed]) {
        texts.color.add(text(compiled(createSpiritVeilMaterial(source, palette))));
      }
      const decalSource = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, transparent: true });
      texts.decal.add(text(compiled(createSpiritVeilMaterial(decalSource, palette))));
      for (const key of ['depth:s:0', 'depth:r:0'])
        texts.depth.add(text(compiled(spiritVeilDepthMaterial(key, palette))));
    }
    expect(texts.color.size).toBe(1);
    expect(texts.decal.size).toBe(1);
    expect(texts.depth.size).toBe(1);
  });

  it("hands each material its palette's values, a copy of its source's colour and its dye", () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x336699 });
    const veil = createSpiritVeilMaterial(source, 'spirit');
    expect(spiritVeilPaletteOf(veil)).toBe('spirit');
    // The material itself stays white, so the monochrome body reads the same
    // texel luminance as before the knob existed.
    expect(veil.color.getHex()).toBe(0xffffff);
    const u = compiled(veil).uniforms;
    const p = SPIRIT_VEIL_PALETTES.spirit;
    expect((u.uVeilTint.value as THREE.Color).getHex()).toBe(p.tint);
    expect((u.uVeilDeep.value as THREE.Color).getHex()).toBe(p.deep);
    expect((u.uVeilRim.value as THREE.Color).getHex()).toBe(p.rim);
    expect(u.uVeilRimStrength.value).toBe(p.rimStrength);
    expect(u.uVeilOpacity.value).toBe(p.opacity);
    expect(u.uVeilRise.value).toBe(p.rise);
    expect(u.uVeilShimmer.value).toBe(p.shimmer);
    expect(u.uVeilKeepColor.value).toBe(p.keepColor);
    expect(u.uVeilBand.value).toBe(p.band);
    const src = u.uVeilSrcColor.value as THREE.Color;
    expect(src.getHex()).toBe(0x336699);
    expect(src).not.toBe(source.color);
    expect(u.uDyeCount.value).toBe(0);
    // Two materials of one palette share its uniform objects; the source
    // colour is each material's own.
    const other = compiled(createSpiritVeilMaterial(new THREE.MeshStandardMaterial(), 'spirit'));
    expect(other.uniforms.uVeilTint).toBe(u.uVeilTint);
    expect(other.uniforms.uVeilSrcColor).not.toBe(u.uVeilSrcColor);
  });

  it("carries a dyed source's rules, and none for a decal or a Lambert rebuild", () => {
    const dyed = new THREE.MeshStandardMaterial();
    attachArmorDye(dyed, { rules: [RULE, { ...RULE, ref: 90 }] });
    const u = compiled(createSpiritVeilMaterial(dyed)).uniforms;
    expect(u.uDyeCount.value).toBe(2);
    expect((u.uDyeA.value as number[]).slice(0, 8)).toEqual([40, 30, 0.1, 0.2, 90, 30, 0.1, 0.2]);
    expect((u.uDyeC.value as number[]).slice(0, 4)).toEqual([0.8, 0.9, 200, 1]);
    // The low tier's Lambert rebuild carries no spec: its flat stand-in is its
    // colour, which the veil copies.
    const lambert = new THREE.MeshLambertMaterial({ color: 0x884422 });
    lambert.userData.armorDye = { rules: [RULE] };
    const lu = compiled(createSpiritVeilMaterial(lambert)).uniforms;
    expect(lu.uDyeCount.value).toBe(0);
    expect((lu.uVeilSrcColor.value as THREE.Color).getHex()).toBe(0x884422);
    // A decal keeps its colour on `color` and multiplies nothing more.
    const decalSource = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, transparent: true });
    attachArmorDye(decalSource, { rules: [RULE] });
    const decal = createSpiritVeilMaterial(decalSource);
    expect(decal.color.getHex()).toBe(0x3a2a1a);
    const du = compiled(decal).uniforms;
    expect(du.uDyeCount.value).toBe(0);
    expect((du.uVeilSrcColor.value as THREE.Color).getHex()).toBe(0xffffff);
  });

  it('runs the dye only in the keep-colours branch, on the true colour, never on the monochrome body', () => {
    const fragment = compiled(
      createSpiritVeilMaterial(new THREE.MeshStandardMaterial()),
    ).fragmentShader;
    const branch = fragment.indexOf('if ( uVeilKeepColor > 0.0 ) {');
    const lum = fragment.indexOf('float veilLum = dot( diffuseColor.rgb');
    const dyeRead = fragment.indexOf('vec3 dyeSrgb = wocLin2Srgb(veilTrue);');
    const dyeWrite = fragment.indexOf('veilTrue = wocSrgb2Lin(dyeOut);');
    expect(lum).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(lum);
    expect(fragment.indexOf('vec3 veilTrue = diffuseColor.rgb * uVeilSrcColor;')).toBeGreaterThan(
      branch,
    );
    expect(dyeRead).toBeGreaterThan(branch);
    expect(dyeWrite).toBeGreaterThan(dyeRead);
    expect(fragment).toContain('veilBody = mix( veilBody, veilTrue, uVeilKeepColor );');
    expect(fragment).not.toContain('wocLin2Srgb(diffuseColor.rgb)');
    // a decal carries no dye: its remap is compiled out of the decal variant
    expect(fragment.indexOf('#ifndef SPIRIT_VEIL_DECAL')).toBeGreaterThan(branch);
    expect(fragment.indexOf('#ifndef SPIRIT_VEIL_DECAL')).toBeLessThan(dyeRead);
    expect(fragment).toContain('uniform int uDyeCount;');
  });

  it('writes the veil right before the stock opaque write, which keeps the NaN guard', () => {
    const body = new THREE.MeshStandardMaterial();
    const decalSource = new THREE.MeshStandardMaterial({ transparent: true });
    for (const material of [
      createSpiritVeilMaterial(body),
      createSpiritVeilMaterial(decalSource),
    ]) {
      const fragment = compiled(material).fragmentShader;
      const write = '#include <opaque_fragment>';
      expect(fragment.split(write)).toHaveLength(2);
      const envmap = fragment.indexOf('#include <envmap_fragment>');
      const veilStart = fragment.indexOf('vec3 veilN = normalize( vVeilN );');
      const alpha = fragment.indexOf('diffuseColor.a');
      expect(envmap).toBeGreaterThan(0);
      expect(veilStart).toBeGreaterThan(envmap);
      expect(alpha).toBeGreaterThan(veilStart);
      expect(fragment.indexOf(write)).toBeGreaterThan(alpha);
    }
  });

  it("casts with the side three gives the source's own caster", () => {
    const cases: [THREE.Side, THREE.Side | null, THREE.Side][] = [
      [THREE.FrontSide, null, THREE.BackSide],
      [THREE.BackSide, null, THREE.FrontSide],
      [THREE.DoubleSide, null, THREE.DoubleSide],
      [THREE.FrontSide, THREE.DoubleSide, THREE.DoubleSide],
    ];
    for (const [side, shadowSide, expected] of cases) {
      const source = new THREE.MeshStandardMaterial({ side });
      source.shadowSide = shadowSide;
      const veil = createSpiritVeilMaterial(source, 'moonkin');
      // the veil itself draws both faces, so three's default would differ
      expect(veil.side).toBe(THREE.DoubleSide);
      expect(veil.shadowSide, `${side}/${shadowSide}`).toBe(expected);
    }
  });

  it('gives two palettes their own values on one shared text', () => {
    const source = new THREE.MeshStandardMaterial();
    const wolf = compiled(createSpiritVeilMaterial(source, 'wolf')).uniforms;
    const march = compiled(createSpiritVeilMaterial(source, 'march')).uniforms;
    expect((wolf.uVeilTint.value as THREE.Color).getHex()).toBe(SPIRIT_VEIL_PALETTES.wolf.tint);
    expect((march.uVeilTint.value as THREE.Color).getHex()).toBe(SPIRIT_VEIL_PALETTES.march.tint);
    expect(wolf.uVeilKeepColor.value).toBe(1);
    expect(march.uVeilBand.value).toBe(0.22);
    expect(wolf.uVeilTint).not.toBe(march.uVeilTint);
  });

  it('replays one shimmer amplitude in both passes, per palette', () => {
    const color = compiled(createSpiritVeilMaterial(new THREE.MeshStandardMaterial(), 'spirit'));
    const depthMaterial = spiritVeilDepthMaterial('depth:s:0', 'spirit');
    expect(spiritVeilPaletteOf(depthMaterial)).toBe('spirit');
    const depth = compiled(depthMaterial);
    expect(depth.uniforms.uVeilShimmer).toBe(color.uniforms.uVeilShimmer);
    const shimmer = 'transformed += veilObjN * ( uVeilShimmer / veilS )';
    expect(color.vertexShader).toContain(shimmer);
    expect(depth.vertexShader).toContain(shimmer);
    // one depth material per (palette, shape), shared by every rig
    expect(spiritVeilDepthMaterial('depth:s:0', 'spirit')).toBe(depthMaterial);
    expect(spiritVeilDepthMaterial('depth:s:4', 'spirit')).not.toBe(depthMaterial);
    const march = compiled(createSpiritVeilMaterial(new THREE.MeshStandardMaterial(), 'march'));
    const marchDepth = compiled(spiritVeilDepthMaterial('depth:s:0', 'march'));
    expect(marchDepth.uniforms.uVeilShimmer).toBe(march.uniforms.uVeilShimmer);
    expect(marchDepth.uniforms.uVeilShimmer.value).toBe(0.01);
    expect(marchDepth.uniforms.uVeilShimmer).not.toBe(depth.uniforms.uVeilShimmer);
  });
});

describe('the outfit dye layer is shared, not copied', () => {
  it("leaves the armour's own dye shader byte for byte as it was", () => {
    // The veil reuses armor_dye.ts's GLSL; the lit armour's program text must
    // not move with that refactor (a moved text is a new program for every
    // dyed piece). Hash taken from the shader before the split.
    const mat = new THREE.MeshStandardMaterial();
    attachArmorDye(mat, { rules: [RULE] });
    const shader = compiled(mat, 'standard');
    expect(createHash('sha256').update(shader.fragmentShader).digest('hex')).toBe(
      '13c2037c8d5dc896d9c18b72063d8ca2dcd5cd027fcebe07866042f2ba1e811c',
    );
    expect(mat.customProgramCacheKey()).toBe(
      'woc_armor_dye|onBeforeCompile( /* shaderobject, renderer */ ) {}',
    );
  });
});
