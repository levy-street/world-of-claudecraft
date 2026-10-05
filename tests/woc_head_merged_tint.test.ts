// The MERGED WOC head tint layer (src/render/characters/woc_head_tint.ts
// attachWocHeadMergedTint): one material draws a whole head, each vertex carrying the
// slot of the material it came from, and the fragment reads that slot's rows (tint
// role and reference, colour, emissive, roughness, metalness, sidedness, texture layer)
// out of small uniform tables. Run here against three's REAL shader sources (ShaderLib,
// the text the hook is handed before the includes resolve): the patch lands on the
// chunks it names on the standard shader and on the low tier's Lambert (the map, the
// emissive map, and on the standard shader the roughness and metalness) and KEEPS each
// chunk's include, switched off or fed the slot's value, so a layer attached later (the
// hit response) still finds its anchors; a head with a one sided slot compiles the
// back-face drop and no other head does; the uniform objects it binds are the ones a
// later write reaches; every merged head of a variant shares one program; the layer
// composes with the hooks a material wears before AND after it and survives an effect
// clone; and the slot and colour writers put each number in the row and component the
// GLSL reads it from.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyEnvSheen } from '../src/render/characters/env_sheen';
import {
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../src/render/characters/surface_response';
import {
  WOC_HEAD_MERGE_LAYER,
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLE_CODE,
  WOC_HEAD_MERGE_ROLES,
  WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
  type WocHeadMergeLayer,
  type WocHeadMergeSlot,
} from '../src/render/characters/woc_head_merge_core';
import {
  attachWocHeadMergedTint,
  attachWocHeadTint,
  reapplyWocHeadTintToClone,
  setWocHeadMergedColors,
  setWocHeadMergedSlots,
  type WocHeadMergedTintUniforms,
  type WocHeadMergeSurface,
  wocHeadMergedTintOf,
  wocHeadMergeOneSided,
  wocHeadTintOf,
} from '../src/render/characters/woc_head_tint';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import { threeProgramKeys } from './helpers/three_program_keys';

const N = WOC_HEAD_MERGE_MAX_SLOTS;
const LIBS = ['standard', 'lambert'] as const;
type Lib = (typeof LIBS)[number];

interface Compiled {
  uniforms: Record<string, unknown>;
  vertexShader: string;
  fragmentShader: string;
}

/** Run a material's hook over three's own sources for a shader, the way WebGLPrograms
 *  hands them over (includes still unresolved). */
function compile(mat: THREE.Material, lib: Lib = 'standard'): Compiled {
  const shader: Compiled = {
    uniforms: {},
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  mat.onBeforeCompile(shader as never, {} as never);
  return shader;
}

/** The per-role layer's own patch body for a role (what woc_head_tint.ts splices after
 *  the map sample for it), cut out of a compiled per-role material. */
function roleTransfer(role: 'skin' | 'eye' | 'hair' | 'brow'): string {
  const m = new THREE.MeshStandardMaterial();
  attachWocHeadTint(m, role, [0.2, 0.1, 0.08]);
  const { fragmentShader } = compile(m);
  const from = fragmentShader.indexOf('vec3 o = c;\n') + 'vec3 o = c;\n'.length;
  const to = fragmentShader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHtMix);');
  expect(from, `${role}: patch start`).toBeGreaterThan('vec3 o = c;\n'.length);
  expect(to, `${role}: patch end`).toBeGreaterThan(from);
  return fragmentShader.slice(from, to).trim();
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** The sampler the patched fragment reads for a texture layer code: the first branch of
 *  its `wocCol.a < x` chain the code passes, the way the GLSL runs it. */
function samplerOfLayer(fragment: string, layer: number): string | null {
  const chain = fragment.matchAll(
    /(?:else )?(?:if \(wocCol\.a < ([\d.]+)\) )?sampledDiffuseColor = textureGrad\( (\w+),/g,
  );
  for (const [, below, sampler] of chain) {
    if (below === undefined || layer < Number(below)) return sampler;
  }
  return null;
}

/** Which sampler each texture layer of the core reads in a patched fragment. */
const samplers = (fragment: string): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(WOC_HEAD_MERGE_LAYER).map(([name, code]) => [
      name,
      samplerOfLayer(fragment, code),
    ]),
  );

const material = (lib: Lib): THREE.Material =>
  lib === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();

/** A merged material and its uniforms (the two sided variant unless told otherwise). */
function merged(
  oneSided?: boolean,
  lib: Lib = 'standard',
): { mat: THREE.Material; u: WocHeadMergedTintUniforms } {
  const mat = material(lib);
  return { mat, u: attachWocHeadMergedTint(mat, oneSided) };
}

/** The hair and brow transfer line, shared by the per-role layer, the merged layer's hair
 *  branch and both emissive stages (literal: the shipped text). */
const HAIR_TRANSFER = 'o = t * clamp(l / max(r.x, 1.0e-4), 0.0, 3.0);';

/** What the merged emissive map stage compiles to on a material with an emissive map, as the
 *  kept() walk trims it: the glow scaled by the slot's own texel, and for a hair or brow slot
 *  (role code 3 or 4) by that texel as the hair transfer draws it, at the layer's strength
 *  (literal: the shipped text). */
const GLOW_STAGE = [
  'vec3 wocGlow = wocTexel.rgb;',
  'if (uWocHmMix > 0.0 && wocRef.a > 2.5) {',
  'vec3 t = wocRef.a < 3.5 ? uWocHmTint[2] : uWocHmTint[3];',
  'vec3 r = wocRef.rgb;',
  'float l = dot(wocGlow, vec3(0.2126, 0.7152, 0.0722));',
  'vec3 o = wocGlow;',
  HAIR_TRANSFER,
  'wocGlow = mix(wocGlow, max(o, vec3(0.0)), uWocHmMix);',
  '}',
  'totalEmissiveRadiance *= wocGlow;',
].join('\n');

/** The discard a one sided slot's back faces take, and the one every fragment of such a
 *  slot takes in a pass three draws with the winding flipped. */
const DROP = 'if (uWocHmSurf[wocSlot].y > 0.5 && !gl_FrontFacing) discard;';
const DROP_FLIPPED = 'if (uWocHmSurf[wocSlot].y > 0.5) discard;';

/** The three chunks the merged layer wraps, as three resolves their includes. */
const WRAPPED_CHUNKS = [
  'map_fragment',
  'emissivemap_fragment',
  'roughnessmap_fragment',
  'metalnessmap_fragment',
] as const;

/**
 * What a compiler keeps of a piece of the patched shader under a set of defines: the
 * wrapped chunks' includes resolved, the plain `#ifdef` / `#ifndef` / `#else` / `#endif`
 * / `#define` / `#undef` directives walked, object-like macros expanded. That is every
 * directive the merged layer's own text and those four chunks use; any other throws, so
 * a text this walk cannot follow never passes by accident. Not a GLSL validator: it
 * says which lines are live and what a name means on them, nothing more.
 */
function kept(text: string, defined: readonly string[] = []): { code: string; defines: string[] } {
  let source = text;
  for (const chunk of WRAPPED_CHUNKS) {
    source = source.replaceAll(`#include <${chunk}>`, THREE.ShaderChunk[chunk]);
  }
  const defines = new Map<string, string>(defined.map((name) => [name, '']));
  const open: boolean[] = [];
  const live = (): boolean => open.every(Boolean);
  const lines: string[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const directive = /^#\s*(\w+)\s*(.*)$/.exec(line);
    if (!directive) {
      if (!live() || line === '') continue;
      let out = line;
      for (const [name, value] of defines) {
        if (value !== '') out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), value);
      }
      lines.push(out);
      continue;
    }
    const [, word, rest] = directive;
    const [name, ...value] = rest.trim().split(/\s+/);
    if (word === 'ifdef') open.push(defines.has(name));
    else if (word === 'ifndef') open.push(!defines.has(name));
    else if (word === 'else') open.push(!open.pop());
    else if (word === 'endif') open.pop();
    else if (word === 'define') {
      if (live()) defines.set(name, value.join(' '));
    } else if (word === 'undef') {
      if (live()) defines.delete(name);
    } else throw new Error(`kept(): a directive this walk does not follow: ${line}`);
  }
  if (open.length > 0) throw new Error('kept(): a conditional is left open');
  return { code: lines.join('\n'), defines: [...defines.keys()].sort() };
}

/** The text of a patched shader from one of three's includes (exclusive) to another. */
function span(fragment: string, after: string, before: string): string {
  const from = fragment.indexOf(`#include <${after}>`);
  const to = fragment.indexOf(`#include <${before}>`);
  expect(from, after).toBeGreaterThan(-1);
  expect(to, before).toBeGreaterThan(from);
  return fragment.slice(from + `#include <${after}>`.length, to);
}

/** Where the map chunk sits in either shader: the merged layer's own work. */
const mapStage = (fragment: string): string =>
  span(fragment, 'logdepthbuf_fragment', 'color_fragment');
/** Where the emissive map chunk sits, per shader. */
const emissiveStage = (fragment: string, lib: Lib): string =>
  lib === 'standard'
    ? span(fragment, 'clearcoat_normal_fragment_maps', 'lights_physical_fragment')
    : span(fragment, 'normal_fragment_maps', 'lights_lambert_fragment');
/** Where the roughness and metalness chunks sit (the standard shader only). */
const surfaceStage = (fragment: string): string =>
  span(fragment, 'alphahash_fragment', 'normal_fragment_begin');

const includesOf = (text: string): string[] => text.match(/#include <\w+>/g) ?? [];

/** A shader with every `#include <name>` resolved the way three resolves them
 *  (WebGLProgram: recursively, out of ShaderChunk). */
function resolved(text: string): string {
  return text.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    if (chunk === undefined) throw new Error(`three ships no chunk <${name}>`);
    return resolved(chunk);
  });
}

describe('attachWocHeadMergedTint: the vertex stage', () => {
  it('declares the slot attribute and hands it to the fragment after begin_vertex', () => {
    const { vertexShader } = compile(merged().mat);
    const main = vertexShader.indexOf('void main() {');
    const attribute = vertexShader.indexOf('attribute float aWocHmSlot;');
    // a plain varying: a triangle's three vertices carry one slot, so the interpolated
    // value is that slot (the fragment rounds it)
    const varying = vertexShader.indexOf('varying float vWocHmSlot;');
    expect(vertexShader).not.toContain('flat varying');
    expect(attribute).toBeGreaterThan(-1);
    expect(attribute).toBeLessThan(main);
    expect(varying).toBeGreaterThan(-1);
    expect(varying).toBeLessThan(main);
    // assigned inside main, right after the chunk that opens the vertex transform
    expect(vertexShader).toContain('#include <begin_vertex>\nvWocHmSlot = aWocHmSlot;');
    expect(vertexShader.indexOf('vWocHmSlot = aWocHmSlot;')).toBeGreaterThan(main);
    expect(count(vertexShader, 'vWocHmSlot = aWocHmSlot;')).toBe(1);
    expect(count(vertexShader, 'attribute float aWocHmSlot;')).toBe(1);
    // the name the near merge and the far bake write their slot bytes under
    expect(WOC_HEAD_MERGE_SLOT_ATTRIBUTE).toBe('aWocHmSlot');
  });

  it("adds to three's vertex shader and changes nothing else of it, either variant", () => {
    for (const lib of LIBS) {
      for (const oneSided of [false, true]) {
        const { vertexShader } = compile(merged(oneSided, lib).mat, lib);
        const stripped = vertexShader
          .replace('attribute float aWocHmSlot;\nvarying float vWocHmSlot;\n', '')
          .replace('\nvWocHmSlot = aWocHmSlot;', '');
        expect(stripped, `${lib} ${oneSided}`).toBe(THREE.ShaderLib[lib].vertexShader);
        expect(vertexShader, `${lib} ${oneSided}`).not.toBe(THREE.ShaderLib[lib].vertexShader);
      }
    }
  });
});

describe('attachWocHeadMergedTint: the fragment stage on the standard shader', () => {
  const { fragmentShader } = compile(merged().mat);
  const main = fragmentShader.indexOf('void main() {');

  it("samples one of four textures, picked by the layer, with three's own lookup switched off", () => {
    // beside the core atlas on `map`: the hairstyle's, the beard's and the scalp cap's
    for (const sampler of ['uWocHmHair', 'uWocHmBeard', 'uWocHmScalp']) {
      const declared = fragmentShader.indexOf(`uniform sampler2D ${sampler};`);
      expect(declared, sampler).toBeGreaterThan(-1);
      expect(declared, sampler).toBeLessThan(main);
      expect(count(fragmentShader, `uniform sampler2D ${sampler};`), sampler).toBe(1);
    }
    // the layer rides the colour row's w, and each code picks its own texture
    expect(WOC_HEAD_MERGE_LAYER).toEqual({ atlas: 0, hair: 1, beard: 2, scalp: 3 });
    expect(samplers(fragmentShader)).toEqual({
      atlas: 'map',
      hair: 'uWocHmHair',
      beard: 'uWocHmBeard',
      scalp: 'uWocHmScalp',
    });
    // literal: the end of the chain as a shipped program runs it
    expect(fragmentShader).toContain(
      'else sampledDiffuseColor = textureGrad( uWocHmScalp, vMapUv, wocDx, wocDy );',
    );
    // what a textured material compiles of the stage: the four layered lookups share
    // the one uv and the gradients taken before any branch
    const { code, defines } = kept(mapStage(fragmentShader), ['USE_MAP']);
    expect(count(code, 'textureGrad(')).toBe(4);
    expect(count(code, ', vMapUv, wocDx, wocDy );')).toBe(4);
    const gradient = code.indexOf('vec2 wocDx = dFdx( vMapUv );');
    expect(gradient).toBeGreaterThan(-1);
    expect(gradient).toBeLessThan(code.indexOf('textureGrad('));
    expect(code.indexOf('vec2 wocDy = dFdy( vMapUv );')).toBeLessThan(code.indexOf('textureGrad('));
    // three's own chunk is still included (a later layer anchors on it), but compiles to
    // nothing: its plain lookup would sample the atlas for a hair or beard slot, and
    // multiply the texel in a second time
    expect(count(fragmentShader, '#include <map_fragment>')).toBe(1);
    expect(THREE.ShaderChunk.map_fragment).toContain('texture2D( map, vMapUv )');
    expect(code).not.toContain('texture2D(');
    expect(count(code, 'vec4 sampledDiffuseColor')).toBe(1);
    expect(count(code, 'diffuseColor *= sampledDiffuseColor;')).toBe(1);
    // ...and the define it was switched off with is back for everything after it
    expect(defines).toEqual(['USE_MAP']);
  });

  it('touches the map only under USE_MAP, exactly where the map chunk sits', () => {
    // an untextured material compiles no read of the map's uv and no lookup at all
    const bare = kept(mapStage(fragmentShader));
    expect(bare.code).not.toContain('vMapUv');
    expect(bare.code).not.toContain('textureGrad(');
    expect(bare.code).not.toContain('texture2D(');
    expect(bare.code).not.toContain('sampledDiffuseColor');
    // it still reads its slot, takes the slot's colour and runs the tint
    expect(bare.code).toContain('vec4 wocTexel = vec4( 1.0 );');
    expect(bare.code).toContain('diffuseColor.rgb *= wocCol.rgb;');
    expect(bare.code).toContain('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);');
    // ...and gains no define it did not have
    expect(bare.defines).toEqual([]);
    // every word of the layer's own map work sits between the chunks that flank the map
    const first = fragmentShader.indexOf('int wocSlot');
    const last = fragmentShader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);');
    expect(first).toBeGreaterThan(fragmentShader.indexOf('#include <logdepthbuf_fragment>'));
    expect(last).toBeLessThan(fragmentShader.indexOf('#include <color_fragment>'));
    // the kept include comes AFTER it: what a later layer splices behind the map chunk
    // reads the tinted colour
    expect(fragmentShader.indexOf('#include <map_fragment>')).toBeGreaterThan(last);
    expect(fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(
      fragmentShader.indexOf('#include <color_fragment>'),
    );
    const outside = fragmentShader.replace(mapStage(fragmentShader), '');
    expect(outside).not.toContain('vMapUv');
    expect(outside).not.toContain('textureGrad(');
  });

  it('reads the rows of the slot the vertex carried', () => {
    const varying = fragmentShader.indexOf('varying float vWocHmSlot;');
    expect(varying).toBeGreaterThan(-1);
    expect(varying).toBeLessThan(main);
    expect(fragmentShader).not.toContain('flat varying');
    // rounded to the nearest slot: an interpolated value a hair off still lands on it
    const slot = fragmentShader.indexOf('int wocSlot = int(vWocHmSlot + 0.5);');
    expect(slot).toBeGreaterThan(main);
    for (const row of [
      'vec4 wocRef = uWocHmRef[wocSlot];',
      'vec4 wocCol = uWocHmCol[wocSlot];',
      'vec4 wocEmi = uWocHmEmi[wocSlot];',
    ]) {
      expect(fragmentShader.indexOf(row), row).toBeGreaterThan(slot);
    }
  });

  it('declares its tables at the sizes the core names, matching the uniform values', () => {
    const { u } = merged();
    for (const [decl, value] of [
      [`uniform vec3 uWocHmTint[${WOC_HEAD_MERGE_ROLES.length}];`, u.tints.value],
      [`uniform vec4 uWocHmRef[${N}];`, u.ref.value],
      [`uniform vec4 uWocHmCol[${N}];`, u.col.value],
      [`uniform vec4 uWocHmEmi[${N}];`, u.emi.value],
      [`uniform vec2 uWocHmSurf[${N}];`, u.surf.value],
    ] as const) {
      const at = fragmentShader.indexOf(decl);
      expect(at, decl).toBeGreaterThan(-1);
      expect(at, decl).toBeLessThan(main);
      // three uploads a uniform array by walking `value` to the GLSL size
      expect(value, decl).toHaveLength(Number(/\[(\d+)\]/.exec(decl)?.[1]));
    }
    expect(fragmentShader).toContain('uniform float uWocHmMix;');
    // literal: one colour per tinted role
    expect(fragmentShader).toContain('uniform vec3 uWocHmTint[4];');
  });

  it("draws the slot's own colour and emissive over the material's", () => {
    const colour = fragmentShader.indexOf('diffuseColor.rgb *= wocCol.rgb;');
    const emissive = fragmentShader.indexOf('totalEmissiveRadiance += wocEmi.rgb;');
    // after the texel, before the tint reads the fragment's colour
    expect(colour).toBeGreaterThan(fragmentShader.indexOf('diffuseColor *= sampledDiffuseColor;'));
    expect(fragmentShader.indexOf('diffuseColor *= sampledDiffuseColor;')).toBeGreaterThan(-1);
    expect(colour).toBeLessThan(fragmentShader.indexOf('vec3 c = diffuseColor.rgb;'));
    // three declares the emissive accumulator before the map chunk
    expect(emissive).toBeGreaterThan(
      fragmentShader.indexOf('vec3 totalEmissiveRadiance = emissive;'),
    );
    expect(emissive).toBeLessThan(fragmentShader.indexOf('#include <color_fragment>'));
  });

  it("keeps the slot's own texel for the emissive stage", () => {
    // declared whether or not the material has a map (a mapless material's texel is 1),
    // then set to the layered sample
    const declared = fragmentShader.indexOf('vec4 wocTexel = vec4( 1.0 );');
    expect(declared).toBeGreaterThan(main);
    expect(declared).toBeLessThan(fragmentShader.indexOf('#ifdef USE_MAP'));
    const kept = fragmentShader.indexOf('wocTexel = sampledDiffuseColor;');
    expect(kept).toBeGreaterThan(fragmentShader.lastIndexOf('textureGrad('));
    expect(kept).toBeLessThan(fragmentShader.indexOf('diffuseColor.rgb *= wocCol.rgb;'));
  });

  it("starts the roughness and metalness from the slot's values, through their own chunks", () => {
    // each chunk keeps its include (a later layer patches after it) and opens with
    // `float <name>Factor = <name>;`: for the length of the chunk the name means the
    // slot's value. Metalness is the x of the slot's surface row (its y is the sidedness)
    const roughness = fragmentShader.indexOf(
      '#define roughness wocEmi.a\n#include <roughnessmap_fragment>\n#undef roughness',
    );
    const metalness = fragmentShader.indexOf(
      '#define metalness uWocHmSurf[wocSlot].x\n#include <metalnessmap_fragment>\n#undef metalness',
    );
    expect(roughness).toBeGreaterThan(fragmentShader.indexOf('#include <alphahash_fragment>'));
    expect(metalness).toBeGreaterThan(roughness);
    expect(metalness).toBeLessThan(fragmentShader.indexOf('#include <normal_fragment_begin>'));
    // ...after the rows they read were declared
    expect(roughness).toBeGreaterThan(fragmentShader.indexOf('vec4 wocEmi = uWocHmEmi[wocSlot];'));
    // what the two chunks compile to: each factor declared once, from the slot's row
    const { code, defines } = kept(surfaceStage(fragmentShader));
    expect(code).toBe(
      'float roughnessFactor = wocEmi.a;\nfloat metalnessFactor = uWocHmSurf[wocSlot].x;',
    );
    // the names go back to the material's uniforms for everything after
    expect(defines).toEqual([]);
    // three's own chunks, the lines the names are redefined for
    expect(THREE.ShaderChunk.roughnessmap_fragment).toContain('float roughnessFactor = roughness;');
    expect(THREE.ShaderChunk.metalnessmap_fragment).toContain('float metalnessFactor = metalness;');
    // nothing declares either factor a second time
    expect(fragmentShader).not.toContain('float roughnessFactor');
    expect(fragmentShader).not.toContain('float metalnessFactor');
  });

  it('keeps every include of the fragment shader, in its order', () => {
    // nothing three ships is dropped: the four chunks whose work the layer does are
    // still included (switched off, or fed the slot's value), each exactly where it sat
    expect(includesOf(fragmentShader)).toEqual(includesOf(THREE.ShaderLib.standard.fragmentShader));
    for (const chunk of WRAPPED_CHUNKS) {
      expect(count(fragmentShader, `#include <${chunk}>`), chunk).toBe(1);
    }
    expect(count(fragmentShader, 'void main() {')).toBe(1);
  });

  it('lifts the define of the map and emissive map chunks for their length, and puts it back', () => {
    // literal: the guard as a shipped program carries it
    const MAP_GUARD = [
      '#ifdef USE_MAP',
      '  #define WOC_HM_USE_MAP',
      '  #undef USE_MAP',
      '#endif',
      '#include <map_fragment>',
      '#ifdef WOC_HM_USE_MAP',
      '  #define USE_MAP',
      '  #undef WOC_HM_USE_MAP',
      '#endif',
    ].join('\n');
    expect(count(fragmentShader, MAP_GUARD)).toBe(1);
    expect(
      count(
        fragmentShader,
        MAP_GUARD.replaceAll('USE_MAP', 'USE_EMISSIVEMAP').replace(
          'map_fragment',
          'emissivemap_fragment',
        ),
      ),
    ).toBe(1);
    // balanced: each define is lifted once and restored once, and the stand-in name
    // lives only inside its guard
    for (const define of ['USE_MAP', 'USE_EMISSIVEMAP']) {
      expect(count(fragmentShader, `#undef ${define}\n`), define).toBe(1);
      expect(count(fragmentShader, `#define ${define}\n`), define).toBe(1);
      expect(count(fragmentShader, `WOC_HM_${define}\n`), define).toBe(3);
      expect(fragmentShader.indexOf(`#undef ${define}\n`)).toBeLessThan(
        fragmentShader.indexOf(`#define ${define}\n`),
      );
    }
    // the same for the two names the surface chunks read: redefined, then released
    for (const name of ['roughness', 'metalness']) {
      expect(count(fragmentShader, `#define ${name} `), name).toBe(1);
      expect(count(fragmentShader, `#undef ${name}\n`), name).toBe(1);
      expect(fragmentShader.indexOf(`#define ${name} `)).toBeLessThan(
        fragmentShader.indexOf(`#undef ${name}\n`),
      );
    }
    // the layer's own work comes BEFORE each guard: the tint ahead of the map chunk, the
    // texel scale ahead of the emissive map chunk
    expect(fragmentShader).toContain(
      'diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);\n}\n#ifdef USE_MAP\n  #define WOC_HM_USE_MAP',
    );
    expect(fragmentShader).toContain(
      'totalEmissiveRadiance *= wocGlow;\n#endif\n#ifdef USE_EMISSIVEMAP\n  #define WOC_HM_USE_EMISSIVEMAP',
    );
  });
});

describe('attachWocHeadMergedTint: the back faces of a one sided slot', () => {
  // The merged head is drawn two sided, and the pieces do not agree: the back of a slot
  // whose own material was one sided is dropped in the fragment, which is what culling
  // did for the piece.
  it.each(LIBS)('carries the drop in the %s fragment, behind its own define', (lib) => {
    for (const oneSided of [true, false]) {
      // the text is one for both variants: the define picks the program
      const { fragmentShader } = compile(merged(oneSided, lib).mat, lib);
      const stage = mapStage(fragmentShader);
      const tag = `${lib} ${oneSided}`;
      expect(count(fragmentShader, '#ifdef WOC_HM_ONE_SIDED'), tag).toBe(1);
      expect(count(fragmentShader, 'discard;'), tag).toBe(2);
      // a two sided head's program drops nothing, whatever the pass
      expect(kept(stage, ['USE_MAP']).code, tag).not.toContain('discard');
      expect(kept(stage, ['USE_MAP', 'FLIP_SIDED']).code, tag).not.toContain('discard');
      // a one sided head's program drops the BACK of a one sided slot
      const drawn = kept(stage, ['USE_MAP', 'WOC_HM_ONE_SIDED']).code;
      expect(count(drawn, 'discard;'), tag).toBe(1);
      expect(drawn, tag).toContain(DROP);
      const drop = drawn.indexOf(DROP);
      // after the uv derivatives (a discard never splits their quad), before any sample
      expect(drop, tag).toBeGreaterThan(drawn.indexOf('vec2 wocDx = dFdx( vMapUv );'));
      expect(drop, tag).toBeGreaterThan(drawn.indexOf('vec2 wocDy = dFdy( vMapUv );'));
      expect(drop, tag).toBeLessThan(drawn.indexOf('textureGrad('));
      // after the slot is known
      expect(drop, tag).toBeGreaterThan(drawn.indexOf('int wocSlot = int(vWocHmSlot + 0.5);'));
      // a mapless material drops its backs too
      expect(kept(stage, ['WOC_HM_ONE_SIDED']).code, tag).toContain(DROP);
    }
  });

  it.each(LIBS)(
    'drops every fragment of a one sided slot in a %s pass drawn with the winding flipped',
    (lib) => {
      // under a translucent effect three draws a two sided material twice, backs then
      // fronts, flipping the winding for the backs pass (FLIP_SIDED): every fragment of
      // that pass reads as front facing, so the facing test alone would draw the backs
      const { fragmentShader } = compile(merged(true, lib).mat, lib);
      const flipped = kept(mapStage(fragmentShader), ['USE_MAP', 'WOC_HM_ONE_SIDED', 'FLIP_SIDED']);
      expect(count(flipped.code, 'discard;')).toBe(1);
      expect(flipped.code).toContain(`${DROP_FLIPPED}\n`);
      expect(flipped.code).not.toContain('gl_FrontFacing');
      // still only for a slot flagged one sided: a two sided slot draws in both passes
      expect(DROP_FLIPPED).toContain('uWocHmSurf[wocSlot].y > 0.5');
      // and before any sample, as in the plain pass
      expect(flipped.code.indexOf(DROP_FLIPPED)).toBeLessThan(flipped.code.indexOf('textureGrad('));
      expect(flipped.code.indexOf(DROP_FLIPPED)).toBeGreaterThan(
        flipped.code.indexOf('vec2 wocDy = dFdy( vMapUv );'),
      );
    },
  );

  it.each(LIBS)('defines WOC_HM_ONE_SIDED on the %s material only for a one sided head', (lib) => {
    const one = merged(true, lib);
    expect(one.mat.defines?.WOC_HM_ONE_SIDED).toBe('');
    expect(one.u.oneSided).toBe(true);
    for (const two of [merged(false, lib), merged(undefined, lib)]) {
      expect(two.mat.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
      expect(two.u.oneSided).toBe(false);
    }
    // what the material type already defined stays
    if (lib === 'standard') expect(one.mat.defines).toEqual({ STANDARD: '', WOC_HM_ONE_SIDED: '' });
  });

  it('is the variant asked for FIRST: a second attach never changes it', () => {
    const { mat, u } = merged(false);
    expect(attachWocHeadMergedTint(mat, true)).toBe(u);
    expect(u.oneSided).toBe(false);
    expect(mat.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
  });

  it('wocHeadMergeOneSided: a head needs the drop when ANY of its slots is one sided', () => {
    const slot = (oneSided: boolean): WocHeadMergeSlot => ({
      material: 'm',
      roleCode: 0,
      ref: [0, 0, 0],
      layer: 0,
      oneSided,
    });
    expect(wocHeadMergeOneSided([slot(false), slot(false), slot(true)])).toBe(true);
    expect(wocHeadMergeOneSided([slot(true)])).toBe(true);
    // an all two sided head (Type B) keeps the program without it
    expect(wocHeadMergeOneSided([slot(false), slot(false)])).toBe(false);
    expect(wocHeadMergeOneSided([])).toBe(false);
  });
});

describe('attachWocHeadMergedTint: the emissive map stage', () => {
  // The low tier's Lambert rebuild mounts `emissiveMap = map` on an authored atlas, so the
  // merged material's emissive map is the core atlas: sampled as three's chunk does, it
  // would light a hair or beard slot with the atlas's texels.
  it.each(LIBS)(
    "multiplies the glow by the slot's own texel where the %s shader samples the emissive map",
    (lib) => {
      const { fragmentShader } = compile(merged(false, lib).mat, lib);
      const stage = emissiveStage(fragmentShader, lib);
      // the layer's own stage, then three's chunk: still included, where it sat
      expect(count(fragmentShader, '#include <emissivemap_fragment>')).toBe(1);
      expect(stage.indexOf('totalEmissiveRadiance *= wocGlow;')).toBeGreaterThan(-1);
      expect(stage.indexOf('#include <emissivemap_fragment>')).toBeGreaterThan(
        stage.indexOf('totalEmissiveRadiance *= wocGlow;'),
      );
      // what a material with an emissive map compiles of it: the slot's texel scales the
      // glow once, and three's own lookup (the merged material's emissive map) is off
      expect(THREE.ShaderChunk.emissivemap_fragment).toContain('texture2D( emissiveMap,');
      const lit = kept(stage, ['USE_EMISSIVEMAP']);
      expect(lit.code).toBe(GLOW_STAGE);
      expect(lit.code).not.toContain('texture2D(');
      // ...with its define back for everything after
      expect(lit.defines).toEqual(['USE_EMISSIVEMAP']);
      // a material with no emissive map compiles nothing here
      expect(kept(stage)).toEqual({ code: '', defines: [] });
      // the texel it reads is the layered sample (1 on a mapless material)
      expect(fragmentShader).toContain('vec4 wocTexel = vec4( 1.0 );');
      expect(fragmentShader).toContain('wocTexel = sampledDiffuseColor;');
      // after the slot's emissive joined the accumulator: the texel scales the SLOT's glow
      expect(fragmentShader.indexOf('totalEmissiveRadiance *= wocGlow;')).toBeGreaterThan(
        fragmentShader.indexOf('totalEmissiveRadiance += wocEmi.rgb;'),
      );
      expect(count(fragmentShader, 'totalEmissiveRadiance *=')).toBe(1);
    },
  );

  it('glows a hair or brow slot by its texel as the transfer draws it, and no other slot', () => {
    // the hair and brow codes are the two past 2.5; skin and eye glow by the plain texel
    expect(WOC_HEAD_MERGE_ROLE_CODE.hair).toBeGreaterThan(2.5);
    expect(WOC_HEAD_MERGE_ROLE_CODE.brow).toBeGreaterThan(2.5);
    expect(WOC_HEAD_MERGE_ROLE_CODE.skin).toBeLessThan(2.5);
    expect(WOC_HEAD_MERGE_ROLE_CODE.eye).toBeLessThan(2.5);
    // ...with the role's own colour out of the table, as the albedo's hair branch reads it
    const { fragmentShader } = compile(merged().mat);
    const pick = 'vec3 t = wocRef.a < 3.5 ? uWocHmTint[2] : uWocHmTint[3];';
    expect(count(fragmentShader, pick)).toBe(2);
    // the glow's transfer is the albedo's own line, over the texel's luminance alone (a grey
    // texel of a coloured one's luminance glows as it did)
    expect(count(GLOW_STAGE, HAIR_TRANSFER)).toBe(1);
    expect(count(fragmentShader, HAIR_TRANSFER)).toBe(2);
  });
});

describe('attachWocHeadMergedTint: the role transfers', () => {
  const { fragmentShader } = compile(merged().mat);

  it('tints only a tinted slot, and only once the layer is switched on', () => {
    const guard = fragmentShader.indexOf('if (uWocHmMix > 0.0 && wocRef.a > 0.5) {');
    expect(guard).toBeGreaterThan(fragmentShader.indexOf('diffuseColor.rgb *= wocCol.rgb;'));
    // the reference and the slot's role ride one row: rgb and w
    expect(fragmentShader.indexOf('vec3 r = wocRef.rgb;')).toBeGreaterThan(guard);
    expect(fragmentShader).toContain('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);');
    // a merged material is born switched off: untinted until a look's colours are set
    expect(merged().u.mix.value).toBe(0);
  });

  it('branches on the role code and reads that role colour out of the table', () => {
    // literal: the codes the slot rows carry and the order the colour table is written in
    expect(WOC_HEAD_MERGE_ROLE_CODE).toEqual({ skin: 1, eye: 2, hair: 3, brow: 4 });
    expect(WOC_HEAD_MERGE_ROLES).toEqual(['skin', 'eye', 'hair', 'brow']);
    expect(fragmentShader).toContain('if (wocRef.a < 1.5) {\n    vec3 t = uWocHmTint[0];');
    expect(fragmentShader).toContain('} else if (wocRef.a < 2.5) {\n    vec3 t = uWocHmTint[1];');
    expect(fragmentShader).toContain(
      '} else {\n    vec3 t = wocRef.a < 3.5 ? uWocHmTint[2] : uWocHmTint[3];',
    );
  });

  it('runs the very transfer each role runs on a piece of its own', () => {
    const skin = fragmentShader.indexOf('vec3 t = uWocHmTint[0];');
    const eye = fragmentShader.indexOf('vec3 t = uWocHmTint[1];');
    const hair = fragmentShader.indexOf('uWocHmTint[2] : uWocHmTint[3];');
    const end = fragmentShader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);');
    const body = (from: number, to: number): string => fragmentShader.slice(from, to);
    expect(body(skin, eye)).toContain(roleTransfer('skin'));
    expect(body(eye, hair)).toContain(roleTransfer('eye'));
    // hair: the piece's transfer line, over a luminance each layer reads where its own shader
    // keeps the texel and the colour (the next test)
    expect(roleTransfer('hair').endsWith(`\n  ${HAIR_TRANSFER}`)).toBe(true);
    expect(count(body(hair, end), HAIR_TRANSFER)).toBe(1);
    // each in its own branch only
    expect(count(fragmentShader, roleTransfer('skin'))).toBe(1);
    expect(count(fragmentShader, roleTransfer('eye'))).toBe(1);
    // hair and brow share one branch, which holds because their transfers are one
    expect(roleTransfer('brow')).toBe(roleTransfer('hair'));
    // the transfers lean on the colour helpers, declared once before main
    for (const helper of ['vec3 wocHtRgb2Hsv(vec3 c)', 'vec3 wocHtHsv2Rgb(vec3 c)']) {
      expect(count(fragmentShader, helper), helper).toBe(1);
      expect(fragmentShader.indexOf(helper)).toBeLessThan(fragmentShader.indexOf('void main() {'));
    }
  });

  it("reads a hair or brow slot's luminance off its texel alone, times its colour's", () => {
    // never the luminance of the texel times the colour: a grey texel of a coloured one's
    // linear luminance transfers alike, and a coloured effect darkens by its luminance only
    // (tests/woc_head_tint.test.ts evaluates both). The colour is the material's times the
    // slot's own over it, the factor the map stage multiplies in.
    const hair = fragmentShader.indexOf('uWocHmTint[2] : uWocHmTint[3];');
    const end = fragmentShader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);');
    const branch = fragmentShader.slice(hair, end);
    const luminance =
      'float l = dot(wocTexel.rgb, vec3(0.2126, 0.7152, 0.0722)) * dot(diffuse * wocCol.rgb, vec3(0.2126, 0.7152, 0.0722));';
    expect(count(fragmentShader, luminance)).toBe(1);
    expect(branch.indexOf(luminance)).toBeGreaterThan(-1);
    expect(branch.indexOf(luminance)).toBeLessThan(branch.indexOf(HAIR_TRANSFER));
    // the factors it reads are the ones the stage multiplied into the colour it replaces
    expect(fragmentShader).toContain(
      'wocTexel = sampledDiffuseColor;\n  diffuseColor *= sampledDiffuseColor;',
    );
    expect(fragmentShader.indexOf('diffuseColor.rgb *= wocCol.rgb;')).toBeLessThan(hair);
    expect(THREE.ShaderLib.standard.fragmentShader).toContain(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
    );
    // nothing reads the luminance of the product any more
    expect(fragmentShader).not.toContain('float l = dot(c,');
  });
});

describe('attachWocHeadMergedTint: the low tier Lambert shader', () => {
  it('patches the map and the vertex slot, and leaves the chunks Lambert lacks alone', () => {
    const { mat, u } = merged(true, 'lambert');
    // a shader with neither a roughness nor a metalness chunk must not trip the hook
    expect(() => compile(mat, 'lambert')).not.toThrow();
    const shader = compile(mat, 'lambert');
    const { vertexShader, fragmentShader } = shader;
    const stage = kept(mapStage(fragmentShader), ['USE_MAP', 'WOC_HM_ONE_SIDED']);
    expect(count(stage.code, 'textureGrad(')).toBe(4);
    expect(stage.code).not.toContain('texture2D(');
    expect(stage.defines).toEqual(['USE_MAP', 'WOC_HM_ONE_SIDED']);
    expect(samplers(fragmentShader)).toEqual({
      atlas: 'map',
      hair: 'uWocHmHair',
      beard: 'uWocHmBeard',
      scalp: 'uWocHmScalp',
    });
    expect(fragmentShader).toContain('diffuseColor.rgb *= wocCol.rgb;');
    expect(fragmentShader).toContain('wocTexel = sampledDiffuseColor;');
    // Lambert declares the emissive accumulator before its map chunk too
    expect(fragmentShader.indexOf('totalEmissiveRadiance += wocEmi.rgb;')).toBeGreaterThan(
      fragmentShader.indexOf('vec3 totalEmissiveRadiance = emissive;'),
    );
    // it has no roughness or metalness chunk: nothing of either is spliced in
    expect(THREE.ShaderLib.lambert.fragmentShader).not.toContain('roughnessmap_fragment');
    expect(fragmentShader).not.toContain('roughnessFactor');
    expect(fragmentShader).not.toContain('metalnessFactor');
    expect(vertexShader).toContain('#include <begin_vertex>\nvWocHmSlot = aWocHmSlot;');
    expect(shader.uniforms.uWocHmRef).toBe(u.ref);
    expect(shader.uniforms.uWocHmSurf).toBe(u.surf);
    expect(mat.customProgramCacheKey().startsWith('woc_head_tint|merged|')).toBe(true);
    // every chunk Lambert ships is still included, in its order
    expect(includesOf(fragmentShader)).toEqual(includesOf(THREE.ShaderLib.lambert.fragmentShader));
    // and nothing redefines a name for a chunk Lambert does not have
    expect(fragmentShader).not.toContain('#define roughness');
    expect(fragmentShader).not.toContain('#define metalness');
  });
});

describe('attachWocHeadMergedTint: uniforms and the program key', () => {
  it('binds the very uniform objects it returns, so a later write needs no relink', () => {
    const { mat, u } = merged();
    const shader = compile(mat);
    expect(shader.uniforms.uWocHmTint).toBe(u.tints);
    expect(shader.uniforms.uWocHmMix).toBe(u.mix);
    expect(shader.uniforms.uWocHmRef).toBe(u.ref);
    expect(shader.uniforms.uWocHmCol).toBe(u.col);
    expect(shader.uniforms.uWocHmEmi).toBe(u.emi);
    expect(shader.uniforms.uWocHmSurf).toBe(u.surf);
    expect(shader.uniforms.uWocHmHair).toBe(u.hair);
    expect(shader.uniforms.uWocHmBeard).toBe(u.beard);
    expect(shader.uniforms.uWocHmScalp).toBe(u.scalp);
    // three textures, three uniform objects: none stands in for another
    expect(new Set([u.hair, u.beard, u.scalp]).size).toBe(3);
    expect(Object.keys(shader.uniforms).sort()).toEqual([
      'uWocHmBeard',
      'uWocHmCol',
      'uWocHmEmi',
      'uWocHmHair',
      'uWocHmMix',
      'uWocHmRef',
      'uWocHmScalp',
      'uWocHmSurf',
      'uWocHmTint',
    ]);
    // every uniform the fragment declares is bound, and nothing else
    const declared = [...compile(mat).fragmentShader.matchAll(/uniform \w+ (uWocHm\w+)/g)].map(
      (m) => m[1],
    );
    expect(declared.sort()).toEqual(Object.keys(shader.uniforms).sort());
    // a colour and a texture written after the compile reach the program
    const key = mat.customProgramCacheKey();
    const hair = new THREE.Texture();
    setWocHeadMergedColors(u, {
      skin: [0.5, 0.25, 0.125],
      eye: [0, 0, 1],
      hair: [1, 0, 0],
      brow: [0, 1, 0],
    });
    u.hair.value = hair;
    const bound = shader.uniforms as {
      uWocHmTint: { value: THREE.Vector3[] };
      uWocHmHair: { value: THREE.Texture | null };
    };
    expect(bound.uWocHmTint.value[0].toArray()).toEqual([0.5, 0.25, 0.125]);
    expect(bound.uWocHmHair.value).toBe(hair);
    expect(mat.customProgramCacheKey()).toBe(key);
  });

  it('is born with every table sized, no texture, and the layer off', () => {
    const { u } = merged();
    expect(u.merged).toBe(true);
    expect(u.tints.value).toHaveLength(WOC_HEAD_MERGE_ROLES.length);
    for (const row of [u.ref, u.col, u.emi, u.surf]) {
      expect(row.value).toHaveLength(N);
      // one vector per row, never one shared
      expect(new Set<unknown>(row.value).size).toBe(N);
    }
    expect(u.hair.value).toBeNull();
    expect(u.beard.value).toBeNull();
    expect(u.scalp.value).toBeNull();
    expect(u.mix.value).toBe(0);
    // no slot is one sided until the rows are written
    expect(u.surf.value.every((v) => v.x === 0 && v.y === 0)).toBe(true);
  });

  it('gives every merged head one key of its own, apart from any per-role layer', () => {
    const source = new THREE.MeshStandardMaterial();
    const a = source.clone();
    const b = source.clone();
    const ua = attachWocHeadMergedTint(a);
    const ub = attachWocHeadMergedTint(b);
    expect(ua).not.toBe(ub);
    expect(a.customProgramCacheKey()).toContain('woc_head_tint|merged|');
    expect(a.customProgramCacheKey().startsWith('woc_head_tint|merged|')).toBe(true);
    // two heads in different looks and colours: still the one key
    setWocHeadMergedColors(ua, {
      skin: [1, 0, 0],
      eye: [0, 1, 0],
      hair: [0, 0, 1],
      brow: [1, 1, 0],
    });
    setWocHeadMergedSlots(
      ub,
      [{ material: 'm', roleCode: 3, ref: [0.02, 0.02, 0.02], layer: 1, oneSided: false }],
      [{ color: [1, 0.5, 0.25], emissive: [0, 0, 0], roughness: 0.7, metalness: 0 }],
      { color: [1, 1, 1], emissive: [0, 0, 0] },
    );
    ub.hair.value = new THREE.Texture();
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    // a per-role piece of the same source is another program, whichever role
    for (const role of WOC_HEAD_MERGE_ROLES) {
      const piece = source.clone();
      attachWocHeadTint(piece, role, [0.2, 0.1, 0.08]);
      expect(piece.customProgramCacheKey(), role).not.toBe(a.customProgramCacheKey());
      expect(piece.customProgramCacheKey(), role).not.toContain('|merged|');
    }
    expect(a.userData.wocHeadTint).toBe('merged');
  });

  it('links ONE program per variant, by the key three itself computes', () => {
    // three's own program cache key (WebGLPrograms), which folds the defines in: every
    // one sided head shares a program, every two sided head another, and no look,
    // colour or slot write moves either
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const key = (mat: THREE.Material): string => threeProgramKeys(mat, new THREE.Mesh(geo, mat));
    const source = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const make = (oneSided: boolean) => {
      const mat = source.clone();
      return { mat, u: attachWocHeadMergedTint(mat, oneSided) };
    };
    const [one, alsoOne, two, alsoTwo] = [make(true), make(true), make(false), make(false)];
    setWocHeadMergedColors(alsoOne.u, {
      skin: [1, 0, 0],
      eye: [0, 1, 0],
      hair: [0, 0, 1],
      brow: [1, 1, 0],
    });
    alsoTwo.u.scalp.value = new THREE.Texture();
    expect(key(one.mat)).toBe(key(alsoOne.mat));
    expect(key(two.mat)).toBe(key(alsoTwo.mat));
    expect(key(one.mat)).not.toBe(key(two.mat));
    // neither is the plain source's program
    expect(key(two.mat)).not.toBe(key(source));
  });

  it('is idempotent on one material and readable back', () => {
    const { mat, u } = merged();
    const key = mat.customProgramCacheKey();
    expect(attachWocHeadMergedTint(mat)).toBe(u);
    expect(wocHeadMergedTintOf(mat)).toBe(u);
    // the second attach hooked nothing a second time
    expect(mat.customProgramCacheKey()).toBe(key);
    expect(count(compile(mat).fragmentShader, 'uniform float uWocHmMix;')).toBe(1);
    expect(wocHeadMergedTintOf(new THREE.MeshStandardMaterial())).toBeNull();
    // the two layers are told apart
    expect(wocHeadTintOf(mat)).toBeNull();
    const piece = new THREE.MeshStandardMaterial();
    attachWocHeadTint(piece, 'skin', [0.2, 0.1, 0.08]);
    expect(wocHeadMergedTintOf(piece)).toBeNull();
  });
});

describe('attachWocHeadMergedTint: composing with the hooks a material already wears', () => {
  it('still runs a prior onBeforeCompile, first, and folds its key in', () => {
    const m = new THREE.MeshStandardMaterial();
    const sawMapChunk: boolean[] = [];
    m.onBeforeCompile = (shader) => {
      // the prior layer runs BEFORE the merged patch: it still finds three's chunks
      sawMapChunk.push(shader.fragmentShader.includes('#include <map_fragment>'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n// prior: after the map')
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor *= 0.5; // prior: polish',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.1); // prior: glow',
        );
      shader.uniforms.uPrior = { value: 1 };
    };
    m.customProgramCacheKey = () => 'prev_layer';
    attachWocHeadMergedTint(m);
    const shader = compile(m);
    expect(sawMapChunk).toEqual([true]);
    expect(m.customProgramCacheKey()).toBe('woc_head_tint|merged|prev_layer');
    expect(shader.uniforms.uPrior).toEqual({ value: 1 });
    // what the prior layer spliced after the map chunk still follows the merged tint
    const { fragmentShader } = shader;
    expect(fragmentShader.indexOf('// prior: after the map')).toBeGreaterThan(
      fragmentShader.indexOf('diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);'),
    );
    expect(fragmentShader.indexOf('// prior: after the map')).toBeGreaterThan(
      fragmentShader.indexOf('#include <map_fragment>'),
    );
    // ...what it spliced after the roughness chunk runs on the SLOT's roughness, with
    // the name back to the material's uniform by then
    expect(kept(surfaceStage(fragmentShader)).code).toBe(
      [
        'float roughnessFactor = wocEmi.a;',
        'roughnessFactor *= 0.5; // prior: polish',
        'float metalnessFactor = uWocHmSurf[wocSlot].x;',
      ].join('\n'),
    );
    expect(fragmentShader).toContain('#undef roughness\nroughnessFactor *= 0.5; // prior: polish');
    // ...and what it added to the glow comes after the slot's texel scaled it
    expect(kept(emissiveStage(fragmentShader, 'standard'), ['USE_EMISSIVEMAP']).code).toBe(
      `${GLOW_STAGE}\ntotalEmissiveRadiance += vec3(0.1); // prior: glow`,
    );
    // compiled again (three compiles a material once per program variant): the hook is
    // a pure function of the source it is handed
    expect(compile(m).fragmentShader).toBe(fragmentShader);
    expect(sawMapChunk).toEqual([true, true]);
  });

  it("wears the tier's env sheen underneath: its key folded in, its chunk still patched", () => {
    const tier = new THREE.MeshStandardMaterial();
    applyEnvSheen(tier, 0.25);
    // what the dressing does for the merged mesh: a hook-preserving clone, then the layer
    const wrapped = cloneMaterialWithHooks(tier);
    attachWocHeadMergedTint(wrapped, true);
    expect(wrapped.customProgramCacheKey().startsWith('woc_head_tint|merged|')).toBe(true);
    expect(wrapped.customProgramCacheKey()).toContain('env-sheen:0.250');
    const { fragmentShader } = compile(wrapped);
    // the sheen scales by the fragment's metalness, which is now the SLOT's
    const sheen = fragmentShader.indexOf('radiance *= mix( 0.250, 1.0, metalnessFactor );');
    const fed = fragmentShader.indexOf(
      '#define metalness uWocHmSurf[wocSlot].x\n#include <metalnessmap_fragment>',
    );
    expect(fed).toBeGreaterThan(-1);
    expect(sheen).toBeGreaterThan(fed);
  });

  it.each(LIBS)(
    'a layer attached AFTER it (the hit response) still finds its anchors on the %s shader',
    (lib) => {
      // the hit response clones the mounted material and splices its emission after the
      // emissive map chunk and its sheen after the roughness chunk: with those includes
      // replaced outright it found nothing to hold on to, and a struck head did not glow
      const { mat, u } = merged(true, lib);
      const struck = createSurfaceResponseMaterial(mat, surfaceResponseUniforms());
      expect(wocHeadMergedTintOf(struck)).toBe(u);
      const { fragmentShader } = compile(struck, lib);
      const emission = 'totalEmissiveRadiance+=surfaceEmission;';
      expect(count(fragmentShader, emission)).toBe(1);
      // its emission joins the glow AFTER the slot's texel scaled it, on a material with
      // an emissive map and on one without
      expect(kept(emissiveStage(fragmentShader, lib), ['USE_EMISSIVEMAP']).code).toBe(
        `${GLOW_STAGE}\n${emission}`,
      );
      expect(kept(emissiveStage(fragmentShader, lib)).code).toBe(emission);
      // its surface paint runs on the tinted colour: after the whole of the map stage
      expect(fragmentShader.indexOf('vec3 surfaceP=vSurfacePoint-uSurfaceOrigin;')).toBeGreaterThan(
        fragmentShader.indexOf('#include <map_fragment>'),
      );
      const sheen = 'roughnessFactor=mix(roughnessFactor,0.23,surfaceCoat);';
      if (lib === 'standard') {
        // its sheen eases the SLOT's roughness, declared by the chunk a line before
        const lines = kept(surfaceStage(fragmentShader)).code.split('\n');
        expect(lines[0]).toBe('float roughnessFactor = wocEmi.a;');
        expect(lines[1]).toBe(`if(uSurfaceKind>0.5 && uSurfaceKind<1.5)${sheen}`);
        expect(lines[2]).toBe('float metalnessFactor = uWocHmSurf[wocSlot].x;');
        expect(lines).toHaveLength(3);
      } else {
        // Lambert has no roughness chunk: nothing of the sheen is spliced in
        expect(fragmentShader).not.toContain(sheen);
      }
      // the same on the whole program, its includes resolved as three resolves them
      const program = resolved(fragmentShader);
      expect(program).not.toContain('#include');
      const scaled = program.indexOf('totalEmissiveRadiance *= wocGlow;');
      expect(scaled).toBeGreaterThan(-1);
      expect(count(program, emission)).toBe(1);
      expect(program.indexOf(emission)).toBeGreaterThan(scaled);
      // ...and after three's own (switched off) emissive lookup, where it always sat
      expect(program.indexOf(emission)).toBeGreaterThan(
        program.indexOf('totalEmissiveRadiance *= emissiveColor.rgb;'),
      );
      if (lib === 'standard') {
        expect(count(program, 'float roughnessFactor = roughness;')).toBe(1);
        const declared = program.indexOf('float roughnessFactor = roughness;');
        expect(program.indexOf('#define roughness wocEmi.a')).toBeLessThan(declared);
        expect(program.indexOf(sheen)).toBeGreaterThan(declared);
        expect(program.indexOf(sheen)).toBeLessThan(program.indexOf('#undef roughness'));
      } else {
        expect(program).not.toContain('roughnessFactor');
      }
      // the merged layer's own work is all still there, once
      expect(count(kept(mapStage(fragmentShader), ['USE_MAP']).code, 'textureGrad(')).toBe(4);
      expect(count(fragmentShader, 'uniform float uWocHmMix;')).toBe(1);
      // and it is another program than the plain merged head's, keyed after it
      expect(struck.customProgramCacheKey()).toBe(
        `${mat.customProgramCacheKey()}:surface-response-v4`,
      );
    },
  );
});

describe('an effect clone of a merged material (material_clone_hooks)', () => {
  it('reapplyWocHeadTintToClone gives the clone the same uniforms and the same program', () => {
    const { mat, u } = merged();
    const clone = mat.clone();
    // a bare clone() dropped the hook: it would draw one texture and link a new program
    expect(wocHeadMergedTintOf(clone)).toBeNull();
    expect(clone.customProgramCacheKey()).not.toBe(mat.customProgramCacheKey());
    reapplyWocHeadTintToClone(mat, clone);
    expect(wocHeadMergedTintOf(clone)).toBe(u);
    expect(clone.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
    const shader = compile(clone);
    expect(shader.uniforms.uWocHmRef).toBe(u.ref);
    expect(shader.uniforms.uWocHmTint).toBe(u.tints);
    expect(shader.uniforms.uWocHmHair).toBe(u.hair);
    expect(shader.fragmentShader).toBe(compile(mat).fragmentShader);
    // it is the merged layer the clone wears, never a per-role one
    expect(wocHeadTintOf(clone)).toBeNull();
    // asked again: nothing is hooked a second time
    reapplyWocHeadTintToClone(mat, clone);
    expect(clone.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
    expect(count(compile(clone).fragmentShader, 'uniform float uWocHmMix;')).toBe(1);
    // a two sided head's clone gains no define
    expect(clone.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
  });

  it.each(LIBS)('gives a clone of a one sided %s head its define back', (lib) => {
    const { mat, u } = merged(true, lib);
    // Material.clone() copies no define the material gained after it was built
    const clone = mat.clone();
    expect(clone.defines ?? {}).not.toHaveProperty('WOC_HM_ONE_SIDED');
    reapplyWocHeadTintToClone(mat, clone);
    expect(clone.defines?.WOC_HM_ONE_SIDED).toBe('');
    expect(wocHeadMergedTintOf(clone)).toBe(u);
    // so the clone draws with the very program its source linked
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(threeProgramKeys(clone, new THREE.Mesh(geo, clone))).toBe(
      threeProgramKeys(mat, new THREE.Mesh(geo, mat)),
    );
    // the same through the program-preserving clone the effects use
    const glow = cloneMaterialWithHooks(mat);
    expect(glow.defines?.WOC_HM_ONE_SIDED).toBe('');
    expect(threeProgramKeys(glow, new THREE.Mesh(geo, glow))).toBe(
      threeProgramKeys(mat, new THREE.Mesh(geo, mat)),
    );
  });

  it('cloneMaterialWithHooks keeps the layer, the key and the LIVE rows', () => {
    const { mat, u } = merged();
    const glow = cloneMaterialWithHooks(mat);
    expect(glow).not.toBe(mat);
    expect(wocHeadMergedTintOf(glow)).toBe(u);
    expect(glow.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
    const shader = compile(glow);
    // a look change after the clone still reaches it
    expect((shader.uniforms.uWocHmMix as { value: number }).value).toBe(0);
    setWocHeadMergedColors(u, {
      skin: [0.1, 0.2, 0.3],
      eye: [0, 0, 0],
      hair: [0, 0, 0],
      brow: [0, 0, 0],
    });
    const bound = shader.uniforms as {
      uWocHmTint: { value: THREE.Vector3[] };
      uWocHmMix: { value: number };
    };
    expect(bound.uWocHmTint.value[0].toArray()).toEqual([0.1, 0.2, 0.3]);
    expect(bound.uWocHmMix.value).toBe(1);
    // a clone of the clone too
    const again = cloneMaterialWithHooks(glow);
    expect(wocHeadMergedTintOf(again)).toBe(u);
    expect(again.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
  });

  it('leaves a clone of an unmerged material unmerged', () => {
    const plain = new THREE.MeshStandardMaterial();
    const clone = plain.clone();
    reapplyWocHeadTintToClone(plain, clone);
    expect(wocHeadMergedTintOf(clone)).toBeNull();
    expect(clone.userData.wocHeadTint).toBeUndefined();
    expect(clone.defines).toEqual({ STANDARD: '' });
  });
});

describe('setWocHeadMergedSlots', () => {
  const slot = (
    roleCode: number,
    ref: readonly [number, number, number],
    layer: WocHeadMergeLayer,
    oneSided = false,
  ): WocHeadMergeSlot => ({ material: `m${roleCode}${layer}`, roleCode, ref, layer, oneSided });
  const surface = (
    color: readonly [number, number, number],
    emissive: readonly [number, number, number],
    roughness: number,
    metalness: number,
  ): WocHeadMergeSurface => ({ color, emissive, roughness, metalness });
  /** The merged material's own surface: what its colour and emissive uniforms draw. */
  const BASE = { color: [0.5, 0.25, 0.125], emissive: [0.25, 0.125, 0.5] } as const;
  const rows = (u: WocHeadMergedTintUniforms, i: number) => ({
    ref: u.ref.value[i].toArray(),
    col: u.col.value[i].toArray(),
    emi: u.emi.value[i].toArray(),
    surf: u.surf.value[i].toArray(),
  });
  /** What a row holds when no slot uses it. */
  const UNUSED = { ref: [0, 0, 0, 0], col: [1, 1, 1, 0], emi: [0, 0, 0, 1], surf: [0, 0] };

  it('writes each slot as its reference and role, its colour OVER the base, its emissive LESS the base', () => {
    const { u } = merged();
    setWocHeadMergedSlots(
      u,
      [
        // the base head itself: skin, the atlas, one sided
        slot(1, [0.2346, 0.1195, 0.0865], 0, true),
        // the hairstyle: its own texture, a lighter and glossier surface, two sided
        slot(3, [0.0184, 0.0184, 0.0184], 1),
        // an eyeliner card: untinted, a flat colour off the atlas's white cell, metal
        slot(0, [0, 0, 0], 0, true),
        // the beard: the hair role on the beard's texture
        slot(3, [0.0603, 0.0603, 0.0603], 2),
        // a brow and an eyeball, for the last two role codes
        slot(4, [0.023, 0.023, 0.023], 0),
        slot(2, [0.227, 0.1845, 0.1651], 0, true),
        // the scalp cap: the hair role on the fourth texture
        slot(3, [0.0796, 0.0796, 0.0796], 3),
      ],
      [
        surface([0.5, 0.25, 0.125], [0.25, 0.125, 0.5], 0.625, 0),
        surface([1, 0.75, 0.0625], [0.75, 0.125, 0.25], 0.75, 0.25),
        surface([1, 0.5, 0.25], [0, 0, 0], 0.25, 1),
        surface([0.25, 0.25, 0.25], [0.25, 0.25, 0.5], 0.5, 0),
        surface([0.5, 0.5, 0.5], [0.5, 0.125, 0.5], 0.875, 0.5),
        surface([0.125, 0.125, 0.125], [0.25, 0.375, 1], 1, 0.75),
        surface([0.5, 0.25, 0.125], [0.25, 0.125, 0.5], 0.125, 0.125),
      ],
      BASE,
    );
    // a slot drawing exactly the base's surface is the identity row; its surface row is
    // (metalness, 1 for a one sided slot)
    expect(rows(u, 0)).toEqual({
      ref: [0.2346, 0.1195, 0.0865, 1],
      col: [1, 1, 1, 0],
      emi: [0, 0, 0, 0.625],
      surf: [0, 1],
    });
    // colour is a RATIO (1 / 0.5, 0.75 / 0.25, 0.0625 / 0.125) with the layer in w;
    // emissive a DIFFERENCE (0.75 - 0.25, 0.125 - 0.125, 0.25 - 0.5) with roughness in w
    expect(rows(u, 1)).toEqual({
      ref: [0.0184, 0.0184, 0.0184, 3],
      col: [2, 3, 0.5, 1],
      emi: [0.5, 0, -0.25, 0.75],
      surf: [0.25, 0],
    });
    expect(rows(u, 2)).toEqual({
      ref: [0, 0, 0, 0],
      col: [2, 2, 2, 0],
      emi: [-0.25, -0.125, -0.5, 0.25],
      surf: [1, 1],
    });
    expect(rows(u, 3)).toEqual({
      ref: [0.0603, 0.0603, 0.0603, 3],
      col: [0.5, 1, 2, 2],
      emi: [0, 0.125, 0, 0.5],
      surf: [0, 0],
    });
    expect(rows(u, 4)).toEqual({
      ref: [0.023, 0.023, 0.023, 4],
      col: [1, 2, 4, 0],
      emi: [0.25, 0, 0, 0.875],
      surf: [0.5, 0],
    });
    expect(rows(u, 5)).toEqual({
      ref: [0.227, 0.1845, 0.1651, 2],
      col: [0.25, 0.5, 1, 0],
      emi: [0, 0.25, 0.5, 1],
      surf: [0.75, 1],
    });
    expect(rows(u, 6)).toEqual({
      ref: [0.0796, 0.0796, 0.0796, 3],
      col: [1, 1, 1, 3],
      emi: [0, 0, 0, 0.125],
      surf: [0.125, 0],
    });
    // every row past the head's slots is the unused row
    for (let i = 7; i < N; i++) expect(rows(u, i), `row ${i}`).toEqual(UNUSED);
  });

  it('resets the rows a smaller head no longer uses', () => {
    const { u } = merged();
    const loud = surface([1, 1, 1], [1, 1, 1], 0.25, 1);
    // a full table first: every row written
    setWocHeadMergedSlots(
      u,
      Array.from({ length: N }, () => slot(4, [0.5, 0.5, 0.5], 2, true)),
      Array.from({ length: N }, () => loud),
      BASE,
    );
    for (let i = 0; i < N; i++) {
      expect(rows(u, i), `row ${i}`).toEqual({
        ref: [0.5, 0.5, 0.5, 4],
        col: [2, 4, 8, 2],
        emi: [0.75, 0.875, 0.5, 0.25],
        surf: [1, 1],
      });
    }
    // then a head of two slots: rows 2 and up go back to drawing nothing of their own
    setWocHeadMergedSlots(
      u,
      [slot(1, [0.2, 0.1, 0.05], 0), slot(3, [0.02, 0.02, 0.02], 1)],
      [loud, loud],
      BASE,
    );
    expect(rows(u, 1).ref).toEqual([0.02, 0.02, 0.02, 3]);
    for (let i = 2; i < N; i++) expect(rows(u, i), `row ${i}`).toEqual(UNUSED);
    // and no head at all: every row
    setWocHeadMergedSlots(u, [], [], BASE);
    for (let i = 0; i < N; i++) expect(rows(u, i), `row ${i}`).toEqual(UNUSED);
  });

  it('treats a slot with no surface, and a surface with no slot, as unused', () => {
    const { u } = merged();
    const s = surface([1, 1, 1], [1, 1, 1], 0.25, 1);
    setWocHeadMergedSlots(
      u,
      [slot(1, [0.2, 0.1, 0.05], 0, true), slot(3, [0.02, 0.02, 0.02], 1, true)],
      [s],
      BASE,
    );
    expect(rows(u, 0).ref).toEqual([0.2, 0.1, 0.05, 1]);
    expect(rows(u, 1)).toEqual(UNUSED);
    setWocHeadMergedSlots(u, [slot(1, [0.2, 0.1, 0.05], 0)], [s, s], BASE);
    expect(rows(u, 1)).toEqual(UNUSED);
  });

  it('keeps the vectors the program is bound to: a rewrite is a uniform write', () => {
    const { mat, u } = merged();
    const shader = compile(mat);
    const before = {
      ref: [...u.ref.value],
      col: [...u.col.value],
      emi: [...u.emi.value],
      surf: [...u.surf.value],
    };
    setWocHeadMergedSlots(
      u,
      [slot(1, [0.2, 0.1, 0.05], 0, true)],
      [surface([1, 1, 1], [0, 0, 0], 0.5, 0.25)],
      BASE,
    );
    for (let i = 0; i < N; i++) {
      expect(u.ref.value[i]).toBe(before.ref[i]);
      expect(u.col.value[i]).toBe(before.col[i]);
      expect(u.emi.value[i]).toBe(before.emi[i]);
      expect(u.surf.value[i]).toBe(before.surf[i]);
    }
    const bound = shader.uniforms.uWocHmSurf as { value: THREE.Vector2[] };
    expect(bound.value[0].toArray()).toEqual([0.25, 1]);
  });

  it('never divides by a black base: the ratio stays finite', () => {
    const { u } = merged();
    setWocHeadMergedSlots(
      u,
      [slot(1, [0.2, 0.1, 0.05], 0)],
      [surface([0.5, 0, 1], [0, 0, 0], 0.5, 0)],
      { color: [0, 0, 0], emissive: [0, 0, 0] },
    );
    const [r, g, b] = u.col.value[0].toArray();
    expect([r, g, b].every(Number.isFinite)).toBe(true);
    // floored at a millionth, so a black material's slot still scales its texel
    expect(r).toBe(0.5 / 1e-6);
    expect(g).toBe(0);
    expect(b).toBe(1 / 1e-6);
  });
});

describe('setWocHeadMergedColors', () => {
  it("writes each role's colour at its index of the role table", () => {
    const { u } = merged();
    setWocHeadMergedColors(u, {
      skin: [0.5, 0.25, 0.125],
      eye: [0.0625, 0.5, 0.75],
      hair: [1, 0, 0.5],
      brow: [0.25, 0.75, 0],
    });
    expect(u.tints.value.map((v) => v.toArray())).toEqual([
      [0.5, 0.25, 0.125],
      [0.0625, 0.5, 0.75],
      [1, 0, 0.5],
      [0.25, 0.75, 0],
    ]);
    // the index IS the role table's, which is the role code less one
    WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
      expect(WOC_HEAD_MERGE_ROLE_CODE[role] - 1, role).toBe(i);
    });
    expect(u.mix.value).toBe(1);
  });

  it('switches the layer on at full strength: a head piece is never half tinted', () => {
    const { u } = merged();
    // born off, so a head never draws another look's colours before its own are set
    expect(u.mix.value).toBe(0);
    const colors = { skin: [1, 1, 1], eye: [1, 1, 1], hair: [1, 1, 1], brow: [1, 1, 1] } as const;
    setWocHeadMergedColors(u, colors);
    expect(u.mix.value).toBe(1);
    setWocHeadMergedColors(u, colors);
    expect(u.mix.value).toBe(1);
  });

  it('keeps the vectors the program is bound to', () => {
    const { u } = merged();
    const before = [...u.tints.value];
    setWocHeadMergedColors(u, {
      skin: [0, 0, 0],
      eye: [0, 0, 0],
      hair: [0, 0, 0],
      brow: [0, 0, 0],
    });
    u.tints.value.forEach((v, i) => {
      expect(v).toBe(before[i]);
    });
    expect(u.tints.value[0].toArray()).toEqual([0, 0, 0]);
  });
});
