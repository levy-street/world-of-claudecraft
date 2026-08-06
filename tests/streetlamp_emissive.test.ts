import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  captureStreetlampEmissive,
  LAMP_FLAME_MATERIAL,
  LAMP_GLASS_MATERIAL,
  LAMP_SOURCE_MATERIAL,
  streetlampEmissiveInternalsForTest,
  streetlampEmissiveRole,
  updateStreetlampEmissive,
} from '../src/render/streetlamp_emissive';

describe('streetlamp authored emissive', () => {
  it('binds only the authored lamp materials, never the housing', () => {
    expect(streetlampEmissiveRole(LAMP_SOURCE_MATERIAL)).toBe('source');
    expect(streetlampEmissiveRole(LAMP_FLAME_MATERIAL)).toBe('flame');
    expect(streetlampEmissiveRole(LAMP_GLASS_MATERIAL)).toBe('glass');
    for (const housing of ['tripo_material_21603f28', 'Post', 'roof', '']) {
      expect(streetlampEmissiveRole(housing), housing).toBeNull();
      const material = new THREE.MeshStandardMaterial({ emissiveIntensity: 1 });
      expect(captureStreetlampEmissive(housing, material), housing).toBeNull();
      // A post that is never captured is never driven, at any glow.
      expect(material.emissiveIntensity).toBe(1);
    }
  });

  it('scales the authored intensity by its role gain and starts dark', () => {
    const { roleGain } = streetlampEmissiveInternalsForTest;
    const source = new THREE.MeshStandardMaterial({ emissiveIntensity: 1 });
    const glass = new THREE.MeshStandardMaterial({ emissiveIntensity: 1 });
    const sourceState = captureStreetlampEmissive(LAMP_SOURCE_MATERIAL, source);
    const glassState = captureStreetlampEmissive(LAMP_GLASS_MATERIAL, glass);
    if (!sourceState || !glassState) throw new Error('authored lamp materials must bind');

    // Captured dark: a lamp is out by day until the frame's glow drives it.
    expect(source.emissiveIntensity).toBe(0);
    expect(glass.emissiveIntensity).toBe(0);

    updateStreetlampEmissive(sourceState, 1);
    updateStreetlampEmissive(glassState, 1);
    expect(source.emissiveIntensity).toBeCloseTo(roleGain.source, 6);
    expect(glass.emissiveIntensity).toBeCloseTo(roleGain.glass, 6);
    // The emitter must out-read its own pane, or the housing washes out.
    expect(source.emissiveIntensity).toBeGreaterThan(glass.emissiveIntensity);
    // A flame is driven exactly like a steady source; only its SHADER differs,
    // so a fixture never changes brightness merely by being animated.
    expect(roleGain.flame).toBe(roleGain.source);

    updateStreetlampEmissive(sourceState, 0.5);
    expect(source.emissiveIntensity).toBeCloseTo(roleGain.source * 0.5, 6);
    updateStreetlampEmissive(sourceState, 0);
    expect(source.emissiveIntensity).toBe(0);
    updateStreetlampEmissive(sourceState, -1);
    expect(source.emissiveIntensity).toBe(0);
  });

  it('carries an authored emissive strength above 1 through the role gain', () => {
    const { roleGain } = streetlampEmissiveInternalsForTest;
    // KHR_materials_emissive_strength lands on emissiveIntensity; a fixture
    // authored hotter than 1 must stay proportionally hotter at runtime.
    const material = new THREE.MeshStandardMaterial({ emissiveIntensity: 2.5 });
    const state = captureStreetlampEmissive(LAMP_SOURCE_MATERIAL, material);
    if (!state) throw new Error('authored source material must bind');
    expect(state.litIntensity).toBeCloseTo(2.5 * roleGain.source, 6);
    updateStreetlampEmissive(state, 1);
    expect(material.emissiveIntensity).toBeCloseTo(2.5 * roleGain.source, 6);
  });
});
