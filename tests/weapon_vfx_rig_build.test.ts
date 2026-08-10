// What building a weapon-skin VFX rig is allowed to COST, driven against the
// real createWeaponVfx over a stubbed 2d canvas (the module is otherwise plain
// Three + math). Three regressions are pinned here:
//   1. the world path (grounded: false) must build no sky backdrop: its
//      sceneExtras group is never added to any scene, so the 1024x1024 canvas
//      of gradients and hundreds of stars was pure waste inside the frame a
//      skinned player came into view;
//   2. the memoized emissive derivation is SHARED, so the first wearer's rig
//      tearing down must not dispose the textures the next wearer draws with;
//   3. the memo is BOUNDED (the C2 memory ratchet): idle derivations past the
//      idle cap evict and dispose, live wearers pin theirs, and an evicted
//      derivation rebuilds byte-identically on its next wearer.
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isSharedTexture } from '../src/render/shared_resource';
import {
  buildWeaponVfxPrewarmGroup,
  clearWeaponVfxTextureCacheForTest,
  createWeaponVfx,
  disposeWeaponEmissiveCache,
  TIERS,
  WEAPON_VFX,
  type WeaponVfxSpec,
} from '../src/render/weapon_vfx';
import { WEAPON_EMISSIVE_IDLE_CACHE_MAX } from '../src/render/weapon_vfx_emissive_cache_core';

interface StubCanvas {
  width: number;
  height: number;
  getContext(): unknown;
}

const canvases: StubCanvas[] = [];
const putImageDataWrites: Uint8ClampedArray[] = [];
let getImageDataCalls = 0;
/** When set, the Nth getImageData call throws (a tainted/detached source), for
 *  the aborted-build reference-release pin. */
let failGetImageDataAtCall: number | null = null;
let priorDocument: unknown;

// Deterministic 2d-context pixels: the derivation reads real bytes here, so
// the bounded-cache suite below can compare a rebuilt derivation byte for
// byte against the original. The palette cycles the texel classes the
// emissive core distinguishes (in-window azure, out-of-window red, near-white
// residual, dull reject), so a derivation writes real nonzero grades.
const STUB_TEXELS = [
  [51, 187, 255],
  [255, 51, 51],
  [250, 250, 250],
  [110, 120, 128],
] as const;

function stubImageData(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = STUB_TEXELS[i % STUB_TEXELS.length];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

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
      if (getImageDataCalls === failGetImageDataAtCall) {
        throw new Error('stub getImageData failure');
      }
      return stubImageData(w, h);
    },
    putImageData: (image: { data: Uint8ClampedArray }) => {
      putImageDataWrites.push(Uint8ClampedArray.from(image.data));
    },
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
  putImageDataWrites.length = 0;
  getImageDataCalls = 0;
  failGetImageDataAtCall = null;
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

/** A drawable source albedo, as a skin GLB's webp map arrives. Each call mints
 *  a distinct texture uuid, i.e. a distinct skin as the cache sees it. */
function sourceMap(): THREE.Texture {
  const texture = new THREE.Texture();
  texture.image = { width: 4, height: 4 };
  return texture;
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

describe('bounded emissive derivation cache (the C2 ratchet fix)', () => {
  /** Build a rig on a fresh wearer of `map` and immediately tear it down,
   *  leaving the derivation idle in the cache. Returns the derived pair the
   *  wearer drew with. */
  function wearAndLeave(map: THREE.Texture) {
    const root = weaponRoot(map);
    const rig = createWeaponVfx(root, EPIC_SPEC, { grounded: false });
    const material = root.material as THREE.MeshStandardMaterial;
    const pair = {
      tex: material.emissiveMap as THREE.CanvasTexture,
      albedo: material.map as THREE.CanvasTexture,
    };
    rig.dispose();
    return pair;
  }

  it('keeps an idle derivation warm for the next wearer of the same skin', () => {
    const map = sourceMap();
    wearAndLeave(map);
    expect(getImageDataCalls).toBe(2);

    // Every wearer left, but the derivation is within the idle bound: the
    // next wearer pays no readback and no per-texel walk.
    const rig = createWeaponVfx(weaponRoot(map), EPIC_SPEC, { grounded: false });
    expect(getImageDataCalls).toBe(2);
    rig.dispose();
  });

  it('bounds idle retention: past the cap the least-recently-released pairs are disposed', () => {
    const maps = Array.from({ length: WEAPON_EMISSIVE_IDLE_CACHE_MAX + 2 }, () => sourceMap());
    const disposals: number[] = maps.map(() => 0);
    for (const [i, map] of maps.entries()) {
      const { tex, albedo } = wearAndLeave(map);
      tex.addEventListener('dispose', () => {
        disposals[i]++;
      });
      albedo.addEventListener('dispose', () => {
        disposals[i]++;
      });
    }

    // Exactly the two oldest-released derivations fell out, both textures of
    // each disposed exactly once; every resident survivor is untouched.
    expect(disposals[0]).toBe(2);
    expect(disposals[1]).toBe(2);
    for (let i = 2; i < maps.length; i++) {
      expect(disposals[i], `map ${i} must stay resident`).toBe(0);
    }

    // A survivor is served warm; an evicted skin re-derives cold.
    const before = getImageDataCalls;
    wearAndLeave(maps[maps.length - 1]);
    expect(getImageDataCalls).toBe(before);
    wearAndLeave(maps[0]);
    expect(getImageDataCalls).toBe(before + 2);
  });

  it('never disposes a pair a live rig still draws with while idle churn evicts around it', () => {
    const liveMap = sourceMap();
    const liveRoot = weaponRoot(liveMap);
    const liveRig = createWeaponVfx(liveRoot, EPIC_SPEC, { grounded: false });
    const material = liveRoot.material as THREE.MeshStandardMaterial;
    const liveTex = material.emissiveMap as THREE.Texture;
    const liveAlbedo = material.map as THREE.Texture;
    let disposals = 0;
    const count = () => {
      disposals++;
    };
    liveTex.addEventListener('dispose', count);
    liveAlbedo.addEventListener('dispose', count);

    for (let i = 0; i < WEAPON_EMISSIVE_IDLE_CACHE_MAX + 3; i++) wearAndLeave(sourceMap());

    // Idle churn ran the cache well past its bound; the live wearer's pair
    // was pinned through all of it, so nothing on screen changed.
    expect(disposals).toBe(0);
    expect(material.emissiveMap).toBe(liveTex);
    expect(material.map).toBe(liveAlbedo);

    // Once released it is the most recently released idle entry: still warm.
    liveRig.dispose();
    const before = getImageDataCalls;
    wearAndLeave(liveMap);
    expect(getImageDataCalls).toBe(before);
    expect(disposals).toBe(0);
  });

  it('a double-disposed rig releases its pin only once (the other wearer stays pinned)', () => {
    const map = sourceMap();
    const rigA = createWeaponVfx(weaponRoot(map), EPIC_SPEC, { grounded: false });
    const rootB = weaponRoot(map);
    const rigB = createWeaponVfx(rootB, EPIC_SPEC, { grounded: false });
    const material = rootB.material as THREE.MeshStandardMaterial;
    const tex = material.emissiveMap as THREE.Texture;
    let disposals = 0;
    tex.addEventListener('dispose', () => {
      disposals++;
    });

    rigA.dispose();
    rigA.dispose(); // must not strip rigB's reference
    for (let i = 0; i < WEAPON_EMISSIVE_IDLE_CACHE_MAX + 2; i++) wearAndLeave(sourceMap());

    expect(disposals).toBe(0);
    expect(material.emissiveMap).toBe(tex);
    rigB.dispose();
  });

  it('an aborted build releases the references it already acquired', () => {
    // Two meshes with two distinct maps: the first derives cleanly, the
    // second derivation throws (a tainted/detached source mid-traverse).
    const okMap = sourceMap();
    const badMap = sourceMap();
    const root = weaponRoot(okMap);
    const second = weaponRoot(badMap);
    root.add(second);

    failGetImageDataAtCall = 3; // okMap reads twice; badMap's first read throws
    expect(() => createWeaponVfx(root, EPIC_SPEC, { grounded: false })).toThrow(
      'stub getImageData failure',
    );

    // The aborted build restored the first material ...
    const material = root.material as THREE.MeshStandardMaterial;
    expect(material.map).toBe(okMap);
    expect(material.emissiveMap).toBeNull();

    // ... and dropped its cache reference: the derivation is idle, so idle
    // churn can evict it. A leaked reference would pin it forever, silently
    // reverting this skin to the unbounded ratchet.
    const pair = wearAndLeave(okMap);
    let disposals = 0;
    const count = () => {
      disposals++;
    };
    pair.tex.addEventListener('dispose', count);
    pair.albedo.addEventListener('dispose', count);
    for (let i = 0; i < WEAPON_EMISSIVE_IDLE_CACHE_MAX + 1; i++) wearAndLeave(sourceMap());
    expect(disposals).toBe(2);
  });

  it('rebuilds an evicted derivation byte-identically with identical texture parameters', () => {
    const map = sourceMap();
    const first = wearAndLeave(map);
    const firstWrites = putImageDataWrites.slice(-2);
    // Non-vacuous: the deterministic stub pattern includes in-window azure
    // texels, so both derivation writes carry real color (alpha excluded).
    expect(firstWrites[0].some((byte, i) => i % 4 !== 3 && byte > 0)).toBe(true);
    expect(firstWrites[1].some((byte, i) => i % 4 !== 3 && byte > 0)).toBe(true);

    // Flood the idle set until the pair is evicted.
    for (let i = 0; i < WEAPON_EMISSIVE_IDLE_CACHE_MAX + 1; i++) wearAndLeave(sourceMap());

    const before = getImageDataCalls;
    const root = weaponRoot(map);
    const rig = createWeaponVfx(root, EPIC_SPEC, { grounded: false });
    // Truly re-derived, not served stale from a disposed entry.
    expect(getImageDataCalls).toBe(before + 2);
    const material = root.material as THREE.MeshStandardMaterial;
    const rebuiltTex = material.emissiveMap as THREE.CanvasTexture;
    const rebuiltAlbedo = material.map as THREE.CanvasTexture;
    expect(rebuiltTex).not.toBe(first.tex);

    // The rebuilt pair writes pixel-for-pixel the first derivation again ...
    const rebuiltWrites = putImageDataWrites.slice(-2);
    expect(rebuiltWrites[0]).toEqual(firstWrites[0]);
    expect(rebuiltWrites[1]).toEqual(firstWrites[1]);
    // ... under the same texture parameters, so an evicted-then-rebuilt
    // derivation is indistinguishable on screen.
    const pairs = [
      [rebuiltTex, first.tex],
      [rebuiltAlbedo, first.albedo],
    ] as const;
    for (const [rebuilt, original] of pairs) {
      expect(rebuilt.flipY).toBe(original.flipY);
      expect(rebuilt.colorSpace).toBe(original.colorSpace);
      expect(rebuilt.wrapS).toBe(original.wrapS);
      expect(rebuilt.wrapT).toBe(original.wrapT);
      expect(isSharedTexture(rebuilt)).toBe(true);
    }
    rig.dispose();
  });
});

describe('buildWeaponVfxPrewarmGroup', () => {
  it('builds one rig per REAL catalog spec through the live world path', () => {
    // The old single synthetic spec covered each component FAMILY but not the
    // real program-key set: the first skin sighted in the world still linked
    // ~108 programs inside one frame (the measured geared-arrival freeze).
    // Coverage by construction instead: every WEAPON_VFX entry, built with
    // the exact worn-skin options (grounded: false), so the boot compile
    // links every key a live arrival can ask for.
    const group = buildWeaponVfxPrewarmGroup();
    const specCount = Object.keys(WEAPON_VFX).length;

    expect(group.position.y).toBe(-1000);
    expect(skyCanvasCount()).toBe(0);

    const names = new Set<string>();
    let hosts = 0;
    let lights = 0;
    let visibleLights = 0;
    const shells: THREE.Object3D[] = [];
    group.traverse((object) => {
      if (object.name) names.add(object.name);
      if (object.name?.startsWith('prewarm-skin-host:')) hosts++;
      if ((object as THREE.PointLight).isPointLight) {
        lights++;
        if (object.visible) visibleLights++;
      }
      if (object.userData.__vfx) shells.push(object);
    });

    expect(hosts).toBe(specCount);
    for (const key of Object.keys(WEAPON_VFX)) {
      expect(names, `spec ${key} missing from the prewarm group`).toContain(
        `prewarm-skin-host:${key}`,
      );
    }
    for (const name of ['vfx_coreSprite', 'vfx_motes', 'vfx_drift', 'vfx_twinkles', 'vfx_aurora']) {
      expect(names, `${name} missing from the prewarm rigs`).toContain(name);
    }
    // The fresnel rim shell parents itself to the host mesh instead of the rig
    // group, so it is counted by its tag rather than a name.
    expect(shells.length).toBeGreaterThan(0);
    // Every shell must carry the applyMaterials skip tag itself: userData is
    // per object, never inherited, and visual.ts only tags the rig group's own
    // subtree. A shell without it is silently re-owned by a ShaderMaterial
    // clone on the next material sweep, so the rig's uTime/uStr uniform writes
    // stop reaching the rendered material.
    for (const shell of shells) {
      expect(shell.userData.weaponVfxMesh, 'shell missing the applyMaterials skip tag').toBe(true);
    }
    // The ground pool rides sceneExtras, which every rig group carries.
    expect(names).toContain('weapon_vfx_extras');
    // A visible light would change the scene's light counts, and those counts
    // are part of every program cache key the boot compile warms.
    expect(lights).toBe(specCount);
    expect(visibleLights).toBe(0);
  });
});
