import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxLayerOf, floorVfxLayerTopOrder } from '../src/render/floor_vfx_layer_core';
import { ScarecrowFx } from '../src/render/scarecrow_fx';
import { CHAFF_ABILITY } from '../src/render/scarecrow_fx_core';
import { SeasonalToysFx } from '../src/render/seasonal_toys_fx';
import { GOURDLIGHT_TOY_FX_PREFIX } from '../src/sim/content/gourdlight_eve';

const particles = {
  burst: () => {},
  burstLater: () => {},
  groundPuff: () => {},
  fireworkBurst: () => {},
  campfireEmber: () => {},
  fluidSmoke: () => {},
  toyMote: () => {},
};

function expectNeutralAncestors(mesh: THREE.Object3D): void {
  for (let parent = mesh.parent; parent; parent = parent.parent)
    expect(parent.renderOrder, parent.name).toBe(0);
}

describe('Halloween floor painters', () => {
  it('draws both actual Chaff patch meshes above player floor effects', () => {
    const scene = new THREE.Scene();
    const fx = new ScarecrowFx(
      scene,
      particles,
      () => 0,
      () => new Map(),
      () => undefined,
    );
    try {
      expect(
        fx.handleSpellfxAt({
          ability: CHAFF_ABILITY,
          fx: 'ground',
          x: 5,
          z: 7,
          radius: 3,
          duration: 6,
        }),
      ).toBe(true);
      const patches: THREE.Mesh[] = [];
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          object.geometry instanceof THREE.CircleGeometry &&
          object.geometry.parameters.radius === 3
        )
          patches.push(object);
      });
      expect(patches).toHaveLength(2);
      patches.sort((a, b) => a.position.y - b.position.y);
      for (const mesh of patches) {
        expect(floorVfxLayerOf(mesh.renderOrder)).toBe('encounter');
        expect(mesh.renderOrder).toBeGreaterThan(floorVfxLayerTopOrder('player'));
        expectNeutralAncestors(mesh);
      }
      expect(patches[1].renderOrder).toBeGreaterThan(patches[0].renderOrder);
    } finally {
      fx.dispose();
    }
  });

  it('keeps toy floor decoration below player effects, with shadows above their light', () => {
    const scene = new THREE.Scene();
    const fx = new SeasonalToysFx(
      scene,
      particles,
      () => 0,
      () => undefined,
    );
    try {
      fx.handleCue({ ability: `${GOURDLIGHT_TOY_FX_PREFIX}candle`, fx: 'ground', x: 0, z: 0 });
      const names = ['seasonal-toys-mists', 'seasonal-toys-light-pools'];
      const shadows: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (object.name.startsWith('seasonal-toys-shadow-')) shadows.push(object);
      });
      expect(shadows.length).toBeGreaterThan(0);
      const light = scene.getObjectByName('seasonal-toys-light-pools');
      expect(light).toBeDefined();
      for (const mesh of [...names.map((name) => scene.getObjectByName(name)), ...shadows]) {
        expect(mesh).toBeDefined();
        if (!mesh) throw new Error('missing toy floor mesh');
        expect(floorVfxLayerOf(mesh.renderOrder)).toBe('ground');
        expectNeutralAncestors(mesh);
      }
      for (const shadow of shadows)
        expect(shadow.renderOrder).toBeGreaterThan(light?.renderOrder ?? Infinity);
    } finally {
      fx.dispose();
    }
  });
});
