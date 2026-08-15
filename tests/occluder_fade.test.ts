import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyOccluderFade, occluderFadeMat } from '../src/render/occluder_fade';
import { stepOccluderFade } from '../src/render/occluder_fade_core';

describe('occluder fade material application', () => {
  it('drives the visible material to the literal ghost alpha and restores authored state', () => {
    const material = new THREE.MeshStandardMaterial({
      opacity: 0.75,
      transparent: false,
      depthWrite: false,
    });
    const fade = occluderFadeMat(material);
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
});
