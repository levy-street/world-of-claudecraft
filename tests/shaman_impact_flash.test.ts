import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { asFlipbookStyle, ImpactFlipbooks } from '../src/render/ability_vfx/flipbooks';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { flipbookSheet } from '../src/render/ability_vfx/fx_textures';
import { shamanImpactStyle } from '../src/render/ability_vfx/shaman_impact_flash';

vi.mock('../src/render/ability_vfx/fx_textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/ability_vfx/fx_textures')>();
  const { Texture } = await import('three');
  return {
    ...actual,
    abilityVfxTextures: () => ({ noise: new Texture() }),
    FLIPBOOK_GRID: 8,
    FLIPBOOK_STYLES: ['electric'],
    flipbookSheet: vi.fn(() => new Texture()),
  };
});
vi.mock('../src/render/ability_vfx/contact_assets', async () => {
  const { Texture } = await import('three');
  const prepared = new Texture();
  return { contactTexture: () => prepared, isContactSheet: () => false };
});

describe('analytic Shaman impact resource ownership', () => {
  it('routes every elemental and earth variant without constructing obsolete raster atlases', () => {
    const scene = new THREE.Scene();
    const fx = new ImpactFlipbooks(scene);
    const styles = [
      'shaman_storm',
      'shaman_skybranch',
      'shaman_ward_charge',
      'shaman_chorus_crest',
      'shaman_storm_echo',
      'shaman_storm_cleave',
      'shaman_dust',
      'shaman_earth_cleave',
      'shaman_earth_ram',
      'shaman_earth_fault',
      'shaman_ember',
      'shaman_fire_forge',
      'shaman_fire_cleave',
      'shaman_fire_detonation',
      'shaman_fire_ascension',
      'shaman_rime',
      'shaman_gale',
    ];
    for (const style of styles) {
      expect(asFlipbookStyle(style)).toBe(style);
      fx.spawn(2, 3, 4, 5, 0xffffff, 2, asFlipbookStyle(style));
    }
    expect(flipbookSheet).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(6);
    fx.update(0.1, new THREE.Quaternion(), undefined, undefined, true);
    for (const child of scene.children as THREE.Mesh[]) {
      const uniforms = (child.material as THREE.ShaderMaterial).uniforms;
      expect(uniforms.uShamanStyle.value).toBeGreaterThan(0);
      expect(uniforms.uShamanPhase.value).toBe(0.32);
      expect(child.position.toArray()).toEqual([2, 3, 4]);
    }
    fx.update(1, new THREE.Quaternion());
    expect(scene.children.every((child) => !child.visible)).toBe(true);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('does not claim other classes or unknown style names', () => {
    for (const style of ['warrior_steel_flash', 'electric', 'shaman_unknown', '']) {
      expect(shamanImpactStyle(style)).toBe(0);
    }
    expect(asFlipbookStyle('shaman_unknown')).toBe('electric');
  });

  it('fades fire RGB above the sampled floor while retaining the airborne center', () => {
    const scene = new THREE.Scene();
    const fx = new ImpactFlipbooks(scene);
    fx.spawn(2, 12, 4, 8, 0xffffff, 2, 'shaman_ember', 0.6, 0, 1, 10);
    const material = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const floor = material.uniforms.uWarriorFloor.value;
    const blend = material.uniforms.uWarriorFloorBlend.value;
    expect(floor).toBe(10);
    expect(blend).toBeCloseTo(0.65);
    expect(THREE.MathUtils.smoothstep(10, floor + 0.03, floor + blend)).toBe(0);
    expect(THREE.MathUtils.smoothstep(10.34, floor + 0.03, floor + blend)).toBeCloseTo(0.5);
    expect(THREE.MathUtils.smoothstep(12, floor + 0.03, floor + blend)).toBe(1);
    expect(material.fragmentShader).toMatch(
      /else if \(uShamanStyle > \.5\) \{\s*gl_FragColor = shamanImpact[^;]+;\s*if \(uShamanStyle > 2\.5 && uShamanStyle < 3\.5\) \{\s*float floorFade = smoothstep\(uWarriorFloor \+ \.03, uWarriorFloor \+ uWarriorFloorBlend, vWorldY\);\s*gl_FragColor\.rgb \*= floorFade;/,
    );
    fx.dispose();
  });

  it('resets floor fade on every reused slot, including fire without a valid floor', () => {
    const scene = new THREE.Scene();
    const fx = new ImpactFlipbooks(scene);
    for (let i = 0; i < 6; i++) {
      fx.spawn(0, 12, 0, 8, 0xffffff, 2, 'shaman_fire_forge', 0.6, 0, 1, 10);
    }
    const materials = scene.children.map((child) => (child as THREE.Mesh).material);
    for (const child of scene.children as THREE.Mesh[]) {
      expect((child.material as THREE.ShaderMaterial).uniforms.uWarriorFloor.value).toBe(10);
    }
    const replacements = [
      'shaman_dust',
      'shaman_storm',
      'shaman_rime',
      'shaman_gale',
      'electric',
      'shaman_ember',
    ];
    replacements.forEach((style, index) => {
      fx.spawn(
        0,
        12,
        0,
        8,
        0xffffff,
        2,
        asFlipbookStyle(style),
        0.6,
        0,
        1,
        index === 5 ? Number.NaN : 10,
      );
      const material = (scene.children[index] as THREE.Mesh).material as THREE.ShaderMaterial;
      expect(material).toBe(materials[index]);
      expect(material.uniforms.uWarriorFloor.value).toBe(-1e6);
      expect(material.uniforms.uWarriorFloorBlend.value).toBe(0.85);
    });
    expect(scene.children).toHaveLength(6);
    fx.dispose();
  });

  it('samples terrain only for Shaman fire and the existing Warrior floor-aware sheets', () => {
    const spawn = vi.fn();
    const groundY = vi.fn(() => 7);
    const fx = Object.assign(Object.create(AbilityVfxFx.prototype), {
      disposed: false,
      flipbooks: { spawn },
      intensity: () => 1,
      groundY,
    }) as AbilityVfxFx;
    for (const style of [
      'shaman_ember',
      'shaman_fire_forge',
      'shaman_fire_cleave',
      'shaman_fire_detonation',
      'shaman_fire_ascension',
      'warrior_steel_flash',
    ]) {
      fx.flipbookAt(2, 9, 4, 8, 0xffffff, style, 2);
      expect(groundY).toHaveBeenLastCalledWith(2, 4);
      expect(spawn.mock.lastCall?.[10]).toBe(7);
    }
    expect(groundY).toHaveBeenCalledTimes(6);
    groundY.mockClear();
    for (const style of [
      'shaman_dust',
      'shaman_storm',
      'shaman_rime',
      'shaman_gale',
      'electric',
      'fire',
      'shaman_unknown',
    ]) {
      fx.flipbookAt(2, 9, 4, 8, 0xffffff, style, 2);
      expect(spawn.mock.lastCall?.[10]).toBeUndefined();
    }
    expect(groundY).not.toHaveBeenCalled();
  });
});
