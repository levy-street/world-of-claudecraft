// @vitest-environment happy-dom
// VisualDef.noShadowNodes through the real CharacterVisual: the Seeker board's
// baked FX shells (the exhaust cloud and the light trail, six alpha-blended
// emissive materials) must stay out of the shadow pass, or the depth material
// draws them as solid blobs under a hovering board. tests/seeker_board_mount
// pins the NAMES against the GLB; this pins the BEHAVIOUR those names drive,
// on both caster arms (the construction sweep and the setShadow re-list).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

describe('Seeker board FX shells and the shadow pass', () => {
  it('keeps the named FX nodes out of castShadow and the caster list, and the body in', async () => {
    const def = VISUALS.mount_seeker_board;
    const fxNodes = [...(def.noShadowNodes ?? [])];
    expect(fxNodes.length).toBeGreaterThan(0);

    vi.resetModules();
    // The graph GLTFLoader really builds for this rig, not the glTF node list:
    // Cloud_FX and Trail_FX are MULTI-primitive meshes (three materials each),
    // which the loader turns into a Group carrying the node name with one
    // SkinnedMesh child per primitive, named after the glTF MESH plus a
    // uniqueness suffix (Icosphere, Icosphere_1, ...). A name-equality check
    // on the mesh would therefore never match; the exclusion has to read the
    // ancestry. Plus one ordinary body mesh that must keep casting.
    const shellNames = (node: string) =>
      node === 'Cloud_FX'
        ? ['Icosphere', 'Icosphere_1', 'Icosphere_2']
        : ['Icosphere028', 'Icosphere028_1', 'Icosphere028_2'];
    const stubGltf = () => {
      const scene = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.75, 0.19, 0.6),
        new THREE.MeshStandardMaterial(),
      );
      body.name = 'Mount_NeonSeeker_Mesh';
      scene.add(body);
      for (const name of fxNodes) {
        const group = new THREE.Group();
        group.name = name;
        for (const child of shellNames(name)) {
          const shell = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.3),
            new THREE.MeshStandardMaterial({ transparent: true, emissive: 0xffffff }),
          );
          shell.name = child;
          group.add(shell);
        }
        scene.add(group);
      }
      return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    const { charactersReady, preloadMountAssets } = await import('../src/render/characters/assets');
    await charactersReady();
    // Mount rigs are lazyPreload: the eager boot sweep skips them, so load the
    // board the way the runtime does before constructing its visual.
    await preloadMountAssets('mount_seeker_board');
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const visual = new CharacterVisual('mount_seeker_board', 0xffffff, 0);
    type CastersPeek = { casters: THREE.Mesh[] };
    const casterNames = () =>
      (visual as unknown as CastersPeek).casters.map((mesh) => mesh.name).sort();

    const shells = (): THREE.Mesh[] =>
      fxNodes.flatMap((name) => {
        const group = visual.root.getObjectByName(name);
        expect(group, name).toBeDefined();
        const meshes: THREE.Mesh[] = [];
        group?.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        return meshes;
      });
    const expectShellsShadowless = () => {
      const found = shells();
      expect(found).toHaveLength(6);
      for (const shell of found) expect(shell.castShadow, `${shell.name} casts`).toBe(false);
      expect(casterNames()).toEqual(['Mount_NeonSeeker_Mesh']);
    };

    const body = visual.root.getObjectByName('Mount_NeonSeeker_Mesh') as THREE.Mesh;
    expect(body).toBeDefined();
    expect(body.castShadow).toBe(true);
    expectShellsShadowless();

    // The preset toggle walks the caster list with shadows on again, and must
    // neither re-enable the shells nor re-admit them.
    visual.setShadow(false);
    expect(body.castShadow).toBe(false);
    visual.setShadow(true);
    expect(body.castShadow).toBe(true);
    expectShellsShadowless();

    // The re-list arm after a model-graph change (a weapon swap) re-arms every
    // caster from scratch; it reads the same predicate, so the shells stay out.
    type RebuildPeek = { rebuildCasters(): void };
    (visual as unknown as RebuildPeek).rebuildCasters();
    expect(body.castShadow).toBe(true);
    expectShellsShadowless();
  });
});
