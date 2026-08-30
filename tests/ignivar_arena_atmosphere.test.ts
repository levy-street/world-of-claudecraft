import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyFogScenePreset } from '../src/render/fog_scene_state';
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
  IGNIVAR_RUNIC_INLAYS_NAME,
} from '../src/render/ignivar_arena_atmosphere';
import { applyInteriorLightRig } from '../src/render/interior_light_rig';
import { IGNIVAR_CONDUITS } from '../src/sim/ignivar_arena';

const SEMANTIC_LAYERS = [
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

    expect(lowRunes.count).toBe(8);
    expect(highRunes.count).toBe(12);
    expect(lowParticles.geometry.getAttribute('position').count).toBe(32);
    expect(highParticles.geometry.getAttribute('position').count).toBe(96);
    expect(lowParticles.userData.smokeParticleCount).toBe(0);
    expect(highParticles.userData.smokeParticleCount).toBeGreaterThan(0);
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

  it('shares immutable resources and animates outer embers from the renderer clock', () => {
    const first = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const second = buildIgnivarArenaAtmosphere({ lowGfx: false });
    const firstRunes = first.getObjectByName(IGNIVAR_RUNIC_INLAYS_NAME) as THREE.InstancedMesh;
    const secondRunes = second.getObjectByName(IGNIVAR_RUNIC_INLAYS_NAME) as THREE.InstancedMesh;
    const particles = first.getObjectByName(IGNIVAR_AMBIENT_PARTICLES_NAME) as THREE.Points;
    const material = particles.material as THREE.ShaderMaterial;

    expect(firstRunes.geometry).toBe(secondRunes.geometry);
    expect(firstRunes.material).toBe(secondRunes.material);
    expect(material.uniforms.uTime).toBe(sharedUniforms.uTime);
    expect(material.vertexShader).toContain('uTime');
    expect(material.fragmentShader).toContain('uIntensity');
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.userData.maxOpacity).toBeLessThanOrEqual(0.48);
  });

  it('exports the immutable Ignivar lighting grade as pinned literals', () => {
    expect(IGNIVAR_ARENA_LIGHTING).toEqual({
      fogColor: 0x391408,
      fogNear: 34,
      fogFar: 112,
      sunColor: 0xff9d48,
      sunIntensity: 1.27,
      hemiSkyColor: 0x93422a,
      hemiGroundColor: 0x280d06,
      hemiIntensity: 0.56,
      envIntensity: 0.13,
      rimIntensity: 1.05,
      rimColor: 0xffa45c,
      forgeLightColor: 0xff6a24,
      emberLightColor: 0xffb15a,
    });
    expect(Object.isFrozen(IGNIVAR_ARENA_LIGHTING)).toBe(true);
    expect(IGNIVAR_ARENA_LIGHTING.fogNear).toBeLessThan(IGNIVAR_ARENA_LIGHTING.fogFar);
    // The sunset forge stays a readable interior, never full daylight, and the
    // env ceiling is the anti-sheen bound: the shared environment map is the
    // daylight sky, and anything from 0.2 up frosted the rigs blue-white.
    // Ceilings sit just over the 30% room-light lift (1.27 / 0.56 / 0.13),
    // with env deliberately capped well under that frost band.
    expect(IGNIVAR_ARENA_LIGHTING.sunIntensity).toBeLessThanOrEqual(1.3);
    expect(IGNIVAR_ARENA_LIGHTING.hemiIntensity).toBeLessThanOrEqual(0.6);
    expect(IGNIVAR_ARENA_LIGHTING.envIntensity).toBeLessThanOrEqual(0.15);
    expect(IGNIVAR_ARENA_LIGHTING.rimIntensity).toBeLessThanOrEqual(1.3);
  });

  it('is attached only through the Ignivar dungeon interior branch', () => {
    const source = readFileSync(new URL('../src/render/dungeon.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './ignivar_arena_atmosphere'");
    expect(source).toMatch(
      /if \(interior === 'ignivar'\) \{[\s\S]{0,240}?group\.add\(buildIgnivarArenaAtmosphere\(\{ lowGfx: this\.lowGfx \}\)\);\s+\}/,
    );
    expect(source.match(/buildIgnivarArenaAtmosphere\(/g)).toHaveLength(1);
  });

  it('drives the renderer fog and lighting from the same immutable arena grade', () => {
    const fog = new THREE.Fog(0, 0, 1);
    const sun = new THREE.DirectionalLight(0, 0);
    const hemi = new THREE.HemisphereLight(0, 0, 0);
    const scene = new THREE.Scene();
    const rim = { value: 0 };
    const rimColor = { value: new THREE.Color(0) };
    applyIgnivarArenaFog(fog);
    applyIgnivarArenaLighting({ sun, hemi, scene, rim, rimColor });
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
      rimColor: rimColor.value.getHex(),
    }).toEqual({
      sunColor: IGNIVAR_ARENA_LIGHTING.sunColor,
      sunIntensity: IGNIVAR_ARENA_LIGHTING.sunIntensity,
      hemiSkyColor: IGNIVAR_ARENA_LIGHTING.hemiSkyColor,
      hemiGroundColor: IGNIVAR_ARENA_LIGHTING.hemiGroundColor,
      hemiIntensity: IGNIVAR_ARENA_LIGHTING.hemiIntensity,
      envIntensity: IGNIVAR_ARENA_LIGHTING.envIntensity,
      rimIntensity: IGNIVAR_ARENA_LIGHTING.rimIntensity,
      rimColor: IGNIVAR_ARENA_LIGHTING.rimColor,
    });

    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const fogScene = readFileSync(
      new URL('../src/render/fog_scene_state.ts', import.meta.url),
      'utf8',
    );

    // The fog resolution and presets moved to fog_scene_state.ts; the renderer
    // stays the thin caller that owns the settle edge.
    expect(source).toContain(
      'const fogScene = resolveFogScene(inside, px, camY, this.camera.position, this.sim.cfg.seed);',
    );
    expect(source).toContain('applyFogScenePreset(desired, fog, () => this.outdoorFogPreset());');
    expect(fogScene).toContain('ignivarRaidFogStateForInterior(interior ?? null)');
    expect(fogScene).toMatch(
      /desired === 'ignivarApproach' \|\| desired === 'ignivar' \|\| desired === 'varkhul'[\s\S]{0,320}?applyIgnivarRaidFog\(desired, fog\);/,
    );
    // ...and the preset applier really lands the arena grade on a settled fog.
    const presetFog = new THREE.Fog(0, 0, 1);
    applyFogScenePreset('ignivar', presetFog, () => ({ color: 0, near: 0, far: 1 }));
    expect({ color: presetFog.color.getHex(), near: presetFog.near, far: presetFog.far }).toEqual({
      color: IGNIVAR_ARENA_LIGHTING.fogColor,
      near: IGNIVAR_ARENA_LIGHTING.fogNear,
      far: IGNIVAR_ARENA_LIGHTING.fogFar,
    });

    const routedSun = new THREE.DirectionalLight(0, 0);
    const routedHemi = new THREE.HemisphereLight(0, 0, 0);
    const routedScene = new THREE.Scene();
    const routedRim = { value: 0 };
    const routedRimColor = { value: new THREE.Color(0) };
    applyInteriorLightRig(
      'ignivar',
      {
        sun: routedSun,
        hemi: routedHemi,
        scene: routedScene,
        rim: routedRim,
        rimColor: routedRimColor,
      },
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
      rimColor: routedRimColor.value.getHex(),
    }).toEqual({
      sunColor: IGNIVAR_ARENA_LIGHTING.sunColor,
      sunIntensity: IGNIVAR_ARENA_LIGHTING.sunIntensity,
      hemiSkyColor: IGNIVAR_ARENA_LIGHTING.hemiSkyColor,
      hemiGroundColor: IGNIVAR_ARENA_LIGHTING.hemiGroundColor,
      hemiIntensity: IGNIVAR_ARENA_LIGHTING.hemiIntensity,
      envIntensity: IGNIVAR_ARENA_LIGHTING.envIntensity,
      rimIntensity: IGNIVAR_ARENA_LIGHTING.rimIntensity,
      rimColor: IGNIVAR_ARENA_LIGHTING.rimColor,
    });
  });
});
