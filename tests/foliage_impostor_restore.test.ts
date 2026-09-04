// Behavioral pins for the impostor atlas context-restore re-bake
// (foliage_impostor.ts rebakeImpostorAtlas, issue 3846). The atlas is a render
// target the sprites only sample, so a restored context leaves it black until
// it is rendered again. A structural fake of THREE.WebGLRenderer records which
// target every offscreen pass rendered into; the archetype parts are plain
// three geometry so everything runs in plain Node.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import {
  createImpostorSession,
  impostorsActive,
  rebakeImpostorAtlas,
} from '../src/render/foliage_impostor';
import { sameImpostorCellLayout } from '../src/render/foliage_impostor_core';
import {
  activateGfxProfile,
  type GfxCapabilities,
  getActiveGfxProfile,
  resolveGfxProfile,
} from '../src/render/gfx';

const desktopCapabilities: GfxCapabilities = Object.freeze({
  deviceMemory: 8,
  hardwareConcurrency: 12,
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
  gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
  nativeApp: false,
  tightMemory: false,
  platform: 'other',
  softwareRendering: false,
});

const highPreferences: GraphicsSettingsSnapshot = {
  graphicsPreset: 3,
  terrainDetail: 1,
  foliageDensity: 1,
  surfaceDetail: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  antiAliasing: 1,
  bloomQuality: 1,
  ambientOcclusion: 1,
  viewDistance: 1,
  waterQuality: 1,
  characterDetail: 1,
  dynamicLights: 1,
  particleEffects: 1,
};

interface FakeWebgl {
  capabilities: { getMaxAnisotropy(): number };
  autoClear: boolean;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getClearColor(out: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor: ReturnType<typeof vi.fn>;
  setRenderTarget: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  /** Every target a render() pass landed in, in order. */
  passes: (THREE.WebGLRenderTarget | null)[];
}

function fakeWebgl(): FakeWebgl {
  let current: THREE.WebGLRenderTarget | null = null;
  const w: FakeWebgl = {
    capabilities: { getMaxAnisotropy: () => 8 },
    autoClear: true,
    getRenderTarget: () => null,
    getClearColor: (out) => out.set(0x000000),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn((target: THREE.WebGLRenderTarget | null) => {
      current = target;
    }),
    clear: vi.fn(),
    render: vi.fn(() => {
      w.passes.push(current);
    }),
    passes: [],
  };
  return w;
}

function asRenderer(w: FakeWebgl): THREE.WebGLRenderer {
  return w as unknown as THREE.WebGLRenderer;
}

/** One tree archetype with one instance, baked into a fresh parent group. */
function bakeOneTree(w: FakeWebgl): { parent: THREE.Group; material: THREE.MeshStandardMaterial } {
  const session = createImpostorSession();
  if (!session) throw new Error('sprites must be active for this test');
  const part = {
    geometry: new THREE.BoxGeometry(1, 2, 1),
    material: new THREE.MeshStandardMaterial({ color: 0x336633 }),
    isLeaf: true,
  };
  const archetype = session.registerArchetype('tree', 'pine:test', [part]);
  const bucket = session.bucket('tree', 0, 0, 40);
  bucket.add(archetype, 3, 0, 4, 0.5, 1, 1, new THREE.Color(1, 1, 1));
  const parent = new THREE.Group();
  const registrations = session.finalize(asRenderer(w), parent, 7);
  expect(registrations).toHaveLength(1);
  const material = registrations[0].mesh.material as THREE.MeshStandardMaterial;
  return { parent, material };
}

let priorProfile: ReturnType<typeof getActiveGfxProfile>;

beforeEach(() => {
  priorProfile = getActiveGfxProfile();
  activateGfxProfile(resolveGfxProfile(desktopCapabilities, highPreferences, ''));
});

afterEach(() => {
  activateGfxProfile(priorProfile);
});

describe('rebakeImpostorAtlas (context restore)', () => {
  it('runs on a desktop high profile where sprites are active', () => {
    expect(impostorsActive()).toBe(true);
  });

  it('re-renders into the SAME live target and every sprite material keeps sampling it', () => {
    const w = fakeWebgl();
    const { material } = bakeOneTree(w);
    const atlas = material.map as THREE.Texture;
    expect(atlas).toBeInstanceOf(THREE.Texture);
    const liveTarget = w.passes.find((t) => t !== null && t.texture === atlas) ?? null;
    expect(liveTarget).not.toBeNull();
    const passesBefore = w.passes.length;
    w.passes.length = 0;

    expect(rebakeImpostorAtlas(asRenderer(w))).toBe(true);

    // The re-bake is the same pass count as the first bake, all landing in
    // the live target or the scratch cell (never a second final target).
    expect(w.passes).toHaveLength(passesBefore);
    const finalPasses = w.passes.filter((t) => t !== null && t.texture === atlas);
    expect(finalPasses.length).toBeGreaterThan(0);
    expect(new Set(finalPasses)).toEqual(new Set([liveTarget]));
    expect(material.map).toBe(atlas);
  });

  it('reports false before any atlas has been baked', () => {
    // The module singleton is reset by the previous bake's replacement only,
    // so this pin runs against a fresh session where the profile has sprites
    // off (no bake can have happened).
    activateGfxProfile(
      resolveGfxProfile(desktopCapabilities, { ...highPreferences, graphicsPreset: 0 }, ''),
    );
    expect(impostorsActive()).toBe(false);
    expect(createImpostorSession()).toBeNull();
  });

  it('packs the same specs to the same cells (the layout the sprites encode)', () => {
    const rects = [
      { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
      { u0: 0.5, v0: 0, u1: 1, v1: 0.5 },
    ];
    expect(
      sameImpostorCellLayout(
        rects,
        rects.map((r) => ({ ...r })),
      ),
    ).toBe(true);
    expect(sameImpostorCellLayout(rects, [rects[0]])).toBe(false);
    expect(sameImpostorCellLayout(rects, [rects[0], { ...rects[1], u1: 0.75 }])).toBe(false);
  });
});

describe('disposeImpostorAtlas (renderer teardown)', () => {
  it('releases the live target and forgets the bake, so a later re-bake is a no-op', async () => {
    const { disposeImpostorAtlas } = await import('../src/render/foliage_impostor');
    const w = fakeWebgl();
    const { material } = bakeOneTree(w);
    const atlas = material.map as THREE.Texture;
    const liveTarget = w.passes.find(
      (t) => t !== null && t.texture === atlas,
    ) as THREE.WebGLRenderTarget;
    const dispose = vi.spyOn(liveTarget, 'dispose');

    disposeImpostorAtlas();

    expect(dispose).toHaveBeenCalledOnce();
    w.passes.length = 0;
    expect(rebakeImpostorAtlas(asRenderer(w))).toBe(false);
    expect(w.passes).toEqual([]);
  });
});
