import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchPointLightFragmentChunk } from '../src/render/point_light_shader_core';

const PATCH_MARKER = 'WOC_SKIP_ZERO_POINT_LIGHT';
const LOOP_MARKER_LINE =
  '\t// WOC_POINT_LIGHT_LOOP: one loop body instead of an inlined copy per light.\n';
const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const POINT_DIRECT =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const SPOT_LIGHTS = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
const POINT_LOOP_HEAD = '\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {\n';
const UNROLL_START = '\t#pragma unroll_loop_start\n';
const UNROLL_END = '\t#pragma unroll_loop_end\n';
const SHADOW_ARM = '\t#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0\n';
const LOOP_ARM = '\t#else\n';
const ARMS_CLOSE = '\t#endif\n';
const POINT_SHADOW_BLOCK =
  /\t\t#if defined\( USE_SHADOWMAP \) && \( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS \)[^\n]*\n(?:\t\t(?!#)[^\n]*\n){2}\t\t#endif\n/;
const SUPPORTED_MATERIAL_GUARD =
  '#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )';
const PAD_GUARD = 'if ( pointLight.color != vec3( 0.0 ) ) {';
const DARK_BREAK = 'if ( pointLights[ i ].color == vec3( 0.0 ) ) break;';
const DARK_BREAK_BLOCK = `
\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t${DARK_BREAK}
\t\t#endif
`;
const VISIBLE_GUARD = 'if ( directLight.visible ) {';
const POINT_PAD_GUARD = `\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t// ${PATCH_MARKER}: uniform-coherent pad-light fast path.
\t\t${PAD_GUARD}
\t\t#endif

`;
const POINT_DIRECT_GUARD = `\t\t#ifdef STANDARD
\t\t${VISIBLE_GUARD}
\t\t#endif

`;
const POINT_GUARD_CLOSE = `

\t\t#ifdef STANDARD
\t\t}
\t\t#endif
\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t}
\t\t#endif`;

const stock = THREE.ShaderChunk.lights_fragment_begin;

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function stripGuards(text: string): string {
  const stripped = text
    .replace(`${POINT_LOOP_HEAD}${DARK_BREAK_BLOCK}`, POINT_LOOP_HEAD)
    .replace(POINT_PAD_GUARD, '')
    .replace(POINT_DIRECT_GUARD, '')
    .replace(POINT_GUARD_CLOSE, '');
  const breakLength = text.includes(DARK_BREAK) ? DARK_BREAK_BLOCK.length : 0;
  expect(stripped.length).toBe(
    text.length -
      breakLength -
      POINT_PAD_GUARD.length -
      POINT_DIRECT_GUARD.length -
      POINT_GUARD_CLOSE.length,
  );
  return stripped;
}

/** Splits a chunk around its point-light loop: stock has one unrolled region. */
function stockRegion(source: string): { before: string; region: string; after: string } {
  const start = source.indexOf(`${UNROLL_START}${POINT_LOOP_HEAD}`);
  const end = source.indexOf(UNROLL_END, start) + UNROLL_END.length;
  expect(start).toBeGreaterThan(0);
  expect(end).toBeLessThan(source.indexOf(SPOT_LIGHTS));
  return {
    before: source.slice(0, start),
    region: source.slice(start, end),
    after: source.slice(end),
  };
}

function patchedArms(patched: string): {
  before: string;
  shadowArm: string;
  loopArm: string;
  after: string;
} {
  const open = patched.indexOf(`${SHADOW_ARM}${UNROLL_START}`);
  expect(open).toBeGreaterThan(0);
  const shadowStart = open + SHADOW_ARM.length;
  const shadowEnd = patched.indexOf(UNROLL_END, shadowStart) + UNROLL_END.length;
  expect(patched.slice(shadowEnd, shadowEnd + LOOP_ARM.length)).toBe(LOOP_ARM);
  const loopStart = shadowEnd + LOOP_ARM.length;
  const loopEnd = patched.indexOf(`\t}\n${ARMS_CLOSE}`, loopStart) + '\t}\n'.length;
  expect(loopEnd).toBeGreaterThan(loopStart);
  expect(loopEnd).toBeLessThan(patched.indexOf(SPOT_LIGHTS));
  return {
    before: patched.slice(0, open),
    shadowArm: patched.slice(shadowStart, shadowEnd),
    loopArm: patched.slice(loopStart, loopEnd),
    after: patched.slice(loopEnd + ARMS_CLOSE.length),
  };
}

describe('shared point-light shader core', () => {
  const patched = patchPointLightFragmentChunk(stock);

  it('compiles point lights as one real loop when no point light casts a shadow', () => {
    const { loopArm } = patchedArms(patched);

    expect(loopArm.startsWith(`${LOOP_MARKER_LINE}${POINT_LOOP_HEAD}`)).toBe(true);
    expect(count(loopArm, 'for (')).toBe(1);
    expect(count(loopArm, DARK_BREAK)).toBe(1);
    expect(loopArm).not.toContain('#pragma');
    expect(loopArm).not.toContain('UNROLLED_LOOP_INDEX');
    expect(loopArm).not.toContain('pointLightShadow');
    expect(count(loopArm, 'pointLight = pointLights[ i ];')).toBe(1);
    expect(count(loopArm, POINT_INFO)).toBe(1);
    expect(count(loopArm, POINT_DIRECT)).toBe(1);
    expect(count(loopArm, PAD_GUARD)).toBe(1);
    expect(count(loopArm, VISIBLE_GUARD)).toBe(1);

    const order = [
      POINT_LOOP_HEAD,
      'pointLight = pointLights[ i ];',
      PAD_GUARD,
      POINT_INFO,
      '#ifdef STANDARD',
      VISIBLE_GUARD,
      POINT_DIRECT,
    ].map((needle) => loopArm.indexOf(needle));
    expect(order.every((at, k) => at >= 0 && (k === 0 || at > order[k - 1]))).toBe(true);
    expect(loopArm.endsWith('\t\t}\n\t\t#endif\n\t}\n')).toBe(true);
  });

  it('breaks at the first black slot, first thing in the loop body, under the pad-skip guard', () => {
    const { loopArm, shadowArm } = patchedArms(patched);

    expect(
      loopArm.startsWith(
        `${LOOP_MARKER_LINE}${POINT_LOOP_HEAD}${DARK_BREAK_BLOCK}\t\tpointLight = pointLights[ i ];\n`,
      ),
    ).toBe(true);
    expect(count(loopArm, 'break;')).toBe(1);
    expect(count(loopArm, SUPPORTED_MATERIAL_GUARD)).toBe(3);
    expect(shadowArm).not.toContain('break;');
    expect(count(patched, 'break;')).toBe(1);
  });

  it('keeps the per-light body of the unrolled form, minus only the point-shadow block', () => {
    const { region } = stockRegion(stock);
    const { loopArm } = patchedArms(patched);
    const stockBody = region.slice(UNROLL_START.length, -UNROLL_END.length);

    expect(stockBody.match(new RegExp(POINT_SHADOW_BLOCK.source, 'g'))).toHaveLength(1);
    expect(stripGuards(loopArm.slice(LOOP_MARKER_LINE.length))).toBe(
      stockBody.replace(POINT_SHADOW_BLOCK, ''),
    );
  });

  it('keeps the previous guarded unrolled block, verbatim, for point-shadow programs', () => {
    const { region } = stockRegion(stock);
    const { shadowArm } = patchedArms(patched);

    expect(shadowArm.startsWith(`${UNROLL_START}${POINT_LOOP_HEAD}`)).toBe(true);
    expect(shadowArm).toMatch(POINT_SHADOW_BLOCK);
    expect(count(shadowArm, PAD_GUARD)).toBe(1);
    expect(count(shadowArm, VISIBLE_GUARD)).toBe(1);
    expect(stripGuards(shadowArm)).toBe(region);
  });

  it('leaves every other light section of the chunk byte-identical to stock', () => {
    const stockParts = stockRegion(stock);
    const { before, after } = patchedArms(patched);

    expect(before).toBe(stockParts.before);
    expect(after).toBe(stockParts.after);
    expect(after.startsWith('#endif\n')).toBe(true);
    expect(after).toContain(SPOT_LIGHTS);
    expect(count(patched, '#pragma unroll_loop_start')).toBe(
      count(stock, '#pragma unroll_loop_start'),
    );
    expect(count(after, '#pragma unroll_loop_start')).toBe(
      count(stockParts.after, '#pragma unroll_loop_start'),
    );
  });

  it('adds no identifier that three light-count substitution would rewrite', () => {
    expect(new Set(patched.match(/\w*NUM_POINT_LIGHTS\w*/g))).toEqual(
      new Set(['NUM_POINT_LIGHTS']),
    );
    expect(patched.match(/\bWOC_\w+/g)?.sort()).toEqual([
      'WOC_POINT_LIGHT_LOOP',
      'WOC_SKIP_ZERO_POINT_LIGHT',
      'WOC_SKIP_ZERO_POINT_LIGHT',
    ]);
  });

  it('guards Lambert, Phong, and Standard only, while Toon takes the same loop unguarded', () => {
    expect(THREE.ShaderLib.lambert.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(THREE.ShaderLib.lambert.fragmentShader).toContain('#define LAMBERT');
    expect(THREE.ShaderLib.phong.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(THREE.ShaderLib.phong.fragmentShader).toContain('#define PHONG');
    expect(THREE.ShaderLib.standard.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(THREE.ShaderLib.standard.fragmentShader).toContain('#define STANDARD');
    expect(THREE.ShaderLib.toon.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(THREE.ShaderLib.toon.fragmentShader).toContain('#define TOON');
    expect(THREE.ShaderLib.toon.fragmentShader).not.toMatch(/#define (?:STANDARD|LAMBERT|PHONG)/);
    expect(THREE.ShaderLib.basic.fragmentShader).not.toContain('#include <lights_fragment_begin>');
  });

  it('is idempotent', () => {
    expect(patchPointLightFragmentChunk(patched)).toBe(patched);
  });

  it.each([
    ['point-info', POINT_INFO],
    ['point-direct', POINT_DIRECT],
    ['spot-boundary', SPOT_LIGHTS],
    ['point-loop-start', `${UNROLL_START}${POINT_LOOP_HEAD}`],
    ['point-shadow', '( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )'],
    ['point-section', '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )'],
  ])('throws when the pinned three %s anchor changes', (_name, anchor) => {
    expect(stock).toContain(anchor);
    const changed = stock.replace(anchor, '/* changed anchor */');
    expect(() => patchPointLightFragmentChunk(changed)).toThrow(/pinned three point-light chunk/);
  });

  it('throws when the point-shadow block grows a nested directive', () => {
    const changed = stock.replace(
      'pointLightShadow = pointLightShadows[ i ];',
      '#ifdef WOC_NESTED\n\t\tpointLightShadow = pointLightShadows[ i ];\n\t\t#endif',
    );
    expect(changed).not.toBe(stock);
    expect(() => patchPointLightFragmentChunk(changed)).toThrow(/point-shadow block changed/);
  });
});
