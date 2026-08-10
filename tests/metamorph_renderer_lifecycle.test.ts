import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';

interface Disposable {
  dispose(): void;
}

interface LifecycleView {
  group: THREE.Group;
  viewLights: THREE.Light[];
  nameplate: { remove(): void };
  clickTarget: THREE.Object3D;
  visual: Disposable;
  visualPoolKey: null;
  sheepVisual: null;
  bearVisual: null;
  catVisual: null;
  travelVisual: null;
  metamorphVisual: Disposable;
  fireballTravelVisual: null;
  iceBlockVisual: null;
  temporalHourglassVisual: null;
  frostNovaRootVisual: null;
  mageBarrierVisual: null;
}

interface LifecycleHarness {
  views: Map<number, LifecycleView>;
  scene: { remove(object: THREE.Object3D): void };
  lightOwnerGroups: Set<THREE.Group>;
  viewLights: THREE.Light[];
  clickTargets: THREE.Object3D[];
  lightRankDirty: boolean;
  weaponSkinApplies: { cancel(id: number): void };
  nameplatePainter: { remove(id: number): void };
  removeView(id: number): void;
}

describe('Metamorphosis renderer lifecycle', () => {
  it('disposes the dedicated form when its owning entity despawns', () => {
    const baseDispose = vi.fn();
    const metamorphDispose = vi.fn();
    const group = new THREE.Group();
    const clickTarget = new THREE.Object3D();
    const view: LifecycleView = {
      group,
      viewLights: [],
      nameplate: { remove: vi.fn() },
      clickTarget,
      visual: { dispose: baseDispose },
      visualPoolKey: null,
      sheepVisual: null,
      bearVisual: null,
      catVisual: null,
      travelVisual: null,
      metamorphVisual: { dispose: metamorphDispose },
      fireballTravelVisual: null,
      iceBlockVisual: null,
      temporalHourglassVisual: null,
      frostNovaRootVisual: null,
      mageBarrierVisual: null,
    };
    const renderer = Object.create(Renderer.prototype) as unknown as LifecycleHarness;
    renderer.views = new Map([[42, view]]);
    renderer.scene = { remove: vi.fn() };
    renderer.lightOwnerGroups = new Set([group]);
    renderer.viewLights = [];
    renderer.clickTargets = [clickTarget];
    renderer.lightRankDirty = false;
    renderer.weaponSkinApplies = { cancel: vi.fn() };
    renderer.nameplatePainter = { remove: vi.fn() };

    renderer.removeView(42);

    expect(baseDispose).toHaveBeenCalledOnce();
    expect(metamorphDispose).toHaveBeenCalledOnce();
    expect(renderer.views.has(42)).toBe(false);
    expect(renderer.clickTargets).toHaveLength(0);
    expect(renderer.lightOwnerGroups.has(group)).toBe(false);
  });
});
