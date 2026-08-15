// CharacterVisual's material lifecycle against the shared tinted-material
// cache and the per-visual rune-tint clones: dispose() releases the visual's
// cache claims (never disposing a clone another visual still mounts), pooled
// retint (setEntityColor) releases the previous color's claims so cycling
// rift colors stays bounded, and the Thornhollow rune-tint clones dispose
// with the visual (and on a rune chain, exactly as they are unmounted).
// Full-construction pins on the real CharacterVisual paths: the mocked loader
// serves a minimal rig for every URL (the halo suite's pattern).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TINTED_MATERIAL_IDLE_CACHE_MAX } from '../src/render/characters/tinted_material_cache_core';

type AssetsModule = typeof import('../src/render/characters/assets');
type VisualModule = typeof import('../src/render/characters/visual');

const stubGltf = () => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
};

async function loadModules(): Promise<{ assets: AssetsModule; visual: VisualModule }> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = (await import('../src/render/characters/assets')) as AssetsModule;
  await assets.charactersReady();
  const visual = (await import('../src/render/characters/visual')) as VisualModule;
  return { assets, visual };
}

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

/** Every material mounted anywhere under root (arrays flattened). */
function mountedMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      out.add(mat);
    }
  });
  return out;
}

/** Flood the shared cache's idle set well past its bound (leaseless calls
 *  park at the idle tail), so anything unpinned must have evicted. */
function floodIdle(assets: AssetsModule, salt: number): void {
  for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
    assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), salt + i, 0.4);
  }
}

describe('CharacterVisual tinted-material release', () => {
  it('two visuals share one cache clone; disposing one never disposes what the other still mounts', async () => {
    const { assets, visual: visualModule } = await loadModules();
    const a = new visualModule.CharacterVisual('mob_mushroom_pixie', 0x336699);
    const b = new visualModule.CharacterVisual('mob_mushroom_pixie', 0x336699);
    const bodyA = a.root.getObjectByName('body') as THREE.Mesh;
    const bodyB = b.root.getObjectByName('body') as THREE.Mesh;
    expect(bodyA).toBeDefined();
    // Sharing pin: same (source, tint) resolves to the one shared clone.
    expect(bodyB.material).toBe(bodyA.material);
    const shared = bodyA.material as THREE.Material;
    const spy = vi.spyOn(shared, 'dispose');

    a.dispose();
    floodIdle(assets, 0x10);
    // The mutant that releases (or disposes) the shared clone on the FIRST
    // visual's dispose goes red here: b still mounts it.
    expect(spy).not.toHaveBeenCalled();
    expect(bodyB.material).toBe(shared);

    b.dispose();
    floodIdle(assets, 0x2000);
    // Last mount gone: the idle LRU genuinely reclaims and disposes.
    expect(spy).toHaveBeenCalledTimes(1);
  }, 20000);

  it('setEntityColor cycling (the pooled rift retint path) keeps the shared cache bounded', async () => {
    const { assets, visual: visualModule } = await loadModules();
    // mob_mushroom_pixie carries tint: 'entity', the pooled-reuse case whose
    // per-instance color used to mint a permanently retained clone set per
    // distinct rift color (the C1 residual).
    const v = new visualModule.CharacterVisual('mob_mushroom_pixie', 0x100000);
    const body = v.root.getObjectByName('body') as THREE.Mesh;
    const firstColorMaterial = body.material as THREE.Material;
    const firstSpy = vi.spyOn(firstColorMaterial, 'dispose');

    for (let i = 1; i <= TINTED_MATERIAL_IDLE_CACHE_MAX + 40; i++) {
      v.setEntityColor(0x100000 + i * 37);
    }
    const lastColorMaterial = body.material as THREE.Material;
    expect(lastColorMaterial).not.toBe(firstColorMaterial);

    // Bounded: the live color plus at most the idle bound stays resident, and
    // the first color's clone was genuinely disposed while the mounted one
    // survives.
    expect(assets.tintedMaterialInternalsForTest.cacheSize()).toBeLessThanOrEqual(
      TINTED_MATERIAL_IDLE_CACHE_MAX + 2,
    );
    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(mountedMaterials(v.root).has(lastColorMaterial)).toBe(true);

    v.dispose();
  }, 20000);

  it('color cycling with an active overlay holds one effect-clone set, not one per color', async () => {
    const { visual: visualModule } = await loadModules();
    // tint: 'entity', the pooled-reuse case: setEntityColor re-runs
    // applySkinMaterials, swapping every SOURCE material the effect maps key
    // by. The ratchet that only emptied those maps in dispose() accumulated
    // one unreachable clone set per rift color worn.
    const v = new visualModule.CharacterVisual('mob_mushroom_pixie', 0x100000);
    v.setGhost(true);
    const maps = v as unknown as { ghostMaterials: Map<THREE.Material, THREE.Material> };
    const clonesPerSet = maps.ghostMaterials.size;
    expect(clonesPerSet).toBeGreaterThan(0);
    const firstClones = [...maps.ghostMaterials.values()];
    const firstSpies = firstClones.map((mat) => vi.spyOn(mat, 'dispose'));

    for (let i = 1; i <= 12; i++) v.setEntityColor(0x100000 + i * 37);

    // One clone set for the CURRENT sources, not one per color worn, and the
    // first color's clones were genuinely disposed as their sources swapped.
    expect(maps.ghostMaterials.size).toBe(clonesPerSet);
    for (const spy of firstSpies) expect(spy).toHaveBeenCalledTimes(1);

    // The overlay survived the swaps visually: the mounted body material is
    // a live ghost clone re-derived from the CURRENT source (transparent,
    // faded), not the raw tint clone and not a stale disposed clone.
    const body = v.root.getObjectByName('body') as THREE.Mesh;
    const mounted = body.material as THREE.Material;
    expect([...maps.ghostMaterials.values()]).toContain(mounted);
    expect(firstClones).not.toContain(mounted);
    expect(mounted.transparent).toBe(true);
    expect(mounted.opacity).toBeLessThan(1);

    v.dispose();
  }, 20000);

  it('disposes the rune-tint clones with the visual', async () => {
    const { visual: visualModule } = await loadModules();
    const v = new visualModule.CharacterVisual('player_warrior', 0xffffff, 0);
    v.setRuneTint(0xff2200);

    const runeClones = [...mountedMaterials(v.root)].filter(
      (mat) => mat.userData.runeTintHex === 0xff2200,
    );
    expect(runeClones.length).toBeGreaterThan(0);
    const spies = runeClones.map((mat) => vi.spyOn(mat, 'dispose'));

    v.dispose();
    // The mutant that leaves runeTintMaterials out of disposeEffectMaterials
    // goes red here: every rune clone must dispose with its owning visual.
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  }, 20000);

  it('a rune chain replaces the clone per source, disposing the old tint exactly as it unmounts', async () => {
    const { visual: visualModule } = await loadModules();
    const v = new visualModule.CharacterVisual('player_warrior', 0xffffff, 0);
    v.setRuneTint(0xff2200);
    const oldClones = [...mountedMaterials(v.root)].filter(
      (mat) => mat.userData.runeTintHex === 0xff2200,
    );
    expect(oldClones.length).toBeGreaterThan(0);
    const oldSpies = oldClones.map((mat) => vi.spyOn(mat, 'dispose'));

    v.setRuneTint(0x2266ff);
    const mounted = mountedMaterials(v.root);
    // Old tint fully unmounted and disposed; new tint mounted in its place.
    for (const clone of oldClones) expect(mounted.has(clone)).toBe(false);
    for (const spy of oldSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(
      [...mounted].filter((mat) => mat.userData.runeTintHex === 0x2266ff).length,
    ).toBeGreaterThan(0);

    // And the per-visual map holds ONE clone per source (the chain replaced,
    // not accumulated) with no stale-tint residue.
    const map = (v as unknown as { runeTintMaterials: Map<THREE.Material, THREE.Material> })
      .runeTintMaterials;
    for (const clone of map.values()) {
      expect(clone.userData.runeTintHex).toBe(0x2266ff);
    }

    v.dispose();
  }, 20000);

  it('the currently mounted rune clone is never disposed while worn', async () => {
    const { visual: visualModule } = await loadModules();
    const v = new visualModule.CharacterVisual('player_warrior', 0xffffff, 0);
    v.setRuneTint(0xff2200);
    const clones = [...mountedMaterials(v.root)].filter(
      (mat) => mat.userData.runeTintHex === 0xff2200,
    );
    const spies = clones.map((mat) => vi.spyOn(mat, 'dispose'));

    // Re-asserting the same tint and toggling an unrelated overlay must not
    // touch the live clones (the disposed-while-mounted mutant goes red).
    v.setRuneTint(0xff2200);
    v.setGhost(true);
    v.setGhost(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(
      [...mountedMaterials(v.root)].filter((mat) => mat.userData.runeTintHex === 0xff2200).length,
    ).toBeGreaterThan(0);

    v.dispose();
  }, 20000);
});
