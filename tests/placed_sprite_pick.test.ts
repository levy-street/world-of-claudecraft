import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlacedAssetsView } from '../src/render/placed_assets';
import type { PlacedImposters } from '../src/render/placed_imposters';
import { spriteQuadRayDistance } from '../src/render/placed_sprite_pick_core';
import { MODEL_PATH } from '../src/sim/map_doc';
import type { PlacedAsset } from '../src/sim/types';

// A far batched placement draws as a camera-facing billboard through one
// instanced quad mesh three's raycast cannot see, so the Studio could not
// click a tree past PLACED_IMPOSTER_DIST. The pick now tests the drawn quad.

describe('spriteQuadRayDistance (the drawn billboard)', () => {
  // seat (300, 0, 0), 4 wide, 10 tall, eye at the origin
  const hit = (oy: number, dx: number, dy: number, dz: number, eyeX = 0, eyeZ = 0) => {
    const len = Math.hypot(dx, dy, dz);
    return spriteQuadRayDistance(
      300,
      0,
      0,
      4,
      10,
      eyeX,
      eyeZ,
      0,
      oy,
      0,
      dx / len,
      dy / len,
      dz / len,
    );
  };

  it('hits a ray through the quad at its distance', () => {
    expect(hit(5, 1, 0, 0)).toBeCloseTo(300, 3);
  });

  it('misses a ray beside, above or below the quad', () => {
    expect(hit(5, 300, 0, 2.5)).toBe(-1); // 2.5 off a 2 half-width
    expect(hit(5, 300, 0, 1.9)).toBeGreaterThan(0);
    expect(hit(10.5, 1, 0, 0)).toBe(-1);
    expect(hit(-0.5, 1, 0, 0)).toBe(-1);
  });

  it('misses a quad behind the ray', () => {
    expect(hit(5, -1, 0, 0)).toBe(-1);
  });

  it('turns the quad toward the eye, not toward the ray origin', () => {
    // An eye due south of the seat stands the quad across the x axis: a ray
    // along +x from the origin then runs edge-on to it and draws nothing.
    expect(hit(5, 1, 0, 0, 300, -300)).toBe(-1);
    // ... while a ray from the south crossing x = 301 lands on it.
    expect(spriteQuadRayDistance(300, 0, 0, 4, 10, 300, -300, 301, 5, -300, 0, 0, 1)).toBeCloseTo(
      300,
      3,
    );
  });

  it('a degenerate sprite is never hit', () => {
    expect(spriteQuadRayDistance(300, 0, 0, 0, 10, 0, 0, 0, 5, 0, 1, 0, 0)).toBe(-1);
  });
});

describe('PlacedAssetsView.pickCandidates on the sprite tier', () => {
  function triangle(x: number, z: number): PlacedAsset {
    return {
      path: MODEL_PATH,
      x,
      z,
      rotY: 0,
      scale: 1,
      detached: true,
      groundY: 0,
      meshes: [{ verts: [-0.8, 0, 0, 0.8, 0, 0, 0, 2, 0], tris: [0, 1, 2] }],
    };
  }

  interface EntryInternals {
    lodLevel?: number;
    lodHidden: boolean;
    model: THREE.Object3D | null;
  }
  interface Internals {
    imposters: PlacedImposters;
    buildingImposters: PlacedImposters;
    entries: Map<number, EntryInternals>;
  }

  function entryOf(view: PlacedAssetsView): EntryInternals {
    const entry = (view as unknown as Internals).entries.get(0);
    if (!entry?.model) throw new Error('fixture entry missing');
    return entry;
  }

  /** Stand placement 0 in a sprite tier at (300, 0, 0), 4 wide and 10 tall:
   *  its own model hidden (the stand-in draws instead) and a baked strip. */
  function spriteView(tier: 'imposters' | 'buildingImposters') {
    const view = new PlacedAssetsView([triangle(0, 0)], 1);
    const inner = view as unknown as Internals;
    const sprites = inner[tier];
    (sprites as unknown as { archetypes: Map<string, unknown> }).archetypes.set('sprite.glb', {
      strip: 0,
      u0: 0,
      v0: 0,
      minY: 0,
      height: 10,
      radius: 2,
    });
    expect(sprites.attach(0, 'sprite.glb', 300, 0, 0, 0, 1, 1)).toBe(true);
    const entry = entryOf(view);
    entry.lodLevel = 1;
    if (entry.model) entry.model.visible = false;
    view.group.updateMatrixWorld(true);
    return view;
  }

  const directs = (view: PlacedAssetsView, origin: THREE.Vector3, target: THREE.Vector3) => {
    const raycaster = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
    return view.pickCandidates(raycaster, 720, 60).filter((candidate) => candidate.direct);
  };

  for (const [tier, label] of [
    ['imposters', 'foliage sprite'],
    ['buildingImposters', 'building sprite'],
  ] as const) {
    it(`picks a ${label} entry by a ray through its drawn quad`, () => {
      const view = spriteView(tier);
      const picked = directs(view, new THREE.Vector3(0, 5, 0), new THREE.Vector3(300, 5, 0));
      expect(picked).toHaveLength(1);
      expect(picked[0].index).toBe(0);
      expect(picked[0].distance).toBeCloseTo(300, 3);
      view.dispose();
    });

    it(`does not pick a ${label} entry by a ray beside its quad`, () => {
      const view = spriteView(tier);
      const origin = new THREE.Vector3(0, 5, 0);
      expect(directs(view, origin, new THREE.Vector3(300, 5, 3))).toEqual([]);
      expect(directs(view, origin, new THREE.Vector3(300, 11, 0))).toEqual([]);
      view.dispose();
    });
  }

  it('faces the quad toward the raycaster camera, not the ray origin', () => {
    // The editor's orthographic lens starts the ray on the near plane: the
    // camera the shader turns the quad toward stands elsewhere.
    const view = spriteView('imposters');
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(300, 50, -300);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(301, 5, -10),
      new THREE.Vector3(0, 0, 1),
    );
    raycaster.camera = camera;
    const picked = view.pickCandidates(raycaster, 720, 60).filter((c) => c.direct);
    expect(picked.map((c) => c.index)).toEqual([0]);
    expect(picked[0].distance).toBeCloseTo(10, 3);
    view.dispose();
  });

  it('follows a swap-remove and orders sprite hits nearest first under maxDepth', () => {
    const view = new PlacedAssetsView([triangle(0, 0), triangle(0, 0), triangle(0, 0)], 1);
    const inner = view as unknown as Internals;
    const sprites = inner.imposters;
    (sprites as unknown as { archetypes: Map<string, unknown> }).archetypes.set('sprite.glb', {
      strip: 0,
      u0: 0,
      v0: 0,
      minY: 0,
      height: 10,
      radius: 2,
    });
    const seats: [number, number][] = [
      [300, -20],
      [300, 0],
      [400, 0],
    ];
    seats.forEach(([x, z], id) => {
      expect(sprites.attach(id, 'sprite.glb', x, 0, z, 0, 1, 1)).toBe(true);
      const entry = inner.entries.get(id);
      if (!entry?.model) throw new Error('fixture entry missing');
      entry.lodLevel = 1;
      entry.model.visible = false;
    });
    // id 2 moves into the freed slot 0: its slot must still draw (and pick) at 400
    sprites.detach(0);
    view.group.updateMatrixWorld(true);
    const origin = new THREE.Vector3(0, 5, 0);
    expect(directs(view, origin, new THREE.Vector3(300, 5, -20))).toEqual([]);
    const inLine = directs(view, origin, new THREE.Vector3(300, 5, 0));
    expect(inLine.map((c) => c.index)).toEqual([1, 2]);
    expect(inLine[0].distance).toBeCloseTo(300, 3);
    expect(inLine[1].distance).toBeCloseTo(400, 3);
    const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(1, 0, 0));
    expect(view.pickCandidates(raycaster, 720, 60, undefined, 1)).toEqual([
      { index: 1, distance: expect.closeTo(300, 3), direct: true },
    ]);
    view.dispose();
  });

  it('a culled sprite entry is not picked', () => {
    const view = spriteView('imposters');
    entryOf(view).lodHidden = true;
    expect(directs(view, new THREE.Vector3(0, 5, 0), new THREE.Vector3(300, 5, 0))).toEqual([]);
    view.dispose();
  });
});
