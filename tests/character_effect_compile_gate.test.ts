import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// A rig goes translucent (stealth, the spirit run, Shadowform, Moonkin) by
// mounting a `transparent = true` clone of every one of its materials, and
// three keys its program cache on that flip. Swapping those clones onto a
// VISIBLE rig therefore links a brand new program on the next draw: the 4808 ms
// `paladin_metallic` stall of the 2026-08-17 Eastbrook crowd capture, plus four
// `mod_cloth` / `mod_jewel` rows at 115 to 130 ms on the same rig.
//
// These cases pin the hide-compile-reveal that closes it, and the shape of it
// that keeps it fair: the BODY IS NEVER HIDDEN. The rig keeps drawing its
// current, already-linked materials while the clones compile on a hidden
// scratch mesh set, the swap commits on the per-frame update() path once the
// gate settles, and every later toggle of that clone set is immediate.

const FRAME = 1 / 60;

const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

/** A minimally real skinned GLB: the overlay clones the rig's own materials,
 *  so the harness has to carry real meshes with real materials. It carries a
 *  PLAIN prop mesh next to the skinned body on purpose: a rig's attached
 *  weapons, its class halo and its baked far mesh are all unskinned, and three
 *  keys `skinning` on isSkinnedMesh. */
function stubGltf() {
  const scene = new THREE.Group();
  const rootBone = new THREE.Bone();
  rootBone.name = 'RigRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'RigChild';
  childBone.position.y = 1;
  rootBone.add(childBone);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const vertexCount = geometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  scene.add(mesh);
  const prop = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.9),
    new THREE.MeshStandardMaterial(),
  );
  prop.name = 'prop_plank';
  childBone.add(prop);
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('RigChild.position[x]', [0, 1], [0, 1]),
    ]);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
}

/** Every material the rig itself is drawing (the scratch set hangs off the
 *  pose wrapper, outside the model, so it can never be counted here). */
function rigMaterials(visual: CharacterVisual): THREE.Material[] {
  const model = (visual as unknown as { model: THREE.Object3D }).model;
  const out: THREE.Material[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = mesh.material;
    for (const material of Array.isArray(mats) ? mats : [mats]) if (material) out.push(material);
  });
  return out;
}

function rigIsTranslucent(visual: CharacterVisual): boolean {
  const mats = rigMaterials(visual);
  return mats.length > 0 && mats.every((material) => material.transparent);
}

/** Every geometry a staged twin can be built over, mapped to whether the mesh
 *  the rig actually DRAWS it with is skinned: the rig's own meshes plus the
 *  baked far mesh. */
function sourceIsSkinnedByGeometry(visual: CharacterVisual): Map<THREE.BufferGeometry, boolean> {
  const priv = visual as unknown as { model: THREE.Object3D; farMesh: THREE.Mesh | null };
  const out = new Map<THREE.BufferGeometry, boolean>();
  const record = (mesh: THREE.Mesh | null): void => {
    if (!mesh?.geometry) return;
    out.set(mesh.geometry, (mesh as THREE.SkinnedMesh).isSkinnedMesh === true);
  };
  priv.model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) record(mesh);
  });
  record(priv.farMesh);
  return out;
}

function meshNamed(visual: CharacterVisual, name: string): THREE.Mesh {
  const priv = visual as unknown as { model: THREE.Object3D };
  const found = priv.model.getObjectByName(name) as THREE.Mesh | undefined;
  if (!found) throw new Error(`test harness lost the ${name} mesh`);
  return found;
}

function scratchOf(visual: CharacterVisual): THREE.Group | null {
  return (visual as unknown as { effectSwapScratch: THREE.Group | null }).effectSwapScratch;
}

type GateCall = { target: THREE.Object3D; settle: () => void };

async function makeVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  visual.update(FRAME, anim(), true);
  return visual;
}

describe('a transparent character effect swaps in only once its programs are linked', () => {
  it('keeps the body drawing, compiles the clones hidden, and commits in update()', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);
    expect(opaque.length).toBeGreaterThan(0);
    expect(opaque.every((material) => !material.transparent)).toBe(true);

    visual.setGhost(true);

    // The body is NEVER hidden: it keeps drawing the exact materials it had.
    expect(visual.root.visible).toBe(true);
    expect(rigMaterials(visual)).toEqual(opaque);
    // ...while the clones link on a hidden scratch set carrying the rig's own
    // geometry and skinning, so three keys the same programs.
    expect(gateCalls).toHaveLength(1);
    const scratch = gateCalls[0].target as THREE.Group;
    expect(scratch.name).toBe('character_effect_compile_scratch');
    expect(scratch.visible).toBe(false);
    expect(scratch.children.length).toBeGreaterThan(0);
    const stand = scratch.children[0] as THREE.SkinnedMesh;
    expect(stand.isSkinnedMesh).toBe(true);
    expect(stand.visible).toBe(false);
    expect((stand.material as THREE.Material).transparent).toBe(true);
    // The stand-in wears the rig's OWN geometry: the attribute set is in
    // three's program key, so a proxy box would link a variant nothing draws.
    const rigGeometries = new Set<THREE.BufferGeometry>();
    (visual as unknown as { model: THREE.Object3D }).model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) rigGeometries.add(mesh.geometry);
    });
    expect(rigGeometries.has(stand.geometry)).toBe(true);

    // A frame with the link still in flight changes nothing.
    visual.update(FRAME, anim(), true);
    expect(rigMaterials(visual)).toEqual(opaque);

    // The callback must NOT commit: a material swap that changes what three
    // counts for a frame belongs on the per-frame path (numPointLights).
    gateCalls[0].settle();
    expect(rigMaterials(visual)).toEqual(opaque);

    visual.update(FRAME, anim(), true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(scratchOf(visual)).toBeNull();

    // Once a clone set has linked, a later toggle is immediate: a ghost run or
    // a death treatment that MUST show is never held back twice.
    visual.setGhost(false);
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(gateCalls).toHaveLength(1);
    visual.setGhost(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    visual.dispose();
  });

  it('twins the SOURCE mesh kind, never a skinned stand-in over a plain source', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    const staged = (gateCalls[0].target as THREE.Group).children as THREE.Mesh[];
    const isSkinned = (mesh: THREE.Mesh): boolean =>
      (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;

    // Both kinds are really in play here (a skinned body, a plain prop and the
    // baked far mesh), so neither arm of the rule is vacuous.
    expect(staged.filter(isSkinned).length).toBeGreaterThan(0);
    expect(staged.filter((mesh) => !isSkinned(mesh)).length).toBeGreaterThan(0);

    // three keys `skinning` on isSkinnedMesh: a twin of the wrong kind links a
    // program the real draw never binds, and the commit frame pays the
    // synchronous link the gate exists to avoid.
    const kinds = sourceIsSkinnedByGeometry(visual);
    for (const twin of staged) {
      expect(kinds.get(twin.geometry)).toBe(isSkinned(twin));
    }
    const prop = meshNamed(visual, 'prop_plank');
    const propTwin = staged.find((mesh) => mesh.geometry === prop.geometry);
    expect(propTwin).toBeDefined();
    expect(isSkinned(propTwin as THREE.Mesh)).toBe(false);

    // The depth arm is a program too: the shadow flags ride along.
    const body = meshNamed(visual, 'body');
    const bodyTwin = staged.find((mesh) => mesh.geometry === body.geometry) as THREE.Mesh;
    expect(bodyTwin.castShadow).toBe(body.castShadow);
    expect(bodyTwin.receiveShadow).toBe(body.receiveShadow);
    visual.dispose();
  });

  it('never defers the Soul Rend mark, which is actionable raid information', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);

    // Nythraxis' mark tells the marked player to act, so it is exempt from the
    // deferral (graphics-settings fairness): it shows on the frame it lands.
    visual.setSoulRend(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(0);
    expect(scratchOf(visual)).toBeNull();
    visual.setSoulRend(false);
    expect(rigMaterials(visual)).toEqual(opaque);

    // A cosmetic effect on the same rig still waits for its link...
    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    expect(rigMaterials(visual)).toEqual(opaque);
    // ...and a mark landing while that swap is still in flight wins outright.
    visual.setSoulRend(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(gateCalls).toHaveLength(1);
    expect(scratchOf(visual)).toBeNull();
    visual.dispose();
  });

  it('remembers a set that linked but was superseded before its commit frame', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    // The ghost clones ARE linked, but a shapeshift supersedes the swap before
    // update() commits it. Ghost outranks Shadowform, so what the visual wants
    // is exactly the set that just linked: it must swap in at once instead of
    // re-staging and re-queueing a compile-lane slot for work already done.
    gateCalls[0].settle();
    visual.setShadowform(true);
    expect(gateCalls).toHaveLength(1);
    expect(rigIsTranslucent(visual)).toBe(true);

    // A genuinely new clone set (Shadowform's) still gates once...
    visual.setGhost(false);
    expect(gateCalls).toHaveLength(2);
    // ...and the ghost set stays immediate for every later toggle.
    visual.setGhost(true);
    expect(gateCalls).toHaveLength(2);
    expect(rigIsTranslucent(visual)).toBe(true);
    visual.dispose();
  });

  it('supersedes a swap still in flight, and ignores the stale settle', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    const opaque = rigMaterials(visual);

    visual.setGhost(true);
    expect(gateCalls).toHaveLength(1);
    const superseded = gateCalls[0].target;

    // A newer effect state before the settle: the in-flight scratch is dropped
    // and the state the visual actually wants is staged instead.
    visual.setShadowform(true);
    expect(gateCalls).toHaveLength(2);
    expect(superseded.parent).toBeNull();
    expect(rigMaterials(visual)).toEqual(opaque);

    // The stale settle commits nothing.
    gateCalls[0].settle();
    visual.update(FRAME, anim(), true);
    expect(rigMaterials(visual)).toEqual(opaque);

    gateCalls[1].settle();
    visual.update(FRAME, anim(), true);
    expect(rigIsTranslucent(visual)).toBe(true);
    visual.dispose();
  });

  it('swaps immediately with no gate installed (previews, tests, no async compile)', async () => {
    const visual = await makeVisual();
    // No setFarBakeGate at all: the pre-gate behaviour, unchanged.
    visual.setGhost(true);
    expect(rigIsTranslucent(visual)).toBe(true);
    expect(scratchOf(visual)).toBeNull();

    // ...and installing a gate afterwards does not retroactively gate what is
    // already mounted, but DOES clear any pending swap (the pool re-acquire).
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    expect(scratchOf(visual)).toBeNull();
    visual.dispose();
  });

  it('keeps the opaque body and never throws when the gate rejects', async () => {
    const visual = await makeVisual();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    visual.setFarBakeGate(() => {
      throw new Error('compile gate rejected');
    });
    const opaque = rigMaterials(visual);

    expect(() => visual.setGhost(true)).not.toThrow();
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(scratchOf(visual)).toBeNull();
    expect(() => visual.update(FRAME, anim(), true)).not.toThrow();
    expect(rigMaterials(visual)).toEqual(opaque);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    visual.dispose();
  });

  it('drops a swap still in flight on dispose without disposing the live clones', async () => {
    const visual = await makeVisual();
    const gateCalls: GateCall[] = [];
    visual.setFarBakeGate((target, onSettled) => gateCalls.push({ target, settle: onSettled }));
    visual.setGhost(true);
    const scratch = gateCalls[0].target;
    expect(scratch.parent).not.toBeNull();

    visual.dispose();
    expect(scratch.parent).toBeNull();
    // A settle landing after the teardown is inert.
    expect(() => gateCalls[0].settle()).not.toThrow();
  });
});
