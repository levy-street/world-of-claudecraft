// The Open Source's reward-chest beacon (src/render/source_cave_chest_beacon.ts).
//
// The load-bearing claim here is a FAIRNESS one, not an aesthetic one. The
// cleared room is deliberately left near-black, so the beacon is how a raid
// finds its reward across 42 units of murk. The renderer keeps only
// GFX.maxPointLights point lights visible (as few as 2), ranked by distance, and
// the arena's 18 pillar torches sit closer to the fight than the chest does: a
// beacon that were only a PointLight would be ranked out at exactly the distance
// where it is needed, harder on low tiers. These cases pin that the long-range
// read is carried by always-rendered meshes instead.

import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';
import { buildSourceCaveChestBeacon } from '../src/render/source_cave_chest_beacon';

// The default vitest env has no working 2D canvas and the beacon's glow texture
// is drawn at runtime (textures.ts), so stand in an absorbing recording stub;
// only rasterization is faked (the idiom of tests/profession_icons.test.ts).
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string | symbol, unknown> = {};
  return new Proxy(target, {
    get: (t, prop) => {
      if (prop === 'createRadialGradient') return () => gradient;
      if (prop in t) return t[prop];
      return () => {};
    },
    set: (t, prop, value) => {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function build(): THREE.Group {
  vi.stubGlobal('document', {
    createElement: () =>
      ({ width: 0, height: 0, getContext: () => fakeCtx() }) as unknown as HTMLCanvasElement,
  });
  return buildSourceCaveChestBeacon();
}

function lights(group: THREE.Group): THREE.PointLight[] {
  return group.children.filter((c): c is THREE.PointLight => (c as THREE.PointLight).isPointLight);
}

function meshes(group: THREE.Group): THREE.Object3D[] {
  return group.children.filter((c) => !(c as THREE.PointLight).isPointLight);
}

describe('source cave chest beacon: the long read survives every tier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries the beacon on non-light objects, not on the budgeted PointLight alone', () => {
    const group = build();
    // If this ever drops to zero, the beacon becomes invisible the moment the
    // point-light budget ranks it out, which is most of the time.
    expect(meshes(group).length).toBeGreaterThan(0);
    expect(lights(group)).toHaveLength(1);
  });

  it('builds the same objects on every call, with no tier or preset input', () => {
    // The builder takes no arguments at all: there is deliberately no knob a
    // graphics preset could use to shed the "where is the loot" cue.
    expect(buildSourceCaveChestBeacon.length).toBe(0);
    const a = build();
    const b = build();
    expect(meshes(b).length).toBe(meshes(a).length);
    expect(lights(b)).toHaveLength(1);
  });

  it('stands the column tall enough to clear the chest and be seen from across the room', () => {
    const group = build();
    const tallest = Math.max(
      ...meshes(group).map((o) => {
        const sprite = o as THREE.Sprite;
        return sprite.position.y + (sprite.scale?.y ?? 0) / 2;
      }),
    );
    expect(tallest).toBeGreaterThan(6);
  });
});

describe('source cave chest beacon: renderer contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stamps budgetBase so the light budget restores a real intensity', () => {
    const [light] = lights(build());
    expect(light.userData.budgetBase).toBe(light.intensity);
    expect(light.intensity).toBeGreaterThan(0);
    // Static, not a moving VFX light: the budget caches its world position.
    expect(light.userData.budgetDynamic).toBeUndefined();
  });

  it('marks its mesh geometry shared so view churn cannot dispose it', () => {
    // The beacon rides the chest's entity view, which removeView tears down on
    // interest churn: it walks the group and disposes every isMesh geometry that
    // is not marked shared. An unmarked one would be disposed out from under the
    // module-level cache and the next chest would draw nothing.
    const built = meshes(build()).filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[];
    expect(built.length).toBeGreaterThan(0);
    for (const mesh of built) expect(isSharedGeometry(mesh.geometry)).toBe(true);
  });

  it('marks every material shared, meshes and sprites alike', () => {
    const group = build();
    for (const object of meshes(group)) {
      const material = (object as THREE.Mesh | THREE.Sprite).material as THREE.Material;
      expect(isSharedMaterial(material)).toBe(true);
    }
  });

  it('reuses one material per part across chests rather than allocating per view', () => {
    const first = meshes(build()).map((o) => (o as THREE.Mesh).material);
    const second = meshes(build()).map((o) => (o as THREE.Mesh).material);
    expect(second).toEqual(first);
  });
});
