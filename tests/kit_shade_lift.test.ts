// The painted kit's shaded-stone lift (src/render/assets/kit_shade_lift.ts): it must touch
// only the stone of painted-kit BUILDINGS, scale the indirect light alone and only where
// direct light is missing, chain an existing hook, key its program, stay merge-eligible,
// and survive the program-preserving clone with the source's exact cache key.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyKitShadeLift,
  applyKitShadeLiftToScene,
  KIT_SHADE_LIFT_GLSL,
  KIT_SHADE_LIFTS,
  patchKitShadeLiftFragment,
  reapplyKitShadeLiftToClone,
} from '../src/render/assets/kit_shade_lift';
import { isPaintedKitBuildingUrl } from '../src/render/assets/shared_kit_textures';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';

const LOT = '/models/tidehold/harbour_moss/tavern.glb';

function sceneOf(...names: string[]): { root: THREE.Group; mats: THREE.MeshStandardMaterial[] } {
  const root = new THREE.Group();
  const mats = names.map((name) => {
    const mat = new THREE.MeshStandardMaterial();
    mat.name = name;
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
    return mat;
  });
  return { root, mats };
}

function compile(mat: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  mat.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

describe('kit shade lift: which models and surfaces take it', () => {
  it('names the painted kit buildings, in every colour set and texture tier', () => {
    for (const url of [
      '/models/tidehold/harbour/hall.glb',
      '/models/tidehold/harbour_alpine/guild.glb',
      '/models/tidehold/harbour_brick/smithy.half.glb',
      '/models/tidehold/harbour_thatch/house_b.quarter.glb',
      '/models/eastbrook_houses/vault_house.glb',
      '/models/eastbrook_houses/croft.0a1b2c3d.glb?v=2',
      // the one-prop buildings: a guardhouse, a croft, a stable, a windmill, a keep
      '/models/biome/hex_barracks.glb',
      '/models/biome/hexr_home_a.glb',
      '/models/biome/hexb_stables.0a1b2c3d.glb',
      '/models/biome/hexb_windmill.glb',
      '/models/biome/hex_castle.glb',
    ]) {
      expect(isPaintedKitBuildingUrl(url), url).toBe(true);
    }
    for (const url of [
      '/models/props/kcas_well.glb',
      '/models/biome/guardhouse.glb',
      // the castle kit also builds the palaces' rooms: never lifted by name
      '/models/biome/kcas_wall.glb',
      '/models/biome/kcas_hall_floor.glb',
      '/models/props/house_1.glb',
      '/models/tidehold/tavern.glb',
      '/models/drakelands_kit/forge.glb',
      '/models/dungeon/wall.glb',
    ]) {
      expect(isPaintedKitBuildingUrl(url), url).toBe(false);
    }
  });

  it('lifts the stone of a building and nothing else in it', () => {
    const { root, mats } = sceneOf('eh_stone', 'eh_timber', 'eh_slate', 'eh_parts');
    expect(applyKitShadeLiftToScene(root, LOT)).toBe(1);
    expect(mats[0].userData.kitShadeLift).toEqual([...KIT_SHADE_LIFTS.eh_stone]);
    expect(mats[0].customProgramCacheKey()).toBe('|kitShadeLift:1.45,1.3,1.08');
    for (const other of mats.slice(1)) {
      expect(other.userData.kitShadeLift).toBeUndefined();
      expect(other.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    }
  });

  it('leaves the same stone alone on a prop, a palace module or any other model', () => {
    for (const url of [
      '/models/props/kcas_well.glb',
      '/models/biome/kcas_wall.glb',
      '/models/dungeon/palace_wall.glb',
    ]) {
      const { root, mats } = sceneOf('eh_stone');
      expect(applyKitShadeLiftToScene(root, url)).toBe(0);
      expect(mats[0].userData.kitShadeLift).toBeUndefined();
      expect(mats[0].onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    }
    // a loader stub in a test hands over a scene with no graph
    expect(applyKitShadeLiftToScene({} as THREE.Object3D, LOT)).toBe(0);
  });

  it('patches only a lit material that carries a well-formed lift', () => {
    const none = new THREE.MeshStandardMaterial();
    expect(applyKitShadeLift(none)).toBe(false);
    const malformed = new THREE.MeshStandardMaterial();
    malformed.userData.kitShadeLift = [1.9, 'x', 1];
    expect(applyKitShadeLift(malformed)).toBe(false);
    const unlit = new THREE.MeshBasicMaterial();
    unlit.userData.kitShadeLift = [1.9, 1.6, 1.15];
    expect(applyKitShadeLift(unlit)).toBe(false);
  });
});

describe('kit shade lift: the shader patch', () => {
  it('scales the indirect diffuse term after every light is in, and declares its uniform', () => {
    const src = THREE.ShaderLib.physical.fragmentShader;
    const out = patchKitShadeLiftFragment(src);
    expect(out).not.toBe(src);
    expect(out).toContain('uniform vec3 kitShadeLift;');
    const end = out.indexOf('#include <lights_fragment_end>');
    const lift = out.indexOf('reflectedLight.indirectDiffuse *= mix( kitShadeLift');
    const sum = out.indexOf('reflectedLight.directDiffuse + reflectedLight.indirectDiffuse');
    expect(end).toBeGreaterThan(0);
    expect(lift).toBeGreaterThan(end);
    expect(sum).toBeGreaterThan(lift);
    // patching twice changes nothing more
    expect(patchKitShadeLiftFragment(out)).toBe(out);
  });

  it('leaves a shader with no light accumulation untouched', () => {
    const basic = THREE.ShaderLib.basic.fragmentShader;
    expect(patchKitShadeLiftFragment(basic)).toBe(basic);
  });

  it('gives the whole lift in shade and none where direct light carries the fragment', () => {
    // the GLSL is `indirect *= mix(lift, 1, clamp(direct / fill, 0, 1))`: pin both ends
    expect(KIT_SHADE_LIFT_GLSL).toContain(
      'float kslLit = clamp( kslDirect / max( kslFill, 1e-4 ), 0.0, 1.0 );',
    );
    expect(KIT_SHADE_LIFT_GLSL).toContain('mix( kitShadeLift, vec3( 1.0 ), kslLit )');
    // it never touches the direct term or the albedo
    expect(KIT_SHADE_LIFT_GLSL).not.toMatch(/reflectedLight\.directDiffuse\s*[*+-]?=/);
    expect(KIT_SHADE_LIFT_GLSL.match(/[*+-]?=(?!=)/g)).toHaveLength(5);
    expect(KIT_SHADE_LIFT_GLSL).not.toContain('diffuseColor');
  });

  it('chains a previous hook, binds the uniform and stays merge-eligible', () => {
    const mat = new THREE.MeshStandardMaterial();
    mat.userData.kitShadeLift = [1.9, 1.6, 1.15];
    let prevRan = false;
    mat.onBeforeCompile = () => {
      prevRan = true;
    };
    const prevSource = mat.onBeforeCompile.toString();
    expect(applyKitShadeLift(mat)).toBe(true);
    expect(mat.userData.wocFrameAgnostic).toBe(true);
    expect(mat.customProgramCacheKey()).toBe(`${prevSource}|kitShadeLift:1.9,1.6,1.15`);
    const shader = compile(mat);
    expect(prevRan).toBe(true);
    expect(shader.uniforms.kitShadeLift.value).toEqual([1.9, 1.6, 1.15]);
    expect(shader.fragmentShader).toContain('kslLit');
    // idempotent: a second apply adds no second layer
    const key = mat.customProgramCacheKey();
    expect(applyKitShadeLift(mat)).toBe(true);
    expect(mat.customProgramCacheKey()).toBe(key);
  });
});

describe('kit shade lift: survival across the program-preserving clone', () => {
  it('reproduces the bare-clone program split it exists to fix', () => {
    const { root, mats } = sceneOf('eh_stone');
    applyKitShadeLiftToScene(root, LOT);
    const bare = mats[0].clone();
    expect(bare.userData.kitShadeLift).toEqual([1.45, 1.3, 1.08]);
    expect(bare.customProgramCacheKey()).not.toBe(mats[0].customProgramCacheKey());
  });

  it('restores the source program cache key and the patch itself on the clone', () => {
    const { root, mats } = sceneOf('eh_stone');
    applyKitShadeLiftToScene(root, LOT);
    const clone = cloneMaterialWithHooks(mats[0]);
    expect(clone.customProgramCacheKey()).toBe(mats[0].customProgramCacheKey());
    expect(compile(clone).fragmentShader).toContain('kslLit');
  });

  it('never grants the lift to a clone of an unlifted source', () => {
    const plain = new THREE.MeshStandardMaterial();
    plain.name = 'eh_stone';
    const clone = cloneMaterialWithHooks(plain);
    reapplyKitShadeLiftToClone(clone);
    expect(clone.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    expect(clone.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
  });
});
