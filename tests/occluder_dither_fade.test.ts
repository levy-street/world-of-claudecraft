import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, type GfxProfile } from '../src/render/gfx';
import {
  attachDitherFade,
  ditherFadeEnabled,
  ditherFadeUniform,
  setDitherFadeEnabledForTest,
} from '../src/render/occluder_dither_fade';
import {
  advanceOccluderFade,
  applyOccluderFade,
  occluderFadeMat,
  occluderFadeReady,
} from '../src/render/occluder_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import { buildGhostVariantPrewarmGroup } from '../src/render/occluder_ghost_prewarm';

function structure(): { material: THREE.MeshStandardMaterial; mesh: THREE.Mesh } {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  return { material, mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material) };
}

describe('dithered camera ghost', () => {
  beforeEach(() => setDitherFadeEnabledForTest(true));
  afterEach(() => setDitherFadeEnabledForTest(null));

  it('fades through one uniform and never flips the material transparent', () => {
    const { material, mesh } = structure();
    const fade = occluderFadeMat(material, mesh);
    const uniform = ditherFadeUniform(material);
    expect(uniform?.value).toBe(1);
    const version = material.version;

    applyOccluderFade([fade], OCCLUDER_FADE_ALPHA);
    expect(uniform?.value).toBe(OCCLUDER_FADE_ALPHA);
    // The whole point: `transparent` is what three keys a second program on.
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    // No needsUpdate either: a uniform write must not ask for a program swap.
    expect(material.version).toBe(version);

    applyOccluderFade([fade], 1);
    expect(uniform?.value).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it('splices the ordered discard into the fragment and extends the cache key', () => {
    const material = new THREE.MeshStandardMaterial();
    material.customProgramCacheKey = () => 'base';
    attachDitherFade(material);
    expect(material.customProgramCacheKey()).toBe('base|ghost-dither-fade-v1');
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader: 'void main() {\n#include <clipping_planes_fragment>\n}',
    };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uGhostFade).toBe(ditherFadeUniform(material));
    expect(shader.fragmentShader).toContain('uniform float uGhostFade;');
    expect(shader.fragmentShader).toContain('discard;');
    // Idempotent: a second attach must not chain a second copy of the layer.
    attachDitherFade(material);
    expect(material.customProgramCacheKey()).toBe('base|ghost-dither-fade-v1');
  });

  it('keeps the hooks a material already carried', () => {
    const material = new THREE.MeshStandardMaterial();
    let ran = 0;
    material.onBeforeCompile = () => {
      ran += 1;
    };
    material.customProgramCacheKey = () => 'earlier-layer';
    attachDitherFade(material);
    material.onBeforeCompile(
      { uniforms: {}, vertexShader: '', fragmentShader: '' } as never,
      null as never,
    );
    expect(ran).toBe(1);
    expect(material.customProgramCacheKey()).toBe('earlier-layer|ghost-dither-fade-v1');
  });

  it('keeps two hooked materials with no own cache key on two programs', () => {
    // Three's default key is the current hook's source: once this layer is the
    // hook, two different previous hooks would otherwise read as one program.
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// layer a\n${shader.fragmentShader}`;
    };
    const b = new THREE.MeshStandardMaterial();
    b.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// layer b\n${shader.fragmentShader}`;
    };
    attachDitherFade(a);
    attachDitherFade(b);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });

  it('never hands a clone a dead copy of the fade uniform', () => {
    const { material } = structure();
    attachDitherFade(material);
    const clone = material.clone();
    expect(ditherFadeUniform(clone)).toBeNull();
    attachDitherFade(clone);
    expect(ditherFadeUniform(clone)).not.toBe(ditherFadeUniform(material));
  });

  it('has no transparent twin to wait for, and warms none at boot', () => {
    const { material, mesh } = structure();
    const fade = occluderFadeMat(material, mesh);
    // The blended arm would consult the gate here and hold the flip.
    expect(occluderFadeReady([fade], 'edge')).toBe(true);
    const root = new THREE.Group();
    root.add(mesh);
    expect(buildGhostVariantPrewarmGroup(root).children).toHaveLength(0);
  });

  it('restores in one step instead of walking the stipple back through every density', () => {
    const { material, mesh } = structure();
    const fade = occluderFadeMat(material, mesh);
    const ghosted = advanceOccluderFade([fade], 1, true, 1 / 60);
    expect(ghosted).toBe(OCCLUDER_FADE_ALPHA);
    const restored = advanceOccluderFade([fade], ghosted, false, 1 / 60);
    expect(restored).toBe(1);
    expect(ditherFadeUniform(material)?.value).toBe(1);
  });
});

describe('dithered camera ghost style', () => {
  afterEach(() => setDitherFadeEnabledForTest(null));

  it('follows a profile activated later in the same page', () => {
    // A graphics rebuild republishes GFX without a reload; a style memoized at
    // first read would leave the rebuilt world on the old one.
    setDitherFadeEnabledForTest(null);
    const before = { settings: { ...GFX } } as GfxProfile;
    try {
      activateGfxProfile({ settings: { ...GFX, ditheredGhostFade: true } } as GfxProfile);
      expect(ditherFadeEnabled()).toBe(true);
      activateGfxProfile({ settings: { ...GFX, ditheredGhostFade: false } } as GfxProfile);
      expect(ditherFadeEnabled()).toBe(false);
    } finally {
      activateGfxProfile(before);
    }
  });
});
