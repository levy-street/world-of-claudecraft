// The Council's Seat kit (render/props.ts convertMaterial): each model ships a glow map, its
// painted crystals, coals, seal and cracks on black. Only the 'council' kit lights it; every
// other kit rebuilt its materials without an emissive map before this and still does.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propMaterialInternalsForTest } from '../src/render/props';

const { convertMaterial } = propMaterialInternalsForTest;

function glowTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 120, 40, 255]), 2, 1);
  tex.needsUpdate = true;
  return tex;
}

function source(name: string, glow: THREE.Texture | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name, color: 0xffffff });
  mat.map = new THREE.DataTexture(new Uint8Array([200, 200, 220, 255]), 1, 1);
  if (glow) {
    mat.emissiveMap = glow;
    mat.emissive = new THREE.Color(0xffffff);
  }
  return mat;
}

describe("the Council's Seat glow map", () => {
  it("lights the model's own emissive map in the council kit, calmly", () => {
    const glow = glowTexture();
    const out = convertMaterial(
      source('council_glow_a', glow),
      'council',
      false,
    ) as THREE.MeshStandardMaterial;
    expect(out.emissiveMap).toBe(glow);
    expect(out.emissive.getHex()).toBe(0xffffff);
    // a calm glow: lit, but under full strength
    expect(out.emissiveIntensity).toBeGreaterThan(0.3);
    expect(out.emissiveIntensity).toBeLessThanOrEqual(1);
  });

  it('leaves every other kit exactly as before: an emissive map is dropped', () => {
    const out = convertMaterial(
      source('council_glow_b', glowTexture()),
      'qprops',
      false,
    ) as THREE.MeshStandardMaterial;
    expect(out.emissiveMap).toBeNull();
    expect(out.emissive.getHex()).toBe(0x000000);
  });

  it('gives a council material with no glow map no glow', () => {
    const out = convertMaterial(
      source('council_glow_c', null),
      'council',
      false,
    ) as THREE.MeshStandardMaterial;
    expect(out.emissiveMap).toBeNull();
    expect(out.emissive.getHex()).toBe(0x000000);
  });

  it('never shares one cached material between a glowing namesake and a dark one', () => {
    const lit = convertMaterial(source('council_glow_d', glowTexture()), 'council', false);
    const dark = convertMaterial(source('council_glow_d', null), 'council', false);
    expect(lit).not.toBe(dark);
    expect((lit as THREE.MeshStandardMaterial).emissiveMap).not.toBeNull();
    expect((dark as THREE.MeshStandardMaterial).emissiveMap).toBeNull();
  });
});
