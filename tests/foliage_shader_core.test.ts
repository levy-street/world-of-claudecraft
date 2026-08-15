import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  patchCanopyDetailShaderSource,
  patchConstantUpNormalVertexShader,
  patchGrassFragmentShader,
  reuseDiffuseMapSampleForEmissive,
} from '../src/render/foliage_shader_core';

const BASE_VERTEX = [
  '#include <common>',
  'void main() {',
  '#include <beginnormal_vertex>',
  '#include <project_vertex>',
  '}',
].join('\n');

const BASE_FRAGMENT = [
  '#include <common>',
  'void main() {',
  '#include <map_fragment>',
  '#include <color_fragment>',
  '#include <alphatest_fragment>',
  '#include <normal_fragment_maps>',
  '#include <emissivemap_fragment>',
  '}',
].join('\n');

describe('foliage shader core', () => {
  it('replaces an all-up normal buffer with the exact existing shader value', () => {
    const shader = patchConstantUpNormalVertexShader(
      ['void main() {', '#include <beginnormal_vertex>', '}'].join('\n'),
    );
    expect(shader).toContain('vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    expect(shader).not.toContain('#include <beginnormal_vertex>');
  });

  it('rejects raw transparent grass texels before either monotonic distance fade', () => {
    const shader = patchGrassFragmentShader(BASE_FRAGMENT);
    const earlyDiscard = shader.indexOf('if (diffuseColor.a < alphaTest) discard;');
    const farFade = shader.indexOf('distance(vTuftWorld, uPlayerPos)');
    const farDiscard = shader.lastIndexOf('if (diffuseColor.a < alphaTest) discard;');
    const nearFade = shader.indexOf('length(vViewPosition)');
    const stockDiscard = shader.indexOf('#include <alphatest_fragment>');

    expect(earlyDiscard).toBeGreaterThan(shader.indexOf('#include <map_fragment>'));
    expect(earlyDiscard).toBeLessThan(farFade);
    expect(farFade).toBeLessThan(farDiscard);
    expect(farDiscard).toBeLessThan(nearFade);
    expect(nearFade).toBeLessThan(stockDiscard);
    expect(shader.match(/if \(diffuseColor\.a < alphaTest\) discard;/g)).toHaveLength(2);
    expect(shader).toContain(
      'diffuseColor.a *= 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, distance(vTuftWorld, uPlayerPos));',
    );
    expect(shader).toContain('diffuseColor.a *= smoothstep(0.45, 1.35, length(vViewPosition));');
  });

  it('runs canopy AO taps only after the unchanged stock alpha test', () => {
    const patched = patchCanopyDetailShaderSource(BASE_VERTEX, BASE_FRAGMENT, {
      fadeStart: 34,
      fadeEnd: 55,
      creviceDownStart: 0.15,
      creviceDownFull: 0.7,
    });
    const alphaTest = patched.fragmentShader.indexOf('#include <alphatest_fragment>');
    const canopyFade = patched.fragmentShader.indexOf('float canopyDetK =');
    const canopyProjection = patched.fragmentShader.indexOf(
      'canopyP = vCanopyWorldPos * uCanopyTile;',
    );
    const normalMaps = patched.fragmentShader.indexOf('#include <normal_fragment_maps>');

    expect(canopyProjection).toBeGreaterThan(alphaTest);
    expect(canopyProjection).toBeGreaterThan(canopyFade);
    expect(canopyProjection).toBeLessThan(normalMaps);
    expect(patched.fragmentShader.match(/texture2D\( uCanopyAoTex/g)).toHaveLength(3);
    expect(patched.fragmentShader.match(/texture2D\( uCanopyNormalTex/g)).toHaveLength(3);
    expect(patched.fragmentShader.match(/normalize\( vCanopyWorldNormal \)/g)).toHaveLength(1);
    expect(patched.fragmentShader).not.toContain('#include <color_fragment>\n        vec3 canopyP');
    expect(patched.fragmentShader).toContain('canopyW = pow( abs( canopyGN ), vec3( 4.0 ) );');
    expect(patched.fragmentShader).toContain('canopyW /= ( canopyW.x + canopyW.y + canopyW.z );');
    expect(patched.fragmentShader).toContain(
      'canopyAoTerm = mix( 1.0, uCanopyAoLo + canopyAo * uCanopyAoSpan, canopyDetK );',
    );
    expect(patched.fragmentShader).toContain(
      'canopyShade = canopyAoTerm\n          * ( 1.0 - uCanopyCrevice * smoothstep( 0.15, 0.70, vCanopyDown ) );',
    );
    const shadeAt = patched.fragmentShader.indexOf('diffuseColor.rgb *= canopyShade;');
    const desaturateAt = patched.fragmentShader.indexOf('diffuseColor.rgb = mix(');
    expect(shadeAt).toBeLessThan(desaturateAt);
  });

  it('reuses the exact diffuse-map sample and preserves later canopy emissive shading', () => {
    const shader = reuseDiffuseMapSampleForEmissive(
      [
        '#include <map_fragment>',
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance *= canopyShade * canopyShade;',
      ].join('\n'),
    );

    expect(shader).toContain('totalEmissiveRadiance *= sampledDiffuseColor.rgb;');
    expect(shader).not.toContain('#include <emissivemap_fragment>');
    expect(shader).not.toContain('texture2D( emissiveMap');
    expect(shader).toContain('totalEmissiveRadiance *= canopyShade * canopyShade;');
    expect(THREE.ShaderChunk.emissivemap_fragment).toContain(
      'texture2D( emissiveMap, vEmissiveMapUv )',
    );
  });

  it('patches every required anchor in the pinned Three standard shaders', () => {
    const grassVertex = patchConstantUpNormalVertexShader(THREE.ShaderLib.standard.vertexShader);
    const grassFragment = patchGrassFragmentShader(THREE.ShaderLib.standard.fragmentShader);
    const canopy = patchCanopyDetailShaderSource(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
      {
        fadeStart: 34,
        fadeEnd: 55,
        creviceDownStart: 0.15,
        creviceDownFull: 0.7,
      },
    );
    const sharedMap = reuseDiffuseMapSampleForEmissive(canopy.fragmentShader);

    expect(grassVertex).not.toContain('#include <beginnormal_vertex>');
    expect(grassFragment).toContain('varying vec2 vTuftWorld;');
    expect(grassFragment).toContain('distance(vTuftWorld, uPlayerPos)');
    expect(canopy.vertexShader).toContain('varying vec3 vCanopyWorldPos;');
    expect(canopy.fragmentShader).toContain('float canopyDetK =');
    expect(canopy.fragmentShader).toContain('totalEmissiveRadiance *= canopyShade * canopyShade;');
    expect(
      createHash('sha256').update(canopy.vertexShader).digest('hex'),
      'exact standard-material canopy vertex output',
    ).toBe('8a93806ae56dfadc3f6ba6f26b26545bc5e9b4f5caa37b5c849824e7403f1563');
    expect(
      createHash('sha256').update(canopy.fragmentShader).digest('hex'),
      'exact standard-material canopy fragment output',
    ).toBe('1670272f361815b3df9bddf0ce4fb727a6cacd1ba24e0f88826ef2945f920427');
    expect(sharedMap).not.toContain('#include <emissivemap_fragment>');
    expect(sharedMap).toContain('totalEmissiveRadiance *= sampledDiffuseColor.rgb;');
  });
});
