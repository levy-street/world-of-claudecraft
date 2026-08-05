import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchPointLightFragmentChunk } from '../src/render/point_light_shader_core';

const PATCH_MARKER = 'WOC_SKIP_ZERO_POINT_LIGHT';
const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const POINT_DIRECT =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const SPOT_LIGHTS = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
const SUPPORTED_MATERIAL_GUARD =
  '#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )';
const POINT_PAD_GUARD = `\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t// ${PATCH_MARKER}: uniform-coherent pad-light fast path.
\t\tif ( pointLight.color != vec3( 0.0 ) ) {
\t\t#endif

`;
const POINT_DIRECT_GUARD = `\t\t#ifdef STANDARD
\t\tif ( directLight.visible ) {
\t\t#endif

`;
const POINT_GUARD_CLOSE = `

\t\t#ifdef STANDARD
\t\t}
\t\t#endif
\t\t${SUPPORTED_MATERIAL_GUARD}
\t\t}
\t\t#endif`;

describe('shared point-light shader core', () => {
  it('wraps zero-color work for Lambert, Phong, and Standard without a varying branch', () => {
    const source = THREE.ShaderChunk.lights_fragment_begin;
    const patched = patchPointLightFragmentChunk(source);
    const padGuard = patched.indexOf('if ( pointLight.color != vec3( 0.0 ) )');
    const materialGuard = patched.lastIndexOf(SUPPORTED_MATERIAL_GUARD, padGuard);
    const pointInfo = patched.indexOf(POINT_INFO);
    const directGuard = patched.indexOf('if ( directLight.visible )', pointInfo);
    const pointDirect = patched.indexOf(POINT_DIRECT, pointInfo);
    const spotLights = patched.indexOf(SPOT_LIGHTS);

    expect(padGuard).toBeGreaterThan(patched.indexOf('pointLight = pointLights[ i ];'));
    expect(pointInfo).toBeGreaterThan(padGuard);
    expect(directGuard).toBeGreaterThan(pointInfo);
    expect(pointDirect).toBeGreaterThan(directGuard);
    expect(pointDirect).toBeLessThan(spotLights);
    expect(materialGuard).toBeGreaterThan(patched.indexOf('pointLight = pointLights[ i ];'));
    expect(materialGuard).toBeLessThan(padGuard);
    expect(patched.slice(pointInfo, directGuard)).toContain('#ifdef STANDARD');
    expect(patched.match(/getPointLightInfo\(/g)).toHaveLength(
      source.match(/getPointLightInfo\(/g)?.length ?? 0,
    );
    expect(patched.match(/\bRE_Direct\(/g)).toHaveLength(
      source.match(/\bRE_Direct\(/g)?.length ?? 0,
    );
    expect(
      patched
        .replace(POINT_PAD_GUARD, '')
        .replace(POINT_DIRECT_GUARD, '')
        .replace(POINT_GUARD_CLOSE, ''),
    ).toBe(source);
  });

  it('serves only Lambert, Phong, and Standard while Toon and Basic remain stock', () => {
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
    const patched = patchPointLightFragmentChunk(THREE.ShaderChunk.lights_fragment_begin);
    expect(patchPointLightFragmentChunk(patched)).toBe(patched);
  });

  it.each([
    ['point-info', POINT_INFO],
    ['point-direct', POINT_DIRECT],
    ['spot-boundary', SPOT_LIGHTS],
  ])('throws when the pinned Three r165 %s anchor changes', (_name, anchor) => {
    const changed = THREE.ShaderChunk.lights_fragment_begin.replace(anchor, '/* changed anchor */');
    expect(() => patchPointLightFragmentChunk(changed)).toThrow(/Three r165 point-light chunk/);
  });
});
