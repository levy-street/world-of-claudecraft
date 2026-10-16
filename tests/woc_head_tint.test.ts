// The WOC head tint layer (src/render/characters/woc_head_tint.ts): one program
// per role and base program (a colour is a uniform write, never a relink), the
// patch lands after the map sample, and it composes with a hook the material
// already carries instead of replacing it. The body's own atlas wears its own
// skin layer (the `suit` surface: the skin band plus the gate of
// woc_skin_tint_core.ts), and the strength uniform switches any layer off.
// Hair and brow read a texel's luminance alone (times its colour's), so a grey
// texel of a coloured one's linear luminance draws what it drew (evaluated here
// on the shader's own formula), and where the emissive map is the colour map
// they glow by the texel the transfer draws, three's own lookup switched off but
// still included for the layers that anchor on it. What the skin and eye transfers
// read of a uniform colour as an HSV is converted on the CPU and bound beside it
// (tests/woc_tint_hsv_core.test.ts holds the conversion to the shader's own).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createMoonkinEffectMaterial,
  createShadowformEffectMaterial,
  createShadowformStandInMaterial,
} from '../src/render/characters/effect_materials';
import { applyEnvSheen } from '../src/render/characters/env_sheen';
import { applySoulRendOverlay } from '../src/render/characters/soul_rend_overlay';
import {
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../src/render/characters/surface_response';
import { hexToLinear, WOC_HEAD_TINT_TABLE } from '../src/render/characters/woc_head_look_core';
import {
  attachWocHeadTint,
  setWocHeadTint,
  wocHeadTintOf,
} from '../src/render/characters/woc_head_tint';
import { WOC_SUIT_SKIN_GATE_GLSL } from '../src/render/characters/woc_skin_tint_core';
import { wocTintSrgbHsv } from '../src/render/characters/woc_tint_hsv_core';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';

function compile(mat: THREE.Material): {
  fragmentShader: string;
  uniforms: Record<string, unknown>;
} {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: 'void main() {}',
    fragmentShader: 'uniform sampler2D map;\nvoid main() {\n#include <map_fragment>\n}',
  };
  mat.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe('attachWocHeadTint', () => {
  it('shares one program key per role, whatever the colour', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const ua = attachWocHeadTint(a, 'hair', [0.02, 0.02, 0.02]);
    const ub = attachWocHeadTint(b, 'hair', [0.2, 0.2, 0.2]);
    setWocHeadTint(ua, [1, 0, 0]);
    setWocHeadTint(ub, [0, 0, 1]);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const skin = new THREE.MeshStandardMaterial();
    attachWocHeadTint(skin, 'skin', [0.2, 0.1, 0.08]);
    expect(skin.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
  });

  it('patches after the map sample and binds the live uniform objects', () => {
    const m = new THREE.MeshStandardMaterial();
    const u = attachWocHeadTint(m, 'eye', [0.2, 0.2, 0.2]);
    const shader = compile(m);
    const at = shader.fragmentShader.indexOf('#include <map_fragment>');
    expect(at).toBeGreaterThan(0);
    expect(shader.fragmentShader.indexOf('uWocHtMix > 0.0')).toBeGreaterThan(at);
    expect(shader.uniforms.uWocHtTint).toBe(u.tint);
    expect(shader.uniforms.uWocHtRef).toBe(u.ref);
    // a later colour change reaches the bound uniform with no recompile
    setWocHeadTint(u, [0.1, 0.5, 0.9], 0.5);
    expect((shader.uniforms.uWocHtTint as { value: THREE.Vector3 }).value.y).toBe(0.5);
    expect(u.mix.value).toBe(0.5);
  });

  it('composes with an existing hook and folds its key in', () => {
    const m = new THREE.MeshStandardMaterial();
    let ran = 0;
    m.onBeforeCompile = () => {
      ran++;
    };
    m.customProgramCacheKey = () => 'prev_layer';
    attachWocHeadTint(m, 'skin', [0.2, 0.1, 0.08]);
    compile(m);
    expect(ran).toBe(1);
    expect(m.customProgramCacheKey()).toBe('woc_head_tint|skin|prev_layer');
  });

  it('is idempotent on one material and readable back', () => {
    const m = new THREE.MeshStandardMaterial();
    const u = attachWocHeadTint(m, 'brow', [0.02, 0.02, 0.02]);
    expect(attachWocHeadTint(m, 'brow', [0.5, 0.5, 0.5])).toBe(u);
    expect(wocHeadTintOf(m)).toBe(u);
    expect(wocHeadTintOf(new THREE.MeshStandardMaterial())).toBeNull();
  });
});

describe('the body atlas skin layer (the suit surface)', () => {
  const REF = [0.3185, 0.1714, 0.0999] as const;
  const pair = () => {
    const head = new THREE.MeshStandardMaterial();
    const body = new THREE.MeshStandardMaterial();
    const uh = attachWocHeadTint(head, 'skin', REF);
    const ub = attachWocHeadTint(body, 'skin', REF, 'suit');
    return { head, body, uh, ub };
  };

  it('is its own program, apart from a head piece skin, and still the skin colour role', () => {
    const { head, body, uh, ub } = pair();
    expect(head.customProgramCacheKey().startsWith('woc_head_tint|skin|')).toBe(true);
    expect(body.customProgramCacheKey().startsWith('woc_head_tint|skin_suit|')).toBe(true);
    expect(body.customProgramCacheKey()).not.toBe(head.customProgramCacheKey());
    // the colour it is pointed at is the look's skin colour either way
    expect(ub.role).toBe('skin');
    expect(ub.surface).toBe('suit');
    expect(uh.role).toBe('skin');
    expect(uh.surface).toBeUndefined();
    // two bodies share the one suit program, whatever their colours
    const other = new THREE.MeshStandardMaterial();
    setWocHeadTint(attachWocHeadTint(other, 'skin', [0.43, 0.2, 0.13], 'suit'), [0.04, 0.02, 0.01]);
    expect(other.customProgramCacheKey()).toBe(body.customProgramCacheKey());
  });

  it('adds the gate to the skin band on the suit layer only', () => {
    const { head, body } = pair();
    const headShader = compile(head).fragmentShader;
    const bodyShader = compile(body).fragmentShader;
    expect(bodyShader).toContain(WOC_SUIT_SKIN_GATE_GLSL);
    expect(headShader).not.toContain('(c.r - c.b)');
    // the gate line is the whole difference: band, transfer and helpers are shared
    expect(bodyShader.replace(`${WOC_SUIT_SKIN_GATE_GLSL}\n  `, '')).toBe(headShader);
    // the gate scales the band's weight BEFORE the transfer mixes by it
    const gateAt = bodyShader.indexOf(WOC_SUIT_SKIN_GATE_GLSL);
    expect(gateAt).toBeGreaterThan(bodyShader.indexOf('w *= smoothstep(0.08, 0.16, hs.z);'));
    expect(gateAt).toBeLessThan(bodyShader.indexOf('o = mix(c, t * k'));
    // no other layer carries it
    for (const role of ['hair', 'brow', 'eye'] as const) {
      const m = new THREE.MeshStandardMaterial();
      attachWocHeadTint(m, role, [0.05, 0.05, 0.05], 'suit');
      expect(m.customProgramCacheKey().startsWith(`woc_head_tint|${role}|`)).toBe(true);
      expect(compile(m).fragmentShader).not.toContain('(c.r - c.b)');
    }
  });

  it("keeps a head piece's skin band and transfer as they were", () => {
    const shader = compile(pair().head).fragmentShader;
    for (const line of [
      'float w = 1.0 - smoothstep(14.0, 26.0, abs(dh));',
      'w *= smoothstep(0.08, 0.16, hs.y) * (1.0 - smoothstep(0.8, 0.92, hs.y));',
      'w *= smoothstep(0.08, 0.16, hs.z);',
      'float k = min(lc / lr, 1.8);',
      'vec3 f = clamp((c / lc) / max(r / lr, vec3(1.0e-4)), vec3(0.5), vec3(2.0));',
      // the clamp already floors f at 0.5: the max() is the provable form of it
      'o = mix(c, t * k * pow(max(f, vec3(0.0)), vec3(0.55)), w);',
    ]) {
      expect(shader, line).toContain(line);
    }
  });

  it('is switched off by the strength uniform: the patch is skipped, nothing relinks', () => {
    const { body, ub } = pair();
    const key = body.customProgramCacheKey();
    const shader = compile(body);
    // the whole layer sits behind the strength test, so at 0 the texel draws as sampled
    const guard = shader.fragmentShader.indexOf('if (uWocHtMix > 0.0) {');
    expect(guard).toBeGreaterThan(shader.fragmentShader.indexOf('#include <map_fragment>'));
    expect(shader.fragmentShader.indexOf(WOC_SUIT_SKIN_GATE_GLSL)).toBeGreaterThan(guard);
    setWocHeadTint(ub, [0.04, 0.02, 0.01], 0);
    expect(ub.mix.value).toBe(0);
    expect(shader.uniforms.uWocHtMix).toBe(ub.mix);
    expect(body.customProgramCacheKey()).toBe(key);
    // and back on: still a uniform write
    setWocHeadTint(ub, [0.04, 0.02, 0.01]);
    expect(ub.mix.value).toBe(1);
    expect(body.customProgramCacheKey()).toBe(key);
  });

  it('survives an effect clone with its layer and its LIVE strength', () => {
    const { body, ub } = pair();
    setWocHeadTint(ub, [0.6, 0.4, 0.25], 0);
    const glow = cloneMaterialWithHooks(body);
    expect(glow.customProgramCacheKey()).toBe(body.customProgramCacheKey());
    expect(wocHeadTintOf(glow)).toBe(ub);
    expect(compile(glow).fragmentShader).toContain(WOC_SUIT_SKIN_GATE_GLSL);
    expect(wocHeadTintOf(glow)?.mix.value).toBe(0);
  });
});

describe('an effect clone of a tinted material (material_clone_hooks)', () => {
  it('keeps the tint, the program key and the LIVE uniforms', () => {
    // the buff glow and the form tints clone a body's materials: a bare clone()
    // drops onBeforeCompile, drawing the baked colours and linking a new program
    const src = new THREE.MeshStandardMaterial();
    const u = attachWocHeadTint(src, 'hair', [0.04, 0.04, 0.04]);
    setWocHeadTint(u, [0.6, 0.1, 0.05]);
    const glow = cloneMaterialWithHooks(src);
    expect(glow.customProgramCacheKey()).toBe(src.customProgramCacheKey());
    expect(wocHeadTintOf(glow)).toBe(u);
    const shader = compile(glow);
    expect(shader.fragmentShader).toContain('uWocHtTint');
    expect(shader.uniforms.uWocHtTint).toBe(u.tint);
    // a colour change after the clone still reaches it
    setWocHeadTint(u, [0.1, 0.1, 0.6]);
    expect((shader.uniforms.uWocHtTint as { value: THREE.Vector3 }).value.z).toBeCloseTo(0.6);
  });

  it('leaves an untinted material untinted', () => {
    const plain = new THREE.MeshStandardMaterial();
    const clone = cloneMaterialWithHooks(plain);
    expect(wocHeadTintOf(clone)).toBeNull();
    expect(clone.userData.wocHeadTint).toBeUndefined();
  });
});

describe('the env sheen through a clone (the WOC grey-film fix)', () => {
  it('a clone of a sheened material keeps the sheen and its program key', () => {
    const body = new THREE.MeshStandardMaterial();
    applyEnvSheen(body, 0.25);
    const clone = cloneMaterialWithHooks(body);
    expect(clone.customProgramCacheKey()).toBe(body.customProgramCacheKey());
    expect(clone.customProgramCacheKey()).toContain('env-sheen:0.250');
  });

  it('the head tint wrap keeps the sheen under the tint, and so does an effect clone of it', () => {
    const body = new THREE.MeshStandardMaterial();
    applyEnvSheen(body, 0.25);
    // what WocHeadDressing.wrap does: a hook-preserving clone, then the tint on top
    const wrapped = cloneMaterialWithHooks(body);
    attachWocHeadTint(wrapped, 'skin', [0.2, 0.1, 0.08]);
    expect(wrapped.customProgramCacheKey()).toContain('env-sheen:0.250');
    expect(wrapped.customProgramCacheKey().startsWith('woc_head_tint|skin|')).toBe(true);
    const glow = cloneMaterialWithHooks(wrapped);
    expect(glow.customProgramCacheKey()).toBe(wrapped.customProgramCacheKey());
    expect(wocHeadTintOf(glow)).toBe(wocHeadTintOf(wrapped));
  });
});

const LIBS = ['standard', 'lambert'] as const;
type Lib = (typeof LIBS)[number];

/** Run a material's hook over three's own sources for a shader (includes unresolved). */
function compileLib(mat: THREE.Material, lib: Lib): { fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  mat.onBeforeCompile(shader as never, {} as never);
  return shader;
}

const tinted = (role: 'skin' | 'eye' | 'hair' | 'brow', lib: Lib = 'standard'): THREE.Material => {
  const m = lib === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();
  attachWocHeadTint(m, role, [0.1, 0.1, 0.1]);
  return m;
};

/** The hair and brow patch body after the map sample (literal: the shipped text): the
 *  luminance of the texel three's map chunk sampled, times the material colour's. */
const ROLE_HAIR_BODY = [
  '  vec3 o = c;',
  '  #ifdef USE_MAP',
  '  float l = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));',
  '#else',
  '  float l = 1.0;',
  '#endif',
  '  l *= dot(diffuse, vec3(0.2126, 0.7152, 0.0722));',
  '  o = t * clamp(l / max(r.x, 1.0e-4), 0.0, 3.0);',
  '  diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHtMix);',
].join('\n');

/** The hair and brow emissive map stage, ahead of three's chunk switched off (literal). */
const ROLE_HAIR_GLOW = [
  '#ifdef USE_EMISSIVEMAP',
  '  vec3 wocGlow = texture2D( emissiveMap, vEmissiveMapUv ).rgb;',
  '  if (uWocHtMix > 0.0) {',
  '    vec3 t = uWocHtTint;',
  '    vec3 r = uWocHtRef;',
  '    float l = dot(wocGlow, vec3(0.2126, 0.7152, 0.0722));',
  '    vec3 o = wocGlow;',
  '    o = t * clamp(l / max(r.x, 1.0e-4), 0.0, 3.0);',
  '    wocGlow = mix(wocGlow, max(o, vec3(0.0)), uWocHtMix);',
  '  }',
  '  totalEmissiveRadiance *= wocGlow;',
  '#endif',
  '#ifdef USE_EMISSIVEMAP',
  '  #define WOC_HM_USE_EMISSIVEMAP',
  '  #undef USE_EMISSIVEMAP',
  '#endif',
  '#include <emissivemap_fragment>',
  '#ifdef WOC_HM_USE_EMISSIVEMAP',
  '  #define USE_EMISSIVEMAP',
  '  #undef WOC_HM_USE_EMISSIVEMAP',
  '#endif',
].join('\n');

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('what the skin and eye transfers read off the CPU', () => {
  const REF = [0.2346, 0.1195, 0.0865] as const;
  const single = (values: readonly number[]): number[] => values.map((v) => Math.fround(v));

  it('converts the reference once, at attach: its sRGB hue and saturation ride their own uniform', () => {
    const m = new THREE.MeshStandardMaterial();
    const u = attachWocHeadTint(m, 'skin', REF);
    expect(u.refHs.value.toArray()).toEqual(wocTintSrgbHsv(REF).slice(0, 2));
    // literal, worked by hand from the gamma curve: an orange of hue 0.046 at saturation 0.365
    expect(u.refHs.value.x).toBeCloseTo(0.046, 3);
    expect(u.refHs.value.y).toBeCloseTo(0.365, 3);
    // the reference itself is untouched: the transfer still reads its luminance and its chroma
    expect(u.ref.value.toArray()).toEqual([...REF]);
    const shader = compile(m);
    expect(shader.uniforms.uWocHtRefHs).toBe(u.refHs);
    expect(shader.uniforms.uWocHtTintHsv).toBe(u.tintHsv);
    expect(shader.fragmentShader).toContain('uniform vec2 uWocHtRefHs;');
    expect(shader.fragmentShader).toContain('uniform vec3 uWocHtTintHsv;');
    // a colour write never moves it: the reference is the material's, for good
    setWocHeadTint(u, [0.9, 0.1, 0.3]);
    expect(u.refHs.value.toArray()).toEqual(wocTintSrgbHsv(REF).slice(0, 2));
  });

  it("converts the eye colour with every write, and no other role's", () => {
    const eye = attachWocHeadTint(new THREE.MeshStandardMaterial(), 'eye', [0.227, 0.1845, 0.1651]);
    // born pointed at white
    expect(eye.tintHsv.value.toArray()).toEqual([0, 0, 1]);
    const hsv = eye.tintHsv.value;
    setWocHeadTint(eye, [0.0625, 0.5, 0.75]);
    expect(eye.tintHsv.value).toBe(hsv);
    expect(hsv.toArray()).toEqual(wocTintSrgbHsv([0.0625, 0.5, 0.75]));
    // literal, by hand: a sky blue, hue 0.541 (195 degrees)
    expect(hsv.x).toBeCloseTo(0.5414, 3);
    expect(hsv.y).toBeCloseTo(0.6768, 3);
    expect(eye.tint.value.toArray()).toEqual([0.0625, 0.5, 0.75]);
    setWocHeadTint(eye, [0.6, 0.1, 0.1], 0.5);
    expect(single(hsv.toArray())).toEqual(single(wocTintSrgbHsv([0.6, 0.1, 0.1])));
    expect(hsv.x).toBeLessThan(0.01);
    // the eye's own reference: the saturation its iris test starts above
    expect(eye.refHs.value.y).toBeCloseTo(0.135, 3);
    // skin, hair and brow read their colour as it is: nothing is converted for them
    for (const role of ['skin', 'hair', 'brow'] as const) {
      const u = attachWocHeadTint(new THREE.MeshStandardMaterial(), role, [0.1, 0.1, 0.1]);
      setWocHeadTint(u, [0.0625, 0.5, 0.75]);
      expect(u.tintHsv.value.toArray(), role).toEqual([0, 0, 1]);
    }
  });

  it('declares in each layer only the constants its transfer reads', () => {
    const body = (role: 'skin' | 'eye' | 'hair' | 'brow', surface?: 'suit'): string => {
      const m = new THREE.MeshStandardMaterial();
      attachWocHeadTint(m, role, [0.2, 0.1, 0.08], surface);
      const text = compile(m).fragmentShader;
      return text.slice(text.indexOf('if (uWocHtMix > 0.0) {'));
    };
    const RK = 'vec2 rk = uWocHtRefHs;';
    const TK = 'vec3 tk = uWocHtTintHsv;';
    // the skin band is centred on the reference's hue
    for (const text of [body('skin'), body('skin', 'suit')]) {
      expect(text).toContain(`vec3 r = uWocHtRef;\n  ${RK}\n  vec3 o = c;`);
      expect(text).not.toContain(TK);
      expect(text).toContain('float dh = mod((hs.x - rk.x) * 360.0 + 540.0, 360.0) - 180.0;');
    }
    // the iris test starts above the reference's saturation, the iris takes the target's HSV
    const eye = body('eye');
    expect(eye).toContain(`vec3 r = uWocHtRef;\n  ${RK}\n  ${TK}\n  vec3 o = c;`);
    expect(eye).toContain(
      'float w = smoothstep(rk.y + 0.08, rk.y + 0.22, hs.y) * smoothstep(0.03, 0.1, hs.z);',
    );
    expect(eye).toContain(
      'vec3 iris = wocHtSrgb2Lin(wocHtHsv2Rgb(vec3(tk.x, tk.y, clamp(hs.z * (0.4 + tk.z), 0.0, 1.0))));',
    );
    // hair and brow read neither
    for (const role of ['hair', 'brow'] as const) {
      expect(body(role), role).not.toContain(' rk');
      expect(body(role), role).not.toContain(' tk');
    }
    // one conversion a fragment in the skin and eye layers (the texel's), none of a uniform
    for (const text of [body('skin'), body('skin', 'suit'), eye]) {
      expect(count(text, 'wocHtRgb2Hsv(')).toBe(1);
      expect(text).toContain('vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));');
    }
  });

  it('an effect clone shares the converted constants with its source', () => {
    const src = new THREE.MeshStandardMaterial();
    const u = attachWocHeadTint(src, 'eye', [0.227, 0.1845, 0.1651]);
    const glow = cloneMaterialWithHooks(src);
    const shader = compile(glow);
    expect(shader.uniforms.uWocHtRefHs).toBe(u.refHs);
    expect(shader.uniforms.uWocHtTintHsv).toBe(u.tintHsv);
    // a colour written after the clone reaches it converted
    setWocHeadTint(u, [0.1, 0.6, 0.1]);
    expect((shader.uniforms.uWocHtTintHsv as { value: THREE.Vector3 }).value.x).toBeCloseTo(
      1 / 3,
      9,
    );
  });
});

describe('the hair and brow transfer reads a texel by its luminance alone', () => {
  it.each(LIBS)('takes the luminance of the sampled texel times the colour on %s', (lib) => {
    for (const role of ['hair', 'brow'] as const) {
      const { fragmentShader } = compileLib(tinted(role, lib), lib);
      expect(count(fragmentShader, ROLE_HAIR_BODY), `${lib} ${role}`).toBe(1);
      // nothing reads the luminance of the texel times the colour any more
      expect(fragmentShader, `${lib} ${role}`).not.toContain('float l = dot(c,');
      // right after three's map chunk, which leaves the texel where the body reads it
      expect(fragmentShader.indexOf(ROLE_HAIR_BODY)).toBeGreaterThan(
        fragmentShader.indexOf('#include <map_fragment>'),
      );
    }
    expect(THREE.ShaderChunk.map_fragment).toContain(
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
    );
    expect(THREE.ShaderChunk.map_fragment).toContain('diffuseColor *= sampledDiffuseColor;');
    expect(THREE.ShaderLib[lib].fragmentShader).toContain(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
    );
  });

  // The formula the lines above run (and the merged layer's, over its slot's texel and
  // colour: tests/woc_head_merged_tint.test.ts), evaluated: the transfer's luminance is the
  // texel's times the colour's, where it used to be the luminance of their product.
  type Rgb = readonly [number, number, number];
  const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const scaled = (target: Rgb, l: number, ref: number): Rgb => {
    const k = Math.min(3, Math.max(0, l / Math.max(ref, 1e-4)));
    return [target[0] * k, target[1] * k, target[2] * k];
  };
  const transfer = (texel: Rgb, colour: Rgb, target: Rgb, ref: number): Rgb =>
    scaled(target, lum(texel) * lum(colour), ref);
  const transferBefore = (texel: Rgb, colour: Rgb, target: Rgb, ref: number): Rgb =>
    scaled(target, lum([texel[0] * colour[0], texel[1] * colour[1], texel[2] * colour[2]]), ref);
  const linearOf = (c: THREE.Color): Rgb => [c.r, c.g, c.b];
  const colourOf = (m: THREE.Material): Rgb => linearOf((m as THREE.MeshStandardMaterial).color);
  const close = (a: Rgb, b: Rgb, digits = 12): void => {
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], digits);
  };

  // an auburn strand texel of the colour paint, and the grey texel of its linear luminance
  const AUBURN: Rgb = hexToLinear(0x8a4a2a);
  const GREY: Rgb = [lum(AUBURN), lum(AUBURN), lum(AUBURN)];
  // the colours a hair material draws with: white on every normal draw (the packs' hair
  // materials are white, and the low tier's lift lerps toward white), and each effect overlay
  // that recolours it. Shadowform is no longer one: it keeps the material's own colour and
  // darkens in the shader, by height (the last test of this block pins that it stays white).
  const NORMAL: Rgb = [1, 1, 1];
  const OVERLAYS: Record<string, Rgb> = {
    moonkin: colourOf(createMoonkinEffectMaterial(new THREE.MeshStandardMaterial())),
    soulRend: colourOf(applySoulRendOverlay(new THREE.MeshStandardMaterial())),
  };
  const TARGETS: Rgb[] = [hexToLinear(0x2b1a12), hexToLinear(0xe6cc8a), hexToLinear(0xb0381e)];
  const REFS = [
    WOC_HEAD_TINT_TABLE.a.hair_swept.ref[0],
    WOC_HEAD_TINT_TABLE.a.hair_quiff.ref[0],
    WOC_HEAD_TINT_TABLE.b.hair_crown.ref[0],
  ];

  it('draws a grey texel exactly as the coloured texel of the same linear luminance', () => {
    expect(GREY[0]).toBeGreaterThan(0);
    for (const target of TARGETS) {
      for (const ref of REFS) {
        for (const colour of [NORMAL, [0.5, 0.5, 0.5] as Rgb, ...Object.values(OVERLAYS)]) {
          close(transfer(AUBURN, colour, target, ref), transfer(GREY, colour, target, ref));
        }
      }
    }
  });

  it('is what it was on every normal draw, to float rounding', () => {
    for (const target of TARGETS) {
      for (const ref of REFS) {
        for (const texel of [AUBURN, GREY]) {
          close(transfer(texel, NORMAL, target, ref), transferBefore(texel, NORMAL, target, ref));
        }
      }
    }
  });

  it('moves only under a coloured overlay, which no longer sees the paint hue', () => {
    const target = TARGETS[1];
    const ref = REFS[1];
    for (const [name, colour] of Object.entries(OVERLAYS)) {
      // the overlays are not grey: that is why their draw changes, once
      expect(Math.max(...colour) - Math.min(...colour), name).toBeGreaterThan(0.01);
      // before: an auburn and a grey texel of one luminance drew apart under the overlay
      const before = [
        transferBefore(AUBURN, colour, target, ref),
        transferBefore(GREY, colour, target, ref),
      ];
      expect(Math.abs(before[0][1] / before[1][1] - 1), name).toBeGreaterThan(0.02);
      // now: they draw alike, the overlay darkening by its luminance alone
      close(transfer(AUBURN, colour, target, ref), transfer(GREY, colour, target, ref));
      close(transfer(GREY, colour, target, ref), scaled(target, lum(GREY) * lum(colour), ref));
    }
  });

  it('is left alone by Shadowform, which draws hair with its normal colour', () => {
    for (const mint of [createShadowformEffectMaterial, createShadowformStandInMaterial]) {
      const colour = colourOf(mint(new THREE.MeshStandardMaterial()));
      expect(colour).toEqual(NORMAL);
    }
  });

  it('glows a grey texel as the coloured one where the emissive map is the colour map', () => {
    // the emissive stage's transfer: the texel's own luminance over the reference
    const glow = (texel: Rgb, target: Rgb, ref: number): Rgb => scaled(target, lum(texel), ref);
    for (const target of TARGETS) {
      for (const ref of REFS) close(glow(AUBURN, target, ref), glow(GREY, target, ref));
    }
  });
});

describe('the hair and brow emissive map stage', () => {
  it.each(LIBS)(
    "glows by the transferred texel on %s, three's own lookup switched off but kept",
    (lib) => {
      for (const role of ['hair', 'brow'] as const) {
        const { fragmentShader } = compileLib(tinted(role, lib), lib);
        expect(count(fragmentShader, ROLE_HAIR_GLOW), `${lib} ${role}`).toBe(1);
        expect(count(fragmentShader, '#include <emissivemap_fragment>')).toBe(1);
        // the stage's lookup is the one three's chunk makes: the same map, the same uv
        expect(THREE.ShaderChunk.emissivemap_fragment).toContain(
          'vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );',
        );
        // after the map stage's tint (the uniforms it reads are the same ones)
        expect(fragmentShader.indexOf(ROLE_HAIR_GLOW)).toBeGreaterThan(
          fragmentShader.indexOf(ROLE_HAIR_BODY),
        );
      }
    },
  );

  it.each(LIBS)('leaves the skin and eye layers the emissive chunk three ships on %s', (lib) => {
    for (const role of ['skin', 'eye'] as const) {
      const { fragmentShader } = compileLib(tinted(role, lib), lib);
      expect(fragmentShader, `${lib} ${role}`).not.toContain('wocGlow');
      expect(fragmentShader, `${lib} ${role}`).not.toContain('WOC_HM_USE_EMISSIVEMAP');
      expect(count(fragmentShader, '#include <emissivemap_fragment>')).toBe(1);
    }
    const suit =
      lib === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();
    attachWocHeadTint(suit, 'skin', [0.3, 0.17, 0.1], 'suit');
    expect(compileLib(suit, lib).fragmentShader).not.toContain('wocGlow');
  });

  it.each(LIBS)('keeps the anchor a later layer (the hit response) finds on %s', (lib) => {
    const mat = tinted('hair', lib);
    const struck = createSurfaceResponseMaterial(mat, surfaceResponseUniforms());
    expect(wocHeadTintOf(struck)).toBe(wocHeadTintOf(mat));
    const { fragmentShader } = compileLib(struck, lib);
    const emission = 'totalEmissiveRadiance+=surfaceEmission;';
    expect(count(fragmentShader, emission)).toBe(1);
    // right after the kept include, so it adds to the glow AFTER the texel scaled it
    expect(fragmentShader).toContain(`#include <emissivemap_fragment>\n${emission}`);
    expect(fragmentShader.indexOf(emission)).toBeGreaterThan(
      fragmentShader.indexOf('totalEmissiveRadiance *= wocGlow;'),
    );
  });

  it('keeps one program per role: the key is the layer and the base key, as before', () => {
    const a = tinted('hair');
    const b = tinted('hair');
    const ua = wocHeadTintOf(a);
    expect(ua).not.toBeNull();
    if (ua) setWocHeadTint(ua, [1, 0.8, 0.5]);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey().startsWith('woc_head_tint|hair|')).toBe(true);
    expect(tinted('brow').customProgramCacheKey().startsWith('woc_head_tint|brow|')).toBe(true);
    // the one text both compile to
    expect(compileLib(a, 'standard').fragmentShader).toBe(compileLib(b, 'standard').fragmentShader);
  });
});
