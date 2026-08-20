import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sharedUniforms } from '../src/render/gfx';
import {
  applyIgnivarArenaFog,
  applyIgnivarArenaLighting,
  buildIgnivarArenaAtmosphere,
  IGNIVAR_AMBIENT_PARTICLES_NAME,
  IGNIVAR_ARENA_ATMOSPHERE_NAME,
  IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS,
  IGNIVAR_ARENA_LIGHTING,
  IGNIVAR_FORGE_VENTS_NAME,
  IGNIVAR_MOLTEN_PERIMETER_NAME,
  IGNIVAR_OBSIDIAN_OUTER_BAND_NAME,
  IGNIVAR_RUNIC_INLAYS_NAME,
} from '../src/render/ignivar_arena_atmosphere';
import { applyInteriorLightRig } from '../src/render/interior_light_rig';
import { IGNIVAR_CONDUITS } from '../src/sim/ignivar_arena';

const SEMANTIC_LAYERS = [
  IGNIVAR_OBSIDIAN_OUTER_BAND_NAME,
  IGNIVAR_MOLTEN_PERIMETER_NAME,
  IGNIVAR_RUNIC_INLAYS_NAME,
  IGNIVAR_FORGE_VENTS_NAME,
  IGNIVAR_AMBIENT_PARTICLES_NAME,
] as const;

function materialEmissiveIntensity(object: THREE.Object3D): number {
  const material = (object as THREE.Mesh).material as
    | THREE.MeshLambertMaterial
    | THREE.MeshStandardMaterial;
  return material.emissiveIntensity;
}

function worldGeometryPositions(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse((child) => {
    const geometry = (child as THREE.Mesh | THREE.Points).geometry;
    if (!geometry) return;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (child instanceof THREE.InstancedMesh) {
      const local = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      for (let instance = 0; instance < child.count; instance++) {
        child.getMatrixAt(instance, local);
        world.multiplyMatrices(child.matrixWorld, local);
        for (let index = 0; index < positions.count; index++) {
          out.push(
            new THREE.Vector3(
              positions.getX(index),
              positions.getY(index),
              positions.getZ(index),
            ).applyMatrix4(world),
          );
        }
      }
      return;
    }
    for (let index = 0; index < positions.count; index++) {
      out.push(
        new THREE.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        ).applyMatrix4(child.matrixWorld),
      );
    }
  });
  return out;
}

describe('Ignivar arena atmosphere', () => {
  it('builds named, non-actionable semantic layers outside the clear fighting floor', () => {
    const atmosphere = buildIgnivarArenaAtmosphere({ lowGfx: false });

    expect(IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS).toBe(18);
    expect(atmosphere.name).toBe(IGNIVAR_ARENA_ATMOSPHERE_NAME);
    expect(atmosphere.userData.floorClearRadius).toBe(IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS);
    expect(atmosphere.userData.collision).toBe('none');
    expect(atmosphere.userData.actionable).toBe(false);
    expect(atmosphere.userData.telegraph).toBe(false);
    const positions = worldGeometryPositions(atmosphere);
    expect(positions.length).toBeGreaterThan(500);
    for (const position of positions) {
      expect(Math.hypot(position.x, position.z)).toBeGreaterThanOrEqual(
        IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS - 1e-5,
      );
    }
    for (const name of SEMANTIC_LAYERS) {
      const layer = atmosphere.getObjectByName(name);
      expect(layer, name).toBeDefined();
      expect(layer?.userData.semanticLayer, name).toBe(name);
      expect(layer?.userData.minRadius, name).toBeGreaterThanOrEqual(
        IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS,
      );
      expect(layer?.userData.collision, name).toBe('none');
      expect(layer?.userData.actionable, name).toBe(false);
      expect(layer?.userData.telegraph, name).toBe(false);
    }
  });

  it('keeps bright placements in the outer band and clear of all four conduit stations', () => {
    const atmosphere = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const decoratedLayers = [
      IGNIVAR_MOLTEN_PERIMETER_NAME,
      IGNIVAR_RUNIC_INLAYS_NAME,
      'ignivarForgeVentCasings',
      'ignivarForgeVentCores',
    ];
    for (const name of decoratedLayers) {
      const layer = atmosphere.getObjectByName(name);
      expect(layer, name).toBeInstanceOf(THREE.InstancedMesh);
      for (const position of worldGeometryPositions(layer as THREE.InstancedMesh)) {
        expect(Math.hypot(position.x, position.z), name).toBeGreaterThan(
          IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS,
        );
        for (const conduit of IGNIVAR_CONDUITS) {
          expect(
            Math.hypot(position.x - conduit.x, position.z - conduit.z),
            conduit.id,
          ).toBeGreaterThan(atmosphere.userData.conduitClearRadius);
        }
      }
    }
  });

  it('scales cosmetic richness by tier while bounding permanent forge intensity', () => {
    const low = buildIgnivarArenaAtmosphere({ lowGfx: true });
    const high = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const lowRunes = low.getObjectByName(IGNIVAR_RUNIC_INLAYS_NAME) as THREE.InstancedMesh;
    const highRunes = high.getObjectByName(IGNIVAR_RUNIC_INLAYS_NAME) as THREE.InstancedMesh;
    const lowParticles = low.getObjectByName(IGNIVAR_AMBIENT_PARTICLES_NAME) as THREE.Points;
    const highParticles = high.getObjectByName(IGNIVAR_AMBIENT_PARTICLES_NAME) as THREE.Points;
    const lowChannels = low.getObjectByName(IGNIVAR_MOLTEN_PERIMETER_NAME) as THREE.InstancedMesh;
    const highChannels = high.getObjectByName(IGNIVAR_MOLTEN_PERIMETER_NAME) as THREE.InstancedMesh;

    expect(lowRunes.count).toBe(8);
    expect(highRunes.count).toBe(12);
    expect(lowParticles.geometry.getAttribute('position').count).toBe(32);
    expect(highParticles.geometry.getAttribute('position').count).toBe(96);
    expect(lowParticles.userData.smokeParticleCount).toBe(0);
    expect(highParticles.userData.smokeParticleCount).toBeGreaterThan(0);
    expect(materialEmissiveIntensity(highChannels)).toBeGreaterThan(
      materialEmissiveIntensity(lowChannels),
    );
    expect(materialEmissiveIntensity(lowChannels)).toBeGreaterThanOrEqual(0.6);
    expect(materialEmissiveIntensity(highChannels)).toBeLessThanOrEqual(1.4);
    expect(materialEmissiveIntensity(highRunes)).toBeLessThan(0.8);

    for (const atmosphere of [low, high]) {
      atmosphere.traverse((child) => {
        const material = (child as THREE.Mesh).material as
          | THREE.MeshLambertMaterial
          | THREE.MeshStandardMaterial
          | undefined;
        if (!material || !('emissiveIntensity' in material)) return;
        expect(material.emissiveIntensity, child.name).toBeGreaterThanOrEqual(0);
        expect(material.emissiveIntensity, child.name).toBeLessThanOrEqual(1.4);
      });
    }
  });

  it('preserves the authored floor beneath a restrained two-step obsidian wash', () => {
    const radialBounds = (mesh: THREE.Mesh): { min: number; max: number } => {
      const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const radii = Array.from({ length: positions.count }, (_, index) =>
        Math.hypot(positions.getX(index), positions.getZ(index)),
      );
      return { min: Math.min(...radii), max: Math.max(...radii) };
    };
    const expectedTiers = [
      {
        lowGfx: false,
        inner: { color: 0x190608, opacity: 0.18 },
        deep: { color: 0x120407, opacity: 0.34 },
      },
      {
        lowGfx: true,
        inner: { color: 0x240d0b, opacity: 0.14 },
        deep: { color: 0x1d0908, opacity: 0.26 },
      },
    ] as const;
    for (const expected of expectedTiers) {
      const atmosphere = buildIgnivarArenaAtmosphere({ lowGfx: expected.lowGfx });
      const band = atmosphere.getObjectByName(IGNIVAR_OBSIDIAN_OUTER_BAND_NAME) as THREE.Group;
      const inner = band.getObjectByName('ignivarObsidianInnerWash') as THREE.Mesh;
      const deep = band.getObjectByName('ignivarObsidianDeepWash') as THREE.Mesh;
      const innerMaterial = inner.material as THREE.MeshBasicMaterial;
      const deepMaterial = deep.material as THREE.MeshBasicMaterial;

      expect(band.userData.surface).toBe('obsidian-wash');
      expect(band.userData.innerFadeRadius).toBe(21.5);
      const innerBounds = radialBounds(inner);
      const deepBounds = radialBounds(deep);
      expect(innerBounds.min).toBeCloseTo(18, 5);
      expect(innerBounds.max).toBeCloseTo(21.5, 5);
      expect(deepBounds.min).toBeCloseTo(21.5, 5);
      expect(deepBounds.max).toBeCloseTo(29.25, 5);
      for (const material of [innerMaterial, deepMaterial]) {
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(material.blending).toBe(THREE.NormalBlending);
      }
      expect(innerMaterial.color.getHex()).toBe(expected.inner.color);
      expect(innerMaterial.opacity).toBe(expected.inner.opacity);
      expect(deepMaterial.color.getHex()).toBe(expected.deep.color);
      expect(deepMaterial.opacity).toBe(expected.deep.opacity);
      expect(innerMaterial.opacity).toBeLessThan(deepMaterial.opacity);
    }

    const second = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const third = buildIgnivarArenaAtmosphere({ lowGfx: false });
    expect((second.getObjectByName('ignivarObsidianInnerWash') as THREE.Mesh).material).toBe(
      (third.getObjectByName('ignivarObsidianInnerWash') as THREE.Mesh).material,
    );
    expect((second.getObjectByName('ignivarObsidianDeepWash') as THREE.Mesh).material).toBe(
      (third.getObjectByName('ignivarObsidianDeepWash') as THREE.Mesh).material,
    );
  });

  it('shares immutable resources and animates outer embers from the renderer clock', () => {
    const first = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const second = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const firstChannels = first.getObjectByName(
      IGNIVAR_MOLTEN_PERIMETER_NAME,
    ) as THREE.InstancedMesh;
    const secondChannels = second.getObjectByName(
      IGNIVAR_MOLTEN_PERIMETER_NAME,
    ) as THREE.InstancedMesh;
    const particles = first.getObjectByName(IGNIVAR_AMBIENT_PARTICLES_NAME) as THREE.Points;
    const material = particles.material as THREE.ShaderMaterial;

    expect(firstChannels.geometry).toBe(secondChannels.geometry);
    expect(firstChannels.material).toBe(secondChannels.material);
    expect(material.uniforms.uTime).toBe(sharedUniforms.uTime);
    expect(material.vertexShader).toContain('uTime');
    expect(material.fragmentShader).toContain('uIntensity');
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.userData.maxOpacity).toBeLessThanOrEqual(0.48);
  });

  it('exports the immutable Ignivar lighting grade as pinned literals', () => {
    expect(IGNIVAR_ARENA_LIGHTING).toEqual({
      fogColor: 0x120806,
      fogNear: 34,
      fogFar: 108,
      sunColor: 0xff8a4c,
      sunIntensity: 0.42,
      hemiSkyColor: 0x553028,
      hemiGroundColor: 0x090405,
      hemiIntensity: 0.34,
      envIntensity: 0.3,
      rimIntensity: 1.45,
      forgeLightColor: 0xff6a24,
      emberLightColor: 0xffb15a,
    });
    expect(Object.isFrozen(IGNIVAR_ARENA_LIGHTING)).toBe(true);
    expect(IGNIVAR_ARENA_LIGHTING.fogNear).toBeLessThan(IGNIVAR_ARENA_LIGHTING.fogFar);
    expect(IGNIVAR_ARENA_LIGHTING.sunIntensity).toBeLessThanOrEqual(0.5);
    expect(IGNIVAR_ARENA_LIGHTING.hemiIntensity).toBeLessThanOrEqual(0.4);
    expect(IGNIVAR_ARENA_LIGHTING.envIntensity).toBeLessThanOrEqual(0.35);
    expect(IGNIVAR_ARENA_LIGHTING.rimIntensity).toBeLessThanOrEqual(1.5);
  });

  it('is attached only through the Ignivar dungeon interior branch', () => {
    const source = readFileSync(new URL('../src/render/dungeon.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './ignivar_arena_atmosphere'");
    expect(source).toMatch(
      /if \(interior === 'ignivar'\) \{\s+group\.add\(buildIgnivarArenaAtmosphere\(\{ lowGfx: this\.lowGfx \}\)\);\s+\}/,
    );
    expect(source.match(/buildIgnivarArenaAtmosphere\(/g)).toHaveLength(1);
  });

  it('drives the renderer fog and lighting from the same immutable arena grade', () => {
    const fog = new THREE.Fog(0, 0, 1);
    const sun = new THREE.DirectionalLight(0, 0);
    const hemi = new THREE.HemisphereLight(0, 0, 0);
    const scene = new THREE.Scene();
    const rim = { value: 0 };
    applyIgnivarArenaFog(fog);
    applyIgnivarArenaLighting({ sun, hemi, scene, rim });
    expect({ color: fog.color.getHex(), near: fog.near, far: fog.far }).toEqual({
      color: IGNIVAR_ARENA_LIGHTING.fogColor,
      near: IGNIVAR_ARENA_LIGHTING.fogNear,
      far: IGNIVAR_ARENA_LIGHTING.fogFar,
    });
    expect({
      sunColor: sun.color.getHex(),
      sunIntensity: sun.intensity,
      hemiSkyColor: hemi.color.getHex(),
      hemiGroundColor: hemi.groundColor.getHex(),
      hemiIntensity: hemi.intensity,
      envIntensity: scene.environmentIntensity,
      rimIntensity: rim.value,
    }).toEqual({
      sunColor: IGNIVAR_ARENA_LIGHTING.sunColor,
      sunIntensity: IGNIVAR_ARENA_LIGHTING.sunIntensity,
      hemiSkyColor: IGNIVAR_ARENA_LIGHTING.hemiSkyColor,
      hemiGroundColor: IGNIVAR_ARENA_LIGHTING.hemiGroundColor,
      hemiIntensity: IGNIVAR_ARENA_LIGHTING.hemiIntensity,
      envIntensity: IGNIVAR_ARENA_LIGHTING.envIntensity,
      rimIntensity: IGNIVAR_ARENA_LIGHTING.rimIntensity,
    });

    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

    expect(source).toContain('ignivarRaidFogStateForInterior(interior ?? null)');
    expect(source).toMatch(
      /else if \(ignivarRaidFogState && desired === ignivarRaidFogState\) \{[\s\S]{0,160}?applyIgnivarRaidFog\(ignivarRaidFogState, fog\);/,
    );

    const routedSun = new THREE.DirectionalLight(0, 0);
    const routedHemi = new THREE.HemisphereLight(0, 0, 0);
    const routedScene = new THREE.Scene();
    const routedRim = { value: 0 };
    applyInteriorLightRig(
      'ignivar',
      { sun: routedSun, hemi: routedHemi, scene: routedScene, rim: routedRim },
      { sunIntensity: 9, hemiIntensity: 9, envIntensity: 9 },
    );
    expect({
      sunColor: routedSun.color.getHex(),
      sunIntensity: routedSun.intensity,
      hemiSkyColor: routedHemi.color.getHex(),
      hemiGroundColor: routedHemi.groundColor.getHex(),
      hemiIntensity: routedHemi.intensity,
      envIntensity: routedScene.environmentIntensity,
      rimIntensity: routedRim.value,
    }).toEqual({
      sunColor: IGNIVAR_ARENA_LIGHTING.sunColor,
      sunIntensity: IGNIVAR_ARENA_LIGHTING.sunIntensity,
      hemiSkyColor: IGNIVAR_ARENA_LIGHTING.hemiSkyColor,
      hemiGroundColor: IGNIVAR_ARENA_LIGHTING.hemiGroundColor,
      hemiIntensity: IGNIVAR_ARENA_LIGHTING.hemiIntensity,
      envIntensity: IGNIVAR_ARENA_LIGHTING.envIntensity,
      rimIntensity: IGNIVAR_ARENA_LIGHTING.rimIntensity,
    });
  });
});
