import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { addRimGlow, sharedUniforms } from '../src/render/gfx';
import {
  installPbrPointLightShaderPruning,
  patchPbrRimGlowFragmentShader,
} from '../src/render/pbr_fragment_shader';

const RIM_DECLARATION = `      // WOC_PBR_RIM_REUSE
      uniform float uRimBoost;`;
const RIM_TERM = `      totalEmissiveRadiance += vec3(0.5, 0.6, 0.8) * 0.12 * uRimBoost *
        pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);`;

describe('PBR point-light fragment pruning', () => {
  it('throws instead of silently leaving a changed shared light chunk stock', () => {
    const changedChunks = { lights_fragment_begin: 'void main() {}' };

    expect(() => installPbrPointLightShaderPruning(changedChunks)).toThrow(
      /Three r165 point-light chunk/,
    );
    expect(changedChunks.lights_fragment_begin).toBe('void main() {}');
  });

  it('changes only the shared chunk source without adding a permutation dimension', () => {
    const writes: PropertyKey[] = [];
    const chunks = new Proxy(
      {
        lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin,
        lights_fragment_end: 'sentinel',
      },
      {
        set(target, property, value) {
          writes.push(property);
          return Reflect.set(target, property, value);
        },
      },
    );
    const keys = Reflect.ownKeys(chunks);
    const sourceDefines = chunks.lights_fragment_begin.match(/^\s*#define.*$/gm);
    const first = installPbrPointLightShaderPruning(chunks);
    const second = installPbrPointLightShaderPruning(chunks);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(writes).toEqual(['lights_fragment_begin']);
    expect(Reflect.ownKeys(chunks)).toEqual(keys);
    expect(chunks.lights_fragment_end).toBe('sentinel');
    expect(chunks.lights_fragment_begin).toContain('if ( directLight.visible )');
    expect(chunks.lights_fragment_begin.match(/^\s*#define.*$/gm)).toEqual(sourceDefines);
  });

  it('installs from graphics initialization before the renderer can compile or render', () => {
    const gfx = readFileSync(new URL('../src/render/gfx.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const init = gfx.indexOf('export function initGfxTier');
    const install = gfx.indexOf('installPbrPointLightShaderPruning();', init);
    const probe = gfx.indexOf('const hints =', init);
    const rendererCreated = renderer.indexOf('this.webgl = new THREE.WebGLRenderer');
    const rendererInit = renderer.indexOf('initGfxTier(this.webgl)', rendererCreated);
    const firstCompile = renderer.indexOf('this.webgl.compile', rendererCreated);
    const firstRender = renderer.indexOf('this.webgl.render', rendererCreated);

    expect(init).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(init);
    expect(install).toBeLessThan(probe);
    expect(rendererCreated).toBeGreaterThanOrEqual(0);
    expect(rendererInit).toBeGreaterThan(rendererCreated);
    expect(firstCompile).toBeGreaterThan(rendererInit);
    expect(firstRender).toBeGreaterThan(rendererInit);
  });
});

describe('PBR character rim fragment pruning', () => {
  it('moves the exact rim equation to reuse the stock perspective view direction', () => {
    const source = THREE.ShaderLib.standard.fragmentShader;
    const patched = patchPbrRimGlowFragmentShader(source);
    const lights = patched.indexOf('#include <lights_fragment_begin>');
    const rim = patched.indexOf('dot(normal, geometryViewDir)');
    const expected = source
      .replace('#include <common>', `#include <common>\n${RIM_DECLARATION}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${RIM_TERM}`);

    expect(patched).toBe(expected);
    expect(rim).toBeGreaterThan(lights);
    expect(patched).not.toContain('dot(normal, normalize(vViewPosition))');
    expect(patched.match(/uRimBoost/g)).toHaveLength(2);
    expect(patched.match(/#include <emissivemap_fragment>/g)).toHaveLength(
      source.match(/#include <emissivemap_fragment>/g)?.length ?? 0,
    );
  });

  it('keeps the live material hook and shared uniform binding', () => {
    const material = new THREE.MeshStandardMaterial();
    const shader = {
      uniforms: {},
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof material.onBeforeCompile>[0];

    addRimGlow(material);
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.uniforms.uRimBoost).toBe(sharedUniforms.uRimBoost);
    expect(shader.fragmentShader).toContain(RIM_TERM);
  });

  it('composes after the actual terrain shader hook without losing either optimization', async () => {
    vi.doMock('../src/render/assets/loader', () => ({
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    vi.doMock('../src/render/assets/preload', () => ({
      registerPreload: () => undefined,
    }));
    vi.doMock('../src/render/textures', () => ({
      groundDetailTexture: () => new THREE.Texture(),
      groundSplatMaps: () => ({}),
      macroNoiseTexture: () => new THREE.Texture(),
    }));

    try {
      const { terrainInternalsForTest } = await import('../src/render/terrain');
      const material = terrainInternalsForTest.createSplatMaterial();
      const shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      } as Parameters<typeof material.onBeforeCompile>[0];
      const chunks = { lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin };

      addRimGlow(material);
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(installPbrPointLightShaderPruning(chunks)).toBe(true);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        chunks.lights_fragment_begin,
      );

      expect(shader.fragmentShader).toContain('flat varying vec4 vTerrainSplatPresence;');
      expect(shader.fragmentShader).toContain(RIM_TERM);
      expect(shader.fragmentShader).toContain('WOC_SKIP_ZERO_POINT_LIGHT');
    } finally {
      vi.doUnmock('../src/render/assets/loader');
      vi.doUnmock('../src/render/assets/preload');
      vi.doUnmock('../src/render/textures');
    }
  });

  it('leaves a real nonstandard material shader unchanged', () => {
    const material = new THREE.MeshBasicMaterial();
    const shader = {
      uniforms: {},
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as Parameters<typeof material.onBeforeCompile>[0];
    const source = shader.fragmentShader;

    addRimGlow(material);

    expect(() => material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)).not.toThrow();
    expect(shader.fragmentShader).toBe(source);
    expect(shader.uniforms.uRimBoost).toBeUndefined();
  });

  it('is idempotent and leaves a changed standard shader stock', () => {
    const patched = patchPbrRimGlowFragmentShader(THREE.ShaderLib.standard.fragmentShader);
    expect(patchPbrRimGlowFragmentShader(patched)).toBe(patched);
    expect(patchPbrRimGlowFragmentShader('void main() {}')).toBe('void main() {}');
  });
});
