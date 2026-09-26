import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { applyOccluderFade, occluderFadeMat } from '../src/render/occluder_fade';
import { stepOccluderFade } from '../src/render/occluder_fade_core';
import { buildOccluderFadeTwin } from '../src/render/occluder_fade_gate';

// These suites pin the BLENDED arm (the transparent twin and its gate); the
// dithered arm has its own suite, tests/occluder_dither_fade.test.ts.
beforeEach(() => setDitherFadeEnabledForTest(false));

describe('occluder fade material application', () => {
  it('drives the visible material to the literal ghost alpha and restores authored state', () => {
    const material = new THREE.MeshStandardMaterial({
      opacity: 0.75,
      transparent: false,
      depthWrite: false,
    });
    const fade = occluderFadeMat(
      material,
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material),
    );
    const opaqueVersion = material.version;

    const alpha = stepOccluderFade(1, true, 1 / 60);
    expect(alpha).toBe(0.2);
    applyOccluderFade([fade], alpha);

    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.75 * 0.2);
    expect(material.depthWrite).toBe(true);
    expect(material.version).toBeGreaterThan(opaqueVersion);

    const fadedVersion = material.version;
    applyOccluderFade([fade], 1);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(0.75);
    expect(material.depthWrite).toBe(false);
    expect(material.version).toBeGreaterThan(fadedVersion);
  });

  it('keeps a double-sided structure on one pass, so its fade links one twin', () => {
    // three draws a transparent DoubleSide material as a back-face pass and a
    // front-face pass, each with its own program. The fade writes depth, so one
    // pass draws the same ghost; the twin is cloned from the record's material
    // and must inherit the opt-out, or the prewarm would still link both.
    const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    expect(material.forceSinglePass).toBe(false);
    occluderFadeMat(material, mesh);
    expect(material.forceSinglePass).toBe(true);

    const twin = buildOccluderFadeTwin(
      { material, geometry: mesh.geometry, instanced: false, instanceColor: false },
      'ghost-fade-prewarm',
    );
    const twinMaterial = twin.material as THREE.Material;
    expect(twinMaterial.transparent).toBe(true);
    expect(twinMaterial.side).toBe(THREE.DoubleSide);
    expect(twinMaterial.forceSinglePass).toBe(true);
  });

  it('leaves an authored transparent material on its two face passes', () => {
    // A window pane draws transparent all the time, not only while it ghosts.
    const pane = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true });
    occluderFadeMat(pane, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pane));
    expect(pane.forceSinglePass).toBe(false);
  });
});
