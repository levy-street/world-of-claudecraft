import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { installFinalColorNanGuard } from '../src/render/final_color_nan_guard';
import { activateGfxProfile, type GfxCapabilities, resolveGfxProfile } from '../src/render/gfx';

const originalOpaqueFragment = THREE.ShaderChunk.opaque_fragment;
const originalFogFragment = THREE.ShaderChunk.fog_fragment;

const desktopCapabilities: GfxCapabilities = Object.freeze({
  deviceMemory: 8,
  hardwareConcurrency: 12,
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
  gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
  nativeApp: false,
  tightMemory: false,
  platform: 'other',
  softwareRendering: false,
});

const basePreferences: GraphicsSettingsSnapshot = {
  graphicsPreset: 2,
  terrainDetail: 1,
  foliageDensity: 1,
  surfaceDetail: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  antiAliasing: 1,
  bloomQuality: 1,
  ambientOcclusion: 1,
  viewDistance: 1,
  waterQuality: 1,
  characterDetail: 1,
  dynamicLights: 1,
  particleEffects: 1,
};

afterEach(() => {
  THREE.ShaderChunk.opaque_fragment = originalOpaqueFragment;
  THREE.ShaderChunk.fog_fragment = originalFogFragment;
});

describe('installFinalColorNanGuard', () => {
  it('installs itself as an import side effect, before any test here calls it explicitly', () => {
    // This file's own top-level import above is the only thing that has run
    // so far; nothing in this test calls installFinalColorNanGuard first, yet
    // the shared THREE.ShaderChunk is already patched.
    expect(THREE.ShaderChunk.opaque_fragment).toContain('WOC_OPAQUE_NAN_GUARD');
    expect(THREE.ShaderChunk.fog_fragment).toContain('WOC_FOG_NAN_GUARD');
  });

  it('reports unchanged calling the default (THREE.ShaderChunk) form again: already installed', () => {
    expect(installFinalColorNanGuard()).toBe(false);
  });

  it('detects a change when either chunk differs, and is idempotent on a synthetic source pair', () => {
    // Independent of THREE.ShaderChunk's real (already-patched) state: minimal
    // stand-ins containing just the anchor each core patch function requires.
    const chunks = {
      opaque_fragment: 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      fog_fragment: 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    };
    const changed = installFinalColorNanGuard(chunks);
    expect(changed).toBe(true);
    expect(chunks.opaque_fragment).toContain('WOC_OPAQUE_NAN_GUARD');
    expect(chunks.fog_fragment).toContain('WOC_FOG_NAN_GUARD');

    const changedAgain = installFinalColorNanGuard(chunks);
    expect(changedAgain).toBe(false);
  });
});

describe('installFinalColorNanGuard call sites', () => {
  it('module scope installs unconditionally, so no renderer construction site has to remember to', () => {
    // characters/preview.ts, characters/portrait.ts and armory_preview.ts each
    // build their own WebGLRenderer and never call initGfxTier; a per-site call
    // was tried and missed two of those three. The last statement in the
    // module is the bare, unconditional install call: importing this module
    // anywhere in the game client's static import graph (it is, via gfx.ts,
    // itself imported from main.ts) is what covers all of them.
    const source = readFileSync(
      new URL('../src/render/final_color_nan_guard.ts', import.meta.url),
      'utf8',
    );
    const lastStatement = source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('//'))
      .at(-1);
    expect(lastStatement).toBe('installFinalColorNanGuard();');
  });

  it('gfx.ts imports final_color_nan_guard.ts for the module-scope install, and never calls it directly', () => {
    // gfx.ts is what every renderer in this codebase reaches, directly or
    // transitively (world renderer, CharacterPreview, character portraits,
    // armory preview, the guide viewer, the editor's asset thumbnails, the
    // outfit-audit dev tool): a bare import here is what actually gives all
    // of them the guard. installPbrPointLightShaderPruning is DIFFERENT: it
    // stays an explicit call inside initGfxTier on purpose (see the comment
    // there), since only the world renderer needs point-light pruning today.
    // A call here for the NaN guard would be provably dead code (the bare
    // import below, itself a static dependency of this file, always runs
    // first) with a comment implying otherwise; that was tried and reverted.
    const gfx = readFileSync(new URL('../src/render/gfx.ts', import.meta.url), 'utf8');
    expect(gfx).toMatch(/^import ['"]\.\/final_color_nan_guard['"];?\s*$/m);
    expect(gfx).not.toContain('installFinalColorNanGuard(');
  });

  it('the world renderer reaches gfx.ts (and so the guard) before it can compile or render', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const rendererCreated = renderer.indexOf('this.webgl = new THREE.WebGLRenderer');
    const rendererInit = renderer.indexOf('initGfxTier(this.webgl)', rendererCreated);
    const firstCompile = renderer.indexOf('this.webgl.compile', rendererCreated);
    const firstRender = renderer.indexOf('this.webgl.render', rendererCreated);

    expect(rendererCreated).toBeGreaterThanOrEqual(0);
    expect(rendererInit).toBeGreaterThan(rendererCreated);
    expect(firstCompile).toBeGreaterThan(rendererInit);
    expect(firstRender).toBeGreaterThan(rendererInit);
  });
});

describe('patchOpaqueFragmentNanGuard coverage in stock shaders', () => {
  it('does not depend on <fog_fragment> being present to scrub outgoingLight', () => {
    // The opaque guard scrubs outgoingLight before the opaque write whether or
    // not USE_FOG is defined. Walking ShaderLib keeps this pinned on the stock
    // materials that reach <opaque_fragment>, without depending on fog_fragment
    // as a second line of defense for the same value.
    const withOpaque: string[] = [];
    for (const [name, shader] of Object.entries(THREE.ShaderLib)) {
      const hasOpaque = shader.fragmentShader.includes('#include <opaque_fragment>');
      if (hasOpaque) withOpaque.push(name);
    }
    expect(withOpaque.length).toBeGreaterThan(0);
    expect(THREE.ShaderChunk.opaque_fragment).toContain('outgoingLight.x = ( outgoingLight.x');
    expect(THREE.ShaderChunk.opaque_fragment).not.toContain('#ifndef USE_FOG');
  });

  it('keeps global chunks patched across profile activation', () => {
    THREE.ShaderChunk.opaque_fragment = originalOpaqueFragment;
    THREE.ShaderChunk.fog_fragment = originalFogFragment;
    installFinalColorNanGuard();

    const gradePassProfile = resolveGfxProfile(desktopCapabilities, basePreferences, '');
    expect(gradePassProfile.settings.gradePass).toBe(true);
    activateGfxProfile(gradePassProfile);
    expect(THREE.ShaderChunk.opaque_fragment).toContain('WOC_OPAQUE_NAN_GUARD');
    expect(THREE.ShaderChunk.fog_fragment).toContain('WOC_FOG_NAN_GUARD');

    const directProfile = resolveGfxProfile(
      desktopCapabilities,
      { ...basePreferences, graphicsPreset: 1 },
      '',
    );
    expect(directProfile.settings.gradePass).toBe(false);
    activateGfxProfile(directProfile);
    expect(THREE.ShaderChunk.opaque_fragment).toContain('WOC_OPAQUE_NAN_GUARD');
    expect(THREE.ShaderChunk.fog_fragment).toContain('WOC_FOG_NAN_GUARD');
  });
});
