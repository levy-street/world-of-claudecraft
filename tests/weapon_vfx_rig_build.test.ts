// What building a weapon-skin VFX rig is allowed to COST, driven against the
// real createWeaponVfx over a stubbed 2d canvas (the module is otherwise plain
// Three + math). Two regressions are pinned here:
//   1. the world path (grounded: false) must build no sky backdrop: its
//      sceneExtras group is never added to any scene, so the 1024x1024 canvas
//      of gradients and hundreds of stars was pure waste inside the frame a
//      skinned player came into view;
//   2. the memoized emissive derivation is SHARED, so the first wearer's rig
//      tearing down must not dispose the textures the next wearer draws with.
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isSharedTexture } from '../src/render/shared_resource';
import {
  buildWeaponVfxPrewarmGroup,
  clearWeaponVfxTextureCacheForTest,
  createWeaponVfx,
  disposeWeaponEmissiveCache,
  TIERS,
  type WeaponVfxSpec,
} from '../src/render/weapon_vfx';

interface StubCanvas {
  width: number;
  height: number;
  getContext(): unknown;
}

const canvases: StubCanvas[] = [];
let getImageDataCalls = 0;
let priorDocument: unknown;

function stubContext() {
  const gradient = { addColorStop: () => {} };
  return {
    fillStyle: '',
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: () => {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      getImageDataCalls++;
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData: () => {},
  };
}

beforeAll(() => {
  const globals = globalThis as { document?: unknown };
  priorDocument = globals.document;
  globals.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      const canvas: StubCanvas = { width: 0, height: 0, getContext: () => stubContext() };
      canvases.push(canvas);
      return canvas;
    },
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = priorDocument;
});

beforeEach(() => {
  canvases.length = 0;
  getImageDataCalls = 0;
  // Both module-level memos are reset per case, so no assertion here depends on
  // what an earlier case (or a shuffled run order) already cached.
  clearWeaponVfxTextureCacheForTest();
  disposeWeaponEmissiveCache();
});

/** The size of the sky dome canvas: nothing else in the module draws one. */
const SKY_CANVAS_SIZE = 1024;

function skyCanvasCount(): number {
  return canvases.filter((canvas) => canvas.width === SKY_CANVAS_SIZE).length;
}

const EPIC_SPEC: WeaponVfxSpec = {
  tier: 'epic',
  name: 'test blade',
  type: 'sword',
  lore: '',
  fx: [],
};

function weaponRoot(map: THREE.Texture | null = null): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  material.map = map;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), material);
  mesh.userData.weaponMesh = true;
  return mesh;
}

// Order-independent by construction: beforeEach drops the module-level
// sprite/sky texture memo, so every case below observes a cold build and
// "did this rig draw a sky canvas" stays a real question in any run order.
describe('createWeaponVfx backdrop construction', () => {
  it('builds no backdrop at all on the world (held) path', () => {
    const root = weaponRoot();
    const handle = createWeaponVfx(root, EPIC_SPEC, { grounded: false });

    expect(skyCanvasCount()).toBe(0);
    expect(handle.sceneExtras.children).toHaveLength(0);
    // The API stays safe for both paths: the world path calls this right after
    // building the rig.
    expect(() => handle.setBackdropVisible(false)).not.toThrow();
    expect(() => handle.setBackdropVisible(true)).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
    expect(skyCanvasCount()).toBe(0);
  });

  it('still builds the showcase backdrop and ground pool when grounded', () => {
    const handle = createWeaponVfx(weaponRoot(), EPIC_SPEC, { grounded: true });

    expect(skyCanvasCount()).toBe(1);
    // backdrop dome + ground pool, the pair armory_preview mounts in its scene
    expect(handle.sceneExtras.children).toHaveLength(2);
    const backdrop = handle.sceneExtras.children[0];
    handle.setBackdropVisible(false);
    expect(backdrop.visible).toBe(false);
    handle.setBackdropVisible(true);
    expect(backdrop.visible).toBe(true);
    handle.dispose();
  });

  it('can take the ground pool without the sky (the boot prewarm rig)', () => {
    const handle = createWeaponVfx(
      weaponRoot(),
      { ...EPIC_SPEC, tier: 'legendary' },
      {
        grounded: true,
        backdrop: false,
      },
    );

    expect(skyCanvasCount()).toBe(0);
    expect(handle.sceneExtras.children).toHaveLength(1);
    handle.dispose();
  });
});

describe('weapon-skin emissive derivation sharing', () => {
  /** A drawable source albedo, as a skin GLB's webp map arrives. */
  function sourceMap(): THREE.Texture {
    const texture = new THREE.Texture();
    texture.image = { width: 4, height: 4 };
    return texture;
  }

  it('derives once per (source map, spec) and hands the same textures to every wearer', () => {
    const map = sourceMap();
    const first = weaponRoot(map);
    const second = weaponRoot(map);

    const rigA = createWeaponVfx(first, EPIC_SPEC, { grounded: false });
    const derivedEmissive = (first.material as THREE.MeshStandardMaterial).emissiveMap;
    const derivedAlbedo = (first.material as THREE.MeshStandardMaterial).map;
    expect(derivedEmissive).toBeTruthy();
    expect(derivedAlbedo).not.toBe(map);
    // Two canvases read back once each: the emissive map and the de-baked albedo.
    expect(getImageDataCalls).toBe(2);

    const rigB = createWeaponVfx(second, EPIC_SPEC, { grounded: false });
    expect((second.material as THREE.MeshStandardMaterial).emissiveMap).toBe(derivedEmissive);
    expect((second.material as THREE.MeshStandardMaterial).map).toBe(derivedAlbedo);
    // The second wearer paid for no readback, no canvas, no per-texel walk.
    expect(getImageDataCalls).toBe(2);

    rigA.dispose();
    rigB.dispose();
  });

  it('keeps the shared textures alive when the first wearer tears its rig down', () => {
    const map = sourceMap();
    const first = weaponRoot(map);
    const second = weaponRoot(map);
    const rigA = createWeaponVfx(first, EPIC_SPEC, { grounded: false });
    const rigB = createWeaponVfx(second, EPIC_SPEC, { grounded: false });

    const shared = (first.material as THREE.MeshStandardMaterial).emissiveMap as THREE.Texture;
    const sharedAlbedo = (first.material as THREE.MeshStandardMaterial).map as THREE.Texture;
    expect(isSharedTexture(shared)).toBe(true);
    expect(isSharedTexture(sharedAlbedo)).toBe(true);

    let disposals = 0;
    const count = () => {
      disposals++;
    };
    shared.addEventListener('dispose', count);
    sharedAlbedo.addEventListener('dispose', count);

    rigA.dispose();

    // The first wearer left; the second is still drawing with these textures,
    // and so is every future wearer of the skin.
    expect(disposals).toBe(0);
    expect((second.material as THREE.MeshStandardMaterial).emissiveMap).toBe(shared);
    // The wearer that left has its own material restored to the source map.
    expect((first.material as THREE.MeshStandardMaterial).map).toBe(map);
    expect((first.material as THREE.MeshStandardMaterial).emissiveMap).toBeNull();

    // A later wearer is served the very same (still undisposed) pair.
    const third = weaponRoot(map);
    const rigC = createWeaponVfx(third, EPIC_SPEC, { grounded: false });
    expect((third.material as THREE.MeshStandardMaterial).emissiveMap).toBe(shared);
    expect(getImageDataCalls).toBe(2);
    expect(disposals).toBe(0);

    rigB.dispose();
    rigC.dispose();
  });

  it('derives separately for a different emissive spec on the same map', () => {
    const map = sourceMap();
    const epic = weaponRoot(map);
    const legendary = weaponRoot(map);

    createWeaponVfx(epic, EPIC_SPEC, { grounded: false });
    createWeaponVfx(legendary, { ...EPIC_SPEC, tier: 'legendary' }, { grounded: false });

    expect(TIERS.legendary.emissive).not.toEqual(TIERS.epic.emissive);
    expect((legendary.material as THREE.MeshStandardMaterial).emissiveMap).not.toBe(
      (epic.material as THREE.MeshStandardMaterial).emissiveMap,
    );
    expect(getImageDataCalls).toBe(4);
  });

  // The memo is renderer-lifetime: no rig may release it, so without this one
  // path the whole derived set would ride a WebGL context recycle into the next
  // context.
  it('releases every memoized pair at renderer teardown, then re-derives cold', () => {
    const map = sourceMap();
    const first = weaponRoot(map);
    const rigA = createWeaponVfx(first, EPIC_SPEC, { grounded: false });
    const shared = (first.material as THREE.MeshStandardMaterial).emissiveMap as THREE.Texture;
    const sharedAlbedo = (first.material as THREE.MeshStandardMaterial).map as THREE.Texture;

    const disposed: THREE.Texture[] = [];
    shared.addEventListener('dispose', () => disposed.push(shared));
    sharedAlbedo.addEventListener('dispose', () => disposed.push(sharedAlbedo));

    // Teardown order the renderer uses: every rig first, then the cache.
    rigA.dispose();
    expect(disposed).toEqual([]);
    disposeWeaponEmissiveCache();
    expect(disposed).toEqual([shared, sharedAlbedo]);

    // The map is empty, not merely detached: the next wearer derives afresh
    // instead of being handed a disposed texture.
    const next = weaponRoot(map);
    createWeaponVfx(next, EPIC_SPEC, { grounded: false });
    expect(getImageDataCalls).toBe(4);
    expect((next.material as THREE.MeshStandardMaterial).emissiveMap).not.toBe(shared);
  });
});

describe('buildWeaponVfxPrewarmGroup', () => {
  it('covers every component family off-screen, with no sky and no extra light', () => {
    const group = buildWeaponVfxPrewarmGroup();

    expect(group.position.y).toBe(-1000);
    expect(skyCanvasCount()).toBe(0);

    const names = new Set<string>();
    let lights = 0;
    let visibleLights = 0;
    let shells = 0;
    group.traverse((object) => {
      if (object.name) names.add(object.name);
      if ((object as THREE.PointLight).isPointLight) {
        lights++;
        if (object.visible) visibleLights++;
      }
      if (object.userData.__vfx) shells++;
    });

    for (const name of ['vfx_coreSprite', 'vfx_motes', 'vfx_drift', 'vfx_twinkles', 'vfx_aurora']) {
      expect(names, `${name} missing from the prewarm rig`).toContain(name);
    }
    // The fresnel rim shell parents itself to the host mesh instead of the rig
    // group, so it is counted by its tag rather than a name.
    expect(shells).toBeGreaterThan(0);
    // The ground pool rides sceneExtras, which the group carries too.
    expect(names).toContain('weapon_vfx_extras');
    // A visible light would change the scene's light counts, and those counts
    // are part of every program cache key the boot compile warms.
    expect(lights).toBe(1);
    expect(visibleLights).toBe(0);
  });
});
