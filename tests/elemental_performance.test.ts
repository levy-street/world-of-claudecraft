import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ElementalForms } from '../src/render/ability_vfx/elemental_forms';
import {
  ElementalContactMemory,
  elementalPerformance,
  reactionBetween,
} from '../src/render/ability_vfx/elemental_performance_core';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import {
  CharacterSurfaceResponse,
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../src/render/characters/surface_response';

describe('elemental contact performances', () => {
  it('preserves distinct hero forms and drops secondary geometry before primary cues', () => {
    const expected = {
      pyroblast: 'pyre',
      frost_nova: 'glacier',
      chain_lightning: 'thunder',
      chain_heal: 'tide',
      abyssal_rift: 'rift',
      hammer_of_wrath: 'judgement',
      execute: 'fault',
    };
    for (const [id, form] of Object.entries(expected)) {
      const spec = abilityVfxFullSpec(id)!;
      expect(elementalPerformance(id, spec, 0)).toMatchObject({
        form,
        enabled: true,
        detail: true,
      });
      expect(elementalPerformance(id, spec, 1)).toMatchObject({ enabled: true, detail: false });
      expect(elementalPerformance(id, spec, 2).enabled).toBe(false);
    }
    expect(
      elementalPerformance('tick', { ...abilityVfxFullSpec('pyroblast')!, filler: true }, 0)
        .enabled,
    ).toBe(false);
  });
  it('consumes nearby compatible contacts once, expires them and resets cleanly', () => {
    const memory = new ElementalContactMemory();
    expect(memory.touch(0, 0, 'ice')).toBeNull();
    expect(memory.touch(10, 0, 'fire')).toBeNull();
    expect(memory.touch(1, 0, 'fire')).toBe('steam');
    expect(memory.touch(1, 0, 'fire')).toBeNull();
    memory.advance(4);
    expect(memory.touch(1, 0, 'ice')).toBeNull();
    memory.clear();
    expect(memory.touch(1, 0, 'water')).toBeNull();
    expect(memory.touch(1, 0, 'storm')).toBe('conduction');
    expect(memory.touch(NaN, 0, 'storm')).toBeNull();
    expect(reactionBetween('ice', 'shadow')).toBeNull();
    expect(reactionBetween('shadow', 'shadow')).toBe('confluence');
  });
  it('keeps GPU pools fixed through saturation, expiry, clear and disposal', () => {
    const scene = new THREE.Scene(),
      forms = new ElementalForms(scene);
    for (let i = 0; i < 12; i++)
      expect(forms.spawn('glacier', i, 0, 0, 1, 1, 0x77ccff, 0xffffff, 0, true)).toBe(true);
    expect(forms.spawn('pyre', 0, 0, 0, 1, 1, 0xffffff, 0xffffff, 0, true)).toBe(false);
    forms.update(0.25, false);
    expect(scene.children.filter((m) => m.visible)).toHaveLength(12);
    for (const mesh of scene.children as THREE.Mesh[]) {
      expect(mesh.geometry.attributes.aCenter.count).toBe(mesh.geometry.attributes.position.count);
      expect(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
    }
    forms.update(1, false);
    expect(scene.children.some((m) => m.visible)).toBe(false);
    expect(forms.spawn('tide', 0, 0, 0, 1, 1, 0xffffff, 0xffffff, 0, false)).toBe(true);
    forms.clear();
    forms.update(0, false);
    expect(scene.children.some((m) => m.visible)).toBe(false);
    forms.dispose();
    expect(scene.children).toHaveLength(0);
    expect(forms.spawn('pyre', 0, 0, 0, 1, 1, 0xffffff, 0xffffff, 0, true)).toBe(false);
  });
});

describe('material surface response lifecycle', () => {
  it('shares original textures but isolates response uniforms and material state', () => {
    const texture = new THREE.Texture(),
      source = new THREE.MeshStandardMaterial({ map: texture, color: 0x765432 });
    const a = new CharacterSurfaceResponse(),
      b = new CharacterSurfaceResponse();
    const material = a.material(source) as THREE.MeshStandardMaterial;
    expect(material).not.toBe(source);
    expect(material.map).toBe(texture);
    expect(a.material(source)).toBe(material);
    a.trigger('frost', 0.8);
    a.update(0.3, new THREE.Group(), 2);
    expect(a.uniforms.uSurfaceAmount.value).toBe(0.8);
    expect(b.uniforms.uSurfaceAmount.value).toBe(0);
    expect(a.update(3, new THREE.Group(), 2)).toBe(true);
    expect(a.active).toBe(false);
    expect(source.color.getHex()).toBe(0x765432);
    expect(source.transparent).toBe(false);
    for (const m of a.materials.values()) m.dispose();
    texture.dispose();
    source.dispose();
  });
  it('chains source shader hooks and keeps one program across all treatment values', () => {
    const source = new THREE.MeshStandardMaterial(),
      uniforms = surfaceResponseUniforms();
    const material = createSurfaceResponseMaterial(source, uniforms),
      key = material.customProgramCacheKey();
    uniforms.uSurfaceKind.value = 4;
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader:
        '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>',
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vSurfacePoint=');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance+=surfaceEmission');
    expect(shader.uniforms).toHaveProperty('uSurfaceAge', uniforms.uSurfaceAge);
    material.dispose();
    source.dispose();
  });
});
