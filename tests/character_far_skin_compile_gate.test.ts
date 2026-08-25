// @vitest-environment happy-dom
// The skin half of the far-LOD compile gate (src/render/characters/visual.ts
// stageFarMaterials): a skin change rebuilds the far mesh's material set, and
// that set can be new programs too (an emissive atlas toggles a define), so
// before this it linked cold on the far mesh's next draw. Behind the
// renderer's gate the new set now compiles hidden on a scratch mesh (same
// geometry and flags as the far mesh, so three keys the same programs) while
// the far mesh keeps drawing its current, linked set, and swaps in on settle:
// no hole, no LOD pop for a distant player who changes skin.
//
// Drives the REAL construction + setSkin path of a fixed rig with a mocked
// GLTF/texture loader (the harness of tests/character_far_mesh_skin.test.ts).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const VISUAL_KEY = 'player_paladin';

const SYNTH_SOURCE_BONES = [
  'hips',
  'spine',
  'chest',
  'head',
  'upperarmr',
  'lowerarmr',
  'upperarml',
  'lowerarml',
  'upperlegr',
  'lowerlegr',
  'upperlegl',
  'lowerlegl',
];

function stubSourceClip(name: string): THREE.AnimationClip {
  const tracks = SYNTH_SOURCE_BONES.map(
    (bone) =>
      new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  );
  return new THREE.AnimationClip(name, 1, tracks);
}

function stubGltf() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('Idle', 1, []),
      stubSourceClip('2H_Melee_Attack_Chop'),
      stubSourceClip('1H_Melee_Attack_Slice_Diagonal'),
    ],
  };
}

function farMapName(farMesh: THREE.Mesh): string | null {
  const mats = farMesh.material as THREE.MeshStandardMaterial[];
  return mats[0].map?.name ?? null;
}

describe('a far re-skin swaps in only once its programs are linked', () => {
  it('keeps the current far set drawing, compiles the new one on a hidden scratch mesh, swaps on settle', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn((url: string) =>
        Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
      ),
      loadKtx2Texture: vi.fn((url: string) =>
        Promise.resolve(
          Object.assign(new THREE.Texture(), { name: url.replace(/\.ktx2$/, '.png') }),
        ),
      ),
      releaseGltf: vi.fn(),
    }));
    const assets = await import('../src/render/characters/assets');
    const { charactersReady } = assets;
    await charactersReady();
    const released = vi.spyOn(assets, 'releaseTintedMaterials');
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const { SKINS } = await import('../src/render/characters/manifest');
    const altSkinUrl = SKINS[VISUAL_KEY]?.[1];
    expect(altSkinUrl).toBeTruthy();

    const visual = new CharacterVisual(VISUAL_KEY, 0xffffff, 0);
    const farMesh = visual.root.getObjectByName('character_far_mesh') as THREE.Mesh;
    const farWrap = visual.root.getObjectByName('character_far_wrap') as THREE.Group;
    expect(farMesh).toBeTruthy();
    expect(farWrap).toBeTruthy();
    // Skin atlases load on demand now (the eager boot sweep is gone), so the
    // FIRST change to a cold atlas stages the far set twice: once from the
    // embedded default, then again when ensureSkinTexture heals the real atlas
    // in. That is the atlas arriving, not the compile gate's contract. Warm
    // both atlases here, through the UNGATED path, so the accounting below
    // measures one staging per skin change the way it always did.
    visual.setSkin(1);
    await vi.waitFor(() => {
      expect(farMapName(farMesh)).toBe(altSkinUrl);
    });
    visual.setSkin(0);
    await vi.waitFor(() => {
      expect(farMapName(farMesh)).not.toBe(altSkinUrl);
    });

    const gateCalls: { target: THREE.Object3D; settle: () => void }[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    // A fixed rig bakes its far mesh in the constructor, where the view's own
    // creation gate covers it: installing the gate afterwards gates nothing
    // retroactively, and the far crossing hands off immediately.
    visual.setFar(true);
    expect(gateCalls).toHaveLength(0);
    expect(farMesh.visible).toBe(true);
    const defaultMap = farMapName(farMesh);
    expect(defaultMap).not.toBe(altSkinUrl);
    // Non-default flags, so the scratch's copies below are a real assertion
    // (three keys receiveShadow into the program parameters).
    farMesh.castShadow = true;
    farMesh.receiveShadow = true;
    released.mockClear();

    visual.setSkin(1);

    // The far mesh still draws its current, linked set...
    expect(farMapName(farMesh)).toBe(defaultMap);
    expect(farMesh.visible).toBe(true);
    // ...while the new set links on a hidden scratch under the far wrap, with
    // the far mesh's geometry and flags (the same program key)
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Mesh;
    expect(scratch.name).toBe('character_far_skin_scratch');
    expect(scratch.parent).toBe(farWrap);
    expect(scratch.visible).toBe(false);
    expect(scratch.geometry).toBe(farMesh.geometry);
    expect(scratch.castShadow).toBe(true);
    expect(scratch.receiveShadow).toBe(true);
    const scratchMats = scratch.material as THREE.MeshStandardMaterial[];
    expect(scratchMats[0].map?.name).toBe(altSkinUrl);
    // Only the near rig's previous lease was released by the sweep: the far
    // set that is still drawing keeps its lease until the swap.
    expect(released).toHaveBeenCalledTimes(1);

    gateCalls[0].settle();

    // Swapped in, scratch gone, the previous far set's lease released (once).
    expect(farMapName(farMesh)).toBe(altSkinUrl);
    expect(scratch.parent).toBeNull();
    expect(farWrap.getObjectByName('character_far_skin_scratch')).toBeUndefined();
    expect(released).toHaveBeenCalledTimes(2);

    // A newer skin before settle supersedes the one in flight: the superseded
    // set's lease is released at once, the stale settle is ignored and only
    // the newest set lands.
    released.mockClear();
    visual.setSkin(0);
    expect(released).toHaveBeenCalledTimes(1); // rig sweep only
    visual.setSkin(1);
    expect(gateCalls).toHaveLength(3);
    const superseded = gateCalls[1].target;
    expect(superseded.parent).toBeNull();
    expect(released).toHaveBeenCalledTimes(3); // rig sweep + the superseded far set
    gateCalls[1].settle();
    expect(farMapName(farMesh)).toBe(altSkinUrl);
    expect(released).toHaveBeenCalledTimes(3); // the stale settle released nothing
    gateCalls[2].settle();
    expect(farMapName(farMesh)).toBe(altSkinUrl);
    expect(farWrap.getObjectByName('character_far_skin_scratch')).toBeUndefined();
    expect(released).toHaveBeenCalledTimes(4); // the set it replaced

    // The far mesh draws effectMaterial(farMaterials): with a ghost on, the
    // gated scratch must wear the overlay clones (a clone is another program
    // key), not the raw set. setGhost now stages those clones behind the SAME
    // injected gate (the character-effect swap, tests/
    // character_effect_compile_gate.test.ts), so the far scratch is picked by
    // name rather than by call index.
    const farScratchCalls = () =>
      gateCalls.filter((call) => call.target.name === 'character_far_skin_scratch');
    visual.setGhost(true);
    expect(gateCalls[3].target.name).toBe('character_effect_compile_scratch');
    visual.setSkin(0);
    const ghostedCall = farScratchCalls()[farScratchCalls().length - 1];
    const ghostMats = (ghostedCall.target as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(ghostMats[0].transparent).toBe(true);
    ghostedCall.settle();
    // The new set is committed, but the rig's MOUNT of the overlay waits on
    // the effect gate, so the far mesh still draws the linked set it had.
    expect(farMapName(farMesh)).toBe(altSkinUrl);
    visual.setGhost(false);
    expect(farMapName(farMesh)).toBe(defaultMap);

    // Without a gate the rebuild lands immediately (the pre-gate behaviour,
    // and what previews get).
    visual.setFarBakeGate(null);
    const ungatedCalls = gateCalls.length;
    visual.setSkin(1);
    expect(gateCalls).toHaveLength(ungatedCalls);
    expect(farMapName(farMesh)).toBe(altSkinUrl);

    // A dispose with a set still in flight releases that set's lease and
    // detaches its scratch.
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    visual.setSkin(0);
    const inFlightCall = gateCalls[gateCalls.length - 1];
    const inFlight = inFlightCall.target;
    expect(inFlight.name).toBe('character_far_skin_scratch');
    expect(inFlight.parent).toBe(farWrap);
    released.mockClear();
    visual.dispose();
    expect(inFlight.parent).toBeNull();
    // dispose releases the rig lease, the far set's lease AND the pending
    // set's lease (three distinct sets), and the late settle releases nothing
    expect(released).toHaveBeenCalledTimes(3);
    const releasedSets = released.mock.calls.map((call) => call[0]);
    expect(new Set(releasedSets).size).toBe(3);
    inFlightCall.settle();
    expect(released).toHaveBeenCalledTimes(3);
    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });
});
