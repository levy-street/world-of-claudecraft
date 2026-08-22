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
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import { isSharedTexture } from '../src/render/shared_resource';
import {
  buildWeaponVfxPrewarmGroup,
  buildWeaponVfxPrewarmSkinGroup,
  clearWeaponVfxTextureCacheForTest,
  createWeaponVfx,
  disposeWeaponEmissiveCache,
  disposeWeaponVfxPrewarmSkinGroups,
  TIERS,
  WEAPON_VFX,
  WEAPON_VFX_PREWARM_KEYS,
  type WeaponVfxSpec,
} from '../src/render/weapon_vfx';
import { WEAPON_EMISSIVE_IDLE_CACHE_MAX } from '../src/render/weapon_vfx_emissive_cache_core';
import {
  createWeaponVfxPrewarmSkinStage,
  weaponVfxPrewarmSkinUnitKey,
  weaponVfxPrewarmUnits,
} from '../src/render/weapon_vfx_prewarm';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

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

describe('streamed weapon-skin prewarm staging', () => {
  it('deduplicates catalog units into one hidden aggregate group', () => {
    const scene = new THREE.Scene();
    const stage = createWeaponVfxPrewarmSkinStage(scene);
    const key = WEAPON_VFX_PREWARM_KEYS[0];

    const first = stage.stage(key);
    expect(stage.group).toBe(scene.children[0]);
    expect(stage.group?.visible).toBe(false);
    expect(stage.group?.userData.renderCategory).toBe('prewarm');
    expect(stage.stage(key)).toBe(first);
    expect(stage.group?.children).toEqual([first]);
  });

  it('releases only the failed unit and leaves every other staged skin linked', () => {
    // The resume lane reports failures per unit. Disposing the whole catalog
    // would drop the already-linked programs of every earlier skin (three
    // releases a program with its last material) and leave the later build
    // units to re-stage a fresh group: dispose-then-relink in live frames.
    const scene = new THREE.Scene();
    const stage = createWeaponVfxPrewarmSkinStage(scene);
    const [failedKey, survivorKey] = WEAPON_VFX_PREWARM_KEYS;
    expect(survivorKey).toBeDefined();

    const failed = stage.stage(failedKey);
    const survivor = stage.stage(survivorKey);
    const survivorMaterials: THREE.Material[] = [];
    survivor.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material) survivorMaterials.push(...(Array.isArray(material) ? material : [material]));
    });
    expect(survivorMaterials.length).toBeGreaterThan(0);
    const survivorDisposals = survivorMaterials.map((material) => vi.spyOn(material, 'dispose'));
    const failedGeometry = vi.fn();
    failed.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry) vi.spyOn(geometry, 'dispose').mockImplementation(failedGeometry);
    });

    stage.disposeFailedUnit(`weapon-skins:compile:${failedKey}`);

    expect(stage.get(failedKey)).toBeUndefined();
    expect(failedGeometry).toHaveBeenCalled();
    // The aggregate survives with the untouched skin still mounted, so the
    // remaining compile units still find their groups.
    expect(stage.get(survivorKey)).toBe(survivor);
    expect(stage.group).toBe(scene.children[0]);
    expect(stage.group?.children).toEqual([survivor]);
    for (const disposal of survivorDisposals) expect(disposal).not.toHaveBeenCalled();
  });

  it('releases nothing for a unit that owns no skin group', () => {
    // The shared-texture unit and any unrecognised id: the staged skins are
    // still valid, so a failure there must not cost them their programs.
    const scene = new THREE.Scene();
    const stage = createWeaponVfxPrewarmSkinStage(scene);
    const key = WEAPON_VFX_PREWARM_KEYS[0];
    const staged = stage.stage(key);

    stage.disposeFailedUnit('weapon-skins:textures');
    stage.disposeFailedUnit('weapon-skins:build:no-such-skin');
    stage.disposeFailedUnit('some-other-entry:unit');

    expect(stage.get(key)).toBe(staged);
    expect(stage.group?.children).toEqual([staged]);
  });

  it('maps only the two per-skin unit ids to a key', () => {
    expect(weaponVfxPrewarmSkinUnitKey('weapon-skins:build:flame_sword')).toBe('flame_sword');
    expect(weaponVfxPrewarmSkinUnitKey('weapon-skins:compile:flame_sword')).toBe('flame_sword');
    expect(weaponVfxPrewarmSkinUnitKey('weapon-skins:textures')).toBeNull();
    expect(weaponVfxPrewarmSkinUnitKey('weapon-skins:group')).toBeNull();
    expect(weaponVfxPrewarmSkinUnitKey('mount:tiger')).toBeNull();
  });
});

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
describe('createWeaponVfx point-light visibility ownership', () => {
  // three counts a light into numPointLights iff it is visible, whatever its
  // intensity, and every material's program cache key carries that count. A
  // light born visible on the budgeted world path is therefore counted for the
  // frames before the point-light budget first rules on it, and the changed
  // count relinks every material drawn in them: measured as one frame in 5434
  // sitting at 7 budgeted lights against a pin of 6, each relink a 100 to
  // 200 ms synchronous stall.
  it('is born hidden when a budget owns its visibility', () => {
    const handle = createWeaponVfx(weaponRoot(), EPIC_SPEC, {
      grounded: false,
      budgetedLight: true,
    });
    expect(handle.light.visible).toBe(false);
    // Still a real, budget-rankable light: only `visible` is deferred.
    expect(handle.light.userData.budgetDynamic).toBe(true);
    expect(handle.light.intensity).toBeGreaterThan(0);
    handle.dispose();
  });

  it('keeps lighting immediately for a caller with no budget', () => {
    // The armoury preview owns its own renderer and scene, so nothing there
    // ever sets `visible` for it.
    const preview = createWeaponVfx(weaponRoot(), EPIC_SPEC, { grounded: true });
    expect(preview.light.visible).toBe(true);
    preview.dispose();

    const worldDefault = createWeaponVfx(weaponRoot(), EPIC_SPEC, { grounded: false });
    expect(worldDefault.light.visible).toBe(true);
    worldDefault.dispose();
  });

  it('wires the world path to ask for the budgeted light', () => {
    // The two cases above pin both ARMS of the option; nothing pins that the
    // world factory actually asks for the budgeted one, and that half is
    // unreachable from a unit test (createCharacterVisual needs preloaded
    // GLBs). Drop the flag and every case here stays green while a visible
    // unranked light rides every entity that spawns holding a rarity weapon.
    const characters = codeWithoutLineComments(
      readFileSync(new URL('../src/render/characters/index.ts', import.meta.url), 'utf8'),
    );
    const factoryStart = characters.indexOf('export function createCharacterVisual(');
    expect(factoryStart, 'createCharacterVisual was renamed; re-anchor this pin').toBeGreaterThan(
      -1,
    );
    const construction = characters.indexOf('new CharacterVisual(', factoryStart);
    const flag = characters.indexOf('visual.budgetedWeaponLight = true;', construction);
    const returned = characters.indexOf('return visual;', construction);
    expect(construction).toBeGreaterThan(factoryStart);
    // Set before the visual escapes the factory: a rig handed out first could
    // build its weapon vfx with the flag still false.
    expect(flag).toBeGreaterThan(construction);
    expect(returned).toBeGreaterThan(flag);

    // And the visual hands that flag to this factory rather than to nothing.
    const visual = codeWithoutLineComments(
      readFileSync(new URL('../src/render/characters/visual.ts', import.meta.url), 'utf8'),
    );
    expect(visual).toContain('budgetedLight: this.budgetedWeaponLight,');
  });
});

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
  /** A painted GLB map: drawable, so deriveEmissive takes its derived arm. */
  function paintedMap(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas') as unknown as HTMLCanvasElement;
    canvas.width = 4;
    canvas.height = 4;
    return new THREE.CanvasTexture(canvas);
  }

  function liveSkinMesh(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: paintedMap(),
        metalnessMap: paintedMap(),
        roughnessMap: paintedMap(),
      }),
    );
  }

  it('hosts the LIVE program variant, not the mapless flat-tint twin', () => {
    // deriveEmissive BRANCHES on the host material's map. A mapless host takes
    // the flat-tint fallback (emissiveMap absent, map absent), which is a
    // different program-cache key from the live path's (map and emissiveMap
    // present, metalnessMap and roughnessMap nulled), so the first skin sighted
    // in the world linked that program inside a live frame however complete the
    // boot entry looked.
    const specs = Object.entries(WEAPON_VFX);
    // Every spec, not the first: the branch is per host material, so one
    // entry left on the flat-tint arm is exactly the escape this pins.
    expect(specs.length).toBeGreaterThan(1);
    const group = buildWeaponVfxPrewarmGroup();

    for (const [key, spec] of specs) {
      const host = group.getObjectByName(`prewarm-skin-host:${key}`) as THREE.Mesh;
      const hostMat = host.material as THREE.MeshStandardMaterial;

      const live = liveSkinMesh();
      const rig = createWeaponVfx(live, spec, { grounded: false });
      const liveMat = live.material as THREE.MeshStandardMaterial;

      expect(liveMat.emissiveMap, key).not.toBeNull();
      expect(hostMat.emissiveMap, key).toBeTruthy();
      expect(hostMat.metalnessMap, key).toBeNull();
      expect(materialProgramSignature(hostMat), key).toBe(materialProgramSignature(liveMat));

      // The mapless host this replaced is the negative case: it never carried
      // the live key, so the comparison above is not trivially true.
      const mapless = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      const maplessRig = createWeaponVfx(mapless, spec, { grounded: false });
      expect(
        materialProgramSignature(mapless.material as THREE.MeshStandardMaterial),
        key,
      ).not.toBe(materialProgramSignature(liveMat));

      rig.dispose();
      maplessRig.dispose();
    }
  });

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

  it('pins the resume key plan to the catalog exactly once, in catalog order', () => {
    // WEAPON_VFX_PREWARM_KEYS is Object.freeze(Object.keys(WEAPON_VFX)), so
    // comparing it against Object.keys(WEAPON_VFX) cannot fail and neither can
    // a uniqueness check over Object.keys. Literals are the only thing here
    // that notices the catalog, or the unit plan derived from it, drifting.
    expect(WEAPON_VFX_PREWARM_KEYS).toHaveLength(23);
    expect(WEAPON_VFX_PREWARM_KEYS[0]).toBe('ice_fang');
    expect(WEAPON_VFX_PREWARM_KEYS[WEAPON_VFX_PREWARM_KEYS.length - 1]).toBe('cinderlatch');
    // And the plan really is the catalog, in its own order.
    expect(WEAPON_VFX_PREWARM_KEYS).toEqual(Object.keys(WEAPON_VFX));
  });

  it('drives the real plan: builds, then one textures unit, then compiles', () => {
    // The previous version of this case re-derived the ids from the catalog
    // with its own template literal and never called weaponVfxPrewarmUnits, so
    // it proved the regex matched the TEST's strings. Reordering the three
    // phases, which is the whole point of the streaming split, left it green.
    const staged: string[] = [];
    const compiled: string[] = [];
    let textures = 0;
    const groups = new Map<string, THREE.Group>();
    const stage = {
      group: null,
      get: (key: string) => groups.get(key),
      stage: (key: string) => {
        staged.push(key);
        const group = new THREE.Group();
        groups.set(key, group);
        return group;
      },
      disposeFailedUnit: () => {},
      dispose: () => {},
    };
    const published: (THREE.Group | null)[] = [];

    const units = weaponVfxPrewarmUnits(stage, {
      prewarmTextures: () => {
        textures++;
      },
      compile: async (group) => {
        compiled.push([...groups].find(([, g]) => g === group)?.[0] ?? '?');
      },
      publishGroup: (group) => published.push(group),
    });

    const ids = units.map((unit) => unit.id);
    expect(ids).toHaveLength(47);
    // Phase order is the contract: every build, then the single shared-texture
    // unit, then every compile. A compile that ran before its build would find
    // no group and link nothing.
    expect(ids.slice(0, 23)).toEqual(
      WEAPON_VFX_PREWARM_KEYS.map((key) => `weapon-skins:build:${key}`),
    );
    expect(ids[23]).toBe('weapon-skins:textures');
    expect(ids.slice(24)).toEqual(
      WEAPON_VFX_PREWARM_KEYS.map((key) => `weapon-skins:compile:${key}`),
    );
    expect(ids[0]).toBe('weapon-skins:build:ice_fang');
    expect(ids[46]).toBe('weapon-skins:compile:cinderlatch');

    // Running the plan in order stages every skin once and compiles each one.
    for (const unit of units.slice(0, 24)) unit.run();
    expect(staged).toEqual([...WEAPON_VFX_PREWARM_KEYS]);
    expect(textures).toBe(1);
    expect(published).toHaveLength(23);
  });

  it('skips a compile whose skin was released, without throwing', () => {
    // What the per-skin failure boundary relies on: after disposeFailedUnit
    // drops one skin, that skin's remaining compile unit must no-op rather
    // than throw or link a stale group.
    const compiled: string[] = [];
    const stage = {
      group: null,
      get: () => undefined,
      stage: () => new THREE.Group(),
      disposeFailedUnit: () => {},
      dispose: () => {},
    };
    const units = weaponVfxPrewarmUnits(stage, {
      prewarmTextures: () => {},
      compile: async (group) => {
        compiled.push(group.uuid);
      },
      publishGroup: () => {},
    });

    const compileUnit = units.find((unit) => unit.id.startsWith('weapon-skins:compile:'));
    expect(compileUnit).toBeDefined();
    expect(() => compileUnit?.run()).not.toThrow();
    expect(compiled).toEqual([]);
  });

  it('plans one build and one compile unit per catalog skin, with literal ids', () => {
    // 23 skins, 2 per-skin units each plus the one shared texture unit: what
    // the PR claims the streamed lane replaced the single 534 ms unit with.
    const buildIds = WEAPON_VFX_PREWARM_KEYS.map((key) => `weapon-skins:build:${key}`);
    const compileIds = WEAPON_VFX_PREWARM_KEYS.map((key) => `weapon-skins:compile:${key}`);
    expect(buildIds[0]).toBe('weapon-skins:build:ice_fang');
    expect(compileIds[compileIds.length - 1]).toBe('weapon-skins:compile:cinderlatch');
    expect(new Set([...buildIds, ...compileIds, 'weapon-skins:textures']).size).toBe(47);
    // Every planned id round-trips through the failure-boundary key mapping,
    // so no unit can fail into "owns nothing" by an id typo.
    for (const id of [...buildIds, ...compileIds]) {
      expect(weaponVfxPrewarmSkinUnitKey(id)).not.toBeNull();
    }
  });

  it('builds exactly one deterministic skin unit with the same hidden ownership contract', () => {
    const keys = Object.keys(WEAPON_VFX);
    expect(keys.length).toBeGreaterThan(1);
    const first = keys[0];
    const second = keys[1];
    const firstGroup = buildWeaponVfxPrewarmSkinGroup(first);
    const secondGroup = buildWeaponVfxPrewarmSkinGroup(second);

    expect(firstGroup.name).toBe(`weapon-vfx-program-prewarm:${first}`);
    expect(secondGroup.name).toBe(`weapon-vfx-program-prewarm:${second}`);
    expect(firstGroup.getObjectByName(`prewarm-skin-host:${first}`)).toBeTruthy();
    expect(firstGroup.getObjectByName(`prewarm-skin-host:${second}`)).toBeUndefined();
    expect(secondGroup.getObjectByName(`prewarm-skin-host:${second}`)).toBeTruthy();

    const firstLights: THREE.Object3D[] = [];
    firstGroup.traverse((object) => {
      if ((object as THREE.PointLight).isPointLight) firstLights.push(object);
    });
    expect(firstLights).toHaveLength(1);
    expect(firstLights[0].visible).toBe(false);
    expect(firstGroup.userData.renderCategory).toBe('prewarm');
    expect(firstGroup.getObjectByName('weapon_vfx_extras')).toBeTruthy();
    expect(secondGroup.userData.renderCategory).toBe('prewarm');
  });

  it('rejects an unknown skin before publishing a partial prewarm group', () => {
    expect(() => buildWeaponVfxPrewarmSkinGroup('__missing_skin__')).toThrow(
      /unknown weapon VFX prewarm skin/,
    );
  });

  it('releases each staged skin exactly once, and a second terminal pass is a no-op', () => {
    // This case used to be an it.each over 'texture' and 'compile' titled
    // "terminally releases every skin already staged when the %s resume unit
    // fails". It drove neither resume unit: it threw its own error and called
    // the disposer itself, so the two arms differed only in a message string,
    // and the title named whole-catalog behaviour this branch deliberately
    // replaced with a per-skin boundary. What it actually pins is the disposer's
    // own contract, so that is what it says now. The per-skin failure boundary
    // is covered in 'streamed weapon-skin prewarm staging' above, and the
    // renderer's wiring to it by the source pin below.
    const keys = Object.keys(WEAPON_VFX).slice(0, 2);
    const staged: THREE.Group[] = [];
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const seenGeometries = new Set<THREE.BufferGeometry>();
    const seenMaterials = new Set<THREE.Material>();
    for (const key of keys) {
      const group = buildWeaponVfxPrewarmSkinGroup(key);
      staged.push(group);
      group.traverse((object) => {
        const renderable = object as THREE.Mesh;
        if (
          renderable.geometry &&
          !(object as THREE.Object3D & { isSprite?: boolean }).isSprite &&
          !seenGeometries.has(renderable.geometry)
        ) {
          seenGeometries.add(renderable.geometry);
          disposals.push(vi.spyOn(renderable.geometry, 'dispose'));
        }
        const materials = renderable.material
          ? Array.isArray(renderable.material)
            ? renderable.material
            : [renderable.material]
          : [];
        for (const material of materials) {
          if (seenMaterials.has(material)) continue;
          seenMaterials.add(material);
          disposals.push(vi.spyOn(material, 'dispose'));
        }
      });
    }

    disposeWeaponVfxPrewarmSkinGroups(staged);
    expect(staged).toHaveLength(2);
    expect(disposals.length).toBeGreaterThan(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();

    // The failure hook and the aggregate cleanup may both run, so the ownership
    // seam has to make the second terminal pass a no-op.
    disposeWeaponVfxPrewarmSkinGroups(staged);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('wires the renderer resume failure hook to the PER-SKIN release (source pin)', () => {
    // The production call site has no behavioural test (it needs a Renderer),
    // and it is exactly where the whole-catalog regression lived: onUnitError
    // called disposeFailure(), which cleared all 47. Nothing else would notice
    // it coming back.
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const hookAt = renderer.indexOf('onUnitError: (entry, unit, error) => {');
    expect(hookAt).toBeGreaterThan(-1);
    const hook = codeWithoutLineComments(renderer.slice(hookAt, renderer.indexOf('},', hookAt)));
    expect(hook).toContain("if (entry.id === 'vfx.weapon-skins') {");
    // The unit's OWN id, so the boundary is one skin.
    expect(hook).toContain('weaponVfxPrewarmSkinStage.disposeFailedUnit(unit.id);');
    // The aggregate is republished, never nulled: nulling it was what made the
    // remaining compile units no-op against a missing census owner.
    expect(hook).toContain('weaponVfxPrewarmGroup = weaponVfxPrewarmSkinStage.group;');
    // And the whole-catalog release is gone from the renderer entirely.
    expect(renderer).not.toContain('disposeFailure(');
  });
});
