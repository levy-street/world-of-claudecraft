import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_FIRE_BEAM_CORE_NAME,
  IGNIVAR_FIRE_BEAM_EMBERS_NAME,
  IGNIVAR_FIRE_BEAM_FLAMES_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME,
  IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME,
  IGNIVAR_FIRE_BEAM_OUTER_NAME,
  IGNIVAR_FIRE_BEAM_VEIL_NAME,
} from '../src/render/ignivar_fire_beams';
import {
  buildIgnivarRotatingRaysTelegraph,
  IGNIVAR_ROTATING_RAY_BLADE_NAME,
} from '../src/render/ignivar_rotating_rays';

describe('Ignivar Revolving Inferno VFX', () => {
  it('builds three thermally graded flamethrowers without solid blade tips', () => {
    const rays = buildIgnivarRotatingRaysTelegraph();
    const fireBeams = rays.children.filter((child) => child.userData.vfxLayer === 'fireBeam');
    expect(fireBeams).toHaveLength(3);

    for (const beam of fireBeams) {
      const outer = beam.getObjectByName(IGNIVAR_FIRE_BEAM_OUTER_NAME) as THREE.Mesh;
      const core = beam.getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME) as THREE.Mesh;
      const flames = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLAMES_NAME) as THREE.InstancedMesh;
      const embers = beam.getObjectByName(IGNIVAR_FIRE_BEAM_EMBERS_NAME) as THREE.Points;
      const floorHeat = beam.getObjectByName(IGNIVAR_FIRE_BEAM_FLOOR_GLOW_NAME) as THREE.Mesh;
      const floorBoundary = beam.getObjectByName(
        IGNIVAR_FIRE_BEAM_FLOOR_BOUNDARY_NAME,
      ) as THREE.Mesh;
      const veil = beam.getObjectByName(IGNIVAR_FIRE_BEAM_VEIL_NAME) as THREE.Mesh;
      const tip = beam.getObjectByName(IGNIVAR_ROTATING_RAY_BLADE_NAME) as THREE.Group;
      const outerMaterial = outer.material as THREE.MeshBasicMaterial;
      const coreMaterial = core.material as THREE.MeshBasicMaterial;

      expect(outerMaterial.userData.ignivarThermalLayer).toBe('turbulentShell');
      expect(outerMaterial.customProgramCacheKey()).toContain('ignivar-fire-beam-outer-v2');
      expect(coreMaterial.userData.ignivarThermalLayer).toBe('whiteHotCore');
      expect(coreMaterial.color.getHex()).toBe(0xffd36a);
      expect(coreMaterial.blending).toBe(THREE.AdditiveBlending);
      expect((floorHeat.material as THREE.Material).userData.ignivarThermalLayer).toBe('floorHeat');
      expect((floorBoundary.material as THREE.Material).userData.ignivarThermalLayer).toBe(
        'floorBoundary',
      );
      expect((veil.material as THREE.Material).userData.ignivarThermalLayer).toBe('flameVeil');
      expect((flames.material as THREE.Material).userData.ignivarThermalLayer).toBe(
        'thermalTongues',
      );

      expect(flames.count).toBe(28);
      expect(flames.instanceColor).not.toBeNull();
      const temperatures = new Set<number>();
      const color = new THREE.Color();
      for (let index = 0; index < flames.count; index++) {
        flames.getColorAt(index, color);
        temperatures.add(color.getHex());
      }
      expect(temperatures.size).toBeGreaterThanOrEqual(3);
      expect(temperatures).toContain(0xfff2b0);
      expect(temperatures).toContain(0xff5a0a);
      expect(embers.geometry.getAttribute('position').count).toBe(48);

      const tipMesh = tip.children[0] as THREE.InstancedMesh;
      expect(tip.children).toHaveLength(1);
      expect(tipMesh.isInstancedMesh).toBe(true);
      expect(tipMesh.count).toBe(7);
      expect(tipMesh.geometry.type).toBe('ConeGeometry');
      expect((tipMesh.material as THREE.Material).userData.ignivarThermalLayer).toBe('flameTip');
      expect(tipMesh.instanceColor).not.toBeNull();
      const tipTemperatures = new Set<number>();
      for (let index = 0; index < tipMesh.count; index++) {
        tipMesh.getColorAt(index, color);
        tipTemperatures.add(color.getHex());
      }
      expect(tipTemperatures).toEqual(new Set([0xfff2b0, 0xffb02e, 0xff5a0a]));
    }
  });
});
