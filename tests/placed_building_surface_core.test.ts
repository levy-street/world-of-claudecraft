// Surface tuning of the painted Tidehold buildings every built-in town stands
// (src/render/placed_building_surface_core.ts, applied by
// src/render/eastbrook_placed_building.ts placedBuildingMaterial). Pinned here:
//  - the role read off the painted pipeline's material names;
//  - the relief lift per role, applied to BOTH normalScale components so the
//    loader's derivative-tangent sign flip survives, once only, and only to a
//    material that carries a normal map;
//  - the seeded per-building colour variation: deterministic, bounded, walls
//    and roof only, different between two buildings off one model;
//  - that both are uniform VALUES: the source is never written, the camera
//    fade's twin (a hook-preserving clone) copies them and keys the same
//    program, and the Lambert tiers keep the tint.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { placedBuildingMaterial } from '../src/render/eastbrook_placed_building';
import { gfxInternalsForTest } from '../src/render/gfx';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import {
  PLACED_BUILDING_RELIEF_SCALE,
  PLACED_BUILDING_TINT,
  placedBuildingReliefScale,
  placedBuildingSurfaceRole,
  placedBuildingTint,
} from '../src/render/placed_building_surface_core';

let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
});

/** A painted wall material as GLTFLoader hands it over: a normal map on a mesh
 *  without tangents, so normalScale is (1, -1). */
function paintedMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
  });
  material.normalScale.set(1, -1);
  material.name = name;
  return material;
}

describe('placed building surface core', () => {
  it('reads the role off the painted pipeline names', () => {
    expect(placedBuildingSurfaceRole('painted_walls@bank')).toBe('walls');
    expect(placedBuildingSurfaceRole('painted_roof@hall')).toBe('roof');
    expect(placedBuildingSurfaceRole('painted_props@tavern')).toBe('props');
    expect(placedBuildingSurfaceRole('painted_props_gold@bank')).toBe('props');
    expect(placedBuildingSurfaceRole('painted_props_metal@smithy')).toBe('props');
    expect(placedBuildingSurfaceRole('painted_interior@shop_a')).toBe('interior');
    for (const name of ['town_gold', 'town_atlas', 'town_glow', 'Leaves_dg_bloom', 'walls', '']) {
      expect(placedBuildingSurfaceRole(name), name).toBe('other');
    }
  });

  it('lifts the faint baked relief most on walls and leaves kit maps alone', () => {
    expect(PLACED_BUILDING_RELIEF_SCALE).toEqual({
      walls: 1.8,
      roof: 1.4,
      props: 1.35,
      interior: 1.3,
      other: 1,
    });
    expect(placedBuildingReliefScale('painted_walls@bank')).toBe(1.8);
    expect(placedBuildingReliefScale('town_gold')).toBe(1);
  });

  it('varies walls and roof per building, deterministically, inside the spread', () => {
    const walls = placedBuildingTint('eastbrook', 'eastbrook_bank', 'walls');
    expect(walls).toEqual(placedBuildingTint('eastbrook', 'eastbrook_bank', 'walls'));
    expect(walls).not.toEqual(placedBuildingTint('eastbrook', 'eastbrook_smithy', 'walls'));
    expect(walls).not.toEqual(placedBuildingTint('fenbridge', 'eastbrook_bank', 'walls'));
    expect(walls).not.toEqual(placedBuildingTint('eastbrook', 'eastbrook_bank', 'roof'));
    for (const role of ['props', 'interior', 'other'] as const) {
      expect(placedBuildingTint('eastbrook', 'eastbrook_bank', role), role).toBeNull();
    }
    for (let index = 0; index < 200; index++) {
      for (const role of ['walls', 'roof'] as const) {
        const tint = placedBuildingTint('town', `building_${index}`, role);
        if (!tint) throw new Error('walls and roof always tint');
        const spread = PLACED_BUILDING_TINT[role];
        const value = tint[1];
        expect(value).toBeGreaterThanOrEqual(spread.valueLow);
        expect(value).toBeLessThanOrEqual(spread.valueHigh);
        expect(Math.abs(tint[0] / value - 1)).toBeLessThanOrEqual(spread.warmth + 1e-12);
        expect(tint[2] / value - 1).toBeCloseTo(-(tint[0] / value - 1), 12);
      }
    }
  });
});

describe('placedBuildingMaterial surface touches', () => {
  it('lifts both normalScale components once, keeping the tangent sign', () => {
    setStandardMaterials(true);
    const source = paintedMaterial('painted_walls@bank');
    const clone = placedBuildingMaterial(source, {
      town: 'eastbrook',
      buildingId: 'eastbrook_bank',
    }) as THREE.MeshStandardMaterial;
    expect(clone.normalScale.toArray()).toEqual([1.8, -1.8]);
    // the shared loader material is never written
    expect(source.normalScale.toArray()).toEqual([1, -1]);
    // a second pass over the result (a clone of a clone) never stacks
    const again = placedBuildingMaterial(clone) as THREE.MeshStandardMaterial;
    expect(again.normalScale.toArray()).toEqual([1.8, -1.8]);
    // a role with no lift and a material with no normal map stay as authored
    const gold = paintedMaterial('town_gold');
    gold.normalScale.set(0.5, -0.5);
    expect(
      (placedBuildingMaterial(gold) as THREE.MeshStandardMaterial).normalScale.toArray(),
    ).toEqual([0.5, -0.5]);
    const plain = new THREE.MeshStandardMaterial();
    plain.name = 'painted_walls@bank';
    expect(
      (placedBuildingMaterial(plain) as THREE.MeshStandardMaterial).normalScale.toArray(),
    ).toEqual([1, 1]);
  });

  it('tints walls per building as a value the fade twin copies, on its own program', () => {
    setStandardMaterials(true);
    const source = paintedMaterial('painted_walls@bank');
    const look = { town: 'eastbrook' as const, buildingId: 'eastbrook_bank' };
    const clone = placedBuildingMaterial(source, look) as THREE.MeshStandardMaterial;
    const tint = placedBuildingTint('eastbrook', 'eastbrook_bank', 'walls');
    if (!tint) throw new Error('walls tint');
    expect(clone.color.r).toBeCloseTo(tint[0], 6);
    expect(clone.color.g).toBeCloseTo(tint[1], 6);
    expect(clone.color.b).toBeCloseTo(tint[2], 6);
    expect(source.color.getHex()).toBe(0xffffff);
    // the camera fade's gate twin is a hook-preserving clone of the live
    // material: it carries the lift and the tint and keys the same program
    const twin = cloneMaterialWithHooks(clone);
    expect(twin.normalScale.toArray()).toEqual(clone.normalScale.toArray());
    expect(twin.color.getHex()).toBe(clone.color.getHex());
    expect(twin.customProgramCacheKey()).toBe(clone.customProgramCacheKey());
    // and the untinted, unlifted clone keys the same program too: values only
    expect(cloneMaterialWithHooks(source).customProgramCacheKey()).toBe(
      clone.customProgramCacheKey(),
    );
    // props keep their authored colour
    const props = placedBuildingMaterial(paintedMaterial('painted_props@bank'), look);
    expect((props as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
  });

  it('keeps the tint on the Lambert tiers, which carry no normal map', () => {
    setStandardMaterials(false);
    const look = { town: 'eastbrook' as const, buildingId: 'eastbrook_inn' };
    const low = placedBuildingMaterial(paintedMaterial('painted_roof@tavern'), look);
    expect(low).toBeInstanceOf(THREE.MeshLambertMaterial);
    const tint = placedBuildingTint('eastbrook', 'eastbrook_inn', 'roof');
    if (!tint) throw new Error('roof tint');
    expect((low as THREE.MeshLambertMaterial).color.g).toBeCloseTo(tint[1], 6);
  });
});
