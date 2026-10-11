import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyPointLightBudget, type RankedPointLight } from '../src/render/point_light_budget';

// A placed GLB may carry glTF punctual lights. They join the world's budget
// through the registration seam, as static lights at their authored level,
// and leave it with their placement.
const template = new THREE.Group();
const lamp = new THREE.PointLight(0xffcc88, 4, 10, 2);
lamp.name = 'glb-lamp';
template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), lamp);

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => ({ scene: template }),
}));
vi.mock('../src/render/assets/preload', () => ({ registerPreload: () => {} }));

const { PlacedAssetsView } = await import('../src/render/placed_assets');

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('point lights in placed GLBs', () => {
  it('register every clone light with the budget and release it with its placement', async () => {
    const registered: THREE.PointLight[] = [];
    const released: THREE.PointLight[] = [];
    const view = new PlacedAssetsView([], 7, {
      register: (light) => registered.push(light),
      release: (light) => released.push(light),
    });
    view.addPlacement(0, { path: '/models/lamp.glb', x: 0, z: 0, rotY: 0, scale: 1 });
    view.addPlacement(1, { path: '/models/lamp.glb', x: 4, z: 0, rotY: 0, scale: 1 });
    await settle();

    expect(registered).toHaveLength(2);
    expect(registered.every((light) => light.name === 'glb-lamp')).toBe(true);
    expect(registered).not.toContain(lamp);
    expect(registered.map((light) => light.userData.budgetBase)).toEqual([4, 4]);

    view.removePlacement(0);
    expect(released).toEqual([registered[0]]);
    view.removePlacement(0);
    expect(released).toEqual([registered[0]]);
  });

  it('shine at their authored level when ranked, like a static view light', () => {
    const scene = new THREE.Scene();
    const light = new THREE.PointLight(0xffcc88, 4, 10, 2);
    light.userData.budgetBase = 4;
    scene.add(light);
    const entry: RankedPointLight = {
      light,
      d2: 0,
      worldPos: new THREE.Vector3(1, 0, 0),
      base: light.userData.budgetBase,
      dynamic: false,
    };
    applyPointLightBudget([entry], 500, 0, 6, 6, 100 * 100, scene);
    expect(light.intensity).toBe(0);
    applyPointLightBudget([entry], 0, 0, 6, 6, 100 * 100, scene);
    expect(light.intensity).toBe(4);
  });
});
