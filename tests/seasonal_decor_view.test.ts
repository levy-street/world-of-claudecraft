// The seasonal city dressing's view (src/render/seasonal_decor.ts): the compile gate
// owns the root's visibility and the event toggle never reveals an unlinked kit; the
// renderer's teardown frees what the view built, once.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/seasonal_decor_assets', () => {
  const part = () => ({
    geometry: new THREE.BoxGeometry(0.5, 0.5, 0.5),
    material: new THREE.MeshLambertMaterial(),
  });
  const decor = {
    pumpkin_lit: [part()],
    pumpkin_small: [part()],
    gourd: [part()],
    lantern: [part()],
    garland_pole: [part()],
    garland_leaf: [part()],
    garland_bead: [part()],
    keeper_stall: [part(), part()],
    corn_shock: [part()],
    hay_bale: [part()],
    road_lantern: [part()],
  };
  return { gourdlightAssets: () => ({ decor, head: [] }) };
});

import { nightLightStaticCount } from '../src/render/night_light_field';
import { SeasonalDecor } from '../src/render/seasonal_decor';
import { SEASONAL_POINT_LIGHTS } from '../src/render/seasonal_decor_lights';
import { GOURDLIGHT_EVE_ID } from '../src/sim/content/gourdlight_eve';
import { seasonalRoadLanterns } from '../src/sim/seasonal_road_lanterns';
import { WORLD_SEED } from '../src/sim/world_seed';

/** Step the view until it builds: the indoor pumpkins resolve one house a frame first
 *  (seasonal_interior_pumpkins.ts interiorPumpkinJob), so one update is not enough. */
function buildView(view: SeasonalDecor, night: number, x: number, z: number): void {
  for (let i = 0; i < 200 && !view.root.parent; i++) view.update(night, i * 0.05, x, z);
}

describe('SeasonalDecor', () => {
  it('stays hidden until its programs link, however the event toggles meanwhile', async () => {
    const scene = new THREE.Scene();
    let release: () => void = () => {};
    const gate = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    let active: string | null = GOURDLIGHT_EVE_ID;
    const view = new SeasonalDecor(scene, WORLD_SEED, () => active, gate);
    buildView(view, 1, -14, -100);
    expect(view.root.parent).toBe(scene);
    expect(gate).toHaveBeenCalledTimes(1);
    // built and toggled on, but the gate has not settled: nothing draws
    view.update(1, 0.05, -14, -100);
    expect(view.root.visible).toBe(false);
    // at night but unlinked: no candle light may hold a budget slot yet
    const candles: THREE.PointLight[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.PointLight) candles.push(o);
    });
    expect(candles.length).toBeGreaterThan(0);
    for (const l of candles) {
      expect(l.intensity).toBe(0);
      expect(l.parent?.visible).toBe(false);
    }
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(view.root.visible).toBe(true);
    // the event closing hides the dressing without touching the gate's root
    active = null;
    view.update(1, 0.1, -14, -100);
    expect(view.root.visible).toBe(true);
    const content = view.root.getObjectByName('seasonal-decor-content');
    expect(content?.visible).toBe(false);
  });

  it('dispose detaches the view and frees its instance buffers once', () => {
    const scene = new THREE.Scene();
    const view = new SeasonalDecor(scene, WORLD_SEED, () => GOURDLIGHT_EVE_ID);
    buildView(view, 0, -14, -100);
    const meshes: THREE.InstancedMesh[] = [];
    view.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    const spies = meshes.map((m) => vi.spyOn(m, 'dispose'));
    view.dispose();
    view.dispose();
    expect(view.root.parent).toBeNull();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    // a disposed view never rebuilds or re-attaches
    view.update(0, 0, -14, -100);
    expect(view.root.parent).toBeNull();
  });

  it('draws the keeper stall once, on its resolved footprint', () => {
    const scene = new THREE.Scene();
    const view = new SeasonalDecor(scene, WORLD_SEED, () => GOURDLIGHT_EVE_ID);
    buildView(view, 0, -14, -100);
    const singles: THREE.InstancedMesh[] = [];
    view.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.count === 1) singles.push(o);
    });
    // the mocked stall has two parts, one instance each
    expect(singles.length).toBeGreaterThanOrEqual(2);
    view.dispose();
  });

  it('lights the candles only after dark, through budgeted lights it releases on dispose', () => {
    const scene = new THREE.Scene();
    const registered: THREE.PointLight[] = [];
    const released: THREE.PointLight[] = [];
    const registry = {
      register: (l: THREE.PointLight) => registered.push(l),
      release: (l: THREE.PointLight) => released.push(l),
    };
    let active: string | null = GOURDLIGHT_EVE_ID;
    const view = new SeasonalDecor(scene, WORLD_SEED, () => active, undefined, registry);
    // by day: halos hidden, the pool lights dark, the field sites registered
    buildView(view, 0, -4.2, -112);
    view.update(0, 0, -4.2, -112);
    expect(registered).toHaveLength(SEASONAL_POINT_LIGHTS);
    for (const l of registered) {
      // under its own holder on the scene, hidden while dark: no carrier slot held
      expect(l.parent?.parent).toBe(scene);
      expect(l.parent?.visible).toBe(false);
      // a carrier source, never a light three gathers itself
      expect(l.userData.budgetDynamic).toBe(true);
      expect(l.intensity).toBe(0);
    }
    const halos: THREE.Object3D[] = [];
    view.root.traverse((o) => {
      if (o.name === 'seasonal-halos') halos.push(o);
    });
    expect(halos.length).toBeGreaterThan(0);
    expect(halos.every((h) => !h.visible)).toBe(true);
    const fieldSites = nightLightStaticCount();
    expect(fieldSites).toBeGreaterThan(0);
    // at night by the keeper's stall: halos up, the nearest lights lit
    view.update(1, 0.5, -4.2, -112);
    expect(halos.every((h) => h.visible)).toBe(true);
    expect(registered.some((l) => l.intensity > 0)).toBe(true);
    // only a lit light's holder shows: a dark one stays out of the budget ranking
    for (const l of registered) expect(l.parent?.visible).toBe(l.intensity > 0);
    // the event closing takes every light and field site away
    active = null;
    view.update(1, 0.6, -4.2, -112);
    for (const l of registered) {
      expect(l.intensity).toBe(0);
      expect(l.parent?.visible).toBe(false);
    }
    expect(nightLightStaticCount()).toBe(0);
    view.dispose();
    expect(released).toEqual(registered);
    for (const l of registered) expect(l.parent).toBeNull();
  });

  it('draws the road lanterns only while the event runs, each run ranged like a city', () => {
    const scene = new THREE.Scene();
    let active: string | null = null;
    const view = new SeasonalDecor(scene, WORLD_SEED, () => active);
    // closed: nothing is built, nothing attached
    view.update(1, 0, 0, 100);
    expect(view.root.parent).toBeNull();
    expect(view.root.getObjectByName('seasonal-decor-road-0')).toBeUndefined();
    active = GOURDLIGHT_EVE_ID;
    buildView(view, 1, 0, 100);
    const lanterns = seasonalRoadLanterns(WORLD_SEED);
    const runs: THREE.Object3D[] = [];
    view.root.traverse((o) => {
      if (o.name.startsWith('seasonal-decor-road-')) runs.push(o);
    });
    expect(runs.length).toBeGreaterThan(0);
    // every post is drawn once: the runs' instance counts add up to the resolved list
    let drawn = 0;
    for (const run of runs) {
      for (const child of run.children) {
        if (child instanceof THREE.InstancedMesh && child.name !== 'seasonal-halos')
          drawn += child.count;
      }
    }
    expect(drawn).toBe(lanterns.length);
    // standing on the Eastbrook to Fenbridge road, the run beside you shows and a run
    // on the far side of Fenbridge does not
    view.update(1, 1, lanterns[2].x, lanterns[2].z);
    const near = runs.find((r) => r.visible);
    expect(near).toBeDefined();
    const here = lanterns[2];
    const far = lanterns.reduce((a, b) =>
      Math.hypot(b.x - here.x, b.z - here.z) > Math.hypot(a.x - here.x, a.z - here.z) ? b : a,
    );
    expect(Math.hypot(far.x - lanterns[2].x, far.z - lanterns[2].z)).toBeGreaterThan(300);
    expect(runs.some((r) => !r.visible)).toBe(true);
    // the event closing hides every run with the rest of the dressing
    active = null;
    view.update(1, 2, lanterns[2].x, lanterns[2].z);
    expect(view.root.getObjectByName('seasonal-decor-content')?.visible).toBe(false);
    view.dispose();
  });
});
